// E-commerce profile on ygl's native entities and transaction/event services (pinned 0.125.0).
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { apiProfile, apiPrompt } from "./api-contract.mjs";
import { rawRating, effectiveRating } from "./feedback.mjs";
import { productFacts, factCheck, renderFacts } from "./product-facts.mjs";
import {
  taskBinding,
  sameBinding,
  mediaApplicable,
  acceptedReview,
  deliveryBindingCurrent,
} from "./applicability.mjs";
import { stable, digest } from "./value.mjs";
export { stable, digest } from "./value.mjs";
import {
  flowBrief,
  planContracts,
  assertInvariants,
  invariantView,
  coverageView,
  validateFlowSnapshot,
  assertStepCoverage,
  latest as latestFlow,
} from "./flow-contracts.mjs";
import { flowActions, flowReadActions, flowCommand } from "./flow-commands.mjs";
import {
  requestedDimensions,
  dimensionView,
  freezeDimension,
} from "./media-diagnostics.mjs";

export const SCHEMA = "retouch.native/v1";
const uid = () => crypto.randomUUID().replaceAll("-", "");
const timestamp = () => new Date().toISOString();
export function check(ok, code, message, rc = 2) {
  if (!ok) throw Object.assign(new Error(message), { code, rc });
}
const text = (v, name) => {
  check(
    typeof v === "string" && v.trim().length > 0 && v.length < 200000,
    "INPUT",
    name + " 必须是非空文字",
  );
  return v.trim();
};
const json = (value) =>
  typeof value === "string" && value ? JSON.parse(value) : value || {};
export const tags = (value) => {
  check(
    Array.isArray(value) &&
      value.length <= 100 &&
      value.every(
        (t) =>
          typeof t === "string" &&
          t.trim() &&
          t.length <= 120 &&
          !/[,\r\n]/.test(t),
      ),
    "TAGS",
    "标签须为最多 100 个非空短文本，不含逗号或换行",
  );
  return [...new Set(value.map((t) => t.normalize("NFC").trim()))].sort();
};
export function assertNoCredentials(value, key = "") {
  check(
    !/^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret|credentials|environment|headers)$/i.test(
      key,
    ),
    "CONTEXT_CREDENTIAL",
    "业务上下文包含受保护配置字段，请先去敏",
    1,
  );
  if (typeof value === "string") {
    check(
      !/(?:Bearer\s+[a-zA-Z0-9._-]{12,}|\bsk-[a-zA-Z0-9_-]{16,}|[?&](?:api[_-]?key|token|signature|x-amz-signature|sig)=\S+)/i.test(
        value,
      ),
      "CONTEXT_CREDENTIAL",
      "业务上下文包含凭证或签名 URL，请先去敏",
      1,
    );
    if (["content", "meta", "payload"].includes(key)) {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === "object") assertNoCredentials(parsed);
      } catch (e) {
        if (e.code === "CONTEXT_CREDENTIAL") throw e;
      }
    }
  } else if (Array.isArray(value)) value.forEach((v) => assertNoCredentials(v));
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) assertNoCredentials(v, k);
}

function engine() {
  const require = createRequire(import.meta.url);
  let root = path.dirname(process.argv[1]);
  for (let n = 0; n < 8; n++, root = path.dirname(root)) {
    try {
      const info = require(path.join(root, "package.json"));
      if (info.name !== "ygl-trees") continue;
      check(
        info.version === "0.125.0",
        "ENGINE_VERSION",
        "此原生扩展仅验收 ygl-trees 0.125.0",
        1,
      );
      return {
        ...require(
          path.join(root, "dist/packages/research/pipeline/src/writes.js"),
        ),
        ...require(path.join(root, "dist/packages/core/database/src/orm.js")),
        graph: require(
          path.join(root, "dist/packages/techtree/model/src/writes.js"),
        ),
        ngram: require(path.join(root, "dist/packages/core/text/src/text.js"))
          .ngram,
      };
    } catch (error) {
      if (error.code === "ENGINE_VERSION") throw error;
      if (error.code !== "MODULE_NOT_FOUND") throw error;
    }
  }
  throw Object.assign(new Error("无法定位原生 ygl 发行包"), {
    code: "ENGINE_BINDING",
    rc: 1,
  });
}
async function one(mgr, sql, params = []) {
  return (await mgr.query(sql, params))[0] || null;
}
async function project(mgr, ref) {
  const p = await one(mgr, "SELECT * FROM projects WHERE id=? OR name=?", [
    ref,
    ref,
  ]);
  check(p, "NOT_FOUND", "project not found: " + ref, 1);
  return p;
}
async function artifact(mgr, ref, p, kind) {
  const a = await one(
    mgr,
    "SELECT * FROM artifacts WHERE id=? AND project_id=?",
    [ref, p.id],
  );
  check(
    a && (!kind || a.kind === kind),
    "NOT_FOUND",
    (kind || "artifact") + " not found: " + ref,
    1,
  );
  return a;
}
async function rootNode(mgr, p) {
  const node = await one(
    mgr,
    "SELECT n.* FROM nodes n JOIN trees t ON t.id=n.tree_id WHERE t.project_id=? AND n.key='project'",
    [p.id],
  );
  check(
    node && json(node.payload).schema === SCHEMA,
    "PROFILE_MISSING",
    "项目缺少电商原生 profile",
    1,
  );
  return node;
}
async function relation(mgr, src_type, src_id, dst_type, dst_id, rel) {
  const found = await one(
    mgr,
    "SELECT id FROM relations WHERE src_type=? AND src_id=? AND dst_type=? AND dst_id=? AND rel=?",
    [src_type, src_id, dst_type, dst_id, rel],
  );
  if (!found)
    await mgr.query(
      "INSERT INTO relations(id,src_type,src_id,dst_type,dst_id,rel,weight,created) VALUES(?,?,?,?,?,?,1,?)",
      [uid(), src_type, src_id, dst_type, dst_id, rel, timestamp()],
    );
}
async function refreshGraph(mgr, api, treeId) {
  await api.graph.rebuildClosure(mgr, treeId);
  await api.graph.buildIndex(mgr, treeId);
  for (const n of await mgr.query("SELECT * FROM nodes WHERE tree_id=?", [
    treeId,
  ])) {
    await mgr.query("DELETE FROM nodes_fts WHERE id=?", [n.id]);
    await mgr.query(
      "INSERT INTO nodes_fts(id,key,name,tags,ngram) VALUES(?,?,?,?,?)",
      [
        n.id,
        n.key,
        n.name,
        n.tags,
        api.ngram([n.key, n.name, n.tags].join(" ")),
      ],
    );
  }
}
async function stepNode(mgr, treeId, planId, position) {
  const n = await one(mgr, "SELECT * FROM nodes WHERE tree_id=? AND key=?", [
    treeId,
    "step-" + planId + "-" + position,
  ]);
  check(n, "STEP_GRAPH_MISSING", "计划缺少原生步骤节点；先核验或迁移原生图", 1);
  return n;
}
async function stepState(mgr, treeId, context, nodeId, status) {
  await mgr.query(
    "INSERT INTO node_state(tree_id,context,node_id,status,level,progress,updated) VALUES(?,?,?,?,?,?,?) ON CONFLICT(tree_id,context,node_id) DO UPDATE SET status=excluded.status,level=excluded.level,progress=excluded.progress,updated=excluded.updated",
    [
      treeId,
      context,
      nodeId,
      status,
      status === "unlocked" ? 1 : 0,
      status === "unlocked" ? 1 : 0,
      timestamp(),
    ],
  );
}
async function append(mgr, p, kind, title, content, meta = {}) {
  const v = await one(
    mgr,
    "SELECT COALESCE(MAX(version),0)+1 AS v FROM artifacts WHERE project_id=? AND kind=? AND title=?",
    [p.id, kind, title],
  );
  const a = {
    id: uid(),
    project_id: p.id,
    kind,
    title,
    format: typeof content === "string" ? "markdown" : "json",
    content: typeof content === "string" ? content : stable(content),
    version: Number(v.v),
    created: timestamp(),
    updated: "",
    meta: stable(meta),
  };
  await mgr.query(
    "INSERT INTO artifacts(id,project_id,kind,title,format,content,version,created,updated,meta) VALUES(?,?,?,?,?,?,?,?,?,?)",
    Object.values(a),
  );
  return a;
}
const documentKinds = ["design", "spec", "citation", "methodology", "note"];
export function documentSeries(a, artifacts) {
  if (a.kind === "citation") return [a]; // Each citation is an immutable, independently pinned snapshot.
  return [a, ...artifacts.filter((x) => x.id !== a.id)]
    .filter(
      (x) =>
        x.project_id === a.project_id &&
        x.kind === a.kind &&
        x.title === a.title,
    )
    .sort((x, y) => x.version - y.version || x.id.localeCompare(y.id));
}
export function documentDescriptor(a, artifacts) {
  const versions = documentSeries(a, artifacts),
    current = versions.at(-1),
    meta = json(a.meta);
  return {
    authority: "native-artifact",
    project_id: a.project_id,
    artifact_id: a.id,
    kind: a.kind,
    title: a.title,
    version: a.version,
    content_hash: digest(a.content),
    format: a.format,
    role: meta.role ?? "reference",
    task_id: meta.task_id ?? null,
    goal_id: meta.goal_id ?? null,
    current_id: current.id,
    current_version: current.version,
    status:
      a.kind === "citation"
        ? "pinned-snapshot"
        : a.id === current.id
          ? "observed-current"
          : "superseded",
    previous_id:
      meta.previous ??
      versions[versions.findIndex((x) => x.id === a.id) - 1]?.id ??
      null,
    revision_reason: meta.revision_reason ?? null,
    source: meta.source ?? null,
    confirmation_source: meta.confirmation_source ?? null,
    ...(meta.design_type ? { design_type: meta.design_type } : {}),
    ...(meta.citation ? { citation: meta.citation } : {}),
  };
}
async function documentRows(mgr, a) {
  if (a.kind === "citation") return [a];
  return mgr.query(
    "SELECT * FROM artifacts WHERE project_id=? AND kind=? AND title=? ORDER BY version,id",
    [a.project_id, a.kind, a.title],
  );
}
async function requireNewDocument(mgr, p, kind, title) {
  check(
    !(await one(
      mgr,
      "SELECT id FROM artifacts WHERE project_id=? AND kind=? AND title=?",
      [p.id, kind, title],
    )),
    "DOCUMENT_EXISTS",
    "同名原生工件已存在；先读取 ID，再用 artifact revise 修订",
    1,
  );
}
function validateDocumentRole(b) {
  check(
    [
      "user-original",
      "confirmed-fact",
      "agent-interpretation",
      "hypothesis",
      "reference",
    ].includes(b.role),
    "ROLE",
    "必须区分原文、事实、解释、假设和参考",
  );
  if (b.role === "confirmed-fact") text(b.confirmation_source, "事实确认依据");
}
function goalContent(b) {
  text(b.scope, "范围");
  text(b.done_when, "完成条件");
  check(
    Array.isArray(b.preserve) && b.preserve.every((v) => typeof v === "string"),
    "PRESERVE",
    "保持项须为文字数组",
  );
  check(
    ["pending", "confirmed"].includes(b.confirmation ?? "pending") &&
      (b.confirmation !== "confirmed" ||
        (typeof b.confirmation_source === "string" &&
          b.confirmation_source.trim())),
    "GOAL_CONFIRMATION",
    "确认目标须有实际依据",
  );
  return {
    schema: SCHEMA,
    role: "goal",
    original_text: b.original_text ?? null,
    interpretation: b.interpretation ?? null,
    confirmation: b.confirmation ?? "pending",
    confirmation_source: b.confirmation_source ?? null,
    scope: b.scope,
    preserve: b.preserve,
    done_when: b.done_when,
    facts: b.facts ?? [],
    source: text(b.source, "来源"),
  };
}
async function invalidateDocumentTasks(mgr, p, ids, design) {
  const tasks = await mgr.query(
    "SELECT * FROM artifacts WHERE project_id=? AND kind='task'",
    [p.id],
  );
  const affected = new Set(ids);
  let changed;
  do {
    changed = false;
    for (const t of tasks) {
      if (
        !affected.has(t.id) &&
        (json(t.meta).retouch?.dependencies ?? []).some((id) =>
          affected.has(id),
        )
      ) {
        affected.add(t.id);
        changed = true;
      }
    }
  } while (changed);
  for (const t of tasks.filter((x) => affected.has(x.id))) {
    const meta = json(t.meta);
    if (design && ids.includes(t.id)) meta.retouch.design_id = design.id;
    meta.retouch.context_status = "needs_review";
    if (meta.status === "done") {
      meta.status = "doing";
      meta.status_at = timestamp();
    }
    await updateTask(mgr, t, meta, meta.retouch.revision);
    const taskNode = await one(
      mgr,
      "SELECT n.id,n.tree_id FROM nodes n JOIN trees tr ON tr.id=n.tree_id WHERE tr.project_id=? AND n.key=?",
      [p.id, "task-" + t.id],
    );
    if (taskNode)
      await stepState(mgr, taskNode.tree_id, "default", taskNode.id, "locked");
  }
}
async function profile(mgr, p, node) {
  return artifact(mgr, json(node.payload).profile_id, p, "profile");
}
async function updateProfile(mgr, p, node, patch, expected) {
  const previous = await profile(mgr, p, node);
  check(
    previous.version === expected,
    "REVISION_CONFLICT",
    "项目 profile 已变化，请先读 brief",
    1,
  );
  const value = { ...json(previous.content), ...patch };
  const next = await append(
    mgr,
    p,
    "profile",
    "E-commerce project profile",
    value,
    { schema: SCHEMA, previous: previous.id },
  );
  await relation(
    mgr,
    "artifact",
    previous.id,
    "artifact",
    next.id,
    "superseded-by",
  );
  await relation(mgr, "node", node.id, "artifact", next.id, "described-by");
  await mgr.query("UPDATE nodes SET payload=?,tags=? WHERE id=?", [
    stable({ ...json(node.payload), profile_id: next.id }),
    value.tags.join(","),
    node.id,
  ]);
  await mgr.query("DELETE FROM nodes_fts WHERE id=?", [node.id]);
  // The pinned engine rebuilds the native search/index below before returning.
  return next;
}
async function task(mgr, p, id) {
  const a = await artifact(mgr, id, p, "task");
  return { a, meta: json(a.meta) };
}
async function updateTask(mgr, a, meta, expected) {
  check(
    (json(a.meta).retouch?.revision ?? 0) === expected,
    "REVISION_CONFLICT",
    "任务已变化，请先读取当前任务",
    1,
  );
  meta.retouch.revision = expected + 1;
  await mgr.query("UPDATE artifacts SET meta=?,updated=? WHERE id=?", [
    stable(meta),
    timestamp(),
    a.id,
  ]);
  return { ...a, meta: stable(meta) };
}
export function pendingExecution(a, artifacts) {
  const m = json(a.meta);
  if (["unknown", "dispatched"].includes(m.status)) return true;
  if (m.status !== "received") return false;
  if (m.role !== "external" || !Array.isArray(m.outputs) || !m.outputs.length)
    return true;
  return !m.outputs.every((id) =>
    artifacts.some((x) => {
      const im = json(x.meta);
      return (
        x.id === id &&
        x.kind === "media" &&
        x.project_id === a.project_id &&
        im.task_id === m.task_id &&
        im.goal_id === m.goal_id &&
        ["model-output", "postprocess", "candidate"].includes(im.role) &&
        /^[a-f0-9]{64}$/.test(im.sha256)
      );
    }),
  );
}
function currentImageDeliveries(t, artifacts) {
  const tr = json(t.meta).retouch;
  return artifacts.filter((x) => {
    const m = json(x.meta);
    if (m.task_id !== t.id || m.status !== "completed") return false;
    if (x.kind === "execution") {
      const image = artifacts.find((a) => a.id === m.accepted_id);
      return (
        m.role === "workflow-run" &&
        m.plan_id === tr.plan_id &&
        m.goal_id === tr.goal_id &&
        json(x.content).requirements_hash === digest(tr.requirements) &&
        image &&
        ["PASS", "NOT_DECLARED"].includes(
          invariantView(artifacts, image, t).status,
        )
      );
    }
    if (x.kind !== "delivery") return false;
    const image = artifacts.find((a) => a.id === m.media_id),
      im = image && json(image.meta);
    return (
      im &&
      im.task_id === t.id &&
      mediaApplicable(image, t, artifacts, digest) &&
      deliveryBindingCurrent(x, image, t, digest) &&
      m.sha256 === im.sha256 &&
      /^[a-f0-9]{64}$/.test(m.manifest_sha256) &&
      ["PASS", "NOT_DECLARED"].includes(
        invariantView(artifacts, image, t).status,
      ) &&
      artifacts.some((r) => {
        return acceptedReview(r, image, t, artifacts, digest);
      })
    );
  });
}
const currentImageDelivery = (t, artifacts) =>
  currentImageDeliveries(t, artifacts).length > 0;
function businessHealth(artifacts, tasks) {
  const findings = [];
  for (const a of artifacts) {
    const m = json(a.meta);
    if (
      a.kind === "execution" &&
      m.status === "received" &&
      pendingExecution(a, artifacts)
    )
      findings.push({
        code:
          m.role === "external"
            ? "EXTERNAL_RESULT_INCOMPLETE"
            : "LOCAL_RECOVERY_PENDING",
        severity: m.role === "external" ? "error" : "info",
        artifact_id: a.id,
        task_id: m.task_id,
      });
    if (a.kind === "delivery" && m.status === "preparing")
      findings.push({
        code: "DELIVERY_PREPARING",
        severity: "info",
        artifact_id: a.id,
        task_id: m.task_id,
        next_action:
          m.role === "suite-export"
            ? "replay same suite export key and file"
            : "replay original delivery or delivery abandon after inspection",
      });
  }
  for (const t of tasks) {
    if (t.meta.retouch?.kind !== "image") continue;
    const delivered = currentImageDelivery(
      { ...t, meta: stable(t.meta) },
      artifacts,
    );
    if (t.meta.status === "done" && !delivered)
      findings.push({
        code: "CLOSED_WITHOUT_CURRENT_DELIVERY",
        severity: "error",
        task_id: t.id,
      });
    if (
      t.meta.status === "done" &&
      artifacts.some(
        (a) =>
          a.kind === "execution" &&
          json(a.meta).task_id === t.id &&
          pendingExecution(a, artifacts),
      )
    )
      findings.push({
        code: "CLOSED_WITH_PENDING_EXECUTION",
        severity: "error",
        task_id: t.id,
      });
    if (delivered && t.meta.status !== "done")
      findings.push({
        code: "TASK_READY_TO_CLOSE",
        severity: "info",
        task_id: t.id,
        next_action: "task close after checking remaining pending executions",
      });
  }
  return {
    status: findings.some((f) => f.severity === "error") ? "FAIL" : "PASS",
    findings,
  };
}
async function brief(mgr, p) {
  const node = await rootNode(mgr, p),
    current = await profile(mgr, p, node);
  const artifacts = await mgr.query(
    "SELECT * FROM artifacts WHERE project_id=? ORDER BY created,id",
    [p.id],
  );
  const tasks = artifacts
    .filter((a) => a.kind === "task")
    .map((a) => {
      const meta = json(a.meta),
        linked = artifacts.filter((x) => json(x.meta).task_id === a.id),
        runs = linked.filter((x) => x.kind === "execution");
      const unknown = runs.find((x) =>
        ["unknown", "dispatched"].includes(json(x.meta).status),
      );
      const active = runs.find((x) => x.id === meta.retouch?.active_run);
      const candidates = linked.filter(
        (x) =>
          x.kind === "media" &&
          !["original", "reference", "working"].includes(json(x.meta).role),
      );
      const currentCandidates = candidates.filter((x) =>
        mediaApplicable(x, a, artifacts, digest),
      );
      const goal = artifacts.find((x) => x.id === meta.retouch?.goal_id),
        stale =
          meta.retouch?.context_status === "needs_review" ||
          (goal &&
            artifacts.some(
              (x) =>
                x.kind === "spec" &&
                x.title === goal.title &&
                x.version > goal.version,
            ));
      const acceptedIds = new Set(
        artifacts
          .filter(
            (x) =>
              x.kind === "review" &&
              currentCandidates.some((image) =>
                acceptedReview(x, image, a, artifacts, digest),
              ),
          )
          .map((x) => json(x.meta).media_id),
      );
      const delivered = currentImageDelivery(a, artifacts);
      const progress = unknown
        ? "unknown"
        : stale
          ? "needs_review"
          : meta.status === "done"
            ? "completed"
            : active
              ? json(active.meta).status
              : delivered
                ? "delivered"
                : currentCandidates.some((x) => acceptedIds.has(x.id))
                  ? "accepted"
                  : currentCandidates.length
                    ? "waiting_for_review"
                    : candidates.length
                      ? "result_needs_review"
                      : meta.retouch?.kind === "design" &&
                          linked.some((x) => x.kind === "design")
                        ? "design_document_only"
                        : "planned";
      return {
        ...a,
        meta,
        progress,
        image_outputs: candidates.map((x) => ({
          id: x.id,
          role: json(x.meta).role,
          status: currentCandidates.includes(x)
            ? acceptedIds.has(x.id)
              ? "accepted"
              : "candidate"
            : "needs_review",
          width: json(x.meta).width,
          height: json(x.meta).height,
          sha256: json(x.meta).sha256,
        })),
      };
    });
  const ids = new Set(artifacts.map((a) => a.id));
  const relations = (await mgr.query("SELECT * FROM relations")).filter(
    (r) => ids.has(r.src_id) || ids.has(r.dst_id) || r.src_id === node.id,
  );
  const feedback = json(current.content);
  const unresolved = artifacts.filter(
    (a) =>
      a.kind === "execution" &&
      ["unknown", "dispatched"].includes(json(a.meta).status),
  );
  return {
    project: p,
    profile: { ...current, content: feedback },
    tasks,
    artifacts,
    documents: artifacts
      .filter((a) => documentKinds.includes(a.kind))
      .map((a) => documentDescriptor(a, artifacts))
      .filter((a) => a.status !== "superseded"),
    business_health: businessHealth(artifacts, tasks),
    ...flowBrief(artifacts),
    dimension_diagnostics: dimensionView(artifacts),
    executor_profiles: artifacts
      .filter((a) => a.kind === "executor-profile")
      .map((a) => ({
        id: a.id,
        version: a.version,
        created: a.created,
        profile: json(a.content).profile,
        credential_check: "NOT_RUN",
      })),
    executor_observations: artifacts
      .filter((a) => a.kind === "executor-observation")
      .sort((a, b) => b.created.localeCompare(a.created))
      .map((a) => ({ id: a.id, observed_at: a.created, ...json(a.content) })),
    relations,
    reminders: [
      effectiveRating(feedback) === null
        ? "可补充项目评分，保留用户原始量表"
        : "",
      !feedback.conclusion ? "可补充用户结语" : "",
      feedback.completion === null ? "可决定继续、停止或标记完结" : "",
    ].filter(Boolean),
    unknown_requests: unresolved.map((a) => ({
      id: a.id,
      task_id: json(a.meta).task_id,
      status: json(a.meta).status,
    })),
    next_actions: unresolved.length
      ? [{ type: "reconcile", reason: "先对账未知请求，不能重新出图" }]
      : tasks
          .filter(
            (t) =>
              t.progress === "needs_review" ||
              !["done", "cancelled"].includes(t.meta.status),
          )
          .map((t) => ({
            type:
              {
                waiting_for_review: "artifact.review",
                design_document_only: "design.review",
                accepted: "artifact.deliver",
                delivered: "task.close",
                received: "run recover-api",
                needs_review: "task.context-review",
              }[t.progress] ?? "task",
            id: t.id,
            status: t.progress,
            reason: t.meta.retouch?.done_when,
          })),
  };
}

export async function run(env, action, rest, args) {
  try {
    check(
      !rest.length &&
        Object.keys(args.flags).every((k) =>
          ["file", "home", "json", "no-color", "quiet"].includes(k),
        ),
      "FLAGS",
      "retouch-native 仅接受 action、--file、--home、--json",
    );
    check(
      typeof args.flags.file === "string",
      "INPUT",
      "需要 --file <request.json>",
    );
    const stat = await fs.lstat(args.flags.file);
    check(
      stat.isFile() && !stat.isSymbolicLink() && stat.size <= 32 * 1024 * 1024,
      "INPUT_SIZE",
      "请求文件无效或超过 32 MiB",
    );
    const req = JSON.parse(await fs.readFile(args.flags.file, "utf8"));
    check(
      req &&
        req.schema === SCHEMA &&
        req.body &&
        typeof req.body === "object" &&
        !Array.isArray(req.body),
      "SCHEMA",
      "原生请求 schema 无效",
    );
    assertNoCredentials(req.body);
    check(
      env.db && !process.env.YGL_DB_URL,
      "BACKEND",
      "当前扩展仅支持经过验收的 SQLite 原生工作区",
      1,
    );
    const api = engine(),
      ds = await api.getOrm(env.db.path);
    const b = req.body;
    const readOnly = [
      ...flowReadActions,
      "capabilities",
      "workspace-list",
      "projects",
      "brief",
      "snapshot",
      "show",
      "document-history",
      "business-check",
      "dimensions",
      "workspace-info",
      "restore-preview",
      "receipt",
      "search",
      "context",
      "bundle",
      "timeline",
      "task-view",
      "task-next",
      "task-list",
    ].includes(action);
    const result = await api.runTx(ds, async (mgr) => {
      if (action === "capabilities")
        return {
          schema: SCHEMA,
          engine: "0.125.0",
          storage: "native-projects-artifacts-nodes-relations-events",
          custom_tables: [],
          transactions: true,
          api_fallback: "explicit-images-edits-v1",
        };
      if (action === "workspace-info")
        return json(
          (
            await one(
              mgr,
              "SELECT value FROM meta WHERE key='retouch.workspace.identity'",
            )
          )?.value,
        );
      if (action === "workspace-list")
        return (
          await mgr.query(
            "SELECT value FROM meta WHERE key LIKE 'retouch.workspace.registered:%' ORDER BY key",
          )
        ).map((r) => json(r.value));
      if (action === "receipt")
        return (
          json(
            (
              await one(
                mgr,
                "SELECT payload FROM events WHERE kind='retouch.command' AND json_extract(payload,'$.request_id')=?",
                [text(b.request_id, "request_id")],
              )
            )?.payload,
          ) || null
        );
      if (action === "projects")
        return mgr.query(
          "SELECT p.* FROM projects p WHERE EXISTS(SELECT 1 FROM artifacts a WHERE a.project_id=p.id AND a.kind='profile') ORDER BY p.name",
        );
      const intent = digest({ action, body: b });
      if (!readOnly) {
        text(req.request_id, "request_id");
        const prior = await one(
          mgr,
          "SELECT payload FROM events WHERE kind='retouch.command' AND json_extract(payload,'$.request_id')=?",
          [req.request_id],
        );
        if (prior) {
          const receipt = json(prior.payload);
          check(
            receipt.intent === intent,
            "REQUEST_CONFLICT",
            "相同请求键携带不同意图",
            1,
          );
          return { ...receipt.result, replayed: true };
        }
      }
      let out;
      if (action === "workspace-init") {
        const prior = await one(
          mgr,
          "SELECT value FROM meta WHERE key='retouch.workspace.identity'",
        );
        check(!prior, "WORKSPACE_EXISTS", "工作区已具有原生身份", 1);
        out = { id: uid(), created: timestamp(), schema: SCHEMA };
        await mgr.query("INSERT INTO meta(key,value) VALUES(?,?)", [
          "retouch.workspace.identity",
          stable(out),
        ]);
      } else if (action === "workspace-register") {
        text(b.id, "workspace id");
        text(b.path, "workspace path");
        check(
          b.authority_for === undefined ||
            (Array.isArray(b.authority_for) &&
              b.authority_for.every((x) => typeof x === "string")),
          "AUTHORITY",
          "authority_for 须为明确项目 ID 数组",
        );
        out = {
          id: b.id,
          path: b.path,
          authority_for: b.authority_for ?? [],
          registered_at: timestamp(),
        };
        await mgr.query(
          "INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
          ["retouch.workspace.registered:" + b.id, stable(out)],
        );
      } else if (action === "project-new") {
        text(b.name, "项目名称");
        text(b.intent, "原始意图");
        check(
          !(await one(mgr, "SELECT id FROM projects WHERE name=?", [b.name])),
          "NAME_CONFLICT",
          "同名项目已存在",
          1,
        );
        const p = {
          id: uid(),
          name: b.name,
          question: b.intent,
          inclusion: "",
          exclusion: "",
          status: "active",
          created: timestamp(),
          updated: timestamp(),
        };
        await mgr.query(
          "INSERT INTO projects(id,name,question,inclusion,exclusion,status,created,updated) VALUES(?,?,?,?,?,?,?,?)",
          Object.values(p),
        );
        const treeId = uid(),
          nodeId = uid();
        await mgr.query(
          "INSERT INTO trees(id,project_id,name,note,created) VALUES(?,?,?,?,?)",
          [treeId, p.id, "retouch-" + p.id, "E-commerce workflow", timestamp()],
        );
        const initial = await append(
          mgr,
          p,
          "profile",
          "E-commerce project profile",
          {
            tags: tags(b.tags ?? []),
            rating: null,
            conclusion: "",
            completion: null,
            original_intent: b.intent,
            business_object: b.business_object ?? null,
          },
          { schema: SCHEMA, previous: null },
        );
        await mgr.query(
          "INSERT INTO nodes(id,tree_id,key,name,payload,tags,created) VALUES(?,?,?,?,?,?,?)",
          [
            nodeId,
            treeId,
            "project",
            b.name,
            stable({ schema: SCHEMA, profile_id: initial.id }),
            tags(b.tags ?? []).join(","),
            timestamp(),
          ],
        );
        await relation(
          mgr,
          "node",
          nodeId,
          "artifact",
          initial.id,
          "described-by",
        );
        out = { project: p, profile: initial, tree: "retouch-" + p.id };
        await refreshGraph(mgr, api, treeId);
      } else if (action === "restore" || action === "restore-preview") {
        if (action === "restore-preview") {
          b.preview_strategy = b.strategy ?? "restore";
          b.strategy = "preview";
        }
        out = await restore(mgr, api, b);
      } else {
        const p = await project(mgr, text(b.project, "project"));
        if (action === "brief") return brief(mgr, p);
        if (action === "business-check")
          return (await brief(mgr, p)).business_health;
        if (action === "dimensions") {
          if (b.id) await artifact(mgr, b.id, p, "media");
          return dimensionView(
            await mgr.query("SELECT * FROM artifacts WHERE project_id=?", [
              p.id,
            ]),
            b.id,
          );
        }
        if (["task-view", "task-next", "task-list"].includes(action)) {
          const view = await brief(mgr, p);
          if (action === "task-list") return { tasks: view.tasks };
          const t = view.tasks.find((t) => t.id === b.id);
          check(t, "NOT_FOUND", "task not found: " + b.id, 1);
          const relatedUnknown = view.unknown_requests.filter(
            (x) => x.task_id === t.id,
          );
          return {
            task: t,
            progress: t.progress,
            next_actions: relatedUnknown.length
              ? [
                  {
                    type: "execution.reconcile",
                    reason: "先对账该任务未知请求，不能重新出图",
                    requests: relatedUnknown,
                  },
                ]
              : view.next_actions.filter((x) => x.id === t.id),
          };
        }
        if (action === "context") {
          const view = await brief(mgr, p),
            s = await snapshot(mgr, p);
          return { view, fingerprint: s.fingerprint };
        }
        if (action === "bundle")
          return {
            view: await brief(mgr, p),
            snapshot: await snapshot(mgr, p),
          };
        if (action === "show" || action === "document-history") {
          const a = await artifact(mgr, text(b.id, "id"), p);
          if (!documentKinds.includes(a.kind)) {
            check(action === "show", "DOCUMENT_KIND", "历史入口只接受文档工件");
            return a;
          }
          const rows = await documentRows(mgr, a);
          if (action === "document-history")
            return {
              selected_id: a.id,
              current_id: rows.at(-1).id,
              versions: rows.map((x) => documentDescriptor(x, rows)),
            };
          return { ...a, native_document: documentDescriptor(a, rows) };
        }
        if (action === "snapshot") return snapshot(mgr, p);
        if (action === "timeline") {
          const artifacts = await mgr.query(
              "SELECT id FROM artifacts WHERE project_id=?",
              [p.id],
            ),
            nodes = await mgr.query(
              "SELECT n.id FROM nodes n JOIN trees t ON t.id=n.tree_id WHERE t.project_id=?",
              [p.id],
            ),
            ids = new Set([
              p.id,
              p.name,
              ...artifacts.map((a) => a.id),
              ...nodes.map((n) => n.id),
            ]);
          if (b.id) await artifact(mgr, b.id, p, "execution");
          const events = (
            await mgr.query("SELECT * FROM events ORDER BY rowid")
          ).filter((e) => ids.has(e.entity_id) && e.kind !== "cmd.run");
          return events
            .filter(
              (e) =>
                !b.id ||
                e.entity_id === b.id ||
                json(e.payload).context === b.id ||
                json(e.payload).result?.execution?.id === b.id,
            )
            .map((e) => ({ ...e, payload: json(e.payload) }));
        }
        if (action === "search") {
          const q = text(b.query, "query")
            .replaceAll("\\", "\\\\")
            .replaceAll("%", "\\%")
            .replaceAll("_", "\\_");
          const matches = await mgr.query(
            "SELECT * FROM artifacts WHERE project_id=? AND kind IN ('design','spec') AND (title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\') ORDER BY kind,title,version DESC LIMIT 100",
            [p.id, "%" + q + "%", "%" + q + "%"],
          );
          const documents = await mgr.query(
            "SELECT * FROM artifacts WHERE project_id=? AND kind IN ('design','spec')",
            [p.id],
          );
          return matches.map((a) => ({
            ...a,
            native_document: documentDescriptor(a, documents),
          }));
        }
        check(
          p.status === "active" ||
            ["project-feedback", "project-reopen", "delivery-abandon"].includes(
              action,
            ),
          "PROJECT_CLOSED",
          "项目已完结；新执行前须明确重新打开",
          1,
        );
        const node = await rootNode(mgr, p);
        if (
          action === "project-tags" ||
          action === "project-feedback" ||
          action === "project-close" ||
          action === "project-reopen"
        ) {
          let patch = {};
          if (action === "project-tags") {
            check(
              ["user", "authorized-agent"].includes(b.source),
              "TAG_SOURCE",
              "有效标签须来自用户或已授权维护；未采纳建议保存为 hypothesis 文档",
            );
            patch = { tags: tags(b.tags), tag_source: b.source };
          }
          if (action === "project-feedback") {
            check(
              b.source === "user",
              "FEEDBACK_SOURCE",
              "评分与结语必须来自用户，不能代填",
            );
            const rating_record =
              b.rating && typeof b.rating === "object"
                ? rawRating(b.rating)
                : null;
            check(
              b.rating === undefined ||
                b.rating === null ||
                rating_record ||
                (Number.isInteger(b.rating) && b.rating >= 1 && b.rating <= 5),
              "RATING",
              "评分须为原始量表对象、历史 1–5 整数或 null",
            );
            check(
              b.conclusion === undefined || typeof b.conclusion === "string",
              "CONCLUSION",
              "结语须为用户文字",
            );
            text(b.source, "反馈来源");
            patch = {
              ...(b.rating !== undefined
                ? { rating: rating_record ? null : b.rating, rating_record }
                : {}),
              ...(b.conclusion !== undefined
                ? { conclusion: b.conclusion }
                : {}),
              feedback_source: b.source,
            };
          }
          if (action === "project-close") {
            check(
              ["achieved", "stopped", "remaining"].includes(b.reason),
              "COMPLETION",
              "完结原因须为 achieved/stopped/remaining",
            );
            const view = await brief(mgr, p);
            if (b.reason === "achieved")
              check(
                ["PASS", "NOT_DECLARED"].includes(view.content_coverage.status),
                "CONTENT_COVERAGE",
                "内容覆盖未通过，不能声称目标全部达成",
                1,
              );
            patch = {
              completion: {
                reason: b.reason,
                statement: text(b.statement, "用户完结原文"),
                unresolved_tasks: view.next_actions,
                unknown_requests: view.unknown_requests,
                at: timestamp(),
              },
            };
            await mgr.query(
              "UPDATE projects SET status='archived',updated=? WHERE id=?",
              [timestamp(), p.id],
            );
          }
          if (action === "project-reopen") {
            patch = { completion: null };
            await mgr.query(
              "UPDATE projects SET status='active',updated=? WHERE id=?",
              [timestamp(), p.id],
            );
          }
          out = {
            profile: await updateProfile(
              mgr,
              p,
              node,
              patch,
              b.expected_revision,
            ),
          };
          await refreshGraph(mgr, api, node.tree_id);
        } else if (action === "goal-new") {
          text(b.title, "目标");
          await requireNewDocument(mgr, p, "spec", b.title);
          const a = await append(mgr, p, "spec", b.title, goalContent(b), {
            schema: SCHEMA,
            role: "goal",
          });
          await relation(
            mgr,
            "node",
            node.id,
            "artifact",
            a.id,
            "specified-by",
          );
          out = { artifact: a };
        } else if (action === "task-new") {
          const goal = await artifact(mgr, b.goal, p, "spec");
          check(
            json(goal.meta).role === "goal",
            "GOAL",
            "必须绑定原生目标 spec",
          );
          text(b.title, "任务");
          text(b.brief, "任务原文");
          text(b.expected_output, "交付物");
          text(b.done_when, "完成条件");
          check(
            ["unspecified", "concept", "product-accurate"].includes(
              b.purpose ?? "unspecified",
            ),
            "TASK_PURPOSE",
            "须明确合法的任务用途",
          );
          check(
            ["image", "design"].includes(b.kind),
            "TASK_KIND",
            "任务类型须为 image/design",
          );
          const deps = b.dependencies ?? [];
          check(Array.isArray(deps), "DEPENDENCIES", "依赖须为任务 ID 数组");
          for (const dep of deps) await artifact(mgr, dep, p, "task");
          const a = await append(mgr, p, "task", b.title, b.brief, {
            status: "todo",
            status_at: timestamp(),
            retouch: {
              schema: SCHEMA,
              revision: 0,
              goal_id: goal.id,
              goal_version: goal.version,
              expected_output: b.expected_output,
              done_when: b.done_when,
              kind: b.kind,
              purpose: b.purpose ?? "unspecified",
              dependencies: deps,
              requirements: [],
              plan_id: null,
            },
          });
          const nid = uid();
          await mgr.query(
            "INSERT INTO nodes(id,tree_id,key,name,payload,created) VALUES(?,?,?,?,?,?)",
            [
              nid,
              node.tree_id,
              "task-" + a.id,
              b.title,
              stable({ schema: SCHEMA, task_id: a.id }),
              timestamp(),
            ],
          );
          await relation(mgr, "node", nid, "task", a.id, "tracked-by");
          await relation(
            mgr,
            "task",
            a.id,
            "artifact",
            goal.id,
            "specified-by",
          );
          for (const dep of deps) {
            const parent = await one(
              mgr,
              "SELECT id FROM nodes WHERE tree_id=? AND key=?",
              [node.tree_id, "task-" + dep],
            );
            check(parent, "DEPENDENCY_NODE", "依赖任务缺少原生节点", 1);
            await mgr.query(
              "INSERT INTO node_edges(id,tree_id,parent_id,child_id,created) VALUES(?,?,?,?,?)",
              [uid(), node.tree_id, parent.id, nid, timestamp()],
            );
          }
          await refreshGraph(mgr, api, node.tree_id);
          out = { task: a };
        } else if (action === "requirements") {
          const { a, meta } = await task(mgr, p, b.task);
          check(
            Array.isArray(b.groups) &&
              b.groups.every(
                (g) =>
                  g &&
                  typeof g.id === "string" &&
                  typeof g.text === "string" &&
                  typeof g.disabled === "boolean" &&
                  ["operation", "preserve", "reference"].includes(g.scope),
              ),
            "REQUIREMENTS",
            "需求组须有 id/text/disabled/scope",
          );
          check(
            new Set(b.groups.map((g) => g.id)).size === b.groups.length,
            "REQUIREMENTS",
            "需求组 ID 不得重复",
          );
          await noUnknown(mgr, p, a.id);
          meta.retouch.requirements = b.groups;
          meta.retouch.plan_id = null;
          meta.retouch.active_run = null;
          if (meta.status === "done") {
            meta.status = "todo";
            meta.status_at = timestamp();
          }
          out = { task: await updateTask(mgr, a, meta, b.expected_revision) };
        } else {
          out = await workflow({ mgr, api, p, node, b, action });
        }
      }
      if (!readOnly)
        await api.logEvent(
          mgr,
          "retouch.command",
          "project",
          out?.project?.id || b.project || "",
          { request_id: req.request_id, intent, action, result: out },
        );
      return out;
    });
    console.log(JSON.stringify({ schema: SCHEMA, ok: true, result }));
    return 0;
  } catch (error) {
    console.log(
      JSON.stringify({
        schema: SCHEMA,
        ok: false,
        error: {
          code: error.code || "NATIVE_ERROR",
          message: error.code
            ? error.message
            : "原生操作未完成；请检查工作区与版本",
          effect_status: "none",
        },
      }),
    );
    return error.rc || 1;
  }
}

async function currentTask(mgr, p, taskId) {
  const t = await task(mgr, p, taskId);
  const goal = await artifact(mgr, t.meta.retouch.goal_id, p, "spec");
  const latest = await one(
    mgr,
    "SELECT MAX(version) AS v FROM artifacts WHERE project_id=? AND kind='spec' AND title=?",
    [p.id, goal.title],
  );
  check(
    goal.version === latest.v,
    "GOAL_STALE",
    "目标已更新，先复核任务和计划",
    1,
  );
  check(
    t.meta.retouch.context_status !== "needs_review",
    "CONTEXT_STALE",
    "迁移后的任务上下文尚待复核",
    1,
  );
  return t;
}
async function noUnknown(mgr, p, taskId) {
  const rows = await mgr.query(
    "SELECT * FROM artifacts WHERE project_id=? AND kind IN ('execution','media') AND json_extract(meta,'$.task_id')=?",
    [p.id, taskId],
  );
  const ex = rows
    .filter((a) => a.kind === "execution")
    .sort(
      (a, b) =>
        Number(json(a.meta).status === "received") -
        Number(json(b.meta).status === "received"),
    )
    .find((a) => pendingExecution(a, rows));
  check(
    !ex,
    ex && json(ex.meta).status === "received"
      ? "RESULT_PENDING"
      : "UNKNOWN_PENDING",
    "存在待对账或待本地恢复的执行：" + ex?.id + "，不能发起新请求",
    1,
  );
}
async function media(mgr, p, id) {
  return artifact(mgr, id, p, "media");
}
async function execution(mgr, p, id) {
  const a = await artifact(mgr, id, p, "execution");
  return { a, meta: json(a.meta) };
}
async function localGrant(mgr, grant, identity) {
  const m = json(grant.meta);
  const imported = await one(
    mgr,
    "SELECT id FROM events WHERE kind='retouch.import' AND EXISTS(SELECT 1 FROM json_each(json_extract(events.payload,'$.authorization_ids')) WHERE value=?)",
    [grant.id],
  );
  check(
    !imported &&
      m.workspace_id === identity.id &&
      new Date(m.expires_at).getTime() > Date.now(),
    "GRANT_INVALID",
    "授权属于历史导入、其他工作区或已过期",
    1,
  );
  return m;
}
async function updateExecution(mgr, a, meta, expected) {
  check(
    json(a.meta).revision === expected,
    "REVISION_CONFLICT",
    "执行记录已变化，请刷新",
    1,
  );
  meta.revision = expected + 1;
  await mgr.query("UPDATE artifacts SET meta=?,updated=? WHERE id=?", [
    stable(meta),
    timestamp(),
    a.id,
  ]);
  return { ...a, meta: stable(meta) };
}
async function workflow({ mgr, api, p, node, b, action }) {
  if (flowActions.includes(action))
    return flowCommand(action, b, {
      mgr,
      api,
      p,
      node,
      append,
      artifact,
      task,
      currentTask,
      relation,
      updateTask,
      noUnknown,
      invalidateDocumentTasks,
    });
  if (action === "executor-observe") {
    check(
      ["available", "unavailable", "unknown"].includes(b.state),
      "HOST_CAPABILITY",
      "内置工具状态须为 available/unavailable/unknown",
    );
    const a = await append(
      mgr,
      p,
      "executor-observation",
      "Host image capability",
      {
        state: b.state,
        source: text(b.source, "实际宿主能力观察来源"),
        not_execution_authorization: true,
      },
      { schema: SCHEMA, role: "host-capability" },
    );
    await relation(mgr, "node", node.id, "artifact", a.id, "observed-by");
    return { observation: a };
  }
  if (action === "facts-register") {
    await requireNewDocument(mgr, p, "spec", "Product facts");
    const artifacts = await mgr.query(
      "SELECT * FROM artifacts WHERE project_id=?",
      [p.id],
    );
    const content = productFacts(b.facts, artifacts);
    const a = await append(mgr, p, "spec", "Product facts", content, {
      schema: SCHEMA,
      role: "product-facts",
      source: text(b.source, "事实记录来源"),
    });
    await relation(mgr, "node", node.id, "artifact", a.id, "specified-by");
    for (const f of content.fields)
      await relation(
        mgr,
        "artifact",
        a.id,
        "artifact",
        f.source.artifact_id,
        "derived-from",
      );
    return { artifact: a, native_document: documentDescriptor(a, [a]) };
  }
  if (action === "executor-register") {
    const config = apiProfile(b.profile);
    text(b.title, "执行配置名称");
    check(
      /^[a-f0-9]{64}$/.test(b.endpoint_fingerprint),
      "API_BINDING",
      "执行配置必须绑定当前 endpoint 指纹",
    );
    const a = await append(
      mgr,
      p,
      "executor-profile",
      b.title,
      { profile: config, endpoint_fingerprint: b.endpoint_fingerprint },
      { schema: SCHEMA, role: "explicit-api-fallback" },
    );
    await relation(mgr, "node", node.id, "artifact", a.id, "configured-by");
    return { profile: a };
  }
  if (action === "document") {
    check(
      ["spec", "design", "citation", "methodology", "note"].includes(b.kind),
      "KIND",
      "文档类型无效",
    );
    const t = b.task ? await task(mgr, p, b.task) : null;
    text(b.title, "标题");
    text(b.content, "正文");
    validateDocumentRole(b);
    if (["design", "spec"].includes(b.kind))
      await requireNewDocument(mgr, p, b.kind, b.title);
    const a = await append(mgr, p, b.kind, b.title, b.content, {
      schema: SCHEMA,
      role: b.role,
      source: b.source ?? "",
      confirmation_source: b.confirmation_source ?? null,
      task_id: t?.a.id ?? null,
      goal_id: t?.meta.retouch.goal_id ?? null,
      ...(b.kind === "design" ? { design_type: b.design_type ?? "arch" } : {}),
      ...(b.citation ? { citation: b.citation } : {}),
    });
    await relation(
      mgr,
      t ? "task" : "node",
      t?.a.id ?? node.id,
      "artifact",
      a.id,
      b.kind === "citation" ? "references" : "described-by",
    );
    if (t && b.kind === "design") {
      const previous = t.meta.retouch.design_id;
      t.meta.retouch.design_id = a.id;
      if (t.meta.retouch.plan_id || previous)
        t.meta.retouch.context_status = "needs_review";
      if (t.meta.status === "done") {
        t.meta.status = "doing";
        t.meta.status_at = timestamp();
      }
      await updateTask(mgr, t.a, t.meta, t.meta.retouch.revision);
      for (const dependent of await mgr.query(
        "SELECT * FROM artifacts WHERE project_id=? AND kind='task' AND id<>?",
        [p.id, t.a.id],
      )) {
        const dm = json(dependent.meta);
        if ((dm.retouch?.dependencies ?? []).includes(t.a.id)) {
          dm.retouch.context_status = "needs_review";
          await updateTask(mgr, dependent, dm, dm.retouch.revision);
        }
      }
    }
    return {
      artifact: a,
      native_document: documentDescriptor(a, await documentRows(mgr, a)),
    };
  }
  if (action === "document-revise") {
    check(
      Object.keys(b).every((key) =>
        [
          "project",
          "id",
          "expected_version",
          "expected_hash",
          "content",
          "reason",
          "source",
          "role",
          "confirmation_source",
          "design_type",
        ].includes(key),
      ),
      "DOCUMENT_FIELDS",
      "修订不能更改类型、标题、任务或原生元数据；读取原 ID 后提交正文",
    );
    const old = await artifact(mgr, text(b.id, "id"), p),
      meta = json(old.meta);
    check(
      ["design", "spec"].includes(old.kind) && meta.role !== "workflow-plan",
      "DOCUMENT_KIND",
      "只修订 design/spec；冻结计划使用 plan submit，citation 保持精确快照",
    );
    const rows = await documentRows(mgr, old);
    check(
      Number.isSafeInteger(b.expected_version) &&
        b.expected_version > 0 &&
        /^[a-f0-9]{64}$/.test(b.expected_hash),
      "DOCUMENT_PRECONDITION",
      "修订须提供已读取的原生 version 和 content_hash",
    );
    check(
      old.id === rows.at(-1).id &&
        b.expected_version === old.version &&
        b.expected_hash === digest(old.content),
      "DOCUMENT_STALE",
      "工件已变化或读取条件不符；先读取当前工件，不能从旧副本追加版本",
      1,
    );
    text(b.reason, "修订原因");
    text(b.source, "修订来源");
    let content;
    if (meta.role === "product-facts") {
      check(
        b.role === undefined &&
          b.design_type === undefined &&
          b.confirmation_source === undefined,
        "DOCUMENT_FIELDS",
        "商品事实角色不可改写",
      );
      content = productFacts(
        b.content,
        await mgr.query("SELECT * FROM artifacts WHERE project_id=?", [p.id]),
      );
    } else if (meta.role === "goal") {
      check(
        b.content &&
          typeof b.content === "object" &&
          !Array.isArray(b.content) &&
          b.role === undefined &&
          b.confirmation_source === undefined &&
          b.design_type === undefined,
        "GOAL_CONTENT",
        "目标修订须提交完整结构化目标，确认依据写在目标正文中",
      );
      content = goalContent(b.content);
    } else {
      text(b.content, "正文");
      content = b.content;
      validateDocumentRole({ role: "reference", ...meta, ...b });
    }
    if (b.design_type !== undefined)
      check(
        old.kind === "design" &&
          ["ui-ux", "arch", "decision"].includes(b.design_type),
        "DESIGN_TYPE",
        "design_type 无效",
      );
    const nextMeta = {
      role: "reference",
      ...meta,
      previous: old.id,
      revision_reason: b.reason,
      source: b.source,
      ...(b.role !== undefined ? { role: b.role } : {}),
      ...(b.confirmation_source !== undefined
        ? { confirmation_source: b.confirmation_source }
        : {}),
      ...(b.design_type !== undefined ? { design_type: b.design_type } : {}),
    };
    const a = await append(mgr, p, old.kind, old.title, content, nextMeta);
    if (meta.role === "product-facts")
      for (const f of content.fields)
        await relation(
          mgr,
          "artifact",
          a.id,
          "artifact",
          f.source.artifact_id,
          "derived-from",
        );
    await relation(mgr, "artifact", old.id, "artifact", a.id, "superseded-by");
    // Carry document ownership forward. Goal bindings and reference edges stay on the exact version.
    const attachments = await mgr.query(
      "SELECT * FROM relations WHERE dst_type='artifact' AND dst_id=? AND src_type IN ('task','node')",
      [old.id],
    );
    for (const r of attachments)
      if (
        ["described-by", "decided-by", "specified-by"].includes(r.rel) &&
        (meta.role !== "goal" ||
          (r.src_type === "node" && r.src_id === node.id))
      )
        await relation(mgr, r.src_type, r.src_id, "artifact", a.id, r.rel);
    const tasks = await mgr.query(
      "SELECT * FROM artifacts WHERE project_id=? AND kind='task'",
      [p.id],
    );
    const seriesIds = new Set(rows.map((x) => x.id));
    const changedKeys =
      meta.role === "product-facts"
        ? new Set(
            [...json(old.content).fields, ...content.fields]
              .filter(
                (f) =>
                  digest(
                    json(old.content).fields.find((x) => x.key === f.key) ??
                      null,
                  ) !==
                  digest(content.fields.find((x) => x.key === f.key) ?? null),
              )
              .map((f) => f.key),
          )
        : new Set();
    const affected = tasks
      .filter(
        (t) =>
          t.id === meta.task_id ||
          (meta.role === "product-facts" &&
            (json(t.meta).retouch?.fact_keys ?? []).some((k) =>
              changedKeys.has(k),
            )) ||
          (meta.role !== "goal" &&
            attachments.some(
              (r) =>
                r.src_type === "task" &&
                r.src_id === t.id &&
                ["described-by", "decided-by", "specified-by"].includes(r.rel),
            )) ||
          (meta.role === "goal" &&
            seriesIds.has(json(t.meta).retouch?.goal_id)),
      )
      .map((t) => t.id);
    await invalidateDocumentTasks(
      mgr,
      p,
      affected,
      old.kind === "design" ? a : null,
    );
    return {
      artifact: a,
      native_document: documentDescriptor(a, [...rows, a]),
    };
  }
  if (action === "task-context-review") {
    const { a, meta } = await task(mgr, p, b.task);
    await noUnknown(mgr, p, a.id);
    const g = await artifact(mgr, b.goal, p, "spec");
    check(json(g.meta).role === "goal", "GOAL", "任务须绑定目标 spec");
    const latest = await one(
      mgr,
      "SELECT MAX(version) AS v FROM artifacts WHERE project_id=? AND kind='spec' AND title=?",
      [p.id, g.title],
    );
    check(g.version === latest.v, "GOAL_STALE", "须复核到当前目标版本", 1);
    meta.retouch.goal_id = g.id;
    meta.retouch.goal_version = g.version;
    meta.retouch.plan_id = null;
    meta.retouch.active_run = null;
    meta.retouch.context_status = "current";
    meta.retouch.context_epoch = (meta.retouch.context_epoch ?? 0) + 1;
    meta.retouch.context_review = text(b.statement, "上下文复核依据");
    if (meta.status === "done") {
      meta.status = "todo";
      meta.status_at = timestamp();
    }
    await relation(mgr, "task", a.id, "artifact", g.id, "specified-by");
    return { task: await updateTask(mgr, a, meta, b.expected_revision) };
  }
  if (action === "result-revalidate") {
    const { a: t, meta: tm } = await currentTask(mgr, p, b.task);
    await noUnknown(mgr, p, t.id);
    const image = await media(mgr, p, b.id),
      im = json(image.meta);
    check(
      im.task_id === t.id && !["original", "reference"].includes(im.role),
      "MEDIA_BINDING",
      "只能复核当前任务已有的结果",
    );
    check(
      b.sha256 === im.sha256 && ["adopt", "reject"].includes(b.decision),
      "REVALIDATION",
      "复核须绑定真实hash及adopt/reject结论",
    );
    check(
      b.goal_id === tm.retouch.goal_id &&
        b.requirements_hash === digest(tm.retouch.requirements),
      "REVALIDATION_CONTEXT",
      "须绑定已读取的当前目标和需求",
      1,
    );
    const binding = taskBinding(t, digest);
    const review = await append(
      mgr,
      p,
      "review",
      "Result revalidation " + image.id,
      text(b.statement, "适用性复核理由"),
      {
        schema: SCHEMA,
        role: "result-revalidation",
        ...binding,
        media_id: image.id,
        sha256: im.sha256,
        decision: b.decision,
        reviewer: text(b.reviewer, "复核人"),
        source: text(b.source, "来源"),
        accepted: false,
      },
    );
    await relation(
      mgr,
      "artifact",
      image.id,
      "artifact",
      review.id,
      "reviewed-by",
    );
    await relation(
      mgr,
      "artifact",
      review.id,
      "artifact",
      binding.goal_id,
      "specified-by",
    );
    return {
      artifact: review,
      task: await updateTask(mgr, t, tm, b.expected_revision),
    };
  }
  if (action === "media") {
    const t = await task(mgr, p, b.task);
    check(
      /^[a-f0-9]{64}$/.test(b.sha256) &&
        b.object_path ===
          "objects/sha256/" + b.sha256.slice(0, 2) + "/" + b.sha256,
      "MEDIA_HASH",
      "素材必须绑定内容 hash 和受限相对路径",
    );
    check(
      Number.isSafeInteger(b.bytes) &&
        b.bytes > 0 &&
        Number.isSafeInteger(b.width) &&
        b.width > 0 &&
        Number.isSafeInteger(b.height) &&
        b.height > 0,
      "MEDIA",
      "必须登记实际字节和尺寸",
    );
    check(
      [
        "original",
        "reference",
        "model-output",
        "postprocess",
        "candidate",
        "delivered",
      ].includes(b.role),
      "MEDIA_ROLE",
      "素材角色无效",
    );
    const meta = {
      schema: SCHEMA,
      task_id: t.a.id,
      goal_id: t.meta.retouch.goal_id,
      goal_version: t.meta.retouch.goal_version,
      requirements_hash: digest(t.meta.retouch.requirements),
      context_epoch: t.meta.retouch.context_epoch ?? 0,
      sha256: b.sha256,
      bytes: b.bytes,
      width: b.width,
      height: b.height,
      mime: b.mime,
      object_path: b.object_path,
      role: b.role,
      parents: b.parents ?? [],
      operation: b.operation ?? "",
      ...(b.transform ? { transform: b.transform } : {}),
      confirmation: "unreviewed",
      ...(b.provider_receipt
        ? {
            provider_receipt: b.provider_receipt,
            api_operation: b.api_operation,
          }
        : {}),
    };
    for (const id of meta.parents) await media(mgr, p, id);
    const a = await append(
      mgr,
      p,
      "media",
      b.title || b.role + ":" + b.sha256,
      "",
      meta,
    );
    await relation(
      mgr,
      "task",
      t.a.id,
      "artifact",
      a.id,
      b.role === "original" || b.role === "reference" ? "uses" : "produced",
    );
    await relation(
      mgr,
      "artifact",
      a.id,
      "artifact",
      meta.goal_id,
      "specified-by",
    );
    for (const id of meta.parents)
      await relation(mgr, "artifact", a.id, "artifact", id, "derived-from");
    return { artifact: a };
  }
  if (action === "media-review") {
    const a = await media(mgr, p, b.id),
      meta = json(a.meta);
    const t = await currentTask(mgr, p, meta.task_id);
    const all = await mgr.query(
      "SELECT * FROM artifacts WHERE project_id=? ORDER BY created,id",
      [p.id],
    );
    check(
      mediaApplicable(a, t.a, all, digest),
      "MEDIA_STALE",
      "先复核旧图片对当前目标的适用性",
      1,
    );
    check(meta.sha256 === b.sha256, "REVIEW_HASH", "检查须绑定实际素材 hash");
    check(
      ["PASS", "FAIL", "UNKNOWN"].includes(b.verdict),
      "VERDICT",
      "检查结论无效",
    );
    const review = await append(
      mgr,
      p,
      "review",
      "Review " + a.id,
      text(b.observations, "检查观察"),
      {
        schema: SCHEMA,
        ...taskBinding(t.a, digest),
        media_id: a.id,
        sha256: b.sha256,
        verdict: b.verdict,
        reviewer: text(b.reviewer, "检查人"),
        accepted: b.accepted === true,
        source: text(b.source, "来源"),
      },
    );
    check(
      !b.accepted || (b.verdict === "PASS" && b.source === "user"),
      "USER_ACCEPTANCE",
      "接受必须由用户明确给出，且检查通过",
    );
    if (b.verdict === "PASS") assertInvariants(all, a, t.a);
    await relation(
      mgr,
      "artifact",
      a.id,
      "artifact",
      review.id,
      b.accepted ? "accepted-by" : "reviewed-by",
    );
    return { artifact: review };
  }
  if (action === "delivery-prepare") {
    const a = await media(mgr, p, b.id),
      m = json(a.meta);
    const taskContext = await currentTask(mgr, p, m.task_id);
    const all = await mgr.query(
      "SELECT * FROM artifacts WHERE project_id=? ORDER BY created,id",
      [p.id],
    );
    check(
      mediaApplicable(a, taskContext.a, all, digest),
      "MEDIA_STALE",
      "图片对应的目标或需求已变化，先复核适用性",
      1,
    );
    const accepted = all.find((r) =>
      acceptedReview(r, a, taskContext.a, all, digest),
    );
    assertInvariants(all, a, taskContext.a);
    check(
      accepted &&
        json(accepted.meta).accepted === true &&
        json(accepted.meta).source === "user",
      "ACCEPTANCE",
      "交付须有用户对实际文件的明确接受",
      1,
    );
    const delivery = await append(mgr, p, "delivery", "Delivery " + a.id, "", {
      schema: SCHEMA,
      ...taskBinding(taskContext.a, digest),
      media_id: a.id,
      sha256: m.sha256,
      directory: text(b.directory, "交付目录"),
      status: "preparing",
      dimension_provenance: freezeDimension(
        dimensionView(
          await mgr.query("SELECT * FROM artifacts WHERE project_id=?", [p.id]),
          a.id,
        ).images[0],
      ),
    });
    await relation(
      mgr,
      "artifact",
      a.id,
      "artifact",
      delivery.id,
      "delivered-by",
    );
    return { delivery, media: a };
  }
  if (action === "delivery-complete") {
    const a = await artifact(mgr, b.id, p, "delivery"),
      m = json(a.meta);
    check(
      m.status === "preparing" && /^[a-f0-9]{64}$/.test(b.manifest_sha256),
      "DELIVERY",
      "交付回执不匹配",
    );
    m.status = "completed";
    m.manifest_sha256 = b.manifest_sha256;
    await mgr.query("UPDATE artifacts SET meta=?,updated=? WHERE id=?", [
      stable(m),
      timestamp(),
      a.id,
    ]);
    return { delivery: { ...a, meta: stable(m) } };
  }
  if (action === "delivery-abandon") {
    const a = await artifact(mgr, b.id, p, "delivery"),
      m = json(a.meta);
    check(
      m.status === "preparing" && b.publication_inspected === true,
      "DELIVERY_STATE",
      "仅可显式处置已核对文件的 preparing 交付",
      1,
    );
    m.status = "abandoned";
    m.disposition = text(b.statement, "处置依据");
    m.disposition_at = timestamp();
    await mgr.query("UPDATE artifacts SET meta=?,updated=? WHERE id=?", [
      stable(m),
      timestamp(),
      a.id,
    ]);
    return { delivery: { ...a, meta: stable(m) } };
  }
  if (action === "execution-record") {
    const t = await task(mgr, p, b.task);
    check(
      b.model === undefined ||
        (typeof b.model === "string" &&
          /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(b.model)),
      "API_MODEL",
      "外部实际模型名称无效",
    );
    check(
      ["unknown", "received", "failed", "planned"].includes(b.status),
      "EXECUTION_STATUS",
      "外部执行必须说明已发生的真实状态",
    );
    const inputs = b.inputs ?? [],
      outputs = b.outputs ?? [];
    for (const id of [...inputs, ...outputs]) await media(mgr, p, id);
    for (const id of outputs)
      check(
        json((await media(mgr, p, id)).meta).task_id === t.a.id,
        "OUTPUT_BINDING",
        "外部结果须属于该任务",
      );
    check(
      b.status !== "received" || outputs.length > 0,
      "OUTPUT_REQUIRED",
      "已收到结果须绑定真实产物",
    );
    const a = await append(
      mgr,
      p,
      "execution",
      b.title || "External image execution",
      text(b.statement, "执行事实原文"),
      {
        schema: SCHEMA,
        role: "external",
        revision: 0,
        task_id: t.a.id,
        goal_id: t.meta.retouch.goal_id,
        status: b.status,
        inputs,
        outputs,
        external_request: b.external_request ?? null,
        requested_dimensions: requestedDimensions(b.requested_dimensions),
        source: text(b.source, "来源"),
        model: b.model ?? null,
      },
    );
    await relation(mgr, "task", t.a.id, "artifact", a.id, "executed-by");
    for (const id of inputs)
      await relation(mgr, "artifact", a.id, "artifact", id, "uses");
    for (const id of outputs)
      await relation(mgr, "artifact", a.id, "artifact", id, "produced");
    return { execution: a };
  }
  if (action === "execution-reconcile") {
    const { a, meta } = await execution(mgr, p, b.id);
    check(
      meta.role !== "workflow-run",
      "WORKFLOW_RECONCILIATION",
      "工作流结果请通过 run complete、run api-result 或 run api-reconcile 回接，不能覆盖前序输出",
      1,
    );
    check(
      ["unknown", "received", "failed"].includes(b.status),
      "EXECUTION_STATUS",
      "对账状态无效",
    );
    check(
      ["unknown", "dispatched"].includes(meta.status),
      "EXECUTION_FINAL",
      "已确定的执行事实不能重写",
      1,
    );
    const outputs = b.outputs ?? [];
    for (const id of outputs) await media(mgr, p, id);
    for (const id of outputs)
      check(
        json((await media(mgr, p, id)).meta).task_id === meta.task_id,
        "OUTPUT_BINDING",
        "外部结果须属于该任务",
      );
    check(
      b.status !== "received" || outputs.length > 0,
      "OUTPUT_REQUIRED",
      "已收到结果须绑定产物",
    );
    meta.status = b.status;
    meta.outputs = outputs;
    meta.reconciliation = text(b.statement, "对账依据");
    const result = await updateExecution(mgr, a, meta, b.expected_revision);
    for (const id of outputs)
      await relation(mgr, "artifact", a.id, "artifact", id, "produced");
    return { execution: result };
  }
  if (action === "plan") {
    await noUnknown(mgr, p, b.task);
    const { a, meta } = await currentTask(mgr, p, b.task);
    const input = await media(mgr, p, b.input),
      dimensions = json(input.meta);
    check(
      dimensions.task_id === a.id,
      "INPUT_BINDING",
      "输入素材须属于当前任务",
    );
    const steps = b.steps;
    check(
      Array.isArray(steps) && steps.length > 0 && steps.length <= 40,
      "STEPS",
      "计划须有 1–40 个顺序步骤",
    );
    const ids = new Set();
    for (const step of steps) {
      text(step.id, "步骤 ID");
      text(step.prompt, "步骤需求");
      check(
        !ids.has(step.id) && (step.needs ?? []).every((id) => ids.has(id)),
        "STEP_ORDER",
        "依赖须指向前序步骤且 ID 不重复",
      );
      ids.add(step.id);
      check(
        step.references === undefined ||
          (Array.isArray(step.references) && step.references.length <= 15),
        "REFERENCES",
        "每步最多 15 张职责明确的参考图",
      );
      for (const reference of step.references ?? []) {
        await media(mgr, p, reference.media_id);
        text(reference.purpose, "参考图职责");
      }
      if (step.region) {
        const r = step.region,
          coords = step.coordinate_system ?? {
            width: dimensions.width,
            height: dimensions.height,
          };
        check(
          [coords.width, coords.height, r.x, r.y, r.width, r.height].every(
            Number.isSafeInteger,
          ) &&
            r.x >= 0 &&
            r.y >= 0 &&
            r.width > 0 &&
            r.height > 0 &&
            r.x + r.width <= coords.width &&
            r.y + r.height <= coords.height,
          "REGION",
          "修改区域超出明确的输入坐标系",
        );
        step.coordinate_system = coords;
      }
    }
    const active = meta.retouch.requirements.filter(
      (g) => g.text.trim() && !g.disabled,
    );
    const facts = await one(
      mgr,
      "SELECT * FROM artifacts WHERE project_id=? AND kind='spec' AND json_extract(meta,'$.role')='product-facts' ORDER BY version DESC LIMIT 1",
      [p.id],
    );
    const purpose = b.purpose ?? meta.retouch.purpose ?? "unspecified";
    check(
      !facts || purpose !== "unspecified",
      "TASK_PURPOSE",
      "已有商品事实清单时须明确概念提案或实物准确图用途",
    );
    const factsCheck = factCheck(
      facts
        ? productFacts(
            json(facts.content),
            await mgr.query("SELECT * FROM artifacts WHERE project_id=?", [
              p.id,
            ]),
          )
        : null,
      steps,
      purpose,
    );
    check(
      factsCheck.status !== "BLOCKED",
      "FACTS_INCOMPLETE",
      "当前实物准确任务缺少必要字段：" + factsCheck.blocking.join(", "),
      1,
    );
    for (const step of steps) {
      step.fact_constraints = factsCheck.step_checks.find(
        (c) => c.step_id === step.id,
      ).constraints;
      step.bound_facts = renderFacts(
        factsCheck.step_checks.find((c) => c.step_id === step.id),
      );
    }
    const contracts = planContracts(
      await mgr.query(
        "SELECT * FROM artifacts WHERE project_id=? ORDER BY created,id",
        [p.id],
      ),
      steps,
      purpose,
      b.stage,
      a.id,
    );
    const body = {
      schema: SCHEMA,
      role: "workflow-plan",
      contracts,
      purpose,
      facts_id: facts?.id ?? null,
      facts_version: facts?.version ?? null,
      facts_hash: facts ? digest(facts.content) : null,
      fact_check: factsCheck,
      delivery_canvas: b.delivery_canvas
        ? requestedDimensions({
            ...b.delivery_canvas,
            scope: "delivery-target",
          })
        : null,
      task_id: a.id,
      goal_id: meta.retouch.goal_id,
      goal_version: meta.retouch.goal_version,
      design_id: meta.retouch.design_id ?? null,
      input_id: input.id,
      input_sha256: dimensions.sha256,
      requirements: active,
      requirements_hash: digest(meta.retouch.requirements),
      executor: "host",
      steps,
    };
    if (b.fallback) {
      const profile = await artifact(
          mgr,
          b.fallback.profile_id,
          p,
          "executor-profile",
        ),
        config = json(profile.content);
      apiProfile(config.profile);
      body.fallback = {
        profile_id: profile.id,
        profile_version: profile.version,
        profile_hash: digest(config),
        endpoint_fingerprint: config.endpoint_fingerprint,
      };
    }
    const plan = await append(mgr, p, "spec", "Workflow " + a.id, body, {
      schema: SCHEMA,
      role: "workflow-plan",
      task_id: a.id,
    });
    let previousNode = null;
    for (let position = 0; position < steps.length; position++) {
      const nodeId = uid(),
        step = steps[position];
      await mgr.query(
        "INSERT INTO nodes(id,tree_id,key,name,payload,created) VALUES(?,?,?,?,?,?)",
        [
          nodeId,
          node.tree_id,
          "step-" + plan.id + "-" + position,
          step.id,
          stable({
            schema: SCHEMA,
            plan_id: plan.id,
            task_id: a.id,
            step_id: step.id,
            position,
          }),
          timestamp(),
        ],
      );
      await relation(
        mgr,
        "artifact",
        plan.id,
        "node",
        nodeId,
        "implemented-by",
      );
      if (previousNode)
        await mgr.query(
          "INSERT INTO node_edges(id,tree_id,parent_id,child_id,created) VALUES(?,?,?,?,?)",
          [uid(), node.tree_id, previousNode, nodeId, timestamp()],
        );
      previousNode = nodeId;
    }
    await refreshGraph(mgr, api, node.tree_id);
    meta.retouch.plan_id = plan.id;
    meta.retouch.intent_id = contracts.intent_id;
    meta.retouch.purpose = purpose;
    meta.retouch.facts_id = facts?.id ?? null;
    meta.retouch.fact_keys = factsCheck.required_keys;
    const updated = await updateTask(mgr, a, meta, b.expected_revision);
    await relation(mgr, "task", a.id, "artifact", plan.id, "specified-by");
    if (body.fallback)
      await relation(
        mgr,
        "artifact",
        plan.id,
        "artifact",
        body.fallback.profile_id,
        "uses-executor",
      );
    return {
      plan,
      plan_hash: digest(body),
      approval_template: {
        plan_id: plan.id,
        plan_hash: digest(body),
        issuer: "host-human",
        confirmation: "",
        expires_at: null,
        ...(body.fallback
          ? {
              api_fallback: {
                ...body.fallback,
                max_requests: steps.length,
                cost_confirmation: "",
                upload_confirmation: "",
              },
            }
          : {}),
      },
      task: updated,
    };
  }
  if (action === "grant") {
    const { a, meta } = await currentTask(mgr, p, b.task);
    const plan = await artifact(mgr, meta.retouch.plan_id, p, "spec");
    const fallback = json(plan.content).fallback;
    if (b.api_fallback) {
      check(
        fallback &&
          b.api_fallback.profile_id === fallback.profile_id &&
          b.api_fallback.profile_hash === fallback.profile_hash &&
          b.api_fallback.endpoint_fingerprint === fallback.endpoint_fingerprint,
        "API_APPROVAL",
        "API 授权须匹配已冻结的执行配置",
      );
      check(
        Number.isSafeInteger(b.api_fallback.max_requests) &&
          b.api_fallback.max_requests > 0 &&
          b.api_fallback.max_requests <= json(plan.content).steps.length,
        "API_BUDGET",
        "API 授权须给出不超过计划步数的最大请求次数",
      );
      text(b.api_fallback.cost_confirmation, "费用确认原文");
      text(b.api_fallback.upload_confirmation, "素材外发确认原文");
    }
    check(
      b.plan_id === plan.id && b.plan_hash === digest(json(plan.content)),
      "PLAN_BINDING",
      "授权必须绑定当前计划和 hash",
    );
    check(
      ["human", "host-human"].includes(b.issuer) &&
        new Date(b.expires_at).getTime() > Date.now(),
      "GRANT",
      "授权须来自用户且有效",
    );
    const identity = json(
      (
        await one(
          mgr,
          "SELECT value FROM meta WHERE key='retouch.workspace.identity'",
        )
      ).value,
    );
    const grant = await append(
      mgr,
      p,
      "authorization",
      "Authorization " + plan.id,
      text(b.confirmation, "用户授权原文"),
      {
        schema: SCHEMA,
        task_id: a.id,
        plan_id: plan.id,
        plan_hash: b.plan_hash,
        issuer: b.issuer,
        expires_at: b.expires_at,
        workspace_id: identity.id,
        max_runs: 1,
        ...(b.api_fallback ? { api_fallback: b.api_fallback } : {}),
      },
    );
    await relation(mgr, "task", a.id, "artifact", grant.id, "authorized-by");
    return { grant };
  }
  if (action === "run-start") {
    await noUnknown(mgr, p, b.task);
    const { a, meta } = await currentTask(mgr, p, b.task);
    for (const dep of meta.retouch.dependencies)
      check(
        json((await artifact(mgr, dep, p, "task")).meta).status === "done",
        "DEPENDENCY_PENDING",
        "前序任务尚未完成",
        1,
      );
    const plan = await artifact(mgr, meta.retouch.plan_id, p, "spec"),
      planBody = json(plan.content);
    check(
      planBody.requirements_hash === digest(meta.retouch.requirements),
      "PLAN_STALE",
      "需求改变后须重新规划",
      1,
    );
    const grant = await artifact(mgr, b.grant, p, "authorization"),
      gm = json(grant.meta);
    const identity = json(
      (
        await one(
          mgr,
          "SELECT value FROM meta WHERE key='retouch.workspace.identity'",
        )
      ).value,
    );
    await localGrant(mgr, grant, identity);
    check(
      gm.plan_id === plan.id && gm.plan_hash === digest(planBody),
      "GRANT_INVALID",
      "授权不匹配当前计划",
      1,
    );
    check(
      !(await one(
        mgr,
        "SELECT id FROM relations WHERE src_type='artifact' AND dst_type='artifact' AND dst_id=? AND rel='authorized-by'",
        [grant.id],
      )),
      "GRANT_USED",
      "授权已用于一次运行",
      1,
    );
    const run = await append(
      mgr,
      p,
      "execution",
      "Workflow execution " + a.id,
      plan.content,
      {
        schema: SCHEMA,
        role: "workflow-run",
        revision: 0,
        task_id: a.id,
        goal_id: planBody.goal_id,
        plan_id: plan.id,
        grant_id: grant.id,
        status: "prepared",
        step: 0,
        outputs: [],
        input_id: planBody.input_id,
      },
    );
    for (let position = 0; position < planBody.steps.length; position++)
      await stepState(
        mgr,
        node.tree_id,
        run.id,
        (await stepNode(mgr, node.tree_id, plan.id, position)).id,
        "locked",
      );
    meta.status = "doing";
    meta.status_at = timestamp();
    meta.retouch.active_run = run.id;
    await updateTask(mgr, a, meta, meta.retouch.revision);
    await relation(mgr, "task", a.id, "artifact", run.id, "executed-by");
    await relation(
      mgr,
      "artifact",
      run.id,
      "artifact",
      grant.id,
      "authorized-by",
    );
    return { execution: run };
  }
  if (action.startsWith("run-")) {
    const { a, meta } = await execution(mgr, p, b.id);
    check(meta.role === "workflow-run", "RUN", "此记录不是工作流运行");
    const plan = json(a.content);
    if (action === "run-dispatch" || action === "run-api-dispatch") {
      check(
        meta.status === "prepared",
        "RUN_STATE",
        "执行已派发或尚未通过上一步检查；先对账",
        1,
      );
      const t = await currentTask(mgr, p, meta.task_id);
      check(
        t.meta.retouch.plan_id === meta.plan_id &&
          digest(t.meta.retouch.requirements) === plan.requirements_hash,
        "PLAN_STALE",
        "当前任务与运行计划不匹配",
        1,
      );
      const identity = json(
        (
          await one(
            mgr,
            "SELECT value FROM meta WHERE key='retouch.workspace.identity'",
          )
        ).value,
      );
      const granted = await localGrant(
        mgr,
        await artifact(mgr, meta.grant_id, p, "authorization"),
        identity,
      );
      const step = plan.steps[meta.step];
      check(step, "RUN_FINISHED", "已无待执行步骤", 1);
      if (plan.contracts) {
        const all = await mgr.query(
          "SELECT * FROM artifacts WHERE project_id=? ORDER BY created,id",
          [p.id],
        );
        const coverage = coverageView(all);
        check(
          coverage.contract_id === plan.contracts.intent_id,
          "PLAN_STALE",
          "业务内容规范已变化",
          1,
        );
        check(
          (latestFlow(all, "product-invariants", meta.task_id)?.id ?? null) ===
            plan.contracts.invariants_id,
          "PLAN_STALE",
          "商品保持项规范已变化",
          1,
        );
        if (meta.step > 0 && coverage.rollout?.mode === "sample-first")
          check(
            coverage.rollout.representative_ids.every(
              (id) =>
                coverage.items.find((i) => i.id === id)?.verdict === "PASS",
            ),
            "CONTENT_SAMPLE_REQUIRED",
            "继续扩套前先完成实际样张的内容覆盖检查",
            1,
          );
      }
      const input = await media(mgr, p, meta.input_id);
      const references = [];
      for (const ref of step.references ?? [])
        references.push({
          purpose: ref.purpose,
          artifact: await media(mgr, p, ref.media_id),
        });
      if (action === "run-api-dispatch") {
        const terms = granted.api_fallback,
          fallback = plan.fallback;
        check(
          terms &&
            fallback &&
            terms.profile_id === fallback.profile_id &&
            b.profile_id === fallback.profile_id,
          "API_APPROVAL_REQUIRED",
          "需要本工作区对该 API fallback 的明确授权",
          1,
        );
        const profile = await artifact(
            mgr,
            fallback.profile_id,
            p,
            "executor-profile",
          ),
          config = json(profile.content),
          definition = apiProfile(config.profile);
        check(
          digest(config) === fallback.profile_hash &&
            terms.profile_hash === fallback.profile_hash &&
            config.endpoint_fingerprint === b.endpoint_fingerprint &&
            terms.endpoint_fingerprint === b.endpoint_fingerprint,
          "API_BINDING",
          "API endpoint 或执行配置已变化，不能沿用旧授权",
          1,
        );
        const attempts = meta.api_attempts ?? [];
        check(
          attempts.filter((x) => x.grant_id === meta.grant_id).length <
            terms.max_requests,
          "API_BUDGET",
          "API 请求次数已达到授权上限",
          1,
        );
        text(b.operation_key, "操作请求键");
        check(
          !attempts.some((x) => x.operation_key === b.operation_key),
          "REQUEST_CONFLICT",
          "API 操作请求键已经使用",
          1,
        );
        const uploads = b.uploads;
        check(
          uploads &&
            Array.isArray(uploads.reference_ids) &&
            uploads.reference_ids.length === references.length,
          "API_UPLOADS",
          "API 传输素材不完整",
        );
        const uploadInput = await media(mgr, p, uploads.input_id),
          referenceUploads = [];
        check(
          json(uploadInput.meta).parents.includes(input.id),
          "API_UPLOAD_BINDING",
          "传输输入未绑定当前步骤输入",
        );
        for (let i = 0; i < references.length; i++) {
          const r = await media(mgr, p, uploads.reference_ids[i]);
          check(
            json(r.meta).parents.includes(references[i].artifact.id),
            "API_UPLOAD_BINDING",
            "参考传输素材来源不符",
          );
          referenceUploads.push(r);
        }
        const mask = uploads.mask_id
          ? await media(mgr, p, uploads.mask_id)
          : null;
        check(
          !!mask === !!step.region &&
            (!mask || json(mask.meta).parents.includes(input.id)),
          "API_MASK",
          "局部步骤须使用绑定当前输入的明确 mask",
        );
        const descriptor = {
          profile_id: profile.id,
          profile_hash: fallback.profile_hash,
          endpoint_fingerprint: config.endpoint_fingerprint,
          model: definition.model,
          size: definition.size,
          quality: definition.quality,
          prompt: apiPrompt(
            step,
            plan.requirements,
            json((await artifact(mgr, plan.goal_id, p, "spec")).content)
              .preserve,
          ),
          uploads: {
            input: json(uploadInput.meta).sha256,
            references: referenceUploads.map((r) => json(r.meta).sha256),
            mask: mask ? json(mask.meta).sha256 : null,
          },
        };
        check(
          b.request_digest === digest(descriptor),
          "API_REQUEST_BINDING",
          "API 请求与原生冻结上下文不匹配",
        );
        const promptArtifact = await append(
          mgr,
          p,
          "prompt",
          "API request " + b.operation_key,
          descriptor.prompt,
          {
            schema: SCHEMA,
            task_id: meta.task_id,
            goal_id: meta.goal_id,
            plan_id: meta.plan_id,
            profile_id: profile.id,
            operation_key: b.operation_key,
            role: "compiled-api-request",
          },
        );
        await relation(
          mgr,
          "artifact",
          a.id,
          "artifact",
          promptArtifact.id,
          "uses",
        );
        await relation(
          mgr,
          "artifact",
          promptArtifact.id,
          "artifact",
          meta.plan_id,
          "derived-from",
        );
        const intent = {
          operation_key: b.operation_key,
          expected_revision: b.expected_revision,
          grant_id: meta.grant_id,
          profile_id: profile.id,
          prompt_id: promptArtifact.id,
          profile_hash: fallback.profile_hash,
          endpoint_fingerprint: config.endpoint_fingerprint,
          request_digest: b.request_digest,
          uploads,
          step: meta.step,
          model: definition.model,
          status: "dispatched",
          at: timestamp(),
        };
        meta.api_intent = intent;
        meta.api_attempts = [...attempts, intent];
        meta.api_response = null;
        for (const id of [
          uploads.input_id,
          ...uploads.reference_ids,
          ...(uploads.mask_id ? [uploads.mask_id] : []),
        ])
          await relation(mgr, "artifact", a.id, "artifact", id, "uses");
      }
      const currentNode = await stepNode(
        mgr,
        node.tree_id,
        meta.plan_id,
        meta.step,
      );
      if (meta.step > 0) {
        const predecessor = await stepNode(
            mgr,
            node.tree_id,
            meta.plan_id,
            meta.step - 1,
          ),
          state = await one(
            mgr,
            "SELECT status FROM node_state WHERE tree_id=? AND context=? AND node_id=?",
            [node.tree_id, a.id, predecessor.id],
          );
        check(
          state?.status === "unlocked",
          "NATIVE_GATE",
          "前序步骤没有原生检查证据",
          1,
        );
      }
      if (action === "run-dispatch") {
        meta.api_intent = null;
        meta.api_response = null;
      }
      meta.status = "dispatched";
      meta.dispatch = {
        step: step.id,
        at: timestamp(),
        channel: action === "run-api-dispatch" ? "api-fallback" : "host",
      };
      const updated = await updateExecution(mgr, a, meta, b.expected_revision);
      await relation(
        mgr,
        "node",
        currentNode.id,
        "artifact",
        a.id,
        "executed-by",
      );
      if (step.region)
        check(
          json(input.meta).width === step.coordinate_system.width &&
            json(input.meta).height === step.coordinate_system.height,
          "COORDINATE_SYSTEM",
          "前序结果尺寸已变化，旧区域坐标不能用于当前步骤",
          1,
        );
      return {
        execution: updated,
        allow_execute: true,
        job: {
          schema: "retouch.host-job/v2",
          execution_id: a.id,
          plan_id: meta.plan_id,
          step,
          purpose: plan.purpose ?? "unspecified",
          fact_check: plan.fact_check ?? null,
          facts_id: plan.facts_id ?? null,
          input: { id: input.id, ...json(input.meta) },
          references: references.map((r) => ({
            id: r.artifact.id,
            purpose: r.purpose,
            ...json(r.artifact.meta),
          })),
          requirements: plan.requirements,
          preserve: json((await artifact(mgr, plan.goal_id, p, "spec")).content)
            .preserve,
          on_unknown: "reconcile; never redispatch",
          output_protocol: "register actual media, then run complete",
        },
      };
    }
    if (action === "run-api-received") {
      check(
        ["dispatched", "unknown"].includes(meta.status) &&
          meta.dispatch?.channel === "api-fallback" &&
          meta.api_intent?.operation_key === b.operation_key,
        "API_RESULT_STATE",
        "没有匹配的 API 待回接请求",
        1,
      );
      const raw = await media(mgr, p, b.raw_output),
        rm = json(raw.meta);
      check(
        rm.task_id === meta.task_id && rm.parents.includes(meta.input_id),
        "API_RESULT_BINDING",
        "API 原始结果未绑定当前任务输入",
      );
      meta.status = "received";
      meta.api_response = {
        operation_key: b.operation_key,
        raw_output: raw.id,
        receipt: b.receipt ?? null,
      };
      meta.raw_output = raw.id;
      meta.api_attempts = meta.api_attempts.map((x) =>
        x.operation_key === b.operation_key ? { ...x, status: "received" } : x,
      );
      await relation(mgr, "artifact", a.id, "artifact", raw.id, "produced");
    } else if (action === "run-api-outcome") {
      check(
        ["dispatched", "unknown"].includes(meta.status) &&
          meta.api_intent?.operation_key === b.operation_key &&
          !meta.api_response,
        "API_RESULT_STATE",
        "API 请求状态不允许改写该结果",
        1,
      );
      check(
        ["failed", "unknown"].includes(b.status),
        "API_OUTCOME",
        "API 结果须明确失败或未知",
      );
      if (b.observed?.code === "API_PROVIDER_RECONCILED") {
        text(b.observed.statement, "API 对账事实");
        text(b.observed.source, "API 对账来源");
      }
      meta.status = b.status;
      meta.api_outcome = b.observed;
      meta.api_attempts = meta.api_attempts.map((x) =>
        x.operation_key === b.operation_key
          ? { ...x, status: b.status, observed: b.observed }
          : x,
      );
    } else if (action === "run-authorize") {
      const identity = json(
        (
          await one(
            mgr,
            "SELECT value FROM meta WHERE key='retouch.workspace.identity'",
          )
        ).value,
      );
      const grant = await artifact(mgr, b.grant, p, "authorization"),
        gm = await localGrant(mgr, grant, identity);
      check(
        gm.plan_id === meta.plan_id,
        "GRANT_INVALID",
        "授权不匹配恢复运行的计划",
        1,
      );
      check(
        !(await one(
          mgr,
          "SELECT id FROM relations WHERE src_type='artifact' AND dst_id=? AND rel='authorized-by'",
          [grant.id],
        )),
        "GRANT_USED",
        "授权已使用",
        1,
      );
      meta.grant_id = grant.id;
      await relation(
        mgr,
        "artifact",
        a.id,
        "artifact",
        grant.id,
        "authorized-by",
      );
    } else if (action === "run-complete") {
      check(
        ["dispatched", "unknown", "received"].includes(meta.status),
        "RUN_STATE",
        "此运行没有待回接请求",
        1,
      );
      if (meta.dispatch?.channel === "api-fallback")
        check(
          meta.api_response && meta.api_response.raw_output === b.raw_output,
          "API_RECEIPT_REQUIRED",
          "API 输出须先保全原生接收回执",
          1,
        );
      const output = await media(mgr, p, b.output),
        om = json(output.meta);
      if (b.processed_output) {
        const processed = await media(mgr, p, b.processed_output);
        check(
          json(processed.meta).parents.includes(b.raw_output) &&
            om.parents.includes(processed.id),
          "POSTPROCESS_BINDING",
          "后处理与候选必须保留原始结果的完整派生",
        );
      }
      check(
        om.task_id === meta.task_id && om.parents.includes(meta.input_id),
        "OUTPUT_BINDING",
        "输出须绑定当前步骤输入及任务",
      );
      meta.status = "waiting_for_review";
      meta.candidate = output.id;
      meta.tool_receipt = b.receipt ?? null;
      if (b.raw_output) {
        const raw = await media(mgr, p, b.raw_output);
        check(
          json(raw.meta).task_id === meta.task_id,
          "OUTPUT_BINDING",
          "原生输出须属于当前任务",
        );
        meta.raw_output = raw.id;
      }
      await relation(mgr, "artifact", a.id, "artifact", output.id, "produced");
      await relation(
        mgr,
        "node",
        (await stepNode(mgr, node.tree_id, meta.plan_id, meta.step)).id,
        "artifact",
        output.id,
        "produced",
      );
    } else if (action === "run-unknown") {
      check(
        meta.status === "dispatched",
        "RUN_STATE",
        "仅已派发请求可标记未知",
        1,
      );
      meta.status = "unknown";
      meta.unknown_reason = text(b.statement, "未知原因");
    } else if (action === "run-review") {
      check(
        meta.status === "waiting_for_review",
        "RUN_STATE",
        "运行没有待检查候选",
        1,
      );
      const candidate = await media(mgr, p, meta.candidate);
      if (b.verdict === "PASS") {
        const all = await mgr.query(
            "SELECT * FROM artifacts WHERE project_id=? ORDER BY created,id",
            [p.id],
          ),
          t = (await currentTask(mgr, p, meta.task_id)).a;
        assertInvariants(all, candidate, t);
        assertStepCoverage(
          all,
          candidate,
          t,
          plan.steps[meta.step],
          plan.contracts?.intent_id,
        );
      }
      check(
        b.sha256 === json(candidate.meta).sha256 &&
          ["PASS", "FAIL", "UNKNOWN"].includes(b.verdict),
        "REVIEW",
        "检查须绑定当前候选 hash 与实际结论",
      );
      const review = await append(
        mgr,
        p,
        "review",
        "Step review " + a.id + "/" + meta.step,
        text(b.observations, "视觉观察"),
        {
          schema: SCHEMA,
          media_id: candidate.id,
          sha256: b.sha256,
          verdict: b.verdict,
          reviewer: text(b.reviewer, "检查人"),
          source: text(b.source, "来源"),
        },
      );
      await relation(
        mgr,
        "artifact",
        candidate.id,
        "artifact",
        review.id,
        "reviewed-by",
      );
      if (b.verdict === "PASS") {
        const reviewedNode = await stepNode(
          mgr,
          node.tree_id,
          meta.plan_id,
          meta.step,
        );
        await stepState(mgr, node.tree_id, a.id, reviewedNode.id, "unlocked");
        await relation(
          mgr,
          "node",
          reviewedNode.id,
          "artifact",
          review.id,
          "evidenced-by",
        );
        await api.logEvent(mgr, "node.unlock", "node", reviewedNode.id, {
          context: a.id,
          review: review.id,
        });
        meta.outputs.push(candidate.id);
        meta.input_id = candidate.id;
        meta.step++;
        meta.status =
          meta.step === plan.steps.length
            ? "waiting_for_acceptance"
            : "prepared";
      } else
        meta.status = b.verdict === "FAIL" ? "failed" : "waiting_for_review";
    } else if (action === "run-accept") {
      const t = await currentTask(mgr, p, meta.task_id);
      check(
        t.meta.retouch.plan_id === meta.plan_id,
        "PLAN_STALE",
        "不能将旧计划结果当成当前计划接受",
        1,
      );
      check(
        meta.status === "waiting_for_acceptance",
        "RUN_STATE",
        "尚未完成全部步骤检查",
        1,
      );
      const candidate = await media(mgr, p, meta.outputs.at(-1));
      assertInvariants(
        await mgr.query(
          "SELECT * FROM artifacts WHERE project_id=? ORDER BY created,id",
          [p.id],
        ),
        candidate,
        t.a,
      );
      check(
        b.sha256 === json(candidate.meta).sha256 && b.source === "user",
        "ACCEPTANCE",
        "用户接受须绑定实际候选 hash",
      );
      const accepted = await append(
        mgr,
        p,
        "review",
        "User acceptance " + a.id,
        text(b.statement, "用户接受原文"),
        {
          schema: SCHEMA,
          ...taskBinding(t.a, digest),
          accepted: true,
          sha256: b.sha256,
          media_id: candidate.id,
          source: "user",
        },
      );
      await relation(
        mgr,
        "artifact",
        candidate.id,
        "artifact",
        accepted.id,
        "accepted-by",
      );
      meta.status = "accepted";
      meta.accepted_id = candidate.id;
    } else if (action === "run-deliver") {
      const taskContext = await currentTask(mgr, p, meta.task_id);
      if (meta.accepted_id)
        assertInvariants(
          await mgr.query(
            "SELECT * FROM artifacts WHERE project_id=? ORDER BY created,id",
            [p.id],
          ),
          await media(mgr, p, meta.accepted_id),
          taskContext.a,
        );
      check(
        taskContext.meta.retouch.plan_id === meta.plan_id,
        "PLAN_STALE",
        "不能将旧计划交付为当前任务结果",
        1,
      );
      check(
        meta.status === "accepted" || meta.status === "delivering",
        "RUN_STATE",
        "交付前须有用户接受",
        1,
      );
      const identity = json(
        (
          await one(
            mgr,
            "SELECT value FROM meta WHERE key='retouch.workspace.identity'",
          )
        ).value,
      );
      await localGrant(
        mgr,
        await artifact(mgr, meta.grant_id, p, "authorization"),
        identity,
      );
      text(b.directory, "交付目录");
      check(
        !meta.delivery_directory || meta.delivery_directory === b.directory,
        "DELIVERY_CONFLICT",
        "交付目标已绑定",
        1,
      );
      meta.status = "delivering";
      meta.delivery_directory = b.directory;
      meta.delivery_dimensions ??= freezeDimension(
        dimensionView(
          await mgr.query("SELECT * FROM artifacts WHERE project_id=?", [p.id]),
          meta.accepted_id,
        ).images[0],
      );
    } else if (action === "run-delivered") {
      check(
        meta.status === "delivering" &&
          meta.delivery_directory === b.directory &&
          /^[a-f0-9]{64}$/.test(b.manifest_sha256),
        "DELIVERY",
        "交付回执不匹配",
      );
      meta.status = "completed";
      meta.delivery_manifest = b.manifest_sha256;
    } else check(false, "ACTION", "未知运行命令");
    return {
      execution: await updateExecution(mgr, a, meta, b.expected_revision),
    };
  }
  if (action === "task-close") {
    const { a, meta } = await currentTask(mgr, p, b.task);
    await noUnknown(mgr, p, a.id);
    const artifacts = await mgr.query(
      "SELECT * FROM artifacts WHERE project_id=?",
      [p.id],
    );
    const linked = artifacts.filter((x) => json(x.meta).task_id === a.id);
    if (meta.retouch.kind === "image")
      check(
        currentImageDelivery({ ...a, meta: stable(meta) }, artifacts),
        "TASK_INCOMPLETE",
        "图像任务尚无已接受并交付的真实运行",
        1,
      );
    else
      check(
        linked.some((x) => x.kind === "design"),
        "TASK_INCOMPLETE",
        "设计任务尚无设计工件",
        1,
      );
    meta.status = "done";
    meta.status_at = timestamp();
    meta.retouch.closure = text(b.statement, "收口依据");
    const taskNode = await one(
      mgr,
      "SELECT id FROM nodes WHERE tree_id=? AND key=?",
      [node.tree_id, "task-" + a.id],
    );
    check(taskNode, "TASK_NODE", "任务缺少原生节点", 1);
    const evidence =
      meta.retouch.kind === "image"
        ? currentImageDeliveries(a, artifacts)
        : linked.filter(
            (x) =>
              x.kind === "design" &&
              (!meta.retouch.design_id || x.id === meta.retouch.design_id),
          );
    check(evidence.length, "TASK_EVIDENCE", "完成任务必须关联当前有效产物", 1);
    for (const item of evidence) {
      await relation(
        mgr,
        "node",
        taskNode.id,
        "artifact",
        item.id,
        "evidenced-by",
      );
      const em = json(item.meta);
      if (em.media_id)
        await relation(
          mgr,
          "node",
          taskNode.id,
          "artifact",
          em.media_id,
          "evidenced-by",
        );
      if (em.accepted_id)
        await relation(
          mgr,
          "node",
          taskNode.id,
          "artifact",
          em.accepted_id,
          "evidenced-by",
        );
    }
    await stepState(mgr, node.tree_id, "default", taskNode.id, "unlocked");
    return { task: await updateTask(mgr, a, meta, b.expected_revision) };
  }
  check(false, "ACTION", "未知原生业务动作：" + action);
}

const SNAPSHOT_TABLES = [
  "projects",
  "trees",
  "nodes",
  "node_edges",
  "node_conditions",
  "node_state",
  "artifacts",
  "relations",
];
async function snapshot(mgr, p) {
  const tables = { projects: [p] };
  tables.trees = await mgr.query(
    "SELECT * FROM trees WHERE project_id=? ORDER BY id",
    [p.id],
  );
  const trees = new Set(tables.trees.map((t) => t.id));
  tables.nodes = (await mgr.query("SELECT * FROM nodes ORDER BY id")).filter(
    (n) => trees.has(n.tree_id),
  );
  const nodes = new Set(tables.nodes.map((n) => n.id));
  tables.node_edges = (
    await mgr.query("SELECT * FROM node_edges ORDER BY id")
  ).filter((e) => trees.has(e.tree_id));
  tables.node_conditions = (
    await mgr.query("SELECT * FROM node_conditions ORDER BY id")
  ).filter((c) => nodes.has(c.node_id));
  tables.node_state = (
    await mgr.query("SELECT * FROM node_state ORDER BY node_id,context")
  ).filter((s) => trees.has(s.tree_id));
  tables.artifacts = await mgr.query(
    "SELECT * FROM artifacts WHERE project_id=? ORDER BY id",
    [p.id],
  );
  const refs = new Set([...nodes, ...tables.artifacts.map((a) => a.id)]);
  const allRelations = await mgr.query("SELECT * FROM relations ORDER BY id");
  // A project package must be a closed native graph. External citations carry local snapshots.
  tables.relations = allRelations.filter(
    (r) => refs.has(r.src_id) || refs.has(r.dst_id),
  );
  check(
    tables.relations.every((r) => refs.has(r.src_id) && refs.has(r.dst_id)),
    "SNAPSHOT_EXTERNAL_RELATION",
    "项目存在未保全的外部原生关系；先捕获引用副本",
    1,
  );
  check(
    !(await one(mgr, "SELECT id FROM sources WHERE project_id=? LIMIT 1", [
      p.id,
    ])) &&
      !(await one(mgr, "SELECT id FROM claims WHERE project_id=? LIMIT 1", [
        p.id,
      ])) &&
      !(await one(mgr, "SELECT id FROM queries WHERE project_id=? LIMIT 1", [
        p.id,
      ])),
    "SNAPSHOT_UNSUPPORTED_ASSETS",
    "此项目含额外研究资产；不能静默丢弃，请使用兼容的原生导出扩展",
    1,
  );
  const eventIds = new Set([...refs, p.id, p.name, ...trees]);
  tables.events = (
    await mgr.query("SELECT * FROM events ORDER BY rowid")
  ).filter(
    (e) =>
      eventIds.has(e.entity_id) &&
      !["cmd.run", "retouch.import"].includes(e.kind),
  );
  return {
    schema: "retouch.native-project/v1",
    project_id: p.id,
    tables,
    fingerprint: digest(tables),
  };
}

export function validateSnapshot(s) {
  check(
    s?.schema === "retouch.native-project/v1" &&
      s.tables &&
      digest(s.tables) === s.fingerprint,
    "SNAPSHOT_HASH",
    "原生项目快照或指纹无效",
  );
  check(
    Object.keys(s.tables).sort().join(",") ===
      [...SNAPSHOT_TABLES, "events"].sort().join(","),
    "SNAPSHOT_TABLES",
    "快照有未知或缺失表",
  );
  const t = s.tables;
  check(
    SNAPSHOT_TABLES.every((k) => Array.isArray(t[k])) &&
      Array.isArray(t.events) &&
      t.projects.length === 1 &&
      t.projects[0].id === s.project_id,
    "SNAPSHOT_PROJECT",
    "快照项目身份无效",
  );
  const allowed = {
    projects: "id,name,question,inclusion,exclusion,status,created,updated",
    trees: "id,project_id,name,note,created",
    nodes: "id,tree_id,key,name,kind,tier,cost,cost_unit,payload,tags,created",
    node_edges:
      "id,tree_id,parent_id,child_id,rel,mode,required,min_level,weight,note,created",
    node_conditions:
      "id,node_id,name,kind,expr,op,value,required,effect,weight,note,created",
    node_state: "tree_id,context,node_id,status,level,progress,updated",
    artifacts:
      "id,project_id,kind,title,format,content,version,created,updated,meta",
    relations: "id,src_type,src_id,dst_type,dst_id,rel,weight,created",
    events: "id,ts,actor,kind,entity,entity_id,payload,level,seq",
  };
  for (const [table, rows] of Object.entries(t)) {
    check(rows.length <= 10000, "SNAPSHOT_LIMIT", "快照条目超限");
    const ids = new Set();
    for (const row of rows) {
      check(
        row &&
          Object.keys(row).every((k) =>
            allowed[table].split(",").includes(k),
          ) &&
          Object.values(row).every(
            (v) => v === null || ["string", "number"].includes(typeof v),
          ),
        "SNAPSHOT_COLUMNS",
        "快照包含未知列或非法数据",
      );
      const key =
        table === "node_state"
          ? stable([row.tree_id, row.context, row.node_id])
          : row.id;
      check(
        typeof key === "string" && key.length > 0 && !ids.has(key),
        "SNAPSHOT_ID",
        "快照包含重复或空 ID",
      );
      ids.add(key);
    }
  }
  const trees = new Set(t.trees.map((x) => x.id)),
    nodes = new Set(t.nodes.map((x) => x.id)),
    artifacts = new Set(t.artifacts.map((x) => x.id));
  check(
    t.trees.every((x) => x.project_id === s.project_id) &&
      t.artifacts.every(
        (x) =>
          x.project_id === s.project_id &&
          Number.isSafeInteger(x.version) &&
          x.version > 0,
      ),
    "SNAPSHOT_OWNERSHIP",
    "工件或树跨项目",
  );
  check(
    t.nodes.every((x) => trees.has(x.tree_id)) &&
      t.node_edges.every(
        (x) =>
          trees.has(x.tree_id) &&
          nodes.has(x.parent_id) &&
          nodes.has(x.child_id),
      ) &&
      t.node_conditions.every((x) => nodes.has(x.node_id)) &&
      t.node_state.every((x) => trees.has(x.tree_id) && nodes.has(x.node_id)),
    "SNAPSHOT_REFERENCES",
    "原生图存在悬空引用",
  );
  const endpoint = (type, id) =>
    type === "node"
      ? nodes.has(id)
      : ["artifact", "task"].includes(type) && artifacts.has(id);
  check(
    t.relations.every(
      (x) => endpoint(x.src_type, x.src_id) && endpoint(x.dst_type, x.dst_id),
    ),
    "SNAPSHOT_RELATIONS",
    "关系端点无效",
  );
  validateFlowSnapshot(t.artifacts);
  for (const a of t.artifacts) {
    const m = json(a.meta);
    if (a.kind === "profile" && json(a.content).rating_record)
      rawRating(json(a.content).rating_record);
    if (m.role === "product-facts") productFacts(json(a.content), t.artifacts);
    if (m.requested_dimensions) requestedDimensions(m.requested_dimensions);
    if (m.role === "workflow-plan" && json(a.content).facts_id) {
      const plan = json(a.content),
        facts = t.artifacts.find(
          (x) =>
            x.id === plan.facts_id && json(x.meta).role === "product-facts",
        );
      check(
        facts && plan.facts_hash === digest(facts.content),
        "FACTS_BINDING",
        "计划商品事实快照不完整",
      );
      const assessment = factCheck(
        json(facts.content),
        plan.steps,
        plan.purpose,
      );
      check(
        !assessment.blocking.length &&
          stable(assessment) === stable(plan.fact_check),
        "FACTS_BINDING",
        "计划商品事实检查不匹配",
      );
    }
    const apiRef = (id) =>
      t.artifacts.find((x) => x.id === id && x.kind === "executor-profile");
    if (a.kind === "executor-profile") {
      const config = json(a.content);
      apiProfile(config.profile);
      check(
        /^[a-f0-9]{64}$/.test(config.endpoint_fingerprint),
        "SNAPSHOT_API_PROFILE",
        "API 执行配置缺少 endpoint 绑定",
      );
    }
    if (a.kind === "spec" && m.role === "workflow-plan") {
      const body = json(a.content);
      if (body.fallback) {
        const profile = apiRef(body.fallback.profile_id);
        check(
          profile &&
            digest(json(profile.content)) === body.fallback.profile_hash,
          "SNAPSHOT_API_REFERENCE",
          "计划未绑定有效原生 API 配置",
        );
      }
      for (const step of body.steps ?? [])
        for (const reference of step.references ?? [])
          check(
            artifacts.has(reference.media_id),
            "SNAPSHOT_REFERENCES",
            "步骤参考图不存在",
          );
    }
    if (m.api_fallback)
      check(
        apiRef(m.api_fallback.profile_id),
        "SNAPSHOT_API_REFERENCE",
        "授权引用的 API 配置不存在",
      );
    if (m.api_intent) {
      const intent = m.api_intent;
      check(
        apiRef(intent.profile_id) &&
          artifacts.has(intent.prompt_id) &&
          artifacts.has(intent.grant_id) &&
          [
            intent.uploads.input_id,
            ...intent.uploads.reference_ids,
            ...(intent.uploads.mask_id ? [intent.uploads.mask_id] : []),
          ].every((id) => artifacts.has(id)),
        "SNAPSHOT_API_REFERENCE",
        "API 执行或传输素材引用不完整",
      );
    }
    if (m.api_response)
      check(
        artifacts.has(m.api_response.raw_output) &&
          m.api_response.operation_key === m.api_intent?.operation_key,
        "SNAPSHOT_API_RESULT",
        "API 原始结果或操作身份不匹配",
      );
    for (const key of [
      "task_id",
      "goal_id",
      "plan_id",
      "grant_id",
      "media_id",
      "profile_id",
      "contract_id",
      "suite_id",
      "snapshot_id",
    ])
      if (m[key])
        check(
          artifacts.has(m[key]),
          "SNAPSHOT_REFERENCES",
          "工件元数据存在悬空引用：" + key,
        );
    for (const key of ["parents", "inputs", "outputs"])
      if (m[key])
        check(
          Array.isArray(m[key]) && m[key].every((id) => artifacts.has(id)),
          "SNAPSHOT_REFERENCES",
          "工件列表存在悬空引用：" + key,
        );
    if (a.kind === "task") {
      const r = m.retouch;
      check(
        r &&
          artifacts.has(r.goal_id) &&
          (!r.plan_id || artifacts.has(r.plan_id)) &&
          (r.dependencies ?? []).every((id) => artifacts.has(id)),
        "SNAPSHOT_TASK",
        "任务缺少目标、计划或前置任务",
      );
      check(
        t.relations.some(
          (x) =>
            x.src_type === "node" &&
            x.dst_id === a.id &&
            x.rel === "tracked-by",
        ) &&
          t.relations.some(
            (x) =>
              x.src_id === a.id &&
              x.dst_id === r.goal_id &&
              x.rel === "specified-by",
          ),
        "SNAPSHOT_TASK_RELATION",
        "任务缺少原生 tracked-by／specified-by 关系",
      );
    }
    if (a.kind === "media" || m.object_path)
      check(
        /^[a-f0-9]{64}$/.test(m.sha256) &&
          m.object_path ===
            "objects/sha256/" + m.sha256.slice(0, 2) + "/" + m.sha256,
        "SNAPSHOT_MEDIA",
        "素材路径无效",
      );
  }
  check(
    t.nodes.some(
      (n) => n.key === "project" && artifacts.has(json(n.payload).profile_id),
    ),
    "SNAPSHOT_PROFILE",
    "项目缺少有效 profile",
  );
  return s;
}
async function restore(mgr, api, b) {
  const s = validateSnapshot(b.snapshot);
  const prior = await one(
    mgr,
    "SELECT payload FROM events WHERE kind='retouch.import' AND json_extract(payload,'$.fingerprint')=?",
    [s.fingerprint],
  );
  if (prior && b.strategy !== "clone")
    return { imported: false, replayed: true, project_id: s.project_id };
  check(
    ["restore", "clone", "preview"].includes(b.strategy),
    "STRATEGY",
    "导入策略须为 restore/clone/preview",
  );
  let t = structuredClone(s.tables);
  let identityMapping = [];
  const existing = await one(
    mgr,
    "SELECT id FROM projects WHERE id=? OR name=?",
    [s.project_id, t.projects[0].name],
  );
  if (b.strategy === "preview") {
    const collisions = [];
    if (b.preview_strategy === "clone") {
      text(b.name, "clone 项目名");
      const duplicate = await one(mgr, "SELECT id FROM projects WHERE name=?", [
        b.name,
      ]);
      return {
        can_restore: !duplicate,
        conflicts: duplicate ? ["project-name:" + b.name] : [],
        project_id: s.project_id,
        strategy: "clone",
      };
    }
    if (existing) collisions.push("project:" + existing.id);
    for (const table of SNAPSHOT_TABLES.filter(
      (k) => !["projects", "node_state"].includes(k),
    ))
      for (const row of t[table]) {
        if (await one(mgr, "SELECT id FROM " + table + " WHERE id=?", [row.id]))
          collisions.push(table + ":" + row.id);
      }
    for (const tree of t.trees)
      if (await one(mgr, "SELECT id FROM trees WHERE name=?", [tree.name]))
        collisions.push("tree-name:" + tree.name);
    return {
      can_restore: !collisions.length || !!prior,
      conflicts: prior ? [] : collisions,
      project_id: s.project_id,
    };
  }
  if (b.strategy === "clone") {
    text(b.name, "clone 项目名");
    const ids = new Map();
    for (const table of SNAPSHOT_TABLES.filter((k) => k !== "node_state"))
      for (const row of t[table]) ids.set(row.id, uid());
    identityMapping = [...ids].map(([source, target]) => ({ source, target }));
    // Rewrite exact ID strings, including structured native payloads; never rewrite prose substrings.
    function remap(v) {
      if (typeof v === "string") {
        if (ids.has(v)) return ids.get(v);
        try {
          const parsed = JSON.parse(v);
          if (parsed && typeof parsed === "object")
            return stable(remap(parsed));
        } catch {}
        return v;
      }
      if (Array.isArray(v)) return v.map(remap);
      if (
        v &&
        typeof v === "object" &&
        v.schema === "retouch.product-facts/v1"
      ) {
        const cloned = structuredClone(v);
        for (const f of cloned.fields)
          f.source.artifact_id =
            ids.get(f.source.artifact_id) ?? f.source.artifact_id;
        return cloned;
      }
      if (v && typeof v === "object")
        return Object.fromEntries(
          Object.entries(v).map(([k, x]) => [
            k,
            [
              "citation",
              "legacy_identity",
              "cloned_from",
              "id_mapping",
              "source_project",
              "source_artifact",
              "source_workspace",
              "source_version",
              "source_hash",
              "source_fingerprint",
              "operation_key",
              "api_operation",
              "provider_request_id",
              "external_request",
              "rating_record",
              "quote",
              "original_text",
              "source_ref",
              "output_manifest",
            ].includes(k)
              ? structuredClone(x)
              : remap(x),
          ]),
        );
      return v;
    }
    t = remap(t);
    for (const a of t.artifacts) {
      const m = json(a.meta);
      if (m.contract_id) {
        const contract = t.artifacts.find((x) => x.id === m.contract_id);
        m.contract_hash = digest(contract.content);
        a.meta = stable(m);
      }
    }
    for (const a of t.artifacts) {
      if (
        !["spec", "execution"].includes(a.kind) ||
        !["workflow-plan", "workflow-run"].includes(json(a.meta).role)
      )
        continue;
      const plan = json(a.content);
      if (plan.facts_id) {
        const facts = t.artifacts.find((x) => x.id === plan.facts_id);
        plan.facts_hash = digest(facts.content);
        plan.fact_check = factCheck(
          json(facts.content),
          plan.steps,
          plan.purpose,
        );
        for (const step of plan.steps) {
          const bound = plan.fact_check.step_checks.find(
            (c) => c.step_id === step.id,
          );
          step.fact_constraints = bound.constraints;
          step.bound_facts = renderFacts(bound);
        }
        a.content = stable(plan);
      }
    }
    for (const a of t.artifacts) {
      const m = json(a.meta);
      if (m.role !== "suite-export") continue;
      const frozen = json(a.content);
      const suite = t.artifacts.find((x) => x.id === frozen.snapshot_id);
      if (suite) frozen.snapshot_hash = digest(suite.content);
      if (frozen.output_profile) {
        for (const ref of [
          frozen.output_profile.design,
          ...Object.values(frozen.output_profile.crops).map((c) => c.approval),
        ]) {
          const source = t.artifacts.find((x) => x.id === ref.artifact_id);
          if (source) ref.content_hash = digest(source.content);
        }
        if (m.output_catalog) {
          m.output_catalog.snapshot_hash = frozen.snapshot_hash;
          m.output_catalog.output_profile = frozen.output_profile;
          m.output_catalog.profile_hash = digest(frozen.output_profile);
        }
        if (m.output_manifest)
          m.external_output_status = "historical-source-files-not-authorized";
      }
      a.content = stable(frozen);
      a.meta = stable(m);
    }
    t.projects[0].name = b.name;
    for (const tree of t.trees) tree.name = "retouch-" + tree.id;
    for (const n of t.nodes)
      if (n.key.startsWith("task-") && ids.has(n.key.slice(5)))
        n.key = "task-" + ids.get(n.key.slice(5));
    for (const n of t.nodes) {
      const data = json(n.payload);
      if (
        n.key.startsWith("step-") &&
        data.plan_id &&
        Number.isInteger(data.position)
      )
        n.key = "step-" + data.plan_id + "-" + data.position;
    }
    t.events = t.events.map((event, index) => ({
      id: uid(),
      ts: event.ts,
      actor: "clone-history",
      kind: "retouch.history",
      entity: "project",
      entity_id: t.projects[0].id,
      payload: stable({
        source_project: s.project_id,
        original: s.tables.events[index],
      }),
      level: "info",
      seq: null,
    }));
    const currentProfile = t.artifacts.find(
      (a) =>
        a.kind === "profile" &&
        a.id ===
          json(t.nodes.find((n) => n.key === "project").payload).profile_id,
    );
    const cloneContent = {
      ...json(currentProfile.content),
      cloned_from: { project_id: s.project_id, fingerprint: s.fingerprint },
    };
    // Native profile content records clone provenance; no source project row is fabricated.
    currentProfile.content = stable(cloneContent);
  } else
    check(
      !existing,
      "IMPORT_CONFLICT",
      "原生项目已有进度或同名项目；不覆盖，请显式 clone",
      1,
    );
  for (const table of SNAPSHOT_TABLES) {
    for (const row of t[table]) {
      const keys = Object.keys(row);
      if (table !== "node_state")
        check(
          !(await one(mgr, "SELECT id FROM " + table + " WHERE id=?", [
            row.id,
          ])),
          "IMPORT_ID_CONFLICT",
          "目标原生 ID 冲突：" + row.id,
          1,
        );
      await mgr.query(
        "INSERT INTO " +
          table +
          "(" +
          keys.join(",") +
          ") VALUES(" +
          keys.map(() => "?").join(",") +
          ")",
        keys.map((k) => row[k]),
      );
    }
  }
  for (const event of t.events) {
    const same = await one(mgr, "SELECT * FROM events WHERE id=?", [event.id]);
    check(
      !same || stable(same) === stable(event),
      "IMPORT_EVENT_CONFLICT",
      "原生事件 ID 冲突",
      1,
    );
    if (!same) {
      const keys = Object.keys(event);
      await mgr.query(
        "INSERT INTO events(" +
          keys.join(",") +
          ") VALUES(" +
          keys.map(() => "?").join(",") +
          ")",
        Object.values(event),
      );
    }
  }
  for (const tree of t.trees) await refreshGraph(mgr, api, tree.id);
  if (b.strategy === "clone") {
    const provenance = await append(
      mgr,
      t.projects[0],
      "provenance",
      "Clone source and identity mapping",
      {
        source_project: s.project_id,
        source_fingerprint: s.fingerprint,
        id_mapping: identityMapping,
      },
      { schema: SCHEMA, role: "reference" },
    );
    await relation(
      mgr,
      "node",
      t.nodes.find((n) => n.key === "project").id,
      "artifact",
      provenance.id,
      "derived-from",
    );
  }
  await api.logEvent(mgr, "retouch.import", "project", t.projects[0].id, {
    fingerprint: s.fingerprint,
    source_project: s.project_id,
    id_mapping: identityMapping,
    strategy: b.strategy,
    authorization_ids: t.artifacts
      .filter((a) => a.kind === "authorization")
      .map((a) => a.id),
  });
  return {
    imported: true,
    project_id: t.projects[0].id,
    source_project: s.project_id,
    historical_permissions: "inactive-in-target-workspace",
  };
}
