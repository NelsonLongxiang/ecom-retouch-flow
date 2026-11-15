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
export const digest = (value) =>
  crypto.createHash("sha256").update(stable(value)).digest("hex");
