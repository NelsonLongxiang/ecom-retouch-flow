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
    section(
      source,
      "const child = spawn(process.execPath, command, {",
      'await fs.writeFile(path.join(runRoot, "tests.tap"), stdout);',
    ) + "\nreturn {stdout,stderr,exitCode};",
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
