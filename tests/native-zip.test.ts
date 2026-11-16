import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import nodeFs from "node:fs";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import sharp from "sharp";
import { NativeClient } from "../src/native/client.ts";
import { registerBytes } from "../src/native/files.ts";
import { exportProject, importProject } from "../src/native/exchange.ts";
import { exportSuite } from "../src/native/suite.ts";
import { readZip } from "../src/infrastructure/zip.ts";
import { bytesHash } from "../src/domain/model.ts";

const entry = process.env.RETOUCH_TEST_YGL_ENTRY;
test(
  "ZIP native exports retain staging cleanup, conflict guards and same-key recovery after actual partial IO",
  { skip: !entry, timeout: 180000 },
  async (t) => {
    const parent = await fs.mkdtemp(
      path.join(process.env.RETOUCH_TEST_ROOT!, "zip-integration-"),
    );
    const c = await NativeClient.initialize(path.join(parent, "home"), entry!);
    let serial = 0;
    const call = (action: string, body: any) =>
      c.call(action, body, "zip-test-" + ++serial);
    const p = (
      await call("project-new", {
        name: "ZIP export safety",
        intent: "isolated synthetic fixture",
        tags: [],
      })
    ).project.id;
    const goal = (
      await call("goal-new", {
        project: p,
        title: "Export safety",
        scope: "fixture only",
        preserve: [],
        done_when: "files and receipts agree",
        source: "fixture",
      })
    ).artifact;
    const task = (
      await call("task-new", {
        project: p,
        goal: goal.id,
        title: "Synthetic image",
        brief: "fixture only",
        kind: "image",
        expected_output: "image",
        done_when: "checked export",
      })
    ).task;
    const image = (
      await registerBytes(
        c,
        p,
        task.id,
        await sharp({
          create: { width: 16, height: 8, channels: 3, background: "#123456" },
        })
          .png()
          .toBuffer(),
        { role: "postprocess" },
        "zip-image",
      )
    ).artifact;
    const snapshot = (
      await call("suite-snapshot", {
        project: p,
        task: task.id,
        name: "Safety",
        expected_id: null,
        expected_revision: 0,
        slots: [
          {
            id: "one",
            role: "synthetic rectangle",
            media_id: image.id,
            sha256: JSON.parse(image.meta).sha256,
          },
        ],
      })
    ).artifact;
    const interrupt = (matches: (file: string) => boolean) => {
      const native = nodeFs.createWriteStream;
      t.mock.method(
        nodeFs,
        "createWriteStream",
        (...args: Parameters<typeof native>) => {
          const stream = native(...args);
          if (matches(String(args[0]))) {
            const write = stream._write.bind(stream);
            stream._writev = undefined;
            stream._write = (chunk, encoding, callback) =>
              write(chunk.subarray(0, 8), encoding, (error) =>
                callback(
                  error ??
                    Object.assign(new Error("synthetic IO interruption"), {
                      code: "EIO",
                    }),
                ),
              );
          }
          return stream;
        },
      );
      syncBuiltinESMExports();
    };
    const reset = () => {
      t.mock.restoreAll();
      syncBuiltinESMExports();
    };
    const context = path.join(parent, "context.zip");
    interrupt((file) => path.basename(file).startsWith(".retouch-export-"));
    try {
      await assert.rejects(
        exportProject(c, p, context),
        (e: any) => e.code === "EIO" && e.effectStatus === "committed",
      );
    } finally {
      reset();
    }
    await assert.rejects(fs.lstat(context), { code: "ENOENT" });
    assert.deepEqual(
      (await fs.readdir(parent)).filter((n) =>
        n.startsWith(".retouch-export-"),
      ),
      [],
    );
    await exportProject(c, p, context);
    const contextBytes = await fs.readFile(context);
    await assert.rejects(exportProject(c, p, context), { code: "EEXIST" });
    assert.deepEqual(await fs.readFile(context), contextBytes);
    const restored = path.join(parent, "restored");
    await importProject(context, restored, { entry });
    const r = await NativeClient.open(restored),
      before = await r.call("brief", { project: p });
    const replay = await importProject(context, restored, { entry });
    assert.equal(replay.replayed, true);
    assert.deepEqual(await r.call("brief", { project: p }), before);

    const suite = path.join(parent, "suite.zip"),
      stageRoot = path.join(c.root, "tmp", "suite-export");
    interrupt((file) => path.dirname(file) === stageRoot);
    try {
      await assert.rejects(
        exportSuite(c, p, snapshot.id, suite, { mode: "preview" }, "zip-suite"),
        (e: any) =>
          e.code === "EIO" &&
          e.effectStatus === "committed" &&
          !!e.details?.delivery_id,
      );
    } finally {
      reset();
    }
    await assert.rejects(fs.lstat(suite), { code: "ENOENT" });
    assert.deepEqual(await fs.readdir(stageRoot), []);
    const prepared = await c.call("receipt", {
      request_id: "zip-suite:prepare",
    });
    const recovered = await exportSuite(
      c,
      p,
      snapshot.id,
      suite,
      { mode: "preview" },
      "zip-suite",
    );
    assert.equal(recovered.delivery.id, prepared.result.delivery.id);
    assert.equal(recovered.image_api_requests, 0);
    const bytes = await fs.readFile(suite),
      mtime = (await fs.stat(suite)).mtimeMs;
    const bundle = await readZip(suite),
      manifest = JSON.parse(bundle.get("manifest.json")!.toString());
    assert.equal(manifest.snapshot_id, snapshot.id);
    assert.equal(
      bytesHash(bundle.get(manifest.slots[0].file)!),
      manifest.slots[0].sha256,
    );
    const same = await exportSuite(
      c,
      p,
      snapshot.id,
      suite,
      { mode: "preview" },
      "zip-suite",
    );
    assert.equal(same.replayed, true);
    assert.equal(same.delivery.id, recovered.delivery.id);
    assert.equal((await fs.stat(suite)).mtimeMs, mtime);
    await assert.rejects(
      exportSuite(
        c,
        p,
        snapshot.id,
        suite,
        { mode: "preview" },
        "different-key",
      ),
      { code: "DELIVERY_CONFLICT" },
    );
    assert.deepEqual(await fs.readFile(suite), bytes);
    const tampered = Buffer.from("preserved tampered fixture");
    await fs.writeFile(suite, tampered);
    await assert.rejects(
      exportSuite(c, p, snapshot.id, suite, { mode: "preview" }, "zip-suite"),
      { code: "PACKAGE_MISSING" },
    );
    assert.deepEqual(await fs.readFile(suite), tampered);
    assert.deepEqual(await fs.readdir(stageRoot), []);
    assert.deepEqual(
      (await fs.readdir(parent)).filter((n) =>
        n.startsWith(".retouch-export-"),
      ),
      [],
    );
    const redirected = path.join(parent, "redirected");
    await fs.symlink(
      parent,
      redirected,
      process.platform === "win32" ? "junction" : "dir",
    );
    await assert.rejects(
      exportProject(c, p, path.join(redirected, "linked-context.zip")),
      { code: "ZIP_TARGET" },
    );
    await assert.rejects(
      exportSuite(
        c,
        p,
        snapshot.id,
        path.join(redirected, "linked-suite.zip"),
        { mode: "preview" },
        "linked-suite",
      ),
      { code: "DELIVERY_LINK" },
    );
    await assert.rejects(fs.lstat(path.join(parent, "linked-context.zip")), {
      code: "ENOENT",
    });
    await assert.rejects(fs.lstat(path.join(parent, "linked-suite.zip")), {
      code: "ENOENT",
    });
    await fs.writeFile(
      path.join(process.env.RETOUCH_TEST_ROOT!, "native-zip-evidence.json"),
      JSON.stringify(
        {
          verdict: "PASS",
          issue: 13,
          partial_io: "actual prefix write then injected EIO",
          staging_cleanup: "PASS",
          same_key_recovery: "PASS",
          conflicting_targets_preserved: true,
          symlink_parent_rejected: true,
          context_import_replay: "PASS",
          image_api_requests: 0,
          scope:
            "isolated native workspace and synthetic bytes; no business media or credentials",
        },
        null,
        2,
      ) + "\n",
      { flag: "wx" },
    );
  },
);
