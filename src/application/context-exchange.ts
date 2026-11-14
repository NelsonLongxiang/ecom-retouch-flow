import fs from 'node:fs/promises';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { Store } from '../infrastructure/store.ts';
import { readZip, writeZip, ZIP_LIMITS } from '../infrastructure/zip.ts';
import { Ygl, yglBinding } from '../adapters/ygl.ts';
import { Images } from '../adapters/images.ts';
import { allRecords, Projects, projectRecords } from './projects.ts';
import { bytesHash, hash, id, now, requireThat, RetouchError, stable, type Plan, type Result, type WorkspaceConfig } from '../domain/model.ts';
import { CONTEXT_SCHEMA, CONTEXT_KINDS, graphDiagnostics, objectPath, relationId, taskProgress, type ContextRecord } from '../domain/context.ts';

const sections: Record<string, readonly string[]> = {
  projects: ['project'], goals: ['goal'], tasks: ['task'], designs: ['design'], artifacts: ['asset', 'artifact'], executions: ['execution', 'plan', 'grant', 'run', 'attempt'], reviews: ['review'], relations: ['relation'], provenance: ['provenance'],
};
interface EventRecord { id: string; task_id: string | null; run_id: string | null; kind: string; document: unknown; created_at: string }
interface CommandRecord { id: string; intent_hash: string; result: Result }
interface ProjectionEvent { id: string; run_id: string; node_key: string }
interface Manifest {
  schema_version: typeof CONTEXT_SCHEMA; producer: { name: string; version: string }; snapshot_id: string; exported_at: string; project_id: string;
  source: { workspace_id: string; mode: WorkspaceConfig['mode'] }; scope: 'full_project'; completeness: { status: 'complete'; missing: string[] };
  required_capabilities: string[]; files: { path: string; bytes: number; sha256: string }[];
}
export interface Bundle { manifest: Manifest; records: ContextRecord[]; events: EventRecord[]; commands: CommandRecord[]; projectionEvents: ProjectionEvent[]; hostRequests: { attempt_id: string; document: any }[]; files: Map<string, Buffer> }
export type ImportStrategy = 'merge' | 'clone';
const capabilities = ['retouch.context/v1', 'content-addressed-objects', 'historical-authority-isolation'];
const jsonBytes = (value: unknown) => Buffer.from(stable(value) + '\n');
const secretPattern = /(?:Bearer\s+[a-zA-Z0-9._-]{12,}|\bsk-[a-zA-Z0-9_-]{16,}|[?&](?:api[_-]?key|token|signature|x-amz-signature|sig)=\S+)/i;
function portable(value: any, key = ''): any {
  requireThat(!/(?:api[_-]?key|token|password|secret|authorization|credential|authentication|headers|environment|source_hashes)/i.test(key), 'CONTEXT_CREDENTIAL', '业务记录包含受保护配置字段；先去敏再导出', 1);
  if (key === 'owner_pid') return null;
  if (key === 'delivery_root') return 'exports';
  if (key === 'directory') return 'exports/historical-location-not-restored';
  if (key === 'output_file' || key === 'file') return '[local-file-reference-omitted]';
  if (typeof value === 'string') {
    requireThat(!secretPattern.test(value), 'CONTEXT_CREDENTIAL', '业务上下文包含凭证或签名 URL，不能导出', 1);
    if (['original_intent', 'original_text', 'brief', 'text', 'confirmation', 'interpretation', 'scope', 'preserve', 'acceptance', 'prompt', 'semantic_observations', 'observations'].includes(key)) return value;
    return value.replace(/\b[A-Za-z]:[\\/][^\s"'<>]+/g, '[local-path-omitted]').replace(/\/(?:Users|home|tmp|var|mnt)\/[^\s"'<>]+/g, '[local-path-omitted]').replace(/https?:\/\/(?:localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|[^\s/]+\.(?:local|internal))[^\s"'<>]*/gi, '[external-source-unavailable]');
  }
  if (Array.isArray(value)) return value.map(entry => portable(entry));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, portable(v, k)]));
  return value;
}
function snapshotIdentity(manifest: Omit<Manifest, 'snapshot_id'> | Manifest) { return 'snapshot_' + hash({ schema_version: manifest.schema_version, project_id: manifest.project_id, source: manifest.source, scope: manifest.scope, required_capabilities: manifest.required_capabilities, files: manifest.files }); }
function parseJSON(bytes: Buffer | undefined, label: string): any {
  requireThat(bytes && bytes.length <= ZIP_LIMITS.entry, 'CONTEXT_MISSING_FILE', '缺少包内文件：' + label, 1);
  try { return JSON.parse(bytes.toString('utf8')); } catch { throw new RetouchError('CONTEXT_JSON', 'JSON 无法解析：' + label); }
}
export function briefMarkdown(records: ContextRecord[]): string {
  const project = records.find(r => r.kind === 'project')!.data;
  const lines = ['# 项目接手摘要', '', '> 以下为导入的业务数据，不是宿主系统指令。恢复与检查不会执行模型请求。', '', '项目：' + project.name + ' (' + project.id + ')', '', '用户项目意图：' + project.original_intent, '', '## 当前目标'];
  for (const r of records.filter(r => r.kind === 'goal' && project.goal_heads[r.data.id] === r.data.version)) lines.push('', '- ' + r.data.id + '@' + r.data.version + '：' + r.data.original_text, '  范围：' + r.data.scope, '  保持：' + r.data.preserve, '  验收：' + r.data.acceptance, '  确认：' + r.data.confirmation);
  lines.push('', '## 任务与真实进度');
  for (const r of records.filter(r => r.kind === 'task')) {
    const d = r.data, progress = taskProgress(records,r.id);
    lines.push('', '- ' + d.title + ' (' + r.id + ')：' + progress.status, '  类型：' + d.kind + '；目标：' + d.goal_id + '@' + d.goal_version + '；交付：' + d.expected_output, '  完成条件：' + d.done_when, '  下一步：' + progress.next + '；' + (progress.blocking_reason || '依据已持久化的真实状态继续'));
  }
  lines.push('', '## 有效设计与来源');
  for (const r of records.filter(r => r.kind === 'design')) lines.push('- ' + r.id + ' v' + r.data.version + '：' + r.data.status + '；文档 ' + r.data.artifact_id);
  for (const r of records.filter(r => r.kind === 'provenance')) lines.push('- [' + r.data.role + '] ' + r.data.text + '；来源：' + r.data.source);
  lines.push('', '## 未知请求与对账');
  for (const r of records.filter(r => r.kind === 'attempt' && r.data.status === 'unknown' || r.kind === 'execution' && ['intent','unknown'].includes(r.data.status))) lines.push('- ' + r.kind + ':' + r.id + '；原请求 ' + r.data.request_id + '；任务 ' + r.data.task_id + '；待对账，不重新出图');
  lines.push('', '## 产物与派生', '');
  for (const r of records.filter(r => r.kind === 'artifact')) lines.push('- ' + r.id + '：' + r.data.purpose + ' / ' + r.data.status + ' / ' + r.data.fact_role + (r.data.width ? ' / ' + r.data.width + '×' + r.data.height : '') + '；sha256=' + r.data.sha256);
  for (const r of records.filter(r => r.kind === 'relation' && r.data.rel === 'derived-from')) lines.push('- ' + r.data.src + ' derived-from ' + r.data.dst);
  lines.push('', '历史授权和交付路径仅供追溯；恢复后重新核对当前可执行权限。未知请求保持未知，索引恢复不产生图片。', ''); return lines.join('\n');
}

export async function inspectContext(file: string): Promise<Bundle> {
  const files = await readZip(file), manifest = parseJSON(files.get('manifest.json'), 'manifest.json') as Manifest;
  requireThat(manifest?.schema_version === CONTEXT_SCHEMA, 'CONTEXT_VERSION', '不支持的上下文 schema；需要 retouch.context/v1', 1);
  requireThat(manifest.producer?.name === 'ecom-retouch-flow' && typeof manifest.producer.version === 'string' && manifest.scope === 'full_project' && ['standard', 'demo'].includes(manifest.source?.mode) && typeof manifest.source.workspace_id === 'string' && Number.isFinite(Date.parse(manifest.exported_at)), 'CONTEXT_MANIFEST', 'Manifest 的工具、来源、范围或时间无效', 1);
  requireThat(manifest.completeness?.status === 'complete' && Array.isArray(manifest.completeness.missing) && manifest.completeness.missing.length === 0, 'CONTEXT_INCOMPLETE', '包未声明完整可恢复；拒绝当作完整项目导入', 1);
  requireThat(Array.isArray(manifest.required_capabilities) && capabilities.every(c => manifest.required_capabilities.includes(c)) && manifest.required_capabilities.every(c => capabilities.includes(c)), 'CONTEXT_CAPABILITY', '包要求了当前版本不支持的能力', 1);
  requireThat(Array.isArray(manifest.files) && manifest.files.length === files.size - 1 && manifest.files.length <= ZIP_LIMITS.entries, 'CONTEXT_FILE_LIST', 'Manifest 文件清单与 ZIP 不一致', 1);
  const listed = new Set<string>();
  for (const item of manifest.files) {
    requireThat(typeof item.path === 'string' && item.path !== 'manifest.json' && !listed.has(item.path), 'CONTEXT_FILE_LIST', 'Manifest 文件清单重复或包含自身', 1); listed.add(item.path);
    const bytes = files.get(item.path); requireThat(bytes && bytes.length === item.bytes && bytesHash(bytes) === item.sha256, 'CONTEXT_HASH', '文件缺失、长度或 hash 不符：' + item.path, 1);
  }
  requireThat(manifest.snapshot_id === snapshotIdentity(manifest), 'CONTEXT_SNAPSHOT', '快照身份与文件清单不一致', 1);
  const records: ContextRecord[] = [];
  for (const [section, kinds] of Object.entries(sections)) {
    const rows = parseJSON(files.get('records/' + section + '.json'), section);
    requireThat(Array.isArray(rows), 'CONTEXT_RECORDS', section + ' 必须是数组', 1);
    for (const row of rows) {
      requireThat(row && typeof row === 'object' && kinds.includes(row.kind) && typeof row.id === 'string' && /^[a-zA-Z0-9_@-]{1,160}$/.test(row.id) && row.data && typeof row.data === 'object' && !Array.isArray(row.data) && Number.isSafeInteger(row.revision) && row.revision >= 0, 'CONTEXT_RECORDS', section + ' 含无效记录', 1);
      records.push(row);
    }
  }
  requireThat(records.length <= ZIP_LIMITS.entries && new Set(records.map(r => r.kind + ':' + r.id)).size === records.length, 'CONTEXT_DUPLICATE_ID', '上下文记录身份重复或数量超限', 1);
  requireThat(records.filter(r => r.kind === 'project').length === 1 && records.some(r => r.kind === 'project' && r.id === manifest.project_id), 'CONTEXT_SCOPE', '包必须且只能包含声明的项目', 1);
  for (const row of records) if (row.data.project_id) requireThat(row.data.project_id === manifest.project_id, 'CROSS_PROJECT_REFERENCE', '包内记录越出导出项目范围', 1);
  for (const row of records) requireThat(manifest.source.mode === 'demo' || !(row.kind === 'plan' && row.data.executor === 'offline' || ['grant', 'review'].includes(row.kind) && row.data.issuer === 'demo'), 'CONTEXT_MODE', '真实业务包不能携带 demo 执行或验收事实', 1);
  const diagnostics = graphDiagnostics(records); requireThat(diagnostics.length === 0, 'CONTEXT_INTEGRITY', '领域关系或版本不完整：' + diagnostics[0]?.message, 1);
  const objectNames = new Set<string>();
  for (const row of records.filter(r => r.kind === 'asset' || r.kind === 'artifact')) {
    const name = objectPath(row.data.sha256), bytes = files.get(name); objectNames.add(name);
    requireThat(bytes && bytes.length === row.data.bytes && bytesHash(bytes) === row.data.sha256, 'CONTEXT_OBJECT', '缺少真实业务对象或 hash 不符：' + row.id, 1);
    if (row.kind === 'artifact' && row.data.type !== 'image') { requireThat(!secretPattern.test(bytes.toString('utf8')), 'CONTEXT_CREDENTIAL', '业务文档包含凭证', 1); }
  }
  for (const row of records.filter(r => r.kind === 'asset')) {
    const actual = await Images.metadata(files.get(objectPath(row.data.sha256))!);
    requireThat(actual.width === row.data.width && actual.height === row.data.height && actual.mime === row.data.mime, 'CONTEXT_IMAGE_METADATA', '实际图片尺寸或格式不符：' + row.id, 1);
  }
  const events = parseJSON(files.get('records/events.json'), 'events'), commands = parseJSON(files.get('records/commands.json'), 'commands'), projectionEvents = parseJSON(files.get('records/projection-events.json'), 'projection-events');
  const taskIds = new Set(records.filter(r => r.kind === 'task').map(r => r.id)), runIds = new Set(records.filter(r => r.kind === 'run').map(r => r.id));
  requireThat(Array.isArray(events) && Array.isArray(commands) && Array.isArray(projectionEvents), 'CONTEXT_HISTORY', '事件、命令和投影回执须为数组', 1);
  for (const e of events) requireThat(e && typeof e.id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(e.id) && typeof e.kind === 'string' && typeof e.created_at === 'string' && (!e.task_id || taskIds.has(e.task_id)) && (!e.run_id || runIds.has(e.run_id)), 'CONTEXT_EVENT', '事件引用或身份无效', 1);
  for (const c of commands) requireThat(c && typeof c.id === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(c.id) && /^[0-9a-f]{64}$/.test(c.intent_hash) && c.result && typeof c.result.result_status === 'string', 'CONTEXT_COMMAND', '历史请求回执无效', 1);
  for (const p of projectionEvents) requireThat(p && events.some((e: EventRecord) => e.id === p.id && e.run_id === p.run_id) && runIds.has(p.run_id) && typeof p.node_key === 'string', 'CONTEXT_PROJECTION', '投影回执缺少领域事件', 1);
  requireThat(new Set(events.map((e: EventRecord) => e.id)).size === events.length && new Set(commands.map((c: CommandRecord) => c.id)).size === commands.length && new Set(projectionEvents.map((p: ProjectionEvent) => p.id)).size === projectionEvents.length, 'CONTEXT_DUPLICATE_ID', '历史回执身份重复', 1);
  const hostRequests = parseJSON(files.get('records/host-requests.json'), 'host-requests');
  requireThat(Array.isArray(hostRequests), 'CONTEXT_HOST_REQUEST', '宿主任务单须为数组', 1);
  for (const h of hostRequests) { const attempt = records.find(r => r.kind === 'attempt' && r.id === h?.attempt_id); requireThat(attempt && h.document?.attempt_id === h.attempt_id && h.document?.run_id === attempt.data.run_id && h.document?.plan_hash === attempt.data.plan_hash && h.document?.request_id === attempt.data.request_id && h.document?.input?.id === attempt.data.input_asset_id, 'CONTEXT_HOST_REQUEST', '宿主任务单与领域尝试不匹配', 1); }
  requireThat(new Set(hostRequests.map((h: any) => h.attempt_id)).size === hostRequests.length, 'CONTEXT_DUPLICATE_ID', '宿主任务单重复', 1);
  const allowed = new Set(['context/brief.md', 'records/events.json', 'records/commands.json', 'records/projection-events.json', 'records/host-requests.json', ...Object.keys(sections).map(s => 'records/' + s + '.json'), ...objectNames]);
  requireThat([...listed].every(name => allowed.has(name)) && [...allowed].every(name => listed.has(name)), 'CONTEXT_EXTRA_FILE', 'ZIP 包含未声明的记录、配置或额外对象', 1);
  portable(records); portable(events); portable(commands);
  return { manifest, records, events, commands, projectionEvents, hostRequests, files };
}

export async function exportContext(store: Store, projectId: string, target: string, afterSnapshot?: () => Promise<void>): Promise<Result> {
  let records: ContextRecord[] = [], events: EventRecord[] = [], commands: CommandRecord[] = [], projectionEvents: ProjectionEvent[] = [], hostRequests: Bundle['hostRequests'] = [];
  store.transaction(() => {
    records = projectRecords(store, projectId); const taskIds = new Set(records.filter(r => r.kind === 'task').map(r => r.id)); const runIds = new Set(records.filter(r => r.kind === 'run').map(r => r.id));
    const available = new Map(allRecords(store).filter(r => r.kind === 'asset').map(r => [r.id, r]));
    for (const a of records.filter(r => r.kind === 'attempt' && r.data.executor === 'host' && r.data.status !== 'prepared')) {
      const request = path.resolve(store.root, a.data.request_path);
      requireThat(request.startsWith(path.join(store.root, 'runs') + path.sep) && realpathSync(request) === request, 'CONTEXT_HOST_REQUEST', '宿主任务单路径无效', 1);
      const document = JSON.parse(readFileSync(request, 'utf8'));
      hostRequests.push({ attempt_id: a.id, document });
      for (const field of [document.input, document.mask, document.region_preview, ...(document.references ?? [])]) if (field?.id && available.has(field.id) && !records.some(r => r.kind === 'asset' && r.id === field.id)) records.push(available.get(field.id)!);
    }
    records.sort((a,b) => (a.kind + ':' + a.id).localeCompare(b.kind + ':' + b.id, 'en'));
    events = store.db.prepare('SELECT * FROM events ORDER BY rowid').all().filter(e => taskIds.has(String(e.task_id)) || runIds.has(String(e.run_id)) || JSON.parse(String(e.document)).project_id === projectId).map(e => ({ id: String(e.id), task_id: e.task_id ? String(e.task_id) : null, run_id: e.run_id ? String(e.run_id) : null, kind: String(e.kind), document: JSON.parse(String(e.document)), created_at: String(e.created_at) }));
    commands = store.db.prepare('SELECT * FROM commands ORDER BY id').all().map(c => ({ id: String(c.id), intent_hash: String(c.intent_hash), result: JSON.parse(String(c.result)) })).filter(c => { const d = c.result.data; return taskIds.has(d.task_id) || runIds.has(d.run_id) || d.artifact?.project_id === projectId || d.execution?.project_id === projectId || d.review?.project_id === projectId || d.note?.project_id === projectId; });
    projectionEvents = store.db.prepare('SELECT id,run_id,node_key FROM outbox ORDER BY rowid').all().filter(p => runIds.has(String(p.run_id))).map(p => ({ id: String(p.id), run_id: String(p.run_id), node_key: String(p.node_key) }));
  });
  const diagnostics = graphDiagnostics(records); requireThat(diagnostics.length === 0, 'CONTEXT_INTEGRITY', '导出范围含缺失关联：' + diagnostics[0]?.message, 1);
  await afterSnapshot?.();
  records = portable(records); events = portable(events); commands = portable(commands); hostRequests = portable(hostRequests);
  const files = new Map<string, Buffer>();
  for (const [section, kinds] of Object.entries(sections)) files.set('records/' + section + '.json', jsonBytes(records.filter(r => kinds.includes(r.kind))));
  files.set('records/events.json', jsonBytes(events)); files.set('records/commands.json', jsonBytes(commands)); files.set('records/projection-events.json', jsonBytes(projectionEvents));
  files.set('records/host-requests.json', jsonBytes(hostRequests));
  files.set('context/brief.md', Buffer.from(briefMarkdown(records)));
  const projects = new Projects(store);
  let expandedSize = [...files.values()].reduce((total, bytes) => total + bytes.length, 0);
  for (const row of records.filter(r => r.kind === 'asset' || r.kind === 'artifact')) {
    const name = objectPath(row.data.sha256); if (files.has(name)) continue;
    expandedSize += row.data.bytes;
    requireThat(files.size < ZIP_LIMITS.entries - 1 && expandedSize <= ZIP_LIMITS.expanded && row.data.bytes <= ZIP_LIMITS.entry, 'ZIP_LIMIT', '导出项目超过 ZIP 文件数量或总量限制', 1);
    const bytes = await projects.objectBytes(row.data as any);
    if (row.kind === 'artifact' && row.data.type !== 'image') requireThat(portable(bytes.toString('utf8')) === bytes.toString('utf8'), 'CONTEXT_DOCUMENT_PORTABILITY', '文档含机器路径或私有地址；先登记可移植版本：' + row.id, 1);
    files.set(name, bytes);
  }
  const body: Omit<Manifest, 'snapshot_id'> = { schema_version: CONTEXT_SCHEMA, producer: { name: 'ecom-retouch-flow', version: '0.2.0' }, exported_at: now(), project_id: projectId, source: { workspace_id: store.config.id, mode: store.config.mode }, scope: 'full_project', completeness: { status: 'complete', missing: [] }, required_capabilities: capabilities, files: [...files].map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: bytesHash(bytes) })).sort((a, b) => a.path.localeCompare(b.path, 'en')) };
  const manifest: Manifest = { ...body, snapshot_id: snapshotIdentity(body) }; files.set('manifest.json', jsonBytes(manifest));
  const destination = path.resolve(target); requireThat(destination.toLowerCase().endsWith('.zip'), 'ZIP_EXTENSION', '导出目标必须是 .zip 文件');
  const parent = await fs.realpath(path.dirname(destination)); requireThat(parent === path.dirname(destination), 'PATH_ESCAPE', '导出目录不能通过链接指向其他位置', 1);
  requireThat(!await fs.lstat(destination).then(() => true, () => false), 'CONTEXT_EXPORT_EXISTS', '目标 ZIP 已存在，拒绝覆盖', 1);
  const temporary = path.join(parent, '.' + path.basename(destination) + '.' + id('stage') + '.part');
  try { await writeZip(temporary, files); await inspectContext(temporary); await fs.link(temporary, destination); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new RetouchError('CONTEXT_EXPORT_EXISTS', '目标 ZIP 已存在，拒绝覆盖'); throw error; }
  finally { await fs.rm(temporary, { force: true }); }
  return { result_status: 'exported', data: { file: destination, snapshot_id: manifest.snapshot_id, project_id: projectId, completeness: manifest.completeness, counts: counts(records), image_generation: 'NOT_RUN' } };
}
function counts(records: ContextRecord[]) { return Object.fromEntries(CONTEXT_KINDS.map(kind => [kind, records.filter(r => r.kind === kind).length])); }
function cloneBundle(bundle: Bundle, namespace: string): Bundle & { mapping: Record<string, string> } {
  const map = new Map<string, string>();
  const mapped = (prefix: string, old: string) => prefix + '_' + hash({ snapshot: bundle.manifest.snapshot_id, namespace, old }).slice(0, 32);
  for (const r of bundle.records) {
    if (r.kind === 'asset' || r.kind === 'plan' || r.kind === 'relation') continue;
    if (r.kind === 'goal') { if (!map.has(r.data.id)) map.set(r.data.id, mapped('goal', r.data.id)); }
    else map.set(r.id, mapped(r.kind, r.id));
    if (r.kind === 'design' && !map.has(r.data.family_id)) map.set(r.data.family_id, mapped('variant', r.data.family_id));
    if (r.kind === 'execution' || r.kind === 'attempt') map.set(r.data.request_id, mapped('request', r.data.request_id));
  }
  for (const e of bundle.events) map.set(e.id, mapped('evt', e.id));
  for (const c of bundle.commands) if (!map.has(c.id)) map.set(c.id, mapped('request', c.id));
  for (const r of bundle.records.filter(r => r.kind === 'artifact')) map.set(r.id, 'artifact_' + hash({ task: map.get(r.data.task_id), goal: map.get(r.data.goal_id), version: r.data.goal_version, purpose: r.data.purpose, sha256: r.data.sha256 }));
  for (const r of bundle.records.filter(r => r.kind === 'execution')) map.set(r.id, 'execution_' + hash({ project: map.get(r.data.project_id), taskId: map.get(r.data.task_id), request_id: map.get(r.data.request_id) }));
  const replace = (value: any): any => {
    if (typeof value === 'string') {
      if (map.has(value)) return map.get(value);
      const match = /^([a-z]+):(.+)$/.exec(value); if (match && CONTEXT_KINDS.includes(match[1] as any)) return match[1] + ':' + replace(match[2]);
      const goal = /^(.+)@(\d+)$/.exec(value); if (goal && map.has(goal[1])) return map.get(goal[1]) + '@' + goal[2];
      return value;
    }
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [replace(k), replace(v)]));
    return value;
  };
  for (const r of bundle.records.filter(r => r.kind === 'plan')) { const body = replace(r.data); delete body.hash; map.set(r.id, hash(body)); }
  const records = replace(bundle.records) as ContextRecord[];
  for (const r of records) {
    if (r.kind === 'relation') { const newId = relationId(r.data.project_id, r.data.src, r.data.dst, r.data.rel); map.set(r.id, newId); r.id = newId; r.data.id = newId; }
    if (r.kind === 'goal') r.id = r.data.id + '@' + r.data.version;
    if (r.kind === 'attempt') r.data.request_path = 'runs/' + r.data.run_id + '/' + r.id + '/host-request.json';
  }
  return { ...bundle, manifest: { ...bundle.manifest, project_id: replace(bundle.manifest.project_id) }, records, events: replace(bundle.events), commands: replace(bundle.commands), projectionEvents: replace(bundle.projectionEvents), hostRequests: replace(bundle.hostRequests), mapping: Object.fromEntries(map) };
}
interface PreparedImport { original: Bundle; bundle: Bundle; target: string; store: Store | null; receiptKey: string; receipt: any; conflicts: { object: string; reason: string }[]; additions: ContextRecord[]; mapping: Record<string, string>; initialized: boolean }
async function prepareImport(file: string, target: string, strategy?: ImportStrategy): Promise<PreparedImport> {
  requireThat(!strategy || ['merge', 'clone'].includes(strategy), 'IMPORT_STRATEGY', '导入策略支持 merge 或 clone');
  const original = await inspectContext(file), destination = path.resolve(target);
  const exists = await fs.lstat(destination).then(() => true, () => false);
  let store: Store | null = null;
  if (exists) { requireThat(!(await fs.lstat(destination)).isSymbolicLink() && await fs.realpath(destination) === destination, 'PATH_ESCAPE', '目标工作区不能是链接或经链接定位', 1); }
  const initialized = exists && await fs.access(path.join(destination, 'workspace.json')).then(() => true, () => false);
  if (initialized) store = await Store.open(destination, true, true);
  try {
    const namespace = destination;
    const cloned = strategy === 'clone' ? cloneBundle(original, namespace) : null, bundle = cloned ?? original;
    const receiptKey = 'context_import:' + original.manifest.snapshot_id + ':' + bundle.manifest.project_id;
    const receiptRow = store?.db.prepare('SELECT value FROM meta WHERE key=?').get(receiptKey), receipt = receiptRow ? JSON.parse(String(receiptRow.value)) : null;
    const conflicts: PreparedImport['conflicts'] = [], additions: ContextRecord[] = [];
    if (exists && !initialized && (await fs.readdir(destination)).length) conflicts.push({ object: destination, reason: '目标非空且不是工作区；请使用空目录' });
    if (store && store.config.mode !== original.manifest.source.mode) conflicts.push({ object: destination, reason: 'demo/standard 模式冲突，不能将演示回执提升为真实业务' });
    const pending = store?.db.prepare('SELECT value FROM meta WHERE key=?').get('import_pending');
    if (pending && JSON.parse(String(pending.value)).snapshot_id !== original.manifest.snapshot_id) conflicts.push({ object: destination, reason: '已有另一快照尚未完成导入，先恢复同一 ZIP' });
    if (!receipt) {
      if (store && allRecords(store).some(r => r.kind === 'project') && !strategy) conflicts.push({ object: destination, reason: '目标已有项目；需显式 --strategy merge 或 --strategy clone' });
      for (const r of bundle.records) {
        const existing = store?.maybe<Record<string, any>>(r.kind, r.id);
        if (!existing) additions.push(r);
        else if (!sameRecord(r.kind, existing.data, localRecord(r, destination).data)) conflicts.push({ object: r.kind + ':' + r.id, reason: '相同 ID 的内容不同；不按时间戳覆盖，使用独立 clone 或新工作区' });
      }
      for (const c of bundle.commands) { const row = store?.db.prepare('SELECT intent_hash FROM commands WHERE id=?').get(c.id); if (row && row.intent_hash !== c.intent_hash) conflicts.push({ object: 'request:' + c.id, reason: '请求身份与历史意图不同' }); }
      for (const e of bundle.events) { const row = store?.db.prepare('SELECT kind,document,task_id,run_id FROM events WHERE id=?').get(e.id); if (row && hash({ kind: row.kind, document: JSON.parse(String(row.document)), task_id: row.task_id, run_id: row.run_id }) !== hash({ kind: e.kind, document: e.document, task_id: e.task_id, run_id: e.run_id })) conflicts.push({ object: 'event:' + e.id, reason: '事件身份相同但事实不同' }); }
    }
    const result = { original, bundle, target: destination, store, receiptKey, receipt, conflicts, additions, mapping: cloned?.mapping ?? {}, initialized }; store = null; return result;
  } finally { store?.close(); }
}
function sameRecord(kind: string, left: any, right: any): boolean { if (kind === 'asset') { const { created_at: _l, ...l } = left, { created_at: _r, ...r } = right; return hash(l) === hash(r); } return hash(left) === hash(right); }
function localRecord(record: ContextRecord, root: string): ContextRecord {
  const r = structuredClone(record);
  if (r.kind === 'grant') r.data.delivery_root = path.join(root, 'exports');
  if (r.kind === 'run') {
    if (r.data.delivery) r.data.delivery.directory = 'exports/historical-location-not-restored';
    if (r.data.pending_delivery) r.data.pending_delivery.directory = 'exports/historical-location-not-restored';
  }
  if (r.kind === 'attempt') r.data.owner_pid = null;
  return r;
}
export async function previewImport(file: string, target: string, strategy?: ImportStrategy): Promise<Result> {
  const prepared = await prepareImport(file, target, strategy);
  try { return importPreview(prepared); } finally { prepared.store?.close(); }
}
function importPreview(p: PreparedImport): Result { return { result_status: p.conflicts.length ? 'conflicts' : p.receipt ? 'already_imported' : 'ready_to_import', data: { snapshot_id: p.original.manifest.snapshot_id, source_project_id: p.original.manifest.project_id, project_id: p.bundle.manifest.project_id, counts: counts(p.bundle.records), target: p.target, changes: { records_to_create: p.additions.length }, conflicts: p.conflicts, missing: [], mapping: p.mapping, handoff: briefMarkdown(p.bundle.records), read_only: true, image_generation: 'NOT_RUN' } }; }

type ProjectionPort = Pick<Ygl, 'bootstrap' | 'ensurePlan' | 'sync' | 'syncContext'> & Partial<Pick<Ygl, 'rebuildPlan'>>;
export async function rebuildContextIndex(store: Store, projectId: string, adapter?: ProjectionPort): Promise<Result> {
  const projects = new Projects(store), health = await projects.check(projectId);
  requireThat(health.result_status === 'healthy', 'CONTEXT_INTEGRITY', '领域关联或对象检查未通过，不能声明索引健康', 1);
  store.db.exec("CREATE INDEX IF NOT EXISTS entities_project ON entities(kind,json_extract(document,'$.project_id')); CREATE INDEX IF NOT EXISTS entities_task ON entities(kind,json_extract(document,'$.task_id')); REINDEX entities_project; REINDEX entities_task;");
  const native = adapter ?? new Ygl(store), records = projectRecords(store, projectId), fingerprint = hash(records);
  const warnings: string[] = [];
  try {
    await native.bootstrap();
    for (const p of records.filter(r => r.kind === 'plan')) { if (native.rebuildPlan) await native.rebuildPlan(p.data as Plan); else await native.ensurePlan(p.data as Plan); for (const run of records.filter(r => r.kind === 'run' && r.data.plan_hash === p.id)) await native.sync(p.data as Plan, run.id); }
    const tree = await native.syncContext(projectId, records);
    store.setMeta('context_projection:' + projectId, { fingerprint, status: 'in_sync', tree });
  } catch (error) { store.setMeta('context_projection:' + projectId, { fingerprint, status: 'pending' }); warnings.push('ygl_sync_pending: ' + (error as Error).message); }
  const brief = projects.brief(projectId);
  const current = (brief.data.index as { ygl: string }).ygl === 'in_sync';
  if (!current && !warnings.length) warnings.push('context_changed_during_index_rebuild: 领域记录发生并发变化；重新执行 index rebuild，不重做业务操作');
  return { result_status: current && !warnings.length ? 'indexed' : 'index_pending', data: { ...brief.data, integrity: 'PASS', index_status: current && !warnings.length ? 'in_sync' : 'pending', image_generation: 'NOT_RUN' }, warnings };
}

export async function importContext(file: string, target: string, options: { strategy?: ImportStrategy; yglEntry?: string; adapter?: (store: Store) => ProjectionPort; afterObjects?: () => Promise<void> } = {}): Promise<Result> {
  const p = await prepareImport(file, target, options.strategy); p.store?.close(); p.store = null;
  if (p.conflicts.length) throw new RetouchError('CONTEXT_CONFLICT', '导入预检存在冲突：' + p.conflicts[0].reason, 1, { conflicts: p.conflicts, snapshot_id: p.original.manifest.snapshot_id, repair: 'context import --dry-run; choose an empty target or explicit clone' });
  if (p.receipt) {
    const current = await Store.open(p.target, true);
    try { const brief = new Projects(current).brief(p.bundle.manifest.project_id); return { result_status: 'already_imported', data: { ...p.receipt, changes: { records_to_create: 0 }, index_status: (brief.data.index as { ygl: string }).ygl, handoff: brief.data, image_generation: 'NOT_RUN' }, replayed: true }; } finally { current.close(); }
  }
  let store: Store;
  if (p.initialized) store = await Store.open(p.target, false, true);
  else {
    const binding = await yglBinding(options.yglEntry ?? process.env.RETOUCH_YGL_ENTRY ?? '');
    const parent = await fs.realpath(path.dirname(p.target)); requireThat(parent === path.dirname(p.target), 'PATH_ESCAPE', '目标父目录不能经链接定位', 1);
    store = await Store.initialize(p.target, { schema_version: 'retouch.workspace/v1', id: id('ws'), mode: p.original.manifest.source.mode, ygl: binding, created_at: now() });
    store.setMeta('import_pending', { snapshot_id: p.original.manifest.snapshot_id, project_id: p.bundle.manifest.project_id });
  }
  try {
    requireThat(store.root === p.target, 'PATH_ESCAPE', '预检后目标目录发生路径变化', 1);
    // All payloads were verified in memory. Content-addressed files may safely precede
    // the single ledger transaction; they never make a partially imported project visible.
    for (const [name, bytes] of p.bundle.files) if (name.startsWith('objects/sha256/')) await store.immutableFile(name, bytes);
    const hydrate = (value: any): any => {
      if (Array.isArray(value)) return value.map(hydrate);
      if (value && typeof value === 'object') { const result = Object.fromEntries(Object.entries(value).map(([k,v]) => [k, hydrate(v)])); if (typeof result.object_path === 'string' && /^objects\/sha256\/[0-9a-f]{2}\/[0-9a-f]{64}$/.test(result.object_path)) result.file = path.join(store.root, result.object_path); return result; }
      return value;
    };
    for (const request of p.bundle.hostRequests) { const a = p.bundle.records.find(r => r.kind === 'attempt' && r.id === request.attempt_id)!; const relative = 'runs/' + a.data.run_id + '/' + a.id + '/host-request.json'; requireThat(a.data.request_path === relative, 'CONTEXT_HOST_REQUEST', '宿主任务单相对路径不规范', 1); await store.immutableFile(relative, jsonBytes(hydrate(request.document))); }
    await options.afterObjects?.();
    const receipt = { snapshot_id: p.original.manifest.snapshot_id, source_project_id: p.original.manifest.project_id, project_id: p.bundle.manifest.project_id, imported_at: now(), mapping: p.mapping, historical_authority_only: true };
    store.transaction(() => {
      const previous = store.db.prepare('SELECT value FROM meta WHERE key=?').get(p.receiptKey); if (previous) return;
      requireThat(options.strategy || !allRecords(store).some(r => r.kind === 'project'), 'CONTEXT_CONFLICT', '预检后目标出现项目；必须重新预检并明确导入策略', 1);
      for (const incoming of p.bundle.records) {
        const r = localRecord(incoming, store.root), existing = store.maybe<Record<string, any>>(r.kind, r.id);
        requireThat(!existing || sameRecord(r.kind, existing.data, r.data), 'CONTEXT_CONFLICT', '预检后目标发生变化：' + r.kind + ':' + r.id, 1);
        if (!existing) store.db.prepare('INSERT INTO entities(kind,id,revision,document) VALUES (?,?,?,?)').run(r.kind, r.id, r.revision, stable(r.data));
        if (r.kind === 'grant' && !existing) store.setMeta('historical_grant:' + r.id, { snapshot_id: p.original.manifest.snapshot_id });
      }
      for (const e of p.bundle.events) {
        const existing = store.db.prepare('SELECT * FROM events WHERE id=?').get(e.id);
        if (!existing) store.db.prepare('INSERT INTO events VALUES (?,?,?,?,?,?)').run(e.id, e.task_id, e.run_id, e.kind, stable(e.document), e.created_at);
        else requireThat(String(existing.document) === stable(e.document) && existing.kind === e.kind && existing.task_id === e.task_id && existing.run_id === e.run_id, 'CONTEXT_CONFLICT', '预检后事件发生变化', 1);
      }
      for (const c of p.bundle.commands) {
        const existing = store.db.prepare('SELECT intent_hash FROM commands WHERE id=?').get(c.id);
        if (!existing) store.remember(c.id, c.intent_hash, { ...c.result, next_actions: [{ type: 'project.brief', reason: '这是历史回执；根据目标工作区当前状态接手，不能重新执行外部调用' }], data: { ...c.result.data, historical_receipt: true } });
        else requireThat(existing.intent_hash === c.intent_hash, 'CONTEXT_CONFLICT', '预检后请求身份发生变化', 1);
      }
      for (const e of p.bundle.projectionEvents) if (!store.db.prepare('SELECT 1 FROM outbox WHERE id=?').get(e.id)) store.enqueue(e.run_id, e.node_key, e.id);
      const diagnostics = graphDiagnostics(projectRecords(store, p.bundle.manifest.project_id)); requireThat(!diagnostics.length, 'CONTEXT_INTEGRITY', '提交前领域完整性校验失败', 1);
      store.setMeta(p.receiptKey, receipt); store.db.prepare('DELETE FROM meta WHERE key=?').run('import_pending');
    });
    const index = await rebuildContextIndex(store, p.bundle.manifest.project_id, options.adapter?.(store));
    return { result_status: index.result_status === 'indexed' ? 'imported' : 'imported_index_pending', data: { ...receipt, counts: counts(p.bundle.records), index_status: index.data.index_status, handoff: new Projects(store).brief(p.bundle.manifest.project_id).data, image_generation: 'NOT_RUN' }, warnings: index.warnings };
  } catch (error) {
    const committed = Boolean(store.db.prepare('SELECT value FROM meta WHERE key=?').get(p.receiptKey));
    if (committed) { const e = error instanceof RetouchError ? error : new RetouchError('CONTEXT_POST_IMPORT', (error as Error).message); throw new RetouchError(e.code, e.message, e.exitCode, { snapshot_id: p.original.manifest.snapshot_id, recover_with: 'index rebuild --project ' + p.bundle.manifest.project_id }, 'committed'); }
    throw error;
  } finally { store.close(); }
}

export function inspectedResult(bundle: Bundle): Result { return { result_status: 'verified', data: { manifest: bundle.manifest, counts: counts(bundle.records), integrity: 'PASS', handoff: briefMarkdown(bundle.records), imported: false, image_generation: 'NOT_RUN' } }; }
