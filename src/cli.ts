#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Service, initializeWorkspace } from './application/service.ts';
import { Store } from './infrastructure/store.ts';
import { object } from './domain/validation.ts';
import { requireThat, RetouchError, type Result } from './domain/model.ts';
import { Projects, type TaskBinding } from './application/projects.ts';
import { exportContext, inspectContext, inspectedResult, importContext, previewImport, rebuildContextIndex, type ImportStrategy } from './application/context-exchange.ts';

const options = {
  workspace: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean' }, version: { type: 'boolean' },
  'ygl-entry': { type: 'string' }, demo: { type: 'boolean' }, image: { type: 'string' }, brief: { type: 'string' }, title: { type: 'string' },
  file: { type: 'string' }, 'expected-revision': { type: 'string' }, 'request-id': { type: 'string' }, to: { type: 'string' },
  project: { type: 'string' }, goal: { type: 'string' }, 'goal-version': { type: 'string' }, 'expected-output': { type: 'string' }, 'done-when': { type: 'string' }, kind: { type: 'string' },
  metadata: { type: 'string' }, 'dry-run': { type: 'boolean' }, strategy: { type: 'string' },
} as const;
const commands: Record<string, { operands: number; flags: string[]; description: string }> = {
  'workspace init': { operands: 1, flags: ['ygl-entry', 'demo'], description: '在明确目录初始化工作区与独立 ygl home' },
  'task new': { operands: 0, flags: ['image', 'brief', 'title', 'file', 'project', 'goal', 'goal-version', 'expected-output', 'done-when', 'kind'], description: '绑定项目与目标版本，建立图像或设计任务' },
  'task show': { operands: 1, flags: [], description: '查看任务与版本' },
  'task list': { operands: 0, flags: [], description: '列出本工作区任务' },
  'asset add': { operands: 0, flags: ['file'], description: '导入原图／参考图' },
  'asset show': { operands: 1, flags: [], description: '核验素材字节与身份' },
  'requirement set': { operands: 1, flags: ['file', 'expected-revision'], description: '保存需求组：有文字且未停用即参与' },
  'plan submit': { operands: 1, flags: ['file', 'expected-revision'], description: '编译、冻结并投影计划，默认 host 执行' },
  'plan show': { operands: 1, flags: [], description: '查看当前冻结计划' },
  'plan check': { operands: 1, flags: [], description: '核对计划投影与版本' },
  'approval grant': { operands: 1, flags: ['file', 'expected-revision'], description: '记录用户／宿主确认回执' },
  'run start': { operands: 1, flags: ['expected-revision'], description: '绑定计划、授权与输入，创建运行' },
  'run advance': { operands: 1, flags: ['expected-revision', 'request-id'], description: '推进一步；host 模式返回待执行任务单' },
  'run dispatch': { operands: 1, flags: ['expected-revision', 'request-id'], description: '记录一次宿主工具执行意图，防止恢复时盲目重发' },
  'run complete': { operands: 1, flags: ['file', 'expected-revision', 'request-id'], description: '回接真实宿主结果并合成批准区域' },
  'run review': { operands: 1, flags: ['file', 'expected-revision', 'request-id'], description: '记录实际候选图的视觉检查' },
  'run status': { operands: 1, flags: [], description: '查询状态、图片与下一步' },
  'run timeline': { operands: 1, flags: [], description: '查询事件时间线' },
  'run resume': { operands: 1, flags: ['expected-revision'], description: '恢复本地准备或交付，不重发未知宿主请求' },
  'run reconcile': { operands: 1, flags: ['expected-revision'], description: '核对当前状态，不自动重新生成图片' },
  'run cancel': { operands: 1, flags: ['expected-revision'], description: '停止后续步骤，保留已有请求与结果' },
  'review show': { operands: 1, flags: [], description: '查看终验候选' },
  'review accept': { operands: 1, flags: ['file', 'expected-revision', 'request-id'], description: '记录指定图像的用户最终接受' },
  'review reject': { operands: 1, flags: ['file', 'expected-revision', 'request-id'], description: '记录用户要求修正' },
  'ygl sync': { operands: 1, flags: [], description: '仅补投影和证据，不生成图片' },
  'ygl check': { operands: 1, flags: [], description: '核对冻结图' },
  next: { operands: 1, flags: [], description: '给一个具体下一步或必要问题' },
  deliver: { operands: 1, flags: ['to', 'expected-revision', 'request-id'], description: '交付已接受图片与清单，拒绝覆盖' },
  doctor: { operands: 0, flags: [], description: '本地对象库与 ygl 健康检查' },
  capabilities: { operands: 0, flags: [], description: '宿主优先、离线演示与 API fallback 边界' },
  'project new': { operands: 0, flags: ['file'], description: '建立有原始业务意图的项目' },
  'project list': { operands: 0, flags: [], description: '列出业务项目，区别于源码仓库与工作区' },
  'project brief': { operands: 1, flags: [], description: '读取账本生成的目标、设计、进度、产物和下一步' },
  'project bind-task': { operands: 1, flags: ['file', 'expected-revision'], description: '显式迁移既有任务或重绑当前目标版本' },
  'project note': { operands: 0, flags: ['project', 'file', 'request-id'], description: '登记用户原文、确认事实、假设和待确认来源' },
  'goal new': { operands: 0, flags: ['project', 'file', 'expected-revision'], description: '建立范围、保持项和验收明确的目标版本' },
  'goal revise': { operands: 1, flags: ['project', 'file', 'expected-revision'], description: '追加目标版本，仅标记受影响的下游工作' },
  'task context-review': { operands: 1, flags: ['file', 'expected-revision'], description: '记录对变更后任务上下文的实际复核' },
  'task close': { operands: 1, flags: ['file', 'expected-revision'], description: '核对阶段交付物与终止条件后关闭任务' },
  'artifact register': { operands: 1, flags: ['file', 'metadata', 'request-id'], description: '登记真实文件及用途、来源和派生关系' },
  'artifact show': { operands: 1, flags: [], description: '查询产物版本、文件、归属与双向关系' },
  'artifact list': { operands: 0, flags: ['project'], description: '按项目查询统一产物索引' },
  'artifact review': { operands: 1, flags: ['file', 'expected-revision', 'request-id'], description: '对实际产物 hash 记录检查或用户接受' },
  'design register': { operands: 1, flags: ['file', 'expected-revision'], description: '追加设计／变体版本、来源事实和假设' },
  'execution record': { operands: 1, flags: ['file', 'request-id'], description: '登记外部执行意图或已经发生的事实，不发出请求' },
  'execution reconcile': { operands: 1, flags: ['file', 'expected-revision', 'request-id'], description: '回接同一外部操作的真实结果，不重新生成' },
  'execution show': { operands: 1, flags: [], description: '查询外部请求、输入输出与恢复状态' },
  'index check': { operands: 0, flags: ['project'], description: '检查归属、关系、版本、对象 hash 与索引状态' },
  'index rebuild': { operands: 0, flags: ['project'], description: '从领域账本重建 SQLite 和 ygl 投影，不出图' },
  'context export': { operands: 0, flags: ['project', 'to'], description: '导出完整项目、关系和必要素材为单个 ZIP' },
  'context inspect': { operands: 0, flags: ['file'], description: '只读验证 ZIP 的版本、清单、hash 和领域关系' },
  'context import': { operands: 0, flags: ['file', 'dry-run', 'strategy', 'ygl-entry'], description: '预检或事务恢复 ZIP；重复导入幂等，不执行图像工具' },
  'run authorize': { operands: 1, flags: ['expected-revision'], description: '将本工作区新记录的有效授权绑定已有恢复运行' },
};
export async function readJSON(file: string): Promise<unknown> {
  const stat = await fs.stat(file).catch(() => { throw new RetouchError('INPUT_FILE_NOT_FOUND', 'JSON 输入文件不存在', 2); });
  requireThat(stat.isFile() && stat.size <= 1024 * 1024, 'INPUT_SIZE', 'JSON 输入须为不超过 1 MiB 的文件');
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { throw new RetouchError('INPUT_JSON', '输入文件不是有效 JSON；未执行写操作', 2); }
}
export async function execute(args: string[]): Promise<{ command: string; result: Result }> {
  let parsed;
  try { parsed = parseArgs({ args, options, strict: true, allowPositionals: true, tokens: true }); }
  catch { throw new RetouchError('CLI_ARGUMENTS', '参数无效或存在未知选项；请运行 --help', 2); }
  const seen = new Set<string>();
  for (const token of parsed.tokens) if (token.kind === 'option') { requireThat(!seen.has(token.name), 'DUPLICATE_OPTION', '选项不得重复：' + token.name); seen.add(token.name); }
  if (parsed.values.help || parsed.positionals[0] === 'help' || args.length === 0) return { command: 'help', result: { result_status: 'help', data: { product: '电商修图流', version: '0.2.0', commands, usage: 'node src/cli.ts <command> --workspace <dir> --json', image_execution: 'host-first; independent API fallback is explicit and not configured' } } };
  if (parsed.values.version) return { command: 'version', result: { result_status: 'version', data: { version: '0.2.0' } } };
  const words = [...parsed.positionals];
  const command = ['next', 'deliver', 'doctor', 'capabilities'].includes(words[0]) ? words.shift()! : words.splice(0, 2).join(' ');
  const spec = commands[command]; requireThat(spec, 'UNKNOWN_COMMAND', '未知命令；请运行 --help');
  requireThat(words.length === spec.operands, 'CLI_OPERANDS', '命令参数数量不匹配：' + command);
  for (const flag of seen) requireThat(['workspace', 'json', ...spec.flags].includes(flag), 'UNSUPPORTED_OPTION', command + ' 不支持 --' + flag);
  const needed = (name: keyof typeof options): string => {
    const value = parsed.values[name]; requireThat(typeof value === 'string' && value.length > 0, 'MISSING_OPTION', '缺少 --' + name); return value;
  };
  const revision = () => {
    const value = needed('expected-revision'); requireThat(/^\d+$/.test(value) && Number.isSafeInteger(Number(value)), 'INVALID_REVISION', 'expected-revision 必须为非负整数'); return Number(value);
  };
  const request = () => needed('request-id');
  const operand = words[0];
  if (command === 'workspace init') {
    requireThat(!parsed.values.workspace, 'CLI_ARGUMENTS', 'workspace init 用位置参数指定目录');
    return { command, result: await initializeWorkspace(operand, parsed.values['ygl-entry'] ?? process.env.RETOUCH_YGL_ENTRY ?? '', parsed.values.demo ?? false) };
  }
  if (command === 'context inspect') return { command, result: inspectedResult(await inspectContext(needed('file'))) };
  if (command === 'context import') {
    const strategy = parsed.values.strategy as ImportStrategy | undefined;
    return { command, result: parsed.values['dry-run'] ? await previewImport(needed('file'), needed('workspace'), strategy) : await importContext(needed('file'), needed('workspace'), { strategy, yglEntry: parsed.values['ygl-entry'] }) };
  }
  const store = await Store.open(needed('workspace'));
  try {
    const service = new Service(store);
    const projects = new Projects(store);
    let result: Result;
    switch (command) {
      case 'task new': {
        const binding = parsed.values.file ? object(await readJSON(needed('file')), ['project_id', 'goal_id', 'goal_version', 'expected_output', 'done_when', 'dependencies', 'kind'], '任务归属') as unknown as TaskBinding : { project_id: needed('project'), goal_id: needed('goal'), goal_version: Number(needed('goal-version')), expected_output: needed('expected-output'), done_when: needed('done-when'), kind: (parsed.values.kind ?? 'image') as 'image' | 'design' };
        result = await service.createTask(parsed.values.image, needed('brief'), parsed.values.title, binding); break;
      }
      case 'task show': result = service.taskView(operand); break;
      case 'task list': result = { result_status: 'listed', data: { tasks: store.list('task') } }; break;
      case 'asset add': result = await service.addAsset(needed('file')); break;
      case 'asset show': result = await service.inspect(operand); break;
      case 'requirement set': result = service.setRequirements(operand, await readJSON(needed('file')), revision()); break;
      case 'plan submit': result = await service.submitPlan(operand, await readJSON(needed('file')), revision()); break;
      case 'plan show': result = { result_status: 'planned', data: { plan: service.currentPlan(operand) } }; break;
      case 'plan check': case 'ygl check': result = await service.checkPlan(operand); break;
      case 'approval grant': result = service.grant(operand, await readJSON(needed('file')), revision()); break;
      case 'run start': result = await service.start(operand, revision()); break;
      case 'run advance': result = await service.advance(operand, revision(), request()); break;
      case 'run dispatch': result = service.dispatch(operand, revision(), request()); break;
      case 'run complete': result = await service.complete(operand, await readJSON(needed('file')), revision(), request()); break;
      case 'run review': result = await service.reviewStep(operand, await readJSON(needed('file')), revision(), request()); break;
      case 'run status': case 'review show': result = service.status(operand); break;
      case 'run timeline': result = service.timeline(operand); break;
      case 'run resume': case 'run reconcile': result = await service.resume(operand, revision()); break;
      case 'run cancel': result = service.cancel(operand, revision()); break;
      case 'review accept': case 'review reject': {
        const value = await readJSON(needed('file'));
        requireThat((value as Record<string, unknown>)?.verdict === command.split(' ')[1], 'INVALID_VERDICT', '命令与回执中的终验结论不一致');
        result = await service.finalReview(operand, value, revision(), request()); break;
      }
      case 'deliver': result = await service.deliver(operand, needed('to'), revision(), request()); break;
      case 'next': result = service.next(operand); break;
      case 'ygl sync': result = await service.synchronize(operand); break;
      case 'doctor': result = await service.doctor(); break;
      case 'capabilities': result = { result_status: 'declared', data: { primary: 'host', host_tool_availability: 'must_be_verified_by_current_host', mode: store.config.mode, offline: store.config.mode === 'demo', fallback: { type: 'independent_image_api', implemented: false, configured: false, automatic: false } } }; break;
      case 'project new': result = projects.create(await readJSON(needed('file'))); break;
      case 'project list': result = { result_status: 'listed', data: { projects: store.list('project') } }; break;
      case 'project brief': result = projects.brief(operand); break;
      case 'project bind-task': result = projects.bind(operand, await readJSON(needed('file')), revision()); break;
      case 'project note': result = projects.note(needed('project'), await readJSON(needed('file')), service.requestId(request())); break;
      case 'goal new': case 'goal revise': result = projects.goal(needed('project'), await readJSON(needed('file')), revision(), command === 'goal revise' ? operand : undefined); break;
      case 'task context-review': case 'task close': {
        const receipt = object(await readJSON(needed('file')), ['confirmation'], '任务确认');
        result = command === 'task close' ? projects.closeTask(operand, String(receipt.confirmation ?? ''), revision()) : projects.reviewContext(operand, String(receipt.confirmation ?? ''), revision()); break;
      }
      case 'artifact register': result = await projects.artifact(operand, needed('file'), await readJSON(needed('metadata')), service.requestId(request())); break;
      case 'artifact show': result = projects.artifactView(operand); break;
      case 'artifact list': result = { result_status: 'listed', data: { artifacts: store.list<import('./domain/context.ts').Artifact>('artifact').filter(r => r.data.project_id === needed('project')) } }; break;
      case 'artifact review': result = await projects.reviewArtifact(operand, await readJSON(needed('file')), revision(), service.requestId(request())); break;
      case 'design register': result = projects.design(operand, await readJSON(needed('file')), revision()); break;
      case 'execution record': result = projects.execution(operand, await readJSON(needed('file')), service.requestId(request())); break;
      case 'execution reconcile': result = projects.reconcile(operand, await readJSON(needed('file')), revision(), service.requestId(request())); break;
      case 'execution show': result = { result_status: 'recorded', data: { execution: store.get('execution', operand) } }; break;
      case 'index check': result = await projects.check(parsed.values.project); break;
      case 'index rebuild': result = await rebuildContextIndex(store, needed('project')); break;
      case 'context export': result = await exportContext(store, needed('project'), needed('to')); break;
      case 'run authorize': result = service.authorizeRun(operand, revision()); break;
      default: throw new RetouchError('UNKNOWN_COMMAND', '未知命令', 2);
    }
    return { command, result };
  } finally { store.close(); }
}
export async function main(args: string[]) {
  const json = args.includes('--json');
  try {
    const { command, result } = await execute(args);
    const envelope = { schema_version: 'retouch.cli/v1', ok: true, command: command.replaceAll(' ', '.'), ...result };
    if (json) process.stdout.write(JSON.stringify(envelope) + '\n');
    else {
      process.stdout.write('电商修图流 · ' + result.result_status + '\n');
      if (command === 'help') for (const [name, spec] of Object.entries(commands)) process.stdout.write(name.padEnd(20) + spec.description + '\n');
      else process.stdout.write(JSON.stringify(result.data, null, 2) + '\n');
      for (const action of result.next_actions ?? []) process.stdout.write('下一步：' + action.type + ' — ' + action.reason + '\n');
      for (const warning of result.warnings ?? []) process.stderr.write(warning + '\n');
    }
  } catch (error) {
    const failure = error instanceof RetouchError ? error : new RetouchError('RUNTIME_ERROR', (error as Error).message, 1);
    const output = { schema_version: 'retouch.cli/v1', ok: false, result_status: 'error', error: { code: failure.code, message: failure.message, retryable: false, effect_status: failure.effectStatus, details: failure.details } };
    if (json) process.stdout.write(JSON.stringify(output) + '\n'); else process.stderr.write(failure.code + ': ' + failure.message + '\n');
    process.exitCode = failure.exitCode;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
