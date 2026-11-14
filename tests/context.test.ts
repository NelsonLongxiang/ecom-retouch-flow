import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import * as yazl from 'yazl';
import { Store } from '../src/infrastructure/store.ts';
import { readZip, writeZip } from '../src/infrastructure/zip.ts';
import { Projects, allRecords } from '../src/application/projects.ts';
import { Service, initializeWorkspace } from '../src/application/service.ts';
import { exportContext, inspectContext, previewImport, importContext, rebuildContextIndex } from '../src/application/context-exchange.ts';
import { bytesHash, hash, id, now, stable, type Run, type Task, type Attempt, type Plan } from '../src/domain/model.ts';
import { graphDiagnostics, type Artifact, type Project, type Goal, type ContextRecord, type Execution } from '../src/domain/context.ts';
import { fixture, ready, revision, FakeYgl, makeBinding, offlineFinished, finalReceipt, groups, planInput } from './fixtures.ts';
import { Ygl } from '../src/adapters/ygl.ts';

class ContextYgl extends FakeYgl {
  contextCalls = 0;
  async syncContext(_project: string, _records: ContextRecord[]) { if (this.unavailable) throw new Error('fixture projection unavailable'); this.contextCalls++; return 'fixture-context-tree'; }
}
const adapter = (store: Store) => new ContextYgl(store);
async function emptyTarget(f: Awaited<ReturnType<typeof fixture>>, name = id('target')) {
  const root = path.join(f.parent, name), store = await Store.initialize(root, { ...f.store.config, id: id('ws'), created_at: now() }); store.close(); return root;
}
const goalInput = (text: string) => ({ original_text: text, interpretation: text, scope: '当前明确范围', preserve: '保留前序真实结果及已确认事实', acceptance: '交付当前目标要求的产物，图像接受另行记录', confirmation: 'pending', confirmation_source: '' });
async function register(f: Awaited<ReturnType<typeof fixture>>, taskId: string, file: string, purpose: Artifact['purpose'], role: Artifact['fact_role'], inputs: string[] = []) {
  return (await f.service.projects.artifact(taskId, file, { type: purpose === 'design' ? 'document' : 'image', purpose, fact_role: role, source: 'isolated-replay-fixture; no real AI request', derived_from: inputs }, id('register'))).data.artifact as Artifact;
}
async function replayFixture() {
  const f = await fixture('standard');
  const originalFile = path.join(f.parent, '200.png'); await sharp({ create: { width: 200, height: 200, channels: 4, background: '#e8dfcf' } }).png().toFile(originalFile);
  const taskId = String((await f.service.createTask(originalFile, '高清重绘，最终交付 2048×2048；尚待终验。', '高清重绘', f.binding)).data.task_id);
  const original = f.store.list<Artifact>('artifact').find(r => r.data.task_id === taskId && r.data.purpose === 'original')!.data;
  const nativeFile = path.join(f.parent, '1254.png'); await sharp(originalFile).resize(1254, 1254).png().toFile(nativeFile);
  const native = await register(f, taskId, nativeFile, 'model_output', 'ai_generated', [original.id]);
  const finalFile = path.join(f.parent, '2048.png'); await sharp(nativeFile).resize(2048, 2048).png().toFile(finalFile);
  const final = await register(f, taskId, finalFile, 'postprocessed', 'derived', [native.id]);
  for (const [request, input, output, operation] of [['image-request-observed', original.id, native.id, 'image.generate'], ['upscale-observed', native.id, final.id, 'image.upscale']]) f.service.projects.execution(taskId, { request_id: request, channel: 'external-fixture', operation, scope: '高清候选和放大结果的回放事实', input_artifact_ids: [input], output_artifact_ids: [output], status: 'received', recovery_note: '结果已存在，补记录不能重新请求', source: 'regression fixture', occurred_at: now() }, request);
  const planned: string[] = [];
  for (const title of ['变体设计', '七张套图方案']) {
    const project = f.store.get<Project>('project', f.binding.project_id);
    const goal = f.service.projects.goal(project.data.id, goalInput(title), project.revision).data.goal as Goal;
    const binding = { ...f.binding, goal_id: goal.id, goal_version: goal.version, kind: 'design' as const, expected_output: title + '文档', done_when: '保存方案草稿；不代表图片已生成' };
    const task = String((await f.service.createTask(undefined, title, title, binding)).data.task_id); planned.push(task);
    const doc = path.join(f.parent, id('design') + '.md'); await fs.writeFile(doc, '# ' + title + '\n已规划，尚未实际生成套图。木纹是 AI 补绘细节，尚未确认为生产规格。\n');
    const artifact = await register(f, task, doc, 'design', 'assumption');
    f.service.projects.design(task, { artifact_id: artifact.id, status: 'draft', facts: [{ text: '木纹纹理为待确认的 AI 补绘', role: 'ai_generated', source_artifact_id: native.id, confirmation_source: '' }] }, 0);
    f.service.projects.closeTask(task, '测试夹具：方案文档已保存，未生成商品图片', f.store.get<Task>('task', task).revision);
  }
  f.service.projects.note(f.binding.project_id, { text: '同系列资料仅为参考，未确认柜门材质', role: 'pending', source: '用户提供资料的回放记录', confirmation_source: '' }, 'pending-material');
  return { ...f, taskId, original, native, final, planned };
}

test('缺少项目绑定在图像导入和执行副作用前拦截；旧任务保持待迁移', async t => {
  const f = await fixture(); t.after(() => f.store.close());
  await assert.rejects(f.service.createTask(f.source, '没有归属的请求'), { code: 'CONTEXT_BINDING_REQUIRED' }); assert.equal(f.store.list('asset').length, 0);
  const { taskId, runId } = await ready(f);
  const task = f.store.get<Task>('task', taskId); delete task.data.project_id; delete task.data.goal_id; f.store.update('task', taskId, task.data, task.revision);
  assert.equal(f.service.next(taskId).result_status, 'unassigned');
  await assert.rejects(f.service.advance(runId, revision(f, runId), 'unbound'), { code: 'CONTEXT_BINDING_REQUIRED' }); assert.equal(f.store.list('attempt').length, 0);
});

test('真实问题回放：外部候选与待确认事实可接手，设计文档完成不冒充套图完成', async t => {
  const f = await replayFixture(); t.after(() => f.store.close());
  assert.equal(f.service.taskView(f.taskId).result_status, 'waiting_for_review'); assert.equal(f.service.next(f.taskId).result_status, 'waiting_for_review');
  const brief = f.service.projects.brief(f.binding.project_id);
  const images = (brief.data.artifacts as Artifact[]).filter(a => a.task_id === f.taskId && ['original', 'model_output', 'postprocessed'].includes(a.purpose));
  assert.deepEqual(images.sort((a,b) => a.width! - b.width!).map(a => [a.width, a.height]), [[200, 200], [1254, 1254], [2048, 2048]]);
  for (const task of f.planned) { assert.equal(f.service.projects.progress(task).status, 'completed'); assert.equal(f.store.list<Artifact>('artifact').filter(a => a.data.task_id === task && a.data.type === 'image').length, 0); }
  assert.equal(f.store.list('run').length, 0); assert.equal(f.store.list('grant').length, 0);
  assert.equal((await f.service.projects.check(f.binding.project_id)).result_status, 'healthy');
  const design = (brief.data.designs as any[])[0]; assert.equal(design.facts[0].role, 'ai_generated'); assert.equal(design.facts[0].confirmation_source, '');
});

test('ZIP 完整往返：独立素材、稳定身份、尺寸来源、只读预检、幂等及索引重建', async t => {
  const f = await replayFixture(); t.after(() => f.store.close());
  const zip = path.join(f.parent, 'project.zip'); await exportContext(f.store, f.binding.project_id, zip);
  const bundle = await inspectContext(zip); assert.equal(bundle.manifest.completeness.status, 'complete');
  assert.ok(bundle.files.has('context/brief.md')); assert.ok(bundle.files.has('records/relations.json')); assert.ok(bundle.files.has('records/provenance.json'));
  const objectHashes = bundle.records.filter(r => r.kind === 'asset' || r.kind === 'artifact').map(r => r.data.sha256);
  assert.equal([...bundle.files.keys()].filter(p => p.startsWith('objects/')).length, new Set(objectHashes).size);
  const target = await emptyTarget(f), before = bytesHash(await fs.readFile(path.join(target, 'ledger.sqlite')));
  const preview = await previewImport(zip, target); assert.equal(preview.result_status, 'ready_to_import'); assert.equal(bytesHash(await fs.readFile(path.join(target, 'ledger.sqlite'))), before);
  const imported = await importContext(zip, target, { adapter }); assert.equal(imported.result_status, 'imported');
  const restored = await Store.open(target); t.after(() => restored.close()); const service = new Service(restored, new ContextYgl(restored));
  assert.equal(service.next(f.taskId).result_status, 'waiting_for_review');
  const sortRecords = (records: ContextRecord[]) => [...records].sort((a,b) => (a.kind + ':' + a.id).localeCompare(b.kind + ':' + b.id,'en'));
  assert.equal(hash(sortRecords(allRecords(restored))), hash(sortRecords(bundle.records)));
  const count = allRecords(restored).length, repeated = await importContext(zip, target, { adapter }); assert.equal(repeated.replayed, true); assert.equal(allRecords(restored).length, count);
  assert.equal(service.projects.brief(f.binding.project_id).data.index && (service.projects.brief(f.binding.project_id).data.index as any).ygl, 'in_sync');
  assert.equal(restored.list('run').length, 0); assert.equal(restored.list('attempt').length, 0);
  const review = { artifact_sha256: f.final.sha256, verdict: 'accept', issuer: 'host-human', confirmation: '回放夹具用户接受；不是实际商品验收', source: 'regression fixture' };
  await service.projects.reviewArtifact(f.final.id, review, 0, 'accept-restored');
  await importContext(zip, target, { adapter }); assert.equal(restored.get<Artifact>('artifact', f.final.id).data.status, 'accepted', '重复导入不能回滚导入后的真实进度');
});

test('相同 ID 内容冲突拒绝写入；显式 clone 重映射全图且可重复导入', async t => {
  const f = await replayFixture(); t.after(() => f.store.close()); const zip = path.join(f.parent, 'project.zip'); await exportContext(f.store, f.binding.project_id, zip);
  const target = await emptyTarget(f); await importContext(zip, target, { adapter });
  const restored = await Store.open(target); t.after(() => restored.close()); const task = restored.get<Task>('task', f.taskId); task.data.brief = '目标本地修改'; restored.update('task', f.taskId, task.data, task.revision);
  // A distinct snapshot containing the same IDs must not overwrite local progress.
  f.service.projects.note(f.binding.project_id, { text: '新增来源观察', role: 'assumption', source: 'test', confirmation_source: '' }, 'new-note'); const nextZip = path.join(f.parent, 'new-snapshot.zip'); await exportContext(f.store, f.binding.project_id, nextZip);
  const before = hash(allRecords(restored)); const preview = await previewImport(nextZip, target, 'merge'); assert.equal(preview.result_status, 'conflicts');
  await assert.rejects(importContext(nextZip, target, { strategy: 'merge', adapter }), { code: 'CONTEXT_CONFLICT' }); assert.equal(hash(allRecords(restored)), before);
  const clone = await importContext(zip, target, { strategy: 'clone', adapter }); assert.equal(clone.result_status, 'imported'); assert.notEqual(clone.data.project_id, f.binding.project_id);
  assert.equal(restored.list('project').length, 2); assert.equal((await new Projects(restored).check()).result_status, 'healthy');
  const count = allRecords(restored).length; await importContext(zip, target, { strategy: 'clone', adapter }); assert.equal(allRecords(restored).length, count);
});

test('未知宿主请求、历史授权及原任务单在迁移后不重新出图；完成回接仍可用', async t => {
  const f = await fixture(); t.after(() => f.store.close()); const { runId, taskId } = await ready(f, 'host');
  await f.service.advance(runId, 0, 'host-input'); const dispatchRevision = revision(f,runId); f.service.dispatch(runId, dispatchRevision, 'host-dispatch');
  const zip = path.join(f.parent, 'unknown.zip'); await exportContext(f.store, f.binding.project_id, zip);
  const target = await emptyTarget(f); const imported = await importContext(zip, target, { adapter }); assert.equal(imported.result_status, 'imported');
  const restored = await Store.open(target); t.after(() => restored.close()); const service = new Service(restored, new ContextYgl(restored));
  assert.equal(service.status(runId).result_status, 'unknown'); assert.equal(service.next(taskId).result_status, 'unknown');
  assert.equal((await service.resume(runId, revision({ ...f, store: restored }, runId))).result_status, 'unknown');
  assert.throws(() => service.dispatch(runId, restored.get<Run>('run', runId).revision, 'new-dispatch'), { code: 'APPROVAL_REQUIRED' });
  const replay = service.dispatch(runId, dispatchRevision, 'host-dispatch'); assert.equal(replay.replayed, true); assert.equal(restored.list('attempt').length, 1);
  const attempt = restored.list<Attempt>('attempt')[0].data, request = JSON.parse(await fs.readFile(path.join(target, attempt.request_path), 'utf8'));
  assert.ok(request.input.file.startsWith(target)); assert.ok(request.mask.file.startsWith(target)); await fs.access(request.mask.file);
  const clone = await importContext(zip, target, { strategy: 'clone', adapter }); assert.equal(clone.result_status, 'imported'); assert.equal((await new Projects(restored).check()).result_status, 'healthy');
});

test('目标新版本只标记相关下游，设计与接受历史仍保留且执行被阻止', async t => {
  const f = await fixture(); t.after(() => f.store.close()); const { taskId, runId } = await ready(f);
  const otherBinding = makeBinding(f.service), otherId = String((await f.service.createTask(f.source, '独立项目', undefined, otherBinding)).data.task_id);
  const project = f.store.get<Project>('project', f.binding.project_id); f.service.projects.goal(project.data.id, goalInput('变更后的明确目标'), project.revision, f.binding.goal_id);
  assert.equal(f.service.next(taskId).result_status, 'needs_review'); assert.equal(f.service.next(otherId).result_status, 'waiting_for_input');
  await assert.rejects(f.service.advance(runId, 0, 'stale-context'), { code: 'STALE_CONTEXT' }); assert.equal(f.store.list('run').length, 1);
  assert.equal(f.store.list<Goal>('goal').filter(g => g.data.id === f.binding.goal_id).length, 2);
});

test('外部意图和结果回接幂等，未知请求优先于已有候选', async t => {
  const f = await replayFixture(); t.after(() => f.store.close());
  const value = { request_id: 'not-yet-observed', channel: 'host-tool', operation: 'image.edit', scope: '外部请求观察', input_artifact_ids: [f.final.id], output_artifact_ids: [], status: 'unknown', recovery_note: '核对原请求，不自动重发', source: 'fixture', occurred_at: now() };
  const recorded = f.service.projects.execution(f.taskId, value, 'external-key'), execution = recorded.data.execution as Execution;
  assert.equal(f.service.projects.execution(f.taskId, value, 'external-key').replayed, true); assert.equal(f.service.next(f.taskId).result_status, 'unknown');
  const receipt = { status: 'received', output_artifact_ids: [f.final.id], source: '原结果实际存在', recovery_note: '仅补登记，未调用模型' };
  f.service.projects.reconcile(execution.id, receipt, 0, 'result-key'); assert.equal(f.service.projects.reconcile(execution.id, receipt, 0, 'result-key').replayed, true);
  assert.equal(f.service.next(f.taskId).result_status, 'waiting_for_review'); assert.equal(f.store.list('attempt').length, 0);
});

async function rewriteZip(source: string, destination: string, mutate: (files: Map<string, Buffer>, manifest: any) => void, reseal = true) {
  const files = await readZip(source), manifest = JSON.parse(files.get('manifest.json')!.toString()); mutate(files, manifest);
  if (reseal) {
    manifest.files = [...files].filter(([name]) => name !== 'manifest.json').map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: bytesHash(bytes) })).sort((a,b) => a.path.localeCompare(b.path, 'en'));
    manifest.snapshot_id = 'snapshot_' + hash({ schema_version: manifest.schema_version, project_id: manifest.project_id, source: manifest.source, scope: manifest.scope, required_capabilities: manifest.required_capabilities, files: manifest.files });
  }
  files.set('manifest.json', Buffer.from(stable(manifest))); await writeZip(destination, files);
}
test('损坏 ZIP、版本、hash、悬空关系和伪造图片尺寸在导入写入前拒绝', async t => {
  const f = await fixture(); t.after(() => f.store.close()); await ready(f); const source = path.join(f.parent, 'source.zip'); await exportContext(f.store, f.binding.project_id, source);
  const cases: [string, (files: Map<string, Buffer>, manifest: any) => void, boolean, string][] = [
    ['schema', (_f,m) => m.schema_version = 'retouch.context/v99', true, 'CONTEXT_VERSION'],
    ['hash', files => files.set('context/brief.md', Buffer.from('tampered')), false, 'CONTEXT_HASH'],
    ['dangling', files => { const rows = JSON.parse(files.get('records/relations.json')!.toString()); rows[0].data.dst = 'task:missing'; rows[0].data.id = rows[0].id = 'bad'; files.set('records/relations.json', Buffer.from(stable(rows))); }, true, 'CONTEXT_INTEGRITY'],
    ['dimensions', files => { const rows = JSON.parse(files.get('records/artifacts.json')!.toString()); for (const r of rows) if (r.data.width) r.data.width = 999; files.set('records/artifacts.json', Buffer.from(stable(rows))); }, true, 'CONTEXT_IMAGE_METADATA'],
    ['missing', files => { const name = [...files.keys()].find(n => n.startsWith('objects/'))!; files.delete(name); }, true, 'CONTEXT_OBJECT'],
  ];
  for (const [name, mutate, reseal, code] of cases) { const file = path.join(f.parent, name + '.zip'), target = path.join(f.parent, name + '-target'); await rewriteZip(source, file, mutate, reseal); await assert.rejects(importContext(file, target), { code }); assert.equal(await fs.access(target).then(() => true, () => false), false); }
  const corrupt = path.join(f.parent, 'corrupt.zip'); await fs.writeFile(corrupt, 'not-a-zip'); await assert.rejects(inspectContext(corrupt), { code: 'ZIP_INVALID' });
});

async function attackerZip(file: string, entries: { name: string; mode?: number }[], rename?: [string, string]) {
  const archive = new yazl.ZipFile(), chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve,reject) => { archive.outputStream.on('data', c => chunks.push(Buffer.from(c))); archive.outputStream.on('end', () => resolve(Buffer.concat(chunks))); archive.outputStream.on('error', reject); });
  for (const entry of entries) archive.addBuffer(Buffer.from('data'), entry.name, { mode: entry.mode ?? 0o100644 }); archive.end();
  let bytes = await done; if (rename) { const from = Buffer.from(rename[0]), to = Buffer.from(rename[1]); assert.equal(from.length,to.length); for (let at = bytes.indexOf(from); at >= 0; at = bytes.indexOf(from, at + to.length)) to.copy(bytes, at); } await fs.writeFile(file, bytes);
}
test('恶意 ZIP 路径、大小写碰撞和逃逸链接拒绝；目标目录外零写入', async t => {
  const f = await fixture(); t.after(() => f.store.close());
  const cases = [
    { entries: [{ name: 'aa/evil.txt' }], rename: ['aa/evil.txt','../evil.txt'] as [string,string] },
    { entries: [{ name: 'A.json' }, { name: 'a.json' }] },
    { entries: [{ name: 'link.txt', mode: 0o120777 }] },
  ];
  for (let index = 0; index < cases.length; index++) { const file = path.join(f.parent,'attack-' + index + '.zip'); await attackerZip(file,cases[index].entries,cases[index].rename); await assert.rejects(inspectContext(file), (e: any) => ['ZIP_PATH','ZIP_INVALID','ZIP_COLLISION','ZIP_LINK'].includes(e.code)); }
  assert.equal(await fs.access(path.join(f.parent,'evil.txt')).then(() => true, () => false),false);
});

test('导出快照不混入并发后的记录；缺失业务对象不发布成功 ZIP', async t => {
  const f = await fixture(); t.after(() => f.store.close()); await ready(f); const before = f.store.list('provenance').length;
  const file = path.join(f.parent,'snapshot.zip'); await exportContext(f.store, f.binding.project_id, file, async () => { f.service.projects.note(f.binding.project_id, { text: '快照之后的新增观察', role: 'assumption', source: 'test' }, 'after-snapshot'); });
  assert.equal((await inspectContext(file)).records.filter(r => r.kind === 'provenance').length,before); assert.equal(f.store.list('provenance').length,before + 1);
  const asset = f.store.list<any>('asset')[0].data; await fs.rename(path.join(f.root,asset.object_path),path.join(f.parent,'preserved-missing-object'));
  const broken = path.join(f.parent,'missing.zip'); await assert.rejects(exportContext(f.store,f.binding.project_id,broken), { code: 'MISSING_OBJECT' }); assert.equal(await fs.access(broken).then(() => true, () => false),false);
  await assert.rejects(exportContext(f.store,f.binding.project_id,file));
});

test('中断导入不暴露半个项目，同包恢复；索引故障只待同步且不重新执行', async t => {
  const f = await fixture(); t.after(() => f.store.close()); const { runId } = await ready(f,'host'); await f.service.advance(runId,0,'host'); f.service.dispatch(runId,revision(f,runId),'dispatch');
  const file = path.join(f.parent,'import.zip'); await exportContext(f.store,f.binding.project_id,file); const target = await emptyTarget(f);
  const before = await Store.open(target); const count = allRecords(before).length; before.close();
  await assert.rejects(importContext(file,target,{ adapter, afterObjects: async () => { throw new Error('simulated crash before commit'); } }));
  const interrupted = await Store.open(target); assert.equal(allRecords(interrupted).length,count); interrupted.close();
  const pending = await importContext(file,target,{ adapter: store => { const ygl = new ContextYgl(store); ygl.unavailable = true; return ygl; } }); assert.equal(pending.result_status,'imported_index_pending');
  const restored = await Store.open(target); t.after(() => restored.close()); const attempts = restored.list<Attempt>('attempt'); assert.equal(attempts.length,1); assert.equal(attempts[0].data.status,'unknown');
  const rebuilt = await rebuildContextIndex(restored,f.binding.project_id,adapter(restored)); assert.equal(rebuilt.result_status,'indexed'); assert.deepEqual(restored.list<Attempt>('attempt'),attempts);
});

test('非空目标、跨项目输入和失效事实不静默采用，凭证及机器配置不进包', async t => {
  const f = await fixture(); t.after(() => f.store.close()); const { taskId } = await ready(f);
  const file = path.join(f.parent,'safe.zip'); await exportContext(f.store,f.binding.project_id,file); const bundle = await inspectContext(file);
  const json = [...bundle.files].filter(([n]) => !n.startsWith('objects/')).map(([,b]) => b.toString()).join('\n');
  assert.equal(json.includes(f.root.replaceAll('\\','\\\\')),false); assert.equal(json.includes('UNIT_TEST_ONLY'),false); assert.equal(bundle.files.has('workspace.json'),false);
  const notEmpty = path.join(f.parent,'not-empty'); await fs.mkdir(notEmpty); await fs.writeFile(path.join(notEmpty,'keep.txt'),'existing');
  await assert.rejects(importContext(file,notEmpty), { code: 'CONTEXT_CONFLICT' }); assert.equal(await fs.readFile(path.join(notEmpty,'keep.txt'),'utf8'),'existing');
  const other = makeBinding(f.service), otherTask = String((await f.service.createTask(f.source,'另一项目',undefined,other)).data.task_id);
  const otherArtifact = f.store.list<Artifact>('artifact').find(r => r.data.task_id === otherTask)!.data;
  await assert.rejects(f.service.projects.artifact(taskId,f.source,{ type: 'image',purpose: 'candidate',fact_role: 'ai_generated',source: 'test',derived_from: [otherArtifact.id] },'cross-project'),{ code: 'CROSS_PROJECT_REFERENCE' });
  assert.throws(() => f.service.projects.note(f.binding.project_id,{ text: '未经确认的材质',role: 'confirmed_fact',source: 'AI guess' },'false-fact'),{ code: 'FACT_CONFIRMATION' });
  const secretDoc = path.join(f.parent,'credential.md'); await fs.writeFile(secretDoc,'Authorization: Bearer fixture-secret-never-publish');
  await assert.rejects(f.service.projects.artifact(taskId,secretDoc,{ type: 'document',purpose: 'design',fact_role: 'assumption',source: 'test' },'credential'),{ code: 'SENSITIVE_RECEIPT' });
});

test('正式工作流的审阅、交付文件与接受历史完整入包，导入不恢复原交付权限', async t => {
  const f = await fixture(); t.after(() => f.store.close()); const { runId } = await offlineFinished(f);
  await f.service.finalReview(runId,finalReceipt(f,runId),revision(f,runId),'accept-output'); await f.service.deliver(runId,path.join(f.root,'exports/result'),revision(f,runId),'deliver-output');
  assert.equal(f.store.list('review').length,1); const receipts = f.store.list<Artifact>('artifact').filter(r => r.data.type === 'receipt'); assert.equal(receipts.length,1); assert.equal(receipts[0].data.status,'delivered');
  const zip = path.join(f.parent,'completed.zip'); await exportContext(f.store,f.binding.project_id,zip); const target = await emptyTarget(f); await importContext(zip,target,{adapter});
  const restored = await Store.open(target); t.after(() => restored.close()); const service = new Service(restored,new ContextYgl(restored));
  assert.equal(service.status(runId).result_status,'completed'); assert.equal(service.projects.brief(f.binding.project_id).data.reviews && (service.projects.brief(f.binding.project_id).data.reviews as any[]).length,1);
  await assert.rejects(service.finishDelivery(runId), {code:'DELIVERY_STATE'}); assert.equal((await service.projects.check()).result_status,'healthy');
});

test('ZIP 解压预算在读取内容前生效，目标 CAS 链接不能越界写入', async t => {
  const f = await fixture(); t.after(() => f.store.close()); await ready(f);
  const hostile = path.join(f.parent,'oversized.zip'); await attackerZip(hostile,[{name:'small.txt'}]); const bytes = await fs.readFile(hostile);
  const central = bytes.indexOf(Buffer.from([0x50,0x4b,0x01,0x02])); bytes.writeUInt32LE(33 * 1024 * 1024,central + 24); await fs.writeFile(hostile,bytes);
  await assert.rejects(readZip(hostile),(e:any)=>['ZIP_LIMIT','ZIP_INVALID'].includes(e.code));
  const zip=path.join(f.parent,'safe.zip'); await exportContext(f.store,f.binding.project_id,zip); const target=await emptyTarget(f),outside=path.join(f.parent,'outside'); await fs.mkdir(outside);
  const objects=path.join(target,'objects','sha256'); await fs.rename(objects,path.join(target,'objects','preserved-empty-cas')); await fs.symlink(outside,objects,'junction');
  await assert.rejects(importContext(zip,target,{adapter}),{code:'PATH_ESCAPE'}); assert.deepEqual(await fs.readdir(outside),[]);
  const store=await Store.open(target); try { assert.equal(store.list('project').length,0); } finally {store.close();}
});

test('导入的未完成交付保留接受事实，显式新授权和新目标只交付已有图像', async t => {
  const f=await fixture(); t.after(()=>f.store.close()); const {runId,taskId,plan}=await offlineFinished(f);
  await f.service.finalReview(runId,finalReceipt(f,runId),revision(f,runId),'source-accept');
  f.service.finishDelivery=async()=>{throw new Error('interrupted after delivery intent');};
  await assert.rejects(f.service.deliver(runId,path.join(f.root,'exports/source-target'),revision(f,runId),'source-delivery'));
  assert.equal(f.service.status(runId).result_status,'delivering');
  const zip=path.join(f.parent,'delivering.zip'); await exportContext(f.store,f.binding.project_id,zip); const target=await emptyTarget(f); await importContext(zip,target,{adapter});
  const store=await Store.open(target); t.after(()=>store.close()); const service=new Service(store,new ContextYgl(store)); const count=store.list('attempt').length;
  await assert.rejects(service.finishDelivery(runId),{code:'APPROVAL_REQUIRED'});
  service.grant(taskId,{schema_version:'retouch.approval/v1',plan_hash:plan.hash,asset_sha256:service.assetView(plan.working_asset_id).sha256,executor:'offline',issuer:'demo',confirmation:'回归夹具明确批准仅向本地新目录恢复交付，不重新处理图片',expires_at:new Date(Date.now()+3600000).toISOString()},store.get<Task>('task',taskId).revision);
  service.authorizeRun(runId,store.get<Run>('run',runId).revision);
  await assert.rejects(service.finishDelivery(runId),{code:'DELIVERY_TARGET_REQUIRED'});
  const output=path.join(target,'exports/restored'); const delivered=await service.deliver(runId,output,store.get<Run>('run',runId).revision,'restored-delivery');
  assert.equal(delivered.result_status,'completed'); assert.equal(store.list('attempt').length,count); assert.equal(bytesHash(await fs.readFile(path.join(output,'image.png'))),service.assetView(store.get<Run>('run',runId).data.accepted_asset_id!).sha256);
  assert.ok(JSON.parse(await fs.readFile(path.join(output,'manifest.json'),'utf8')).restored_from_delivery_id);
});

test('索引重建期间并发改动保留为 pending，不能用旧指纹声明同步',async t=>{
  const f=await fixture();t.after(()=>f.store.close());await ready(f);
  const projection=new ContextYgl(f.store); projection.syncContext=async()=>{f.service.projects.note(f.binding.project_id,{text:'投影过程中的新事实',role:'assumption',source:'concurrent fixture'},'during-index');return 'old-snapshot-tree';};
  const result=await rebuildContextIndex(f.store,f.binding.project_id,projection);assert.equal(result.result_status,'index_pending');assert.equal(result.data.index_status,'pending');assert.equal(f.store.list('provenance').length,1);
  assert.equal((await rebuildContextIndex(f.store,f.binding.project_id,adapter(f.store))).result_status,'indexed');assert.equal(f.store.list('attempt').length,0);
});

test('旧版计划即使任务已经归属也不能授权或启动；接手入口一致提示重提计划',async t=>{
  const f=await fixture();t.after(()=>f.store.close());const taskId=String((await f.service.createTask(f.source,'旧工作区迁移',undefined,f.binding)).data.task_id);
  f.service.setRequirements(taskId,groups,0);const submitted=await f.service.submitPlan(taskId,planInput(),1);
  const legacy={...(submitted.data.plan as Plan)};delete legacy.project_id;delete legacy.goal_id;delete legacy.goal_version;delete legacy.design_id;const {hash:_old,...body}=legacy;legacy.hash=hash(body);
  f.store.insert('plan',legacy.hash,legacy);const task=f.store.get<Task>('task',taskId);task.data.active_plan=legacy.hash;f.store.update('task',taskId,task.data,task.revision);
  assert.equal(f.service.taskView(taskId).result_status,'needs_review');assert.equal(f.service.next(taskId).next_actions![0].type,'plan.submit');assert.equal((f.service.projects.brief(f.binding.project_id).data.tasks as any[])[0].progress.status,'needs_review');
  assert.throws(()=>f.service.grant(taskId,{...(submitted.data.approval_template as object),plan_hash:legacy.hash,confirmation:'迁移夹具确认'},task.revision+1),{code:'STALE_CONTEXT'});
  await assert.rejects(f.service.start(taskId,task.revision+1),{code:'STALE_CONTEXT'});assert.equal(f.store.list('run').length,0);
});

test('目标或需求变化不能遮蔽正式未知请求，ZIP 摘要与项目接手保留待对账事实',async t=>{
  const f=await fixture();t.after(()=>f.store.close());const {taskId,runId}=await ready(f,'host');await f.service.advance(runId,0,'scope-request');f.service.dispatch(runId,revision(f,runId),'scope-dispatch');
  const project=f.store.get<Project>('project',f.binding.project_id);f.service.projects.goal(project.data.id,goalInput('修改后的另一范围'),project.revision,f.binding.goal_id);
  f.service.setRequirements(taskId,groups,f.store.get<Task>('task',taskId).revision);
  assert.equal(f.service.taskView(taskId).result_status,'unknown');const next=f.service.next(taskId);assert.equal(next.result_status,'unknown');assert.equal(next.data.run_id,runId);
  const brief=f.service.projects.brief(f.binding.project_id);assert.equal((brief.data.unknown_requests as any[]).length,1);assert.equal((brief.data.runs as any[])[0].status,'unknown');
  const zip=path.join(f.parent,'scope-changed.zip');await exportContext(f.store,f.binding.project_id,zip);const bundle=await inspectContext(zip);const attempt=f.store.list<Attempt>('attempt')[0].data;
  assert.ok(bundle.files.get('context/brief.md')!.toString().includes(attempt.request_id));const target=await emptyTarget(f);await importContext(zip,target,{adapter});const restored=await Store.open(target);t.after(()=>restored.close());
  const result=new Projects(restored).brief(f.binding.project_id);assert.equal((result.data.unknown_requests as any[])[0].request_id,attempt.request_id);assert.equal((result.data.tasks as any[])[0].progress.status,'unknown');assert.equal(restored.list('attempt').length,1);
});

const entry = process.env.RETOUCH_TEST_YGL_ENTRY;
test('原生 ygl ZIP 新工作区恢复：重建真实投影、doctor 与未知请求保持', { skip: !entry, timeout: 600000 }, async t => {
  const base = process.env.RETOUCH_TEST_ROOT!; const parent = await fs.mkdtemp(path.join(base,'context-native-')), root = path.join(parent,'source'), image = path.join(parent,'original.png');
  await sharp({ create: { width: 96,height: 64,channels: 4,background: '#dedede' } }).png().toFile(image);
  await initializeWorkspace(root,entry!,true); const store = await Store.open(root); t.after(() => store.close()); const service = new Service(store);
  const { taskId,runId } = await ready({ source: image,store,service },'host'); await service.advance(runId,0,'native-context-request'); service.dispatch(runId,store.get<Run>('run',runId).revision,'native-context-dispatch');
  const projectId = store.get<Task>('task',taskId).data.project_id!, zip = path.join(parent,'project.zip'); await exportContext(store,projectId,zip);
  const target = path.join(parent,'restored'); const preview = await previewImport(zip,target); assert.equal(preview.result_status,'ready_to_import'); assert.equal(await fs.access(target).then(() => true, () => false),false);
  await assert.rejects(importContext(zip,target,{yglEntry:entry,afterObjects:async()=>{throw new Error('new workspace interrupted before domain commit');}}));
  await assert.rejects(Store.open(target),{code:'IMPORT_INCOMPLETE'});
  const restoredResult = await importContext(zip,target,{ yglEntry: entry }); assert.equal(restoredResult.result_status,'imported',JSON.stringify(restoredResult.warnings));
  const restored = await Store.open(target); t.after(() => restored.close()); const restoredService = new Service(restored);
  assert.equal(restoredService.next(taskId).result_status,'unknown'); assert.equal((await restoredService.doctor()).result_status,'healthy');
  assert.ok(restored.projection(store.get<Run>('run',runId).data.plan_hash)); assert.equal(restored.pending(runId).length,0);
  const repeated = await importContext(zip,target,{ yglEntry: entry }); assert.equal(repeated.replayed,true); assert.equal(restored.list('attempt').length,1);
  const native = new Ygl(restored), previousProjection = restored.projection(store.get<Run>('run',runId).data.plan_hash)!;
  await native.node(previousProjection.tree,'add','unexpected-node');
  const repaired = await rebuildContextIndex(restored,projectId); assert.equal(repaired.result_status,'indexed',JSON.stringify(repaired.warnings));
  assert.notEqual(restored.projection(store.get<Run>('run',runId).data.plan_hash)!.tree,previousProjection.tree); assert.equal(restored.list<Attempt>('attempt')[0].data.status,'unknown');
  await fs.writeFile(path.join(base,'context-native-evidence.json'),JSON.stringify({ verdict: 'PASS', source_workspace: root,target_workspace: target,snapshot_id: restoredResult.data.snapshot_id,unknown_preserved: true,no_new_attempts: true,index_rebuilt: true,image_ai_generation: 'NOT_RUN' },null,2));
});
