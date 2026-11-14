import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { bytesHash, hash, requireThat, RetouchError, stable, type Plan, type YglBinding } from '../domain/model.ts';
import type { Store } from '../infrastructure/store.ts';

const invoke = promisify(execFile);
export interface Graph { nodes: { key: string; payload: unknown }[]; edges: { parent: string; child: string }[] }
export function planGraph(plan: Plan): Graph {
  const nodes: Graph['nodes'] = ['input', 'grant', 'accept', 'deliver'].map((key) => ({ key, payload: { plan_hash: plan.hash, role: key } }));
  const edges = [{ parent: 'input', child: 'grant' }, { parent: 'accept', child: 'deliver' }];
  for (const step of plan.steps) {
    nodes.push({ key: 'edit-' + step.id, payload: { plan_hash: plan.hash, role: 'image.edit', step_id: step.id } });
    nodes.push({ key: 'qa-' + step.id, payload: { plan_hash: plan.hash, role: 'quality.review', step_id: step.id } });
    edges.push({ parent: 'grant', child: 'edit-' + step.id }, { parent: 'edit-' + step.id, child: 'qa-' + step.id });
    for (const parent of step.needs) edges.push({ parent: 'qa-' + parent, child: 'edit-' + step.id });
  }
  edges.push({ parent: 'qa-' + plan.steps.at(-1)!.id, child: 'accept' });
  return { nodes, edges };
}
function fingerprint(exported: any): string {
  requireThat(Array.isArray(exported.nodes) && Array.isArray(exported.edges) && Array.isArray(exported.conditions) && exported.index && typeof exported.index.dirty === 'boolean', 'YGL_SCHEMA', 'ygl 图输出不符合约定', 1);
  requireThat(exported.index.dirty === false, 'YGL_GRAPH_CONFLICT', '冻结图的索引已脏，停止新的执行', 1);
  return hash({ nodes: exported.nodes.map((node: any) => ({ key: node.key, payload: node.payload, kind: node.kind, tier: node.tier, cost: node.cost, cost_unit: node.cost_unit })).sort((a: any, b: any) => a.key.localeCompare(b.key)),
    edges: exported.edges.map((edge: any) => ({ parent: edge.parent, child: edge.child, rel: edge.rel, mode: edge.mode, required: edge.required, min_level: edge.min_level })).sort((a: any, b: any) => stable(a).localeCompare(stable(b))),
    conditions: exported.conditions.map((condition: any) => ({ node: condition.node, name: condition.name, kind: condition.kind, expr: condition.expr, op: condition.op, value: condition.value, required: condition.required, effect: condition.effect, weight: condition.weight })).sort((a: any, b: any) => stable(a).localeCompare(stable(b))) });
}
export async function yglBinding(entryFile: string): Promise<YglBinding> {
  const entry = await fs.realpath(entryFile).catch(() => { throw new RetouchError('YGL_NOT_FOUND', '指定的 ygl CLI 入口不存在'); });
  let directory = path.dirname(entry), info: { name?: string; version?: string } = {};
  for (let index = 0; index < 7; index++) {
    info = await fs.readFile(path.join(directory, 'package.json'), 'utf8').then(JSON.parse).catch(() => ({}));
    if (info.name === 'ygl-trees') break;
    directory = path.dirname(directory);
  }
  requireThat(info.name === 'ygl-trees' && info.version === '0.125.0', 'YGL_VERSION', '当前适配器要求已验证的 ygl-trees 0.125.0', 1);
  const source_hashes: Record<string, string> = {};
  for (const name of (await fs.readdir(path.dirname(entry))).filter((name) => name.endsWith('.cjs')).sort()) source_hashes[name] = bytesHash(await fs.readFile(path.join(path.dirname(entry), name)));
  requireThat(Object.keys(source_hashes).length > 1, 'YGL_BUNDLE', '请指定完整发布包的 dist/bundle/bin.cjs', 1);
  return { entry, version: info.version, source_hashes };
}
export class Ygl {
  store: Store;
  project: string;
  constructor(store: Store) { this.store = store; this.project = 'retouch-' + store.config.id; }
  async verifyBinding() {
    const binding = this.store.config.ygl;
    requireThat(hash(await yglBinding(binding.entry)) === hash(binding), 'YGL_VERSION_DRIFT', 'ygl 发布包已变化，需要显式重验适配', 1);
    const home = await fs.realpath(path.join(this.store.root, 'ygl'));
    requireThat(home === path.join(this.store.root, 'ygl'), 'YGL_HOME_ESCAPE', 'ygl home 不能指向工作区外部', 1);
  }
  async call(args: string[]): Promise<any> {
    const home = path.join(this.store.root, 'ygl');
    const env = { ...process.env, YGL_HOME: home, YGL_SESSION: 'retouch-' + this.store.config.id, YGL_EVAL_OFFLINE: '1', YGL_NO_UPDATE_CHECK: '1' };
    for (const name of Object.keys(env)) if (/API_KEY|TOKEN|PASSWORD|SECRET/i.test(name) || ['YGL_DB_URL', 'YGL_PG_URL', 'YGL_TREE', 'YGL_PROJECT', 'YGL_RUN_ID', 'DSH_SESSION_ID', 'YGL_TEST'].includes(name)) delete (env as Record<string, string | undefined>)[name];
    try {
      const { stdout } = await invoke(process.execPath, [this.store.config.ygl.entry, ...args, '--home', home, '--json'], { cwd: this.store.root, env, windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
      return JSON.parse(stdout);
    } catch (error) { throw new RetouchError('YGL_UNAVAILABLE', 'ygl 调用未完成；保留业务结果并等待同步', 1, { command: args.slice(0, 2), cause: (error as Error).message.slice(0, 250) }); }
  }
  node(tree: string, ...args: string[]) { return this.call(['node', ...args, '--tree', tree]); }
  async bootstrap() {
    await this.verifyBinding();
    await this.call(['db', 'init']);
    const project = await this.call(['project', 'new', this.project, '-q', 'Ecommerce retouch workflow projections; domain ledger is authoritative.']);
    requireThat(typeof project.id === 'string', 'YGL_SCHEMA', '缺少 ygl project id', 1);
  }
  async ensurePlan(plan: Plan): Promise<void> {
    await this.verifyBinding();
    const existing = this.store.projection(plan.hash);
    if (existing) { await this.checkPlan(plan); return; }
    const tree = 'rt-' + plan.hash.slice(0, 24), graph = planGraph(plan);
    await this.call(['tree', 'new', tree, '--project', this.project]);
    for (const node of graph.nodes) {
      await this.node(tree, 'add', node.key, '--name', node.key, '--payload', stable(node.payload));
      await this.node(tree, 'cond', 'add', node.key, '--name', 'domain_verified', '--kind', 'flag', '--op', '==', '--value', '1');
    }
    for (const edge of graph.edges) await this.node(tree, 'link', edge.parent, edge.child);
    await this.node(tree, 'index');
    const validated = await this.node(tree, 'validate');
    requireThat(Array.isArray(validated.issues) && validated.issues.length === 0, 'YGL_GRAPH_INVALID', 'ygl 图无效', 1);
    const snapshot = await this.node(tree, 'export');
    const expectedKeys = graph.nodes.map((node) => node.key).sort();
    requireThat(stable(snapshot.nodes.map((node: any) => node.key).sort()) === stable(expectedKeys), 'YGL_GRAPH_CONFLICT', '计划投影含额外或缺失节点', 1);
    requireThat(snapshot.edges.length === graph.edges.length && snapshot.conditions.length === graph.nodes.length, 'YGL_GRAPH_CONFLICT', '计划投影结构与模板不符', 1);
    this.store.transaction(() => { if (!this.store.projection(plan.hash)) this.store.saveProjection(plan.hash, tree, fingerprint(snapshot), plan.task_id); });
  }
  async checkPlan(plan: Plan) {
    await this.verifyBinding();
    const projection = this.store.projection(plan.hash);
    requireThat(projection, 'YGL_SYNC_PENDING', '计划尚未完成 ygl 投影', 1);
    const snapshot = await this.node(projection.tree, 'export');
    requireThat(fingerprint(snapshot) === projection.fingerprint, 'YGL_GRAPH_CONFLICT', '冻结图被改动，停止新的执行', 1);
  }
  async can(plan: Plan, runId: string, nodeKey: string): Promise<boolean> {
    const projection = this.store.projection(plan.hash);
    requireThat(projection, 'YGL_SYNC_PENDING', '缺少计划投影', 1);
    const result = await this.node(projection.tree, 'can', nodeKey, '--context', this.store.context(runId), '--state', 'domain_verified=1');
    requireThat(typeof result.ok === 'boolean', 'YGL_SCHEMA', '门禁结果缺少布尔 ok', 1);
    return result.ok;
  }
  async sync(plan: Plan, runId: string) {
    await this.checkPlan(plan);
    const tree = this.store.projection(plan.hash)!.tree;
    for (const row of this.store.pending(runId)) {
      if (!row.source_id) {
        const source = await this.call(['research', 'source', 'add', '--title', 'Retouch receipt ' + row.id, '--url', 'retouch://' + this.store.config.id + '/' + row.id, '--content', row.event_json, '--project', this.project]);
        requireThat(typeof source.id === 'string', 'YGL_SCHEMA', '缺少 source id', 1);
        row.source_id = source.id; this.store.markOutbox(row.id, 'source_id', source.id);
      }
      if (!row.evidence_id) {
        const quote = JSON.parse(row.event_json).kind;
        const evidence = await this.call(['research', 'evidence', 'add', row.source_id!, '--quote', quote, '--project', this.project]);
        requireThat(typeof evidence.id === 'string' && evidence.quote_verified === true, 'YGL_SCHEMA', '证据摘录未验证', 1);
        row.evidence_id = evidence.id; this.store.markOutbox(row.id, 'evidence_id', evidence.id);
      }
      await this.call(['rel', 'add', 'node:' + tree + '/' + row.node_key, 'evidence:' + row.evidence_id, '--rel', 'evidenced-by']);
      requireThat(await this.can(plan, runId, row.node_key), 'YGL_GATE_BLOCKED', '证据节点前置尚未满足', 1);
      const unlocked = await this.node(tree, 'unlock', row.node_key, '--context', row.context);
      requireThat(unlocked.status === 'unlocked' && unlocked.context === row.context, 'YGL_SCHEMA', 'ygl 状态回执无效', 1);
      this.store.markOutbox(row.id, 'status', 'done');
    }
  }
}
