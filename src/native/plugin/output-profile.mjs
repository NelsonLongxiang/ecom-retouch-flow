// Fixed suite output recipes; native spec/delivery remain the only authority.
import { digest } from "./value.mjs";
const meta = (a) => (typeof a.meta === "string" ? JSON.parse(a.meta) : a.meta);
function need(ok, code, message) {
  if (!ok) throw Object.assign(new Error(message), { code, rc: 2 });
}
const integer = (v, min, max, label) => {
  need(
    Number.isSafeInteger(v) && v >= min && v <= max,
    "OUTPUT_PROFILE",
    label + "超出范围",
  );
  return v;
};
const fields = (v, allowed) =>
  need(
    v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      Object.keys(v).every((k) => allowed.includes(k)),
    "OUTPUT_PROFILE",
    "输出配置有未知字段",
  );
const colour = (v) => {
  need(/^#[a-fA-F0-9]{6}$/.test(v), "OUTPUT_PROFILE", "背景须为明确RGB颜色");
  return v.toLowerCase();
};
function reference(v, artifacts, kind, historical = false) {
  fields(v, ["artifact_id", "version", "content_hash"]);
  const a = artifacts.find((a) => a.id === v.artifact_id);
  need(
    a &&
      (!kind || a.kind === kind) &&
      ["design", "spec", "citation"].includes(a.kind) &&
      a.version === v.version &&
      digest(a.content) === v.content_hash,
    "OUTPUT_SOURCE",
    "须绑定已读取原生文档的确切版本/hash",
  );
  need(
    historical ||
      a.kind === "citation" ||
      !artifacts.some(
        (x) =>
          x.kind === a.kind && x.title === a.title && x.version > a.version,
      ),
    "OUTPUT_SOURCE_STALE",
    "输出设计/批准来源已过期，先实际复核",
  );
  return a;
}
export function outputProfile(v, slots, artifacts, historical = false) {
  fields(v, [
    "schema",
    "design",
    "order",
    "crops",
    "gallery",
    "long",
    "reading",
    "overflow",
  ]);
  need(
    v.schema === "retouch.suite-output/v1",
    "OUTPUT_PROFILE",
    "不支持的输出配置",
  );
  reference(v.design, artifacts, "design", historical);
  need(
    slots.length > 0 &&
      slots.length <= 29 &&
      Array.isArray(v.order) &&
      v.order.length === slots.length &&
      new Set(v.order).size === slots.length &&
      v.order.every((id) => slots.some((s) => s.id === id)),
    "OUTPUT_ORDER",
    "须明确列出所选全部槽位的叙事顺序（最多29页）",
  );
  const crops = v.crops ?? {};
  need(
    crops &&
      typeof crops === "object" &&
      !Array.isArray(crops) &&
      Object.keys(crops).every((id) => v.order.includes(id)),
    "OUTPUT_CROP",
    "裁切须属于已声明槽位",
  );
  for (const [id, c] of Object.entries(crops)) {
    fields(c, ["region", "coordinate_system", "approval", "quote"]);
    const a = reference(c.approval, artifacts, null, historical);
    need(
      meta(a).role === "user-original" &&
        typeof c.quote === "string" &&
        c.quote.trim() &&
        a.content.includes(c.quote),
      "OUTPUT_CROP_APPROVAL",
      "裁切须有用户原文的精确批准来源",
    );
    const s = slots.find((s) => s.id === id),
      m = meta(artifacts.find((a) => a.id === s.media_id));
    fields(c.region, ["x", "y", "width", "height"]);
    fields(c.coordinate_system, ["width", "height"]);
    const r = c.region;
    need(
      c.coordinate_system.width === m.width &&
        c.coordinate_system.height === m.height &&
        [r.x, r.y, r.width, r.height].every(Number.isSafeInteger) &&
        r.x >= 0 &&
        r.y >= 0 &&
        r.width > 0 &&
        r.height > 0 &&
        r.x + r.width <= m.width &&
        r.y + r.height <= m.height,
      "OUTPUT_CROP",
      "裁切坐标须绑定原页尺寸并位于页内",
    );
  }
  fields(v.gallery, ["size", "padding", "background", "quality"]);
  fields(v.long, ["width", "gap", "background", "max_pixels"]);
  fields(v.reading, ["width", "quality"]);
  const size = integer(v.gallery.size, 16, 6000, "图库边长");
  const padding = integer(
    v.gallery.padding,
    0,
    Math.floor((size - 1) / 2),
    "图库留边",
  );
  const width = integer(v.long.width, 16, 6000, "长图宽度");
  const gap = integer(v.long.gap, 0, 1000, "页间距");
  const max_pixels = integer(v.long.max_pixels, 1, 50_000_000, "长图像素预算");
  const readingWidth = integer(v.reading.width, 16, width, "阅读图宽度");
  need(
    ["reject", "split"].includes(v.overflow),
    "OUTPUT_PROFILE",
    "超限策略须显式reject/split",
  );
  const pages = v.order.map((id) => {
    const s = slots.find((s) => s.id === id),
      m = meta(artifacts.find((a) => a.id === s.media_id)),
      crop = crops[id];
    const w = crop?.region.width ?? m.width,
      h = crop?.region.height ?? m.height;
    return {
      slot_id: id,
      width,
      height: Math.max(1, Math.round((h * width) / w)),
    };
  });
  const height =
    pages.reduce((n, p) => n + p.height, 0) + gap * (pages.length - 1);
  need(
    width * height <= max_pixels && width * height <= 50_000_000,
    "OUTPUT_PIXELS",
    "长图超过显式像素预算；降低宽度或分批快照，不静默裁切",
  );
  return {
    schema: v.schema,
    design: v.design,
    order: [...v.order],
    crops,
    gallery: {
      size,
      padding,
      background: colour(v.gallery.background),
      quality: integer(v.gallery.quality, 1, 100, "图库质量"),
    },
    long: { width, gap, background: colour(v.long.background), max_pixels },
    reading: {
      width: readingWidth,
      quality: integer(v.reading.quality, 1, 100, "阅读图质量"),
    },
    overflow: v.overflow,
    dimensions: { width, height, pages },
  };
}
