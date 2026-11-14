import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { bytesHash, id, now, requireThat, RetouchError, stable, type Asset, type Entity, type Result, type WorkspaceConfig } from '../domain/model.ts';

export interface Outbox { id: string; run_id: string; node_key: string; context: string; event_json: string; source_id: string | null; evidence_id: string | null; status: string }
export class Store {
  root: string;
  config: WorkspaceConfig;
  db: DatabaseSync;
  constructor(root: string, config: WorkspaceConfig, readOnly = false) {
    this.root = root; this.config = config;
    this.db = new DatabaseSync(path.join(root, 'ledger.sqlite'), { readOnly });
    this.db.exec(readOnly ? 'PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;' : 'PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
  }
  static async initialize(root: string, config: WorkspaceConfig): Promise<Store> {
    const absolute = path.resolve(root);
    await fs.mkdir(absolute, { recursive: true });
    requireThat((await fs.readdir(absolute)).length === 0, 'WORKSPACE_NOT_EMPTY', '初始化目标必须为空目录');
    requireThat(!(await fs.lstat(absolute)).isSymbolicLink(), 'LINKED_WORKSPACE', '工作区根不能是链接');
    const canonical = await fs.realpath(absolute);
    await fs.writeFile(path.join(canonical, 'workspace.json'), JSON.stringify(config, null, 2) + '\n', { flag: 'wx' });
    const store = new Store(canonical, config);
    store.db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE entities (kind TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,document TEXT NOT NULL,PRIMARY KEY(kind,id));
      CREATE TABLE events (id TEXT PRIMARY KEY,task_id TEXT,run_id TEXT,kind TEXT NOT NULL,document TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE commands (id TEXT PRIMARY KEY,intent_hash TEXT NOT NULL,result TEXT NOT NULL);
      CREATE TABLE projections (plan_hash TEXT PRIMARY KEY,tree TEXT NOT NULL,fingerprint TEXT NOT NULL,task_id TEXT NOT NULL);
      CREATE TABLE outbox (id TEXT PRIMARY KEY,run_id TEXT NOT NULL,node_key TEXT NOT NULL,context TEXT NOT NULL,event_json TEXT NOT NULL,source_id TEXT,evidence_id TEXT,status TEXT NOT NULL DEFAULT 'pending');
      CREATE INDEX outbox_pending ON outbox(run_id,status);
      CREATE INDEX entities_project ON entities(kind,json_extract(document,'$.project_id'));
      CREATE INDEX entities_task ON entities(kind,json_extract(document,'$.task_id'));
    `);
    store.db.prepare('INSERT INTO meta VALUES (?,?)').run('workspace_id', config.id);
    store.db.prepare('INSERT INTO meta VALUES (?,?)').run('root', canonical);
    for (const directory of ['objects/sha256', 'runs', 'exports', 'tmp', 'ygl']) await fs.mkdir(path.join(canonical, directory), { recursive: true });
    return store;
  }
  static async open(root: string, readOnly = false, allowPendingImport = false): Promise<Store> {
    const canonical = await fs.realpath(path.resolve(root)).catch(() => { throw new RetouchError('WORKSPACE_NOT_FOUND', '请显式指定已初始化的 --workspace'); });
    const config = JSON.parse(await fs.readFile(path.join(canonical, 'workspace.json'), 'utf8')) as WorkspaceConfig;
    requireThat(config.schema_version === 'retouch.workspace/v1' && typeof config.id === 'string' && ['standard', 'demo'].includes(config.mode), 'INVALID_WORKSPACE', '工作区身份或 schema 无效', 1);
    await fs.access(path.join(canonical, 'ledger.sqlite'));
    requireThat(!(await fs.lstat(path.join(canonical, 'ledger.sqlite'))).isSymbolicLink() && (await fs.realpath(path.join(canonical, 'ledger.sqlite'))).startsWith(canonical + path.sep), 'WORKSPACE_BINDING', '账本路径不能指向工作区外部', 1);
    const store = new Store(canonical, config, readOnly);
    try {
      requireThat(store.db.prepare('SELECT value FROM meta WHERE key=?').get('workspace_id')?.value === config.id && store.db.prepare('SELECT value FROM meta WHERE key=?').get('root')?.value === canonical, 'WORKSPACE_BINDING', '工作区账本与目录绑定不一致', 1);
      requireThat(allowPendingImport || !store.db.prepare('SELECT value FROM meta WHERE key=?').get('import_pending'), 'IMPORT_INCOMPLETE', '工作区导入尚未提交；重新导入同一 ZIP 恢复，业务操作暂不可用', 1);
    } catch (error) { store.close(); throw error; }
    return store;
  }
  close() { this.db.close(); }
  isHistoricalGrant(grantId: string): boolean { return Boolean(this.db.prepare('SELECT 1 FROM meta WHERE key=?').get('historical_grant:' + grantId)); }
  setMeta(key: string, value: unknown) { this.db.prepare('INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, stable(value)); }
  transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = operation(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  get<T>(kind: string, entityId: string): Entity<T> {
    const row = this.db.prepare('SELECT revision,document FROM entities WHERE kind=? AND id=?').get(kind, entityId);
    if (!row) throw new RetouchError('NOT_FOUND', kind + ' 不存在：' + entityId);
    return { revision: Number(row.revision), data: JSON.parse(String(row.document)) as T };
  }
  maybe<T>(kind: string, entityId: string): Entity<T> | null {
    const row = this.db.prepare('SELECT revision,document FROM entities WHERE kind=? AND id=?').get(kind, entityId);
    return row ? { revision: Number(row.revision), data: JSON.parse(String(row.document)) as T } : null;
  }
  list<T>(kind: string): Entity<T>[] {
    return this.db.prepare('SELECT revision,document FROM entities WHERE kind=? ORDER BY rowid').all(kind).map((row) => ({ revision: Number(row.revision), data: JSON.parse(String(row.document)) as T }));
  }
  insert<T>(kind: string, entityId: string, document: T) {
    this.db.prepare('INSERT INTO entities VALUES (?,?,0,?)').run(kind, entityId, stable(document));
  }
  update<T>(kind: string, entityId: string, document: T, expected: number): number {
    const result = this.db.prepare('UPDATE entities SET revision=revision+1,document=? WHERE kind=? AND id=? AND revision=?').run(stable(document), kind, entityId, expected);
    if (result.changes !== 1) throw new RetouchError('REVISION_CONFLICT', '对象已变化，请刷新后重试');
    return expected + 1;
  }
  expect<T>(kind: string, entityId: string, expected: number): Entity<T> {
    const entity = this.get<T>(kind, entityId);
    requireThat(Number.isSafeInteger(expected) && entity.revision === expected, 'REVISION_CONFLICT', '对象版本已变化，请刷新后重试', 1);
    return entity;
  }
  replay(requestId: string, intent: string): Result | null {
    const row = this.db.prepare('SELECT intent_hash,result FROM commands WHERE id=?').get(requestId);
    if (!row) return null;
    requireThat(row.intent_hash === intent, 'REQUEST_CONFLICT', '相同 request-id 携带了不同意图', 1);
    return { ...JSON.parse(String(row.result)), replayed: true } as Result;
  }
  remember(requestId: string, intent: string, result: Result) {
    this.db.prepare('INSERT INTO commands VALUES (?,?,?)').run(requestId, intent, stable(result));
  }
  replaceResult(requestId: string, intent: string, result: Result) {
    const changed = this.db.prepare('UPDATE commands SET result=? WHERE id=? AND intent_hash=?').run(stable(result), requestId, intent);
    requireThat(changed.changes === 1, 'REQUEST_CONFLICT', '执行意图记录已变化', 1);
  }
  event(kind: string, document: unknown, taskId: string | null = null, runId: string | null = null): string {
    const eventId = id('evt');
    this.db.prepare('INSERT INTO events VALUES (?,?,?,?,?,?)').run(eventId, taskId, runId, kind, stable(document), now());
    return eventId;
  }
  enqueue(runId: string, nodeKey: string, eventId: string) {
    const event = this.db.prepare('SELECT * FROM events WHERE id=?').get(eventId);
    requireThat(event, 'MISSING_EVENT', '投影缺少已提交事件', 1);
    this.db.prepare('INSERT INTO outbox(id,run_id,node_key,context,event_json) VALUES (?,?,?,?,?)').run(eventId, runId, nodeKey, this.context(runId), stable(event));
  }
  context(runId: string) { return this.config.id + '/' + runId; }
  pending(runId: string): Outbox[] { return this.db.prepare("SELECT * FROM outbox WHERE run_id=? AND status!='done' ORDER BY rowid").all(runId) as unknown as Outbox[]; }
  markOutbox(eventId: string, field: 'source_id' | 'evidence_id' | 'status', value: string) {
    this.db.prepare('UPDATE outbox SET ' + field + '=? WHERE id=?').run(value, eventId);
  }
  projection(planHash: string): { tree: string; fingerprint: string; task_id: string } | null {
    return this.db.prepare('SELECT tree,fingerprint,task_id FROM projections WHERE plan_hash=?').get(planHash) as { tree: string; fingerprint: string; task_id: string } | undefined ?? null;
  }
  saveProjection(planHash: string, tree: string, fingerprint: string, taskId: string) {
    this.db.prepare('INSERT INTO projections VALUES (?,?,?,?) ON CONFLICT(plan_hash) DO UPDATE SET tree=excluded.tree,fingerprint=excluded.fingerprint,task_id=excluded.task_id').run(planHash, tree, fingerprint, taskId);
  }
  async immutableFile(relative: string, bytes: Uint8Array): Promise<string> {
    const full = path.resolve(this.root, relative);
    requireThat(full.startsWith(this.root + path.sep), 'PATH_ESCAPE', '文件路径越出工作区', 1);
    await this.safeDirectory(path.relative(this.root, path.dirname(full)));
    const parent = await fs.realpath(path.dirname(full));
    requireThat(parent.startsWith(this.root + path.sep), 'PATH_ESCAPE', '链接目标越出工作区', 1);
    try { await fs.writeFile(full, bytes, { flag: 'wx' }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      requireThat(!(await fs.lstat(full)).isSymbolicLink() && bytesHash(await fs.readFile(full)) === bytesHash(bytes), 'IMMUTABLE_CONFLICT', '不可变文件已存在且内容不同', 1);
    }
    return full;
  }
  async safeDirectory(relative: string): Promise<string> {
    const target = path.resolve(this.root, relative);
    requireThat(target === this.root || target.startsWith(this.root + path.sep), 'PATH_ESCAPE', '目录越出工作区', 1);
    let cursor = this.root;
    for (const part of path.relative(this.root, target).split(path.sep).filter(Boolean)) {
      cursor = path.join(cursor, part);
      try { await fs.mkdir(cursor); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      const stat = await fs.lstat(cursor);
      requireThat(stat.isDirectory() && !stat.isSymbolicLink(), 'PATH_ESCAPE', '目录不能经链接落到其他位置', 1);
    }
    return target;
  }
  async object(bytes: Uint8Array): Promise<string> {
    const sha = bytesHash(bytes);
    return this.immutableFile(path.join('objects/sha256', sha.slice(0, 2), sha), bytes);
  }
  async assetBytes(assetId: string): Promise<Buffer> {
    const asset = this.get<Asset>('asset', assetId).data;
    const full = path.resolve(this.root, asset.object_path);
    requireThat(full.startsWith(path.join(this.root, 'objects') + path.sep), 'ASSET_PATH', '素材不在对象库', 1);
    const canonical = await fs.realpath(full);
    requireThat(canonical.startsWith(path.join(this.root, 'objects') + path.sep), 'ASSET_PATH', '素材链接越出对象库', 1);
    const bytes = await fs.readFile(canonical);
    requireThat(bytesHash(bytes) === asset.sha256, 'ASSET_CORRUPTED', '素材 hash 不匹配', 1);
    return bytes;
  }
}
