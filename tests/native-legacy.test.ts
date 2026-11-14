import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fixture, ready } from "./fixtures.ts";
import {
  readLegacy,
  legacySnapshot,
  migrateLegacy,
} from "../src/native/legacy.ts";
import { NativeClient } from "../src/native/client.ts";
import { bytesHash } from "../src/domain/model.ts";
import { exportProject, importProject } from "../src/native/exchange.ts";

const entry = process.env.RETOUCH_TEST_YGL_ENTRY;
test(
  "旧账本迁移：源只读、预检不写、原生任务/素材/计划绑定与未知进度保全",
  { skip: !entry, timeout: 120000 },
  async (t) => {
    const f = await fixture("standard");
    t.after(() => {
      try {
        f.store.close();
      } catch {}
    });
    const current = await ready(f, "host");
    await f.service.advance(
      current.runId,
      f.store.get("run", current.runId).revision,
      "legacy-prepared",
    );
    f.service.dispatch(
      current.runId,
      f.store.get("run", current.runId).revision,
      "legacy-dispatched",
    );
    // Close the fixture writer so its durable source can be compared before/after read-only migration.
    f.store.close();
    const file = path.join(f.root, "ledger.sqlite"),
      before = bytesHash(await fs.readFile(file));
    const source = await readLegacy(f.root, f.binding.project_id),
      converted = legacySnapshot(source);
    const target = path.join(f.parent, "migrated");
    const preview = await migrateLegacy(source, target, "", true);
    assert.equal(preview.writes, "none");
    assert.equal(
      await fs.access(target).then(
        () => true,
        () => false,
      ),
      false,
    );
    const result = await migrateLegacy(source, target, entry!, false);
    assert.equal(result.source_access, "read-only");
    assert.equal(bytesHash(await fs.readFile(file)), before);
    const client = await NativeClient.open(target),
      view = await client.call("brief", { project: f.binding.project_id });
    assert.equal(view.tasks.length, 1);
    assert.equal(view.tasks[0].progress, "unknown");
    assert.ok(view.unknown_requests.length > 0);
    assert.equal(view.project.id, f.binding.project_id);
    assert.ok(view.artifacts.some((a: any) => a.kind === "spec"));
    assert.ok(view.artifacts.some((a: any) => a.kind === "authorization"));
    assert.equal(
      await fs.access(path.join(target, "ledger.sqlite")).then(
        () => true,
        () => false,
      ),
      false,
    );
    assert.ok(
      converted.mapping.some((x) => x.source === "task:" + current.taskId),
    );
    const zip = path.join(f.parent, "migrated.zip");
    await exportProject(client, view.project.id, zip);
    const restored = path.join(f.parent, "roundtrip");
    await importProject(zip, restored, { entry });
    assert.equal(
      (
        await (
          await NativeClient.open(restored)
        ).call("brief", { project: view.project.id })
      ).tasks.length,
      1,
    );
  },
);
