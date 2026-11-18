// Restricted native registration correction. Never changes render facts or grants acceptance.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
const meta = (a) => (typeof a.meta === "string" ? JSON.parse(a.meta) : a.meta);
const need = (ok, code, message) => {
  if (!ok) throw Object.assign(new Error(message), { code, rc: 2 });
};
const words = (value, label) =>
  need(
    typeof value === "string" && value.trim() && value.length <= 4000,
    "OUTPUT_CORRECTION_INPUT",
    label + "须为有限非空原文",
  );
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const record = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const uniqueIds = (x) =>
  Array.isArray(x) &&
  x.length > 0 &&
  x.every((id) => typeof id === "string" && id) &&
  new Set(x).size === x.length;
export const correctionConfirmation =
  "允许在所列工作区将所列已收到输出的登记角色从reference更正为candidate；保留执行事实及旧审阅，不授予图像接受或交付。";
const permissionKeys = [
  "schema",
  "decision",
  "workspace_id",
  "project_id",
  "task_id",
  "execution_id",
  "media_id",
  "sha256",
  "from_role",
  "to_role",
  "confirmation",
];
function sourcePermission(
  b,
  execution,
  image,
  task,
  source,
  artifacts,
  digest,
  historical = false,
) {
  const ref = b.source,
    sm = meta(source);
  need(
    record(ref) &&
      Object.keys(ref).every((k) =>
        ["artifact_id", "version", "content_hash", "quote"].includes(k),
      ) &&
      ref.artifact_id === source.id &&
      ["spec", "design"].includes(source.kind) &&
      source.project_id === execution.project_id &&
      ["user-original", "confirmed-fact"].includes(sm.role) &&
      (!sm.task_id || sm.task_id === task.id) &&
      ref.version === source.version &&
      ref.content_hash === digest(source.content) &&
      typeof ref.quote === "string" &&
      ref.quote === correctionConfirmation &&
      source.content.includes(ref.quote),
    "OUTPUT_CORRECTION_SOURCE",
    "须引用可靠原生授权文档的精确ID/version/hash和固定确认原文",
  );
  need(
    historical || sm.correction_permission_import_id !== source.id,
    "OUTPUT_CORRECTION_PERMISSION",
    "导入/clone许可仅保留历史；当前执行须新的可靠当前工作区确认记录",
  );
  let permission;
  try {
    permission = JSON.parse(source.content);
  } catch {}
  need(
    record(permission) &&
      source.content.trim() === JSON.stringify(permission) &&
      Object.keys(permission).length === permissionKeys.length &&
      Object.keys(permission).every((k) => permissionKeys.includes(k)) &&
      permission.schema === "retouch.output-correction-permission/v1" &&
      permission.decision === "allow" &&
      permission.workspace_id === b.workspace_id &&
      permission.project_id === execution.project_id &&
      permission.task_id === task.id &&
      permission.execution_id === execution.id &&
      permission.media_id === image.id &&
      permission.sha256 === meta(image).sha256 &&
      permission.from_role === "reference" &&
      permission.to_role === "candidate" &&
      permission.confirmation === correctionConfirmation &&
      b.confirmation === permission.confirmation,
    "OUTPUT_CORRECTION_PERMISSION",
    "授权须明确允许当前workspace/执行/输出/hash/旧新角色；否定、冲突、额外字段或自由确认不作为许可",
  );
  need(
    historical ||
      !artifacts.some(
        (a) =>
          a.project_id === source.project_id &&
          a.kind === source.kind &&
          a.title === source.title &&
          a.version > source.version,
      ),
    "OUTPUT_CORRECTION_SOURCE_STALE",
    "授权来源已更新，先读取当前版本",
  );
  return permission;
}
function exclusiveOutput(
  execution,
  image,
  artifacts,
  code = "OUTPUT_CORRECTION_SHARED_OUTPUT",
) {
  need(
    !artifacts.some(
      (a) =>
        a.kind === "execution" &&
        a.id !== execution.id &&
        Array.isArray(meta(a).outputs) &&
        meta(a).outputs.includes(image.id),
    ),
    code,
    "输出被另一执行共享，首版拒绝歧义纠错，不扩大本执行授权",
  );
}
export async function assertCorrectionWorkspace(b, mgr) {
  const rows = await mgr.query(
    "SELECT value FROM meta WHERE key='retouch.workspace.identity'",
    [],
  );
  let identity;
  try {
    identity = rows[0] && JSON.parse(rows[0].value);
  } catch {}
  need(
    identity?.id && b.workspace_id === identity.id,
    "OUTPUT_CORRECTION_AUTHORITY_LOCAL",
    "纠错请求/旧回执须绑定当前工作区；恢复后的旧workspace请求不能执行或重放",
  );
  return identity;
}
export function correctionPlan(
  b,
  execution,
  image,
  task,
  source,
  artifacts,
  digest,
) {
  need(
    record(b) &&
      Object.keys(b).every((k) =>
        [
          "project",
          "id",
          "task",
          "output_id",
          "sha256",
          "expected_revision",
          "expected_role",
          "role",
          "actor",
          "reason",
          "source",
          "dry_run",
          "workspace_id",
          "confirmation",
        ].includes(k),
      ),
    "OUTPUT_CORRECTION_FIELDS",
    "纠错不能携带状态、输出列表、目标、接受或任意元数据字段",
  );
  const em = meta(execution),
    im = meta(image),
    tm = meta(task);
  need(
    execution.kind === "execution" &&
      em.role === "external" &&
      em.status === "received",
    "OUTPUT_CORRECTION_STATE",
    "仅更正外部已received输出登记角色，不改变执行事实",
  );
  need(
    Number.isSafeInteger(b.expected_revision) &&
      b.expected_revision >= 0 &&
      em.revision === b.expected_revision,
    "REVISION_CONFLICT",
    "执行记录已变化，请读当前revision",
  );
  need(
    task.kind === "task" &&
      b.id === execution.id &&
      b.project === execution.project_id &&
      b.task === task.id &&
      em.task_id === task.id &&
      image.kind === "media" &&
      b.output_id === image.id &&
      uniqueIds(em.outputs) &&
      em.outputs.includes(image.id) &&
      execution.project_id === image.project_id &&
      execution.project_id === task.project_id &&
      im.task_id === em.task_id &&
      im.goal_id === em.goal_id &&
      tm.retouch?.goal_id,
    "OUTPUT_CORRECTION_BINDING",
    "原项目/任务/目标/输出列表须明确一致",
  );
  need(
    b.expected_role === "reference" &&
      b.role === "candidate" &&
      im.role === b.expected_role &&
      !im.registration_corrections?.length,
    "OUTPUT_CORRECTION_ROLE",
    "首版只允许未更正reference一次更正为candidate",
  );
  need(
    /^[a-f0-9]{64}$/.test(b.sha256) && b.sha256 === im.sha256,
    "OUTPUT_CORRECTION_HASH",
    "纠错须绑定原输出实际hash",
  );
  need(
    b.dry_run === undefined || typeof b.dry_run === "boolean",
    "OUTPUT_CORRECTION_INPUT",
    "dry_run须为布尔值",
  );
  words(b.actor, "实际纠错者");
  words(b.reason, "登记纠错原因");
  words(b.workspace_id, "当前工作区身份");
  sourcePermission(b, execution, image, task, source, artifacts, digest);
  exclusiveOutput(execution, image, artifacts);
  validateCorrectionReferences(execution, artifacts, digest);
  need(
    !artifacts.some(
      (a) =>
        a.kind === "review" &&
        meta(a).media_id === image.id &&
        meta(a).accepted === true,
    ) &&
      !artifacts.some(
        (a) =>
          a.kind === "delivery" &&
          meta(a).media_id === image.id &&
          meta(a).status === "completed",
      ) &&
      !artifacts.some(
        (a) => a.kind === "execution" && meta(a).accepted_id === image.id,
      ),
    "OUTPUT_CORRECTION_ALREADY_ACCEPTED",
    "已接受/完成交付对象不走登记更正，不改写旧接受",
  );
  return {
    schema: "retouch.output-registration-correction/v1",
    execution_id: execution.id,
    media_id: image.id,
    task_id: task.id,
    goal_id: em.goal_id,
    sha256: im.sha256,
    before: {
      role: im.role,
      execution_revision: em.revision,
      status: em.status,
      outputs: [...em.outputs],
    },
    after: {
      role: "candidate",
      execution_revision: em.revision + 1,
      status: "received",
      outputs: [...em.outputs],
    },
    actor: b.actor.trim(),
    reason: b.reason.trim(),
    source: structuredClone(b.source),
    authority_workspace_id: b.workspace_id,
    confirmation: b.confirmation,
    visual_acceptance: "UNCHANGED_NOT_GRANTED",
    task_context: "UNCHANGED_NEEDS_SEPARATE_REVIEW",
  };
}
async function verifyObject(root, image) {
  const m = meta(image);
  need(
    m.object_path ===
      "objects/sha256/" + m.sha256.slice(0, 2) + "/" + m.sha256 &&
      Number.isSafeInteger(m.bytes) &&
      m.bytes > 0 &&
      m.bytes <= 32 * 1024 * 1024,
    "OUTPUT_CORRECTION_CAS",
    "对象路径/字节元数据无效",
  );
  const file = path.join(root, m.object_path);
  need(
    (await fs.realpath(file)) === file &&
      !(await fs.lstat(file)).isSymbolicLink(),
    "OUTPUT_CORRECTION_CAS",
    "不跟随对象链接",
  );
  need(
    (await fs.stat(file)).size === m.bytes,
    "OUTPUT_CORRECTION_CAS",
    "对象实际长度不符，拒绝更正",
  );
  const bytes = await fs.readFile(file);
  need(
    bytes.length === m.bytes && sha(bytes) === m.sha256,
    "OUTPUT_CORRECTION_CAS",
    "输出CAS字节不符",
  );
}
export async function correctReceivedOutput(b, h) {
  const {
    mgr,
    p,
    artifact,
    task,
    append,
    relation,
    updateExecution,
    workspaceRoot,
    stable,
    digest,
  } = h;
  await assertCorrectionWorkspace(b, mgr);
  const execution = await artifact(mgr, b.id, p, "execution"),
    image = await artifact(mgr, b.output_id, p, "media"),
    t = await task(mgr, p, b.task),
    source = await artifact(mgr, b.source?.artifact_id, p);
  const all = await mgr.query(
    "SELECT * FROM artifacts WHERE project_id=? ORDER BY created,id",
    [p.id],
  );
  const plan = correctionPlan(b, execution, image, t.a, source, all, digest);
  await verifyObject(workspaceRoot, image);
  if (b.dry_run === true)
    return {
      dry_run: true,
      correction: plan,
      would_change_only: [
        "media.role",
        "media.registration_corrections",
        "execution.revision",
        "execution.registration_corrections",
        "native audit artifact/relations/event",
      ],
      execution,
      artifact: image,
      acceptance_changed: false,
      visual_verdict: "UNCHANGED",
      render_requests: 0,
    };
  const audit = await append(
    mgr,
    p,
    "note",
    "Output registration correction " + image.id,
    plan,
    {
      schema: "retouch.native/v1",
      role: "output-registration-correction",
      execution_id: execution.id,
      task_id: t.a.id,
      goal_id: plan.goal_id,
      media_id: image.id,
      sha256: plan.sha256,
      inputs: [execution.id, image.id, source.id],
    },
  );
  const im = structuredClone(meta(image)),
    em = structuredClone(meta(execution));
  im.role = "candidate";
  im.registration_corrections = [audit.id];
  em.registration_corrections = [
    ...(em.registration_corrections ?? []),
    audit.id,
  ];
  await mgr.query("UPDATE artifacts SET meta=?,updated=? WHERE id=?", [
    stable(im),
    new Date().toISOString(),
    image.id,
  ]);
  const updated = await updateExecution(
    mgr,
    execution,
    em,
    b.expected_revision,
  );
  await relation(
    mgr,
    "artifact",
    audit.id,
    "artifact",
    image.id,
    "corrects-registration",
  );
  await relation(
    mgr,
    "artifact",
    execution.id,
    "artifact",
    audit.id,
    "corrected-by",
  );
  return {
    correction: audit,
    execution: updated,
    artifact: { ...image, meta: stable(im) },
    acceptance_changed: false,
    visual_verdict: "UNCHANGED",
    render_requests: 0,
    preserved_status: "received",
    context_review_required:
      meta(t.a).retouch?.context_status === "needs_review",
  };
}
function auditParts(a, artifacts, digest) {
  const m = meta(a);
  let v;
  try {
    v = typeof a.content === "string" ? JSON.parse(a.content) : a.content;
  } catch {}
  need(
    a.kind === "note" &&
      m.role === "output-registration-correction" &&
      record(v) &&
      v.schema === "retouch.output-registration-correction/v1" &&
      record(v.source) &&
      record(v.before) &&
      record(v.after),
    "OUTPUT_CORRECTION_AUDIT",
    "审计类型/正文不完整",
  );
  const ex = artifacts.find(
      (x) => x.id === v.execution_id && x.kind === "execution",
    ),
    image = artifacts.find((x) => x.id === v.media_id && x.kind === "media"),
    task = artifacts.find((x) => x.id === v.task_id && x.kind === "task"),
    source = artifacts.find((x) => x.id === v.source.artifact_id);
  need(
    ex && image && task && source,
    "OUTPUT_CORRECTION_AUDIT",
    "审计主体缺失",
  );
  const em = meta(ex),
    im = meta(image);
  need(
    [ex, image, task, source].every((x) => x.project_id === a.project_id) &&
      m.execution_id === ex.id &&
      m.media_id === image.id &&
      m.task_id === task.id &&
      m.goal_id === v.goal_id &&
      m.sha256 === v.sha256 &&
      equal(m.inputs, [ex.id, image.id, source.id]) &&
      em.role === "external" &&
      em.status === "received" &&
      em.task_id === task.id &&
      em.goal_id === v.goal_id &&
      im.task_id === task.id &&
      im.goal_id === v.goal_id &&
      im.sha256 === v.sha256 &&
      im.role === "candidate" &&
      uniqueIds(v.before.outputs) &&
      equal(v.before.outputs, v.after.outputs) &&
      equal(em.outputs, v.after.outputs) &&
      v.after.outputs.includes(image.id) &&
      equal(im.registration_corrections, [a.id]) &&
      em.registration_corrections?.includes(a.id) &&
      Number.isSafeInteger(v.before.execution_revision) &&
      v.before.execution_revision >= 0 &&
      v.after.execution_revision === v.before.execution_revision + 1 &&
      v.before.role === "reference" &&
      v.after.role === "candidate" &&
      v.before.status === "received" &&
      v.after.status === "received" &&
      v.visual_acceptance === "UNCHANGED_NOT_GRANTED" &&
      v.task_context === "UNCHANGED_NEEDS_SEPARATE_REVIEW",
    "OUTPUT_CORRECTION_AUDIT",
    "审计元数据/正文/当前outputs/双向主体绑定不一致",
  );
  words(v.actor, "审计操作者");
  words(v.reason, "审计原因");
  words(v.authority_workspace_id, "历史授权工作区");
  sourcePermission(
    {
      source: v.source,
      workspace_id: v.authority_workspace_id,
      confirmation: v.confirmation,
    },
    ex,
    image,
    task,
    source,
    artifacts,
    digest,
    true,
  );
  exclusiveOutput(ex, image, artifacts, "OUTPUT_CORRECTION_AUDIT");
  return { execution: ex, image, value: v };
}
function executionChain(execution, artifacts, digest) {
  const em = meta(execution),
    refs = em.registration_corrections;
  need(uniqueIds(refs), "OUTPUT_CORRECTION_AUDIT", "执行审计链缺失或重复");
  let previous = null;
  const images = new Set();
  for (const id of refs) {
    const a = artifacts.find((x) => x.id === id);
    need(a, "OUTPUT_CORRECTION_AUDIT", "执行引用缺审计");
    const p = auditParts(a, artifacts, digest),
      v = p.value;
    need(
      p.execution.id === execution.id &&
        !images.has(p.image.id) &&
        (!previous ||
          previous.after.execution_revision === v.before.execution_revision),
      "OUTPUT_CORRECTION_AUDIT",
      "执行审计链跨主体、重复输出或revision不连续",
    );
    images.add(p.image.id);
    previous = v;
  }
  need(
    em.revision === previous.after.execution_revision,
    "OUTPUT_CORRECTION_AUDIT",
    "当前执行revision不等于审计链末端",
  );
}
export function validateCorrectionAudit(a, artifacts, digest) {
  const p = auditParts(a, artifacts, digest);
  executionChain(p.execution, artifacts, digest);
  return true;
}
export function assertCorrectionOutputAttachment(
  executionId,
  outputs,
  artifacts,
) {
  for (const id of outputs ?? []) {
    const image = artifacts.find((a) => a.id === id && a.kind === "media");
    const refs = image && meta(image).registration_corrections;
    if (refs === undefined) continue;
    need(
      uniqueIds(refs) && refs.length === 1,
      "OUTPUT_CORRECTION_SHARED_OUTPUT",
      "已纠错输出缺少唯一审计归属",
    );
    const note = artifacts.find((a) => a.id === refs[0] && a.kind === "note");
    let v;
    try {
      v = note && JSON.parse(note.content);
    } catch {}
    need(
      note &&
        meta(note).role === "output-registration-correction" &&
        meta(note).execution_id === executionId &&
        meta(note).media_id === image.id &&
        v?.execution_id === executionId &&
        v?.media_id === image.id,
      "OUTPUT_CORRECTION_SHARED_OUTPUT",
      "已纠错输出只能保留在原执行，不得挂载到另一个执行",
    );
  }
}
export function validateCorrectionReferences(subject, artifacts, digest) {
  const refs = meta(subject).registration_corrections;
  if (refs === undefined) return true;
  need(
    ["execution", "media"].includes(subject.kind) && uniqueIds(refs),
    "OUTPUT_CORRECTION_AUDIT",
    "非主体/重复/空审计引用",
  );
  if (subject.kind === "execution") executionChain(subject, artifacts, digest);
  else {
    need(
      refs.length === 1,
      "OUTPUT_CORRECTION_AUDIT",
      "媒体只允许一次reference至candidate登记更正",
    );
    const note = artifacts.find((x) => x.id === refs[0]);
    need(note, "OUTPUT_CORRECTION_AUDIT", "媒体引用缺审计");
    const p = auditParts(note, artifacts, digest);
    need(
      p.image.id === subject.id,
      "OUTPUT_CORRECTION_AUDIT",
      "媒体引用了另一主体的审计",
    );
    executionChain(p.execution, artifacts, digest);
  }
  return true;
}
