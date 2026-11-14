import test from "node:test";
import assert from "node:assert/strict";
import {
  apiProfile,
  apiEndpoint,
  apiPrompt,
} from "../src/native/plugin/api-contract.mjs";
const input = {
  schema: "retouch.api-profile/v1",
  protocol: "openai-images-edits/v1",
  base_env: "RETOUCH_IMAGE_API_BASE",
  credential_env: "RETOUCH_IMAGE_API_KEY",
  model: "explicit-model",
};
test("API 配置只接受环境变量名、明确模型和受限传输选项", () => {
  const profile = apiProfile(input);
  assert.equal(profile.timeout_ms, 180000);
  assert.equal(profile.model, "explicit-model");
  assert.equal(
    apiEndpoint("https://provider.example/v1/", profile),
    "https://provider.example/v1/images/edits",
  );
  for (const value of [
    { ...input, api_key: "not-a-real-key" },
    { ...input, model: "" },
    { ...input, credential_env: "PATH" },
    { ...input, timeout_ms: 0 },
  ])
    assert.throws(() => apiProfile(value));
  for (const url of [
    "http://provider.example/v1",
    "https://a:b@provider.example/v1",
    "https://provider.example/v1?key=private",
    "https://provider.example/v1/images/edits",
  ])
    assert.throws(() => apiEndpoint(url, profile));
  assert.equal(
    apiEndpoint(
      "http://127.0.0.1:12345/v1",
      apiProfile({ ...input, allow_loopback_http: true }),
    ),
    "http://127.0.0.1:12345/v1/images/edits",
  );
});
test("API 提示词保留需求、保持项、区域坐标与参考职责", () => {
  const prompt = apiPrompt(
    {
      prompt: "修改柜门",
      region: { x: 1, y: 2, width: 3, height: 4 },
      coordinate_system: { width: 8, height: 8 },
      references: [{ media_id: "ref", purpose: "仅参考木纹" }],
    },
    [{ scope: "operation", text: "保留把手" }],
    ["结构不变"],
  );
  for (const text of [
    "修改柜门",
    "保留把手",
    "结构不变",
    "仅参考木纹",
    '"width":8',
  ])
    assert.ok(prompt.includes(text));
  assert.throws(() => apiPrompt({ prompt: "x".repeat(32000) }, [], []), {
    code: "API_PROMPT_LIMIT",
  });
});
