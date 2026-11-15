import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { parse } from "smol-toml";
import { RetouchError, requireThat } from "../domain/model.ts";
import type { ApiProfile } from "./plugin/api-contract.mjs";
type Environment = Record<string, string | undefined>;
export async function configuration(
  profile: ApiProfile,
  env: Environment,
  workspaceId: string,
) {
  const source = profile.configuration_source;
  if (!source)
    return {
      base: env[profile.base_env],
      key: env[profile.credential_env],
      kind: "environment",
      provider: null,
    };
  requireThat(
    source.authorized && source.authorization_ref,
    "CONFIG_SOURCE_UNAUTHORIZED",
    "当前配置入口尚未获得读取授权",
    1,
  );
  requireThat(
    source.workspace_id === workspaceId,
    "CONFIG_SOURCE_REAUTHORIZE",
    "配置读取授权属于其他工作区；请在当前工作区明确重新登记",
    1,
  );
  const home = env.CODEX_HOME || path.join(os.homedir(), ".codex");
  let data: any;
  try {
    const file = path.join(home, "config.toml"),
      stat = await fs.lstat(file);
    requireThat(
      stat.isFile() && !stat.isSymbolicLink() && stat.size <= 1024 * 1024,
      "CONFIG_SOURCE_FILE",
      "当前 Codex 配置须为有效的受保护文件",
      1,
    );
    data = parse(await fs.readFile(file, "utf8"));
  } catch (e) {
    if (e instanceof RetouchError) throw e;
    throw new RetouchError(
      (e as NodeJS.ErrnoException).code === "ENOENT"
        ? "CONFIG_SOURCE_MISSING"
        : "CONFIG_SOURCE_UNREADABLE",
      "当前 Codex 配置不存在或不可读取；未扫描其他目录",
      1,
    );
  }
  const provider = data.model_provider ?? "openai",
    selected = data.model_providers?.[provider] ?? {};
  requireThat(
    !source.provider || provider === source.provider,
    "CONFIG_SELECTION_DRIFT",
    "当前选中的模型服务已改变，先重新核对配置",
    1,
  );
  const base =
    selected.base_url ??
    (provider === "openai" ? "https://api.openai.com/v1" : undefined);
  let key = selected.env_key
    ? env[selected.env_key]
    : selected.experimental_bearer_token;
  if (!key && selected.requires_openai_auth === true) {
    try {
      const file = path.join(home, "auth.json"),
        stat = await fs.lstat(file);
      requireThat(
        stat.isFile() && !stat.isSymbolicLink() && stat.size <= 1024 * 1024,
        "CONFIG_SOURCE_FILE",
        "认证入口无效",
        1,
      );
      // Only a dedicated API key is eligible; ChatGPT login/OAuth tokens are never repurposed.
      key = JSON.parse(await fs.readFile(file, "utf8")).OPENAI_API_KEY;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT")
        throw new RetouchError(
          "CONFIG_AUTH_UNREADABLE",
          "已授权的当前服务认证入口不可读取",
          1,
        );
    }
  }
  return { base, key, kind: "codex-model", provider };
}
