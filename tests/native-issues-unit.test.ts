import test from "node:test";
import assert from "node:assert/strict";
import { pendingExecution } from "../src/native/plugin/commands.mjs";
import {
  rawRating,
  effectiveRating,
  summarizeRatings,
} from "../src/native/plugin/feedback.mjs";
import { apiEndpoint, apiProfile } from "../src/native/plugin/api-contract.mjs";
import {
  productFacts,
  factCheck,
} from "../src/native/plugin/product-facts.mjs";

test("已保存外部结果与工作流待恢复分开，历史输出不绕过未知请求", () => {
  const image = {
    id: "image",
    project_id: "project",
    kind: "media",
    meta: JSON.stringify({
      task_id: "task",
      goal_id: "goal",
      role: "model-output",
      sha256: "a".repeat(64),
    }),
  };
  const make = (status: string, role = "external") => ({
    kind: "execution",
    project_id: "project",
    meta: JSON.stringify({
      task_id: "task",
      goal_id: "goal",
      outputs: [image.id],
      status,
      role,
    }),
  });
  assert.equal(pendingExecution(make("received"), [image]), false);
  assert.equal(
    pendingExecution(make("received", "workflow-run"), [image]),
    true,
  );
  assert.equal(pendingExecution(make("received"), []), true);
  for (const state of ["unknown", "dispatched"])
    assert.equal(pendingExecution(make(state), [image]), true);
});
test("原始八星反馈不换算，未知下限与刻度保留，跨量表不混算", () => {
  const raw = rawRating({
    score: 8,
    scale_max: 10,
    original_text: "满分10星，给8星",
    source_ref: "user message",
  });
  assert.equal(raw.scale_min, null);
  assert.equal(raw.step, null);
  assert.equal(raw.original_text, "满分10星，给8星");
  const summary = summarizeRatings([effectiveRating({ rating: 4 }), raw, null]);
  assert.equal(summary.rated_projects, 2);
  assert.equal(summary.mean_rating, null);
  assert.equal(summary.rating_scales.length, 2);
  assert.equal(summary.normalization, "NOT_APPLIED");
  for (const r of [
    { ...raw, score: 11 },
    { ...raw, scale_min: 9 },
    { ...raw, step: 0 },
    { ...raw, original_text: "" },
    { ...raw, normalized_score: 4 },
  ])
    assert.throws(() => rawRating(r), { code: "RATING" });
});
test("HTTPS 默认与私网明示确认独立，公共 HTTP 和配置正文不会作为兼容入口", () => {
  const base = {
    schema: "retouch.api-profile/v1",
    protocol: "openai-images-edits/v1",
    model: "gpt-image-2",
    base_env: "TEST_BASE",
    credential_env: "TEST_API_KEY",
  };
  assert.throws(() => apiEndpoint("http://192.168.40.2/v1", apiProfile(base)), {
    code: "API_TRANSPORT",
  });
  const compatible = apiProfile({
    ...base,
    private_http: {
      enabled: true,
      confirmation: "fixture user selected private HTTP",
    },
  });
  assert.equal(
    apiEndpoint("http://192.168.40.2/v1", compatible),
    "http://192.168.40.2/v1/images/edits",
  );
  for (const url of [
    "http://public.example/v1",
    "http://203.0.113.2/v1",
    "http://192.168.public.example/v1",
    "http://10.public.example/v1",
    "http://172.16.public.example/v1",
    "http://127.0.0.1/v1",
  ])
    assert.throws(() => apiEndpoint(url, compatible), {
      code: "API_TRANSPORT",
    });
  assert.throws(
    () =>
      apiProfile({
        ...base,
        configuration_source: {
          kind: "codex-model",
          authorized: true,
          authorization_ref: "",
        },
      }),
    { code: "CONFIG_SOURCE" },
  );
});
test("缺表头、AI 补绘和视觉接受不能确认规格；仅按当前步骤的字段设置门槛", () => {
  const source = {
    id: "raw",
    kind: "spec",
    content: "无表头 2 3 1；低分辨率原图。",
    meta: JSON.stringify({ role: "user-original" }),
  };
  const field = {
    key: "drawer.interior",
    value: null,
    status: "unknown",
    role: "ai-reconstruction",
    subject: "unknown",
    applies_to: "unknown",
    evidence_type: "ai-output",
    source: {
      artifact_id: "raw",
      quote: "低分辨率原图。",
      label_present: false,
    },
  };
  const facts = productFacts(
    { schema: "retouch.product-facts/v1", fields: [field] },
    [source],
  );
  assert.equal(
    factCheck(facts, [{ id: "a", fact_keys: ["drawer.interior"] }], "concept")
      .blocking.length,
    0,
  );
  assert.deepEqual(
    factCheck(
      facts,
      [{ id: "a", fact_keys: ["drawer.interior"] }],
      "product-accurate",
    ).blocking,
    ["drawer.interior"],
  );
  const safe = factCheck(
    facts,
    [
      {
        id: "a",
        fact_keys: ["drawer.interior"],
        safe_strategy: "closed-drawer",
      },
    ],
    "product-accurate",
  );
  assert.equal(safe.blocking.length, 0);
  assert.deepEqual(safe.required_keys, ["drawer.interior"]);
  for (const patch of [
    { status: "confirmed", value: "布抽屉" },
    {
      status: "confirmed",
      value: "布抽屉",
      role: "user-original",
      evidence_type: "visual-acceptance",
    },
  ])
    assert.throws(
      () =>
        productFacts(
          {
            schema: "retouch.product-facts/v1",
            fields: [
              {
                ...field,
                ...patch,
                confirmation: { statement: "接受配色", source_ref: "user" },
              },
            ],
          },
          [source],
        ),
      { code: "PRODUCT_FACTS" },
    );
});
