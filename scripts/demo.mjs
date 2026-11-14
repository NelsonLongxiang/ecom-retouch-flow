// Run the actual CLI with a native ygl workspace and offline image edits. Usage: node scripts/demo.mjs --ygl-entry <installed-bin.cjs>
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import assert from 'node:assert/strict';
import sharp from 'sharp';
const root = await fs.realpath(fileURLToPath(new URL('../', import.meta.url)));
const args = process.argv.slice(2);
let entry = process.env.RETOUCH_YGL_ENTRY;
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--ygl-entry' && args[index + 1]) entry = await fs.realpath(args[++index]);
  else throw new Error('Unknown demo option: ' + args[index]);
}
if (!entry) throw new Error('Supply --ygl-entry <installed-bin.cjs>.');
const parent = path.join(root, 'tmp/demo'); await fs.mkdir(parent, { recursive: true });
if (!(await fs.realpath(parent)).startsWith(root + path.sep)) throw new Error('Demo output escapes project');
const demoRoot = await fs.mkdtemp(path.join(parent, 'run-')), workspace = path.join(demoRoot, 'workspace');
const source = path.join(demoRoot, 'original.png'), calls = [], invoke = promisify(execFile);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="280"><rect width="360" height="280" fill="#f2f3f5"/><text x="20" y="28" font-family="Arial" font-size="15" fill="#333">OFFLINE WORKFLOW DEMO</text><rect x="52" y="48" width="256" height="184" rx="8" fill="#b8b1a7"/><rect x="64" y="60" width="112" height="156" fill="#e1d9cd"/><rect x="184" y="60" width="112" height="156" fill="#e1d9cd"/><rect x="156" y="118" width="7" height="35" rx="2" fill="#494949"/><rect x="196" y="118" width="7" height="35" rx="2" fill="#494949"/><rect x="66" y="232" width="12" height="20" fill="#494949"/><rect x="282" y="232" width="12" height="20" fill="#494949"/></svg>`;
await sharp(Buffer.from(svg)).png().toFile(source);
const originalHash = crypto.createHash('sha256').update(await fs.readFile(source)).digest('hex');
async function json(name, value) { const full = path.join(demoRoot, name); await fs.writeFile(full, JSON.stringify(value, null, 2) + '\n'); return full; }
async function cli(command, expected) {
  process.stderr.write('[demo] ' + command.slice(0, 2).join(' ') + '\n');
  const { stdout } = await invoke(process.execPath, ['src/cli.ts', ...command, '--json'], { cwd: root, windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  const result = JSON.parse(stdout); assert.equal(result.ok, true);
  if (expected) assert.equal(result.result_status, expected);
  calls.push({ command, response: result }); return result;
}
const inWorkspace = (command) => [...command, '--workspace', workspace];
await cli(['workspace', 'init', workspace, '--demo', '--ygl-entry', entry], 'initialized');
let result = await cli(inWorkspace(['task', 'new', '--image', source, '--brief', '分别处理把手和门板区域，其余区域保持。离线流程演示。']), 'draft');
const taskId = result.data.task_id;
const requirementFile = await json('requirements.json', { schema_version: 'retouch.requirements/v1', groups: [
  { id: 'handle', label: '把手', text: '处理左侧把手区域（离线改色演示）', disabled: false, scope: 'operation' },
  { id: 'material', label: '门板', text: '处理右侧门板区域（离线改色演示）', disabled: false, scope: 'operation' },
  { id: 'keep', label: '保持', text: '其他区域和前序已完成修改保持', disabled: false, scope: 'preserve' },
  { id: 'disabled', label: '停用示例', text: '此项保留但不参与执行', disabled: true, scope: 'operation' },
] });
await cli(inWorkspace(['requirement', 'set', taskId, '--file', requirementFile, '--expected-revision', '0']));
const planFile = await json('plan.json', { schema_version: 'retouch.plan/v1', title: '离线两步局部图像演示', executor: 'offline', steps: [
  { id: 'handle', name: '处理把手', operation: 'image.edit', input: 'original', needs: [], requirement_ids: ['handle'], region: { x: 153, y: 114, width: 14, height: 43 }, offline: { kind: 'fill', rgba: [66, 100, 132, 255] } },
  { id: 'material', name: '处理门板', operation: 'image.edit', input: 'step:handle', needs: ['handle'], requirement_ids: ['material'], region: { x: 184, y: 60, width: 112, height: 156 }, offline: { kind: 'fill', rgba: [181, 143, 100, 255] } },
] });
result = await cli(inWorkspace(['plan', 'submit', taskId, '--file', planFile, '--expected-revision', '1']), 'awaiting_approval');
const planHash = result.data.plan_hash;
const grantFile = await json('approval.json', { ...result.data.approval_template, issuer: 'demo', confirmation: '离线夹具授权：无 AI 调用、无独立 API 费用，不代表真实用户确认。' });
await cli(inWorkspace(['approval', 'grant', taskId, '--file', grantFile, '--expected-revision', '2']), 'approved');
result = await cli(inWorkspace(['run', 'start', taskId, '--expected-revision', '3']), 'running');
const runId = result.data.run_id;
result = await cli(inWorkspace(['run', 'advance', runId, '--expected-revision', String(result.data.run_revision), '--request-id', 'demo-first']), 'running');
const first = result.data.candidate;
result = await cli(inWorkspace(['run', 'advance', runId, '--expected-revision', String(result.data.run_revision), '--request-id', 'demo-second']), 'waiting_for_review');
assert.equal(result.data.attempt.input_asset_id, first.id);
const final = result.data.candidate;
const reviewFile = await json('final-review.json', { schema_version: 'retouch.final-review/v1', run_id: runId, plan_hash: planHash, output_sha256: final.sha256, verdict: 'accept', issuer: 'demo', confirmation: '离线夹具流程验收，不代表 AI 商品修图质量验收。' });
result = await cli(inWorkspace(['review', 'accept', runId, '--file', reviewFile, '--expected-revision', String(result.data.run_revision), '--request-id', 'demo-final']), 'accepted');
const deliveredTo = path.join(workspace, 'exports/result');
result = await cli(inWorkspace(['deliver', runId, '--to', deliveredTo, '--expected-revision', String(result.data.run_revision), '--request-id', 'demo-delivery']), 'completed');
await cli(inWorkspace(['run', 'timeline', runId]));
const health = await cli(inWorkspace(['doctor'])); assert.equal(health.result_status, 'healthy');
assert.equal(originalHash, crypto.createHash('sha256').update(await fs.readFile(source)).digest('hex'));
const comparison = path.join(demoRoot, 'comparison.png');
const labels = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="34"><rect width="1080" height="34" fill="white"/><g font-family="Arial" font-size="15" fill="#333"><text x="18" y="23">1. Original</text><text x="378" y="23">2. Step one</text><text x="738" y="23">3. Step two inherits step one</text></g></svg>');
await sharp({ create: { width: 1080, height: 314, channels: 4, background: 'white' } }).composite([{ input: labels, top: 0, left: 0 }, { input: source, top: 34, left: 0 }, { input: first.file, top: 34, left: 360 }, { input: final.file, top: 34, left: 720 }]).png().toFile(comparison);
const report = { schema: 'retouch.offline-demo/v1', verdict: 'PASS', recorded_at: new Date().toISOString(), demo_root: demoRoot, workspace, task_id: taskId, run_id: runId, plan_hash: planHash,
  native_ygl: 'PASS', original_unchanged: true, second_input_equals_first_output: true, final_output: path.join(deliveredTo, 'image.png'), comparison,
  image_ai_generation: 'NOT_RUN', paid_api_calls: 'NOT_RUN', human_acceptance: 'DEMO_FIXTURE_ONLY', calls };
await fs.mkdir(path.join(root, 'docs/verification'), { recursive: true });
await fs.mkdir(path.join(root, 'docs/verification/runs'), { recursive: true });
await fs.writeFile(path.join(root, 'docs/verification/runs', 'demo-' + path.basename(demoRoot) + '.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
await fs.writeFile(path.join(demoRoot, 'demo-evidence.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
await fs.writeFile(path.join(root, 'docs/verification/offline-demo.json'), JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify({ verdict: report.verdict, workspace, final_output: report.final_output, comparison, image_ai_generation: report.image_ai_generation }) + '\n');
