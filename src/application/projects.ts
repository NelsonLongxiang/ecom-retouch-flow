import fs from 'node:fs/promises';
import path from 'node:path';
import { Images } from '../adapters/images.ts';
import { Store } from '../infrastructure/store.ts';
import { hash, id, now, requireThat, RetouchError, bytesHash, type Asset, type Task, type Run, type Plan, type Result } from '../domain/model.ts';
import { object, text, receiptText } from '../domain/validation.ts';
import { assertTaskBinding, CONTEXT_KINDS, graphDiagnostics, goalKey, objectPath, relationId, RELATIONS, taskProgress, type Artifact, type ArtifactReview, type ContextRecord, type Design, type Execution, type Goal, type Project, type Provenance, type Relation, type FactRole } from '../domain/context.ts';

export interface TaskBinding { project_id: string; goal_id: string; goal_version: number; expected_output: string; done_when: string; dependencies?: string[]; kind?: 'image' | 'design' }
const roles: FactRole[] = ['user_original', 'confirmed_fact', 'assumption', 'ai_generated', 'derived', 'reference', 'pending'];
export function allRecords(store: Store): ContextRecord[] {
  return store.db.prepare('SELECT kind,id,revision,document FROM entities ORDER BY kind,id').all().map(row => ({ kind: String(row.kind), id: String(row.id), revision: Number(row.revision), data: JSON.parse(String(row.document)) }));
}
export function projectRecords(store: Store, projectId: string): ContextRecord[] {
  store.get('project', projectId);
  const rows = allRecords(store), tasks = new Set(rows.filter(r => r.kind === 'task' && r.data.project_id === projectId).map(r => r.id));
  const chosen = rows.filter(r => r.kind === 'project' ? r.id === projectId : r.data.project_id === projectId || tasks.has(r.data.task_id));
  const assets = new Set<string>();
  for (const row of chosen) {
    const d = row.data;
    for (const key of ['asset_id', 'original_asset_id', 'working_asset_id', 'input_asset_id', 'output_asset_id', 'raw_output_asset_id', 'accepted_asset_id']) if (d[key]) assets.add(d[key]);
    for (const asset of Object.values(d.completed_steps ?? {})) if (typeof asset === 'string') assets.add(asset);
    for (const step of d.steps ?? []) for (const asset of step.reference_asset_ids ?? []) assets.add(asset);
    for (const endpoint of [d.src, d.dst]) if (typeof endpoint === 'string' && endpoint.startsWith('asset:')) assets.add(endpoint.slice(6));
  }
  return [...chosen, ...rows.filter(r => r.kind === 'asset' && assets.has(r.id))].sort((a, b) => (a.kind + ':' + a.id).localeCompare(b.kind + ':' + b.id, 'en'));
}

export class Projects {
  store: Store;
  constructor(store: Store) { this.store = store; }
  create(value: unknown): Result {
    const v = object(value, ['name', 'original_intent', 'business_object'], '项目');
    const project: Project = { id: id('project'), name: text(v.name, 'name', 160), original_intent: receiptText(v.original_intent, 'original_intent'), business_object: text(v.business_object, 'business_object', 300), status: 'active', goal_heads: {}, created_at: now() };
    this.store.transaction(() => { this.store.insert('project', project.id, project); this.store.event('project.created', { project_id: project.id }); });
    return { result_status: 'created', data: { project, revision: 0 } };
  }
  goal(projectId: string, value: unknown, expected: number, goalId?: string): Result {
    const v = object(value, ['original_text', 'interpretation', 'scope', 'preserve', 'acceptance', 'confirmation', 'confirmation_source'], '目标');
    const project = this.store.expect<Project>('project', projectId, expected);
    requireThat(project.data.status === 'active', 'PROJECT_ARCHIVED', '归档业务项目不能新增目标', 1);
    if (goalId) requireThat(Object.hasOwn(project.data.goal_heads, goalId), 'NOT_FOUND', '目标不属于项目', 1);
    const family = goalId ?? id('goal'), version = (project.data.goal_heads[family] ?? 0) + 1;
    const goal: Goal = { id: family, project_id: projectId, version, original_text: receiptText(v.original_text, 'original_text'), interpretation: text(v.interpretation, 'interpretation'), scope: text(v.scope, 'scope'), preserve: text(v.preserve, 'preserve'), acceptance: text(v.acceptance, 'acceptance'), confirmation: v.confirmation as Goal['confirmation'], confirmation_source: typeof v.confirmation_source === 'string' ? receiptText(v.confirmation_source || '尚未确认', 'confirmation_source') : '', created_at: now() };
    requireThat(['pending', 'confirmed'].includes(goal.confirmation) && (goal.confirmation !== 'confirmed' || typeof v.confirmation_source === 'string' && v.confirmation_source.trim()), 'GOAL_CONFIRMATION', '目标确认状态或依据无效');
    if (goal.confirmation === 'pending' && !v.confirmation_source) goal.confirmation_source = '';
    this.store.transaction(() => {
      this.store.expect('project', projectId, expected);
      this.store.insert('goal', goalKey(family, version), goal); project.data.goal_heads[family] = version;
      this.store.update('project', projectId, project.data, expected);
      this.relate(projectId, 'goal:' + goalKey(family, version), 'project:' + projectId, 'serves');
      if (goalId) this.invalidateTasks(this.store.list<Task>('task').filter(r => r.data.project_id === projectId && r.data.goal_id === goalId).map(r => r.data.id));
      this.store.event('goal.versioned', { project_id: projectId, goal_id: family, version });
    });
    return { result_status: 'recorded', data: { goal, project_revision: expected + 1 } };
  }
  validateBinding(binding: TaskBinding) {
    const project = this.store.get<Project>('project', text(binding.project_id, 'project_id')).data;
    const goal = this.store.get<Goal>('goal', goalKey(text(binding.goal_id, 'goal_id'), binding.goal_version)).data;
    requireThat(goal.project_id === project.id && project.goal_heads[goal.id] === goal.version, 'GOAL_VERSION_CONFLICT', '目标不属于本项目或不是当前版本', 1);
    requireThat(project.status === 'active', 'PROJECT_ARCHIVED', '业务项目已归档', 1);
    text(binding.expected_output, 'expected_output'); text(binding.done_when, 'done_when');
    requireThat(!binding.kind || ['image', 'design'].includes(binding.kind), 'TASK_KIND', '任务类型支持 image 或 design');
    requireThat(!binding.dependencies || Array.isArray(binding.dependencies) && new Set(binding.dependencies).size === binding.dependencies.length, 'TASK_DEPENDENCIES', '依赖须为无重复任务数组');
    for (const dependency of binding.dependencies ?? []) requireThat(this.store.get<Task>('task', dependency).data.project_id === project.id, 'CROSS_PROJECT_REFERENCE', '任务依赖不能跨项目', 1);
  }
  bind(taskId: string, value: unknown, expected: number): Result {
    const v = object(value, ['project_id', 'goal_id', 'goal_version', 'expected_output', 'done_when', 'dependencies', 'kind'], '任务归属') as unknown as TaskBinding;
    this.validateBinding(v);
    return this.store.transaction(() => {
      const task = this.store.expect<Task>('task', taskId, expected);
      requireThat(!task.data.project_id || task.data.project_id === v.project_id, 'CROSS_PROJECT_REFERENCE', '既有任务不得直接转移到另一个项目', 1);
      requireThat(!(v.dependencies ?? []).includes(taskId), 'TASK_CYCLE', '任务不能依赖自身');
      const previous = { goal_id: task.data.goal_id, goal_version: task.data.goal_version };
      Object.assign(task.data, v, { dependencies: v.dependencies ?? [], kind: v.kind ?? 'image', context_status: 'current', workflow_status: task.data.workflow_status ?? 'open', active_design: null });
      const revision = this.store.update('task', taskId, task.data, expected);
      this.relate(v.project_id, 'task:' + taskId, 'goal:' + goalKey(v.goal_id, v.goal_version), 'serves');
      for (const dep of v.dependencies ?? []) this.relate(v.project_id, 'task:' + taskId, 'task:' + dep, 'depends-on');
      if (task.data.original_asset_id) this.bindImage(task.data, task.data.original_asset_id, 'original', 'user_original');
      if (task.data.working_asset_id) this.bindImage(task.data, task.data.working_asset_id, 'working', 'derived');
      const issues = graphDiagnostics(projectRecords(this.store, v.project_id));
      requireThat(!issues.some(i => i.code === 'TASK_CYCLE'), 'TASK_CYCLE', '任务依赖有环', 1);
      this.store.event('task.context.bound', { task_id: taskId, previous, goal_id: v.goal_id, goal_version: v.goal_version }, taskId);
      return { result_status: 'bound', data: { task_id: taskId, revision, task: task.data } };
    });
  }
  ensureTask(taskId: string, stage = false): Task {
    const task = this.store.get<Task>('task', taskId).data; assertTaskBinding(task);
    const project = this.store.get<Project>('project', task.project_id!).data;
    const goal = this.store.get<Goal>('goal', goalKey(task.goal_id!, task.goal_version!)).data;
    requireThat(goal.project_id === project.id, 'CROSS_PROJECT_REFERENCE', '任务目标不属于项目', 1);
    if (stage) {
      requireThat(project.status === 'active' && project.goal_heads[goal.id] === goal.version && task.context_status !== 'needs_review', 'STALE_CONTEXT', '目标或设计已更新；先核对任务范围和版本，不重做历史结果', 1);
      for (const dep of task.dependencies ?? []) requireThat(this.progress(dep).status === 'completed', 'TASK_DEPENDENCY_BLOCKED', '前序任务尚未完成：' + dep, 1);
      if (task.active_design) requireThat(this.store.get<Design>('design', task.active_design).data.status !== 'needs_review', 'STALE_CONTEXT', '当前设计需要复核', 1);
    }
    return task;
  }
  relate(projectId: string, src: string, dst: string, rel: Relation['rel']): Relation {
    requireThat(RELATIONS.includes(rel), 'RELATION_VOCABULARY', '未知关系语义');
    const relation: Relation = { id: relationId(projectId, src, dst, rel), project_id: projectId, src, dst, rel, created_at: now() };
    if (!this.store.maybe('relation', relation.id)) this.store.insert('relation', relation.id, relation);
    return relation;
  }
  bindImage(task: Task, assetId: string, purpose: Artifact['purpose'], factRole: FactRole, inputArtifacts: string[] = []): Artifact {
    assertTaskBinding(task);
    const asset = this.store.get<Asset>('asset', assetId).data;
    return this.recordArtifact(task, { asset_id: asset.id, type: 'image', purpose, sha256: asset.sha256, bytes: asset.bytes, object_path: asset.object_path, mime: asset.mime, width: asset.width, height: asset.height, fact_role: factRole, source: 'registered-local-bytes' }, inputArtifacts);
  }
  recordArtifact(task: Task, fields: Pick<Artifact, 'asset_id' | 'type' | 'purpose' | 'sha256' | 'bytes' | 'object_path' | 'mime' | 'width' | 'height' | 'fact_role' | 'source'>, inputs: string[] = []): Artifact {
    assertTaskBinding(task);
    for (const input of inputs) requireThat(this.store.get<Artifact>('artifact', input).data.project_id === task.project_id, 'CROSS_PROJECT_REFERENCE', '产物来源不能跨项目', 1);
    const artifactId = 'artifact_' + hash({ task: task.id, goal: task.goal_id, version: task.goal_version, purpose: fields.purpose, sha256: fields.sha256 });
    const existing = this.store.maybe<Artifact>('artifact', artifactId);
    if (existing) {
      requireThat(Object.entries(fields).every(([key,value]) => existing.data[key as keyof Artifact] === value), 'ARTIFACT_IDENTITY_CONFLICT', '同一产物字节和用途已有不同来源或事实角色；保留历史并登记明确的新版本/来源记录', 1);
      return existing.data;
    }
    const version = 1 + Math.max(0, ...this.store.list<Artifact>('artifact').filter(a => a.data.task_id === task.id && a.data.purpose === fields.purpose).map(a => a.data.version));
    const artifact: Artifact = { id: artifactId, project_id: task.project_id!, task_id: task.id, goal_id: task.goal_id!, goal_version: task.goal_version!, ...fields, version,
      status: ['original', 'working', 'reference', 'evidence'].includes(fields.purpose) ? 'input' : fields.type === 'image' ? 'candidate' : 'draft', created_at: now() };
    this.store.insert('artifact', artifact.id, artifact);
    this.relate(task.project_id!, 'artifact:' + artifact.id, 'task:' + task.id, 'produced-by');
    for (const input of inputs) this.relate(task.project_id!, 'artifact:' + artifact.id, 'artifact:' + input, 'derived-from');
    return artifact;
  }
  async artifact(taskId: string, file: string, value: unknown, requestId: string): Promise<Result> {
    const v = object(value, ['type', 'purpose', 'fact_role', 'source', 'derived_from'], '产物');
    const task = this.ensureTask(taskId);
    requireThat(['image', 'document', 'prompt', 'spec', 'receipt', 'evidence'].includes(String(v.type)), 'ARTIFACT_TYPE', '产物类型无效');
    requireThat(['original', 'working', 'reference', 'model_output', 'postprocessed', 'candidate', 'design', 'prompt', 'evidence', 'delivery'].includes(String(v.purpose)), 'ARTIFACT_PURPOSE', '产物用途无效');
    requireThat(roles.includes(v.fact_role as FactRole) && v.fact_role !== 'confirmed_fact', 'FACT_CONFIRMATION', '文件登记不能自行确认事实；使用有依据的项目记录或用户审阅');
    const source = receiptText(v.source, 'source'), inputs = v.derived_from ?? [];
    requireThat(Array.isArray(inputs) && inputs.every(i => typeof i === 'string'), 'ARTIFACT_INPUTS', 'derived_from 必须为产物 ID 数组');
    const stat = await fs.stat(file); requireThat(stat.isFile() && stat.size <= 32 * 1024 * 1024, 'ARTIFACT_SIZE', '业务文件不得超过 32 MiB');
    const bytes = await fs.readFile(file), sha256 = bytesHash(bytes);
    if (v.type !== 'image') receiptText(bytes.toString('utf8'), '业务文档');
    const intent = hash({ command: 'artifact.register', taskId, value: v, sha256 });
    const replay = this.store.replay(requestId, intent); if (replay) return replay;
    let fields: Parameters<Projects['recordArtifact']>[1];
    if (v.type === 'image') {
      const asset = await new Images(this.store).register(bytes);
      fields = { asset_id: asset.id, type: 'image', purpose: v.purpose as Artifact['purpose'], fact_role: v.fact_role as FactRole, source, sha256, bytes: bytes.length, object_path: asset.object_path, mime: asset.mime, width: asset.width, height: asset.height };
    } else { await this.store.object(bytes); fields = { asset_id: null, type: v.type as Artifact['type'], purpose: v.purpose as Artifact['purpose'], fact_role: v.fact_role as FactRole, source, sha256, bytes: bytes.length, object_path: objectPath(sha256), mime: 'text/plain; charset=utf-8', width: null, height: null }; }
    return this.store.transaction(() => {
      const replay = this.store.replay(requestId, intent); if (replay) return replay;
      const artifact = this.recordArtifact(this.ensureTask(taskId), fields, inputs as string[]);
      this.store.event('artifact.registered', { artifact_id: artifact.id, sha256 }, taskId);
      const result: Result = { result_status: 'registered', data: { artifact } }; this.store.remember(requestId, intent, result); return result;
    });
  }
  artifactView(artifactId: string): Result {
    const artifact = this.store.get<Artifact>('artifact', artifactId);
    return { result_status: artifact.data.status, data: { ...artifact, file: path.join(this.store.root, artifact.data.object_path), relations: this.store.list<Relation>('relation').filter(r => r.data.src === 'artifact:' + artifactId || r.data.dst === 'artifact:' + artifactId).map(r => r.data) } };
  }
  note(projectId: string, value: unknown, requestId: string): Result {
    const v = object(value, ['task_id', 'text', 'role', 'source', 'confirmation_source'], '来源事实'); this.store.get('project', projectId);
    if (v.task_id) requireThat(this.ensureTask(String(v.task_id)).project_id === projectId, 'CROSS_PROJECT_REFERENCE', '记录的任务不属于项目');
    requireThat(roles.includes(v.role as FactRole), 'FACT_ROLE', '事实角色无效');
    const note: Provenance = { id: 'note_' + hash({ projectId, requestId }), project_id: projectId, task_id: v.task_id ? String(v.task_id) : null, text: receiptText(v.text, 'text'), role: v.role as FactRole, source: receiptText(v.source, 'source'), confirmation_source: v.confirmation_source ? receiptText(v.confirmation_source, 'confirmation_source') : '', created_at: now() };
    requireThat(note.role !== 'confirmed_fact' || note.confirmation_source, 'FACT_CONFIRMATION', '确认事实须有真实用户依据');
    const intent = hash({ command: 'project.note', projectId, value: v });
    return this.store.transaction(() => { const replay = this.store.replay(requestId, intent); if (replay) return replay; this.store.insert('provenance', note.id, note); const result = { result_status: 'recorded', data: { note } }; this.store.remember(requestId, intent, result); return result; });
  }
  design(taskId: string, value: unknown, expected: number): Result {
    const v = object(value, ['artifact_id', 'family_id', 'supersedes', 'facts', 'status', 'confirmation_source'], '设计');
    const task = this.store.expect<Task>('task', taskId, expected); this.ensureTask(taskId, true);
    const artifact = this.store.get<Artifact>('artifact', text(v.artifact_id, 'artifact_id')).data;
    requireThat(artifact.task_id === taskId && artifact.type !== 'image' && artifact.goal_version === task.data.goal_version, 'DESIGN_BINDING', '设计须绑定当前任务的文档产物');
    requireThat(v.status === 'draft' || v.status === 'confirmed', 'DESIGN_STATUS', '设计状态支持 draft 或 confirmed');
    requireThat(v.status !== 'confirmed' || typeof v.confirmation_source === 'string' && v.confirmation_source.trim(), 'DESIGN_CONFIRMATION', '确认设计须提供实际用户依据');
    requireThat(Array.isArray(v.facts), 'DESIGN_FACTS', '设计事实须为数组');
    const facts = v.facts.map(raw => {
      const fact = object(raw, ['text', 'role', 'source_artifact_id', 'confirmation_source'], '设计事实');
      requireThat(roles.includes(fact.role as FactRole), 'FACT_ROLE', '设计事实角色无效');
      if (fact.source_artifact_id) requireThat(this.store.get<Artifact>('artifact', String(fact.source_artifact_id)).data.project_id === task.data.project_id, 'CROSS_PROJECT_REFERENCE', '设计事实来源不能跨项目');
      requireThat(fact.role !== 'confirmed_fact' || fact.source_artifact_id && typeof fact.confirmation_source === 'string' && fact.confirmation_source.trim(), 'FACT_CONFIRMATION', '已确认事实须有来源产物及用户依据');
      return { text: receiptText(fact.text, 'fact.text'), role: fact.role as FactRole, source_artifact_id: fact.source_artifact_id ? String(fact.source_artifact_id) : null, confirmation_source: fact.confirmation_source ? receiptText(fact.confirmation_source, 'confirmation_source') : '' };
    });
    const previous = v.supersedes ? this.store.get<Design>('design', String(v.supersedes)).data : null;
    requireThat(!previous || previous.task_id === taskId && previous.id === task.data.active_design, 'DESIGN_VERSION_CONFLICT', '只能接续本任务当前设计');
    requireThat(!task.data.active_design || previous, 'DESIGN_VERSION_CONFLICT', '已有设计时必须明确 supersedes');
    const design: Design = { id: id('design'), project_id: task.data.project_id!, task_id: taskId, goal_id: task.data.goal_id!, goal_version: task.data.goal_version!, family_id: previous?.family_id ?? (v.family_id ? text(v.family_id, 'family_id', 128) : id('variant')), version: (previous?.version ?? 0) + 1, artifact_id: artifact.id, supersedes: previous?.id ?? null, facts, status: v.status, confirmation_source: v.confirmation_source ? receiptText(v.confirmation_source, 'confirmation_source') : '', created_at: now() };
    this.store.transaction(() => {
      this.store.expect('task', taskId, expected); this.store.insert('design', design.id, design); task.data.active_design = design.id; this.store.update('task', taskId, task.data, expected);
      this.relate(design.project_id, 'design:' + design.id, 'task:' + taskId, 'implements'); this.relate(design.project_id, 'design:' + design.id, 'artifact:' + artifact.id, 'based-on');
      for (const fact of facts) if (fact.source_artifact_id) this.relate(design.project_id, 'design:' + design.id, 'artifact:' + fact.source_artifact_id, 'based-on');
      if (previous) { this.relate(design.project_id, 'design:' + design.id, 'design:' + previous.id, 'supersedes'); this.invalidateTasks([taskId]); }
      this.store.event('design.versioned', { design_id: design.id, version: design.version }, taskId);
    });
    return { result_status: 'recorded', data: { design, task_revision: this.store.get<Task>('task', taskId).revision } };
  }
  invalidateTasks(initial: string[]) {
    const affected = new Set(initial); let changed = true;
    while (changed) { changed = false; for (const row of this.store.list<Task>('task')) if (!affected.has(row.data.id) && row.data.dependencies?.some(dep => affected.has(dep))) { affected.add(row.data.id); changed = true; } }
    for (const row of this.store.list<Task>('task')) if (affected.has(row.data.id)) { row.data.context_status = 'needs_review'; this.store.update('task', row.data.id, row.data, row.revision); }
    for (const row of this.store.list<Artifact>('artifact')) if (affected.has(row.data.task_id) && !['original', 'working', 'reference', 'evidence'].includes(row.data.purpose)) { row.data.status = 'needs_review'; this.store.update('artifact', row.data.id, row.data, row.revision); }
  }
  progress(taskId: string): { status: string; next: string; blocking_reason: string } {
    this.store.get<Task>('task', taskId);
    return taskProgress(allRecords(this.store), taskId);
  }
  reviewContext(taskId: string, confirmation: string, expected: number): Result {
    receiptText(confirmation, 'confirmation'); const task = this.store.expect<Task>('task', taskId, expected); this.ensureTask(taskId);
    const project = this.store.get<Project>('project', task.data.project_id!).data;
    requireThat(project.goal_heads[task.data.goal_id!] === task.data.goal_version, 'GOAL_VERSION_CONFLICT', '先显式绑定当前目标版本');
    this.store.transaction(() => { this.store.expect('task', taskId, expected); task.data.context_status = 'current'; this.store.update('task', taskId, task.data, expected); this.store.event('task.context.reviewed', { confirmation }, taskId); });
    return { result_status: 'reviewed', data: { task_id: taskId, revision: expected + 1 } };
  }
  closeTask(taskId: string, confirmation: string, expected: number): Result {
    receiptText(confirmation, 'confirmation'); const task = this.store.expect<Task>('task', taskId, expected); this.ensureTask(taskId, true);
    const progress = this.progress(taskId); requireThat(progress.status !== 'unknown', 'UNKNOWN_EXECUTION', '外部请求未知时不能关闭任务', 1);
    requireThat(!['running', 'waiting_for_host', 'waiting_for_step_review', 'delivering'].includes(progress.status), 'TASK_EXECUTION_ACTIVE', '当前执行或交付尚未结束，不能以旧产物关闭任务', 1);
    const artifacts = this.store.list<Artifact>('artifact').filter(a => a.data.task_id === taskId).map(a => a.data);
    requireThat(artifacts.some(a => a.goal_id === task.data.goal_id && a.goal_version === task.data.goal_version && !['needs_review', 'rejected'].includes(a.status) && (task.data.kind === 'design' ? ['document', 'spec', 'prompt'].includes(a.type) : ['accepted', 'delivered'].includes(a.status))), 'TASK_OUTPUT_REQUIRED', '完成任务须有当前目标的有效文档或已接受图像；方案完成不等于图片已生成', 1);
    this.store.transaction(() => { this.store.expect('task', taskId, expected); task.data.workflow_status = 'completed'; this.store.update('task', taskId, task.data, expected); this.store.event('task.closed', { confirmation, done_when: task.data.done_when }, taskId); });
    return { result_status: 'completed', data: { task_id: taskId, revision: expected + 1, image_acceptance: 'separate_fact' } };
  }
  execution(taskId: string, value: unknown, requestId: string): Result {
    const task = this.ensureTask(taskId), v = object(value, ['request_id', 'channel', 'operation', 'scope', 'input_artifact_ids', 'status', 'recovery_note', 'source', 'occurred_at', 'output_artifact_ids'], '外部操作');
    requireThat(['intent', 'unknown', 'received', 'cancelled'].includes(String(v.status)), 'EXECUTION_STATUS', '外部操作状态无效');
    requireThat(Array.isArray(v.input_artifact_ids) && Array.isArray(v.output_artifact_ids ?? []), 'EXECUTION_INPUTS', '外部输入输出须为产物数组');
    for (const artifactId of [...v.input_artifact_ids, ...(v.output_artifact_ids as string[] ?? [])]) requireThat(this.store.get<Artifact>('artifact', String(artifactId)).data.project_id === task.project_id, 'CROSS_PROJECT_REFERENCE', '外部操作产物不属于项目');
    const outputs = (v.output_artifact_ids ?? []) as string[];
    for (const artifactId of outputs) requireThat(this.store.get<Artifact>('artifact', artifactId).data.task_id === taskId, 'EXECUTION_BINDING', '输出产物须属于操作任务');
    requireThat(v.status !== 'received' || outputs.length > 0, 'MISSING_RESULT', '实际收到的外部结果必须登记真实产物');
    const externalId = text(v.request_id, 'request_id', 128), executionId = 'execution_' + hash({ project: task.project_id, taskId, request_id: externalId });
    const intent = hash({ command: 'execution.record', taskId, value: v });
    return this.store.transaction(() => {
      const replay = this.store.replay(requestId, intent); if (replay) return replay;
      const existing = this.store.maybe<Execution>('execution', executionId);
      requireThat(!existing, 'REQUEST_CONFLICT', '该外部请求已有记录；使用 execution reconcile 更新同一操作', 1);
      const execution: Execution = { id: executionId, project_id: task.project_id!, task_id: taskId, goal_id: task.goal_id!, goal_version: task.goal_version!, request_id: externalId,
        channel: text(v.channel, 'channel', 120), operation: text(v.operation, 'operation', 120), scope: text(v.scope, 'scope'), input_artifact_ids: v.input_artifact_ids as string[], output_artifact_ids: outputs, status: v.status as Execution['status'], recovery_note: receiptText(v.recovery_note, 'recovery_note'), source: receiptText(v.source, 'source'), occurred_at: text(v.occurred_at, 'occurred_at', 80), created_at: now() };
      requireThat(Number.isFinite(Date.parse(execution.occurred_at)), 'INVALID_DATE', 'occurred_at 不是有效时间');
      this.store.insert('execution', execution.id, execution); this.executionRelations(execution);
      this.store.event('external.recorded', { execution_id: execution.id, status: execution.status, actual_call_by_cli: false }, taskId);
      const result = { result_status: execution.status, data: { execution, capability_gap: 'external_observation_only_no_native_adapter_invocation' } }; this.store.remember(requestId, intent, result); return result;
    });
  }
  reconcile(executionId: string, value: unknown, expected: number, requestId: string): Result {
    const v = object(value, ['status', 'output_artifact_ids', 'source', 'recovery_note'], '外部对账');
    requireThat(['unknown', 'received', 'cancelled'].includes(String(v.status)) && Array.isArray(v.output_artifact_ids), 'EXECUTION_STATUS', '对账须声明状态及真实输出产物');
    const intent = hash({ command: 'execution.reconcile', executionId, expected, value: v });
    return this.store.transaction(() => {
      const replay = this.store.replay(requestId, intent); if (replay) return replay;
      const entity = this.store.expect<Execution>('execution', executionId, expected), execution = entity.data;
      requireThat(['intent', 'unknown', 'cancelled'].includes(execution.status), 'EXECUTION_FINAL', '已有结果的操作不能覆盖；新增后处理应登记新操作', 1);
      for (const aid of v.output_artifact_ids as string[]) requireThat(this.store.get<Artifact>('artifact', aid).data.task_id === execution.task_id, 'EXECUTION_BINDING', '结果产物须属于原操作任务');
      requireThat(v.status !== 'received' || (v.output_artifact_ids as string[]).length > 0, 'MISSING_RESULT', '收到结果须有真实产物');
      execution.status = v.status as Execution['status']; execution.output_artifact_ids = v.output_artifact_ids as string[]; execution.source = receiptText(v.source, 'source'); execution.recovery_note = receiptText(v.recovery_note, 'recovery_note');
      this.store.update('execution', executionId, execution, expected); this.executionRelations(execution); this.store.event('external.reconciled', { execution_id: executionId, status: execution.status, new_external_call: false }, execution.task_id);
      const result = { result_status: execution.status, data: { execution, revision: expected + 1 } }; this.store.remember(requestId, intent, result); return result;
    });
  }
  executionRelations(e: Execution) {
    this.relate(e.project_id, 'execution:' + e.id, 'task:' + e.task_id, 'implements');
    for (const input of e.input_artifact_ids) this.relate(e.project_id, 'artifact:' + input, 'execution:' + e.id, 'input-for');
    for (const output of e.output_artifact_ids) { this.relate(e.project_id, 'artifact:' + output, 'execution:' + e.id, 'produced-by'); for (const input of e.input_artifact_ids) this.relate(e.project_id, 'artifact:' + output, 'artifact:' + input, 'derived-from'); }
  }
  async reviewArtifact(artifactId: string, value: unknown, expected: number, requestId: string): Promise<Result> {
    const v = object(value, ['artifact_sha256', 'verdict', 'issuer', 'confirmation', 'source'], '产物审阅');
    const intent = hash({ command: 'artifact.review', artifactId, expected, value: v }), replay = this.store.replay(requestId, intent); if (replay) return replay;
    const artifact = this.store.expect<Artifact>('artifact', artifactId, expected), a = artifact.data, task = this.ensureTask(a.task_id, true);
    requireThat(task.goal_id === a.goal_id && task.goal_version === a.goal_version, 'GOAL_VERSION_CONFLICT', '旧目标产物只能追溯，不能绑定当前目标直接接受', 1);
    requireThat(v.artifact_sha256 === a.sha256 && ['accept', 'reject', 'PASS', 'FAIL', 'UNKNOWN'].includes(String(v.verdict)), 'REVIEW_BINDING', '审阅必须绑定实际产物 hash 和明确结论');
    requireThat(['human', 'host-human', 'agent'].includes(String(v.issuer)) && (v.verdict !== 'accept' || v.issuer !== 'agent'), 'ACCEPTANCE_SOURCE', '最终接受须来自用户');
    const bytes = await this.objectBytes(a); requireThat(bytesHash(bytes) === a.sha256, 'ARTIFACT_CORRUPTED', '产物 hash 不符', 1);
    const review: ArtifactReview = { id: 'review_' + hash({ artifactId, requestId }), project_id: a.project_id, task_id: a.task_id, goal_id: a.goal_id, goal_version: a.goal_version, artifact_id: artifactId, artifact_sha256: a.sha256, verdict: v.verdict as ArtifactReview['verdict'], issuer: v.issuer as ArtifactReview['issuer'], confirmation: receiptText(v.confirmation, 'confirmation'), source: receiptText(v.source, 'source'), created_at: now() };
    return this.store.transaction(() => {
      const replay = this.store.replay(requestId, intent); if (replay) return replay; this.store.expect('artifact', artifactId, expected);
      this.store.insert('review', review.id, review); if (review.verdict === 'accept' || review.verdict === 'reject') { a.status = review.verdict === 'accept' ? 'accepted' : 'rejected'; this.store.update('artifact', artifactId, a, expected); }
      this.relate(a.project_id, 'artifact:' + artifactId, 'review:' + review.id, 'reviewed-by'); this.store.event('artifact.reviewed', { review_id: review.id, verdict: review.verdict }, a.task_id);
      const result = { result_status: 'reviewed', data: { review, artifact: a } }; this.store.remember(requestId, intent, result); return result;
    });
  }
  async objectBytes(a: Pick<Artifact, 'sha256' | 'object_path' | 'bytes'>): Promise<Buffer> {
    requireThat(a.object_path === objectPath(a.sha256), 'OBJECT_PATH', '业务对象必须位于内容寻址库', 1);
    const file = path.join(this.store.root, a.object_path), canonical = await fs.realpath(file).catch(() => { throw new RetouchError('MISSING_OBJECT', '缺少业务对象：' + a.sha256); });
    requireThat(canonical === file && !(await fs.lstat(file)).isSymbolicLink(), 'PATH_ESCAPE', '业务对象不能经链接逃逸', 1);
    const bytes = await fs.readFile(file); requireThat(bytes.length === a.bytes && bytesHash(bytes) === a.sha256, 'ARTIFACT_CORRUPTED', '业务对象内容 hash 或长度不符：' + a.sha256, 1); return bytes;
  }
  brief(projectId: string): Result {
    const records = projectRecords(this.store, projectId), project = records.find(r => r.kind === 'project' && r.id === projectId)!.data as Project;
    const fingerprint = hash(records), sync = this.store.db.prepare('SELECT value FROM meta WHERE key=?').get('context_projection:' + projectId);
    const projection = sync ? JSON.parse(String(sync.value)) : null;
    const tasks = records.filter(r => r.kind === 'task').map(r => ({ revision: r.revision, task: r.data, progress: taskProgress(records,r.id) }));
    const diagnostics = graphDiagnostics(records);
    const currentGoals = records.filter(r => r.kind === 'goal' && project.goal_heads[r.data.id] === r.data.version).map(r => r.data);
    return { result_status: diagnostics.length ? 'incomplete' : 'ready', data: { project, goals: currentGoals, goal_history: records.filter(r => r.kind === 'goal').map(r => r.data), tasks, designs: records.filter(r => r.kind === 'design').map(r => r.data), artifacts: records.filter(r => r.kind === 'artifact').map(r => r.data), relations: records.filter(r => r.kind === 'relation').map(r => r.data), provenance: records.filter(r => r.kind === 'provenance').map(r => r.data), executions: records.filter(r => r.kind === 'execution').map(r => r.data), reviews: records.filter(r => r.kind === 'review').map(r => r.data), plans: records.filter(r => r.kind === 'plan').map(r => r.data), runs: records.filter(r => r.kind === 'run').map(r => r.data), attempts: records.filter(r => r.kind === 'attempt').map(r => r.data), unknown_requests: records.filter(r => r.kind === 'attempt' && r.data.status === 'unknown' || r.kind === 'execution' && ['intent','unknown'].includes(r.data.status)).map(r => ({ kind:r.kind, id:r.id, ...r.data })), diagnostics, index: { schema_version: 'retouch.index/v1', source_fingerprint: fingerprint, sqlite: 'live_transactional_projection', ygl: projection?.fingerprint === fingerprint && projection?.status === 'in_sync' ? 'in_sync' : 'pending' },
      historical_authorizations: records.filter(r => r.kind === 'grant' && this.store.isHistoricalGrant(r.id)).map(r => r.id), next_actions: tasks.filter(t => t.progress.status !== 'completed').map(t => ({ task_id: t.task.id, type: t.progress.next, reason: t.progress.blocking_reason || '按领域事实继续' })) } };
  }
  async check(projectId?: string): Promise<Result> {
    const records = projectId ? projectRecords(this.store, projectId) : allRecords(this.store), diagnostics = graphDiagnostics(records);
    for (const row of records.filter(r => r.kind === 'asset' || r.kind === 'artifact')) { try { await this.objectBytes(row.data as Artifact); } catch (error) { diagnostics.push({ code: (error as RetouchError).code ?? 'OBJECT_READ', object: row.kind + ':' + row.id, message: (error as Error).message, repair: '从可信来源恢复原 hash 的对象，不重新生成代替历史结果' }); } }
    const ownedAssets = new Set(allRecords(this.store).filter(r => r.kind === 'artifact' && r.data.asset_id).map(r => r.data.asset_id));
    const indexes = (projectId ? [projectId] : this.store.list<Project>('project').map(p => p.data.id)).map(project => ({ project_id: project, ...(this.brief(project).data.index as object) }));
    const reviewRequired=records.filter(r=>r.kind==='task').map(r=>({task_id:r.id,...taskProgress(records,r.id)})).filter(r=>r.status==='needs_review');
    const unknownRequests=records.filter(r=>r.kind==='attempt'&&r.data.status==='unknown'||r.kind==='execution'&&['intent','unknown'].includes(r.data.status)).map(r=>({kind:r.kind,...r.data}));
    return { result_status: diagnostics.length ? 'unhealthy' : 'healthy', data: { integrity: diagnostics.length ? 'FAIL' : 'PASS', diagnostics, indexes, review_required:reviewRequired, unknown_requests:unknownRequests, unassigned_assets: this.store.list<Asset>('asset').filter(a => !ownedAssets.has(a.data.id)).map(a => a.data.id), sqlite_integrity: this.store.db.prepare('PRAGMA integrity_check').all() } };
  }
}
