import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { outputProfile } from "../src/native/plugin/output-profile.mjs";
import { digest } from "../src/native/plugin/commands.mjs";
import { contextCapabilities } from "../src/native/exchange.ts";
import { outputFixture } from "./helpers/output-fixture.ts";
import { exportSuite } from "../src/native/suite.ts";
const entry = process.env.RETOUCH_TEST_YGL_ENTRY;

function metadataFixture(count: number, size: number) {
  const design = {
    id: "design",
    kind: "design",
    title: "metadata fixture",
    version: 1,
    content: "reading order",
    meta: "{}",
  };
  const media = Array.from({ length: count }, (_, i) => ({
    id: "m" + i,
    kind: "media",
    meta: JSON.stringify({ width: 40, height: 20, sha256: "a".repeat(64) }),
  }));
  const slots = media.map((a, i) => ({ id: "p" + i, media_id: a.id }));
  const input = {
    schema: "retouch.suite-output/v1",
    design: {
      artifact_id: design.id,
      version: 1,
      content_hash: digest(design.content),
    },
    order: slots.map((s) => s.id),
    gallery: { size, padding: 0, quality: 90, background: "#ffffff" },
    long: { width: 16, gap: 0, background: "#ffffff", max_pixels: 10000 },
    reading: { width: 16, quality: 70 },
    overflow: "reject",
  };
  return { input, slots, artifacts: [design, ...media] };
}
test("#12 approved contract: aggregate planned pixels and live split reject without decoding", () => {
  const prepared = {
    kind: "delivery",
    meta: JSON.stringify({
      role: "suite-export",
      status: "preparing",
      output_contract: "retouch-output-contract/v1",
    }),
    content: "{}",
  };
  assert.ok(
    contextCapabilities({ tables: { artifacts: [prepared] } }).includes(
      "retouch-output-contract/v1",
    ),
    "prepared but unsealed output must protect reject-only/budget semantics against older tools",
  );
  const normal = metadataFixture(2, 2400);
  assert.equal(
    outputProfile(normal.input, normal.slots, normal.artifacts).dimensions
      .height,
    16,
  );
  for (const [count, size] of [
    [29, 6000],
    [9, 2400],
  ]) {
    const f = metadataFixture(count, size);
    assert.throws(
      () => outputProfile(f.input, f.slots, f.artifacts),
      (e: any) =>
        e.code === "OUTPUT_RESOURCE_LIMIT" &&
        e.details.limit_pixels === 50_000_000 &&
        e.details.parts.gallery === count * size * size &&
        e.details.total_pixels > 50_000_000,
    );
  }
  const split = metadataFixture(1, 64);
  split.input.overflow = "split";
  assert.throws(
    () => outputProfile(split.input, split.slots, split.artifacts),
    { code: "OUTPUT_SPLIT_UNSUPPORTED" },
  );
  assert.equal(
    outputProfile(split.input, split.slots, split.artifacts, true).overflow,
    "split",
    "historical schema reading is not current execution authority",
  );
});
test(
  "#12 approved contract: split refuses before native prepare or CAS while historical replay remains explicit",
  { skip: !entry, timeout: 180000 },
  async () => {
    const { c, p, parent, image, snapshot, profile } = await outputFixture();
    const m = await image(40, 20, "#123456", "input"),
      s = await snapshot("split-rejected", [m]);
    const input = {
        mode: "preview",
        output_profile: {
          ...profile(1, 80),
          gallery: { size: 64, padding: 0, quality: 85, background: "#ffffff" },
          overflow: "split",
        },
      },
      target = path.join(parent, "split");
    const before = await c.call("snapshot", { project: p });
    await assert.rejects(
      exportSuite(c, p, s.id, target, input, "new-split"),
      (e: any) =>
        e.code === "OUTPUT_SPLIT_UNSUPPORTED" && e.effectStatus === "none",
    );
    assert.equal(
      (await c.call("receipt", { request_id: "new-split:prepare" })).result,
      undefined,
    );
    assert.deepEqual(await c.call("snapshot", { project: p }), before);
    await assert.rejects(fs.lstat(target), { code: "ENOENT" });
    const call = c.call.bind(c);
    const preparing = {
      id: "historical-split-fixture",
      kind: "delivery",
      project_id: p,
      content: JSON.stringify({ output_profile: input.output_profile }),
      meta: JSON.stringify({ status: "preparing" }),
    };
    let writes = 0;
    c.call = async (...args: Parameters<typeof c.call>) => {
      if (args[0] === "receipt") return { result: { delivery: preparing } };
      if (args[0] === "suite-export-prepare")
        return { delivery: preparing, snapshot: s };
      if (args[0] === "show" && args[1].id === preparing.id) return preparing;
      if (
        ["postprocess-prepare", "media", "suite-export-seal"].includes(args[0])
      ) {
        writes++;
        throw new Error("historical split must not execute");
      }
      return call(...args);
    };
    try {
      await assert.rejects(
        exportSuite(c, p, s.id, target, input, "old-preparing"),
        (e: any) =>
          e.code === "OUTPUT_SPLIT_UNSUPPORTED" &&
          e.effectStatus === "committed" &&
          e.details.delivery_id === preparing.id,
      );
    } finally {
      c.call = call;
    }
    assert.equal(writes, 0);
    assert.deepEqual(await c.call("snapshot", { project: p }), before);
  },
);
test(
  "#12 approved contract: post-seal and post-data context changes never publish a fresh byte-complete marker",
  { skip: !entry, timeout: 180000 },
  async (t) => {
    const observations = [];
    for (const point of ["after-seal", "after-data"]) {
      const { c, p, parent, image, snapshot, profile, task } =
        await outputFixture();
      const m = await image(40, 20, "#336699", "input"),
        s = await snapshot(point, [m]),
        target = path.join(parent, "output");
      const original = c.call.bind(c);
      let changed = false;
      const change = async () => {
        if (changed) return;
        changed = true;
        await original(
          "requirements",
          {
            project: p,
            task: task.id,
            expected_revision: 0,
            groups: [
              {
                id: "context-changed",
                text: "Synthetic context changes during publication",
                disabled: false,
                scope: "operation",
              },
            ],
          },
          "change-" + point,
        );
      };
      if (point === "after-seal")
        c.call = async (...args: Parameters<typeof c.call>) => {
          const r = await original(...args);
          if (args[0] === "suite-export-seal") await change();
          return r;
        };
      else {
        const nativeLink = fs.link.bind(fs);
        t.mock.method(fs, "link", async (a: any, b: any) => {
          const result = await nativeLink(a, b);
          if (String(b) === path.join(target, "review.zip")) await change();
          return result;
        });
      }
      try {
        await assert.rejects(
          exportSuite(
            c,
            p,
            s.id,
            target,
            {
              mode: "preview",
              output_profile: {
                ...profile(1, 80),
                gallery: {
                  size: 64,
                  padding: 0,
                  quality: 70,
                  background: "#ffffff",
                },
              },
            },
            point,
          ),
          (e: any) =>
            e.code === "SUITE_MEDIA_STALE" && e.effectStatus === "committed",
        );
      } finally {
        c.call = original;
        t.mock.restoreAll();
      }
      assert.equal(changed, true);
      await assert.rejects(fs.lstat(path.join(target, "components.json")), {
        code: "ENOENT",
      });
      const rows = await fs.readdir(target).catch((e) => {
        if (e.code === "ENOENT") return [];
        throw e;
      });
      assert.deepEqual(rows, point === "after-seal" ? [] : ["review.zip"]);
      const receipt = await c.call("receipt", {
        request_id: point + ":prepare",
      });
      assert.equal(
        JSON.parse(
          (await c.call("show", { project: p, id: receipt.result.delivery.id }))
            .meta,
        ).status,
        "preparing",
      );
      observations.push({
        point,
        changed,
        target_files: rows,
        marker: false,
        native_status: "preparing",
      });
    }
    await fs.writeFile(
      path.join(
        process.env.RETOUCH_TEST_ROOT!,
        "native-output-contract-evidence.json",
      ),
      JSON.stringify({
        verdict: "PASS",
        contract: "reject-only/50000000-planned-pixels/bytes-only-marker",
        observations,
        real_image_requests: 0,
      }) + "\n",
      { flag: "wx" },
    );
  },
);

test(
  "#12 approved contract: publication checks are read-only and byte marker never acts as business acceptance",
  { skip: !entry, timeout: 180000 },
  async () => {
    const { c, p, parent, image, snapshot, profile, task } =
      await outputFixture();
    const media = await image(40, 20, "#123456", "input"),
      snap = await snapshot("bytes-not-business", [media]);
    const input = {
        mode: "preview",
        output_profile: {
          ...profile(1, 80),
          gallery: { size: 64, padding: 0, quality: 80, background: "#ffffff" },
        },
      },
      target = path.join(parent, "current");
    const call = c.call.bind(c);
    let checks = 0;
    c.call = async (...args: Parameters<typeof c.call>) => {
      if (args[0] !== "suite-export-check") return call(...args);
      const before = await call("snapshot", { project: p });
      const result = await call(...args);
      const after = await call("snapshot", { project: p });
      assert.deepEqual(
        after,
        before,
        "read-only revalidation must not append events/artifacts or change task state",
      );
      checks++;
      return result;
    };
    let result: any;
    try {
      result = await exportSuite(
        c,
        p,
        snap.id,
        target,
        input,
        "bytes-not-business",
      );
    } finally {
      c.call = call;
    }
    assert.equal(checks, 3);
    const marker = JSON.parse(
      await fs.readFile(path.join(target, "components.json"), "utf8"),
    );
    assert.equal(marker.authority, "frozen-bytes-only");
    assert.equal(marker.native_delivery_id, result.delivery.id);
    assert.equal(marker.requires_native_current_check, true);
    assert.equal(marker.not_business_acceptance, true);
    assert.equal(marker.restorable_workspace, false);
    await call(
      "requirements",
      {
        project: p,
        task: task.id,
        expected_revision: 0,
        groups: [
          {
            id: "later",
            text: "A later task revision does not rewrite historical delivery",
            disabled: false,
            scope: "operation",
          },
        ],
      },
      "later-context",
    );
    const replay = await exportSuite(
      c,
      p,
      snap.id,
      target,
      input,
      "bytes-not-business",
    );
    assert.equal(replay.replayed, true);
    assert.equal(replay.delivery.id, result.delivery.id);
    assert.equal(
      (await call("suite-view", { project: p, id: snap.id })).slots[0].current,
      false,
    );
    await assert.rejects(
      exportSuite(
        c,
        p,
        snap.id,
        path.join(parent, "cannot-reauthorize"),
        input,
        "cannot-reauthorize",
      ),
      { code: "SUITE_MEDIA_STALE" },
    );
    assert.equal(
      (await call("receipt", { request_id: "cannot-reauthorize:prepare" }))
        .result,
      undefined,
    );
  },
);
