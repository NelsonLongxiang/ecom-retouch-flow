import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { registerBytes } from "../src/native/files.ts";
import { exportProject, importProject } from "../src/native/exchange.ts";
import { outputFixture } from "./helpers/output-fixture.ts";
import { exportSuite } from "../src/native/suite.ts";
import { digest } from "../src/native/plugin/commands.mjs";
import { readZip, writeZip } from "../src/infrastructure/zip.ts";
import { bytesHash } from "../src/domain/model.ts";

const entry = process.env.RETOUCH_TEST_YGL_ENTRY;
const options = { skip: !entry, timeout: 180000 };
function smallProfile(profile: any) {
  return {
    ...profile,
    gallery: { size: 64, padding: 2, background: "#ffffff", quality: 85 },
  };
}

test(
  "#12 continuation: published verified components resume completion without rendering or staging",
  options,
  async () => {
    const { c, p, parent, image, snapshot, profile } = await outputFixture();
    const media = await image(40, 20, "#123456", "input");
    const snap = await snapshot("recovery-only", [media]);
    const input = {
        mode: "preview",
        output_profile: smallProfile(profile(1, 80)),
      },
      target = path.join(parent, "published");
    const call = c.call.bind(c);
    let fail = true;
    c.call = async (...args: Parameters<typeof c.call>) => {
      if (args[0] === "suite-export-complete" && fail) {
        fail = false;
        throw new Error("synthetic lost completion request");
      }
      return call(...args);
    };
    try {
      await assert.rejects(
        exportSuite(c, p, snap.id, target, input, "published"),
        (e: any) => e.effectStatus === "committed",
      );
    } finally {
      c.call = call;
    }
    const componentFile = path.join(target, "components.json"),
      zipFile = path.join(target, "review.zip");
    const marker = await fs.readFile(componentFile),
      zip = await fs.readFile(zipFile),
      before = await fs.stat(zipFile);
    const records = (await call("snapshot", { project: p })).tables.artifacts
      .length;
    const attempts: string[] = [];
    c.call = async (...args: Parameters<typeof c.call>) => {
      if (
        ["postprocess-prepare", "postprocess-complete", "media"].includes(
          args[0],
        )
      ) {
        attempts.push(args[0]);
        throw new Error("recovery must not render");
      }
      return call(...args);
    };
    const prepared = await call("receipt", { request_id: "published:prepare" });
    const sealed = JSON.parse(
      (await call("show", { project: p, id: prepared.result.delivery.id }))
        .meta,
    ).sealed_output;
    assert.equal(sealed.sha256, bytesHash(zip));
    const forged = await readZip(zipFile);
    forged.set(
      "README.md",
      Buffer.from(
        "self-consistent disk forgery must not authorize native completion",
      ),
    );
    const altered = path.join(parent, "forged.zip");
    await writeZip(altered, forged);
    const alteredBytes = await fs.readFile(altered);
    const markerObject = JSON.parse(marker.toString());
    markerObject.files[0].sha256 = bytesHash(alteredBytes);
    markerObject.files[0].bytes = alteredBytes.length;
    await fs.writeFile(zipFile, alteredBytes);
    await fs.writeFile(componentFile, JSON.stringify(markerObject));
    try {
      await assert.rejects(
        exportSuite(c, p, snap.id, target, input, "published"),
        (e: any) =>
          e.code === "OUTPUT_SEAL_CONFLICT" && e.effectStatus === "committed",
      );
    } finally {
      await fs.writeFile(zipFile, zip);
      await fs.writeFile(componentFile, marker);
    }
    const restoredMtime = (await fs.stat(zipFile)).mtimeMs;
    let recovered: any;
    try {
      recovered = await exportSuite(c, p, snap.id, target, input, "published");
    } finally {
      c.call = call;
    }
    assert.deepEqual(attempts, []);
    assert.equal(recovered.replayed, false);
    assert.equal(recovered.image_api_requests, 0);
    assert.equal(JSON.parse(recovered.delivery.meta).status, "completed");
    assert.deepEqual(await fs.readFile(componentFile), marker);
    assert.deepEqual(await fs.readFile(zipFile), zip);
    assert.equal((await fs.stat(zipFile)).mtimeMs, restoredMtime);
    assert.equal(
      (await call("snapshot", { project: p })).tables.artifacts.length,
      records,
    );
  },
);

test(
  "#12 continuation: equal-pixel crops with different approvals retain distinct native provenance",
  options,
  async () => {
    const { c, p, parent, image, snapshot, profile, call, designTask } =
      await outputFixture();
    const media = await image(100, 50, "#aabbcc", "input"),
      snap = await snapshot("crop-provenance", [media]);
    const approval = async (title: string) =>
      (
        await call("document", {
          project: p,
          task: designTask.id,
          kind: "spec",
          title,
          role: "user-original",
          source: "ISOLATED FIXTURE",
          content: "Approve the left 50 by 50 crop for this synthetic image.",
        })
      ).artifact;
    const a = await approval("Approval A"),
      b = await approval("Approval B");
    const input = (source: any) => ({
      mode: "preview",
      output_profile: {
        ...smallProfile(profile(1, 80)),
        crops: {
          p0: {
            region: { x: 0, y: 0, width: 50, height: 50 },
            coordinate_system: { width: 100, height: 50 },
            approval: {
              artifact_id: source.id,
              version: source.version,
              content_hash: digest(source.content),
            },
            quote: "Approve the left 50 by 50 crop for this synthetic image.",
          },
        },
      },
    });
    const first = await exportSuite(
      c,
      p,
      snap.id,
      path.join(parent, "crop-a"),
      input(a),
      "crop-a",
    );
    const second = await exportSuite(
      c,
      p,
      snap.id,
      path.join(parent, "crop-b"),
      input(b),
      "crop-b",
    );
    const x = first.outputs.slots[0].long_page,
      y = second.outputs.slots[0].long_page;
    assert.notEqual(
      x.media_id,
      y.media_id,
      "changed approval must not inherit old execution provenance",
    );
    assert.equal(
      x.sha256,
      y.sha256,
      "identical pixels may share CAS bytes without sharing approval facts",
    );
    for (const [page, source] of [
      [x, a],
      [y, b],
    ]) {
      const actual = await c.call("show", { project: p, id: page.media_id }),
        meta = JSON.parse(actual.meta);
      const op = meta.transform.trace.find(
        (step: any) => step.operation.op === "extract",
      ).operation;
      assert.deepEqual(
        op.approval,
        input(source).output_profile.crops.p0.approval,
      );
      assert.equal(op.source_media_id, media.id);
      assert.equal(op.source_sha256, JSON.parse(media.meta).sha256);
      const execution = await c.call("show", {
        project: p,
        id: meta.transform.execution_id,
      });
      assert.equal(
        JSON.parse(execution.content).operations[0].approval.artifact_id,
        source.id,
      );
    }
    assert.equal(
      (await c.call("suite-view", { project: p, id: snap.id })).slots[0]
        .accepted,
      false,
    );
  },
);

test(
  "#12 continuation: partial marker publication, EXDEV and concurrently created empty targets preserve recovery and no-replace",
  // Whole multi-step native scenario budget; individual CLI caps/assertions unchanged.
  { ...options, timeout: 600000 },
  async (t) => {
    const { c, p, parent, image, snapshot, profile } = await outputFixture();
    const media = await image(40, 20, "#335577", "input"),
      snap = await snapshot("publication-boundaries", [media]);
    const input = {
      mode: "preview",
      output_profile: smallProfile(profile(1, 80)),
    };
    const nativeLink = fs.link.bind(fs),
      target = path.join(parent, "partial");
    const marker = path.join(target, "components.json");
    let interrupted = false;
    t.mock.method(fs, "link", async (source: any, destination: any) => {
      if (String(destination) === marker && !interrupted) {
        interrupted = true;
        throw Object.assign(new Error("synthetic marker write interruption"), {
          code: "EIO",
        });
      }
      return nativeLink(source, destination);
    });
    try {
      await assert.rejects(
        exportSuite(c, p, snap.id, target, input, "partial"),
        (e: any) => e.code === "EIO" && e.effectStatus === "committed",
      );
    } finally {
      t.mock.restoreAll();
    }
    const zip = await fs.readFile(path.join(target, "review.zip")),
      mtime = (await fs.stat(path.join(target, "review.zip"))).mtimeMs;
    await assert.rejects(fs.lstat(marker), { code: "ENOENT" });
    const recovered = await exportSuite(
      c,
      p,
      snap.id,
      target,
      input,
      "partial",
    );
    assert.equal(JSON.parse(recovered.delivery.meta).status, "completed");
    assert.deepEqual(await fs.readFile(path.join(target, "review.zip")), zip);
    assert.equal(
      (await fs.stat(path.join(target, "review.zip"))).mtimeMs,
      mtime,
    );
    assert.deepEqual(
      await fs.readdir(path.join(c.root, "tmp/suite-outputs")),
      [],
    );

    const cross = path.join(parent, "cross-volume");
    t.mock.method(fs, "link", async (source: any, destination: any) => {
      if (path.dirname(String(destination)) === cross)
        throw Object.assign(new Error("synthetic EXDEV"), { code: "EXDEV" });
      return nativeLink(source, destination);
    });
    try {
      await assert.rejects(
        exportSuite(c, p, snap.id, cross, input, "cross-volume"),
        (e: any) => e.code === "EXDEV" && e.effectStatus === "committed",
      );
    } finally {
      t.mock.restoreAll();
    }
    assert.deepEqual(await fs.readdir(cross), []);
    await assert.rejects(fs.lstat(path.join(cross, "components.json")), {
      code: "ENOENT",
    });
    assert.equal(
      JSON.parse(
        (await exportSuite(c, p, snap.id, cross, input, "cross-volume"))
          .delivery.meta,
      ).status,
      "completed",
    );

    const race = path.join(parent, "raced-empty"),
      nativeMkdir = fs.mkdir.bind(fs);
    let raced = false;
    t.mock.method(fs, "mkdir", async (target: any, options: any) => {
      if (String(target) === race && !raced) {
        raced = true;
        await nativeMkdir(target);
      }
      return nativeMkdir(target, options);
    });
    try {
      await assert.rejects(
        exportSuite(c, p, snap.id, race, input, "raced-empty"),
        (e: any) => e.code === "EEXIST" && e.effectStatus === "committed",
      );
    } finally {
      t.mock.restoreAll();
    }
    assert.deepEqual(await fs.readdir(race), []);
    const existingEmpty = path.join(parent, "existing-empty");
    await fs.mkdir(existingEmpty);
    await assert.rejects(
      exportSuite(c, p, snap.id, existingEmpty, input, "existing-empty"),
      { code: "DELIVERY_CONFLICT" },
    );
    assert.deepEqual(await fs.readdir(existingEmpty), []);
    assert.equal(
      (await c.call("receipt", { request_id: "existing-empty:prepare" }))
        .result,
      undefined,
    );
    assert.deepEqual(
      await fs.readdir(path.join(c.root, "tmp/suite-outputs")),
      [],
    );
    await fs.writeFile(
      path.join(
        process.env.RETOUCH_TEST_ROOT!,
        "native-output-recovery-evidence.json",
      ),
      JSON.stringify({
        verdict: "PASS",
        scope: "isolated native outputs only",
        partial_marker_recovery: true,
        exdev_no_copy_fallback: true,
        concurrent_empty_target_preserved: true,
        real_image_requests: 0,
      }) + "\n",
      { flag: "wx" },
    );
  },
);

test(
  "#12 continuation: raw EXIF coordinate frame and JPEG alpha flattening are verified from actual pixels",
  // Whole multi-step native scenario budget; individual CLI caps/assertions unchanged.
  { ...options, timeout: 600000 },
  async () => {
    const { c, p, parent, task, snapshot, profile, call, designTask } =
      await outputFixture();
    const pixels = Buffer.alloc(40 * 20 * 3);
    for (let y = 0; y < 20; y++)
      for (let x = 0; x < 40; x++) {
        const at = (y * 40 + x) * 3;
        pixels[at] = x < 20 ? 255 : 0;
        pixels[at + 1] = x < 20 ? 0 : 255;
      }
    const oriented = await sharp(pixels, {
      raw: { width: 40, height: 20, channels: 3 },
    })
      .jpeg({ quality: 100, chromaSubsampling: "4:4:4" })
      .withMetadata({ orientation: 6 })
      .toBuffer();
    assert.equal((await sharp(oriented).metadata()).orientation, 6);
    const a = (
      await registerBytes(
        c,
        p,
        task.id,
        oriented,
        { role: "postprocess" },
        "oriented",
      )
    ).artifact;
    const approval = (
      await call("document", {
        project: p,
        task: designTask.id,
        kind: "spec",
        title: "Raw coordinates",
        content:
          "Crop x0 y0 width20 height20 in the encoded 40 by 20 pixel frame, not rotated display coordinates.",
        role: "user-original",
        source: "ISOLATED FIXTURE",
      })
    ).artifact;
    const crop = {
      region: { x: 0, y: 0, width: 20, height: 20 },
      coordinate_system: { width: 40, height: 20 },
      approval: {
        artifact_id: approval.id,
        version: approval.version,
        content_hash: digest(approval.content),
      },
      quote:
        "Crop x0 y0 width20 height20 in the encoded 40 by 20 pixel frame, not rotated display coordinates.",
    };
    const snap = await snapshot("raw-coordinate-frame", [a]);
    const input = {
      mode: "preview",
      output_profile: { ...smallProfile(profile(1, 80)), crops: { p0: crop } },
    };
    const wrong = {
      ...input,
      output_profile: {
        ...input.output_profile,
        crops: {
          p0: { ...crop, coordinate_system: { width: 20, height: 40 } },
        },
      },
    };
    await assert.rejects(
      exportSuite(
        c,
        p,
        snap.id,
        path.join(parent, "wrong-frame"),
        wrong,
        "wrong-frame",
      ),
      { code: "OUTPUT_CROP" },
    );
    const result = await exportSuite(
      c,
      p,
      snap.id,
      path.join(parent, "raw-frame"),
      input,
      "raw-frame",
    );
    const files = await readZip(path.join(parent, "raw-frame/review.zip"));
    const png = await sharp(
      files.get(result.outputs.slots[0].png.file)!,
    ).metadata();
    assert.deepEqual([png.width, png.height], [40, 20]);
    assert.equal(png.orientation, undefined);
    const raw = await sharp(files.get("long-hd.png")!)
      .removeAlpha()
      .raw()
      .toBuffer();
    const center = (40 * 80 + 40) * 3;
    assert.ok(raw[center] > 240 && raw[center + 1] < 15);
    const alpha = await sharp({
      create: {
        width: 16,
        height: 16,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
    const transparent = (
      await registerBytes(
        c,
        p,
        task.id,
        alpha,
        { role: "postprocess" },
        "alpha",
      )
    ).artifact;
    const as = await snapshot("alpha-background", [transparent]),
      ap = smallProfile(profile(1, 80));
    ap.gallery.background = "#204060";
    const flattened = await exportSuite(
      c,
      p,
      as.id,
      path.join(parent, "alpha"),
      { mode: "preview", output_profile: ap },
      "alpha",
    );
    const alphaFiles = await readZip(path.join(parent, "alpha/review.zip")),
      jpeg = alphaFiles.get(flattened.outputs.slots[0].gallery.file)!;
    const md = await sharp(jpeg).metadata();
    assert.equal(md.hasAlpha, false);
    assert.equal(md.space, "srgb");
    assert.ok(md.icc?.length);
    const rgb = await sharp(jpeg).raw().toBuffer();
    for (let i = 0; i < 3; i++)
      assert.ok(Math.abs(rgb[(32 * 64 + 32) * 3 + i] - [32, 64, 96][i]) <= 3);
    const zip = path.join(parent, "provenance-context.zip");
    await exportProject(c, p, zip);
    const clone = await importProject(zip, c.root, {
      strategy: "clone",
      name: "Coordinate provenance clone",
    });
    await exportProject(
      c,
      clone.project_id,
      path.join(parent, "clone-context.zip"),
    );
    const cloned = await c.call("brief", { project: clone.project_id });
    assert.ok(
      cloned.artifacts.some(
        (a: any) => JSON.parse(a.meta).source_sealed_output,
      ),
    );
  },
);
