// Run scoped CLI tests and save parsed TAP evidence. Usage: node scripts/test.mjs --ygl-entry <installed-bin.cjs> | --unit-only
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
const root = await fs.realpath(fileURLToPath(new URL("../", import.meta.url)));
const args = process.argv.slice(2);
let entry = process.env.RETOUCH_YGL_ENTRY,
  unitOnly = false,
  legacy = false,
  apiOnly = false;
for (let index = 0; index < args.length; index++) {
  if (args[index] === "--ygl-entry" && args[index + 1])
    entry = await fs.realpath(args[++index]);
  else if (args[index] === "--unit-only") unitOnly = true;
  else if (args[index] === "--legacy") legacy = true;
  else if (args[index] === "--suite" && args[index + 1] === "api") {
    apiOnly = true;
    index++;
  } else throw new Error("Unknown test option: " + args[index]);
}
if (legacy && apiOnly)
  throw new Error("--legacy and --suite api cannot be combined.");
if (!unitOnly && !entry)
  throw new Error(
    "Supply --ygl-entry <installed-bin.cjs> for integration tests, or explicitly choose --unit-only.",
  );
const parent = path.join(root, "tmp/cli-tests");
await fs.mkdir(parent, { recursive: true });
if (!(await fs.realpath(parent)).startsWith(root + path.sep))
  throw new Error("Test output escapes project");
const runRoot = await fs.mkdtemp(path.join(parent, "run-"));
const files = (await fs.readdir(path.join(root, "tests")))
  .filter(
    (name) =>
      name.endsWith(".test.ts") &&
      (legacy
        ? !name.startsWith("native-")
        : apiOnly
          ? name.startsWith("native-api")
          : name.startsWith("native-")),
  )
  .sort()
  .map((name) => "tests/" + name);
const command = [
  "--test",
  "--test-concurrency=1",
  "--test-reporter=tap",
  ...files,
];
const started = new Date().toISOString();
const child = spawn(process.execPath, command, {
  cwd: root,
  windowsHide: true,
  env: {
    ...process.env,
    RETOUCH_TEST_ROOT: runRoot,
    RETOUCH_TEST_YGL_ENTRY: unitOnly ? "" : entry,
    RETOUCH_LEGACY_TEST: legacy ? "1" : "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let stdout = "",
  stderr = "";
child.stdout.on("data", (chunk) => {
  stdout += chunk;
});
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});
const exitCode = await new Promise((resolve, reject) => {
  child.on("error", reject);
  child.on("close", (code) => resolve(code));
});
await fs.writeFile(path.join(runRoot, "tests.tap"), stdout);
await fs.writeFile(path.join(runRoot, "stderr.log"), stderr);
const counts = {};
for (const name of ["tests", "pass", "fail", "cancelled", "skipped", "todo"]) {
  const matches = [
    ...stdout.matchAll(new RegExp("^# " + name + " (\\d+)$", "gm")),
  ];
  counts[name] = matches.length ? Number(matches.at(-1)[1]) : null;
}
const nativeEvidence = unitOnly
  ? null
  : await fs
      .readFile(path.join(runRoot, "native-evidence.json"), "utf8")
      .then(JSON.parse)
      .catch(() => null);
const contextEvidence = unitOnly
  ? null
  : await fs
      .readFile(path.join(runRoot, "context-native-evidence.json"), "utf8")
      .then(JSON.parse)
      .catch(() => null);
const wrapperEvidence =
  unitOnly || legacy
    ? null
    : await fs
        .readFile(path.join(runRoot, "native-wrapper-evidence.json"), "utf8")
        .then(JSON.parse)
        .catch(() => null);
const apiEvidence =
  unitOnly || legacy
    ? null
    : await fs
        .readFile(path.join(runRoot, "native-api-evidence.json"), "utf8")
        .then(JSON.parse)
        .catch(() => null);
const passed =
  exitCode === 0 &&
  counts.tests > 0 &&
  counts.fail === 0 &&
  counts.cancelled === 0 &&
  (unitOnly ||
    (counts.skipped === 0 &&
      (legacy
        ? nativeEvidence?.verdict === "PASS" &&
          contextEvidence?.verdict === "PASS"
        : apiOnly
          ? apiEvidence?.verdict === "PASS"
          : wrapperEvidence?.verdict === "PASS" &&
            apiEvidence?.verdict === "PASS")));
const snapshots = [];
async function snapshot(directory) {
  for (const item of await fs.readdir(path.join(root, directory), {
    withFileTypes: true,
  })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) await snapshot(file);
    else
      snapshots.push({
        file: file.replaceAll("\\", "/"),
        sha256: crypto
          .createHash("sha256")
          .update(await fs.readFile(path.join(root, file)))
          .digest("hex"),
      });
  }
}
for (const directory of ["src", "tests"]) await snapshot(directory);
for (const file of [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "scripts/test.mjs",
])
  snapshots.push({
    file,
    sha256: crypto
      .createHash("sha256")
      .update(await fs.readFile(path.join(root, file)))
      .digest("hex"),
  });
const report = {
  schema: "retouch.implementation-tests/v1",
  verdict: passed ? "PASS" : "FAIL",
  started_at: started,
  finished_at: new Date().toISOString(),
  node_version: process.version,
  observed_exit_code: exitCode,
  counts,
  native_ygl_integration: unitOnly
    ? "NOT_RUN"
    : passed
      ? "PASS"
      : "CHECK_FAILURES",
  architecture: legacy
    ? "HISTORICAL_LEDGER_FIXTURES_ONLY"
    : "YGL_NATIVE_WRAPPER",
  test_suite: apiOnly ? "API_FALLBACK" : "FULL",
  native_api_evidence: apiEvidence,
  native_wrapper_evidence: wrapperEvidence,
  native_evidence: nativeEvidence,
  context_native_evidence: contextEvidence,
  ygl_entry: unitOnly ? null : entry,
  evidence_directory: runRoot,
  scope: {
    image_ai_generation: "NOT_RUN",
    paid_api_calls: "NOT_RUN",
    host_protocol: "LOCAL_FIXTURES_ONLY",
    malicious_agent_sandbox: "NOT_CLAIMED",
  },
  snapshots,
};
await fs.mkdir(path.join(root, "docs/verification"), { recursive: true });
await fs.mkdir(path.join(root, "docs/verification/runs"), { recursive: true });
await fs.writeFile(
  path.join(root, "docs/verification/runs", path.basename(runRoot) + ".json"),
  JSON.stringify(report, null, 2) + "\n",
  { flag: "wx" },
);
const output = path.join(
  root,
  "docs/verification",
  legacy
    ? "legacy-tests.json"
    : apiOnly
      ? "api-tests.json"
      : unitOnly
        ? "unit-tests.json"
        : "native-wrapper-tests.json",
);
await fs.writeFile(output, JSON.stringify(report, null, 2) + "\n");
if (!passed) process.stderr.write(stdout + stderr);
process.stdout.write(
  JSON.stringify({
    verdict: report.verdict,
    counts,
    native_ygl_integration: report.native_ygl_integration,
    report: output,
  }) + "\n",
);
process.exitCode = passed ? 0 : 1;
