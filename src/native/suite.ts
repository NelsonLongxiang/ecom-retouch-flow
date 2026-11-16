import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import type { OverlayOptions } from "sharp";
import { NativeClient } from "./client.ts";
import { objectBytes, safeDirectory } from "./files.ts";
import { renderingFingerprint } from "./postprocess.ts";
import { exportOutputs } from "./outputs.ts";
import { digest } from "./plugin/commands.mjs";
import { writeZip, readZip } from "../infrastructure/zip.ts";
import { requireThat, RetouchError, bytesHash } from "../domain/model.ts";
export async function exportSuite(
  c: NativeClient,
  project: string,
  id: string,
  file: string,
  input: any,
  key: string,
) {
  if (input.output_profile)
    return exportOutputs(c, project, id, file, input, key);
  const target = path.resolve(file),
    parent = path.dirname(target),
    rel = path.relative(c.root, target),
    inverse = path.relative(target, c.root);
  requireThat(
    rel &&
      (rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) &&
      inverse &&
      (inverse.startsWith(".." + path.sep) || path.isAbsolute(inverse)),
    "DELIVERY_PATH",
    "图片包须导出到工作区之外",
  );
  requireThat(
    (await fs.realpath(parent)) === parent,
    "DELIVERY_LINK",
    "图片包父目录不得经链接改向",
  );
  const ps = await fs.stat(parent),
    prior = await c.call("receipt", { request_id: key + ":prepare" });
  const existing = await fs.lstat(target).catch((e) => {
    if (e.code === "ENOENT") return null;
    throw e;
  });
  requireThat(
    !existing ||
      (existing.isFile() && !existing.isSymbolicLink() && prior?.result),
    "DELIVERY_CONFLICT",
    "图片包目标已存在或为链接",
  );
  const prepared = await c.call(
    "suite-export-prepare",
    {
      project,
      id,
      file: target,
      mode: input.mode,
      from_id: input.from_id ?? null,
      renderer: renderingFingerprint(),
    },
    key + ":prepare",
  );
  const delivery = await c.call("show", { project, id: prepared.delivery.id }),
    dm = JSON.parse(delivery.meta);
  if (dm.status === "completed") {
    requireThat(
      existing && bytesHash(await fs.readFile(target)) === dm.package_sha256,
      "PACKAGE_MISSING",
      "已发布图片包丢失或变化；保留原回执，不覆盖文件",
    );
    return { delivery, file: target, replayed: true, image_api_requests: 0 };
  }
  const staged = path.join(
    await safeDirectory(c.root, "tmp/suite-export"),
    crypto.randomUUID() + ".zip",
  );
  try {
    const frozen = JSON.parse(delivery.content),
      slots = frozen.slots,
      entries = new Map<string, Buffer>();
    const tile = 256,
      gap = 16,
      columns = Math.min(3, slots.length),
      rows = Math.ceil(slots.length / columns),
      layers: OverlayOptions[] = [];
    const list = [];
    for (let n = 0; n < slots.length; n++) {
      const slot = slots[n],
        a = await c.call("show", { project, id: slot.media_id }),
        m = JSON.parse(a.meta),
        bytes = await objectBytes(c.root, m);
      requireThat(
        m.sha256 === slot.sha256,
        "SUITE_MEDIA",
        "图片包素材hash已变化",
      );
      const extension =
        m.mime === "image/jpeg"
          ? "jpg"
          : m.mime === "image/webp"
            ? "webp"
            : "png";
      const name =
        "images/" +
        String(n + 1).padStart(2, "0") +
        "__" +
        slot.id +
        "." +
        extension;
      entries.set(name, bytes);
      const left = (n % columns) * (tile + gap) + gap,
        top = Math.floor(n / columns) * (tile + gap) + gap;
      layers.push({
        input: await sharp(bytes)
          .resize(tile, tile, { fit: "contain", background: "#eeeeee" })
          .png()
          .toBuffer(),
        left,
        top,
      });
      list.push({
        ...slot,
        file: name,
        bytes: bytes.length,
        overview: { left, top, width: tile, height: tile },
      });
    }
    const overview = await sharp({
      create: {
        width: columns * (tile + gap) + gap,
        height: rows * (tile + gap) + gap,
        channels: 4,
        background: "#eeeeee",
      },
    })
      .composite(layers)
      .png()
      .toBuffer();
    entries.set("overview.png", overview);
    const manifest = {
      schema:
        input.mode === "preview"
          ? "retouch.image-preview/v1"
          : "retouch.image-delivery/v1",
      restorable_workspace: false,
      project_id: prepared.snapshot.project_id,
      snapshot_id: id,
      snapshot_version: prepared.snapshot.version,
      snapshot_hash: frozen.snapshot_hash,
      series: JSON.parse(prepared.snapshot.content).name,
      selection: frozen.from_id ? "delta" : "full",
      from_snapshot_id: frozen.from_id,
      image_count: slots.length,
      slots: list,
      renderer: frozen.renderer,
      overview_sha256: bytesHash(overview),
    };
    entries.set(
      "manifest.json",
      Buffer.from(JSON.stringify(manifest, null, 2) + "\n"),
    );
    await writeZip(staged, entries);
    const checked = await readZip(staged);
    requireThat(
      checked.size === entries.size &&
        [...entries].every(
          ([k, b]) =>
            checked.has(k) && bytesHash(checked.get(k)!) === bytesHash(b),
        ),
      "SUITE_PACKAGE",
      "图片包回读校验失败",
    );
    const beforePublish = await fs.stat(parent);
    requireThat(
      beforePublish.ino === ps.ino &&
        beforePublish.dev === ps.dev &&
        (await fs.realpath(parent)) === parent,
      "DELIVERY_PATH_CHANGED",
      "图片包发布前目录已变化",
    );
    const archiveHash = bytesHash(await fs.readFile(staged));
    if (existing)
      requireThat(
        bytesHash(await fs.readFile(target)) === archiveHash,
        "DELIVERY_CONFLICT",
        "同键恢复不得覆盖不同内容的图片包",
      );
    else {
      try {
        await fs.link(staged, target);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
        await fs.copyFile(staged, target, constants.COPYFILE_EXCL);
      }
    }
    const afterPublish = await fs.stat(parent);
    requireThat(
      afterPublish.ino === ps.ino &&
        afterPublish.dev === ps.dev &&
        !(await fs.lstat(target)).isSymbolicLink() &&
        bytesHash(await fs.readFile(target)) === archiveHash &&
        (await fs.realpath(parent)) === parent,
      "DELIVERY_PATH_CHANGED",
      "图片包发布结果发生变化",
    );
    const result = await c.call(
      "suite-export-complete",
      { project, id: delivery.id, sha256: archiveHash },
      key + ":complete",
    );
    return {
      ...result,
      file: target,
      snapshot_id: id,
      manifest,
      replayed: false,
      image_api_requests: 0,
    };
  } catch (e) {
    throw new RetouchError(
      (e as any).code ?? "SUITE_EXPORT",
      "套图导出准备已登记；保留现场，使用同键同路径恢复，不能覆盖不同内容。",
      1,
      { delivery_id: delivery.id, cause: (e as any).code ?? "IO" },
      "committed",
    );
  } finally {
    await fs.unlink(staged).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
  }
}
