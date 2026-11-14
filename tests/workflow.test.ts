import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { active, bytesHash, RetouchError, type Attempt, type Plan, type Run, type Task } from '../src/domain/model.ts';
import { compilePlan, requirements } from '../src/domain/validation.ts';
import { Store } from '../src/infrastructure/store.ts';
import { fixture, groups, planInput, ready, revision, finalReceipt, offlineFinished, solidResult, stepReceipt } from './fixtures.ts';

test('需求按文字与停用状态参与，原文和自定义组保留', () => {
  const parsed = requirements(groups);
  assert.deepEqual(parsed.filter(active).map((group) => group.id), ['handle', 'material', 'keep']);
  assert.equal(parsed.find((group) => group.id === 'disabled')!.text, 'SHOULD-NOT-EXECUTE');
  assert.throws(() => requirements({ ...groups, groups: [...groups.groups, groups.groups[0]] }), { code: 'DUPLICATE_ID' });
});

test('非法计划在投影和图像处理前拒绝', async (t) => {
  const f = await fixture(); t.after(() => f.store.close());
  const taskId = String((await f.service.createTask(f.source, '修改把手和材质')).data.task_id);
  f.service.setRequirements(taskId, groups, 0);
  const task = f.store.get<Task>('task', taskId).data, asset = f.service.assetView(task.working_asset_id);
  const cycle = planInput(); cycle.steps[0].needs = ['material'];
  assert.throws(() => compilePlan(cycle, task, asset, 'demo'), { code: 'PLAN_CYCLE' });
  const missing = planInput(); missing.steps[1].needs = ['missing'];
  assert.throws(() => compilePlan(missing, task, asset, 'demo'), { code: 'MISSING_DEPENDENCY' });
  const unordered = planInput(); unordered.steps[1].needs = [];
  assert.throws(() => compilePlan(unordered, task, asset, 'demo'), { code: 'UNORDERED_BINDING' });
  const inactive = planInput(); inactive.steps[0].requirement_ids = ['disabled'];
  assert.throws(() => compilePlan(inactive, task, asset, 'demo'), { code: 'INACTIVE_REQUIREMENT' });
  const outside = planInput(); outside.steps[0].region.x = 100;
  assert.throws(() => compilePlan(outside, task, asset, 'demo'), { code: 'INVALID_REGION' });
  assert.throws(() => compilePlan({ ...planInput(), approved: true }, task, asset, 'demo'), { code: 'UNKNOWN_FIELD' });
  assert.throws(() => compilePlan({ ...planInput('host'), executor: 'api' }, task, asset, 'demo'), { code: 'UNSUPPORTED_EXECUTOR' });
  assert.throws(() => compilePlan(planInput(), task, asset, 'standard'), { code: 'DEMO_ONLY' });
  const host = planInput('host'); delete (host as { executor?: string }).executor;
  assert.equal(compilePlan(host, task, asset, 'demo').executor, 'host');
  assert.ok(!compilePlan(planInput(), task, asset, 'demo').steps[0].prompt.includes('SHOULD-NOT-EXECUTE'));
});

test('原图保留且方向规范化后建立坐标系', async (t) => {
  const f = await fixture(); t.after(() => f.store.close());
  const jpeg = path.join(f.parent, 'oriented.jpg');
  await sharp(f.source).jpeg().withMetadata({ orientation: 6 }).toFile(jpeg);
  const before = bytesHash(await fs.readFile(jpeg));
  const result = await f.service.createTask(jpeg, '方向测试');
  const working = result.data.working as { width: number; height: number };
  assert.equal(working.width, 64); assert.equal(working.height, 96);
  assert.equal(bytesHash(await fs.readFile(jpeg)), before);
  const invalid = path.join(f.parent, 'invalid.png'); await fs.writeFile(invalid, Buffer.from('not-image'));
  await assert.rejects(f.service.createTask(invalid, 'bad'), { code: 'IMAGE_DECODE' });
});

test('两步离线图像承接、保持区、终验与不可覆盖交付', async (t) => {
  const f = await fixture(); t.after(() => f.store.close());
  const sourceHash = bytesHash(await fs.readFile(f.source));
  const { runId, plan } = await offlineFinished(f);
  const attempts = f.store.list<Attempt>('attempt').map((entry) => entry.data);
  assert.equal(attempts.length, 2); assert.equal(attempts[1].input_asset_id, attempts[0].output_asset_id);
  assert.ok(attempts.every((attempt) => attempt.report?.changed_outside_pixels === 0));
  const pixels = await sharp(await f.store.assetBytes(attempts[1].output_asset_id!)).ensureAlpha().raw().toBuffer();
  const pixel = (x: number, y: number) => [...pixels.subarray((y * 96 + x) * 4, (y * 96 + x) * 4 + 4)];
  assert.deepEqual(pixel(10, 10), [40, 100, 200, 255]); assert.deepEqual(pixel(45, 25), [180, 140, 80, 255]); assert.deepEqual(pixel(0, 0), [230, 230, 230, 255]);
  await assert.rejects(f.service.deliver(runId, path.join(f.root, 'exports/result'), revision(f, runId), 'early'), { code: 'ACCEPTANCE_REQUIRED' });
  const receipt = finalReceipt(f, runId);
  await assert.rejects(f.service.finalReview(runId, { ...receipt, output_sha256: 'wrong' }, revision(f, runId), 'wrong-final'), { code: 'FINAL_REVIEW_BINDING' });
  await f.service.finalReview(runId, receipt, revision(f, runId), 'final');
  const expected = revision(f, runId), target = path.join(f.root, 'exports/result');
  const delivered = await f.service.deliver(runId, target, expected, 'deliver');
  assert.equal(delivered.result_status, 'completed');
  const manifest = JSON.parse(await fs.readFile(path.join(target, 'manifest.json'), 'utf8'));
  assert.equal(manifest.plan_hash, plan.hash); assert.equal(manifest.sha256, bytesHash(await fs.readFile(path.join(target, 'image.png'))));
  assert.equal(manifest.image_generation, 'NOT_RUN_OFFLINE_DEMO');
  assert.equal((await f.service.deliver(runId, target, expected, 'deliver')).replayed, true);
  assert.equal(bytesHash(await fs.readFile(f.source)), sourceHash);
});

test('请求键重放读取原回执，不同意图冲突', async (t) => {
  const f = await fixture(); t.after(() => f.store.close()); const { runId } = await ready(f);
  const first = await f.service.advance(runId, 0, 'same-key');
  const again = await f.service.advance(runId, 0, 'same-key');
  assert.equal(again.replayed, true); assert.equal(again.data.run_id, first.data.run_id);
  await assert.rejects(f.service.advance(runId, revision(f, runId), 'same-key'), { code: 'REQUEST_CONFLICT' });
  assert.equal(f.store.list('attempt').length, 1);
});

test('两个并发推进只有一个取得步骤租约', async (t) => {
  const f = await fixture(); t.after(() => f.store.close()); const { runId } = await ready(f);
  const results = await Promise.allSettled([f.service.advance(runId, 0, 'concurrent-a'), f.service.advance(runId, 0, 'concurrent-b')]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(f.store.list('attempt').length, 1);
});

test('同步故障保留本地图像，补同步不会重新处理', async (t) => {
  const f = await fixture(); t.after(() => f.store.close()); const { runId, taskId } = await ready(f);
  f.ygl.failAt = f.ygl.syncCalls + 2;
  const result = await f.service.advance(runId, 0, 'sync-failure');
  assert.ok(result.warnings?.length); assert.equal(f.store.list('attempt').length, 1); assert.ok(f.store.pending(runId).length > 0);
  const output = f.store.list<Attempt>('attempt')[0].data.output_asset_id;
  f.ygl.unavailable = true;
  await assert.rejects(f.service.advance(runId, revision(f, runId), 'blocked-next'), { code: 'YGL_UNAVAILABLE' });
  f.ygl.unavailable = false; await f.service.synchronize(taskId);
  assert.equal(f.store.pending(runId).length, 0); assert.equal(f.store.list('attempt').length, 1);
  assert.equal(f.store.list<Attempt>('attempt')[0].data.output_asset_id, output);
});

test('需求改变使旧运行不可继续，旧记录保留', async (t) => {
  const f = await fixture(); t.after(() => f.store.close()); const { taskId, runId } = await ready(f);
  f.service.setRequirements(taskId, groups, f.store.get<Task>('task', taskId).revision);
  await assert.rejects(f.service.advance(runId, 0, 'stale'), { code: 'STALE_RUN' });
  assert.equal(f.store.list('attempt').length, 0); assert.equal(f.store.list('plan').length, 1);
});

test('无授权不能启动，计划 JSON 的布尔值不能授予权限', async (t) => {
  const f = await fixture(); t.after(() => f.store.close());
  const taskId = String((await f.service.createTask(f.source, '修改两处')).data.task_id);
  f.service.setRequirements(taskId, groups, 0); const submitted = await f.service.submitPlan(taskId, planInput(), 1);
  await assert.rejects(f.service.start(taskId, 2), { code: 'APPROVAL_REQUIRED' });
  const template = submitted.data.approval_template as object;
  assert.throws(() => f.service.grant(taskId, template, 2), { code: 'INVALID_INPUT' });
  assert.throws(() => f.service.grant(taskId, { ...template, expires_at: '2000-01-01T00:00:00Z' }, 2), { code: 'APPROVAL_EXPIRED' });
  assert.throws(() => f.service.grant(taskId, { ...template, plan_hash: 'other' }, 2), { code: 'APPROVAL_MISMATCH' });
});

test('宿主默认任务单、未知状态和实际图像复核闭环', async (t) => {
  const f = await fixture(); t.after(() => f.store.close()); const { runId } = await ready(f, 'host');
  const waiting = await f.service.advance(runId, 0, 'host-1');
  assert.equal(waiting.result_status, 'waiting_for_host');
  const attempt = waiting.data.attempt as Attempt;
  const request = JSON.parse(await fs.readFile(path.join(f.root, attempt.request_path), 'utf8'));
  assert.equal(request.execution_policy.preferred, 'host_builtin_image_tool'); assert.equal(request.execution_policy.api_fallback, 'explicit_opt_in_only_not_implemented');
  const dispatched = f.service.dispatch(runId, revision(f, runId), 'dispatch');
  assert.equal(dispatched.result_status, 'host_execution_authorized_once');
  assert.equal((await f.service.resume(runId, revision(f, runId))).result_status, 'unknown');
  assert.equal((await f.service.advance(runId, revision(f, runId), 'do-not-regenerate')).result_status, 'unknown');
  assert.equal(f.store.list('attempt').length, 1);
  const receipt = await solidResult(f, runId);
  await assert.rejects(f.service.complete(runId, { ...receipt, input_sha256: 'wrong' }, revision(f, runId), 'wrong-input'), { code: 'RESULT_BINDING' });
  let received = await f.service.complete(runId, receipt, revision(f, runId), 'received');
  assert.equal(received.result_status, 'waiting_for_step_review');
  const current = received.data.attempt as Attempt;
  assert.equal(current.report!.changed_outside_pixels, 0); assert.notEqual(current.output_asset_id, current.raw_output_asset_id);
  await assert.rejects(f.service.reviewStep(runId, { ...stepReceipt(received), output_sha256: 'wrong' }, revision(f, runId), 'wrong-review'), { code: 'REVIEW_BINDING' });
  received = await f.service.reviewStep(runId, stepReceipt(received, 'UNKNOWN'), revision(f, runId), 'unknown-review');
  assert.equal(received.result_status, 'waiting_for_step_review');
  const reviewed = await f.service.reviewStep(runId, stepReceipt(received), revision(f, runId), 'passed-review');
  assert.equal(reviewed.result_status, 'running');
  const second = await f.service.advance(runId, revision(f, runId), 'host-2');
  assert.equal((second.data.attempt as Attempt).input_asset_id, current.output_asset_id);
  const nextRequest = JSON.parse(await fs.readFile(path.join(f.root, (second.data.attempt as Attempt).request_path), 'utf8'));
  assert.equal(nextRequest.input.sha256, current.report!.output_sha256);
});

test('取消后收到宿主结果仍留痕，不推进后续', async (t) => {
  const f = await fixture(); t.after(() => f.store.close()); const { runId } = await ready(f, 'host');
  await f.service.advance(runId, 0, 'host'); const receipt = await solidResult(f, runId);
  f.service.cancel(runId, revision(f, runId));
  const result = await f.service.complete(runId, receipt, revision(f, runId), 'late-result');
  assert.equal(result.result_status, 'cancelled'); assert.ok((result.data.attempt as Attempt).output_asset_id);
  assert.equal(Object.keys((result.data.run as Run).completed_steps).length, 0);
});

test('CAS 被修改会阻断执行，损坏图像不能当结果', async (t) => {
  const f = await fixture(); t.after(() => f.store.close()); const { runId, plan } = await ready(f);
  await fs.writeFile(f.service.assetView(plan.working_asset_id).file, 'corrupted');
  await assert.rejects(f.service.advance(runId, 0, 'corrupt'), { code: 'ASSET_CORRUPTED' });
  assert.equal(f.store.list('attempt').length, 0);
});

test('交付拒绝越界及覆盖未知目录', async (t) => {
  const f = await fixture(); t.after(() => f.store.close()); const { runId } = await offlineFinished(f);
  await f.service.finalReview(runId, finalReceipt(f, runId), revision(f, runId), 'accept');
  await assert.rejects(f.service.deliver(runId, path.join(f.parent, 'outside'), revision(f, runId), 'outside'), { code: 'DELIVERY_SCOPE' });
  const existing = path.join(f.root, 'exports/existing'); await fs.mkdir(existing);
  await assert.rejects(f.service.deliver(runId, existing, revision(f, runId), 'overwrite'), { code: 'DELIVERY_EXISTS' });
});

test('持久账本可在另一连接恢复查询', async () => {
  const f = await fixture(); const { runId } = await ready(f); f.store.close();
  const restored = await Store.open(f.root);
  try { assert.equal(restored.get<Run>('run', runId).data.status, 'running'); assert.equal(restored.get<Run>('run', runId).revision, 0); }
  finally { restored.close(); }
});

test('宿主结果损坏、尺寸错误或含凭证时不采纳为候选', async (t) => {
  const f = await fixture(); t.after(() => f.store.close()); const { runId } = await ready(f, 'host');
  await f.service.advance(runId, 0, 'host-image');
  const receipt = await solidResult(f, runId);
  await assert.rejects(f.service.complete(runId, { ...receipt, tool_receipt: 'https://example.test/image?token=private-value' }, revision(f, runId), 'sensitive'), { code: 'SENSITIVE_RECEIPT' });
  const wrongSize = path.join(f.parent, 'wrong-size.png');
  await sharp({ create: { width: 12, height: 12, channels: 4, background: 'red' } }).png().toFile(wrongSize);
  await assert.rejects(f.service.complete(runId, { ...receipt, output_file: wrongSize }, revision(f, runId), 'wrong-size'), { code: 'OUTPUT_DIMENSIONS' });
  const corrupt = path.join(f.parent, 'corrupt.png'); await fs.writeFile(corrupt, 'invalid-image');
  await assert.rejects(f.service.complete(runId, { ...receipt, output_file: corrupt }, revision(f, runId), 'corrupt'), { code: 'IMAGE_DECODE' });
  assert.equal(f.service.status(runId).data.candidate, null);
  assert.equal(f.service.status(runId).result_status, 'waiting_for_host');
});

test('意图已提交后的本地错误明确回报 committed，并保留恢复身份', async (t) => {
  const f = await fixture(); t.after(() => f.store.close()); const { runId } = await ready(f);
  f.service.images.fill = async () => { throw new RetouchError('LOCAL_IMAGE_FAILURE', 'simulated decode failure'); };
  await assert.rejects(f.service.advance(runId, 0, 'prepared-failure'), (error: unknown) => {
    assert.ok(error instanceof RetouchError); assert.equal(error.effectStatus, 'committed'); assert.equal((error.details as { run_id: string }).run_id, runId); return true;
  });
  assert.equal(f.store.list<Attempt>('attempt')[0].data.status, 'prepared');
  assert.equal(f.store.list('attempt').length, 1);
});

test('步骤 id 与对象原型属性同名时仍必须实际执行', async (t) => {
  const f = await fixture(); t.after(() => f.store.close());
  const taskId = String((await f.service.createTask(f.source, '修改两处')).data.task_id);
  f.service.setRequirements(taskId, groups, 0);
  const input = planInput(); input.steps[0].id = 'constructor'; input.steps[1].input = 'step:constructor'; input.steps[1].needs = ['constructor'];
  const submitted = await f.service.submitPlan(taskId, input, 1);
  f.service.grant(taskId, { ...(submitted.data.approval_template as object), confirmation: '离线回归夹具授权。' }, 2);
  const runId = String((await f.service.start(taskId, 3)).data.run_id);
  const first = await f.service.advance(runId, 0, 'constructor-step');
  assert.equal(first.result_status, 'running');
  const firstAttempt = first.data.attempt as Attempt; assert.equal(firstAttempt.step_id, 'constructor'); assert.equal(firstAttempt.status, 'succeeded');
  const last = await f.service.advance(runId, revision(f, runId), 'material-step');
  assert.equal(last.result_status, 'waiting_for_review');
  assert.equal((last.data.attempt as Attempt).input_asset_id, firstAttempt.output_asset_id);
});

test('取消未知宿主任务后，旧授权不能用于新运行', async (t) => {
  const f = await fixture(); t.after(() => f.store.close()); const { runId, taskId, plan } = await ready(f, 'host');
  await f.service.advance(runId, 0, 'single-grant');
  f.service.dispatch(runId, revision(f, runId), 'dispatch-once');
  f.service.cancel(runId, revision(f, runId));
  const expected = f.store.get<Task>('task', taskId).revision;
  await assert.rejects(f.service.start(taskId, expected), { code: 'GRANT_ALREADY_USED' });
  f.service.grant(taskId, { schema_version: 'retouch.approval/v1', plan_hash: plan.hash, asset_sha256: f.service.assetView(plan.working_asset_id).sha256, executor: 'host',
    issuer: 'demo', confirmation: '测试夹具明确批准另一次运行，旧未知请求仍保留。', expires_at: new Date(Date.now() + 3600000).toISOString() }, expected);
  const next = await f.service.start(taskId, expected + 1);
  assert.notEqual(next.data.run_id, runId); assert.equal(f.store.get<Run>('run', runId).data.status, 'cancelled');
});
