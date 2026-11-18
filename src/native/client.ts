import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";
import {
  requireThat,
  RetouchError,
  hash,
  bytesHash,
  type YglBinding,
} from "../domain/model.ts";

const invoke = promisify(execFile);
export const nativeSchema = "retouch.native/v1";
export async function binding(entryFile: string): Promise<YglBinding> {
  const entry = await fs.realpath(entryFile).catch(() => {
    throw new RetouchError(
      "YGL_NOT_FOUND",
      "请指定实际安装的 ygl CLI --ygl-entry",
    );
  });
  let root = path.dirname(entry),
    info: any = {};
  for (let n = 0; n < 8; n++, root = path.dirname(root)) {
    info = await fs
      .readFile(path.join(root, "package.json"), "utf8")
      .then(JSON.parse)
      .catch(() => ({}));
    if (info.name === "ygl-trees") break;
  }
  requireThat(
    info.name === "ygl-trees" && info.version === "0.125.0",
    "YGL_VERSION",
    "当前原生扩展要求 ygl-trees 0.125.0",
    1,
  );
  const source_hashes: Record<string, string> = {};
  for (const file of (await fs.readdir(path.dirname(entry)))
    .filter((n) => n.endsWith(".cjs"))
    .sort())
    source_hashes[file] = bytesHash(
      await fs.readFile(path.join(path.dirname(entry), file)),
    );
  requireThat(
    Object.keys(source_hashes).length > 1,
    "YGL_BUNDLE",
    "请指定完整发行包 dist/bundle/bin.cjs",
    1,
  );
  // The plugin uses the pinned engine transaction API; include that face in drift detection.
  for (const relative of [
    "dist/packages/research/pipeline/src/writes.js",
    "dist/packages/core/database/src/orm.js",
    "dist/packages/techtree/model/src/writes.js",
  ])
    source_hashes[relative] = bytesHash(
      await fs.readFile(path.join(root, relative)),
    );
  return { entry, version: info.version, source_hashes };
}
export class NativeClient {
  root: string;
  ygl: YglBinding;
  retainRequests: boolean;
  constructor(
    root: string,
    ygl: YglBinding,
    options: { retainRequests?: boolean } = {},
  ) {
    this.root = root;
    this.ygl = ygl;
    this.retainRequests = options.retainRequests === true;
  }
  static async initialize(
    root: string,
    entry: string,
    options: { retainRequests?: boolean } = {},
  ) {
    const absolute = path.resolve(root);
    await fs.mkdir(absolute, { recursive: true });
    requireThat(
      !(await fs.lstat(absolute)).isSymbolicLink() &&
        (await fs.readdir(absolute)).length === 0,
      "WORKSPACE_NOT_EMPTY",
      "初始化目标须为空且不能是链接",
    );
    const client = new NativeClient(
      await fs.realpath(absolute),
      await binding(entry),
      options,
    );
    await fs.mkdir(path.join(client.root, "tmp/native-requests"), {
      recursive: true,
    });
    await client.raw(["db", "init"]);
    const plugin = fileURLToPath(new URL("./plugin/", import.meta.url));
    await client.raw(["plugin", "install", plugin]);
    const capabilities = await client.call("capabilities", {});
    requireThat(
      capabilities.transactions === true &&
        capabilities.custom_tables?.length === 0,
      "PLUGIN_CONTRACT",
      "原生扩展契约不匹配",
      1,
    );
    const identity = await client.call("workspace-init", {}, "workspace-init");
    await fs.writeFile(
      path.join(client.root, "workspace.json"),
      JSON.stringify(
        { schema: "retouch.workspace/v2", ygl: client.ygl, id: identity.id },
        null,
        2,
      ) + "\n",
      { flag: "wx" },
    );
    return client;
  }
  static async open(root: string, options: { retainRequests?: boolean } = {}) {
    const canonical = await fs.realpath(path.resolve(root));
    const config = JSON.parse(
      await fs.readFile(path.join(canonical, "workspace.json"), "utf8"),
    );
    requireThat(
      config.schema === "retouch.workspace/v2",
      "LEGACY_WORKSPACE",
      "此入口只写 ygl 原生工作区；旧账本须显式只读迁移",
      1,
    );
    requireThat(
      hash(await binding(config.ygl.entry)) === hash(config.ygl),
      "YGL_VERSION_DRIFT",
      "原生发行包已改变；请重新验收适配",
      1,
    );
    const home = path.join(canonical, "ygl");
    requireThat(
      (await fs.realpath(home)) === home &&
        !(await fs.lstat(path.join(home, "ygl-trees.db"))).isSymbolicLink(),
      "YGL_HOME_ESCAPE",
      "原生 home 不得指向其他工作区",
      1,
    );
    const client = new NativeClient(canonical, config.ygl, options);
    requireThat(
      (await client.call("workspace-info", {})).id === config.id,
      "WORKSPACE_BINDING",
      "原生工作区身份不匹配",
      1,
    );
    return client;
  }
  async raw(args: string[]): Promise<any> {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      YGL_HOME: path.join(this.root, "ygl"),
      YGL_SESSION: "retouch-native",
      YGL_EVAL_OFFLINE: "1",
      YGL_NO_UPDATE_CHECK: "1",
    };
    for (const key of Object.keys(env))
      if (
        /API_KEY|TOKEN|PASSWORD|SECRET/i.test(key) ||
        [
          "YGL_DB_URL",
          "YGL_PG_URL",
          "YGL_TREE",
          "YGL_PROJECT",
          "YGL_RUN_ID",
          "DSH_SESSION_ID",
          "YGL_TEST",
          "YGL_SERVE",
          "YGL_DB_NO_CREATE",
          "YGL_PACKAGE_MANAGER",
        ].includes(key)
      )
        delete env[key];
    let output = "",
      exit = 0;
    try {
      output = (
        await invoke(
          process.execPath,
          [
            this.ygl.entry,
            ...args,
            "--home",
            path.join(this.root, "ygl"),
            "--json",
          ],
          {
            cwd: this.root,
            env,
            windowsHide: true,
            timeout: 60000,
            maxBuffer: 32 * 1024 * 1024,
          },
        )
      ).stdout;
    } catch (error) {
      const e = error as any;
      if (typeof e.code !== "number")
        throw new RetouchError(
          "NATIVE_RESULT_UNKNOWN",
          "原生调用结果未知；先使用相同请求键查询回执，不能重发图像请求",
          1,
          null,
          "unknown",
        );
      exit = e.code;
      output = e.stdout || "";
    }
    let result: any;
    try {
      result = JSON.parse(output);
    } catch {
      throw new RetouchError(
        "NATIVE_JSON",
        "原生 CLI 未返回完整 JSON；先查询原生回执再判断执行结果",
        1,
        { command: args.slice(0, 2), exit },
        "unknown",
      );
    }
    if (exit !== 0 || result?.ok === false || result?.error)
      throw new RetouchError(
        result?.error?.code || "NATIVE_REJECTED",
        result?.error?.message || "原生命令拒绝执行",
        exit || 1,
        null,
        "none",
      );
    return result;
  }
  async call(
    action: string,
    body: Record<string, unknown>,
    requestId?: string,
  ): Promise<any> {
    const directory = path.join(this.root, "tmp/native-requests");
    await fs.mkdir(directory, { recursive: true });
    requireThat(
      (await fs.realpath(directory)) === directory,
      "REQUEST_PATH",
      "请求目录不能通过链接越界",
      1,
    );
    const file = path.join(directory, crypto.randomUUID() + ".json");
    await fs.writeFile(
      file,
      JSON.stringify({
        schema: nativeSchema,
        body,
        ...(requestId ? { request_id: requestId } : {}),
      }),
      { flag: "wx" },
    );
    try {
      const result = await this.raw(["retouch-native", action, "--file", file]);
      requireThat(
        result.schema === nativeSchema &&
          result.ok === true &&
          "result" in result,
        "NATIVE_SCHEMA",
        "原生扩展响应 schema 不匹配",
        1,
      );
      return result.result;
    } finally {
      if (!this.retainRequests) await fs.unlink(file);
    }
  }
}
