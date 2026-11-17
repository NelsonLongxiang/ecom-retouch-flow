import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { NativeClient } from "../src/native/client.ts";
import { registerBytes, objectBytes } from "../src/native/files.ts";
import { transform } from "../src/native/postprocess.ts";
import { exportSuite } from "../src/native/suite.ts";
import {
  exportProject,
  importProject,
  inspectProject,
} from "../src/native/exchange.ts";
import { readZip, writeZip, ZIP_LIMITS } from "../src/infrastructure/zip.ts";
import { digest } from "../src/native/plugin/commands.mjs";
import { bytesHash } from "../src/domain/model.ts";

import { outputFixture as fixture } from "./helpers/output-fixture.ts";
const entry = process.env.RETOUCH_TEST_YGL_ENTRY;

test(
  "#12: two different page sets share one native profile entry, preserve aspect/ICC/lineage and reuse unchanged derivatives",
  // This is a multi-export/restore scenario; individual native calls keep their cap.
  { skip: !entry, timeout: 600000 },
  async (t) => {
    const f = await fixture(),
      { parent, c, p, image, snapshot, profile } = f;
    const pages = [
      await image(120, 60, "#ff0000", "banner"),
      await image(60, 120, "#0000ff", "tall"),
    ];
    const first = await snapshot("first series", pages),
      input = { mode: "preview", output_profile: profile(2) };
    const out = path.join(parent, "review-first");
    const result = await exportSuite(
      c,
      p,
      first.id,
      out,
      input,
      "first-export",
    );
    assert.equal(result.image_api_requests, 0);
    const files = await readZip(path.join(out, "review.zip")),
      manifest = JSON.parse(files.get("manifest.json")!.toString());
    assert.equal(manifest.snapshot_id, first.id);
    assert.equal(manifest.restorable_workspace, false);
    assert.equal(
      manifest.slots.every((s: any) => !s.accepted),
      true,
    );
    assert.equal(manifest.long.width, 100);
    assert.equal(manifest.long.height, 258);
    for (const slot of manifest.slots) {
      const src = JSON.parse(pages[Number(slot.id.slice(1))].meta),
        png = await sharp(files.get(slot.png.file)!).metadata(),
        jpg = await sharp(files.get(slot.gallery.file)!).metadata();
      assert.deepEqual([png.width, png.height], [src.width, src.height]);
      assert.deepEqual([jpg.width, jpg.height], [2400, 2400]);
      assert.equal(jpg.space, "srgb");
      assert.ok(jpg.icc?.length);
      assert.equal(
        bytesHash(files.get(slot.gallery.file)!),
        slot.gallery.sha256,
      );
      const a = await c.call("show", { project: p, id: slot.gallery.media_id }),
        m = JSON.parse(a.meta);
      assert.ok(m.parents.includes(slot.png.media_id));
      assert.ok(m.transform.execution_id);
    }
    const raw = await sharp(files.get(manifest.slots[0].gallery.file)!)
      .removeAlpha()
      .raw()
      .toBuffer();
    assert.ok(raw[0] > 240 && raw[1] > 240 && raw[2] > 240);
    const middle = (1200 * 2400 + 1200) * 3;
    assert.ok(raw[middle] > 230 && raw[middle + 1] < 30);
    const before = await c.call("snapshot", { project: p }),
      count = before.tables.artifacts.length,
      mtime = (await fs.stat(path.join(out, "review.zip"))).mtimeMs;
    assert.equal(
      (await exportSuite(c, p, first.id, out, input, "first-export")).replayed,
      true,
    );
    assert.equal(
      (await c.call("snapshot", { project: p })).tables.artifacts.length,
      count,
    );
    assert.equal((await fs.stat(path.join(out, "review.zip"))).mtimeMs, mtime);
    await assert.rejects(
      exportSuite(
        c,
        p,
        first.id,
        out,
        {
          ...input,
          output_profile: {
            ...input.output_profile,
            reading: { width: 50, quality: 70 },
          },
        },
        "first-export",
      ),
      { code: "REQUEST_CONFLICT" },
    );
    const next = [pages[0], await image(80, 40, "#00aa00", "replace")],
      second = await snapshot("first series", next, first);
    const changed = await exportSuite(
      c,
      p,
      second.id,
      path.join(parent, "review-second"),
      input,
      "second-export",
    );
    assert.equal(
      changed.outputs.slots[0].png.media_id,
      manifest.slots[0].png.media_id,
    );
    assert.equal(
      changed.outputs.slots[0].gallery.media_id,
      manifest.slots[0].gallery.media_id,
    );
    assert.notEqual(
      changed.outputs.slots[1].gallery.media_id,
      manifest.slots[1].gallery.media_id,
    );
    const three = [
      await image(40, 80, "#aa0000", "three-a"),
      await image(100, 50, "#00aa00", "three-b"),
      await image(30, 30, "#0000aa", "three-c"),
    ];
    const s3 = await snapshot("other series", three),
      threeInput = {
        mode: "preview",
        output_profile: { ...profile(3, 80), order: ["p2", "p0", "p1"] },
      };
    const other = await exportSuite(
      c,
      p,
      s3.id,
      path.join(parent, "other"),
      threeInput,
      "other-export",
    );
    assert.equal(other.outputs.slots.length, 3);
    assert.deepEqual(
      other.outputs.slots.map((s: any) => s.id),
      ["p2", "p0", "p1"],
    );
    assert.equal(other.outputs.long.height, 296);
    const repeated = await snapshot("repeated source", [pages[0], pages[0]]);
    const repeatedOutput = await exportSuite(
      c,
      p,
      repeated.id,
      path.join(parent, "repeated"),
      input,
      "repeated",
    );
    assert.equal(
      repeatedOutput.outputs.slots[0].long_page.media_id,
      repeatedOutput.outputs.slots[1].long_page.media_id,
    );
    const zip = path.join(parent, "context.zip");
    await exportProject(c, p, zip);
    assert.ok(
      (await inspectProject(zip)).manifest.requires.includes(
        "retouch-suite-output/v1",
      ),
    );
    const target = path.join(parent, "restored");
    await importProject(zip, target, { entry });
    const restored = await NativeClient.open(target),
      restoredView = await restored.call("brief", { project: p });
    assert.equal(
      restoredView.artifacts.filter(
        (a: any) => JSON.parse(a.meta).output_manifest,
      ).length,
      4,
    );
    const cloned = await importProject(zip, c.root, {
      strategy: "clone",
      name: "Cloned outputs",
    });
    const cloneView = await c.call("brief", { project: cloned.project_id });
    const cloneDelivery = cloneView.artifacts.find(
      (a: any) => JSON.parse(a.meta).output_catalog,
    );
    assert.equal(
      JSON.parse(cloneDelivery.meta).external_output_status,
      "historical-source-files-not-authorized",
    );
    await exportProject(
      c,
      cloned.project_id,
      path.join(parent, "clone-context.zip"),
    );
    const bad = await readZip(zip),
      caps = JSON.parse(bad.get("manifest.json")!.toString());
    caps.requires = caps.requires.filter(
      (s: string) => s !== "retouch-suite-output/v1",
    );
    bad.set("manifest.json", Buffer.from(JSON.stringify(caps)));
    const badzip = path.join(parent, "missing-capability.zip");
    await writeZip(badzip, bad);
    await assert.rejects(inspectProject(badzip), { code: "ZIP_CAPABILITY" });
    const nativeCall = c.call.bind(c);
    let fail = true;
    c.call = async (...args: Parameters<NativeClient["call"]>) => {
      if (args[0] === "suite-export-complete" && fail) {
        fail = false;
        throw new Error("synthetic completion receipt failure");
      }
      return nativeCall(...args);
    };
    const interrupted = path.join(parent, "recoverable");
    try {
      await assert.rejects(
        exportSuite(c, p, second.id, interrupted, input, "resume"),
        (e: any) => e.effectStatus === "committed" && !!e.details.delivery_id,
      );
    } finally {
      c.call = nativeCall;
    }
    const published = await fs.readFile(path.join(interrupted, "review.zip"));
    const recovered = await exportSuite(
      c,
      p,
      second.id,
      interrupted,
      input,
      "resume",
    );
    assert.equal(recovered.image_api_requests, 0);
    assert.deepEqual(
      await fs.readFile(path.join(interrupted, "review.zip")),
      published,
    );
    await fs.writeFile(
      path.join(interrupted, "review.zip"),
      "tampered synthetic output",
    );
    await assert.rejects(
      exportSuite(c, p, second.id, interrupted, input, "resume"),
      { code: "OUTPUT_CONFLICT" },
    );
    assert.equal(
      await fs.readFile(path.join(interrupted, "review.zip"), "utf8"),
      "tampered synthetic output",
    );
    await assert.rejects(inspectProject(path.join(out, "review.zip")));
    await fs.writeFile(
      path.join(process.env.RETOUCH_TEST_ROOT!, "native-output-evidence.json"),
      JSON.stringify({
        verdict: "PASS",
        issue: 12,
        two_configurations: true,
        dimensions_and_srgb_icc: true,
        derivative_reuse: true,
        same_key_recovery: true,
        visual_quality: "NOT_RUN",
        user_acceptance: "NOT_RUN",
        image_api_requests: 0,
      }) + "\n",
      { flag: "wx" },
    );
  },
);

test(
  "#12: profile preflight rejects unknown/order/pixel/crop/source conflicts; approved crop and stale-context adoption stay explicit",
  { skip: !entry, timeout: 180000 },
  async () => {
    const f = await fixture(),
      { parent, c, p, profile, image, snapshot, call, task } = f;
    const media = await image(100, 50, "#123456", "input"),
      snap = await snapshot("guardrails", [media]),
      base = profile(1);
    const cases = [
      { ...base, html: "<script>bad</script>" },
      { ...base, order: [] },
      { ...base, long: { ...base.long, max_pixels: 1 } },
      { ...base, design: { ...base.design, content_hash: "0".repeat(64) } },
      {
        ...base,
        crops: {
          p0: {
            region: { x: 0, y: 0, width: 50, height: 50 },
            coordinate_system: { width: 100, height: 50 },
            approval: base.design,
            quote: "not user approval",
          },
        },
      },
    ];
    for (let i = 0; i < cases.length; i++) {
      const out = path.join(parent, "bad-" + i);
      await assert.rejects(
        exportSuite(
          c,
          p,
          snap.id,
          out,
          { mode: "preview", output_profile: cases[i] },
          "bad-" + i,
        ),
      );
      await assert.rejects(fs.lstat(out), { code: "ENOENT" });
      assert.equal(
        (await c.call("receipt", { request_id: "bad-" + i + ":prepare" }))
          .result,
        undefined,
      );
    }
    const existing = path.join(parent, "existing");
    await fs.mkdir(existing);
    await fs.writeFile(path.join(existing, "keep.txt"), "preserve user bytes");
    await assert.rejects(
      exportSuite(
        c,
        p,
        snap.id,
        existing,
        { mode: "preview", output_profile: base },
        "existing",
      ),
      { code: "DELIVERY_CONFLICT" },
    );
    assert.equal(
      await fs.readFile(path.join(existing, "keep.txt"), "utf8"),
      "preserve user bytes",
    );
    const linked = path.join(parent, "linked");
    await fs.symlink(
      parent,
      linked,
      process.platform === "win32" ? "junction" : "dir",
    );
    await assert.rejects(
      exportSuite(
        c,
        p,
        snap.id,
        path.join(linked, "bad"),
        { mode: "preview", output_profile: base },
        "linked",
      ),
      { code: "DELIVERY_LINK" },
    );
    const transformInput = {
      input_id: media.id,
      inputs: [
        {
          id: media.id,
          sha256: JSON.parse(media.meta).sha256,
          role: "fixture",
        },
      ],
    };
    await assert.rejects(
      transform(
        c,
        p,
        task.id,
        {
          ...transformInput,
          operations: [
            {
              op: "extend",
              top: -1,
              bottom: 0,
              left: 0,
              right: 0,
              background: "#ffffff",
            },
          ],
        },
        0,
        "bad-extend",
      ),
      { code: "TRANSFORM_EXTEND" },
    );
    await assert.rejects(
      transform(
        c,
        p,
        task.id,
        {
          ...transformInput,
          operations: [
            {
              op: "encode",
              format: "jpeg",
              quality: 80,
              background: "#ffffff",
              colourspace: "srgb",
            },
            { op: "resize", width: 10, height: 10, fit: "contain" },
          ],
        },
        0,
        "nonterminal-encode",
      ),
      { code: "TRANSFORM_ENCODING" },
    );
    await assert.rejects(
      exportSuite(
        c,
        p,
        snap.id,
        path.join(parent, "not-accepted"),
        { mode: "delivery", output_profile: base },
        "delivery-denied",
      ),
      { code: "SUITE_ACCEPTANCE" },
    );
    const approval = (
      await call("document", {
        project: p,
        task: f.designTask.id,
        kind: "spec",
        title: "Crop approval fixture",
        role: "user-original",
        source: "ISOLATED FIXTURE",
        content:
          "Approve cropping the synthetic page to the left 50 by 50 rectangle.",
      })
    ).artifact;
    const cropped = {
      ...base,
      crops: {
        p0: {
          region: { x: 0, y: 0, width: 50, height: 50 },
          coordinate_system: { width: 100, height: 50 },
          approval: {
            artifact_id: approval.id,
            version: approval.version,
            content_hash: digest(approval.content),
          },
          quote:
            "Approve cropping the synthetic page to the left 50 by 50 rectangle.",
        },
      },
    };
    const r = await exportSuite(
      c,
      p,
      snap.id,
      path.join(parent, "cropped"),
      { mode: "preview", output_profile: cropped },
      "crop",
    );
    assert.equal(r.outputs.long.height, 100);
    assert.deepEqual(
      r.outputs.slots[0].long_page.crop.region,
      cropped.crops.p0.region,
    );
    await call("requirements", {
      project: p,
      task: task.id,
      expected_revision: 0,
      groups: [
        {
          id: "new",
          text: "context changes require actual result revalidation",
          disabled: false,
          scope: "operation",
        },
      ],
    });
    await assert.rejects(
      exportSuite(
        c,
        p,
        snap.id,
        path.join(parent, "stale"),
        { mode: "preview", output_profile: base },
        "stale",
      ),
      { code: "SUITE_MEDIA_STALE" },
    );
    const retained = await c.call("show", { project: p, id: media.id });
    assert.equal(retained.meta, media.meta);
  },
);

test(
  "#12: actual >32MiB long PNG is rejected without a target; split is unsupported and context never omits bytes",
  { skip: !entry, timeout: 300000 },
  async () => {
    const f = await fixture(),
      { parent, c, p, task, profile, snapshot } = f;
    const pages = [];
    for (let i = 0; i < 2; i++) {
      const b = await sharp(crypto.randomBytes(2000 * 3000 * 3), {
        raw: { width: 2000, height: 3000, channels: 3 },
      })
        .png()
        .toBuffer();
      assert.ok(b.length < ZIP_LIMITS.entry);
      pages.push(
        (
          await registerBytes(
            c,
            p,
            task.id,
            b,
            { role: "postprocess" },
            "noise-" + i,
          )
        ).artifact,
      );
    }
    const snap = await snapshot("large synthetic pages", pages),
      config = {
        ...profile(2, 2000),
        gallery: { size: 256, padding: 0, background: "#ffffff", quality: 60 },
        long: {
          width: 2000,
          gap: 0,
          background: "#ffffff",
          max_pixels: 50_000_000,
        },
        reading: { width: 200, quality: 60 },
      };
    const reject = path.join(parent, "reject");
    await assert.rejects(
      exportSuite(
        c,
        p,
        snap.id,
        reject,
        { mode: "preview", output_profile: config },
        "reject",
      ),
      { code: "OUTPUT_OVERSIZE" },
    );
    await assert.rejects(fs.lstat(reject), { code: "ENOENT" });
    const out = path.join(parent, "split"),
      beforeSplit = await c.call("snapshot", { project: p });
    await assert.rejects(
      exportSuite(
        c,
        p,
        snap.id,
        out,
        { mode: "preview", output_profile: { ...config, overflow: "split" } },
        "split",
      ),
      (e: any) =>
        e.code === "OUTPUT_SPLIT_UNSUPPORTED" && e.effectStatus === "none",
    );
    await assert.rejects(fs.lstat(out), { code: "ENOENT" });
    assert.equal(
      (await c.call("receipt", { request_id: "split:prepare" })).result,
      undefined,
    );
    assert.deepEqual(await c.call("snapshot", { project: p }), beforeSplit);
    const long = beforeSplit.tables.artifacts.find(
      (a: any) =>
        a.kind === "media" &&
        JSON.parse(a.meta).width === 2000 &&
        JSON.parse(a.meta).height === 6000,
    );
    assert.ok(
      long,
      "oversize real native render remains available for explicit diagnostics, not publication",
    );
    const bytes = await objectBytes(c.root, JSON.parse(long.meta));
    assert.ok(bytes.length > ZIP_LIMITS.entry);
    assert.equal(bytesHash(bytes), JSON.parse(long.meta).sha256);
    const md = await sharp(bytes).metadata();
    assert.deepEqual([md.width, md.height], [2000, 6000]);
    await assert.rejects(
      exportProject(c, p, path.join(parent, "cannot-claim-restorable.zip")),
      { code: "ZIP_LIMIT" },
    );
    await fs.writeFile(
      path.join(
        process.env.RETOUCH_TEST_ROOT!,
        "native-output-large-evidence.json",
      ),
      JSON.stringify({
        verdict: "PASS",
        actual_oversize_bytes: bytes.length,
        entry_limit: ZIP_LIMITS.entry,
        reject_no_target: true,
        oversized_sha256: bytesHash(bytes),
        split_not_supported: true,
        split_no_prepare_or_target: true,
        context_oversize_explicit: true,
        image_api_requests: 0,
      }) + "\n",
      { flag: "wx" },
    );
  },
);

test(
  "#12 cache: normal task closure changes revision but identical output exports reuse completed native derivatives",
  { skip: !entry, timeout: 180000 },
  async () => {
    const { parent, c, p, designTask, call, profile } = await fixture();
    const media = (
      await registerBytes(
        c,
        p,
        designTask.id,
        await sharp({
          create: { width: 40, height: 20, channels: 3, background: "#335577" },
        })
          .png()
          .toBuffer(),
        { role: "postprocess" },
        "cache-close-input",
      )
    ).artifact;
    const beforeTask = await c.call("task-view", {
      project: p,
      id: designTask.id,
    });
    const revision = beforeTask.task.meta.retouch.revision;
    const snapshot = (
      await call("suite-snapshot", {
        project: p,
        task: designTask.id,
        name: "cache after task close",
        expected_id: null,
        expected_revision: revision,
        slots: [
          {
            id: "p0",
            role: "synthetic design page",
            media_id: media.id,
            sha256: JSON.parse(media.meta).sha256,
          },
        ],
      })
    ).artifact;
    const base = profile(1, 80);
    const input = {
      mode: "preview",
      output_profile: {
        ...base,
        gallery: { ...base.gallery, size: 64, padding: 2 },
      },
    };
    const first = await exportSuite(
      c,
      p,
      snapshot.id,
      path.join(parent, "cache-before-close"),
      input,
      "cache-before-close",
    );
    const source = await c.call("show", { project: p, id: media.id });
    const select = (outputs: any) => [
      ...outputs.slots.flatMap((s: any) => [
        s.png.media_id,
        s.gallery.media_id,
        s.long_page.media_id,
      ]),
      outputs.long.media_id,
      outputs.reading.media_id,
      outputs.overview.media_id,
    ];
    const originalIds = select(first.outputs);
    const objectTimes = new Map<string, number>();
    for (const id of new Set(originalIds)) {
      const a = await c.call("show", { project: p, id });
      objectTimes.set(
        id,
        (await fs.stat(path.join(c.root, JSON.parse(a.meta).object_path)))
          .mtimeMs,
      );
    }
    const closed = await call("task-close", {
      project: p,
      task: designTask.id,
      expected_revision: revision,
      statement:
        "ISOLATED FIXTURE: linked native design completed, no real user acceptance",
    });
    assert.equal(JSON.parse(closed.task.meta).retouch.revision, revision + 1);
    assert.equal(JSON.parse(closed.task.meta).status, "done");
    const before = await c.call("snapshot", { project: p });
    const second = await exportSuite(
      c,
      p,
      snapshot.id,
      path.join(parent, "cache-after-close"),
      input,
      "cache-after-close",
    );
    assert.equal(second.image_api_requests, 0);
    assert.deepEqual(select(second.outputs), originalIds);
    const after = await c.call("snapshot", { project: p });
    for (const kind of ["media", "execution"])
      assert.equal(
        after.tables.artifacts.filter((a: any) => a.kind === kind).length,
        before.tables.artifacts.filter((a: any) => a.kind === kind).length,
      );
    assert.equal(
      after.tables.artifacts.filter((a: any) => a.kind === "delivery").length,
      before.tables.artifacts.filter((a: any) => a.kind === "delivery").length +
        1,
    );
    assert.equal(
      (await c.call("show", { project: p, id: media.id })).meta,
      source.meta,
    );
    for (const [id, time] of objectTimes) {
      const a = await c.call("show", { project: p, id });
      assert.equal(
        (await fs.stat(path.join(c.root, JSON.parse(a.meta).object_path)))
          .mtimeMs,
        time,
      );
    }
    const newEvents = after.tables.events.filter(
      (e: any) => !before.tables.events.some((old: any) => old.id === e.id),
    );
    assert.equal(
      newEvents.some(
        (e: any) =>
          e.kind === "retouch.command" &&
          ["postprocess-prepare", "postprocess-complete", "media"].includes(
            JSON.parse(e.payload).action,
          ),
      ),
      false,
    );
  },
);

test(
  "#12 review R1: completing execution A with real same-parent output B is rejected before any native completion write",
  { skip: !entry, timeout: 180000 },
  async () => {
    const { parent, c, p, task, image, call } = await fixture();
    const source = await image(40, 20, "#335577", "provenance-source");
    const view = await c.call("task-view", { project: p, id: task.id });
    const revision = view.task.meta.retouch.revision;
    const input = {
      input_id: source.id,
      inputs: [
        {
          id: source.id,
          sha256: JSON.parse(source.meta).sha256,
          role: "synthetic source shared by two operations",
        },
      ],
      operations: [
        {
          op: "resize",
          width: 40,
          height: 40,
          fit: "contain",
          background: "#aa0000",
        },
      ],
    };
    const other = await transform(
      c,
      p,
      task.id,
      input,
      revision,
      "provenance-operation-b",
    );
    const otherDescriptor = JSON.parse(other.execution.content);
    const descriptorA = {
      ...otherDescriptor,
      operations: [{ ...input.operations[0], background: "#ffffff" }],
    };
    const a = (
      await call("postprocess-prepare", {
        project: p,
        task: task.id,
        expected_revision: revision,
        descriptor: descriptorA,
      })
    ).execution;
    const bytes = await objectBytes(c.root, JSON.parse(other.artifact.meta));
    assert.equal(bytesHash(bytes), JSON.parse(other.artifact.meta).sha256);
    assert.ok(JSON.parse(other.artifact.meta).parents.includes(source.id));
    const before = await c.call("snapshot", { project: p });
    await assert.rejects(
      c.call(
        "postprocess-complete",
        { project: p, id: a.id, output: other.artifact.id },
        "provenance-wrong-completion",
      ),
      { code: "POSTPROCESS_PROVENANCE" },
    );
    const after = await c.call("snapshot", { project: p });
    assert.deepEqual(after.tables.artifacts, before.tables.artifacts);
    assert.deepEqual(after.tables.relations, before.tables.relations);
    assert.deepEqual(after.tables.events, before.tables.events);
    assert.equal(
      JSON.parse((await c.call("show", { project: p, id: a.id })).meta).status,
      "prepared",
    );
    assert.deepEqual(
      await c.call("receipt", { request_id: "provenance-wrong-completion" }),
      {},
    );
    const correct = await transform(
      c,
      p,
      task.id,
      { ...input, operations: descriptorA.operations },
      revision,
      "provenance-operation-a",
    );
    const proof = JSON.parse(correct.artifact.meta).transform;
    assert.equal(proof.execution_id, correct.execution.id);
    assert.deepEqual(
      proof.inputs,
      JSON.parse(correct.execution.content).inputs,
    );
    assert.equal(proof.trace[0].operation.background, "#ffffff");
    assert.equal(other.image_api_requests, 0);
    assert.equal(correct.image_api_requests, 0);
    assert.ok(parent, "all data belongs to the isolated native fixture");
  },
);
