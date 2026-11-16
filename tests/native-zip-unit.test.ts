import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import * as yazl from "yazl";
import { readZip, writeZip, ZIP_LIMITS } from "../src/infrastructure/zip.ts";

async function fixture() {
  const root = path.resolve(process.env.RETOUCH_TEST_ROOT ?? "tmp/zip-tests");
  await fs.mkdir(root, { recursive: true });
  return fs.mkdtemp(path.join(root, "zip-"));
}
async function absent(file: string) {
  await assert.rejects(fs.lstat(file), { code: "ENOENT" });
}

test("ZIP preflight rejects every invalid entry before creating a target and preserves existing bytes", async () => {
  const root = await fixture();
  const repeated = Buffer.alloc(ZIP_LIMITS.entry);
  const cases: [string, Map<string, Buffer>, string][] = [
    [
      "oversize",
      new Map([["large.bin", Buffer.alloc(ZIP_LIMITS.entry + 1)]]),
      "ZIP_LIMIT",
    ],
    [
      "late-path",
      new Map([
        ["valid.txt", Buffer.from("valid")],
        ["../escape.txt", Buffer.from("bad")],
      ]),
      "ZIP_PATH",
    ],
    [
      "collision",
      new Map([
        ["A.txt", Buffer.from("a")],
        ["a.txt", Buffer.from("b")],
      ]),
      "ZIP_COLLISION",
    ],
    [
      "count",
      new Map(
        Array.from({ length: ZIP_LIMITS.entries + 1 }, (_, i) => [
          i + ".txt",
          Buffer.alloc(0),
        ]),
      ),
      "ZIP_LIMIT",
    ],
    [
      "expanded",
      new Map(
        Array.from(
          { length: ZIP_LIMITS.expanded / ZIP_LIMITS.entry + 1 },
          (_, i) => [i + ".bin", repeated],
        ),
      ),
      "ZIP_LIMIT",
    ],
  ];
  for (const [name, entries, code] of cases) {
    const target = path.join(root, name + ".zip");
    await assert.rejects(
      writeZip(target, entries),
      (e: any) => e.code === code && e.effectStatus === "none",
    );
    await absent(target);
    const keep = path.join(root, name + "-existing.zip");
    await fs.writeFile(keep, "existing user bytes", { flag: "wx" });
    await assert.rejects(writeZip(keep, entries), { code });
    assert.equal(await fs.readFile(keep, "utf8"), "existing user bytes");
  }
  await absent(path.join(root, "escape.txt"));
});

test("ZIP rejects reserved, non-normalized and traversal paths without opening files", async () => {
  const root = await fixture();
  const paths = [
    "/absolute",
    "a\\b",
    "C:drive",
    "a//b",
    "a/./b",
    "a/../b",
    "con.txt",
    "a/NUL",
    "trailing.",
    "e\u0301.txt",
    "bad\u0000name",
  ];
  for (const [i, name] of paths.entries()) {
    const file = path.join(root, i + ".zip");
    await assert.rejects(
      writeZip(file, new Map([[name, Buffer.from("synthetic")]])),
      { code: "ZIP_PATH" },
    );
    await absent(file);
  }
});

test("ZIP deterministic small and empty roundtrips; valid inputs never overwrite targets", async () => {
  const root = await fixture();
  const entries = new Map([
    ["probe.txt", Buffer.from("synthetic zip roundtrip")],
    ["nested/empty.bin", Buffer.alloc(0)],
  ]);
  const first = path.join(root, "first.zip"),
    second = path.join(root, "second.zip");
  await writeZip(first, entries);
  await writeZip(second, entries);
  assert.deepEqual(await readZip(first), entries);
  const bytes = await fs.readFile(first);
  assert.deepEqual(await fs.readFile(second), bytes);
  await assert.rejects(
    writeZip(first, new Map([["other", Buffer.from("new")]])),
    { code: "EEXIST" },
  );
  assert.deepEqual(await fs.readFile(first), bytes);
  const empty = path.join(root, "empty.zip");
  await writeZip(empty, new Map());
  assert.equal((await readZip(empty)).size, 0);
});

test("ZIP target links remain untouched rather than being followed or removed", async () => {
  const root = await fixture(),
    original = path.join(root, "original"),
    link = path.join(root, "linked.zip");
  await fs.writeFile(original, "preserve hardlinked file");
  await fs.link(original, link);
  await assert.rejects(
    writeZip(link, new Map([["good", Buffer.from("data")]])),
    { code: "EEXIST" },
  );
  assert.equal(await fs.readFile(original, "utf8"), "preserve hardlinked file");
  assert.equal(await fs.readFile(link, "utf8"), "preserve hardlinked file");
});

test("ZIP distinguishes an unopened IO failure from interruption after actual partial writes", async (t) => {
  const root = await fixture();
  const entries = new Map([["sample.txt", Buffer.from("synthetic bytes")]]);
  await assert.rejects(
    writeZip(path.join(root, "missing", "absent.zip"), entries),
    (e: any) => e.code === "ENOENT" && e.effectStatus === "none",
  );
  const file = path.join(root, "interrupted.zip");
  // Intercept only this WriteStream; perform a real prefix write before the deterministic IO failure.
  const nodeFs = await import("node:fs");
  const native = nodeFs.default.createWriteStream;
  t.mock.method(
    nodeFs.default,
    "createWriteStream",
    (...args: Parameters<typeof createWriteStream>) => {
      const stream = native(...args);
      if (String(args[0]) === file) {
        const write = stream._write.bind(stream);
        stream._writev = undefined;
        stream._write = (chunk, encoding, callback) => {
          write(
            chunk.subarray(0, Math.min(chunk.length, 8)),
            encoding,
            (error) => {
              callback(
                error ??
                  Object.assign(new Error("synthetic disk interruption"), {
                    code: "EIO",
                  }),
              );
            },
          );
        };
      }
      return stream;
    },
  );
  syncBuiltinESMExports();
  try {
    await assert.rejects(
      writeZip(file, entries),
      (e: any) =>
        e.code === "EIO" &&
        e.effectStatus === "committed" &&
        e.details?.partial_file === true &&
        e.details.bytes_written > 0,
    );
    assert.ok((await fs.stat(file)).size > 0);
    await assert.rejects(readZip(file));
    const bytes = await fs.readFile(file);
    await assert.rejects(writeZip(file, entries), { code: "EEXIST" });
    assert.deepEqual(await fs.readFile(file), bytes);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

async function hostileZip(
  file: string,
  entries: { name: string; bytes: Buffer; mode?: number }[],
  rename?: [string, string],
) {
  const zip = new yazl.ZipFile(),
    chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    zip.outputStream.on("data", (b) => chunks.push(Buffer.from(b)));
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on("error", reject);
  });
  for (const e of entries)
    zip.addBuffer(e.bytes, e.name, { mode: e.mode ?? 0o100644 });
  zip.end();
  const bytes = await done;
  if (rename) {
    const from = Buffer.from(rename[0]),
      to = Buffer.from(rename[1]);
    assert.equal(from.length, to.length);
    for (
      let at = bytes.indexOf(from);
      at >= 0;
      at = bytes.indexOf(from, at + to.length)
    )
      to.copy(bytes, at);
  }
  await fs.writeFile(file, bytes, { flag: "wx" });
}

test("ZIP reader still blocks traversal, collisions, links, count, size and compression bombs", async () => {
  const root = await fixture(),
    data = Buffer.from("synthetic");
  const cases: [
    string,
    { name: string; bytes: Buffer; mode?: number }[],
    string[],
    [string, string]?,
  ][] = [
    [
      "path",
      [{ name: "aa/evil.txt", bytes: data }],
      ["ZIP_PATH", "ZIP_INVALID"],
      ["aa/evil.txt", "../evil.txt"],
    ],
    [
      "collision",
      [
        { name: "A.txt", bytes: data },
        { name: "a.txt", bytes: data },
      ],
      ["ZIP_COLLISION"],
    ],
    ["link", [{ name: "link.txt", bytes: data, mode: 0o120777 }], ["ZIP_LINK"]],
    [
      "entry",
      [{ name: "big.bin", bytes: Buffer.alloc(ZIP_LIMITS.entry + 1) }],
      ["ZIP_LIMIT"],
    ],
    [
      "ratio",
      [{ name: "bomb.bin", bytes: Buffer.alloc(4 * 1024 * 1024) }],
      ["ZIP_LIMIT"],
    ],
    [
      "count",
      Array.from({ length: ZIP_LIMITS.entries + 1 }, (_, i) => ({
        name: i + ".txt",
        bytes: Buffer.alloc(0),
      })),
      ["ZIP_LIMIT"],
    ],
  ];
  for (const [name, entries, codes, rename] of cases) {
    const file = path.join(root, name + ".zip");
    await hostileZip(file, entries, rename);
    await assert.rejects(readZip(file), (e: any) => codes.includes(e.code));
  }
  await absent(path.join(root, "evil.txt"));
});
