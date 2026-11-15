#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { NativeClient } from "./native/client.ts";
import { exportDocument } from "./native/documents.ts";
import {
  registerExecutor,
  checkExecutor,
  executeApi,
  recoverApi,
  reconcileApiResult,
} from "./native/api.ts";
import {
  registerMedia,
  resizeMedia,
  completeRun,
  deliverRun,
  deliverArtifact,
  objectBytes,
} from "./native/files.ts";
import {
  exportProject,
  inspectProject,
  importProject,
} from "./native/exchange.ts";
import {
  registerWorkspace,
  taste,
  searchContext,
  cite,
  citationStatus,
} from "./native/context.ts";
import { requireThat, RetouchError } from "./domain/model.ts";

const version = "0.4.0";
const options = {
  workspace: { type: "string" },
  json: { type: "boolean" },
  help: { type: "boolean" },
  version: { type: "boolean" },
  "ygl-entry": { type: "string" },
  file: { type: "string" },
  metadata: { type: "string" },
  project: { type: "string" },
  task: { type: "string" },
  "request-id": { type: "string" },
  "expected-revision": { type: "string" },
  "expected-version": { type: "string" },
  "expected-hash": { type: "string" },
  to: { type: "string" },
  role: { type: "string" },
  parent: { type: "string" },
  width: { type: "string" },
  height: { type: "string" },
  query: { type: "string" },
  "dry-run": { type: "boolean" },
  strategy: { type: "string" },
  name: { type: "string" },
  method: { type: "string" },
  profile: { type: "string" },
  "fit-input": { type: "boolean" },
} as const;
type Command = {
  operands: number;
  flags: string[];
  description: string;
  action?: string;
  readonly?: boolean;
};
const commands: Record<string, Command> = {
  "workspace init": {
    operands: 1,
    flags: ["ygl-entry"],
    description: "建立隔离 ygl 原生工作区并安装本项目原生扩展",
  },
  "workspace register": {
    operands: 1,
    flags: ["file", "request-id"],
    description: "登记已有工作区，可明确指定 authority_for 项目身份",
  },
  "workspace list": {
    operands: 0,
    flags: [],
    description: "读取 ygl 原生工作区登记信息",
    action: "workspace-list",
    readonly: true,
  },
  "project new": {
    operands: 0,
    flags: ["file", "request-id"],
    description: "建立 ygl project、原生 profile、标签与关系",
    action: "project-new",
  },
  "project list": {
    operands: 0,
    flags: [],
    description: "列出 ygl 原生电商项目",
    action: "projects",
    readonly: true,
  },
  "project brief": {
    operands: 1,
    flags: [],
    description: "接手：真实进度、未知请求、评分结语与收口提醒",
  },
  "project timeline": {
    operands: 1,
    flags: [],
    description: "从原生事件读取项目时间线",
  },
  "project tags": {
    operands: 0,
    flags: ["project", "file", "expected-revision", "request-id"],
    description: "更新有效标签并保留原生版本历史",
    action: "project-tags",
  },
  "project feedback": {
    operands: 0,
    flags: ["project", "file", "expected-revision", "request-id"],
    description: "记录用户评分与结语；缺失评分为 null",
    action: "project-feedback",
  },
  "project close": {
    operands: 0,
    flags: ["project", "file", "expected-revision", "request-id"],
    description: "记录用户完结决定与实际遗留任务",
    action: "project-close",
  },
  "project reopen": {
    operands: 0,
    flags: ["project", "expected-revision", "request-id"],
    description: "重新打开项目；历史授权不因此恢复",
    action: "project-reopen",
  },
  "goal new": {
    operands: 0,
    flags: ["project", "file", "request-id"],
    description: "以原生 spec 保存有范围和验收的目标版本",
    action: "goal-new",
  },
  "task new": {
    operands: 0,
    flags: ["project", "file", "request-id"],
    description: "建立绑定原生目标与交付条件的 task",
    action: "task-new",
  },
  "task show": {
    operands: 1,
    flags: ["project"],
    description: "读取原生任务",
    action: "task-view",
    readonly: true,
  },
  "task list": {
    operands: 0,
    flags: ["project"],
    description: "列出项目任务的实际派生进度",
    action: "task-list",
    readonly: true,
  },
  next: {
    operands: 1,
    flags: ["project"],
    description: "从项目真实状态给出该任务下一步",
    action: "task-next",
    readonly: true,
  },
  "task close": {
    operands: 1,
    flags: ["project", "file", "expected-revision", "request-id"],
    description: "核对真实交付再完成任务",
    action: "task-close",
  },
  "task context-review": {
    operands: 1,
    flags: ["project", "file", "expected-revision", "request-id"],
    description: "显式复核并绑定新的目标版本；保留历史结果",
    action: "task-context-review",
  },
  "requirement set": {
    operands: 1,
    flags: ["project", "file", "expected-revision", "request-id"],
    description: "需求有文字且未停用即参与",
    action: "requirements",
  },
  "design register": {
    operands: 0,
    flags: ["project", "task", "file", "request-id"],
    description: "原生 design；明确事实角色与来源",
  },
  "spec register": {
    operands: 0,
    flags: ["project", "task", "file", "request-id"],
    description: "原生 spec；明确事实角色与来源",
  },
  "method register": {
    operands: 0,
    flags: ["project", "file", "request-id"],
    description: "将版本化分类方法保存为原生 methodology 工件",
  },
  "asset add": {
    operands: 0,
    flags: ["project", "task", "file", "role", "parent", "request-id"],
    description: "登记真实图像字节、尺寸与原生派生关系",
  },
  "asset resize": {
    operands: 1,
    flags: ["project", "width", "height", "request-id"],
    description: "显式后处理，保留模型原生结果与尺寸来源",
  },
  "artifact show": {
    operands: 1,
    flags: ["project"],
    description: "按原生 ID 读取正文及当前版本/hash，旧版本保持可读",
    action: "show",
    readonly: true,
  },
  "artifact history": {
    operands: 1,
    flags: ["project"],
    description: "读取同一原生 design/spec/citation 文档的版本历史",
    action: "document-history",
    readonly: true,
  },
  "artifact revise": {
    operands: 1,
    flags: [
      "project",
      "file",
      "expected-version",
      "expected-hash",
      "request-id",
    ],
    description:
      "以已读取的 design/spec ID、版本和 hash 追加修订，保留历史和关系",
    action: "document-revise",
  },
  "artifact export": {
    operands: 1,
    flags: ["project", "to"],
    description: "显式导出带原生身份/版本/hash的 Markdown 副本，不覆盖已有文件",
  },
  "artifact review": {
    operands: 1,
    flags: ["project", "file", "request-id"],
    description: "绑定实际图片 hash 记录检查和用户接受",
    action: "media-review",
  },
  "artifact deliver": {
    operands: 1,
    flags: ["project", "to", "request-id"],
    description: "交付已接受的外部候选，无需重新出图",
  },
  "execution record": {
    operands: 0,
    flags: ["project", "file", "request-id"],
    description: "登记外部执行事实；unknown 保持未知",
    action: "execution-record",
  },
  "execution reconcile": {
    operands: 1,
    flags: ["project", "file", "expected-revision", "request-id"],
    description: "回接真实结果，不重新出图",
    action: "execution-reconcile",
  },
  "plan submit": {
    operands: 1,
    flags: ["project", "file", "expected-revision", "request-id"],
    description: "冻结有顺序和依赖的宿主修图计划",
    action: "plan",
  },
  "approval grant": {
    operands: 1,
    flags: ["project", "file", "request-id"],
    description: "记录绑定当前工作区与计划的用户授权",
    action: "grant",
  },
  "run start": {
    operands: 1,
    flags: ["project", "file", "request-id"],
    description: "消费一次授权，创建原生 execution",
    action: "run-start",
  },
  "run dispatch": {
    operands: 1,
    flags: ["project", "expected-revision", "request-id"],
    description: "原子记录宿主执行意图；重放禁止再次调用图像工具",
    action: "run-dispatch",
  },
  "run complete": {
    operands: 1,
    flags: ["project", "file", "metadata", "expected-revision", "request-id"],
    description: "回接真实图片，局部合成仅修改批准区域",
  },
  "run unknown": {
    operands: 1,
    flags: ["project", "file", "expected-revision", "request-id"],
    description: "保存未知请求，不自动重发",
    action: "run-unknown",
  },
  "run authorize": {
    operands: 1,
    flags: ["project", "file", "expected-revision", "request-id"],
    description: "用本工作区的新授权接手恢复运行，保留 unknown",
    action: "run-authorize",
  },
  "run review": {
    operands: 1,
    flags: ["project", "file", "expected-revision", "request-id"],
    description: "保存实际候选的视觉检查",
    action: "run-review",
  },
  "run accept": {
    operands: 1,
    flags: ["project", "file", "expected-revision", "request-id"],
    description: "保存用户对实际候选 hash 的接受",
    action: "run-accept",
  },
  "run status": {
    operands: 1,
    flags: ["project"],
    description: "查看原生执行进度与版本",
    action: "show",
    readonly: true,
  },
  "run timeline": {
    operands: 1,
    flags: ["project"],
    description: "读取原生执行、回接、检查与交付时间线",
    action: "timeline",
    readonly: true,
  },
  "run deliver": {
    operands: 1,
    flags: ["project", "to", "expected-revision", "request-id"],
    description: "交付已接受图片，恢复不覆盖不同内容",
  },
  "context export": {
    operands: 0,
    flags: ["project", "to"],
    description: "打包原生项目、关系、回执、brief 与素材",
  },
  "context inspect": {
    operands: 0,
    flags: ["file"],
    description: "只读校验 ZIP 版本、完整性、关系与图像尺寸",
  },
  "context import": {
    operands: 0,
    flags: ["file", "ygl-entry", "dry-run", "strategy", "name"],
    description: "预检或事务恢复原生 ZIP；同包幂等、历史权限失效",
  },
  "context search": {
    operands: 0,
    flags: ["query"],
    description: "跨登记工作区检索原生 design/spec",
  },
  "context cite": {
    operands: 0,
    flags: ["project", "task", "file", "request-id"],
    description: "保全指定版本/hash 的引用正文及用途",
  },
  "context build": {
    operands: 0,
    flags: ["project", "query", "method"],
    description: "组装当前目标、历史引用、分析方法和专业建议依据",
  },
  "legacy inspect": {
    operands: 0,
    flags: ["project", "file"],
    description: "只读检查旧账本或旧 v1 ZIP 的映射与真实进度",
  },
  "legacy migrate": {
    operands: 0,
    flags: ["project", "file", "to", "ygl-entry", "dry-run"],
    description: "显式只读源、预检并迁入新建的隔离 ygl 目标",
  },
  "taste view": {
    operands: 0,
    flags: ["project", "method"],
    description: "标签频率、二次分类、共现和评分交叉视图",
  },
  "index check": {
    operands: 0,
    flags: ["project"],
    description: "核验原生项目关系、文件与图索引",
  },
  "index rebuild": {
    operands: 0,
    flags: ["project"],
    description: "调用原生 node index/validate，不执行图像操作",
  },
  doctor: { operands: 0, flags: [], description: "原生 ygl doctor" },
  capabilities: {
    operands: 0,
    flags: [],
    description: "核对原生扩展与宿主优先边界",
  },
  "executor register": {
    operands: 0,
    flags: ["project", "file", "request-id"],
    description: "登记显式 API fallback 配置，仅保存环境变量名与 endpoint 指纹",
  },
  "executor check": {
    operands: 1,
    flags: ["project"],
    description: "核对执行配置与凭证是否设置，不发出网络请求",
  },
  "run execute-api": {
    operands: 1,
    flags: ["project", "profile", "expected-revision", "request-id"],
    description: "显式选择已批准的 API fallback，原生意图落定后只提交一次",
  },
  "run recover-api": {
    operands: 1,
    flags: ["project", "fit-input"],
    description: "从已保全 API 结果恢复本地合成与回执，不访问图像 API",
  },
  "run api-result": {
    operands: 1,
    flags: ["project", "file", "metadata", "expected-revision"],
    description: "回接原 API 请求的实际迟到结果，不重新发送请求",
  },
  "run api-reconcile": {
    operands: 1,
    flags: ["project", "file", "expected-revision", "request-id"],
    description: "根据提供商实际依据确认失败或继续保留未知，不发送请求",
  },
};
export async function readJSON(file: string): Promise<any> {
  const stat = await fs.lstat(file);
  requireThat(
    stat.isFile() && !stat.isSymbolicLink() && stat.size <= 1024 * 1024,
    "INPUT_FILE",
    "JSON 文件无效或超过 1 MiB",
  );
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    throw new RetouchError("INPUT_JSON", "输入不是有效 JSON", 2);
  }
}
export async function execute(
  args: string[],
): Promise<{ command: string; result: any }> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options,
      strict: true,
      allowPositionals: true,
      tokens: true,
    });
  } catch {
    throw new RetouchError("CLI_ARGUMENTS", "参数无效，请运行 --help", 2);
  }
  const flags = parsed.values,
    seen = new Set<string>();
  for (const token of parsed.tokens)
    if (token.kind === "option") {
      requireThat(
        !seen.has(token.name),
        "DUPLICATE_OPTION",
        "重复选项：" + token.name,
      );
      seen.add(token.name);
    }
  const answer = (command: string, data: any, status = "ok") => ({
    command,
    result: {
      result_status: status,
      data,
      ...(data?.replayed ? { replayed: true } : {}),
    },
  });
  if (flags.help || !args.length || parsed.positionals[0] === "help")
    return answer("help", {
      product: "电商修图流",
      version,
      commands,
      usage: "retouch <command> --workspace <dir> --json",
      storage: "ygl native; no retouch ledger",
    });
  if (flags.version) return answer("version", { version });
  const words = [...parsed.positionals],
    command = ["doctor", "capabilities", "next"].includes(words[0])
      ? words.shift()!
      : words.splice(0, 2).join(" "),
    spec = commands[command];
  requireThat(spec, "UNKNOWN_COMMAND", "未知命令");
  requireThat(
    words.length === spec.operands,
    "CLI_OPERANDS",
    "命令位置参数数量不匹配",
  );
  for (const flag of seen)
    requireThat(
      ["workspace", "json", ...spec.flags].includes(flag),
      "UNSUPPORTED_OPTION",
      command + " 不支持 --" + flag,
    );
  const required = (name: keyof typeof options) => {
    const value = flags[name];
    requireThat(
      typeof value === "string" && value.trim(),
      "MISSING_OPTION",
      "缺少 --" + name,
    );
    return value;
  };
  const revision = () => {
    const n = Number(required("expected-revision"));
    requireThat(
      Number.isSafeInteger(n) && n >= 0,
      "REVISION",
      "版本须为非负整数",
    );
    return n;
  };
  const request = () => required("request-id"),
    body = async () => (flags.file ? await readJSON(flags.file) : {});
  if (command === "workspace init")
    return answer(
      command,
      {
        workspace: (
          await NativeClient.initialize(words[0], required("ygl-entry"))
        ).root,
      },
      "initialized",
    );
  if (command === "context inspect") {
    const i = await inspectProject(required("file"));
    return answer(
      command,
      { manifest: i.manifest, project_id: i.snapshot.project_id },
      "verified",
    );
  }
  if (command === "context import")
    return answer(
      command,
      await importProject(required("file"), required("workspace"), {
        dryRun: flags["dry-run"],
        entry: flags["ygl-entry"],
        strategy: flags.strategy,
        name: flags.name,
      }),
    );
  if (command.startsWith("legacy ")) {
    const legacy = await import("./native/legacy.ts"),
      source = await legacy.readLegacy(
        flags.workspace,
        flags.project,
        flags.file,
      );
    if (command === "legacy inspect") {
      const mapped = legacy.legacySnapshot(source);
      return answer(command, {
        project_id: mapped.snapshot.project_id,
        mapping: mapped.mapping,
        progress: mapped.progress,
        source_access: "read-only",
      });
    }
    return answer(
      command,
      await legacy.migrateLegacy(
        source,
        required("to"),
        flags["dry-run"] ? "" : required("ygl-entry"),
        flags["dry-run"] ?? false,
      ),
    );
  }
  const client = await NativeClient.open(required("workspace"));
  if (command === "doctor")
    return answer(command, await client.raw(["doctor"]));
  if (command === "capabilities")
    return answer(command, {
      ...(await client.call("capabilities", {})),
      image_execution: "host-first",
      api_fallback: {
        implemented: true,
        automatic: false,
        protocol: "openai-images-edits/v1",
      },
    });
  if (command === "workspace register") {
    const config = await body();
    return answer(
      command,
      await registerWorkspace(
        client,
        words[0],
        config.authority_for ?? [],
        request(),
      ),
    );
  }
  if (command === "project brief")
    return answer(command, await client.call("brief", { project: words[0] }));
  if (command === "project timeline")
    return answer(
      command,
      await client.call("timeline", { project: words[0] }),
    );
  if (command === "context search")
    return answer(command, await searchContext(client, required("query")));
  const project = flags.project
    ? (await client.call("brief", { project: flags.project })).project.id
    : undefined;
  const needProject = () => {
    requireThat(project, "MISSING_PROJECT", "缺少 --project");
    return project as string;
  };
  if (command === "artifact export")
    return answer(
      command,
      await exportDocument(client, needProject(), words[0], required("to")),
    );
  if (command === "executor register")
    return answer(
      command,
      await registerExecutor(client, needProject(), await body(), request()),
    );
  if (command === "executor check")
    return answer(
      command,
      await checkExecutor(client, needProject(), words[0]),
    );
  if (command === "run execute-api")
    return answer(
      command,
      await executeApi(client, needProject(), words[0], {
        profileId: required("profile"),
        revision: revision(),
        requestId: request(),
      }),
    );
  if (command === "run recover-api")
    return answer(
      command,
      await recoverApi(client, needProject(), words[0], {
        fitInput: flags["fit-input"],
      }),
    );
  if (command === "run api-result")
    return answer(
      command,
      await reconcileApiResult(
        client,
        needProject(),
        words[0],
        required("file"),
        await readJSON(required("metadata")),
        revision(),
      ),
    );
  if (command === "run api-reconcile") {
    const record = await body();
    return answer(
      command,
      await client.call(
        "run-api-outcome",
        {
          project: needProject(),
          id: words[0],
          operation_key: record.operation_key,
          status: record.status,
          observed: {
            code: "API_PROVIDER_RECONCILED",
            statement: record.statement,
            source: record.source,
          },
          expected_revision: revision(),
        },
        request(),
      ),
    );
  }
  const method = async () => {
    if (!flags.method) return undefined;
    const a = await client.call("show", {
      project: needProject(),
      id: flags.method,
    });
    requireThat(
      a.kind === "methodology",
      "METHOD",
      "method 必须指向原生 methodology 工件",
    );
    return {
      ...JSON.parse(a.content),
      native_artifact_id: a.id,
      native_version: a.version,
      content_hash: (await import("./native/plugin/commands.mjs")).digest(
        a.content,
      ),
    };
  };
  if (command === "taste view")
    return answer(command, await taste(client, await method()));
  if (command === "context build")
    return answer(command, {
      current: await client.call("brief", { project: needProject() }),
      citations: await citationStatus(client, needProject()),
      references: await searchContext(client, required("query")),
      analysis: await taste(client, await method()),
      agent_task:
        "阅读来源的范围、保持项和用户结论，提出适合当前商品的专业建议；解释与用户事实分开；不得从频率推断满意度或因果。",
    });
  if (command === "context cite")
    return answer(
      command,
      await cite(client, needProject(), flags.task, await body(), request()),
    );
  if (command === "context export")
    return answer(
      command,
      await exportProject(client, needProject(), required("to")),
      "exported",
    );
  if (command === "asset add")
    return answer(
      command,
      await registerMedia(
        client,
        needProject(),
        required("task"),
        required("file"),
        { role: required("role"), parents: flags.parent ? [flags.parent] : [] },
        request(),
      ),
    );
  if (command === "asset resize")
    return answer(
      command,
      await resizeMedia(
        client,
        needProject(),
        words[0],
        Number(required("width")),
        Number(required("height")),
        request(),
      ),
    );
  if (command === "artifact deliver")
    return answer(
      command,
      await deliverArtifact(
        client,
        needProject(),
        words[0],
        required("to"),
        request(),
      ),
    );
  if (command === "run complete")
    return answer(
      command,
      await completeRun(
        client,
        needProject(),
        words[0],
        required("file"),
        revision(),
        request(),
        flags.metadata ? await readJSON(flags.metadata) : null,
      ),
    );
  if (command === "run deliver")
    return answer(
      command,
      await deliverRun(
        client,
        needProject(),
        words[0],
        required("to"),
        revision(),
        request(),
      ),
    );
  if (command === "index check" || command === "index rebuild") {
    const s = await client.call("snapshot", { project: needProject() });
    (await import("./native/plugin/commands.mjs")).validateSnapshot(s);
    for (const a of s.tables.artifacts.filter((a: any) => a.kind === "media"))
      await objectBytes(client.root, JSON.parse(a.meta));
    const results = [];
    for (const tree of s.tables.trees) {
      if (command === "index rebuild")
        await client.raw(["node", "index", "--tree", tree.name]);
      const result = await client.raw([
        "node",
        "validate",
        "--tree",
        tree.name,
      ]);
      requireThat(
        Array.isArray(result.issues) && !result.issues.length,
        "NATIVE_INDEX",
        "原生图索引验证失败",
        1,
      );
      results.push(result);
    }
    return answer(
      command,
      {
        project_id: s.project_id,
        fingerprint: s.fingerprint,
        results,
        image_execution: "NOT_RUN",
      },
      "verified",
    );
  }
  if (
    ["design register", "spec register", "method register"].includes(command)
  ) {
    const input = await body(),
      kind = command.startsWith("design")
        ? "design"
        : command.startsWith("method")
          ? "methodology"
          : "spec";
    return answer(
      command,
      await client.call(
        "document",
        {
          ...input,
          kind,
          project: needProject(),
          ...(flags.task ? { task: flags.task } : {}),
          ...(kind === "methodology"
            ? {
                content: JSON.stringify(input.method),
                role: "agent-interpretation",
              }
            : {}),
        },
        request(),
      ),
    );
  }
  requireThat(spec.action, "COMMAND", "未接入原生路由");
  const input = spec.readonly ? {} : await body();
  requireThat(
    input && typeof input === "object" && !Array.isArray(input),
    "INPUT",
    "请求须为对象",
  );
  const payload: any = { ...input, ...(project ? { project } : {}) };
  if (words[0])
    payload[
      [
        "requirements",
        "plan",
        "grant",
        "run-start",
        "task-close",
        "task-context-review",
      ].includes(spec.action)
        ? "task"
        : "id"
    ] = words[0];
  if (spec.flags.includes("expected-revision"))
    payload.expected_revision = revision();
  if (spec.flags.includes("expected-version")) {
    const n = Number(required("expected-version"));
    requireThat(
      Number.isSafeInteger(n) && n > 0,
      "DOCUMENT_PRECONDITION",
      "工件版本须为正整数",
    );
    payload.expected_version = n;
    payload.expected_hash = required("expected-hash");
  }
  const data = await client.call(
    spec.action,
    payload,
    spec.readonly ? undefined : request(),
  );
  if (spec.action === "run-dispatch" && data.replayed)
    data.allow_execute = false;
  return answer(command, data);
}
export async function main(args: string[]) {
  try {
    const { command, result } = await execute(args);
    const output = {
      schema_version: "retouch.cli/v2",
      ok: true,
      command: command.replaceAll(" ", "."),
      ...result,
    };
    process.stdout.write(
      JSON.stringify(
        output,
        args.includes("--json") ? undefined : null,
        args.includes("--json") ? undefined : 2,
      ) + "\n",
    );
  } catch (error) {
    const nativeError = error as Error & { code?: string; rc?: number };
    const e =
      error instanceof RetouchError
        ? error
        : nativeError.code && nativeError.rc
          ? new RetouchError(
              nativeError.code,
              nativeError.message,
              nativeError.rc,
            )
          : new RetouchError("RUNTIME_ERROR", (error as Error).message, 1);
    const output = {
      schema_version: "retouch.cli/v2",
      ok: false,
      result_status: "error",
      error: {
        code: e.code,
        message: e.message,
        effect_status: e.effectStatus,
      },
    };
    process.stdout.write(JSON.stringify(output) + "\n");
    process.exitCode = e.exitCode;
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main(process.argv.slice(2));
