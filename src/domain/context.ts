import { hash, requireThat, type Task, type Plan } from './model.ts';

export const CONTEXT_SCHEMA = 'retouch.context/v1';
export const RELATIONS = ['serves', 'implements', 'input-for', 'reference-for', 'derived-from', 'produced-by', 'reviewed-by', 'supersedes', 'based-on', 'depends-on'] as const;
export type RelationType = typeof RELATIONS[number];
export type FactRole = 'user_original' | 'confirmed_fact' | 'assumption' | 'ai_generated' | 'derived' | 'reference' | 'pending';
export interface Project { id: string; name: string; original_intent: string; business_object: string; status: 'active' | 'archived'; goal_heads: Record<string, number>; created_at: string }
export interface Goal { id: string; project_id: string; version: number; original_text: string; interpretation: string; scope: string; preserve: string; acceptance: string; confirmation: 'pending' | 'confirmed'; confirmation_source: string; created_at: string }
export interface Design { id: string; project_id: string; task_id: string; goal_id: string; goal_version: number; family_id: string; version: number; artifact_id: string; supersedes: string | null; facts: { text: string; role: FactRole; source_artifact_id: string | null; confirmation_source: string }[]; status: 'draft' | 'confirmed' | 'needs_review'; confirmation_source: string; created_at: string }
export interface Artifact { id: string; project_id: string; task_id: string; goal_id: string; goal_version: number; type: 'image' | 'document' | 'prompt' | 'spec' | 'receipt' | 'evidence'; purpose: 'original' | 'working' | 'reference' | 'model_output' | 'postprocessed' | 'candidate' | 'design' | 'prompt' | 'evidence' | 'delivery'; version: number; sha256: string; bytes: number; object_path: string; asset_id: string | null; mime: string; width: number | null; height: number | null; status: 'input' | 'draft' | 'candidate' | 'accepted' | 'delivered' | 'rejected' | 'needs_review'; fact_role: FactRole; source: string; created_at: string }
export interface Execution { id: string; project_id: string; task_id: string; goal_id: string; goal_version: number; request_id: string; channel: string; operation: string; scope: string; input_artifact_ids: string[]; output_artifact_ids: string[]; status: 'intent' | 'unknown' | 'received' | 'cancelled'; recovery_note: string; source: string; occurred_at: string; created_at: string }
export interface ArtifactReview { id: string; project_id: string; task_id: string; goal_id: string; goal_version: number; artifact_id: string; artifact_sha256: string; verdict: 'accept' | 'reject' | 'PASS' | 'FAIL' | 'UNKNOWN'; issuer: 'human' | 'host-human' | 'agent' | 'demo'; confirmation: string; source: string; created_at: string }
export interface Relation { id: string; project_id: string; src: string; dst: string; rel: RelationType; created_at: string }
export interface Provenance { id: string; project_id: string; task_id: string | null; text: string; role: FactRole; source: string; confirmation_source: string; created_at: string }
export interface ContextRecord { kind: string; id: string; revision: number; data: Record<string, any> }
export interface Diagnostic { code: string; object: string; message: string; repair: string }
export const CONTEXT_KINDS = ['project', 'goal', 'task', 'design', 'artifact', 'execution', 'review', 'relation', 'provenance', 'asset', 'plan', 'grant', 'run', 'attempt'] as const;
export const goalKey = (id: string, version: number) => id + '@' + version;
export const recordKey = (kind: string, id: string) => kind + ':' + id;
export const relationId = (project: string, src: string, dst: string, rel: string) => 'rel_' + hash({ project, src, dst, rel });
export const objectPath = (sha: string) => 'objects/sha256/' + sha.slice(0, 2) + '/' + sha;

export function planMatchesTask(plan: Plan, task: Task): boolean {
  return Boolean(task.project_id && plan.project_id === task.project_id && plan.task_id === task.id && plan.goal_id === task.goal_id && plan.goal_version === task.goal_version && (plan.design_id ?? null) === (task.active_design ?? null));
}
export function taskProgress(records: ContextRecord[], taskId: string): { status: string; next: string; blocking_reason: string } {
  const task = records.find(r => r.kind === 'task' && r.id === taskId)!.data as Task;
  const executions = records.filter(r => r.kind === 'execution' && r.data.task_id === taskId);
  if (executions.some(e => ['unknown', 'intent'].includes(e.data.status))) return { status: 'unknown', next: 'execution.reconcile', blocking_reason: '外部请求待对账；禁止自动重发' };
  const run = records.find(r => r.kind === 'run' && r.id === task.active_run)?.data;
  if (run?.status === 'unknown') return { status: 'unknown', next: 'run.reconcile', blocking_reason: '原宿主请求仍未知；先回接原结果或对账，目标变更不能使其消失' };
  if (!task.project_id || !task.goal_id) return { status: 'unassigned', next: 'project.bind-task', blocking_reason: '缺少项目及目标版本归属' };
  const project = records.find(r => r.kind === 'project' && r.id === task.project_id)?.data;
  if (!project) return { status: 'unassigned', next: 'project.bind-task', blocking_reason: '任务引用的项目不存在' };
  if (project.goal_heads[task.goal_id] !== task.goal_version || task.context_status === 'needs_review') return { status: 'needs_review', next: 'task.context-review', blocking_reason: '目标或设计变更，需要复核受影响工作' };
  const plan = records.find(r => r.kind === 'plan' && r.id === task.active_plan)?.data as Plan | undefined;
  if (task.active_plan && (!plan || !planMatchesTask(plan, task))) return { status: 'needs_review', next: 'plan.submit', blocking_reason: '当前计划缺少或不匹配项目、目标或设计版本；重提明确绑定的新计划，保留已有结果' };
  if (run && run.plan_hash === task.active_plan) return { status: run.status, next: run.status === 'completed' ? 'delivery.inspect' : run.status === 'waiting_for_review' ? 'human.final_review' : run.status === 'waiting_for_step_review' ? 'host.visual_review' : run.status === 'waiting_for_host' ? 'host.image_edit' : 'run.status', blocking_reason: task.blocking_reason ?? '' };
  if (task.workflow_status === 'completed') return { status: 'completed', next: 'artifact.inspect', blocking_reason: '' };
  if (records.some(r => r.kind === 'artifact' && r.data.task_id === taskId && ['candidate', 'accepted'].includes(r.data.status) && !['original', 'working', 'reference', 'evidence'].includes(r.data.purpose))) return { status: 'waiting_for_review', next: 'artifact.review', blocking_reason: '已有外部候选；须按真实结果审阅，不新建生成请求' };
  if (task.blocking_reason) return { status: 'blocked', next: 'task.unblock', blocking_reason: task.blocking_reason };
  return { status: task.active_plan ? 'planned' : 'draft', next: task.kind === 'design' ? 'design.register' : 'plan.submit', blocking_reason: '' };
}

export function graphDiagnostics(records: ContextRecord[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [], byKey = new Map(records.map(r => [recordKey(r.kind, r.id), r]));
  const problem = (r: ContextRecord, code: string, message: string, repair = '修复领域记录与稳定引用，再重建索引') => diagnostics.push({ code, object: recordKey(r.kind, r.id), message, repair });
  const ref = (r: ContextRecord, kind: string, id: unknown, optional = false) => {
    if (optional && (id === null || id === undefined || id === '')) return null;
    const target = typeof id === 'string' ? byKey.get(recordKey(kind, id)) : undefined;
    if (!target) { problem(r, 'DANGLING_REFERENCE', '缺少 ' + recordKey(kind, String(id))); return null; }
    const project = r.kind === 'project' ? r.id : r.data.project_id ?? (r.data.task_id ? byKey.get('task:' + r.data.task_id)?.data.project_id : undefined);
    const targetProject = target.kind === 'project' ? target.id : target.data.project_id ?? (target.data.task_id ? byKey.get('task:' + target.data.task_id)?.data.project_id : undefined);
    if (project && targetProject && project !== targetProject) problem(r, 'CROSS_PROJECT_REFERENCE', '跨项目引用 ' + recordKey(kind, String(id)));
    return target;
  };
  for (const r of records) {
    const d = r.data;
    if (!CONTEXT_KINDS.includes(r.kind as any) || !Number.isSafeInteger(r.revision) || r.revision < 0 || typeof d !== 'object' || d === null || Array.isArray(d)) { problem(r, 'CONTEXT_RECORD', '无效领域记录'); continue; }
    if (r.kind !== 'goal' && r.kind !== 'plan' && d.id !== r.id || r.kind === 'goal' && goalKey(d.id, d.version) !== r.id || r.kind === 'plan' && d.hash !== r.id) problem(r, 'IDENTITY_MISMATCH', '记录主键与对象身份不一致');
    if (d.project_id) ref(r, 'project', d.project_id);
    if (d.task_id) ref(r, 'task', d.task_id);
    if (d.goal_id) ref(r, 'goal', goalKey(d.goal_id, d.goal_version));
    switch (r.kind) {
      case 'project':
        if (typeof d.name !== 'string' || !d.name.trim() || typeof d.original_intent !== 'string' || !d.original_intent.trim() || !d.goal_heads || !['active', 'archived'].includes(d.status)) problem(r, 'PROJECT_SCHEMA', '项目意图或目标版本索引无效');
        else for (const [id, version] of Object.entries(d.goal_heads)) ref(r, 'goal', goalKey(id, Number(version)));
        break;
      case 'goal':
        if (!Number.isSafeInteger(d.version) || d.version < 1 || !['original_text', 'interpretation', 'scope', 'preserve', 'acceptance'].every(k => typeof d[k] === 'string' && d[k].trim()) || !['pending', 'confirmed'].includes(d.confirmation) || d.confirmation === 'confirmed' && !d.confirmation_source?.trim()) problem(r, 'GOAL_SCHEMA', '目标版本、范围或确认依据无效');
        break;
      case 'task':
        if (!d.project_id || !d.goal_id || !Number.isSafeInteger(d.goal_version) || !d.expected_output || !d.done_when) problem(r, 'CONTEXT_BINDING_REQUIRED', '任务缺少项目、目标版本、交付物或终止条件', 'project bind-task 显式绑定既有任务，不补造目标或进度');
        if (!Array.isArray(d.dependencies) || !Array.isArray(d.requirements)) problem(r, 'TASK_SCHEMA', '任务依赖或需求必须为数组');
        else for (const dep of d.dependencies) ref(r, 'task', dep);
        ref(r, 'asset', d.original_asset_id, d.kind === 'design'); ref(r, 'asset', d.working_asset_id, d.kind === 'design');
        for (const [kind, key] of [['plan', 'active_plan'], ['run', 'active_run'], ['design', 'active_design']]) { const target = ref(r, kind, d[key], true); if (target && target.data.task_id !== r.id) problem(r, 'TASK_OWNER_MISMATCH', '当前 ' + kind + ' 不属于任务'); }
        break;
      case 'asset': case 'artifact':
        if (typeof d.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(d.sha256) || d.object_path !== objectPath(d.sha256) || !Number.isSafeInteger(d.bytes) || d.bytes < 0) problem(r, 'OBJECT_IDENTITY', '文件定位、长度或 hash 无效');
        if (r.kind === 'asset' || d.type === 'image') {
          if (!Number.isSafeInteger(d.width) || d.width < 1 || !Number.isSafeInteger(d.height) || d.height < 1) problem(r, 'IMAGE_DIMENSIONS', '必须记录图像实际尺寸');
        }
        if (r.kind === 'artifact') { const asset = ref(r, 'asset', d.asset_id, d.type !== 'image'); if (asset && ['sha256', 'bytes', 'width', 'height', 'mime', 'object_path'].some(k => asset.data[k] !== d[k])) problem(r, 'ARTIFACT_ASSET_MISMATCH', '产物与真实素材对象的身份或尺寸不一致'); if (!['input', 'draft', 'candidate', 'accepted', 'delivered', 'rejected', 'needs_review'].includes(d.status)) problem(r, 'ARTIFACT_STATUS', '产物状态无效'); }
        break;
      case 'design':
        { const artifact = ref(r, 'artifact', d.artifact_id); if (artifact && artifact.data.task_id !== d.task_id) problem(r, 'DESIGN_BINDING', '设计文档不属于其任务'); const previous = ref(r, 'design', d.supersedes, true); if (previous && (previous.data.family_id !== d.family_id || previous.data.version + 1 !== d.version || previous.data.task_id !== d.task_id)) problem(r, 'DESIGN_VERSION_CONFLICT', '设计版本链不连续或跨任务'); }
        if (d.status === 'confirmed' && !d.confirmation_source) problem(r, 'DESIGN_CONFIRMATION', '设计确认缺少用户依据');
        if (!Array.isArray(d.facts)) problem(r, 'DESIGN_FACTS', '设计事实须为数组');
        else for (const fact of d.facts) { ref(r, 'artifact', fact.source_artifact_id, true); if (fact.role === 'confirmed_fact' && (!fact.source_artifact_id || !fact.confirmation_source)) problem(r, 'FACT_CONFIRMATION', '已确认设计事实缺少来源及确认依据'); }
        break;
      case 'execution':
        if (!['intent', 'unknown', 'received', 'cancelled'].includes(d.status) || !Array.isArray(d.input_artifact_ids) || !Array.isArray(d.output_artifact_ids)) problem(r, 'EXECUTION_SCHEMA', '外部操作状态或输入输出无效');
        else { for (const input of d.input_artifact_ids) ref(r, 'artifact', input); for (const output of d.output_artifact_ids) ref(r, 'artifact', output); if (d.status === 'received' && !d.output_artifact_ids.length) problem(r, 'MISSING_RESULT', '操作声称已收到结果却无真实产物'); }
        break;
      case 'review': { const target = ref(r, 'artifact', d.artifact_id); if (target && (target.data.sha256 !== d.artifact_sha256 || target.data.task_id !== d.task_id || target.data.goal_id !== d.goal_id || target.data.goal_version !== d.goal_version)) problem(r, 'REVIEW_HASH', '审阅绑定的产物、目标版本或 hash 不一致'); if (!['accept', 'reject', 'PASS', 'FAIL', 'UNKNOWN'].includes(d.verdict) || !d.confirmation || !d.source) problem(r, 'REVIEW_SCHEMA', '审阅须有实际结论和来源'); if (d.verdict === 'accept' && !['human', 'host-human', 'demo'].includes(d.issuer)) problem(r, 'ACCEPTANCE_SOURCE', '用户接受须有真实用户依据'); break; }
      case 'relation': {
        if (!RELATIONS.includes(d.rel)) problem(r, 'RELATION_VOCABULARY', '关系语义不在词汇表');
        for (const endpoint of [d.src, d.dst]) { const colon = typeof endpoint === 'string' ? endpoint.indexOf(':') : -1; if (colon < 1) problem(r, 'RELATION_ENDPOINT', '无效关系端点'); else ref(r, endpoint.slice(0, colon), endpoint.slice(colon + 1)); }
        if (d.id !== relationId(d.project_id, d.src, d.dst, d.rel)) problem(r, 'RELATION_ID', '关系 ID 与内容不一致');
        break;
      }
      case 'provenance': if (d.role === 'confirmed_fact' && !d.confirmation_source) problem(r, 'FACT_CONFIRMATION', '确认事实缺少用户依据'); break;
      case 'plan': {
        ref(r, 'asset', d.original_asset_id); ref(r, 'asset', d.working_asset_id); ref(r, 'design', d.design_id, true);
        const { hash: _hash, ...body } = d;
        if (hash(body) !== d.hash) problem(r, 'PLAN_HASH', '不可变计划内容 hash 不匹配');
        if (!Array.isArray(d.steps) || !d.steps.length) problem(r, 'PLAN_SCHEMA', '计划步骤为空');
        else for (const step of d.steps) for (const asset of step.reference_asset_ids ?? []) ref(r, 'asset', asset);
        break;
      }
      case 'grant': { const plan = ref(r, 'plan', d.plan_hash); const asset = plan ? byKey.get('asset:' + plan.data.working_asset_id) : null; if (plan && (plan.data.task_id !== d.task_id || plan.data.executor !== d.executor || asset?.data.sha256 !== d.asset_sha256 || d.max_runs !== 1)) problem(r, 'GRANT_BINDING', '历史授权与计划、输入或执行通道不一致'); break; }
      case 'run': {
        const plan = ref(r, 'plan', d.plan_hash), grant = ref(r, 'grant', d.grant_id), attempt = ref(r, 'attempt', d.current_attempt, true); ref(r, 'asset', d.accepted_asset_id, true);
        if (!['running', 'waiting_for_host', 'waiting_for_step_review', 'unknown', 'failed', 'waiting_for_review', 'accepted', 'delivering', 'completed', 'cancelled'].includes(d.status)) problem(r, 'RUN_STATUS', '运行状态无效');
        if (plan && plan.data.task_id !== d.task_id || grant && (grant.data.task_id !== d.task_id || grant.data.plan_hash !== d.plan_hash) || attempt && (attempt.data.run_id !== r.id || attempt.data.plan_hash !== d.plan_hash)) problem(r, 'RUN_BINDING', '运行与计划、授权或当前尝试不一致');
        if (!d.completed_steps || typeof d.completed_steps !== 'object' || Array.isArray(d.completed_steps)) problem(r, 'RUN_SCHEMA', '运行步骤进度无效');
        else {
          for (const [stepId, asset] of Object.entries(d.completed_steps)) { ref(r, 'asset', asset); if (plan && !plan.data.steps?.some((s: any) => s.id === stepId)) problem(r, 'RUN_PROGRESS', '进度包含未知计划步骤'); }
          if (['waiting_for_review', 'accepted', 'delivering', 'completed'].includes(d.status) && plan && !plan.data.steps?.every((s: any) => Object.hasOwn(d.completed_steps, s.id))) problem(r, 'RUN_PROGRESS', '终验或交付状态缺少已完成的真实步骤');
          if (['accepted', 'delivering', 'completed'].includes(d.status) && plan && (d.accepted_asset_id !== d.completed_steps[plan.data.steps?.at(-1)?.id] || !d.accepted_asset_id)) problem(r, 'RUN_ACCEPTANCE', '接受状态未绑定最终实际输出');
        }
        if (d.delivery) ref(r, 'asset', d.delivery.asset_id);
        if (d.status === 'completed' && !d.delivery) problem(r, 'DELIVERY_PROVENANCE', '已交付运行缺少实际交付事实');
        break;
      }
      case 'attempt': {
        const run = ref(r, 'run', d.run_id), plan = ref(r, 'plan', d.plan_hash); ref(r, 'asset', d.input_asset_id); ref(r, 'asset', d.output_asset_id, true); ref(r, 'asset', d.raw_output_asset_id, true);
        if (!['prepared', 'waiting_for_host', 'waiting_for_review', 'received', 'succeeded', 'failed', 'unknown', 'cancelled'].includes(d.status) || !['host', 'offline'].includes(d.executor)) problem(r, 'ATTEMPT_STATUS', '尝试状态或执行器无效');
        if (run && (run.data.task_id !== d.task_id || run.data.plan_hash !== d.plan_hash) || plan && (!plan.data.steps?.some((s: any) => s.id === d.step_id) || plan.data.executor !== d.executor)) problem(r, 'ATTEMPT_BINDING', '尝试与原运行、计划或步骤不一致');
        if (d.status === 'succeeded' && (!d.output_asset_id || d.report?.hard_verdict !== 'PASS' || !(d.executor === 'offline' ? d.report?.semantic_verdict === 'NOT_APPLICABLE' : d.report?.semantic_verdict === 'PASS'))) problem(r, 'ATTEMPT_PROGRESS', '成功状态缺少真实输出或通过的检查');
        break;
      }
    }
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  function visit(r: ContextRecord) {
    if (visited.has(r.id)) return;
    if (visiting.has(r.id)) { problem(r, 'TASK_CYCLE', '任务依赖有环'); return; }
    visiting.add(r.id);
    for (const id of r.data.dependencies ?? []) { const dep = byKey.get('task:' + id); if (dep) visit(dep); }
    visiting.delete(r.id); visited.add(r.id);
  }
  for (const r of records.filter(r => r.kind === 'task')) visit(r);
  return diagnostics;
}

export function assertTaskBinding(task: Task) {
  requireThat(task.project_id && task.goal_id && Number.isSafeInteger(task.goal_version) && task.expected_output && task.done_when, 'CONTEXT_BINDING_REQUIRED', '执行前须绑定项目、目标版本、预期交付物和终止条件；既有任务使用 project bind-task', 1);
}
