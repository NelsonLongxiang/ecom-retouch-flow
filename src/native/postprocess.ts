import path from "node:path";
import sharp from "sharp";
import { NativeClient } from "./client.ts";
import { objectBytes, putObject, registerBytes } from "./files.ts";
import { readFont, fontInfo } from "./fonts.ts";
import { digest, assertNoCredentials } from "./plugin/commands.mjs";
import { requireThat } from "../domain/model.ts";
import { cropApproval } from "./plugin/output-profile.mjs";
export const renderingFingerprint = () => ({
  schema: "retouch.renderer/v1",
  versions: { ...sharp.versions },
  colourspace: "srgb",
  operations: "retouch-local/v1",
});
const xml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export async function registerFont(
  c: NativeClient,
  project: string,
  file: string,
  key: string,
) {
  const font = await readFont(file);
  return c.call(
    "font-resource",
    {
      project,
      title: font.family,
      family: font.family,
      ...(await putObject(c.root, font.bytes)),
    },
    key,
  );
}
const pixels = (w: any, h: any) =>
  requireThat(
    Number.isSafeInteger(w) &&
      Number.isSafeInteger(h) &&
      w > 0 &&
      h > 0 &&
      w * h <= 50_000_000,
    "TRANSFORM_DIMENSIONS",
    "实际画布须为有效整数且不超过5000万像素",
  );
function region(r: any, w: number, h: number, coords: any) {
  requireThat(
    r &&
      coords?.width === w &&
      coords?.height === h &&
      [r.x, r.y, r.width, r.height].every(Number.isSafeInteger) &&
      r.x >= 0 &&
      r.y >= 0 &&
      r.width > 0 &&
      r.height > 0 &&
      r.x + r.width <= w &&
      r.y + r.height <= h,
    "TRANSFORM_REGION",
    "裁切/修补区域须在明确的当前坐标系内",
  );
}
export async function transform(
  c: NativeClient,
  project: string,
  task: string,
  input: any,
  revision: number,
  key: string,
) {
  assertNoCredentials(input);
  requireThat(
    Array.isArray(input.inputs) &&
      input.inputs.length > 0 &&
      input.inputs.length <= 30 &&
      Array.isArray(input.operations) &&
      input.operations.length > 0 &&
      input.operations.length <= 40,
    "TRANSFORM",
    "须有全部输入职责与变换链",
  );
  const sources = new Map<string, { a: any; m: any; bytes: Buffer }>(),
    inputs = [];
  for (const i of input.inputs) {
    const a = await c.call("show", { project, id: i.id }),
      m = JSON.parse(a.meta);
    requireThat(
      ["media", "resource"].includes(a.kind) &&
        m.sha256 === i.sha256 &&
        typeof i.role === "string" &&
        i.role.trim(),
      "TRANSFORM_INPUT",
      "输入须绑定实际媒体/hash/职责",
    );
    sources.set(a.id, { a, m, bytes: await objectBytes(c.root, m) });
    inputs.push({ id: a.id, sha256: m.sha256, role: i.role });
  }
  requireThat(
    sources.size === inputs.length &&
      sources.get(input.input_id)?.a.kind === "media",
    "TRANSFORM_INPUT",
    "输入不得重复且主输入须为图像",
  );
  requireThat(
    input.operations.every(
      (op: any, index: number) =>
        op.op !== "encode" || index === input.operations.length - 1,
    ),
    "TRANSFORM_ENCODING",
    "encode必须是最后一步，避免后续像素操作静默丢失编码策略",
  );
  const approvedCrops = input.operations.filter(
    (op: any) =>
      op.op === "extract" &&
      (op.approval || op.source_media_id || op.source_sha256),
  );
  if (approvedCrops.length) {
    const view = await c.call("brief", { project });
    for (const op of approvedCrops) cropApproval(op, view.artifacts);
  }
  const used = new Set([input.input_id]);
  for (const op of input.operations) {
    requireThat(
      [
        "extract",
        "mask",
        "repair",
        "composite",
        "annotate",
        "resize",
        "extend",
        "encode",
      ].includes(op.op),
      "TRANSFORM_OPERATION",
      "不支持的本地变换",
    );
    if (op.input_id) {
      requireThat(
        sources.get(op.input_id)?.a.kind === "media",
        "TRANSFORM_INPUT",
        "图层/蒙版必须在输入清单中",
      );
      used.add(op.input_id);
    }
    if (op.op === "annotate") {
      requireThat(
        sources.get(op.font_id)?.m.role === "font",
        "FONT_MISSING",
        "文字操作必须指定已登记字体",
      );
      used.add(op.font_id);
    }
  }
  requireThat(
    inputs.every((i) => used.has(i.id)),
    "TRANSFORM_INPUT",
    "输入清单含未使用的素材",
  );
  const renderer = {
      ...renderingFingerprint(),
      ...(input.operations.some((op: any) =>
        ["extend", "encode"].includes(op.op),
      )
        ? { operations: "retouch-local/v2" }
        : {}),
    },
    descriptor = {
      schema: "retouch.postprocess/v1",
      input_id: input.input_id,
      inputs,
      operations: input.operations,
      renderer,
    };
  const prepare = () =>
    c.call(
      "postprocess-prepare",
      { project, task, expected_revision: revision, descriptor },
      key + ":prepare",
    );
  let ex: any = null;
  if ((await c.call("receipt", { request_id: key + ":prepare" }))?.result) {
    const prepared = await prepare();
    ex = await c.call("show", { project, id: prepared.execution.id });
    const em = JSON.parse(ex.meta);
    requireThat(
      digest(JSON.parse(ex.content)) === digest(descriptor),
      "RENDERER_DRIFT",
      "变换或渲染指纹已变化，不能重放为同一结果",
    );
    if (em.status === "completed")
      return {
        execution: ex,
        artifact: await c.call("show", { project, id: em.outputs[0] }),
        replayed: true,
        image_api_requests: 0,
      };
  }
  let bytes = await sharp(sources.get(input.input_id)!.bytes)
    .toColourspace("srgb")
    .ensureAlpha()
    .png()
    .toBuffer();
  const trace: any[] = [];
  for (const op of input.operations) {
    const before = await sharp(bytes).metadata(),
      w = before.width!,
      h = before.height!;
    if (op.op === "extract") {
      region(op.region, w, h, op.coordinate_system);
      bytes = await sharp(bytes)
        .extract({
          left: op.region.x,
          top: op.region.y,
          width: op.region.width,
          height: op.region.height,
        })
        .png()
        .toBuffer();
    }
    if (op.op === "resize") {
      pixels(op.width, op.height);
      requireThat(
        ["contain", "cover", "fill"].includes(op.fit) &&
          (op.fit !== "fill" || op.allow_distort === true),
        "TRANSFORM_ASPECT",
        "须明确比例策略，拉伸须显式allow_distort",
      );
      bytes = await sharp(bytes)
        .resize(op.width, op.height, {
          fit: op.fit,
          background: op.background ?? { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer();
    }
    if (op.op === "extend") {
      const sides = [op.top, op.bottom, op.left, op.right];
      requireThat(
        sides.every((n) => Number.isSafeInteger(n) && n >= 0) &&
          /^#[a-fA-F0-9]{6}$/.test(op.background),
        "TRANSFORM_EXTEND",
        "扩展画布须明确非负边距和RGB背景",
      );
      pixels(w + op.left + op.right, h + op.top + op.bottom);
      bytes = await sharp(bytes)
        .extend({
          top: op.top,
          bottom: op.bottom,
          left: op.left,
          right: op.right,
          background: op.background,
        })
        .png()
        .toBuffer();
    }
    if (op.op === "encode") {
      requireThat(
        ["png", "jpeg"].includes(op.format) && op.colourspace === "srgb",
        "TRANSFORM_ENCODING",
        "编码须明确PNG/JPEG和sRGB",
      );
      let image = sharp(bytes).toColourspace("srgb").withIccProfile("srgb");
      if (op.format === "jpeg") {
        requireThat(
          Number.isSafeInteger(op.quality) &&
            op.quality >= 1 &&
            op.quality <= 100 &&
            /^#[a-fA-F0-9]{6}$/.test(op.background),
          "TRANSFORM_ENCODING",
          "JPEG须明确质量与透明背景合成颜色",
        );
        image = image
          .flatten({ background: op.background })
          .jpeg({ quality: op.quality, chromaSubsampling: "4:4:4" });
      } else image = image.png();
      bytes = await image.toBuffer();
    }
    if (op.op === "repair") {
      region(op.region, w, h, op.coordinate_system);
      const patch = sources.get(op.input_id)!;
      requireThat(
        patch &&
          patch.m.width === op.region.width &&
          patch.m.height === op.region.height,
        "TRANSFORM_PATCH",
        "修补图须与批准矩形同尺寸",
      );
      const base = await sharp(bytes).ensureAlpha().raw().toBuffer(),
        p = await sharp(patch.bytes)
          .toColourspace("srgb")
          .ensureAlpha()
          .raw()
          .toBuffer();
      for (let y = 0; y < op.region.height; y++)
        p.copy(
          base,
          ((op.region.y + y) * w + op.region.x) * 4,
          y * op.region.width * 4,
          (y + 1) * op.region.width * 4,
        );
      bytes = await sharp(base, { raw: { width: w, height: h, channels: 4 } })
        .png()
        .toBuffer();
    }
    if (op.op === "mask") {
      const mask = sources.get(op.input_id)!;
      requireThat(
        mask && mask.m.width === w && mask.m.height === h,
        "TRANSFORM_MASK",
        "蒙版尺寸须与当前图像一致",
      );
      const base = await sharp(bytes).ensureAlpha().raw().toBuffer(),
        m = await sharp(mask.bytes)
          .toColourspace("srgb")
          .ensureAlpha()
          .raw()
          .toBuffer();
      for (let i = 0; i < base.length; i += 4)
        base[i + 3] = Math.round(
          (((base[i + 3] * m[i]) / 255) * m[i + 3]) / 255,
        );
      bytes = await sharp(base, { raw: { width: w, height: h, channels: 4 } })
        .png()
        .toBuffer();
    }
    if (op.op === "composite") {
      const layer = sources.get(op.input_id)!;
      requireThat(
        layer &&
          Number.isSafeInteger(op.x) &&
          Number.isSafeInteger(op.y) &&
          op.x >= 0 &&
          op.y >= 0 &&
          op.x + layer.m.width <= w &&
          op.y + layer.m.height <= h,
        "TRANSFORM_LAYER",
        "图层超出画布",
      );
      bytes = await sharp(bytes)
        .composite([
          { input: layer.bytes, left: op.x, top: op.y, blend: "over" },
        ])
        .png()
        .toBuffer();
    }
    if (op.op === "annotate") {
      const font = sources.get(op.font_id)!;
      requireThat(
        typeof op.text === "string" &&
          op.text.trim() &&
          op.text.length <= 2000 &&
          Number.isSafeInteger(op.font_size) &&
          op.font_size > 0 &&
          op.font_size <= 200 &&
          /^#[a-f0-9]{6}$/i.test(op.colour),
        "TRANSFORM_TEXT",
        "文字须有有限文本、字号和十六进制颜色",
      );
      region(op.region, w, h, op.coordinate_system);
      const info = fontInfo(font.bytes);
      info.assertText(op.text);
      const glyph = await sharp({
        text: {
          text:
            '<span foreground="' + op.colour + '">' + xml(op.text) + "</span>",
          font: info.family + " " + op.font_size,
          fontfile: path.join(c.root, font.m.object_path),
          width: op.region.width,
          dpi: 72,
          rgba: true,
          wrap: "word",
        },
      })
        .png()
        .toBuffer();
      const gm = await sharp(glyph).metadata();
      requireThat(
        gm.width! <= op.region.width && gm.height! <= op.region.height,
        "TRANSFORM_TEXT_BOUNDS",
        "文字超出批准的排版区域",
      );
      bytes = await sharp(bytes)
        .composite([{ input: glyph, left: op.region.x, top: op.region.y }])
        .png()
        .toBuffer();
    }
    const after = await sharp(bytes).metadata();
    pixels(after.width, after.height);
    trace.push({
      operation: op,
      from: { width: w, height: h },
      to: { width: after.width, height: after.height },
      outside_region_unchanged: op.op === "repair" ? true : null,
    });
  }
  if (!ex) {
    const prepared = await prepare();
    ex = await c.call("show", { project, id: prepared.execution.id });
  }
  const output = await registerBytes(
    c,
    project,
    task,
    bytes,
    {
      role: "postprocess",
      parents: inputs
        .filter((i) => sources.get(i.id)!.a.kind === "media")
        .map((i) => i.id),
      operation: "local declarative postprocess",
      transform: {
        schema: "retouch.postprocess/v1",
        execution_id: ex.id,
        inputs,
        renderer,
        trace,
      },
    },
    key + ":media",
  );
  const result = await c.call(
    "postprocess-complete",
    { project, id: ex.id, output: output.artifact.id },
    key + ":complete",
  );
  return { ...result, replayed: false, image_api_requests: 0 };
}
