import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture, ready, revision } from './fixtures.ts';
import { type Attempt } from '../src/domain/model.ts';
const invoke = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
async function cli(args: string[]) {
  let stdout = '', code = 0;
  try { ({ stdout } = await invoke(process.execPath, ['src/cli.ts', ...args, '--json'], { cwd: root, windowsHide: true, timeout: 30000 })); }
  catch (error) { stdout = (error as { stdout: string }).stdout; code = Number((error as { code: number }).code); }
  const result = JSON.parse(stdout.trim());
  return { result, code, stdout };
}
test('CLI JSON 为单一信封，未知、重复与错用参数返回 rc2', async () => {
  const help = await cli(['--help']); assert.equal(help.code, 0); assert.equal(help.result.command, 'help');
  for (const args of [['--imaginary'], ['doctor', '--file', 'unused'], ['doctor', '--workspace', 'a', '--workspace', 'b'], ['task', 'unknown']]) {
    const output = await cli(args); assert.equal(output.code, 2); assert.equal(output.result.ok, false); assert.equal(output.result.error.effect_status, 'none');
  }
});
test('CLI 不猜测全局工作区，查询返回实际任务身份', async (t) => {
  const missing = await cli(['task', 'list']); assert.equal(missing.code, 2);
  const f = await fixture(); t.after(() => f.store.close()); const { taskId } = await ready(f);
  const shown = await cli(['task', 'show', taskId, '--workspace', f.root]);
  assert.equal(shown.code, 0); assert.equal(shown.result.data.task_id, taskId); assert.equal(shown.result.data.task.id, taskId);
  const capabilities = await cli(['capabilities', '--workspace', f.root]);
  assert.equal(capabilities.result.data.primary, 'host'); assert.equal(capabilities.result.data.fallback.automatic, false);
});
test('真实进程中断后恢复同一尝试，不新建生成请求', async (t) => {
  const f = await fixture(); t.after(() => f.store.close()); const { runId } = await ready(f);
  let exit = 0;
  try { await invoke(process.execPath, ['tests/crash-worker.ts', f.root, runId, '0'], { cwd: root, windowsHide: true, timeout: 30000 }); }
  catch (error) { exit = Number((error as { code: number }).code); }
  assert.equal(exit, 86);
  const before = f.store.list<Attempt>('attempt'); assert.equal(before.length, 1); assert.equal(before[0].data.status, 'prepared');
  const result = await f.service.resume(runId, revision(f, runId)); assert.equal(result.result_status, 'running');
  const after = f.store.list<Attempt>('attempt'); assert.equal(after.length, 1); assert.equal(after[0].data.id, before[0].data.id); assert.equal(after[0].data.status, 'succeeded');
  assert.equal((await f.service.advance(runId, 0, 'crash-key')).replayed, true);
});
