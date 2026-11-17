// Current-SKU input completeness and deterministic final product-layer protection.
// Native specs/media/executions remain authoritative; this is not a geometry detector.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
// Ordinary metadata/dispatch commands do not load the native image library.
let sharpPromise;
const loadSharp = () =>
  (sharpPromise ??= import("sharp").then((module) => module.default));
import { digest, stable } from "./value.mjs";
const meta = (a) => (typeof a.meta === "string" ? JSON.parse(a.meta) : a.meta);
const body = (a) =>
  typeof a.content === "string" ? JSON.parse(a.content) : a.content;
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const productRenderer = (versions) => ({
  schema: "retouch.product-renderer/v1",
  versions: { ...versions },
  algorithm: "deterministic-product-composite/v1",
  colourspace: "srgb",
  resample: "lanczos3",
});
const need = (ok, code, message) => {
  if (!ok) throw Object.assign(new Error(message), { code, rc: 2 });
};
const fields = (v, keys) =>
  need(
    v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      Object.keys(v).every((k) => keys.includes(k)),
    "PRODUCT_CONTRACT",
    "商品一致性契约含未知字段或不是对象",
  );
const words = (v, label) =>
  need(
    typeof v === "string" && v.trim() && v.length <= 4000,
    "PRODUCT_CONTRACT",
    label + "须为有限非空文字",
  );
const media = (ref, artifacts) => {
  fields(ref, ["media_id", "sha256"]);
  const a = artifacts.find((a) => a.id === ref.media_id && a.kind === "media");
  need(
    a && meta(a).sha256 === ref.sha256 && /^[a-f0-9]{64}$/.test(ref.sha256),
    "PRODUCT_MEDIA",
    "商品母版/蒙版须绑定实际原生媒体hash",
  );
  return a;
};
function source(ref, artifacts, historical) {
  fields(ref, ["artifact_id", "version", "content_hash", "quote"]);
  const a = artifacts.find(
    (a) =>
      a.id === ref.artifact_id &&
      ["spec", "design", "citation"].includes(a.kind),
  );
  need(
    a &&
      a.version === ref.version &&
      digest(a.content) === ref.content_hash &&
      typeof ref.quote === "string" &&
      ref.quote.trim() &&
      a.content.includes(ref.quote),
    "PRODUCT_SOURCE",
    "商品依据须绑定已读原生文档精确版本/hash/摘录",
  );
  need(
    historical ||
      a.kind === "citation" ||
      !artifacts.some(
        (x) =>
          x.kind === a.kind && x.title === a.title && x.version > a.version,
      ),
    "PRODUCT_SOURCE_STALE",
    "商品依据已更新，先复核一致性契约",
  );
  return a;
}
function rect(r, w, h) {
  fields(r, ["x", "y", "width", "height"]);
  need(
    [r.x, r.y, r.width, r.height].every(Number.isSafeInteger) &&
      r.x >= 0 &&
      r.y >= 0 &&
      r.width > 0 &&
      r.height > 0 &&
      r.x + r.width <= w &&
      r.y + r.height <= h,
    "PRODUCT_VISIBLE_REGION",
    "必证可见区须在母版坐标内",
  );
}
export function productConsistency(v, items, artifacts, historical = false) {
  fields(v, [
    "schema",
    "sku",
    "master",
    "basis",
    "view",
    "qualification",
    "route",
    "immutable_ids",
    "must_prove_ids",
    "allowed_changes",
    "mask",
    "visible_regions",
    "compositions",
  ]);
  need(
    v.schema === "retouch.product-consistency/v1",
    "PRODUCT_CONTRACT",
    "商品一致性schema无效",
  );
  words(v.sku, "当前SKU");
  words(v.view, "相容视角");
  words(v.qualification, "母版合格依据");
  const original = media(v.master, artifacts),
    m = meta(original),
    basis = source(v.basis, artifacts, historical);
  need(
    ["original", "reference", "postprocess", "candidate"].includes(m.role) &&
      basis.kind !== "citation" &&
      ["user-original", "confirmed-fact"].includes(meta(basis).role) &&
      v.basis.quote.includes(v.sku) &&
      v.basis.quote.includes(v.master.sha256) &&
      v.basis.quote.includes(v.view) &&
      v.basis.quote.includes(v.qualification),
    "PRODUCT_MASTER_QUALIFICATION",
    "母版须有当前SKU及确切hash的可靠合格依据；旧生成图不能仅凭ID升为真值",
  );
  need(
    ["reference", "whole-image", "protected-layer"].includes(v.route),
    "PRODUCT_ROUTE",
    "首版仅支持参考相容视角、整图软参考或确定性产品层路线",
  );
  for (const key of ["immutable_ids", "must_prove_ids"])
    need(
      Array.isArray(v[key]) &&
        v[key].length > 0 &&
        new Set(v[key]).size === v[key].length &&
        v[key].every((id) => items.some((i) => i.id === id && i.required)),
      "PRODUCT_CONTRACT",
      "不可变/必证项须引用当前规范的必检保持项",
    );
  need(
    Array.isArray(v.allowed_changes) &&
      v.allowed_changes.length <= 12 &&
      new Set(v.allowed_changes.map((x) => x.kind)).size ===
        v.allowed_changes.length,
    "PRODUCT_CONTRACT",
    "允许成像变化须为不重复有限清单",
  );
  for (const change of v.allowed_changes) {
    fields(change, ["kind", "conditions"]);
    need(
      [
        "position",
        "uniform-scale",
        "lighting",
        "approved-colour",
        "occlusion",
        "supported-view",
      ].includes(change.kind),
      "PRODUCT_CONTRACT",
      "未知允许变换",
    );
    words(change.conditions, "允许条件");
  }
  if (v.route === "protected-layer") {
    need(
      v.allowed_changes.every((c) =>
        ["position", "uniform-scale", "occlusion"].includes(c.kind),
      ),
      "PRODUCT_TRANSFORM_UNSUPPORTED",
      "首版产品层仅实现平移/等比缩放/显式遮挡；光照/调色/透视须另验证，不冒称已保护",
    );
    need(
      Array.isArray(v.compositions) &&
        v.compositions.length > 0 &&
        v.compositions.length <= 12 &&
        new Set(v.compositions.map((r) => r.id)).size === v.compositions.length,
      "PRODUCT_COMPOSITION",
      "产品层须预先冻结有限合成配方",
    );
    for (const r of v.compositions) {
      fields(r, [
        "id",
        "canvas_width",
        "canvas_height",
        "x",
        "y",
        "width",
        "height",
        "foreground",
        "encoding",
      ]);
      words(r.id, "合成配方ID");
      need(
        Number.isSafeInteger(r.canvas_width) &&
          Number.isSafeInteger(r.canvas_height) &&
          r.canvas_width > 0 &&
          r.canvas_height > 0 &&
          r.canvas_width * r.canvas_height <= 50_000_000,
        "PRODUCT_COMPOSITION",
        "合成配方须有有限画布",
      );
      rect(
        { x: r.x, y: r.y, width: r.width, height: r.height },
        r.canvas_width,
        r.canvas_height,
      );
      need(
        r.width * m.height === r.height * m.width,
        "PRODUCT_SCALE",
        "预声明产品层配方不许拉伸",
      );
      if (r.foreground) {
        const front = media(r.foreground, artifacts);
        need(
          meta(front).width === r.canvas_width &&
            meta(front).height === r.canvas_height,
          "PRODUCT_OCCLUSION",
          "配方前景须与画布同尺寸",
        );
      }
      fields(r.encoding, ["format", "quality", "background"]);
      need(
        ["png", "jpeg"].includes(r.encoding.format) &&
          (r.encoding.format !== "jpeg" ||
            (Number.isSafeInteger(r.encoding.quality) &&
              r.encoding.quality >= 1 &&
              r.encoding.quality <= 100 &&
              /^#[a-fA-F0-9]{6}$/.test(r.encoding.background))),
        "PRODUCT_ENCODING",
        "配方编码须明确有限",
      );
    }
    const mask = media(v.mask, artifacts),
      mm = meta(mask);
    need(
      mask.project_id === original.project_id &&
        mm.width === m.width &&
        mm.height === m.height &&
        mm.parents?.includes(original.id),
      "PRODUCT_MASK",
      "产品蒙版须同母版坐标且保留母版父链",
    );
    need(
      v.basis.quote.includes(v.mask.sha256),
      "PRODUCT_MASK",
      "产品层依据须同时钉住已审阅蒙版hash",
    );
    need(
      Array.isArray(v.visible_regions) &&
        v.visible_regions.length > 0 &&
        v.visible_regions.length <= 20,
      "PRODUCT_VISIBLE_REGION",
      "产品层须预先声明不能被透明化/道具遮住的必证区域",
    );
    need(
      v.must_prove_ids.every((id) =>
        v.visible_regions.some((r) => r.item_id === id),
      ),
      "PRODUCT_VISIBLE_REGION",
      "每个必证项须声明可见区域，不能用无关小区域代替",
    );
    for (const r of v.visible_regions) {
      fields(r, ["item_id", "x", "y", "width", "height"]);
      need(
        v.must_prove_ids.includes(r.item_id),
        "PRODUCT_VISIBLE_REGION",
        "可见区域须绑定当前必证保持项",
      );
      const { item_id, ...area } = r;
      rect(area, m.width, m.height);
    }
  } else
    need(
      v.mask === undefined &&
        v.visible_regions === undefined &&
        v.compositions === undefined,
      "PRODUCT_CONTRACT",
      "非产品层路线不能声明已保护蒙版",
    );
  return structuredClone(v);
}
const invariantFor = (artifacts, taskId) =>
  artifacts
    .filter(
      (a) =>
        a.kind === "spec" &&
        meta(a).role === "product-invariants" &&
        meta(a).task_id === taskId,
    )
    .sort((a, b) => a.version - b.version)
    .at(-1);
export function productPlan(
  artifacts,
  steps,
  purpose,
  taskId,
  inputId,
  historical = false,
) {
  for (const step of steps) {
    for (const reference of step.references ?? [])
      if (reference.role === "product-structure")
        need(
          reference.purpose === "product-structure",
          "PRODUCT_REFERENCE_ROLE",
          "结构参考用途须使用固定product-structure职责，不能拼入相反自由用途",
        );
  }
  const invariant = invariantFor(artifacts, taskId),
    v = invariant && body(invariant).product_consistency;
  need(
    purpose !== "product-accurate" || v,
    "PRODUCT_CONTRACT_REQUIRED",
    "实物准确计划须先声明当前SKU商品一致性/必检契约",
  );
  if (!v) return null;
  const consistency = productConsistency(
    v,
    body(invariant).items,
    artifacts,
    historical,
  );
  const frozen = {
    contract_id: invariant.id,
    version: invariant.version,
    content_hash: digest(invariant.content),
    consistency,
  };
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    if (consistency.route === "protected-layer")
      need(
        !step.region,
        "PRODUCT_ROUTE",
        "首版产品层使用全图环境候选后确定性合成，不把固定旧轮廓区域合成当产品锁定",
      );
    else
      need(
        (index === 0 &&
          inputId === consistency.master.media_id &&
          step.input_role === "product-structure") ||
          (step.references ?? []).some(
            (r) =>
              r.media_id === consistency.master.media_id &&
              r.role === "product-structure",
          ),
        "PRODUCT_REFERENCE_REQUIRED",
        "每一步须实际携带当前商品母版且声明product-structure职责；历史登记或颜色参考不足",
      );
    step.product_contract = structuredClone(frozen);
  }
  return frozen;
}
export function assertProductRequest(plan, step, input, references, artifacts) {
  for (const reference of step.references ?? [])
    if (reference.role === "product-structure")
      need(
        reference.purpose === "product-structure",
        "PRODUCT_REFERENCE_ROLE",
        "本次结构参考不能携带降级职责的自由用途",
      );
  const frozen = plan.product_contract;
  need(
    plan.purpose !== "product-accurate" || frozen,
    "PRODUCT_CONTRACT_REQUIRED",
    "旧实物准确计划缺商品一致性契约，须另冻计划而非补造在途意图",
  );
  if (!frozen) return null;
  const c = artifacts.find(
    (a) =>
      a.id === frozen.contract_id &&
      a.kind === "spec" &&
      meta(a).role === "product-invariants",
  );
  need(
    c &&
      c.version === frozen.version &&
      digest(c.content) === frozen.content_hash &&
      invariantFor(artifacts, plan.task_id)?.id === c.id &&
      stable(body(c).product_consistency) === stable(frozen.consistency),
    "PRODUCT_CONTRACT_STALE",
    "商品一致性契约已变化或绑定不符",
  );
  const v = productConsistency(frozen.consistency, body(c).items, artifacts);
  if (v.route !== "protected-layer")
    need(
      (input.id === v.master.media_id &&
        meta(input).sha256 === v.master.sha256 &&
        step.input_role === "product-structure") ||
        references.some(
          (r) =>
            r.artifact.id === v.master.media_id &&
            meta(r.artifact).sha256 === v.master.sha256 &&
            r.role === "product-structure",
        ),
      "PRODUCT_REFERENCE_REQUIRED",
      "本次实际输入/参考包漏掉当前商品结构母版",
    );
  return frozen;
}
export function productComposite(op, base, artifacts, historical = false) {
  fields(op, [
    "op",
    "contract_id",
    "contract_version",
    "contract_hash",
    "x",
    "y",
    "width",
    "height",
    "foreground_id",
    "encoding",
    "recipe_id",
  ]);
  need(op.op === "product-composite", "PRODUCT_COMPOSITE", "未知产品层操作");
  const c = artifacts.find(
    (a) =>
      a.id === op.contract_id &&
      a.kind === "spec" &&
      meta(a).role === "product-invariants",
  );
  need(
    c &&
      c.version === op.contract_version &&
      digest(c.content) === op.contract_hash,
    "PRODUCT_CONTRACT_STALE",
    "产品层操作须钉当前一致性规范版本/hash",
  );
  need(base?.kind === "media", "PRODUCT_COMPOSITE", "产品层缺实际背景媒体");
  const v = productConsistency(
      body(c).product_consistency,
      body(c).items,
      artifacts,
      historical,
    ),
    master = media(v.master, artifacts),
    mask = media(v.mask, artifacts),
    bm = meta(base),
    mm = meta(master);
  need(
    v.route === "protected-layer" &&
      meta(c).task_id === bm.task_id &&
      (historical || invariantFor(artifacts, bm.task_id)?.id === c.id),
    "PRODUCT_COMPOSITE",
    "产品层须属于当前任务/保护路线",
  );
  const recipe = v.compositions.find((r) => r.id === op.recipe_id);
  need(
    recipe &&
      recipe.canvas_width === bm.width &&
      recipe.canvas_height === bm.height &&
      ["x", "y", "width", "height"].every((k) => recipe[k] === op[k]) &&
      stable(recipe.encoding) === stable(op.encoding) &&
      (recipe.foreground?.media_id ?? null) === (op.foreground_id ?? null),
    "PRODUCT_COMPOSITION",
    "操作须精确匹配契约内的画布/位置/等比尺寸/前景/编码配方",
  );
  rect(
    { x: op.x, y: op.y, width: op.width, height: op.height },
    bm.width,
    bm.height,
  );
  need(
    op.width * mm.height === op.height * mm.width,
    "PRODUCT_SCALE",
    "产品层只允许等比缩放，不支持任意透视/拉伸",
  );
  const allowed = (kind) => v.allowed_changes.some((c) => c.kind === kind);
  need(
    ((op.x === 0 && op.y === 0) || allowed("position")) &&
      ((op.width === mm.width && op.height === mm.height) ||
        allowed("uniform-scale")),
    "PRODUCT_TRANSFORM_PERMISSION",
    "产品层位置/缩放不在声明允许范围",
  );
  let foreground = null;
  if (op.foreground_id) {
    foreground = media(recipe.foreground, artifacts);
    need(
      foreground &&
        foreground.project_id === base.project_id &&
        meta(foreground).width === bm.width &&
        meta(foreground).height === bm.height &&
        allowed("occlusion"),
      "PRODUCT_OCCLUSION",
      "前景遮挡须为同画布实际图层并有允许依据",
    );
  }
  fields(op.encoding, ["format", "quality", "background"]);
  need(
    ["png", "jpeg"].includes(op.encoding.format) &&
      (op.encoding.format !== "jpeg" ||
        (Number.isSafeInteger(op.encoding.quality) &&
          op.encoding.quality >= 1 &&
          op.encoding.quality <= 100 &&
          /^#[a-fA-F0-9]{6}$/.test(op.encoding.background))),
    "PRODUCT_ENCODING",
    "最终编码须为明确PNG或JPEG质量/背景",
  );
  return { contract: c, consistency: v, master, mask, foreground };
}
export async function renderProductComposite(
  baseBytes,
  op,
  base,
  artifacts,
  load,
  historical = false,
) {
  const {
    consistency: v,
    master,
    mask,
    foreground,
  } = productComposite(op, base, artifacts, historical);
  const sharp = await loadSharp();
  const baseInfo = await sharp(baseBytes, {
    limitInputPixels: 50_000_000,
  }).metadata();
  need(
    baseInfo.width === meta(base).width &&
      baseInfo.height === meta(base).height,
    "PRODUCT_PIXELS",
    "背景实际解码尺寸与声明不符",
  );
  baseBytes = await sharp(baseBytes, { limitInputPixels: 50_000_000 })
    .toColourspace("srgb")
    .ensureAlpha()
    .png()
    .toBuffer();
  const m = meta(master),
    masterBytes = await load(master),
    maskBytes = await load(mask);
  need(
    meta(base).width * meta(base).height <= 50_000_000 &&
      m.width * m.height <= 50_000_000,
    "PRODUCT_RESOURCE_LIMIT",
    "产品层实际像素须在既有5000万上限内",
  );
  const decoded = await sharp(masterBytes, { limitInputPixels: 50_000_000 })
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const stencil = await sharp(maskBytes, { limitInputPixels: 50_000_000 })
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  need(
    decoded.info.width === m.width &&
      decoded.info.height === m.height &&
      stencil.info.width === m.width &&
      stencil.info.height === m.height,
    "PRODUCT_PIXELS",
    "母版/蒙版实际尺寸不符",
  );
  let visible = 0;
  for (let i = 0; i < decoded.data.length; i += 4) {
    decoded.data[i + 3] = Math.round(
      (((decoded.data[i + 3] * stencil.data[i]) / 255) * stencil.data[i + 3]) /
        255,
    );
    if (decoded.data[i + 3]) visible++;
  }
  need(visible > 0, "PRODUCT_VISIBLE_REGION", "空产品层不能作为保护证据");
  let layer = await sharp(decoded.data, {
    raw: { width: m.width, height: m.height, channels: 4 },
  })
    .resize(op.width, op.height, { fit: "fill", kernel: "lanczos3" })
    .png()
    .toBuffer();
  const layerPixels = await sharp(layer).ensureAlpha().raw().toBuffer();
  let frontBytes = null,
    frontPixels = null;
  if (foreground) {
    frontBytes = await load(foreground);
    const frontInfo = await sharp(frontBytes, {
      limitInputPixels: 50_000_000,
    }).metadata();
    need(
      frontInfo.width === meta(base).width &&
        frontInfo.height === meta(base).height,
      "PRODUCT_PIXELS",
      "前景实际解码尺寸与画布不符",
    );
    frontPixels = await sharp(frontBytes, { limitInputPixels: 50_000_000 })
      .toColourspace("srgb")
      .ensureAlpha()
      .raw()
      .toBuffer();
  }
  const canvas = meta(base);
  for (const r of v.visible_regions) {
    const x0 = Math.floor((r.x * op.width) / m.width),
      y0 = Math.floor((r.y * op.height) / m.height),
      x1 = Math.ceil(((r.x + r.width) * op.width) / m.width),
      y1 = Math.ceil(((r.y + r.height) * op.height) / m.height);
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++)
        need(
          layerPixels[(y * op.width + x) * 4 + 3] === 255 &&
            (!frontPixels ||
              frontPixels[((y + op.y) * canvas.width + x + op.x) * 4 + 3] ===
                0),
          "PRODUCT_VISIBLE_REGION",
          "必证可见内区须完全不透明且无遮挡；请避开重采样抗锯齿边缘",
        );
  }
  const layers = [{ input: layer, left: op.x, top: op.y, blend: "over" }];
  if (frontBytes)
    layers.push({ input: frontBytes, left: 0, top: 0, blend: "over" });
  let output = sharp(baseBytes)
    .toColourspace("srgb")
    .ensureAlpha()
    .composite(layers);
  if (op.encoding.format === "jpeg")
    output = output
      .flatten({ background: op.encoding.background })
      .withIccProfile("srgb")
      .jpeg({ quality: op.encoding.quality, chromaSubsampling: "4:4:4" });
  else output = output.png();
  return output.toBuffer();
}
export function productProtection(artifacts, image, task) {
  const c = invariantFor(artifacts, task.id),
    v = c && body(c).product_consistency;
  need(
    meta(task).retouch?.purpose !== "product-accurate" || v,
    "PRODUCT_CONTRACT_REQUIRED",
    "实物准确候选接受/交付前须有当前SKU一致性契约，不依赖是否存在plan",
  );
  if (!v) return null;
  productConsistency(v, body(c).items, artifacts);
  if (v.route !== "protected-layer") return null;
  const im = meta(image),
    ex = artifacts.find(
      (a) => a.id === im.transform?.execution_id && a.kind === "execution",
    ),
    descriptor = ex && body(ex),
    op = descriptor?.operations?.[0];
  if (meta(ex ?? { meta: {} }).product_protection)
    need(
      meta(ex).product_protection.renderer_hash ===
        digest(productRenderer(descriptor?.renderer?.versions ?? {})),
      "PRODUCT_RENDERER_DRIFT",
      "产品层渲染器版本变化，旧证明须重新验证",
    );
  need(
    ex &&
      meta(ex).role === "local-postprocess" &&
      meta(ex).status === "completed" &&
      meta(ex).outputs?.includes(image.id) &&
      meta(ex).product_protection?.media_id === image.id &&
      meta(ex).product_protection?.sha256 === im.sha256 &&
      meta(ex).product_protection?.contract_id === c.id &&
      meta(ex).product_protection?.contract_hash === digest(c.content) &&
      meta(ex).product_protection?.renderer_hash ===
        digest(productRenderer(descriptor?.renderer?.versions ?? {})) &&
      descriptor.operations.length === 1 &&
      op.op === "product-composite" &&
      op.contract_id === c.id &&
      op.contract_version === c.version &&
      op.contract_hash === digest(c.content),
    "PRODUCT_PROTECTION_REQUIRED",
    "最终候选缺当前契约的确定性产品层验证；后续裁切/融合/改形不能继承旧证明",
  );
  const input = artifacts.find(
    (a) => a.id === descriptor.input_id && a.kind === "media",
  );
  need(
    input &&
      im.parents?.includes(input.id) &&
      im.parents.includes(v.master.media_id) &&
      im.parents.includes(v.mask.media_id),
    "PRODUCT_PROTECTION_REQUIRED",
    "最终产品层来源/父链不完整",
  );
  productComposite(op, input, artifacts);
  return { execution: ex, input, operation: op, contract: c };
}
export async function verifyProductTransform(
  root,
  artifacts,
  execution,
  image,
  options = {},
) {
  const descriptor = body(execution),
    op = descriptor.operations?.[0];
  if (!descriptor.operations?.some((op) => op.op === "product-composite"))
    return null;
  const sharp = await loadSharp();
  need(
    descriptor.operations.length === 1 && op.op === "product-composite",
    "PRODUCT_COMPOSITE",
    "产品层证明必须来自唯一最终合成操作",
  );
  const input = artifacts.find(
    (a) => a.id === descriptor.input_id && a.kind === "media",
  );
  need(input, "PRODUCT_COMPOSITE", "产品层缺背景输入");
  need(
    descriptor.renderer?.product_layer ===
      "deterministic-product-composite/v1" &&
      stable(descriptor.renderer.versions) === stable(sharp.versions),
    "PRODUCT_RENDERER_DRIFT",
    "产品层渲染器版本已变化，不能沿用旧保护证明",
  );
  const proof = {
    input,
    operation: op,
    contract: productComposite(
      op,
      input,
      artifacts,
      options.historical === true,
    ).contract,
  };
  const load =
    options.load ??
    (async (a) => {
      const m = meta(a);
      need(
        /^[a-f0-9]{64}$/.test(m.sha256) &&
          m.object_path ===
            "objects/sha256/" + m.sha256.slice(0, 2) + "/" + m.sha256,
        "PRODUCT_CAS",
        "产品层CAS路径无效",
      );
      const file = path.join(root, m.object_path);
      need(
        (await fs.realpath(file)) === file &&
          !(await fs.lstat(file)).isSymbolicLink(),
        "PRODUCT_CAS",
        "产品层CAS不能经过链接",
      );
      const bytes = await fs.readFile(file);
      need(
        bytes.length === m.bytes && hash(bytes) === m.sha256,
        "PRODUCT_CAS",
        "产品层CAS字节不符",
      );
      return bytes;
    });
  const expected = await renderProductComposite(
      await load(proof.input),
      proof.operation,
      proof.input,
      artifacts,
      load,
      options.historical === true,
    ),
    actual = await load(image);
  need(
    expected.equals(actual),
    "PRODUCT_PIXELS",
    "最终实际文件不等于冻结母版/蒙版/坐标/遮挡/编码的确定性重建",
  );
  return {
    schema: "retouch.product-protection/v1",
    contract_id: proof.contract.id,
    contract_hash: digest(proof.contract.content),
    media_id: image.id,
    sha256: meta(image).sha256,
    verified: "exact-final-bytes",
    renderer: productRenderer(sharp.versions),
    renderer_hash: digest(
      productRenderer(descriptor?.renderer?.versions ?? {}),
    ),
    semantic_quality: "NOT_RUN",
  };
}
export async function verifyProductPixels(root, artifacts, image, task) {
  const proof = productProtection(artifacts, image, task);
  return proof
    ? verifyProductTransform(root, artifacts, proof.execution, image)
    : null;
}
