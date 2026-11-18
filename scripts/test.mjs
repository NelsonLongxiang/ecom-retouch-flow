// Run scoped CLI tests and save parsed TAP evidence. Usage: node scripts/test.mjs --ygl-entry <installed-bin.cjs> | --unit-only
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
const root = await fs.realpath(fileURLToPath(new URL("../", import.meta.url)));
const args = process.argv.slice(2);
// Optional supervisor uses this same maintained entry; no shell/tool transcript or tmp wrapper.
const processIndex = args.indexOf("--process-dir");
if (processIndex >= 0) {
  const relative = args[processIndex + 1];
  if (!relative || args.lastIndexOf("--process-dir") !== processIndex)
    throw new Error("One project process directory required");
  args.splice(processIndex, 2);
  const directory = path.resolve(root, relative),
    tmp = path.join(root, "tmp");
  if (!directory.startsWith(tmp + path.sep) || (await fs.realpath(tmp)) !== tmp)
    throw new Error("Process log directory must be inside project tmp");
  await fs.mkdir(directory, { recursive: true });
  if ((await fs.realpath(directory)) !== directory)
    throw new Error("Process log directory cannot follow links");
  const temp = path.join(directory, "temp");
  await fs.mkdir(temp, { recursive: true });
  const out = await fs.open(path.join(directory, "stdout.log"), "wx"),
    err = await fs.open(path.join(directory, "stderr.log"), "wx");
  const started = new Date().toISOString();
  let child;
  try {
    child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...args], {
      cwd: root,
      env: { ...process.env, TMP: temp, TEMP: temp, TMPDIR: temp },
      windowsHide: true,
      stdio: ["ignore", out.fd, err.fd],
    });
    const completion = new Promise((resolve) => {
      child.once("error", (error) =>
        resolve({ exit_code: null, signal: null, start_error: String(error) }),
      );
      child.once("close", (exit_code, signal) =>
        resolve({ exit_code, signal }),
      );
    });
    await fs.writeFile(
      path.join(directory, "launch.json"),
      JSON.stringify(
        {
          supervisor_pid: process.pid,
          child_pid: child.pid,
          started_at: started,
          args,
          temp_root: temp,
          global_environment_changed: false,
        },
        null,
        2,
      ) + "\n",
      { flag: "wx" },
    );
    const result = await completion;
    await fs.writeFile(
      path.join(directory, "exit.json"),
      JSON.stringify(
        {
          ...result,
          started_at: started,
          finished_at: new Date().toISOString(),
          supervisor_pid: process.pid,
          child_pid: child.pid,
        },
        null,
        2,
      ) + "\n",
      { flag: "wx" },
    );
    process.exitCode = result.exit_code === 0 && !result.signal ? 0 : 1;
  } finally {
    await out.close();
    await err.close();
  }
  process.stdout.write(JSON.stringify({schema:"retouch.validation-supervisor/v1",exit_code:process.exitCode??1,process_directory:directory,exit_receipt:path.join(directory,"exit.json"),stdout:path.join(directory,"stdout.log"),stderr:path.join(directory,"stderr.log")})+"\n");
  process.exit(process.exitCode ?? 1);
}
let fullStep = null;
let runParent = "tmp/cli-tests",
  typecheckOnly = false,
  environmentOnly = false;
let entry = process.env.RETOUCH_YGL_ENTRY,
  unitOnly = false,
  legacy = false,
  apiOnly = false,
  documentsOnly = false,
  issuesOnly = false;
let engineeringOnly = false,
  zipOnly = false,
  outputsOnly = false,
  recoveryOnly = false,
  contractOnly = false,
  correctionOnly = false,
  validationOnly = false,
  immutableOnly = false;
for (let index = 0; index < args.length; index++) {
  if (args[index] === "--ygl-entry" && args[index + 1])
    entry = await fs.realpath(args[++index]);
  else if (args[index] === "--run-parent" && args[index + 1])
    runParent = args[++index];
  else if (args[index] === "--full-step" && args[index + 1])
    fullStep = args[++index];
  else if (args[index] === "--typecheck") typecheckOnly = true;
  else if (args[index] === "--environment-check") environmentOnly = true;
  else if (args[index] === "--unit-only") unitOnly = true;
  else if (args[index] === "--immutable-only") immutableOnly = true;
  else if (args[index] === "--legacy") legacy = true;
  else if (args[index] === "--suite" && args[index + 1] === "api") {
    apiOnly = true;
    index++;
  } else if (args[index] === "--suite" && args[index + 1] === "documents") {
    documentsOnly = true;
    index++;
  } else if (args[index] === "--suite" && args[index + 1] === "issues") {
    issuesOnly = true;
    index++;
  } else if (args[index] === "--suite" && args[index + 1] === "engineering") {
    engineeringOnly = true;
    index++;
  } else if (args[index] === "--suite" && args[index + 1] === "zip") {
    zipOnly = true;
    index++;
  } else if (args[index] === "--suite" && args[index + 1] === "outputs") {
    outputsOnly = true;
    index++;
  } else if (
    args[index] === "--suite" &&
    args[index + 1] === "output-recovery"
  ) {
    recoveryOnly = true;
    index++;
  } else if (
    args[index] === "--suite" &&
    args[index + 1] === "output-contract"
  ) {
    contractOnly = true;
    index++;
  } else if (
    args[index] === "--suite" &&
    args[index + 1] === "received-correction"
  ) {
    correctionOnly = true;
    index++;
  } else if (args[index] === "--suite" && args[index + 1] === "validation") {
    validationOnly = true;
    index++;
  } else throw new Error("Unknown test option: " + args[index]);
}
if (Number(typecheckOnly) + Number(environmentOnly) > 1)
  throw new Error("Choose typecheck or environment preflight, not both");
if (
  Number(legacy) +
    Number(apiOnly) +
    Number(documentsOnly) +
    Number(issuesOnly) +
    Number(engineeringOnly) +
    Number(zipOnly) +
    Number(outputsOnly) +
    Number(recoveryOnly) +
    Number(contractOnly) +
    Number(correctionOnly) +
    Number(validationOnly) >
  1
)
  throw new Error("Choose one test suite.");
if (
  fullStep &&
  (typecheckOnly ||
    environmentOnly ||
    unitOnly ||
    legacy ||
    apiOnly ||
    documentsOnly ||
    issuesOnly ||
    engineeringOnly ||
    zipOnly ||
    outputsOnly ||
    recoveryOnly ||
    contractOnly ||
    correctionOnly ||
    validationOnly)
)
  throw new Error("--full-step covers the entire native suite, not a subset");
if (!unitOnly && !typecheckOnly && !environmentOnly && !entry)
  throw new Error(
    "Supply --ygl-entry <installed-bin.cjs> for integration tests, or explicitly choose --unit-only.",
  );
const parent = path.resolve(root, runParent);
if (!parent.startsWith(path.join(root, "tmp") + path.sep))
  throw new Error("Run parent must be inside this project tmp/task");
await fs.mkdir(parent, { recursive: true });
if (
  (await fs.realpath(parent)) !== parent ||
  (await fs.realpath(path.join(root, "tmp"))) !== path.join(root, "tmp")
)
  throw new Error("Test output escapes project");
const runRoot = fullStep
  ? path.resolve(root, fullStep)
  : await fs.mkdtemp(path.join(parent, "run-"));
if (fullStep) {
  if (
    !runRoot.startsWith(parent + path.sep) ||
    !/^run-[a-zA-Z0-9-]+$/.test(path.basename(runRoot))
  )
    throw new Error(
      "Full-step root must be a run-name under the project run parent",
    );
  await fs.mkdir(runRoot, { recursive: true });
  if ((await fs.realpath(runRoot)) !== runRoot)
    throw new Error("Full-step path follows links");
}
const tempRoot = await fs.mkdtemp(path.join(runRoot, "temp-"));
const childEnv = {
  ...process.env,
  TMP: tempRoot,
  TEMP: tempRoot,
  TMPDIR: tempRoot,
};
const probeCode =
  'const fs=require("node:fs"),os=require("node:os"),path=require("node:path");const expected=process.argv[1],actual=fs.realpathSync(os.tmpdir());if(actual!==fs.realpathSync(expected)||!["TMP","TEMP","TMPDIR"].every(k=>process.env[k]===expected))process.exit(2);const file=path.join(actual,"environment-probe.json");fs.writeFileSync(file,JSON.stringify({pid:process.pid,actual_tmpdir:actual,TMP:process.env.TMP,TEMP:process.env.TEMP,TMPDIR:process.env.TMPDIR}),{flag:"wx"});';
const environmentExit = await new Promise((resolve, reject) => {
  const c = spawn(process.execPath, ["-e", probeCode, tempRoot], {
    cwd: root,
    env: childEnv,
    windowsHide: true,
    stdio: "ignore",
  });
  c.once("error", reject);
  c.once("close", resolve);
});
if (environmentExit !== 0)
  throw new Error("Project-only child temp preflight failed");
const logScope = {
  run_root: runRoot,
  temp_root: tempRoot,
  environment_probe: JSON.parse(
    await fs.readFile(path.join(tempRoot, "environment-probe.json"), "utf8"),
  ),
  process_environment_changed: false,
  global_configuration_changed: false,
};
await fs.writeFile(
  path.join(fullStep ? tempRoot : runRoot, "environment.json"),
  JSON.stringify(logScope, null, 2) + "\n",
  { flag: "wx" },
);
if (typecheckOnly || environmentOnly) {
  const started = new Date().toISOString(),
    snapshots = await collectSnapshots();
  let observed = 0;
  if (typecheckOnly) {
    const out = await fs.open(path.join(runRoot, "typecheck.stdout.log"), "wx"),
      err = await fs.open(path.join(runRoot, "typecheck.stderr.log"), "wx");
    try {
      observed = await new Promise((resolve, reject) => {
        const c = spawn(
          process.execPath,
          [path.join(root, "node_modules/typescript/bin/tsc"), "--noEmit"],
          {
            cwd: root,
            env: childEnv,
            windowsHide: true,
            stdio: ["ignore", out.fd, err.fd],
          },
        );
        c.once("error", reject);
        c.once("close", resolve);
      });
    } finally {
      await out.close();
      await err.close();
    }
  }
  const final = await collectSnapshots(),
    stable = JSON.stringify(snapshots) === JSON.stringify(final);
  const report = {
    schema: "retouch.validation-process/v1",
    kind: typecheckOnly ? "typecheck" : "environment",
    started_at: started,
    finished_at: new Date().toISOString(),
    observed_exit_code: observed,
    source_stability: stable ? "PASS" : "FAIL",
    verdict: observed === 0 && stable ? "PASS" : "FAIL",
    initial_snapshots: snapshots,
    snapshots: final,
    log_scope: logScope,
  };
  await fs.writeFile(
    path.join(runRoot, "process-result.json"),
    JSON.stringify(report, null, 2) + "\n",
    { flag: "wx" },
  );
  process.stdout.write(
    JSON.stringify({
      verdict: report.verdict,
      kind: report.kind,
      run_root: runRoot,
    }) + "\n",
  );
  process.exit(observed === 0 && stable ? 0 : 1);
}
const files = (await fs.readdir(path.join(root, "tests")))
  .filter(
    (name) =>
      name.endsWith(".test.ts") &&
      (legacy
        ? !name.startsWith("native-")
        : validationOnly
          ? [
              "native-validation.test.ts",
              "native-runner-unit.test.ts",
            ].includes(name)
          : correctionOnly
            ? [
                "native-issues-received-correction.test.ts",
                "native-runner-unit.test.ts",
              ].includes(name)
            : apiOnly
              ? name.startsWith("native-api")
              : documentsOnly
                ? name.startsWith("native-documents")
                : issuesOnly
                  ? name.startsWith("native-issues")
                  : engineeringOnly
                    ? name.startsWith("native-engineering")
                    : zipOnly
                      ? name.startsWith("native-zip")
                      : contractOnly
                        ? name === "native-outputs-contract.test.ts"
                        : recoveryOnly
                          ? name === "native-outputs-recovery.test.ts"
                          : outputsOnly
                            ? name.startsWith("native-outputs") ||
                              name === "native-output-cache-unit.test.ts" ||
                              name === "native-issues-workflow.test.ts"
                            : name.startsWith("native-")),
  )
  .sort()
  .map((name) => "tests/" + name);
let stepManifest = null,
  segments = [],
  stepIndex = null,
  completedResult = null;
if (fullStep) {
  const manifestFile = path.join(runRoot, "full-manifest.json"),
    current = await collectSnapshots();
  try {
    stepManifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    stepManifest = {
      schema: "retouch.full-file-sequence/v1",
      files,
      entry,
      initial_snapshots: current,
      started_at: new Date().toISOString(),
    };
    await fs.writeFile(
      manifestFile,
      JSON.stringify(stepManifest, null, 2) + "\n",
      { flag: "wx" },
    );
  }
  if (
    stepManifest.schema !== "retouch.full-file-sequence/v1" ||
    JSON.stringify(stepManifest.files) !== JSON.stringify(files) ||
    stepManifest.entry !== entry ||
    JSON.stringify(stepManifest.initial_snapshots) !== JSON.stringify(current)
  )
    throw new Error(
      "Cannot resume full run with changed source, entry, or selected files",
    );
  for (let index = 0; index < files.length; index++) {
    const record = path.join(
      runRoot,
      "part-" + String(index).padStart(3, "0") + ".json",
    );
    try {
      const part = JSON.parse(await fs.readFile(record, "utf8"));
      if (part.index !== index || part.file !== files[index])
        throw new Error("Full part identity differs");
      const tap = await fs.readFile(path.join(runRoot, part.tap)),
        err = await fs.readFile(path.join(runRoot, part.stderr));
      if (
        crypto.createHash("sha256").update(tap).digest("hex") !==
          part.tap_sha256 ||
        crypto.createHash("sha256").update(err).digest("hex") !==
          part.stderr_sha256
      )
        throw new Error("Full part bytes changed");
      const observed = JSON.parse(
        await fs.readFile(path.join(runRoot, part.exit_receipt), "utf8"),
      );
      verifySegmentEvidence(part, tap, err, observed);
      segments.push(part);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      stepIndex = index;
      break;
    }
  }
  if (stepIndex !== null) {
    const launch = path.join(
      runRoot,
      "part-" + String(stepIndex).padStart(3, "0") + ".launch.json",
    );
    await fs.writeFile(
      launch,
      JSON.stringify({
        index: stepIndex,
        file: files[stepIndex],
        pid: process.pid,
        started_at: new Date().toISOString(),
      }) + "\n",
      { flag: "wx" },
    );
  } else {
    try {
      completedResult = JSON.parse(
        await fs.readFile(path.join(runRoot, "process-result.json"), "utf8"),
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
const command = [
  "--test",
  "--test-concurrency=1",
  "--test-reporter=tap",
  ...(fullStep ? (stepIndex === null ? [] : [files[stepIndex]]) : files),
];
const initialSnapshots =
  stepManifest?.initial_snapshots ?? (await collectSnapshots());
const started = stepManifest?.started_at ?? new Date().toISOString();
async function captureTests(command, exitFile = null) {
  const child = spawn(process.execPath, command, {
    cwd: root,
    windowsHide: true,
    env: {
      ...childEnv,
      RETOUCH_TEST_ROOT: runRoot,
      RETOUCH_TEST_YGL_ENTRY: unitOnly ? "" : entry,
      RETOUCH_LEGACY_TEST: legacy ? "1" : "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "";
  const stdoutDecoder = new StringDecoder("utf8"),
    stderrDecoder = new StringDecoder("utf8");
  let progressBuffer = "";
  child.stdout.on("data", (chunk) => {
    const text = stdoutDecoder.write(chunk);
    stdout += text;
    progressBuffer += text;
    const lines = progressBuffer.split("\n");
    progressBuffer = lines.pop();
    for (const line of lines)
      if (/^(?:ok|not ok) \d+ - /.test(line))
        process.stdout.write(JSON.stringify({ test: line }) + "\n");
  });
  child.stderr.on("data", (chunk) => {
    stderr += stderrDecoder.write(chunk);
  });
  let observedExit;
  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => {
      observedExit = {
        exit_code: code,
        signal: signal ?? null,
        child_pid: child.pid,
        command,
        finished_at: new Date().toISOString(),
      };
      resolve(code);
    });
  });
  // close follows stdout/stderr EOF; flush a final partial code point only now.
  stdout += stdoutDecoder.end();
  stderr += stderrDecoder.end();
  if (exitFile)
    await fs.writeFile(exitFile, JSON.stringify(observedExit, null, 2) + "\n", {
      flag: "wx",
    });
  return { stdout, stderr, exitCode };
}
// End byte-preserving child capture.
let stdout = "",
  stderr = "",
  exitCode = 0;
if (!fullStep || stepIndex !== null)
  ({ stdout, stderr, exitCode } = await captureTests(
    command,
    fullStep
      ? path.join(
          runRoot,
          "part-" + String(stepIndex).padStart(3, "0") + ".observed-exit.json",
        )
      : null,
  ));
let fileSequence = null;
if (fullStep) {
  if (stepIndex !== null) {
    const prefix = "part-" + String(stepIndex).padStart(3, "0"),
      tap = prefix + ".tap",
      errorFile = prefix + ".stderr.log";
    const final = await collectSnapshots(),
      stable = JSON.stringify(initialSnapshots) === JSON.stringify(final);
    await fs.writeFile(path.join(runRoot, tap), stdout, { flag: "wx" });
    await fs.writeFile(path.join(runRoot, errorFile), stderr, { flag: "wx" });
    const part = {
      index: stepIndex,
      file: files[stepIndex],
      exit_code: exitCode,
      counts: parseTapCounts(stdout),
      exit_receipt: prefix + ".observed-exit.json",
      source_stability: stable ? "PASS" : "FAIL",
      tap,
      stderr: errorFile,
      tap_sha256: crypto.createHash("sha256").update(stdout).digest("hex"),
      stderr_sha256: crypto.createHash("sha256").update(stderr).digest("hex"),
      log_scope: logScope,
      finished_at: new Date().toISOString(),
    };
    await fs.writeFile(
      path.join(runRoot, prefix + ".json"),
      JSON.stringify(part, null, 2) + "\n",
      { flag: "wx" },
    );
    const observedExit = JSON.parse(
      await fs.readFile(path.join(runRoot, part.exit_receipt), "utf8"),
    );
    verifySegmentEvidence(
      part,
      Buffer.from(stdout),
      Buffer.from(stderr),
      observedExit,
    );
    segments.push(part);
    if (segments.length < files.length) {
      process.stdout.write(
        JSON.stringify({
          verdict: "IN_PROGRESS",
          completed_files: segments.length,
          total_files: files.length,
          segment: part.file,
          segment_exit_code: exitCode,
          source_stability: part.source_stability,
          run_root: runRoot,
        }) + "\n",
      );
      process.exit(
        exitCode === 0 &&
          stable &&
          part.counts.tests > 0 &&
          part.counts.pass === part.counts.tests &&
          !part.counts.todo &&
          !part.counts.skipped &&
          !part.counts.cancelled &&
          !part.counts.fail
          ? 0
          : 1,
      );
    }
  }
  fileSequence = summarizeFileSegments(files, segments);
  exitCode = fileSequence.exit_code;
  stdout = (
    await Promise.all(
      segments.map((p) => fs.readFile(path.join(runRoot, p.tap), "utf8")),
    )
  ).join("\n");
  stderr = (
    await Promise.all(
      segments.map((p) => fs.readFile(path.join(runRoot, p.stderr), "utf8")),
    )
  ).join("");
}
await fs.writeFile(path.join(runRoot, "tests.tap"), stdout);
await fs.writeFile(path.join(runRoot, "stderr.log"), stderr);
const counts = fileSequence?.counts ?? parseTapCounts(stdout);
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
const documentsEvidence =
  unitOnly || legacy
    ? null
    : await fs
        .readFile(path.join(runRoot, "native-documents-evidence.json"), "utf8")
        .then(JSON.parse)
        .catch(() => null);
const issuesEvidence =
  unitOnly || legacy
    ? null
    : await fs
        .readFile(path.join(runRoot, "native-issues-evidence.json"), "utf8")
        .then(JSON.parse)
        .catch(() => null);
const engineeringEvidence =
  unitOnly || legacy
    ? null
    : await fs
        .readFile(
          path.join(runRoot, "native-engineering-evidence.json"),
          "utf8",
        )
        .then(JSON.parse)
        .catch(() => null);
const zipEvidence =
  unitOnly || legacy
    ? null
    : await fs
        .readFile(path.join(runRoot, "native-zip-evidence.json"), "utf8")
        .then(JSON.parse)
        .catch(() => null);
const outputEvidence =
  unitOnly || legacy
    ? null
    : await fs
        .readFile(path.join(runRoot, "native-output-evidence.json"), "utf8")
        .then(JSON.parse)
        .catch(() => null);
const outputLargeEvidence =
  unitOnly || legacy
    ? null
    : await fs
        .readFile(
          path.join(runRoot, "native-output-large-evidence.json"),
          "utf8",
        )
        .then(JSON.parse)
        .catch(() => null);
const recoveryEvidence =
  unitOnly || legacy
    ? null
    : await fs
        .readFile(
          path.join(runRoot, "native-output-recovery-evidence.json"),
          "utf8",
        )
        .then(JSON.parse)
        .catch(() => null);
const contractEvidence =
  unitOnly || legacy
    ? null
    : await fs
        .readFile(
          path.join(runRoot, "native-output-contract-evidence.json"),
          "utf8",
        )
        .then(JSON.parse)
        .catch(() => null);
const correctionEvidence =
  unitOnly || legacy
    ? null
    : await fs
        .readFile(
          path.join(runRoot, "native-received-correction-evidence.json"),
          "utf8",
        )
        .then(JSON.parse)
        .catch(() => null);
const validationEvidence =
  unitOnly || legacy
    ? null
    : await fs
        .readFile(path.join(runRoot, "native-validation-evidence.json"), "utf8")
        .then(JSON.parse)
        .catch(() => null);
let passed =
  exitCode === 0 &&
  counts.tests > 0 &&
  counts.fail === 0 &&
  counts.cancelled === 0 &&
  counts.todo === 0 &&
  (unitOnly ||
    (counts.skipped === 0 &&
      (legacy
        ? nativeEvidence?.verdict === "PASS" &&
          contextEvidence?.verdict === "PASS"
        : validationOnly
          ? validationEvidence?.verdict === "PASS" &&
            validationEvidence?.software_positive?.actual === "PASS" &&
            validationEvidence?.intended_business_negative?.actual === "FAIL" &&
            validationEvidence?.unknown_control?.actual === "UNKNOWN" &&
            validationEvidence?.project_self_check?.status === "PASS"
          : correctionOnly
            ? correctionEvidence?.verdict === "PASS"
            : apiOnly
              ? apiEvidence?.verdict === "PASS"
              : documentsOnly
                ? documentsEvidence?.verdict === "PASS"
                : issuesOnly
                  ? issuesEvidence?.verdict === "PASS"
                  : contractOnly
                    ? contractEvidence?.verdict === "PASS"
                    : recoveryOnly
                      ? recoveryEvidence?.verdict === "PASS"
                      : outputsOnly
                        ? outputEvidence?.verdict === "PASS" &&
                          outputLargeEvidence?.verdict === "PASS" &&
                          recoveryEvidence?.verdict === "PASS" &&
                          contractEvidence?.verdict === "PASS"
                        : zipOnly
                          ? zipEvidence?.verdict === "PASS"
                          : engineeringOnly
                            ? engineeringEvidence?.verdict === "PASS"
                            : wrapperEvidence?.verdict === "PASS" &&
                              apiEvidence?.verdict === "PASS" &&
                              documentsEvidence?.verdict === "PASS" &&
                              issuesEvidence?.verdict === "PASS" &&
                              engineeringEvidence?.verdict === "PASS" &&
                              zipEvidence?.verdict === "PASS" &&
                              outputEvidence?.verdict === "PASS" &&
                              outputLargeEvidence?.verdict === "PASS" &&
                              recoveryEvidence?.verdict === "PASS" &&
                              contractEvidence?.verdict === "PASS" &&
                              correctionEvidence?.verdict === "PASS" &&
                              validationEvidence?.verdict === "PASS")));
function parseTapCounts(stdout) {
  const counts = {};
  for (const name of [
    "tests",
    "pass",
    "fail",
    "cancelled",
    "skipped",
    "todo",
  ]) {
    const matches = [
      ...stdout.matchAll(new RegExp("^# " + name + " (\\d+)$", "gm")),
    ];
    counts[name] = matches.length ? Number(matches.at(-1)[1]) : null;
  }
  return counts;
}
function verifySegmentEvidence(part, tap, stderr, observedExit) {
  const counts = parseTapCounts(tap.toString("utf8"));
  if (
    crypto.createHash("sha256").update(tap).digest("hex") !== part.tap_sha256 ||
    crypto.createHash("sha256").update(stderr).digest("hex") !==
      part.stderr_sha256 ||
    Object.keys(counts).some((k) => counts[k] !== part.counts?.[k]) ||
    !Number.isSafeInteger(counts.tests) ||
    counts.tests <= 0 ||
    !observedExit ||
    observedExit.exit_code !== part.exit_code ||
    observedExit.signal !== null ||
    !Array.isArray(observedExit.command) ||
    observedExit.command.at(-1) !== part.file ||
    observedExit.command.filter((x) => x === part.file).length !== 1
  )
    throw new Error(
      "Full part raw TAP/counts/actual child exit/identity disagree",
    );
  return true;
}
function summarizeFileSegments(files, segments) {
  if (
    !files.length ||
    files.length !== segments.length ||
    new Set(files).size !== files.length
  )
    throw new Error("Full coverage missing or duplicated");
  const counts = {
    tests: 0,
    pass: 0,
    fail: 0,
    cancelled: 0,
    skipped: 0,
    todo: 0,
  };
  for (let i = 0; i < files.length; i++) {
    const p = segments[i];
    if (
      p.index !== i ||
      p.file !== files[i] ||
      p.source_stability !== "PASS" ||
      !(p.counts?.tests > 0) ||
      Object.keys(counts).some(
        (k) => !Number.isSafeInteger(p.counts?.[k]) || p.counts[k] < 0,
      ) ||
      p.counts.tests !==
        p.counts.pass +
          p.counts.fail +
          p.counts.cancelled +
          p.counts.skipped +
          p.counts.todo
    )
      throw new Error("Full part identity/counts/source not complete");
    for (const k of Object.keys(counts)) counts[k] += p.counts[k];
  }
  return {
    mode: "SERIAL_CHECKPOINTED_ALL_NATIVE_FILES",
    coverage: "COMPLETE",
    files,
    segments,
    counts,
    exit_code: segments.every(
      (p) =>
        p.exit_code === 0 &&
        p.counts.tests > 0 &&
        p.counts.pass === p.counts.tests &&
        ["fail", "cancelled", "skipped", "todo"].every(
          (k) => p.counts[k] === 0,
        ),
    )
      ? 0
      : 1,
    raw_tap:
      "concatenated original per-file TAP; immutable part files are authoritative",
  };
}
function assertCompletedResult(cached, original, computed, expectedPath) {
  const evidence = ({ finished_at, log_scope, ...value }) => value;
  if (
    !cached ||
    cached.schema !== "retouch.validation-process/v1" ||
    cached.kind !== computed.test_suite ||
    cached.verdict !== computed.verdict ||
    cached.observed_exit_code !== computed.observed_exit_code ||
    cached.source_stability !== computed.source_stability ||
    cached.report !== expectedPath ||
    JSON.stringify(evidence(original)) !== JSON.stringify(evidence(computed))
  )
    throw new Error(
      "Cached completion disagrees with recomputed raw full evidence or immutable report",
    );
  return computed.verdict;
}
async function collectSnapshots() {
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
    "scripts/lib/native-ygl.mjs",
    "scripts/lib/native-ygl.d.mts",
    "scripts/capture-context-design.mjs",
    "scripts/probe-ygl-wrapper.mjs",
    "verify/packs/retouch-validation/pack.json",
    "verify/packs/retouch-validation/material.md",
    "verify/packs/retouch-validation/candidates.json",
    "verify/packs/retouch-validation/reviews.json",
    "verify/packs/retouch-validation/fixtures/cases.json",
    "verify/packs/retouch-validation/README.md",
    // The native physical-reference regression reads this exact method body.
    "docs/PHYSICAL-REFERENCE-WORKFLOW.md",
  ])
    snapshots.push({
      file,
      sha256: crypto
        .createHash("sha256")
        .update(await fs.readFile(path.join(root, file)))
        .digest("hex"),
    });
  return snapshots.sort((a, b) => a.file.localeCompare(b.file));
}
const snapshots = await collectSnapshots();
const sourceStable =
  JSON.stringify(initialSnapshots) === JSON.stringify(snapshots);
passed = passed && sourceStable;
const report = {
  schema: "retouch.implementation-tests/v1",
  verdict: passed ? "PASS" : "FAIL",
  started_at: started,
  finished_at: new Date().toISOString(),
  node_version: process.version,
  observed_exit_code: exitCode,
  file_sequence: fileSequence,
  counts,
  native_ygl_integration: unitOnly
    ? "NOT_RUN"
    : passed
      ? "PASS"
      : "CHECK_FAILURES",
  architecture: legacy
    ? "HISTORICAL_LEDGER_FIXTURES_ONLY"
    : "YGL_NATIVE_WRAPPER",
  test_suite: validationOnly
    ? "VALIDATION_CONVERGENCE"
    : correctionOnly
      ? "RECEIVED_OUTPUT_CORRECTION"
      : apiOnly
        ? "API_FALLBACK"
        : documentsOnly
          ? "NATIVE_DOCUMENTS"
          : issuesOnly
            ? "RETROSPECTIVE_ISSUES"
            : contractOnly
              ? "OUTPUT_CONTRACT"
              : recoveryOnly
                ? "OUTPUT_RECOVERY"
                : outputsOnly
                  ? "SNAPSHOT_OUTPUTS"
                  : zipOnly
                    ? "ZIP_SAFETY"
                    : engineeringOnly
                      ? "ENGINEERING_CONTRACTS"
                      : "FULL",
  native_validation_evidence: validationEvidence,
  native_received_correction_evidence: correctionEvidence,
  native_output_contract_evidence: contractEvidence,
  native_output_recovery_evidence: recoveryEvidence,
  native_output_evidence: outputEvidence,
  native_output_large_evidence: outputLargeEvidence,
  native_zip_evidence: zipEvidence,
  native_engineering_evidence: engineeringEvidence,
  native_issues_evidence: issuesEvidence,
  native_documents_evidence: documentsEvidence,
  native_api_evidence: apiEvidence,
  native_wrapper_evidence: wrapperEvidence,
  native_evidence: nativeEvidence,
  context_native_evidence: contextEvidence,
  ygl_entry: unitOnly ? null : entry,
  evidence_directory: runRoot,
  log_scope: logScope,
  scope: {
    image_ai_generation: "NOT_RUN",
    paid_api_calls: "NOT_RUN",
    host_protocol: "LOCAL_FIXTURES_ONLY",
    malicious_agent_sandbox: "NOT_CLAIMED",
  },
  snapshots,
  initial_snapshots: initialSnapshots,
  source_stability: sourceStable ? "PASS" : "FAIL",
};
if (completedResult) {
  const originalPath = path.join(
    root,
    "docs/verification/runs",
    path.basename(runRoot) + ".json",
  );
  const original = JSON.parse(await fs.readFile(originalPath, "utf8"));
  assertCompletedResult(completedResult, original, report, originalPath);
  process.stdout.write(
    JSON.stringify({
      verdict: report.verdict,
      already_complete: true,
      raw_evidence_revalidated: true,
      report: originalPath,
    }) + "\n",
  );
  process.exit(report.verdict === "PASS" ? 0 : 1);
}
await fs.mkdir(path.join(root, "docs/verification"), { recursive: true });
await fs.mkdir(path.join(root, "docs/verification/runs"), { recursive: true });
await fs.writeFile(
  path.join(root, "docs/verification/runs", path.basename(runRoot) + ".json"),
  JSON.stringify(report, null, 2) + "\n",
  { flag: "wx" },
);
const immutablePath = path.join(
  root,
  "docs/verification/runs",
  path.basename(runRoot) + ".json",
);
const output =
  immutableOnly || validationOnly
    ? immutablePath
    : path.join(
        root,
        "docs/verification",
        legacy
          ? "legacy-tests.json"
          : correctionOnly
            ? "received-correction-tests.json"
            : apiOnly
              ? "api-tests.json"
              : documentsOnly
                ? "documents-tests.json"
                : issuesOnly
                  ? "issues-tests.json"
                  : contractOnly
                    ? "output-contract-tests.json"
                    : recoveryOnly
                      ? "output-recovery-tests.json"
                      : outputsOnly
                        ? "outputs-tests.json"
                        : zipOnly
                          ? "zip-tests.json"
                          : engineeringOnly
                            ? "engineering-tests.json"
                            : unitOnly
                              ? "unit-tests.json"
                              : "native-wrapper-tests.json",
      );
if (output !== immutablePath)
  await fs.writeFile(output, JSON.stringify(report, null, 2) + "\n");
await fs.writeFile(
  path.join(runRoot, "process-result.json"),
  JSON.stringify(
    {
      schema: "retouch.validation-process/v1",
      kind: report.test_suite,
      verdict: report.verdict,
      observed_exit_code: exitCode,
      source_stability: report.source_stability,
      report: path.join(
        root,
        "docs/verification/runs",
        path.basename(runRoot) + ".json",
      ),
      log_scope: logScope,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
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
