import fs from 'node:fs/promises';
import path from 'node:path';
import { Images } from '../adapters/images.ts';
import { Ygl, yglBinding } from '../adapters/ygl.ts';
import { Store } from '../infrastructure/store.ts';
import { approval, compilePlan, object, receiptText, requirements, text } from '../domain/validation.ts';
import { active, bytesHash, hash, id, now, requireThat, RetouchError, stable, type Asset, type Attempt, type Grant, type Plan, type Result, type Run, type Step, type Task, type WorkspaceConfig } from '../domain/model.ts';

export type YglPort = Pick<Ygl, 'bootstrap' | 'ensurePlan' | 'checkPlan' | 'can' | 'sync'>;
function completedOutput(run: Run, stepId: string): string | undefined {
  if (!Object.hasOwn(run.completed_steps, stepId)) return undefined;
  const value = run.completed_steps[stepId];
  return typeof value === 'string' ? value : undefined;
}
export async function initializeWorkspace(directory: string, entry: string, demo = false): Promise<Result> {
  const binding = await yglBinding(entry), absolute = path.resolve(directory);
  let store: Store;
  if (await fs.access(path.join(absolute, 'workspace.json')).then(() => true, () => false)) {
    store = await Store.open(absolute);
    requireThat(hash(store.config.ygl) === hash(binding) && store.config.mode === (demo ? 'demo' : 'standard'), 'WORKSPACE_CONFIG_CONFLICT', '已有工作区配置不同', 1);
  } else store = await Store.initialize(absolute, { schema_version: 'retouch.workspace/v1', id: id('ws'), mode: demo ? 'demo' : 'standard', ygl: binding, created_at: now() });
  try {
    await new Ygl(store).bootstrap();
    return { result_status: 'initialized', data: { workspace_id: store.config.id, root: store.root, mode: store.config.mode, ygl_version: binding.version, image_executor: 'host', api_fallback: 'not_configured' } };
  } finally { store.close(); }
}

export class Service {
  store: Store;
  images: Images;
  ygl: YglPort;
  processing = new Set<string>();
  afterPrepare?: () => Promise<void>;
  constructor(store: Store, ygl?: YglPort, afterPrepare?: () => Promise<void>) { this.store = store; this.images = new Images(store); this.ygl = ygl ?? new Ygl(store); this.afterPrepare = afterPrepare; }
  async createTask(imageFile: string, brief: string, title?: string): Promise<Result> {
    text(brief, 'brief');
    const { original, working } = await this.images.import(imageFile);
    const task: Task = { id: id('task'), title: text(title ?? brief.slice(0, 100), 'title', 160), brief, original_asset_id: original.id, working_asset_id: working.id,
      requirements: [], requirements_hash: hash([]), plan_revision: 0, active_plan: null, active_run: null, created_at: now() };
    this.store.transaction(() => { this.store.insert('task', task.id, task); this.store.event('task.created', { original: original.id, working: working.id }, task.id); });
    return { result_status: 'draft', data: { task_id: task.id, revision: 0, task, original: this.assetView(original.id), working: this.assetView(working.id) }, next_actions: [{ type: 'requirement.set', reason: '填写部位修改、保持项和参考用途' }] };
  }
  async addAsset(file: string): Promise<Result> {
    const imported = await this.images.import(file);
    return { result_status: 'imported', data: { original: this.assetView(imported.original.id), working: this.assetView(imported.working.id) } };
  }
  assetView(assetId: string): Asset & { file: string } {
    const asset = this.store.get<Asset>('asset', assetId).data;
    return { ...asset, file: path.join(this.store.root, asset.object_path) };
  }
  taskView(taskId: string): Result {
    const entity = this.store.get<Task>('task', taskId);
    const run = entity.data.active_run ? this.store.get<Run>('run', entity.data.active_run).data : null;
    return { result_status: run && run.plan_hash === entity.data.active_plan ? run.status : entity.data.active_plan ? 'planned' : 'draft', data: { task_id: taskId, revision: entity.revision, task: entity.data } };
  }
  setRequirements(taskId: string, value: unknown, expected: number): Result {
    const groups = requirements(value);
    return this.store.transaction(() => {
      const task = this.store.expect<Task>('task', taskId, expected);
      task.data.requirements = groups; task.data.requirements_hash = hash(groups); task.data.active_plan = null;
      const revision = this.store.update('task', taskId, task.data, expected);
      this.store.event('requirements.revised', { requirements_hash: task.data.requirements_hash, active_groups: groups.filter(active).map((group) => group.id) }, taskId);
      return { result_status: 'draft', data: { task_id: taskId, revision, effective_groups: groups.filter(active), retained_groups: groups } };
    });
  }
  currentPlan(taskId: string): Plan {
    const task = this.store.get<Task>('task', taskId).data;
    requireThat(task.active_plan, 'PLAN_REQUIRED', '请先提交当前需求的计划', 1);
    return this.store.get<Plan>('plan', task.active_plan).data;
  }
  async submitPlan(taskId: string, value: unknown, expected: number): Promise<Result> {
    const task = this.store.expect<Task>('task', taskId, expected).data;
    const asset = this.store.get<Asset>('asset', task.working_asset_id).data;
    await this.store.assetBytes(asset.id);
    const plan = compilePlan(value, task, asset, this.store.config.mode);
    for (const step of plan.steps) for (const reference of step.reference_asset_ids) await this.store.assetBytes(reference);
    const revision = this.store.transaction(() => {
      const current = this.store.expect<Task>('task', taskId, expected);
      current.data.active_plan = plan.hash; current.data.plan_revision = plan.revision;
      this.store.insert('plan', plan.hash, plan);
      const revision = this.store.update('task', taskId, current.data, expected);
      this.store.event('plan.frozen', { plan_hash: plan.hash, executor: plan.executor }, taskId);
      return revision;
    });
    const warnings: string[] = [];
    try { await this.ygl.ensurePlan(plan); } catch (error) { warnings.push('ygl_sync_pending: ' + (error as Error).message); }
    return { result_status: warnings.length ? 'ygl_sync_pending' : 'awaiting_approval', data: { task_id: taskId, revision, plan_hash: plan.hash, plan,
      approval_template: { schema_version: 'retouch.approval/v1', plan_hash: plan.hash, asset_sha256: asset.sha256, executor: plan.executor, issuer: this.store.config.mode === 'demo' ? 'demo' : 'host-human', confirmation: '', delivery_root: path.join(this.store.root, 'exports'), expires_at: new Date(Date.now() + 3600000).toISOString() } }, warnings };
  }
  async checkPlan(taskId: string): Promise<Result> {
    const plan = this.currentPlan(taskId), warnings: string[] = [];
    try { await this.ygl.checkPlan(plan); } catch (error) { warnings.push((error as Error).message); }
    return { result_status: warnings.length ? 'blocked' : 'valid', data: { plan_hash: plan.hash, plan, verdict: warnings.length ? 'FAIL' : 'PASS' }, warnings };
  }
  grant(taskId: string, value: unknown, expected: number): Result {
    return this.store.transaction(() => {
      const task = this.store.expect<Task>('task', taskId, expected), plan = this.currentPlan(taskId);
      const validated = approval(value, plan, this.store.get<Asset>('asset', plan.working_asset_id).data, this.store.config, this.store.root);
      const grant: Grant = { ...validated, id: id('grant'), created_at: now() };
      this.store.insert('grant', grant.id, grant);
      const revision = this.store.update('task', taskId, task.data, expected);
      this.store.event('approval.recorded', { grant_id: grant.id, plan_hash: plan.hash, issuer: grant.issuer, confirmation: grant.confirmation, limits: { executor: plan.executor, max_runs: 1, independent_api_calls: false, host_usage: 'managed_by_host' } }, taskId);
      return { result_status: 'approved', data: { task_id: taskId, revision, grant } };
    });
  }
  validGrant(plan: Plan, grantId?: string): Grant {
    const candidates = grantId ? [this.store.get<Grant>('grant', grantId).data] : this.store.list<Grant>('grant').map((entity) => entity.data).reverse();
    const asset = this.store.get<Asset>('asset', plan.working_asset_id).data;
    const grant = candidates.find((item) => item.plan_hash === plan.hash && item.task_id === plan.task_id && item.executor === plan.executor && item.asset_sha256 === asset.sha256 && Date.parse(item.expires_at) > Date.now());
    requireThat(grant, 'APPROVAL_REQUIRED', '缺少当前计划、素材和执行方式的有效授权', 1);
    return grant;
  }
  async start(taskId: string, expected: number): Promise<Result> {
    const task = this.store.expect<Task>('task', taskId, expected), plan = this.currentPlan(taskId), grant = this.validGrant(plan);
    await this.store.assetBytes(plan.working_asset_id); await this.ygl.ensurePlan(plan);
    const run: Run = { id: id('run'), task_id: taskId, plan_hash: plan.hash, status: 'running', grant_id: grant.id, completed_steps: {}, current_attempt: null, accepted_asset_id: null, delivery: null, pending_delivery: null, created_at: now() };
    this.store.transaction(() => {
      this.store.expect('task', taskId, expected);
      requireThat(!task.data.active_run || ['failed', 'cancelled', 'completed'].includes(this.store.get<Run>('run', task.data.active_run).data.status), 'RUN_ACTIVE', '已有未结束运行；先查看或取消', 1);
      this.validGrant(plan, grant.id);
      requireThat(!this.store.list<Run>('run').some((item) => item.data.grant_id === grant.id), 'GRANT_ALREADY_USED', '此授权已绑定一次运行；新运行需要新的实际确认回执', 1);
      this.store.insert('run', run.id, run); task.data.active_run = run.id; this.store.update('task', taskId, task.data, expected);
      const inputEvent = this.store.event('input.verified', { plan_hash: plan.hash, asset_id: plan.working_asset_id }, taskId, run.id);
      this.store.enqueue(run.id, 'input', inputEvent);
      const grantEvent = this.store.event('grant.bound', { plan_hash: plan.hash, grant_id: grant.id }, taskId, run.id);
      this.store.enqueue(run.id, 'grant', grantEvent);
    });
    return { ...this.status(run.id), warnings: await this.softSync(plan, run.id) };
  }
  async softSync(plan: Plan, runId: string): Promise<string[]> {
    try { await this.ygl.sync(plan, runId); return []; }
    catch (error) { return ['ygl_sync_pending: ' + (error as Error).message]; }
  }
  runPlan(run: Run, current = true): Plan {
    const plan = this.store.get<Plan>('plan', run.plan_hash).data;
    if (current) {
      const task = this.store.get<Task>('task', run.task_id).data;
      requireThat(task.active_plan === run.plan_hash && task.requirements_hash === plan.requirements_hash && task.active_run === run.id, 'STALE_RUN', '需求、计划或运行已改变，旧运行只供查看与结果对账', 1);
    }
    return plan;
  }
  status(runId: string): Result {
    const entity = this.store.get<Run>('run', runId), run = entity.data, plan = this.runPlan(run, false);
    const attempt = run.current_attempt ? this.store.get<Attempt>('attempt', run.current_attempt) : null;
    const result: Result = { result_status: run.status, data: { run_id: run.id, run_revision: entity.revision, task_id: run.task_id, plan_hash: run.plan_hash, mode: this.store.config.mode, executor: plan.executor,
      run, attempt: attempt?.data ?? null, input: attempt ? this.assetView(attempt.data.input_asset_id) : null,
      candidate: attempt?.data.output_asset_id ? this.assetView(attempt.data.output_asset_id) : null,
      raw_host_result: attempt?.data.raw_output_asset_id ? this.assetView(attempt.data.raw_output_asset_id) : null,
      ygl_sync: this.store.pending(run.id).length ? 'pending' : 'in_sync', pending_evidence: this.store.pending(run.id).length } };
    const type = this.store.pending(run.id).length && run.status === 'running' ? 'ygl.sync' : run.status === 'waiting_for_host' ? 'host.image_edit' : run.status === 'waiting_for_step_review' ? 'host.visual_review' : run.status === 'waiting_for_review' ? 'human.final_review' : run.status === 'accepted' ? 'artifact.deliver' : run.status === 'unknown' ? 'run.reconcile' : run.status === 'delivering' ? 'run.resume' : ['failed', 'cancelled'].includes(run.status) ? 'plan.revise' : run.status === 'completed' ? 'delivery.inspect' : 'run.advance';
    result.next_actions = [{ type, reason: run.status === 'unknown' ? '保留原请求，补回结果或核对宿主执行事实；不自动重发' : '按当前运行状态继续', ...(attempt ? { attempt_id: attempt.data.id, request_file: path.join(this.store.root, attempt.data.request_path) } : {}) }];
    return result;
  }
  timeline(runId: string): Result {
    this.store.get<Run>('run', runId);
    const events = this.store.db.prepare('SELECT id,kind,document,created_at FROM events WHERE run_id=? ORDER BY rowid').all(runId).map((event) => ({ ...event, document: JSON.parse(String(event.document)) }));
    return { result_status: 'recorded', data: { run_id: runId, events } };
  }
  next(taskId: string): Result {
    const task = this.store.get<Task>('task', taskId);
    if (!task.data.requirements.some((group) => active(group) && group.scope === 'operation')) return { result_status: 'waiting_for_input', data: { task_id: taskId, revision: task.revision }, next_actions: [{ type: 'requirement.set', reason: '先填写需要修改的部位与要求' }] };
    if (!task.data.active_plan) return { result_status: 'waiting_for_plan', data: { task_id: taskId, revision: task.revision }, next_actions: [{ type: 'plan.submit', reason: '明确区域与图像承接，提交可审阅计划' }] };
    if (task.data.active_run && this.store.get<Run>('run', task.data.active_run).data.plan_hash === task.data.active_plan) return this.status(task.data.active_run);
    try { this.validGrant(this.currentPlan(taskId)); }
    catch { return { result_status: 'waiting_for_approval', data: { task_id: taskId, revision: task.revision, plan_hash: task.data.active_plan }, next_actions: [{ type: 'approval.grant', reason: '请用户审阅范围、执行方式和交付目标，记录实际确认' }] }; }
    return { result_status: 'ready', data: { task_id: taskId, revision: task.revision }, next_actions: [{ type: 'run.start', reason: '已有当前计划授权，可建立运行' }] };
  }
  async synchronize(taskId: string): Promise<Result> {
    const plan = this.currentPlan(taskId); await this.ygl.ensurePlan(plan);
    for (const entity of this.store.list<Run>('run')) if (entity.data.task_id === taskId && entity.data.plan_hash === plan.hash) await this.ygl.sync(plan, entity.data.id);
    return { result_status: 'in_sync', data: { task_id: taskId, plan_hash: plan.hash } };
  }
  requestId(value: string): string {
    requireThat(typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value), 'REQUEST_ID', 'request-id 需要 1–128 位字母、数字或 _.:-');
    return value;
  }
  async advance(runId: string, expected: number, requestId: string): Promise<Result> {
    this.requestId(requestId);
    const intent = hash({ command: 'run.advance', run_id: runId, expected_revision: expected });
    const replay = this.store.replay(requestId, intent); if (replay) return replay;
    const initial = this.store.expect<Run>('run', runId, expected), plan = this.runPlan(initial.data);
    if (initial.data.status !== 'running') return this.status(runId);
    this.validGrant(plan, initial.data.grant_id);
    const step = plan.steps.find((item) => !completedOutput(initial.data, item.id));
    requireThat(step, 'NO_READY_STEP', '没有待执行的图像步骤', 1);
    for (const parent of step.needs) requireThat(completedOutput(initial.data, parent), 'DEPENDENCY_MISSING', '前序缺少通过检查的结果', 1);
    await this.ygl.sync(plan, runId);
    requireThat(await this.ygl.can(plan, runId, 'edit-' + step.id), 'YGL_GATE_BLOCKED', '依赖门槛未满足', 1);
    const inputId = step.input === 'original' ? plan.working_asset_id : completedOutput(initial.data, step.input.slice(5));
    requireThat(inputId, 'MISSING_INPUT', '缺少本步工作图', 1);
    await this.store.assetBytes(inputId);
    const prepared = this.store.transaction(() => {
      const replay = this.store.replay(requestId, intent); if (replay) return { result: replay, attempt: null };
      const current = this.store.expect<Run>('run', runId, expected);
      this.runPlan(current.data); this.validGrant(plan, current.data.grant_id);
      requireThat(current.data.status === 'running' && (!current.data.current_attempt || this.store.get<Attempt>('attempt', current.data.current_attempt).data.status === 'succeeded'), 'STEP_BUSY', '已有步骤正在执行或等待结果', 1);
      const attempt: Attempt = { id: id('attempt'), run_id: runId, task_id: plan.task_id, step_id: step.id, request_id: requestId, intent_hash: intent, input_asset_id: inputId, plan_hash: plan.hash,
        executor: plan.executor, status: 'prepared', output_asset_id: null, raw_output_asset_id: null, report: null, request_path: '', created_at: now(), owner_pid: process.pid };
      attempt.request_path = ['runs', runId, attempt.id, 'host-request.json'].join('/');
      this.store.insert('attempt', attempt.id, attempt);
      current.data.current_attempt = attempt.id;
      this.store.update('run', runId, current.data, expected);
      this.store.event('execution.prepared', { attempt_id: attempt.id, step_id: step.id, input_asset_id: inputId, plan_hash: plan.hash, executor: plan.executor }, plan.task_id, runId);
      const result = this.status(runId); result.result_status = 'prepared';
      result.next_actions = [{ type: 'run.resume', reason: '已持久化执行意图；中断后继续同一尝试' }];
      this.store.remember(requestId, intent, result);
      return { result, attempt };
    });
    if (!prepared.attempt) return prepared.result;
    try { await this.afterPrepare?.(); return await this.processPrepared(prepared.attempt.id); }
    catch (error) { throw this.committedError(error, runId, prepared.attempt.id); }
  }
  committedError(error: unknown, runId: string, attemptId: string) {
    const known = error instanceof RetouchError ? error : new RetouchError('EXECUTION_ERROR', (error as Error).message);
    return new RetouchError(known.code, known.message, known.exitCode, { run_id: runId, attempt_id: attemptId, recover_with: 'run.status then run.resume/reconcile', cause: known.details }, 'committed');
  }
  async processPrepared(attemptId: string): Promise<Result> {
    requireThat(!this.processing.has(attemptId), 'STEP_BUSY', '本进程已在处理该尝试', 1);
    this.processing.add(attemptId);
    try {
      const entity = this.store.get<Attempt>('attempt', attemptId), attempt = entity.data;
      requireThat(attempt.status === 'prepared' && attempt.owner_pid === process.pid, 'STEP_BUSY', '没有此步骤的有效执行租约', 1);
      const run = this.store.get<Run>('run', attempt.run_id).data, plan = this.runPlan(run), step = plan.steps.find((item) => item.id === attempt.step_id)!;
      this.validGrant(plan, run.grant_id);
      if (attempt.executor === 'host') {
        const files = await this.images.regionFiles(attempt.input_asset_id, step.region);
        const request = { schema_version: 'retouch.host-request/v1', request_id: attempt.request_id, attempt_id: attempt.id, run_id: run.id, task_id: run.task_id, plan_hash: plan.hash, step_id: step.id,
          input: this.assetView(attempt.input_asset_id), references: step.reference_asset_ids.map((assetId) => this.assetView(assetId)), region: step.region,
          mask: { ...this.assetView(files.mask.id), convention: 'white=may_edit; black=preserve' }, region_preview: this.assetView(files.preview.id), prompt: step.prompt,
          execution_policy: { preferred: 'host_builtin_image_tool', api_fallback: 'explicit_opt_in_only_not_implemented', preserve_mode: 'composite_approved_rectangle_then_review', host_usage: 'managed_by_host_not_metered_by_cli' },
          result_contract: { schema_version: 'retouch.host-result/v1', request_id: attempt.request_id, plan_hash: plan.hash, step_id: step.id, input_sha256: this.assetView(attempt.input_asset_id).sha256, output_file: '<actual-local-output-file>', tool: '<actual-host-tool>', tool_receipt: '<actual-tool-receipt-or-observation>' },
          continuation: 'Verify tool availability; run dispatch before invoking the image tool once. On interruption reconcile the same attempt. Complete imports actual bytes; then inspect the composite and submit a bound step review.' };
        await this.store.immutableFile(attempt.request_path, Buffer.from(JSON.stringify(request, null, 2) + '\n'));
        this.store.transaction(() => {
          const current = this.store.get<Run>('run', run.id), latest = this.store.get<Attempt>('attempt', attempt.id);
          requireThat(latest.revision === entity.revision && latest.data.status === 'prepared', 'REVISION_CONFLICT', '步骤已发生变化', 1);
          latest.data.status = 'waiting_for_host'; latest.data.owner_pid = null;
          if (current.data.status !== 'cancelled') current.data.status = 'waiting_for_host';
          this.store.update('attempt', attempt.id, latest.data, latest.revision); this.store.update('run', run.id, current.data, current.revision);
          this.store.event('host.request.ready', { attempt_id: attempt.id, request_path: attempt.request_path, submitted_to_tool: false }, run.task_id, run.id);
          this.store.replaceResult(attempt.request_id, attempt.intent_hash, this.status(run.id));
        });
        return this.status(run.id);
      }
      const output = await this.images.fill(attempt.input_asset_id, step);
      const report = await this.images.compare(attempt.input_asset_id, output.id, step.region, 'NOT_APPLICABLE', '离线测试仅验证局部图像处理与来源链；未执行 AI 语义修图。', 'deterministic-offline-provider', true);
      this.store.transaction(() => {
        const current = this.store.get<Run>('run', run.id), latest = this.store.get<Attempt>('attempt', attempt.id);
        requireThat(latest.revision === entity.revision && latest.data.status === 'prepared', 'REVISION_CONFLICT', '步骤已发生变化', 1);
        latest.data.output_asset_id = output.id; latest.data.report = report; latest.data.owner_pid = null;
        const received = this.store.event('image.received', { attempt_id: attempt.id, input_asset_id: attempt.input_asset_id, output_asset_id: output.id, output_sha256: output.sha256, provider: 'offline-demo', api_cost: 0 }, run.task_id, run.id);
        this.store.enqueue(run.id, 'edit-' + step.id, received);
        const passed = report.hard_verdict === 'PASS';
        const cancelled = current.data.status === 'cancelled';
        latest.data.status = cancelled ? 'received' : passed ? 'succeeded' : 'failed';
        if (!cancelled) {
          if (passed) current.data.completed_steps[step.id] = output.id;
          current.data.status = !passed ? 'failed' : plan.steps.every((item) => completedOutput(current.data, item.id)) ? 'waiting_for_review' : 'running';
          const checked = this.store.event(passed ? 'quality.passed' : 'quality.failed', { attempt_id: attempt.id, report }, run.task_id, run.id);
          if (passed) this.store.enqueue(run.id, 'qa-' + step.id, checked);
        }
        this.store.update('attempt', attempt.id, latest.data, latest.revision); this.store.update('run', run.id, current.data, current.revision);
        this.store.replaceResult(attempt.request_id, attempt.intent_hash, this.status(run.id));
      });
      const warnings = await this.softSync(plan, run.id);
      const result = { ...this.status(run.id), warnings };
      this.store.transaction(() => this.store.replaceResult(attempt.request_id, attempt.intent_hash, result));
      return result;
    } finally { this.processing.delete(attemptId); }
  }
  async resume(runId: string, expected: number): Promise<Result> {
    const run = this.store.expect<Run>('run', runId, expected);
    if (run.data.status === 'delivering') return this.finishDelivery(runId);
    if (run.data.status !== 'running' || !run.data.current_attempt) return this.status(runId);
    const attempt = this.store.get<Attempt>('attempt', run.data.current_attempt);
    if (attempt.data.status !== 'prepared') return this.status(runId);
    requireThat(!this.processing.has(attempt.data.id), 'STEP_BUSY', '步骤仍在处理', 1);
    if (attempt.data.owner_pid !== null && attempt.data.owner_pid !== process.pid) {
      let alive = true;
      try { process.kill(attempt.data.owner_pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false; }
      requireThat(!alive, 'STEP_BUSY', '原执行进程仍存活，不能抢占租约', 1);
    }
    this.runPlan(run.data); this.validGrant(this.runPlan(run.data), run.data.grant_id);
    this.store.transaction(() => {
      this.store.expect('run', runId, expected); this.store.expect('attempt', attempt.data.id, attempt.revision);
      attempt.data.owner_pid = process.pid;
      this.store.update('attempt', attempt.data.id, attempt.data, attempt.revision); this.store.update('run', runId, run.data, expected);
      this.store.event('execution.resumed', { attempt_id: attempt.data.id, request_id: attempt.data.request_id, new_external_request: false }, run.data.task_id, runId);
    });
    try { return await this.processPrepared(attempt.data.id); }
    catch (error) { throw this.committedError(error, runId, attempt.data.id); }
  }
  dispatch(runId: string, expected: number, requestId: string): Result {
    this.requestId(requestId); const intent = hash({ command: 'run.dispatch', run_id: runId, expected_revision: expected });
    return this.store.transaction(() => {
      const replay = this.store.replay(requestId, intent); if (replay) return replay;
      const run = this.store.expect<Run>('run', runId, expected), plan = this.runPlan(run.data);
      this.validGrant(plan, run.data.grant_id);
      requireThat(run.data.status === 'waiting_for_host' && run.data.current_attempt, 'HOST_STATE', '没有可派发的宿主任务', 1);
      const attempt = this.store.get<Attempt>('attempt', run.data.current_attempt);
      requireThat(attempt.data.status === 'waiting_for_host', 'HOST_STATE', '任务已派发或结果未知，禁止盲目重发', 1);
      attempt.data.status = 'unknown'; run.data.status = 'unknown';
      this.store.update('attempt', attempt.data.id, attempt.data, attempt.revision); this.store.update('run', runId, run.data, expected);
      this.store.event('host.execution.intent', { attempt_id: attempt.data.id, note: '已记录一次宿主执行意图；工具结果回接前视为未知，不能据此宣称已提交。' }, run.data.task_id, runId);
      const result = this.status(runId); result.result_status = 'host_execution_authorized_once';
      result.next_actions = [{ type: 'host.execute_once', reason: '仅首次非重放响应可调用已核实可用的宿主图像工具；随后回接同一请求的结果', request_file: path.join(this.store.root, attempt.data.request_path) }];
      this.store.remember(requestId, intent, result); return result;
    });
  }
  async complete(runId: string, value: unknown, expected: number, requestId: string): Promise<Result> {
    this.requestId(requestId);
    const receipt = object(value, ['schema_version', 'request_id', 'plan_hash', 'step_id', 'input_sha256', 'output_file', 'tool', 'tool_receipt'], '宿主结果');
    const intent = hash({ command: 'run.complete', run_id: runId, expected_revision: expected, receipt });
    const replay = this.store.replay(requestId, intent); if (replay) return replay;
    const run = this.store.expect<Run>('run', runId, expected), plan = this.runPlan(run.data, false);
    requireThat(run.data.current_attempt && ['waiting_for_host', 'unknown', 'cancelled'].includes(run.data.status), 'HOST_STATE', '当前运行没有等待回接的宿主任务', 1);
    const attempt = this.store.get<Attempt>('attempt', run.data.current_attempt), step = plan.steps.find((item) => item.id === attempt.data.step_id)!;
    const input = this.store.get<Asset>('asset', attempt.data.input_asset_id).data;
    requireThat(receipt.schema_version === 'retouch.host-result/v1' && attempt.data.executor === 'host' && receipt.request_id === attempt.data.request_id && receipt.plan_hash === plan.hash && receipt.step_id === step.id && receipt.input_sha256 === input.sha256, 'RESULT_BINDING', '结果与原请求、计划或输入图像不匹配');
    requireThat(['waiting_for_host', 'unknown'].includes(attempt.data.status), 'RESULT_ALREADY_RECEIVED', '此尝试已有结果', 1);
    text(receipt.tool, 'tool', 120); receiptText(receipt.tool_receipt, 'tool_receipt');
    const received = await this.images.import(text(receipt.output_file, 'output_file'));
    const output = await this.images.composite(input.id, received.working.id, step.region);
    const report = await this.images.compare(input.id, output.id, step.region, 'UNKNOWN', '需要查看合成后的实际候选图并绑定检查结论。', String(receipt.tool), false);
    this.store.transaction(() => {
      const replay = this.store.replay(requestId, intent); if (replay) return;
      const current = this.store.expect<Run>('run', runId, expected); this.store.expect('attempt', attempt.data.id, attempt.revision);
      attempt.data.output_asset_id = output.id; attempt.data.raw_output_asset_id = received.original.id; attempt.data.report = report;
      attempt.data.status = report.hard_verdict === 'PASS' ? 'waiting_for_review' : 'failed';
      if (current.data.status !== 'cancelled') current.data.status = report.hard_verdict === 'PASS' ? 'waiting_for_step_review' : 'failed';
      this.store.update('attempt', attempt.data.id, attempt.data, attempt.revision); this.store.update('run', runId, current.data, expected);
      const event = this.store.event('host.image.received', { attempt_id: attempt.data.id, receipt, original_result_asset_id: received.original.id, candidate_asset_id: output.id, composite_region: step.region, report }, run.data.task_id, runId);
      this.store.enqueue(runId, 'edit-' + step.id, event);
      this.store.remember(requestId, intent, this.status(runId));
    });
    const result = { ...this.status(runId), warnings: await this.softSync(plan, runId) };
    this.store.transaction(() => this.store.replaceResult(requestId, intent, result));
    return result;
  }
  async reviewStep(runId: string, value: unknown, expected: number, requestId: string): Promise<Result> {
    this.requestId(requestId);
    const receipt = object(value, ['schema_version', 'attempt_id', 'plan_hash', 'input_sha256', 'output_sha256', 'verdict', 'observations', 'reviewer'], '步骤检查');
    const intent = hash({ command: 'run.review', run_id: runId, expected_revision: expected, receipt });
    const replay = this.store.replay(requestId, intent); if (replay) return replay;
    const run = this.store.expect<Run>('run', runId, expected), plan = this.runPlan(run.data);
    requireThat(run.data.status === 'waiting_for_step_review' && run.data.current_attempt, 'REVIEW_STATE', '没有待检查的实际候选图', 1);
    const attempt = this.store.get<Attempt>('attempt', run.data.current_attempt), report = attempt.data.report;
    requireThat(report && receipt.schema_version === 'retouch.step-review/v1' && receipt.attempt_id === attempt.data.id && receipt.plan_hash === plan.hash && receipt.input_sha256 === report.input_sha256 && receipt.output_sha256 === report.output_sha256, 'REVIEW_BINDING', '检查结论必须绑定实际合成候选与当前输入');
    requireThat(['PASS', 'FAIL', 'UNKNOWN'].includes(receipt.verdict as string), 'INVALID_VERDICT', '检查结果支持 PASS、FAIL 或 UNKNOWN');
    receiptText(receipt.observations, 'observations'); text(receipt.reviewer, 'reviewer', 120);
    await this.store.assetBytes(attempt.data.output_asset_id!);
    this.store.transaction(() => {
      this.store.expect('run', runId, expected); this.store.expect('attempt', attempt.data.id, attempt.revision);
      report.semantic_verdict = receipt.verdict as 'PASS' | 'FAIL' | 'UNKNOWN'; report.semantic_observations = String(receipt.observations); report.reviewer = String(receipt.reviewer);
      const passed = report.hard_verdict === 'PASS' && receipt.verdict === 'PASS';
      if (passed) run.data.completed_steps[attempt.data.step_id] = attempt.data.output_asset_id!;
      attempt.data.status = passed ? 'succeeded' : receipt.verdict === 'UNKNOWN' ? 'waiting_for_review' : 'failed';
      run.data.status = passed ? plan.steps.every((step) => completedOutput(run.data, step.id)) ? 'waiting_for_review' : 'running' : receipt.verdict === 'UNKNOWN' ? 'waiting_for_step_review' : 'failed';
      this.store.update('attempt', attempt.data.id, attempt.data, attempt.revision); this.store.update('run', runId, run.data, expected);
      const event = this.store.event(passed ? 'host.quality.passed' : 'host.quality.unresolved', { attempt_id: attempt.data.id, report }, run.data.task_id, runId);
      if (passed) this.store.enqueue(runId, 'qa-' + attempt.data.step_id, event);
      this.store.remember(requestId, intent, this.status(runId));
    });
    const result = { ...this.status(runId), warnings: await this.softSync(plan, runId) };
    this.store.transaction(() => this.store.replaceResult(requestId, intent, result));
    return result;
  }
  cancel(runId: string, expected: number): Result {
    return this.store.transaction(() => {
      const run = this.store.expect<Run>('run', runId, expected);
      requireThat(run.data.status !== 'completed', 'DELIVERY_COMMITTED', '运行已交付，不能抹除已发生事实', 1);
      run.data.status = 'cancelled'; this.store.update('run', runId, run.data, expected);
      this.store.event('cancel.requested', { prevents_new_steps: true, submitted_host_tool_cancellation: 'NOT_CLAIMED' }, run.data.task_id, runId);
      return this.status(runId);
    });
  }
  async finalReview(runId: string, value: unknown, expected: number, requestId: string): Promise<Result> {
    this.requestId(requestId);
    const receipt = object(value, ['schema_version', 'run_id', 'plan_hash', 'output_sha256', 'verdict', 'issuer', 'confirmation'], '最终验收');
    const intent = hash({ command: 'review.submit', run_id: runId, expected_revision: expected, receipt });
    const replay = this.store.replay(requestId, intent); if (replay) return replay;
    const run = this.store.expect<Run>('run', runId, expected), plan = this.runPlan(run.data);
    requireThat(run.data.status === 'waiting_for_review' && plan.steps.every((step) => completedOutput(run.data, step.id)), 'FINAL_REVIEW_STATE', '全部步骤通过检查后才能终验', 1);
    const outputId = completedOutput(run.data, plan.steps.at(-1)!.id)!, output = this.store.get<Asset>('asset', outputId).data;
    requireThat(receipt.schema_version === 'retouch.final-review/v1' && receipt.run_id === runId && receipt.plan_hash === plan.hash && receipt.output_sha256 === output.sha256, 'FINAL_REVIEW_BINDING', '终验必须绑定当前运行和实际候选图');
    requireThat(receipt.verdict === 'accept' || receipt.verdict === 'reject', 'INVALID_VERDICT', '终验需要 accept 或 reject');
    requireThat(['human', 'host-human', 'demo'].includes(receipt.issuer as string) && (receipt.issuer !== 'demo' || this.store.config.mode === 'demo'), 'INVALID_ISSUER', '最终验收须来自用户确认；demo 仅用于演示');
    receiptText(receipt.confirmation, 'confirmation');
    await this.store.assetBytes(outputId); await this.ygl.sync(plan, runId);
    requireThat(await this.ygl.can(plan, runId, 'accept'), 'YGL_GATE_BLOCKED', '验收前序证据未齐备', 1);
    this.store.transaction(() => {
      this.store.expect('run', runId, expected); this.runPlan(run.data);
      run.data.status = receipt.verdict === 'accept' ? 'accepted' : 'failed'; run.data.accepted_asset_id = receipt.verdict === 'accept' ? outputId : null;
      this.store.update('run', runId, run.data, expected);
      const event = this.store.event(receipt.verdict === 'accept' ? 'human.accepted' : 'human.rejected', { receipt, asset_id: outputId, scope: this.store.config.mode }, run.data.task_id, runId);
      if (receipt.verdict === 'accept') this.store.enqueue(runId, 'accept', event);
      this.store.remember(requestId, intent, this.status(runId));
    });
    const result = { ...this.status(runId), warnings: await this.softSync(plan, runId) };
    this.store.transaction(() => this.store.replaceResult(requestId, intent, result));
    return result;
  }
  async deliver(runId: string, destination: string, expected: number, requestId: string): Promise<Result> {
    this.requestId(requestId);
    const directory = path.resolve(destination), intent = hash({ command: 'deliver', run_id: runId, directory, expected_revision: expected });
    const replay = this.store.replay(requestId, intent);
    if (replay) return replay.result_status === 'delivery_prepared' ? this.finishDelivery(runId) : replay;
    const run = this.store.expect<Run>('run', runId, expected), plan = this.runPlan(run.data), grant = this.validGrant(plan, run.data.grant_id);
    requireThat(run.data.status === 'accepted' && run.data.accepted_asset_id, 'ACCEPTANCE_REQUIRED', '交付前需要指定图像的最终接受', 1);
    requireThat(directory.startsWith(grant.delivery_root + path.sep), 'DELIVERY_SCOPE', '交付路径超出授权范围');
    requireThat(!(await fs.access(directory).then(() => true, () => false)), 'DELIVERY_EXISTS', '目标已存在，拒绝覆盖', 1);
    await this.store.assetBytes(run.data.accepted_asset_id);
    await this.ygl.sync(plan, runId); requireThat(await this.ygl.can(plan, runId, 'deliver'), 'YGL_GATE_BLOCKED', '交付前置未满足', 1);
    const asset = this.store.get<Asset>('asset', run.data.accepted_asset_id).data;
    const manifest = { schema_version: 'retouch.delivery/v1', delivery_id: id('delivery'), task_id: run.data.task_id, run_id: runId, plan_hash: plan.hash, workspace_id: this.store.config.id,
      mode: this.store.config.mode, asset_id: asset.id, image_file: 'image.png', sha256: asset.sha256, original_asset_id: plan.original_asset_id,
      steps: plan.steps.map((step) => ({ step_id: step.id, output_asset_id: completedOutput(run.data, step.id)! })), created_at: now(), image_generation: plan.executor === 'offline' ? 'NOT_RUN_OFFLINE_DEMO' : 'HOST_RESULT_IMPORTED' };
    this.store.transaction(() => {
      this.store.expect('run', runId, expected); this.runPlan(run.data);
      run.data.status = 'delivering'; run.data.pending_delivery = { request_id: requestId, intent_hash: intent, directory, manifest };
      this.store.update('run', runId, run.data, expected);
      this.store.event('delivery.prepared', { directory, manifest }, run.data.task_id, runId);
      const result = this.status(runId); result.result_status = 'delivery_prepared';
      this.store.remember(requestId, intent, result);
    });
    return this.finishDelivery(runId);
  }
  async finishDelivery(runId: string): Promise<Result> {
    const run = this.store.get<Run>('run', runId), pending = run.data.pending_delivery;
    requireThat(pending && run.data.accepted_asset_id && run.data.status === 'delivering', 'DELIVERY_STATE', '没有可恢复的交付', 1);
    const grant = this.store.get<Grant>('grant', run.data.grant_id).data;
    const parent = path.dirname(pending.directory), exportsRoot = await fs.realpath(path.join(this.store.root, 'exports'));
    requireThat(exportsRoot === path.join(this.store.root, 'exports') && pending.directory.startsWith(grant.delivery_root + path.sep), 'DELIVERY_SCOPE', '交付目录绑定不符', 1);
    await this.store.safeDirectory(path.relative(this.store.root, parent));
    const canonicalParent = await fs.realpath(parent);
    requireThat(canonicalParent === exportsRoot || canonicalParent.startsWith(exportsRoot + path.sep), 'DELIVERY_SCOPE', '交付路径链接越出 exports', 1);
    const owner = { delivery_id: pending.manifest.delivery_id, request_id: pending.request_id, plan_hash: run.data.plan_hash };
    const marker = path.join(pending.directory, '.retouch-delivery-owner.json');
    try { await fs.mkdir(pending.directory); await fs.writeFile(marker, stable(owner), { flag: 'wx' }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      requireThat(!(await fs.lstat(pending.directory)).isSymbolicLink() && stable(JSON.parse(await fs.readFile(marker, 'utf8'))) === stable(owner), 'DELIVERY_OWNER', '已有目录不属于本次交付，不覆盖', 1);
    }
    const bytes = await this.store.assetBytes(run.data.accepted_asset_id);
    const imageFile = path.join(pending.directory, 'image.png'), manifestFile = path.join(pending.directory, 'manifest.json');
    try { await fs.writeFile(imageFile, bytes, { flag: 'wx' }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; requireThat(!(await fs.lstat(imageFile)).isSymbolicLink() && bytesHash(await fs.readFile(imageFile)) === bytesHash(bytes), 'DELIVERY_CONFLICT', '已有图片与交付内容不同', 1); }
    const manifestBytes = Buffer.from(JSON.stringify(pending.manifest, null, 2) + '\n');
    const staged = await this.store.immutableFile('tmp/' + String(pending.manifest.delivery_id) + '/manifest.json', manifestBytes);
    try { await fs.link(staged, manifestFile); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; requireThat(!(await fs.lstat(manifestFile)).isSymbolicLink() && bytesHash(await fs.readFile(manifestFile)) === bytesHash(manifestBytes), 'DELIVERY_CONFLICT', '已有清单与本次交付不同', 1); }
    requireThat(bytesHash(await fs.readFile(imageFile)) === pending.manifest.sha256, 'DELIVERY_CORRUPTED', '交付图像 hash 不匹配', 1);
    this.store.transaction(() => {
      const current = this.store.get<Run>('run', runId);
      if (!current.data.pending_delivery) { requireThat(current.data.delivery?.manifest_sha256 === bytesHash(manifestBytes), 'DELIVERY_CONFLICT', '交付状态已变化', 1); return; }
      requireThat(current.data.pending_delivery.request_id === pending.request_id, 'DELIVERY_CONFLICT', '交付意图已变化', 1);
      current.data.delivery = { directory: pending.directory, asset_id: current.data.accepted_asset_id!, manifest_sha256: bytesHash(manifestBytes) };
      current.data.pending_delivery = null;
      if (current.data.status === 'delivering') current.data.status = 'completed';
      this.store.update('run', runId, current.data, current.revision);
      const event = this.store.event('delivery.committed', { manifest: pending.manifest, directory: pending.directory, manifest_sha256: bytesHash(manifestBytes) }, current.data.task_id, runId);
      this.store.enqueue(runId, 'deliver', event);
      this.store.replaceResult(pending.request_id, pending.intent_hash, this.status(runId));
    });
    const result = { ...this.status(runId), warnings: await this.softSync(this.runPlan(run.data, false), runId) };
    this.store.transaction(() => this.store.replaceResult(pending.request_id, pending.intent_hash, result));
    return result;
  }
  async inspect(assetId: string): Promise<Result> {
    const bytes = await this.store.assetBytes(assetId); await this.images.metadata(bytes);
    return { result_status: 'verified', data: { asset: this.assetView(assetId), identity_verdict: 'PASS' } };
  }
  async doctor(): Promise<Result> {
    const checks: { name: string; verdict: string; detail: string }[] = [];
    for (const entity of this.store.list<Asset>('asset')) {
      try { await this.store.assetBytes(entity.data.id); checks.push({ name: entity.data.id, verdict: 'PASS', detail: 'CAS 身份匹配' }); }
      catch (error) { checks.push({ name: entity.data.id, verdict: 'FAIL', detail: (error as Error).message }); }
    }
    let ygl: unknown;
    try { const adapter = new Ygl(this.store); await adapter.verifyBinding(); ygl = await adapter.call(['doctor']); }
    catch (error) { checks.push({ name: 'ygl', verdict: 'FAIL', detail: (error as Error).message }); }
    if (Array.isArray(ygl)) for (const item of ygl) checks.push({ name: 'ygl.' + item.name, verdict: item.status === 'pass' ? 'PASS' : item.status === 'warn' ? 'WARN' : 'FAIL', detail: item.detail });
    return { result_status: checks.some((item) => item.verdict === 'FAIL') ? 'unhealthy' : 'healthy', data: { workspace_id: this.store.config.id, checks, host_tool_availability: 'REPORTED_BY_HOST_AT_EXECUTION_TIME', api_fallback: 'not_configured' } };
  }
}
