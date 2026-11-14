import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { Service, type YglPort } from '../src/application/service.ts';
import { Store } from '../src/infrastructure/store.ts';
import { id, now, RetouchError, type Plan, type Result, type Run, type Task, type WorkspaceConfig } from '../src/domain/model.ts';

export class FakeYgl implements YglPort {
  store: Store; syncCalls = 0; failAt = 0; unavailable = false;
  constructor(store: Store) { this.store = store; }
  async bootstrap() {}
  async ensurePlan(_plan: Plan) {}
  async checkPlan(_plan: Plan) { if (this.unavailable) throw new RetouchError('YGL_UNAVAILABLE', 'simulated unavailable'); }
  async can(_plan: Plan, _run: string, _node: string) { return true; }
  async sync(_plan: Plan, run: string) {
    this.syncCalls++;
    if (this.unavailable || this.syncCalls === this.failAt) throw new RetouchError('YGL_UNAVAILABLE', 'simulated unavailable');
    for (const row of this.store.pending(run)) this.store.markOutbox(row.id, 'status', 'done');
  }
}
export const groups = { schema_version: 'retouch.requirements/v1', groups: [
  { id: 'handle', label: '把手', text: '修改把手', disabled: false, scope: 'operation' },
  { id: 'material', label: '门板', text: '修改门板材质', disabled: false, scope: 'operation' },
  { id: 'keep', label: '保持项', text: '其余区域和已完成修改保持', disabled: false, scope: 'preserve' },
  { id: 'disabled', label: '停用项', text: 'SHOULD-NOT-EXECUTE', disabled: true, scope: 'operation' },
  { id: 'blank', label: '空白项', text: '   ', disabled: false, scope: 'operation' },
] };
export function planInput(executor: 'host' | 'offline' = 'offline') {
  return { schema_version: 'retouch.plan/v1', title: '两步局部修改', executor, steps: [
    { id: 'handle', name: '改把手', operation: 'image.edit', input: 'original', needs: [] as string[], requirement_ids: ['handle'], reference_asset_ids: [], region: { x: 8, y: 8, width: 8, height: 8 }, ...(executor === 'offline' ? { offline: { kind: 'fill', rgba: [40, 100, 200, 255] } } : {}) },
    { id: 'material', name: '换材质', operation: 'image.edit', input: 'step:handle', needs: ['handle'], requirement_ids: ['material'], reference_asset_ids: [], region: { x: 40, y: 20, width: 20, height: 16 }, ...(executor === 'offline' ? { offline: { kind: 'fill', rgba: [180, 140, 80, 255] } } : {}) },
  ] };
}
export async function fixture(mode: WorkspaceConfig['mode'] = 'demo') {
  const temp = process.env.RETOUCH_TEST_ROOT ?? fileURLToPath(new URL('../tmp/cli-tests/', import.meta.url));
  await fs.mkdir(temp, { recursive: true });
  const parent = await fs.mkdtemp(path.join(temp, 'case-')), root = path.join(parent, 'workspace'), source = path.join(parent, 'original.png');
  await sharp({ create: { width: 96, height: 64, channels: 4, background: { r: 230, g: 230, b: 230, alpha: 1 } } }).png().toFile(source);
  const store = await Store.initialize(root, { schema_version: 'retouch.workspace/v1', id: id('ws'), mode, ygl: { entry: 'UNIT_TEST_ONLY', version: 'fixture', source_hashes: {} }, created_at: now() });
  const ygl = new FakeYgl(store), service = new Service(store, ygl);
  return { parent, root, source, store, ygl, service };
}
export async function ready(f: Pick<Awaited<ReturnType<typeof fixture>>, 'source' | 'store' | 'service'>, executor: 'host' | 'offline' = 'offline') {
  const created = await f.service.createTask(f.source, '把手与门板分别修改，其余保持。');
  const taskId = String(created.data.task_id);
  f.service.setRequirements(taskId, groups, 0);
  const submitted = await f.service.submitPlan(taskId, planInput(executor), 1);
  const plan = submitted.data.plan as Plan;
  const template = { ...(submitted.data.approval_template as object), issuer: f.store.config.mode === 'demo' ? 'demo' : 'host-human', confirmation: '测试夹具：已确认本测试计划，不代表真实用户验收。' };
  f.service.grant(taskId, template, 2);
  const started = await f.service.start(taskId, 3), runId = String(started.data.run_id);
  return { taskId, plan, runId };
}
export function revision(f: Awaited<ReturnType<typeof fixture>>, runId: string) { return f.store.get<Run>('run', runId).revision; }
export function finalReceipt(f: Awaited<ReturnType<typeof fixture>>, runId: string) {
  const run = f.store.get<Run>('run', runId).data, plan = f.store.get<Plan>('plan', run.plan_hash).data;
  return { schema_version: 'retouch.final-review/v1', run_id: runId, plan_hash: plan.hash, output_sha256: f.service.assetView(run.completed_steps[plan.steps.at(-1)!.id]).sha256,
    verdict: 'accept', issuer: 'demo', confirmation: '离线夹具接受，仅验证流程，不代表真实商品质量。' };
}
export async function offlineFinished(f: Awaited<ReturnType<typeof fixture>>) {
  const current = await ready(f);
  await f.service.advance(current.runId, revision(f, current.runId), 'edit-1');
  await f.service.advance(current.runId, revision(f, current.runId), 'edit-2');
  return current;
}
export async function solidResult(f: Awaited<ReturnType<typeof fixture>>, runId: string) {
  const state = f.service.status(runId), attempt = state.data.attempt as { request_id: string; step_id: string };
  const file = path.join(f.parent, id('host') + '.png');
  await sharp({ create: { width: 96, height: 64, channels: 4, background: { r: 50, g: 80, b: 160, alpha: 1 } } }).png().toFile(file);
  return { schema_version: 'retouch.host-result/v1', request_id: attempt.request_id, plan_hash: state.data.plan_hash, step_id: attempt.step_id,
    input_sha256: (state.data.input as { sha256: string }).sha256, output_file: file, tool: 'TEST_FIXTURE_NO_AI', tool_receipt: '本地冻结夹具输出，不是宿主 AI 工具调用。' };
}
export function stepReceipt(result: Result, verdict = 'PASS') {
  const attempt = result.data.attempt as { id: string; report: { input_sha256: string; output_sha256: string } };
  return { schema_version: 'retouch.step-review/v1', attempt_id: attempt.id, plan_hash: result.data.plan_hash, input_sha256: attempt.report.input_sha256,
    output_sha256: attempt.report.output_sha256, verdict, observations: '已检查测试夹具实际候选的局部变化与保持区域。', reviewer: 'test-fixture-reviewer' };
}
