import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { Service, initializeWorkspace } from '../src/application/service.ts';
import { Store } from '../src/infrastructure/store.ts';
import { Ygl } from '../src/adapters/ygl.ts';
import { type Asset, type Attempt, type Plan, type Run, type Task } from '../src/domain/model.ts';
import { ready } from './fixtures.ts';

const entry = process.env.RETOUCH_TEST_YGL_ENTRY;
const invoke = promisify(execFile), projectRoot = fileURLToPath(new URL('../', import.meta.url));
test('实际 ygl CLI：两步交付、证据、context 隔离、跨进程竞争与冻结图漂移', { skip: !entry, timeout: 300000 }, async (t) => {
  const evidenceRoot = process.env.RETOUCH_TEST_ROOT!;
  const parent = await fs.mkdtemp(path.join(evidenceRoot, 'native-')), root = path.join(parent, 'workspace'), source = path.join(parent, 'original.png');
  await sharp({ create: { width: 96, height: 64, channels: 4, background: { r: 230, g: 230, b: 230, alpha: 1 } } }).png().toFile(source);
  const initialized = await initializeWorkspace(root, entry!, true); assert.equal(initialized.result_status, 'initialized');
  const store = await Store.open(root); t.after(() => store.close());
  const service = new Service(store), native = new Ygl(store), f = { root, source, store, service };
  const { taskId, runId, plan } = await ready(f), currentRevision = () => store.get<Run>('run', runId).revision;
  const projection = store.projection(plan.hash)!;
  await native.node(projection.tree, 'unlock', 'deliver', '--context', store.context(runId));
  await assert.rejects(service.deliver(runId, path.join(root, 'exports/premature'), currentRevision(), 'premature'), { code: 'ACCEPTANCE_REQUIRED' });
  await service.advance(runId, currentRevision(), 'native-first');
  await service.advance(runId, currentRevision(), 'native-second');
  assert.equal(service.status(runId).result_status, 'waiting_for_review');
  const attempts = store.list<Attempt>('attempt').map((row) => row.data);
  assert.equal(attempts.length, 2); assert.equal(attempts[1].input_asset_id, attempts[0].output_asset_id);
  const output = store.get<Asset>('asset', attempts[1].output_asset_id!).data;
  await service.finalReview(runId, { schema_version: 'retouch.final-review/v1', run_id: runId, plan_hash: plan.hash, output_sha256: output.sha256, verdict: 'accept', issuer: 'demo', confirmation: 'Native CLI integration fixture only, not real image quality acceptance.' }, currentRevision(), 'native-final');
  const target = path.join(root, 'exports/result');
  const delivered = await service.deliver(runId, target, currentRevision(), 'native-deliver');
  assert.equal(delivered.result_status, 'completed'); assert.equal(store.pending(runId).length, 0);
  const manifest = JSON.parse(await fs.readFile(path.join(target, 'manifest.json'), 'utf8'));
  assert.equal(manifest.sha256, output.sha256);
  service.grant(taskId, { schema_version: 'retouch.approval/v1', plan_hash: plan.hash, asset_sha256: service.assetView(plan.working_asset_id).sha256, executor: plan.executor,
    issuer: 'demo', confirmation: '第二个隔离运行的测试夹具新授权。', expires_at: new Date(Date.now() + 3600000).toISOString() }, store.get<Task>('task', taskId).revision);
  const nextRun = await service.start(taskId, store.get<Task>('task', taskId).revision), nextId = String(nextRun.data.run_id);
  assert.notEqual(store.context(nextId), store.context(runId));
  assert.equal(await native.can(plan, nextId, 'edit-material'), false);
  const sentinel = path.join(parent, 'must-not-be-used-as-ygl-home');
  async function advancing(key: string) {
    let stdout = '', code = 0;
    try {
      ({ stdout } = await invoke(process.execPath, ['src/cli.ts', 'run', 'advance', nextId, '--workspace', root, '--expected-revision', '0', '--request-id', key, '--json'],
        { cwd: projectRoot, windowsHide: true, timeout: 120000, env: { ...process.env, YGL_HOME: sentinel, YGL_DB_URL: 'postgres://unused-test-target/never-connect' } }));
    } catch (error) { stdout = (error as { stdout: string }).stdout; code = Number((error as { code: number }).code); }
    return { code, output: JSON.parse(stdout) };
  }
  const races = await Promise.all([advancing('native-race-a'), advancing('native-race-b')]);
  assert.equal(races.filter((item) => item.code === 0).length, 1);
  assert.equal(store.list<Attempt>('attempt').filter((item) => item.data.run_id === nextId).length, 1);
  assert.equal(await fs.stat(sentinel).then(() => true, () => false), false);
  await service.synchronize(taskId);
  await native.node(projection.tree, 'cond', 'add', 'grant', '--name', 'unexpected-condition', '--kind', 'flag', '--op', '==', '--value', '1');
  assert.equal((await service.checkPlan(taskId)).result_status, 'blocked');
  await assert.rejects(service.advance(nextId, store.get<Run>('run', nextId).revision, 'drift-blocked'), { code: 'YGL_GRAPH_CONFLICT' });
  await native.node(projection.tree, 'cond', 'rm', 'grant', '--name', 'unexpected-condition');
  await native.node(projection.tree, 'index');
  await native.node(projection.tree, 'validate');
  assert.equal((await service.checkPlan(taskId)).result_status, 'valid');
  service.cancel(nextId, store.get<Run>('run', nextId).revision);
  const health = await native.call(['doctor']);
  assert.ok(Array.isArray(health) && health.every((item) => item.status === 'pass'));
  const evidence = { verdict: 'PASS', workspace_id: store.config.id, root, ygl_version: store.config.ygl.version,
    ygl_entry_sha256: crypto.createHash('sha256').update(await fs.readFile(entry!)).digest('hex'), plan_hash: plan.hash, tree: projection.tree, runs: [runId, nextId],
    context_isolation: 'PASS', domain_checks_resist_raw_unlock: 'PASS', receipt_sync: 'PASS', frozen_graph_drift: 'PASS', race_exit_codes: races.map((item) => item.code), attempt_count_in_second_run: 1,
    hostile_global_ygl_environment_ignored: true, doctor: health, delivery_manifest: manifest, actual_ai_image_generation: 'NOT_RUN', independent_api_calls: 'NOT_RUN' };
  await fs.writeFile(path.join(evidenceRoot, 'native-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
});
