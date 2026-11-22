import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  captureNode,
  inspectManagedProcess,
} from "../scripts/lib/native-ygl.mjs";
import { runnerEvidenceCases } from "./helpers/runner-evidence-cases.ts";

for (const scenario of runnerEvidenceCases) test(scenario.name, scenario.run);

const project = path.resolve(import.meta.dirname, "..");
async function managedFixture(
  options: {
    launch?: any;
    exit?: any;
    rawLaunch?: string;
    missingExit?: boolean;
    missingStream?: boolean;
  } = {},
) {
  const base = process.env.RETOUCH_TEST_ROOT;
  assert.ok(base, "Use an isolated project task root");
  const rel = path.relative(path.join(project, "tmp"), path.resolve(base));
  assert.ok(
    rel &&
      rel !== ".." &&
      !rel.startsWith(".." + path.sep) &&
      !path.isAbsolute(rel),
  );
  await fs.mkdir(base, { recursive: true });
  const directory = await fs.mkdtemp(path.join(base, "managed-"));
  const launch = {
    supervisor_pid: 111,
    child_pid: 222,
    started_at: "2026-11-20T10:00:00.000Z",
    args: ["--suite", "receipt-recovery"],
    temp_root: path.join(directory, "temp"),
    global_environment_changed: false,
    ...options.launch,
  };
  const exit = {
    supervisor_pid: 111,
    child_pid: 222,
    started_at: launch.started_at,
    finished_at: "2026-11-20T10:00:01.000Z",
    exit_code: 0,
    signal: null,
    ...options.exit,
  };
  await fs.writeFile(
    path.join(directory, "launch.json"),
    options.rawLaunch ?? JSON.stringify(launch),
    { flag: "wx" },
  );
  if (!options.missingExit)
    await fs.writeFile(
      path.join(directory, "exit.json"),
      JSON.stringify(exit),
      { flag: "wx" },
    );
  await fs.writeFile(path.join(directory, "stdout.log"), "fixture stdout", {
    flag: "wx",
  });
  if (!options.missingStream)
    await fs.writeFile(path.join(directory, "stderr.log"), "", { flag: "wx" });
  return directory;
}

test("managed evidence records closure without inferring PASS or live PID ownership", async () => {
  const directory = await managedFixture();
  const before = await fs.readFile(path.join(directory, "exit.json"));
  const result = await inspectManagedProcess(directory);
  assert.equal(result.status, "CLOSED");
  assert.equal(result.live_state, "NOT_OBSERVED");
  assert.equal(result.exit_code, 0);
  assert.equal("passed" in result, false);
  assert.deepEqual(
    await fs.readFile(path.join(directory, "exit.json")),
    before,
  );
});

test("managed evidence preserves nonzero and signalled closes, not success", async () => {
  for (const terminal of [
    { exit_code: 2, signal: null },
    { exit_code: 0xc0000005, signal: null },
    { exit_code: null, signal: "SIGTERM" },
  ]) {
    const result = await inspectManagedProcess(
      await managedFixture({ exit: terminal }),
    );
    assert.equal(result.status, "CLOSED");
    assert.equal(result.exit_code, terminal.exit_code);
    assert.equal(result.signal, terminal.signal);
  }
});

test("managed evidence missing receipt is UNKNOWN, never assumes running or closed", async () => {
  const directory = await managedFixture({ missingExit: true });
  assert.deepEqual(await inspectManagedProcess(directory), {
    status: "UNKNOWN",
    reason: "NO_EXIT_RECEIPT",
    live_state: "NOT_OBSERVED",
  });
  assert.equal(
    (await inspectManagedProcess(path.join(directory, "absent"))).status,
    "UNKNOWN",
  );
});

test("managed evidence rejects malformed, oversized or unbound launch records", async () => {
  for (const options of [
    { rawLaunch: "{" },
    { rawLaunch: " ".repeat(17000) },
    { launch: { child_pid: -1 } },
    { launch: { temp_root: "elsewhere" } },
    { launch: { global_environment_changed: true } },
    { launch: { args: [1] } },
  ]) {
    assert.equal(
      (await inspectManagedProcess(await managedFixture(options))).status,
      "INVALID",
    );
  }
});

test("managed evidence rejects mismatched identity, time and ambiguous exit", async () => {
  for (const exit of [
    { child_pid: 223 },
    { supervisor_pid: 112 },
    { started_at: "2026-11-20T09:00:00.000Z" },
    { finished_at: "2026-11-20T09:59:59.000Z" },
    { exit_code: null, signal: null },
    { exit_code: 0x100000000 },
    { signal: "not-a-signal" },
  ]) {
    assert.equal(
      (await inspectManagedProcess(await managedFixture({ exit }))).status,
      "INVALID",
    );
  }
  assert.equal(
    (await inspectManagedProcess(await managedFixture({ missingStream: true })))
      .status,
    "INVALID",
  );
});

test("managed evidence rejects root escape and linked records without reading target", async () => {
  assert.equal(
    (await inspectManagedProcess(project)).reason,
    "OUTSIDE_TASK_TMP",
  );
  assert.equal(
    (await inspectManagedProcess(path.join(project, "tmp"))).reason,
    "OUTSIDE_TASK_TMP",
  );
  const directory = await managedFixture({ missingExit: true });
  const target = await managedFixture();
  await fs.symlink(
    target,
    path.join(directory, "alias"),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.equal(
    (await inspectManagedProcess(path.join(directory, "alias"))).reason,
    "LINK_OR_NON_DIRECTORY",
  );
});

test("default Node transport remains usable with isolated temp and scrubbed secrets", async () => {
  const directory = await managedFixture();
  const result = await captureNode(
    [
      "-e",
      'console.log(JSON.stringify({ok:true,temp:require("node:os").tmpdir(),secret:process.env.FIXTURE_API_KEY??null}))',
    ],
    {
      cwd: project,
      logRoot: path.join(directory, "normal-node"),
      env: { FIXTURE_API_KEY: "synthetic-not-secret" },
    },
  );
  assert.equal(result.exit_code, 0);
  assert.equal(result.signal, null);
  assert.equal(result.timed_out, false);
  assert.equal(result.parse_error, null);
  assert.equal(result.json.ok, true);
  assert.equal(result.json.temp, result.child_temp_root);
  assert.equal(result.json.secret, null);
});

test("declared OS diagnostics reject before creating logs or invoking Node payload", async () => {
  const directory = await managedFixture();
  const marker = path.join(directory, "must-not-run");
  const logs = path.join(directory, "must-not-create");
  await assert.rejects(
    captureNode(
      ["-e", 'require("node:fs").writeFileSync(process.argv[1],"bad")', marker],
      { cwd: project, logRoot: logs, purpose: "os-diagnostic" },
    ),
    { code: "DIAGNOSTIC_NOT_SUPPORTED" },
  );
  await assert.rejects(fs.stat(marker), { code: "ENOENT" });
  await assert.rejects(fs.stat(logs), { code: "ENOENT" });
});
