import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { StringDecoder } from "node:string_decoder";

// Test the existing runner's exact blocks without importing its top-level spawn.
// Child events and snapshot filesystem are synthetic: no child process or CLI runs.
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
async function runnerSource() {
  return fs.readFile(
    fileURLToPath(new URL("../../scripts/test.mjs", import.meta.url)),
    "utf8",
  );
}
function section(source: string, from: string, to: string) {
  const start = source.indexOf(from),
    end = source.indexOf(to, start);
  assert.ok(
    start >= 0 && end > start,
    "runner block changed; review the real capture contract",
  );
  return source.slice(start, end);
}
async function captureFixture() {
  const source = await runnerSource();
  const capture = new AsyncFunction(
    "spawn",
    "process",
    "root",
    "command",
    "runRoot",
    "unitOnly",
    "entry",
    "legacy",
    "StringDecoder",
    "childEnv",
    section(
      source,
      "async function captureTests(command, exitFile = null) {",
      "// End byte-preserving child capture.",
    ) + "\nreturn await captureTests(command);",
  );
  return async (
    out: Buffer[],
    err: Buffer[],
    exitCode: number | null,
    error?: Error,
  ) => {
    const spawn = () => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
      });
      queueMicrotask(() => {
        if (error) {
          child.emit("error", error);
          return;
        }
        for (const bytes of out) child.stdout.emit("data", bytes);
        for (const bytes of err) child.stderr.emit("data", bytes);
        child.emit("close", exitCode);
      });
      return child;
    };
    return capture(
      spawn,
      { execPath: "synthetic-node", env: {}, stdout: { write: () => true } },
      "synthetic-root",
      [],
      "synthetic-run",
      true,
      "",
      false,
      StringDecoder,
      {},
    );
  };
}
async function snapshotFixture() {
  const source = await runnerSource(),
    root = path.resolve("synthetic-runner-root");
  const files = new Map<string, string>([
    ["src/app.ts", "source"],
    ["tests/check.test.ts", "test"],
    ["package.json", "{}"],
    ["package-lock.json", "{}"],
    ["tsconfig.json", "{}"],
    ["scripts/test.mjs", source],
    ...[
      "scripts/lib/native-ygl.mjs",
      "scripts/lib/native-ygl.d.mts",
      "scripts/capture-context-design.mjs",
      "scripts/probe-ygl-wrapper.mjs",
      "verify/packs/retouch-validation/pack.json",
      "verify/packs/retouch-validation/material.md",
      "verify/packs/retouch-validation/candidates.json",
      "verify/packs/retouch-validation/reviews.json",
      "verify/packs/retouch-validation/fixtures/cases.json",
      "verify/packs/retouch-validation/fixtures/schema.sql",
      "verify/packs/retouch-validation/coverage.json",
      "verify/packs/retouch-validation/README.md",
    ].map((file) => [file, "fixture"] as [string, string]),
    ["docs/PHYSICAL-REFERENCE-WORKFLOW.md", "original method"],
  ]);
  const fakeFs = {
    readdir: async (directory: string) => {
      const relative = path.relative(root, directory).replaceAll("\\", "/");
      assert.ok(relative === "src" || relative === "tests");
      return [
        {
          name: relative === "src" ? "app.ts" : "check.test.ts",
          isDirectory: () => false,
        },
      ];
    },
    readFile: async (file: string) => {
      const relative = path.relative(root, file).replaceAll("\\", "/");
      assert.ok(
        files.has(relative),
        "snapshot attempted unexpected input: " + relative,
      );
      return Buffer.from(files.get(relative)!);
    },
  };
  const snapshot = new AsyncFunction(
    "fs",
    "path",
    "crypto",
    "root",
    section(
      source,
      "async function collectSnapshots() {",
      "const snapshots = await collectSnapshots();",
    ) + "\nreturn await collectSnapshots();",
  );
  return {
    files,
    read: (): Promise<{ file: string; sha256: string }[]> =>
      snapshot(fakeFs, path, crypto, root),
  };
}
export const runnerEvidenceCases: { name: string; run: () => Promise<void> }[] =
  [
    {
      name: "runner capture: every stdout/stderr byte split preserves Chinese and emoji text",
      run: async () => {
        const run = await captureFixture(),
          output = Buffer.from("ok 1 - 中文😺\n"),
          diagnostic = Buffer.from("诊断😺\n");
        const expected = {
          stdout: output.toString("utf8"),
          stderr: diagnostic.toString("utf8"),
          exitCode: 0,
        };
        const interiorSplits = (bytes: Buffer) =>
          [...bytes.keys()].filter((i) => i > 0 && (bytes[i] & 0xc0) === 0x80);
        assert.ok(interiorSplits(output).length > 0);
        assert.ok(interiorSplits(diagnostic).length > 0);
        let combinations = 0;
        for (let outCut = 0; outCut <= output.length; outCut++)
          for (let errCut = 0; errCut <= diagnostic.length; errCut++) {
            assert.deepEqual(
              await run(
                [output.subarray(0, outCut), output.subarray(outCut)],
                [diagnostic.subarray(0, errCut), diagnostic.subarray(errCut)],
                0,
              ),
              expected,
              "stdout cut=" + outCut + ", stderr cut=" + errCut,
            );
            combinations++;
          }
        assert.equal(
          combinations,
          (output.length + 1) * (diagnostic.length + 1),
        );
        assert.deepEqual(
          await run(
            [...output].map((byte) => Buffer.from([byte])),
            [...diagnostic].map((byte) => Buffer.from([byte])),
            0,
          ),
          expected,
          "both streams delivered one byte at a time",
        );
      },
    },
    {
      name: "runner capture: partial UTF8 at EOF is flushed rather than silently lost",
      run: async () => {
        const run = await captureFixture(),
          out = [Buffer.from("not ok 1 - 中文\n"), Buffer.from([0xe4, 0xb8])],
          err = [Buffer.from("stderr: "), Buffer.from([0xf0, 0x9f, 0x98])];
        assert.deepEqual(await run(out, err, 7), {
          stdout: Buffer.concat(out).toString("utf8"),
          stderr: Buffer.concat(err).toString("utf8"),
          exitCode: 7,
        });
      },
    },
    {
      name: "runner capture: empty output does not hide a nonzero exit",
      run: async () => {
        const run = await captureFixture();
        assert.deepEqual(await run([], [], 2), {
          stdout: "",
          stderr: "",
          exitCode: 2,
        });
      },
    },
    {
      name: "runner capture: null process exit is not invented as zero",
      run: async () => {
        const run = await captureFixture();
        assert.deepEqual(
          await run([Buffer.from("partial diagnostics")], [], null),
          { stdout: "partial diagnostics", stderr: "", exitCode: null },
        );
      },
    },
    {
      name: "runner capture: spawn failure rejects instead of inventing an exit",
      run: async () => {
        const run = await captureFixture();
        await assert.rejects(
          run(
            [],
            [],
            null,
            Object.assign(new Error("synthetic spawn failure"), {
              code: "ENOENT",
            }),
          ),
          { code: "ENOENT" },
        );
      },
    },
    {
      name: "runner snapshots: the method body read by Issue16 participates in identity",
      run: async () => {
        const f = await snapshotFixture();
        assert.ok(
          (await f.read()).some(
            (row) => row.file === "docs/PHYSICAL-REFERENCE-WORKFLOW.md",
          ),
        );
      },
    },
    {
      name: "runner snapshots: a method-only change invalidates the source/input fingerprint",
      run: async () => {
        const f = await snapshotFixture(),
          before = await f.read();
        f.files.set("docs/PHYSICAL-REFERENCE-WORKFLOW.md", "changed method");
        const after = await f.read();
        assert.deepEqual(
          after
            .filter(
              (row) =>
                before.find((old) => old.file === row.file)?.sha256 !==
                row.sha256,
            )
            .map((row) => row.file),
          ["docs/PHYSICAL-REFERENCE-WORKFLOW.md"],
        );
      },
    },
  ];

runnerEvidenceCases.push({
  name: "runner full checkpoints: all files count once and failure stays failure",
  run: async () => {
    const source = await runnerSource();
    const summarize = new AsyncFunction(
      "files",
      "segments",
      section(
        source,
        "function summarizeFileSegments(files, segments) {",
        "async function collectSnapshots() {",
      ) + "\nreturn summarizeFileSegments(files,segments);",
    );
    const files = ["tests/a.test.ts", "tests/b.test.ts"],
      counts = {
        tests: 1,
        pass: 1,
        fail: 0,
        cancelled: 0,
        skipped: 0,
        todo: 0,
      };
    const segments = files.map((file, index) => ({
      index,
      file,
      exit_code: 0,
      counts: { ...counts },
      source_stability: "PASS",
    }));
    const result = await summarize(files, segments);
    assert.equal(result.coverage, "COMPLETE");
    assert.equal(result.exit_code, 0);
    assert.equal(result.counts.tests, 2);
    assert.equal(result.counts.pass, 2);
    for (const [selected, parts] of [
      [files, segments.slice(0, 1)],
      [files, [segments[0], segments[0]]],
      [files, [segments[1], segments[0]]],
      [files, [segments[0], { ...segments[1], source_stability: "FAIL" }]],
      [
        files,
        [segments[0], { ...segments[1], counts: { ...counts, tests: 2 } }],
      ],
      [
        files,
        [segments[0], { ...segments[1], counts: { ...counts, pass: null } }],
      ],
    ])
      await assert.rejects(summarize(selected, parts));
    const failed = await summarize(files, [
      segments[0],
      { ...segments[1], exit_code: 1, counts: { ...counts, pass: 0, fail: 1 } },
    ]);
    assert.equal(failed.exit_code, 1);
    assert.equal(failed.counts.fail, 1);
    assert.equal(failed.counts.pass, 1);
    const unknown = await summarize(files, [
      segments[0],
      { ...segments[1], exit_code: null },
    ]);
    assert.equal(unknown.exit_code, 1);
  },
});
runnerEvidenceCases.push({
  name: "runner supervisor: immediate close or spawn error is retained before async launch logging",
  run: async () => {
    const source = await runnerSource();
    const from = source.indexOf("    const completion = new Promise"),
      to = source.indexOf("    await fs.writeFile(", from);
    assert.ok(from >= 0 && to > from);
    const capture = new AsyncFunction(
      "child",
      source.slice(from, to) +
        "\nawait Promise.resolve();await Promise.resolve();return await completion;",
    );
    for (const failure of [false, true]) {
      const child = new EventEmitter();
      const result = capture(child);
      queueMicrotask(() =>
        failure
          ? child.emit("error", new Error("synthetic start failure"))
          : child.emit("close", 3, null),
      );
      const value = await result;
      if (failure) {
        assert.equal(value.exit_code, null);
        assert.match(value.start_error, /synthetic start failure/);
      } else assert.deepEqual(value, { exit_code: 3, signal: null });
    }
  },
});

runnerEvidenceCases.push({
  name: "runner full checkpoints: raw TAP and actual child exit must agree with metadata",
  run: async () => {
    const source = await runnerSource();
    const verify = new AsyncFunction(
      "crypto",
      "part",
      "tap",
      "stderr",
      "observed",
      section(
        source,
        "function parseTapCounts(stdout) {",
        "function summarizeFileSegments(files, segments) {",
      ) + "\nreturn verifySegmentEvidence(part,tap,stderr,observed);",
    );
    const raw = (pass: number, fail: number, todo = 0) =>
      Buffer.from(
        "TAP version 13\n# tests 1\n# pass " +
          pass +
          "\n# fail " +
          fail +
          "\n# cancelled 0\n# skipped 0\n# todo " +
          todo +
          "\n",
      );
    const tap = raw(1, 0),
      err = Buffer.alloc(0),
      hash = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
    const part = {
      file: "tests/a.test.ts",
      exit_code: 0,
      counts: { tests: 1, pass: 1, fail: 0, cancelled: 0, skipped: 0, todo: 0 },
      tap_sha256: hash(tap),
      stderr_sha256: hash(err),
    };
    const observed = {
      exit_code: 0,
      signal: null,
      command: ["--test", part.file],
    };
    assert.equal(await verify(crypto, part, tap, err, observed), true);
    const failedTap = raw(0, 1);
    await assert.rejects(
      verify(
        crypto,
        { ...part, tap_sha256: hash(failedTap) },
        failedTap,
        err,
        observed,
      ),
    );
    for (const exit of [
      { ...observed, exit_code: 1 },
      { ...observed, signal: "SIGTERM" },
      { ...observed, command: ["--test", "tests/b.test.ts"] },
    ])
      await assert.rejects(verify(crypto, part, tap, err, exit));
    const summarize = new AsyncFunction(
      "files",
      "segments",
      section(
        source,
        "function summarizeFileSegments(files, segments) {",
        "async function collectSnapshots() {",
      ) + "\nreturn summarizeFileSegments(files,segments);",
    );
    const item = {
      index: 0,
      file: part.file,
      source_stability: "PASS",
      exit_code: 0,
      counts: part.counts,
    };
    const todo = await summarize(
      [part.file],
      [{ ...item, counts: { ...part.counts, pass: 0, todo: 1 } }],
    );
    assert.equal(todo.exit_code, 1);
    await assert.rejects(
      summarize(
        [part.file],
        [
          {
            ...item,
            counts: {
              tests: 0,
              pass: 0,
              fail: 0,
              cancelled: 0,
              skipped: 0,
              todo: 0,
            },
          },
        ],
      ),
    );
  },
});

runnerEvidenceCases.push({
  name: "runner completed cache: recompute original evidence and reject a false PASS summary",
  run: async () => {
    const source = await runnerSource();
    const verify = new AsyncFunction(
      "cached",
      "original",
      "computed",
      "expectedPath",
      section(
        source,
        "function assertCompletedResult(cached, original, computed, expectedPath) {",
        "async function collectSnapshots() {",
      ) +
        "\nreturn assertCompletedResult(cached,original,computed,expectedPath);",
    );
    const computed = {
      schema: "retouch.implementation-tests/v1",
      test_suite: "FULL",
      verdict: "FAIL",
      observed_exit_code: 1,
      source_stability: "PASS",
      counts: { tests: 1, pass: 0, fail: 1, cancelled: 0, skipped: 0, todo: 0 },
      snapshots: [{ file: "test", sha256: "fixture" }],
      file_sequence: { coverage: "COMPLETE" },
      native_received_correction_evidence: { verdict: "PASS" },
      finished_at: "new",
      log_scope: { new: true },
    };
    const original = {
        ...computed,
        finished_at: "old",
        log_scope: { old: true },
      },
      path = "fixture-report";
    const cached = {
      schema: "retouch.validation-process/v1",
      kind: "FULL",
      verdict: "FAIL",
      observed_exit_code: 1,
      source_stability: "PASS",
      report: path,
    };
    assert.equal(await verify(cached, original, computed, path), "FAIL");
    await assert.rejects(
      verify(
        { ...cached, verdict: "PASS", observed_exit_code: 0 },
        original,
        computed,
        path,
      ),
    );
    await assert.rejects(
      verify(
        cached,
        { ...original, counts: { ...computed.counts, pass: 1, fail: 0 } },
        computed,
        path,
      ),
    );
    await assert.rejects(
      verify({ ...cached, report: "foreign-report" }, original, computed, path),
    );
    const pass = {
      ...computed,
      verdict: "PASS",
      observed_exit_code: 0,
      counts: { ...computed.counts, pass: 1, fail: 0 },
    };
    assert.equal(
      await verify(
        { ...cached, verdict: "PASS", observed_exit_code: 0 },
        { ...pass, finished_at: "old" },
        pass,
        path,
      ),
      "PASS",
    );
    const shortcut = section(
      source,
      "  } else {\n    try {\n      completedResult =",
      "const command = [",
    );
    assert.doesNotMatch(shortcut, /process[.]exit|already_complete|verdict:/);
  },
});
runnerEvidenceCases.push({
  name: "runner snapshots: native developer transport and project criteria participate in identity",
  run: async () => {
    for (const file of [
      "scripts/lib/native-ygl.mjs",
      "verify/packs/retouch-validation/candidates.json",
      "verify/packs/retouch-validation/fixtures/schema.sql",
      "verify/packs/retouch-validation/coverage.json",
    ]) {
      const fixture = await snapshotFixture(),
        before = await fixture.read();
      assert.ok(before.some((x) => x.file === file));
      fixture.files.set(file, "changed");
      const final = await fixture.read();
      assert.deepEqual(
        final
          .filter(
            (x) => before.find((y) => y.file === x.file)?.sha256 !== x.sha256,
          )
          .map((x) => x.file),
        [file],
      );
    }
  },
});
