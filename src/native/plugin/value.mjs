import crypto from "node:crypto";
export const stable = (value) =>
  Array.isArray(value)
    ? "[" + value.map((v) => stable(v ?? null)).join(",") + "]"
    : value && typeof value === "object"
      ? "{" +
        Object.keys(value)
          .filter((k) => value[k] !== undefined)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + stable(value[k]))
          .join(",") +
        "}"
      : JSON.stringify(value ?? null);
// Native produce documents may legitimately have no metadata. Nonempty invalid JSON
// and non-record values must not be normalized into apparently safe roleless records.
export function metadata(artifact) {
  const raw = artifact?.meta;
  if (raw === undefined || raw === null || raw === "") return {};
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      throw Object.assign(
        new Error(
          "原生工件meta必须是完整JSON对象；非空畸形内容不能按空元数据处理",
        ),
        { code: "METADATA_JSON", rc: 2 },
      );
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Object.assign(
      new Error(
        "原生工件meta须为对象；数组、标量及JSON null不能作为角色或授权",
      ),
      { code: "METADATA_SHAPE", rc: 2 },
    );
  return value;
}
export const digest = (value) =>
  crypto.createHash("sha256").update(stable(value)).digest("hex");
