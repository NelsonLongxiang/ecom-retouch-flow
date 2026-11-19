import { metadata } from "./value.mjs";
const fail = (ok, message) => {
  if (!ok)
    throw Object.assign(new Error(message), { code: "PRODUCT_FACTS", rc: 2 });
};
export const FACTS_SCHEMA = "retouch.product-facts/v1";
export function productFacts(value, artifacts = []) {
  fail(
    value &&
      value.schema === FACTS_SCHEMA &&
      Array.isArray(value.fields) &&
      value.fields.length <= 200,
    "商品事实须有 schema 和字段清单",
  );
  fail(
    new Set(value.fields.map((f) => f.key)).size === value.fields.length,
    "商品事实字段不得重复",
  );
  for (const f of value.fields) {
    fail(
      f &&
        /^[a-z][a-z0-9_.-]{0,99}$/.test(f.key) &&
        (f.value === null ||
          typeof f.value === "string" ||
          (typeof f.value === "number" && Number.isFinite(f.value))),
      "字段须有稳定 key 和真实值或 null",
    );
    fail(
      ["unknown", "observed", "hypothesis", "confirmed"].includes(f.status) &&
        [
          "user-original",
          "verified-spec",
          "agent-interpretation",
          "hypothesis",
          "reference",
          "ai-reconstruction",
        ].includes(f.role),
      "字段须区分原文、规格、解释、假设、参考和 AI 补绘",
    );
    fail(
      ["current-sku", "reference-sku", "unknown"].includes(f.subject) &&
        ["single-item", "set", "package", "visible-part", "unknown"].includes(
          f.applies_to,
        ),
      "字段须明确商品和单件/整套/包装适用对象",
    );
    fail(
      f.unit === undefined ||
        f.unit === null ||
        (typeof f.unit === "string" && f.unit.trim()),
      "单位须为原始文字，未知保留 null",
    );
    fail(
      f.source &&
        typeof f.source.artifact_id === "string" &&
        typeof f.source.quote === "string" &&
        f.source.quote.trim(),
      "每个字段须引用原生来源及精确摘录",
    );
    const source = artifacts.find((a) => a.id === f.source.artifact_id);
    fail(
      source &&
        ["spec", "citation", "design"].includes(source.kind) &&
        source.content.includes(f.source.quote),
      "字段来源缺失或摘录不在正式正文中",
    );
    fail(
      [
        "user-message",
        "product-specification",
        "measured",
        "user-field-confirmation",
        "visual-acceptance",
        "ai-output",
        "reference-product",
      ].includes(f.evidence_type),
      "字段须声明证据性质",
    );
    if (f.status === "confirmed") {
      const sm = metadata(source);
      fail(
        f.value !== null &&
          f.subject === "current-sku" &&
          f.source.label_present === true &&
          ["user-original", "verified-spec"].includes(f.role) &&
          [
            "product-specification",
            "measured",
            "user-field-confirmation",
          ].includes(f.evidence_type) &&
          (source.kind === "citation" ||
            ["user-original", "confirmed-fact"].includes(sm.role)) &&
          f.confirmation &&
          typeof f.confirmation.statement === "string" &&
          f.confirmation.statement.trim() &&
          typeof f.confirmation.source_ref === "string" &&
          f.confirmation.source_ref.trim(),
        "同系列参考、缺表头数字、视觉接受和 AI 补绘不能确认当前商品规格",
      );
      if (f.key.startsWith("dimensions."))
        fail(
          f.unit && ["single-item", "set", "package"].includes(f.applies_to),
          "确认尺寸须包含单位和单件/整套/包装对象",
        );
    }
  }
  return structuredClone(value);
}
export function factCheck(facts, steps, purpose) {
  fail(
    ["unspecified", "concept", "product-accurate"].includes(purpose),
    "任务用途须为 concept 或 product-accurate",
  );
  const fields = facts?.fields ?? [];
  const checks = steps.map((s) => {
    fail(
      s.fact_keys === undefined ||
        (Array.isArray(s.fact_keys) &&
          s.fact_keys.every((k) => typeof k === "string")),
      "fact_keys 须为当前步骤真正使用的字段",
    );
    fail(
      s.safe_strategy === undefined ||
        ["closed-drawer", "visible-only", "omit-unverified-labels"].includes(
          s.safe_strategy,
        ),
      "未支持的保守呈现方案",
    );
    const missing = [...new Set(s.fact_keys ?? [])].filter(
      (key) =>
        !fields.some(
          (f) =>
            f.key === key &&
            f.status === "confirmed" &&
            f.subject === "current-sku",
        ),
    );
    const confirmed_fields = fields
      .filter(
        (f) =>
          (s.fact_keys ?? []).includes(f.key) &&
          f.status === "confirmed" &&
          f.subject === "current-sku",
      )
      .map((f) => structuredClone(f));
    const omitted = missing.filter(
      (key) =>
        (s.safe_strategy === "closed-drawer" && key === "drawer.interior") ||
        (s.safe_strategy === "visible-only" &&
          (key === "drawer.interior" || key.startsWith("structure."))) ||
        (s.safe_strategy === "omit-unverified-labels" &&
          (key.startsWith("dimensions.") ||
            ["material", "load_capacity", "package.quantity"].includes(key))),
    );
    return {
      step_id: s.id,
      confirmed_fields,
      required_keys: [...new Set(s.fact_keys ?? [])],
      missing,
      omitted,
      safe_strategy: s.safe_strategy ?? null,
      blocking:
        purpose === "product-accurate"
          ? missing.filter((k) => !omitted.includes(k))
          : [],
      constraints: [
        ...(purpose === "concept"
          ? ["这是概念提案，不作为实物材质、内部结构或性能的确认。"]
          : []),
        ...(s.safe_strategy === "closed-drawer"
          ? ["抽屉保持闭合，不展示或补造未核实的内部结构。"]
          : []),
        ...(s.safe_strategy === "visible-only"
          ? ["只展示原图可见细节，不补造未知内部结构。"]
          : []),
        ...(s.safe_strategy === "omit-unverified-labels"
          ? ["省略未核实的尺寸、材质、性能和数量标签。"]
          : []),
        ...(missing.length ? ["未确认字段：" + missing.join(", ")] : []),
      ],
    };
  });
  return {
    purpose,
    step_checks: checks,
    required_keys: [...new Set(checks.flatMap((c) => c.required_keys))],
    missing: [...new Set(checks.flatMap((c) => c.missing))],
    blocking: [...new Set(checks.flatMap((c) => c.blocking))],
    status: checks.some((c) => c.blocking.length)
      ? "BLOCKED"
      : "PASS_WITH_BOUNDARIES",
  };
}
export function renderFacts(check) {
  return check.confirmed_fields.map((f) => ({
    key: f.key,
    value: f.value,
    unit: f.unit ?? null,
    applies_to: f.applies_to,
  }));
}
