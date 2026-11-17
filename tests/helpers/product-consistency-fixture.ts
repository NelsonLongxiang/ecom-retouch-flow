import sharp from "sharp";
import { registerBytes } from "../../src/native/files.ts";
import { digest } from "../../src/native/plugin/commands.mjs";
export async function registerProductConsistency(
  c: any,
  p: string,
  task: string,
  master: any,
  route = "reference",
  suffix = "fixture",
  foreground: any = null,
) {
  const m = JSON.parse(master.meta);
  const mask =
    route === "protected-layer"
      ? (
          await registerBytes(
            c,
            p,
            task,
            await sharp({
              create: {
                width: m.width,
                height: m.height,
                channels: 4,
                background: "#ffffff",
              },
            })
              .png()
              .toBuffer(),
            {
              role: "reference",
              parents: [master.id],
              operation: "synthetic reviewed product alpha mask",
            },
            "product-mask-" + suffix,
          )
        ).artifact
      : null;
  const sku = "SYNTHETIC-SKU-" + suffix;
  const view = "same front view only; no hidden geometry";
  const qualification =
    "isolated qualified synthetic source, not actual product acceptance";
  const quote =
    "Current SKU " +
    sku +
    " master " +
    m.sha256 +
    (mask ? " mask " + JSON.parse(mask.meta).sha256 : "") +
    "; view=" +
    view +
    "; qualification=" +
    qualification +
    "; preserve visible structure and prove unoccluded center.";
  const basis = (
    await c.call(
      "document",
      {
        project: p,
        task,
        kind: "spec",
        title: "Product basis " + suffix,
        role: "user-original",
        source: "ISOLATED SYNTHETIC QUALIFICATION",
        content: quote,
      },
      "product-basis-" + suffix,
    )
  ).artifact;
  const items = ["structure", "visible-center"].map((id) => ({
    id,
    text:
      id === "structure"
        ? "Preserve synthetic current-SKU structure"
        : "Keep center visible for actual comparison",
    scope: "qualified front view",
    required: true,
    source: { artifact_id: basis.id, quote },
  }));
  const consistency: any = {
    schema: "retouch.product-consistency/v1",
    sku,
    master: { media_id: master.id, sha256: m.sha256 },
    basis: {
      artifact_id: basis.id,
      version: basis.version,
      content_hash: digest(basis.content),
      quote,
    },
    view,
    qualification,
    route,
    immutable_ids: ["structure"],
    must_prove_ids: ["visible-center"],
    allowed_changes: [
      { kind: "position", conditions: "within declared final canvas" },
      { kind: "uniform-scale", conditions: "keep original aspect ratio" },
      { kind: "occlusion", conditions: "only outside required visible center" },
    ],
  };
  if (mask) {
    const placement = {
      canvas_width: m.width * 2,
      canvas_height: m.height * 2,
      x: Math.floor(m.width / 2),
      y: Math.floor(m.height / 2),
      width: m.width,
      height: m.height,
    };
    consistency.compositions = [
      { id: "png", ...placement, encoding: { format: "png" } },
      {
        id: "jpeg",
        ...placement,
        encoding: { format: "jpeg", quality: 90, background: "#ffffff" },
      },
      ...(foreground
        ? [
            {
              id: "occluded",
              ...placement,
              foreground: {
                media_id: foreground.id,
                sha256: JSON.parse(foreground.meta).sha256,
              },
              encoding: { format: "png" },
            },
          ]
        : []),
    ];
    consistency.mask = {
      media_id: mask.id,
      sha256: JSON.parse(mask.meta).sha256,
    };
    consistency.visible_regions = [
      {
        item_id: "visible-center",
        x: 1,
        y: 1,
        width: Math.max(1, m.width - 2),
        height: Math.max(1, m.height - 2),
      },
    ];
  }
  const revision = (await c.call("task-view", { project: p, id: task })).task
    .meta.retouch.revision;
  const contract = (
    await c.call(
      "invariants-set",
      {
        project: p,
        task,
        expected_revision: revision,
        invariants: {
          schema: "retouch.invariants/v1",
          items,
          product_consistency: consistency,
        },
      },
      "product-contract-" + suffix,
    )
  ).artifact;
  return { master, mask, basis, contract, consistency, items };
}
export async function checkProductItems(
  c: any,
  p: string,
  image: any,
  contract: any,
  key: string,
  verdict = "PASS",
) {
  return c.call(
    "invariants-check",
    {
      project: p,
      id: image.id,
      contract_id: contract.id,
      sha256: JSON.parse(image.meta).sha256,
      method: "fixture",
      reviewer: "synthetic reviewer",
      source: "isolated deterministic evidence, not real visual acceptance",
      items: JSON.parse(contract.content).items.map((i: any) => ({
        id: i.id,
        verdict,
        observations: "synthetic fixture observation for " + i.id,
        evidence: "actual synthetic bytes at exact current hash",
      })),
    },
    key,
  );
}
