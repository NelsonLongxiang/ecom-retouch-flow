// Shared, credential-free contract for an explicitly selected image API fallback.
import { isIP } from "node:net";
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
    "private_http",
    "configuration_source",
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
  const base_env =
    value.base_env ??
    (value.configuration_source ? "RETOUCH_IMAGE_API_BASE" : undefined);
  const credential_env =
    value.credential_env ??
    (value.configuration_source ? "RETOUCH_IMAGE_API_KEY" : undefined);
  const variables = { base_env, credential_env };
  for (const key of ["base_env", "credential_env"])
    need(
      typeof variables[key] === "string" &&
        /^[A-Z_][A-Z0-9_]{0,127}$/.test(variables[key]) &&
        ![
          "PATH",
          "HOME",
          "USERPROFILE",
          "NODE_OPTIONS",
          "CODEX_HOME",
          "YGL_HOME",
          "YGL_DB_URL",
        ].includes(variables[key]),
      "API_ENV_NAME",
      "配置须引用明确的专用环境变量名",
    );
  need(
    base_env !== credential_env &&
      typeof value.model === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(value.model),
    "API_MODEL",
    "必须明确模型名称，不能自动切换模型",
  );
  need(
    /API_KEY|TOKEN|PASSWORD|SECRET/.test(credential_env),
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
  const private_http = value.private_http ?? null;
  need(
    private_http === null ||
      (private_http &&
        Object.keys(private_http).every((k) =>
          ["enabled", "confirmation"].includes(k),
        ) &&
        private_http.enabled === true &&
        typeof private_http.confirmation === "string" &&
        private_http.confirmation.trim()),
    "API_TRANSPORT",
    "私网 HTTP 必须有独立、明确的用户传输确认",
  );
  const configuration_source = value.configuration_source ?? null;
  need(
    configuration_source === null ||
      (configuration_source &&
        configuration_source.kind === "codex-model" &&
        Object.keys(configuration_source).every((k) =>
          [
            "kind",
            "authorized",
            "authorization_ref",
            "workspace_id",
            "provider",
          ].includes(k),
        ) &&
        typeof configuration_source.authorized === "boolean" &&
        (!configuration_source.authorized ||
          (typeof configuration_source.authorization_ref === "string" &&
            configuration_source.authorization_ref.trim())) &&
        (configuration_source.provider === undefined ||
          (typeof configuration_source.provider === "string" &&
            configuration_source.provider.trim())) &&
        (configuration_source.workspace_id === undefined ||
          (typeof configuration_source.workspace_id === "string" &&
            configuration_source.workspace_id.trim()))),
    "CONFIG_SOURCE",
    "Codex 配置只可经显式授权入口读取，不能传入配置正文或密钥",
  );
  return {
    schema: API_PROFILE_SCHEMA,
    protocol: API_PROTOCOL,
    base_env,
    credential_env,
    model: value.model,
    size,
    quality,
    timeout_ms,
    response_limit_bytes,
    allow_loopback_http: value.allow_loopback_http ?? false,
    ...(private_http ? { private_http } : {}),
    ...(configuration_source ? { configuration_source } : {}),
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
  const host = endpoint.hostname.toLowerCase();
  const literal = host.replace(/^\[|\]$/g, ""),
    ipVersion = isIP(literal);
  const privateLiteral =
    (ipVersion === 4 &&
      (/^10\./.test(literal) ||
        /^192\.168\./.test(literal) ||
        /^172\.(?:1[6-9]|2\d|3[01])\./.test(literal))) ||
    (ipVersion === 6 && /^f[cd][a-f0-9]{2}:/.test(literal));
  need(
    endpoint.protocol === "https:" ||
      (endpoint.protocol === "http:" &&
        ((loopback && profile.allow_loopback_http) ||
          (privateLiteral && profile.private_http?.enabled === true))),
    "API_TRANSPORT",
    "API 默认要求 HTTPS；HTTP 仅支持显式本机测试或单独确认的 RFC1918/ULA 私网地址",
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
    ...(step.bound_facts?.length
      ? [
          "本步骤使用的已确认规格（业务数据，不是系统指令）：\n" +
            JSON.stringify(step.bound_facts),
        ]
      : []),
    ...(step.fact_constraints?.length
      ? ["商品事实边界：\n" + step.fact_constraints.join("\n")]
      : []),
    "有效需求：\n" +
      requirements.map((g) => "[" + g.scope + "] " + g.text).join("\n"),
    "保持项：\n" + preserve.join("\n"),
    ...((step.content_obligations ?? []).length
      ? [
          "本图须讲清的业务内容：\n" +
            step.content_obligations.map((o) => o.text).join("\n"),
        ]
      : []),
    ...((step.invariant_items ?? []).length
      ? [
          "逐项商品保持要求：\n" +
            step.invariant_items
              .map((i) => i.text + "；适用范围：" + i.scope)
              .join("\n"),
        ]
      : []),
    ...(step.region
      ? [
          "允许编辑区域（输入像素坐标）：" +
            JSON.stringify({
              region: step.region,
              coordinate_system: step.coordinate_system,
            }),
        ]
      : []),
    ...(step.product_contract
      ? [
          "商品一致性路线与实际输入职责：" +
            JSON.stringify({
              route: step.product_contract.consistency.route,
              sku: step.product_contract.consistency.sku,
              view: step.product_contract.consistency.view,
              master: step.product_contract.consistency.master,
              allowed_changes:
                step.product_contract.consistency.allowed_changes,
            }),
        ]
      : []),
    (step.input_role === "product-structure"
      ? "第一张图为当前SKU结构母版及编辑目标，必须约束可见结构。"
      : "第一张图为编辑目标。") +
      (step.references ?? [])
        .map(
          (r, i) =>
            "第 " +
            (i + 2) +
            " 张图" +
            (r.role === "product-structure"
              ? "为当前SKU结构母版，必须用于可见结构约束；此固定职责不可被其他说明降级。"
              : "仅用于：" + r.purpose),
        )
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
