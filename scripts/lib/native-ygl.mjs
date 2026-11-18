// Maintained developer transport: direct Node, file-first evidence, explicit native binding.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { binding as yglBinding } from "../../src/native/client.ts";
const project = await fs.realpath(
  fileURLToPath(new URL("../../", import.meta.url)),
);
const digest = (bytes) =>
  crypto.createHash("sha256").update(bytes).digest("hex");
async function taskLogs(logRoot) {
  const directory = path.resolve(logRoot);
  if (!directory.startsWith(path.join(project, "tmp") + path.sep))
    throw new Error("Developer logs must belong to this project tmp/task");
  let ancestor = directory;
  while (true) {
    try {
      if ((await fs.realpath(ancestor)) !== ancestor)
        throw new Error("Developer log path cannot follow a link");
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
  await fs.mkdir(directory, { recursive: true });
  if (
    (await fs.realpath(directory)) !== directory ||
    (await fs.realpath(path.join(project, "tmp"))) !== path.join(project, "tmp")
  )
    throw new Error("Developer log path cannot follow a link");
  return directory;
}
export async function captureNode(
  args,
  {
    cwd,
    logRoot,
    env = {},
    timeoutMs = 30000,
    maxJsonBytes = 8 * 1024 * 1024,
  } = {},
) {
  if (
    !cwd ||
    !logRoot ||
    !Array.isArray(args) ||
    args.some((a) => typeof a !== "string") ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    !Number.isSafeInteger(maxJsonBytes) ||
    maxJsonBytes <= 0
  )
    throw new Error(
      "Explicit developer cwd/logRoot/argv and finite limits required",
    );
  const working = await fs.realpath(cwd);
  if (working !== project && !working.startsWith(project + path.sep))
    throw new Error("Developer cwd escapes owning project");
  const logs = await taskLogs(logRoot),
    directory = await fs.mkdtemp(path.join(logs, "call-")),
    temp = path.join(directory, "temp");
  await fs.mkdir(temp);
  const childEnv = {
    ...process.env,
    ...env,
    TMP: temp,
    TEMP: temp,
    TMPDIR: temp,
  };
  for (const key of Object.keys(childEnv))
    if (
      /API_KEY|TOKEN|PASSWORD|SECRET/i.test(key) ||
      [
        "YGL_DB_URL",
        "YGL_PG_URL",
        "YGL_TREE",
        "YGL_PROJECT",
        "YGL_RUN_ID",
        "DSH_SESSION_ID",
        "YGL_TEST",
      ].includes(key)
    )
      delete childEnv[key];
  const out = await fs.open(path.join(directory, "stdout.log"), "wx"),
    err = await fs.open(path.join(directory, "stderr.log"), "wx");
  const started = new Date().toISOString();
  let timedOut = false,
    child,
    observed;
  try {
    child = spawn(process.execPath, args, {
      cwd: working,
      env: childEnv,
      windowsHide: true,
      stdio: ["ignore", out.fd, err.fd],
    });
    observed = await new Promise((resolve) => {
      let spawnError = null;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);
      child.once("error", (e) => {
        spawnError = { code: e.code ?? null, message: e.message };
      });
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        resolve({
          exit_code: code,
          signal: signal ?? null,
          start_error: spawnError,
        });
      });
    });
  } finally {
    await out.close();
    await err.close();
  }
  const stdoutFile = path.join(directory, "stdout.log"),
    stderrFile = path.join(directory, "stderr.log");
  const stdoutStat = await fs.stat(stdoutFile),
    stderrStat = await fs.stat(stderrFile);
  // Logs were written by the child directly, not truncated by a memory buffer.
  // Hash by streaming too; parse only bounded output and never turn oversize into PASS.
  const { createReadStream } = await import("node:fs");
  async function fileHash(file) {
    const h = crypto.createHash("sha256");
    for await (const bytes of createReadStream(file)) h.update(bytes);
    return h.digest("hex");
  }
  const parseLimit = stdoutStat.size > maxJsonBytes;
  const stdout = parseLimit ? null : await fs.readFile(stdoutFile, "utf8");
  const stderr =
    stderrStat.size <= maxJsonBytes
      ? await fs.readFile(stderrFile, "utf8")
      : null;
  let json = null,
    parseError = parseLimit ? "JSON_PARSE_LIMIT" : null;
  if (!parseLimit)
    try {
      json = JSON.parse(stdout);
    } catch (e) {
      parseError = e.message;
    }
  const result = {
    ...observed,
    pid: child.pid ?? null,
    timed_out: timedOut,
    aborted: false,
    json,
    parse_error: parseError,
    stderr,
    unparsed_stdout: json === null ? stdout : null,
    stdout_bytes: stdoutStat.size,
    stderr_bytes: stderrStat.size,
    stdout_sha256: await fileHash(stdoutFile),
    stderr_sha256: await fileHash(stderrFile),
    log_directory: directory,
    child_temp_root: temp,
    started_at: started,
    finished_at: new Date().toISOString(),
    output_truncated: false,
    parse_limited: parseLimit,
  };
  await fs.writeFile(
    path.join(directory, "process.json"),
    JSON.stringify(result, null, 2) + "\n",
    { flag: "wx" },
  );
  return result;
}
export function nativeReceiptPassed(result, { doctor = false } = {}) {
  if (
    result.exit_code !== 0 ||
    result.signal ||
    result.timed_out ||
    result.start_error ||
    result.parse_error ||
    result.output_truncated ||
    result.json === null
  )
    return false;
  const value = result.json;
  if (doctor)
    return (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every(
        (item) => item && typeof item === "object" && item.status === "pass",
      )
    );
  return (
    typeof value === "object" &&
    !(
      value &&
      (value.ok === false ||
        value.error ||
        [value.overall, value.verdict, value.status].some((v) =>
          [
            "FAIL",
            "ERROR",
            "NEEDS-MATERIAL",
            "INFRA_BLOCKED",
            "UNKNOWN",
          ].includes(v),
        ))
    )
  );
}
export async function nativeClient(
  entry,
  { home, cwd, session, logRoot } = {},
) {
  if (!home || !cwd || !session)
    throw new Error("Native CLI requires explicit home, cwd and session");
  const binding = await yglBinding(entry),
    logs = await taskLogs(
      logRoot ?? path.join(project, "tmp", "native-ygl", session),
    );
  async function call(args) {
    return captureNode(
      [binding.entry, ...args, "--home", path.resolve(home), "--json"],
      {
        cwd,
        logRoot: logs,
        env: {
          YGL_HOME: path.resolve(home),
          YGL_SESSION: session,
          YGL_EVAL_OFFLINE: "1",
          YGL_NO_UPDATE_CHECK: "1",
        },
      },
    );
  }
  return { binding, call, log_root: logs };
}

// Immutable developer evidence, not a mutable latest index. Reused by existing capture/probe.
export async function writeNativeReport(kind, report, options = {}) {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(kind))
    throw new Error("Report kind must be a safe basename");
  const directory = path.resolve(
    options.directory ?? path.join(project, "docs", "verification", "runs"),
  );
  const durable = path.join(project, "docs", "verification", "runs");
  if (
    directory !== durable &&
    !directory.startsWith(path.join(project, "tmp") + path.sep)
  )
    throw new Error("Report directory is outside project evidence roots");
  // Check the closest existing ancestor before creating anything through a link.
  let ancestor = directory;
  while (true) {
    try {
      if ((await fs.realpath(ancestor)) !== ancestor)
        throw new Error("Report path follows a link");
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
  await fs.mkdir(directory, { recursive: true });
  if ((await fs.realpath(directory)) !== directory)
    throw new Error("Report path follows a link");
  const file = path.join(directory, kind + "-" + crypto.randomUUID() + ".json"),
    bytes = JSON.stringify(report, null, 2) + "\n";
  await fs.writeFile(file, bytes, { flag: "wx" });
  return {
    path: file,
    sha256: digest(Buffer.from(bytes)),
    bytes: Buffer.byteLength(bytes),
  };
}
