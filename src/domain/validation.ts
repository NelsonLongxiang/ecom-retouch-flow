import path from 'node:path';
import { active, hash, now, requireThat, type Asset, type Grant, type Plan, type Requirement, type Step, type Task, type WorkspaceConfig } from './model.ts';

export function object(value: unknown, allowed: string[], label: string): Record<string, unknown> {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_INPUT', label + ' 必须是对象');
  const result = value as Record<string, unknown>;
  for (const key of Object.keys(result)) requireThat(allowed.includes(key), 'UNKNOWN_FIELD', label + ' 不支持字段 ' + key);
  return result;
}
export function text(value: unknown, label: string, maximum = 16000): string {
  requireThat(typeof value === 'string' && value.trim().length > 0 && value.length <= maximum && !value.includes('\0'), 'INVALID_INPUT', label + ' 必须是非空文本');
  return value;
}
export function receiptText(value: unknown, label: string): string {
  const result = text(value, label);
  requireThat(!/(?:Bearer\s+[a-zA-Z0-9._-]{12,}|\bsk-[a-zA-Z0-9_-]{16,}|[?&](?:api[_-]?key|token|signature|x-amz-signature|sig)=\S+)/i.test(result), 'SENSITIVE_RECEIPT', label + ' 含凭证或签名 URL，请提供去敏后的来源观察');
  return result;
}
function key(value: unknown, label: string): string {
  const result = text(value, label, 60);
  requireThat(/^[a-z][a-z0-9-]*$/.test(result), 'INVALID_ID', label + ' 仅支持小写字母、数字和连字符');
  return result;
}
function strings(value: unknown, label: string): string[] {
  requireThat(Array.isArray(value) && value.every((item) => typeof item === 'string'), 'INVALID_INPUT', label + ' 必须是字符串数组');
  requireThat(value.length === new Set(value).size, 'DUPLICATE_ID', label + ' 不得重复');
  return value as string[];
}
export function requirements(value: unknown): Requirement[] {
  const input = object(value, ['schema_version', 'groups'], '需求');
  requireThat(input.schema_version === 'retouch.requirements/v1', 'SCHEMA_VERSION', '不支持的需求 schema');
  requireThat(Array.isArray(input.groups) && input.groups.length <= 40, 'INVALID_INPUT', 'groups 必须为最多 40 项的数组');
  const groups = input.groups.map((raw) => {
    const group = object(raw, ['id', 'label', 'text', 'disabled', 'scope'], '需求组');
    requireThat(typeof group.text === 'string' && group.text.length <= 16000 && !group.text.includes('\0'), 'INVALID_INPUT', '需求文字必须为文本');
    requireThat(typeof group.disabled === 'boolean', 'INVALID_INPUT', 'disabled 必须明确为布尔值');
    requireThat(['operation', 'preserve', 'reference'].includes(group.scope as string), 'INVALID_INPUT', '无效需求组 scope');
    return { id: key(group.id, '需求组 id'), label: text(group.label, '分组名称', 120), text: group.text, disabled: group.disabled, scope: group.scope } as Requirement;
  });
  requireThat(new Set(groups.map((group) => group.id)).size === groups.length, 'DUPLICATE_ID', '需求组 id 重复');
  return groups;
}

export function compilePlan(value: unknown, task: Task, asset: Asset, mode: WorkspaceConfig['mode']): Plan {
  const input = object(value, ['schema_version', 'title', 'executor', 'steps'], '计划');
  requireThat(input.schema_version === 'retouch.plan/v1', 'SCHEMA_VERSION', '不支持的计划 schema');
  const executor = input.executor ?? 'host';
  requireThat(executor === 'host' || executor === 'offline', 'UNSUPPORTED_EXECUTOR', 'executor 支持 host 或 offline；API fallback 尚未配置');
  requireThat(executor !== 'offline' || mode === 'demo', 'DEMO_ONLY', '离线图像处理仅允许在 demo 工作区运行');
  requireThat(Array.isArray(input.steps) && input.steps.length > 0 && input.steps.length <= 20, 'INVALID_PLAN', '计划需要 1–20 个步骤');
  const groups = new Map(task.requirements.filter(active).map((group) => [group.id, group]));
  requireThat([...groups.values()].some((group) => group.scope === 'operation'), 'EMPTY_REQUIREMENTS', '至少填写一个未停用的修改需求');
  const steps: Step[] = input.steps.map((raw) => {
    const step = object(raw, ['id', 'name', 'operation', 'input', 'needs', 'requirement_ids', 'reference_asset_ids', 'region', 'prompt', 'offline'], '步骤');
    requireThat(step.operation === 'image.edit', 'UNSUPPORTED_OPERATION', '当前只支持 image.edit 操作');
    const region = object(step.region, ['x', 'y', 'width', 'height'], 'region');
    for (const name of ['x', 'y', 'width', 'height']) requireThat(Number.isSafeInteger(region[name]), 'INVALID_REGION', '区域坐标必须为整数');
    const rect = region as unknown as Step['region'];
    requireThat(rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0 && rect.x + rect.width <= asset.width && rect.y + rect.height <= asset.height, 'INVALID_REGION', '区域超出规范化工作图');
    const groupIds = strings(step.requirement_ids, 'requirement_ids');
    requireThat(groupIds.length > 0 && groupIds.every((groupId) => groups.get(groupId)?.scope === 'operation'), 'INACTIVE_REQUIREMENT', '步骤只能绑定有效的修改需求组');
    const source = text(step.input, 'input', 100);
    requireThat(source === 'original' || /^step:[a-z][a-z0-9-]*$/.test(source), 'INVALID_BINDING', 'input 必须为 original 或 step:<id>');
    const specific = step.prompt === undefined ? '' : text(step.prompt, 'prompt');
    const prompt = [task.brief, '本步修改：', ...groupIds.map((groupId) => groups.get(groupId)!.label + '：' + groups.get(groupId)!.text.trim()),
      '共享约束与参考职责：', ...[...groups.values()].filter((group) => group.scope !== 'operation').map((group) => group.label + '：' + group.text.trim()), specific,
      '只修改已批准蒙版范围。保留工作图其他区域和前序已完成改动。'].filter(Boolean).join('\n');
    const result: Step = { id: key(step.id, '步骤 id'), name: text(step.name, '步骤名称', 160), operation: 'image.edit', input: source,
      needs: strings(step.needs, 'needs'), requirement_ids: groupIds, reference_asset_ids: strings(step.reference_asset_ids ?? [], 'reference_asset_ids'), region: rect, prompt };
    if (executor === 'offline') {
      const offline = object(step.offline, ['kind', 'rgba'], 'offline');
      requireThat(offline.kind === 'fill' && Array.isArray(offline.rgba) && offline.rgba.length === 4 && offline.rgba.every((number) => Number.isInteger(number) && number >= 0 && number <= 255), 'INVALID_OFFLINE_OPERATION', '离线操作需要 fill 与四项 RGBA');
      result.offline = { kind: 'fill', rgba: offline.rgba as [number, number, number, number] };
    } else requireThat(step.offline === undefined, 'INVALID_PLAN', 'host 计划不能携带 offline 操作');
    return result;
  });
  const byId = new Map(steps.map((step) => [step.id, step]));
  requireThat(byId.size === steps.length, 'DUPLICATE_ID', '步骤 id 重复');
  const visiting = new Set<string>(), visited = new Set<string>(), ordered: Step[] = [];
  function visit(step: Step) {
    requireThat(!visiting.has(step.id), 'PLAN_CYCLE', '步骤依赖有环');
    if (visited.has(step.id)) return;
    visiting.add(step.id);
    for (const parent of step.needs) { requireThat(byId.has(parent), 'MISSING_DEPENDENCY', '未知前序步骤 ' + parent); visit(byId.get(parent)!); }
    visiting.delete(step.id); visited.add(step.id); ordered.push(step);
  }
  for (const step of steps) visit(step);
  function ancestors(step: Step): Set<string> { const found = new Set<string>(); for (const parent of step.needs) { found.add(parent); for (const ancestor of ancestors(byId.get(parent)!)) found.add(ancestor); } return found; }
  for (const step of ordered) if (step.input.startsWith('step:')) requireThat(ancestors(step).has(step.input.slice(5)), 'UNORDERED_BINDING', '工作图来源不属于本步前序');
  // One image-writing chain makes result inheritance explicit in the first release.
  for (let index = 0; index < ordered.length; index++) requireThat(ordered[index].input === (index === 0 ? 'original' : 'step:' + ordered[index - 1].id), 'SERIAL_IMAGE_CHAIN', '首版要求一条连续图像链，后一步承接前一步结果');
  for (const group of groups.values()) if (group.scope === 'operation') requireThat(ordered.some((step) => step.requirement_ids.includes(group.id)), 'UNCOVERED_REQUIREMENT', '计划缺少需求组 ' + group.id);
  for (const step of ordered) requireThat(![...groups.values()].some((group) => group.scope === 'reference') || step.reference_asset_ids.length > 0, 'MISSING_REFERENCE', '有参考用途需求时须绑定参考素材');
  const body = { schema_version: 'retouch.plan/v1' as const, task_id: task.id, revision: task.plan_revision + 1,
    title: text(input.title ?? task.title, '计划名称', 160), executor: executor as Plan['executor'], requirements_hash: task.requirements_hash,
    original_asset_id: task.original_asset_id, working_asset_id: task.working_asset_id, steps: ordered, created_at: now() };
  return { ...body, hash: hash(body) };
}

export function approval(value: unknown, plan: Plan, asset: Asset, config: WorkspaceConfig, workspaceRoot: string): Omit<Grant, 'id' | 'created_at'> {
  const grant = object(value, ['schema_version', 'plan_hash', 'asset_sha256', 'executor', 'issuer', 'confirmation', 'expires_at', 'delivery_root'], '授权回执');
  requireThat(grant.schema_version === 'retouch.approval/v1' && grant.plan_hash === plan.hash && grant.asset_sha256 === asset.sha256 && grant.executor === plan.executor, 'APPROVAL_MISMATCH', '授权必须绑定当前计划、工作图和执行方式');
  requireThat(['human', 'host-human', 'demo'].includes(grant.issuer as string), 'INVALID_ISSUER', '无效授权来源');
  requireThat(grant.issuer !== 'demo' || config.mode === 'demo', 'DEMO_ONLY', 'demo 回执不能批准真实任务');
  const expires = Date.parse(text(grant.expires_at, 'expires_at'));
  requireThat(Number.isFinite(expires) && expires > Date.now() && expires <= Date.now() + 7 * 86400000, 'APPROVAL_EXPIRED', '授权有效期必须在未来七天以内');
  const deliveryRoot = path.resolve(grant.delivery_root === undefined ? path.join(workspaceRoot, 'exports') : text(grant.delivery_root, 'delivery_root'));
  const exportsRoot = path.join(workspaceRoot, 'exports');
  requireThat(deliveryRoot === exportsRoot || deliveryRoot.startsWith(exportsRoot + path.sep), 'DELIVERY_SCOPE', '首版交付根须位于本工作区 exports 中');
  return { task_id: plan.task_id, plan_hash: plan.hash, executor: plan.executor, asset_sha256: asset.sha256, delivery_root: deliveryRoot, max_runs: 1,
    issuer: grant.issuer as Grant['issuer'], confirmation: receiptText(grant.confirmation, 'confirmation'), expires_at: new Date(expires).toISOString() };
}
