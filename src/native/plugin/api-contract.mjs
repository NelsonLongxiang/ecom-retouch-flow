// Shared, credential-free contract for an explicitly selected image API fallback.
export const API_PROFILE_SCHEMA = "retouch.api-profile/v1";
export const API_PROTOCOL = "openai-images-edits/v1";
function need(ok, code, message) {
  if (!ok) throw Object.assign(new Error(message), { code, rc: 2 });
}
export function apiProfile(value) {
  need(
    value && typeof value === "object" && !Array.isArray(value),
    "API_PROFILE",
    "执行配置必须为对象",
  );
  const allowed = [
    "schema",
    "protocol",
    "base_env",
    "credential_env",
    "model",
    "size",
    "quality",
    "timeout_ms",
    "response_limit_bytes",
    "allow_loopback_http",
  ];
  need(
    Object.keys(value).every((k) => allowed.includes(k)),
    "API_PROFILE",
    "执行配置包含未知字段；不能传入实际密钥或认证头",
  );
  need(
    value.schema === API_PROFILE_SCHEMA && value.protocol === API_PROTOCOL,
    "API_PROTOCOL",
    "当前仅支持显式选择的 images/edits multipart 协议",
  );
  for (const key of ["base_env", "credential_env"])
    need(
      typeof value[key] === "string" &&
        /^[A-Z_][A-Z0-9_]{0,127}$/.test(value[key]) &&
        ![
          "PATH",
          "HOME",
          "USERPROFILE",
          "NODE_OPTIONS",
          "CODEX_HOME",
          "YGL_HOME",
          "YGL_DB_URL",
        ].includes(value[key]),
      "API_ENV_NAME",
      "配置须引用明确的专用环境变量名",
    );
  need(
    value.base_env !== value.credential_env &&
      typeof value.model === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(value.model),
    "API_MODEL",
    "必须明确模型名称，不能自动切换模型",
  );
  need(
    /API_KEY|TOKEN|PASSWORD|SECRET/.test(value.credential_env),
    "API_ENV_NAME",
    "密钥变量名须包含 API_KEY、TOKEN、PASSWORD 或 SECRET，以隔离原生子进程环境",
  );
  const size = value.size ?? "auto",
    quality = value.quality ?? "auto";
  need(
    ["auto", "1024x1024", "1536x1024", "1024x1536"].includes(size) &&
      ["auto", "low", "medium", "high"].includes(quality),
    "API_OPTIONS",
    "不支持的图像尺寸或质量选项",
  );
  const timeout_ms = value.timeout_ms ?? 180000,
    response_limit_bytes = value.response_limit_bytes ?? 48 * 1024 * 1024;
  need(
    Number.isSafeInteger(timeout_ms) &&
      timeout_ms >= 100 &&
      timeout_ms <= 900000 &&
      Number.isSafeInteger(response_limit_bytes) &&
      response_limit_bytes >= 1024 &&
      response_limit_bytes <= 64 * 1024 * 1024,
    "API_LIMIT",
    "超时或响应大小限制无效",
  );
  need(
    value.allow_loopback_http === undefined ||
      typeof value.allow_loopback_http === "boolean",
    "API_TRANSPORT",
    "allow_loopback_http 必须为布尔值",
  );
  return {
    schema: API_PROFILE_SCHEMA,
    protocol: API_PROTOCOL,
    base_env: value.base_env,
    credential_env: value.credential_env,
    model: value.model,
    size,
    quality,
    timeout_ms,
    response_limit_bytes,
    allow_loopback_http: value.allow_loopback_http ?? false,
  };
}
export function apiEndpoint(value, profile) {
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    need(false, "API_BASE", "API base 无效；具体地址不写入回执");
  }
  need(
    !endpoint.username &&
      !endpoint.password &&
      !endpoint.search &&
      !endpoint.hash,
    "API_BASE",
    "API base 不能包含凭证、查询参数或 fragment",
  );
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(
    endpoint.hostname.toLowerCase(),
  );
  need(
    endpoint.protocol === "https:" ||
      (endpoint.protocol === "http:" &&
        loopback &&
        profile.allow_loopback_http),
    "API_TRANSPORT",
    "API 默认要求 HTTPS；HTTP 仅可显式用于本地模拟服务",
  );
  need(
    !/\/images\/(?:edits|generations)\/?$/.test(endpoint.pathname),
    "API_BASE",
    "请配置 API base，而不是具体 images 接口",
  );
  endpoint.pathname = endpoint.pathname.replace(/\/+$/, "") + "/images/edits";
  return endpoint.href;
}
export function apiPrompt(step, requirements, preserve) {
  const prompt = [
    "电商商品图编辑。按当前步骤执行，保留未要求修改的内容。",
    "当前步骤：" + step.prompt,
    "有效需求：\n" +
      requirements.map((g) => "[" + g.scope + "] " + g.text).join("\n"),
    "保持项：\n" + preserve.join("\n"),
    ...(step.region
      ? [
          "允许编辑区域（输入像素坐标）：" +
            JSON.stringify({
              region: step.region,
              coordinate_system: step.coordinate_system,
            }),
        ]
      : []),
    "第一张图为编辑目标。" +
      (step.references ?? [])
        .map((r, i) => "第 " + (i + 2) + " 张图仅用于：" + r.purpose)
        .join("；"),
    "参考图不是当前商品规格的确认依据。",
  ].join("\n\n");
  need(
    prompt.length <= 32000,
    "API_PROMPT_LIMIT",
    "组合后的图像需求超过当前协议的 32000 字符限制，请先精简计划",
  );
  return prompt;
}
