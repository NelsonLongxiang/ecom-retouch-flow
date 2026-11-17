// Executable content/evidence contracts, evaluated only from native artifacts.
import { digest, stable } from "./value.mjs";
import { outputProfile, cropApproval } from "./output-profile.mjs";
import {
  taskBinding,
  sameBinding,
  mediaApplicable,
  acceptedReview,
} from "./applicability.mjs";
export const meta = (a) =>
  typeof a.meta === "string" ? JSON.parse(a.meta) : a.meta;
export const content = (a) =>
  typeof a.content === "string" ? JSON.parse(a.content) : a.content;
export function need(ok, code, message) {
  if (!ok) throw Object.assign(new Error(message), { code, rc: 2 });
}
export function words(v, label) {
  need(
    typeof v === "string" && v.trim() && v.length < 20000,
    "FLOW_INPUT",
    label + "须有明确文字",
  );
  return v.trim();
}
export function assertPostprocessOutput(execution, image, artifacts) {
  const descriptor = content(execution),
    em = meta(execution),
    im = meta(image),
    transform = im?.transform;
  const provenance = (ok) =>
    need(
      ok,
      "POSTPROCESS_PROVENANCE",
      "后处理输出与执行描述/渲染溯源不一致；保留原事实，不补造执行关系",
    );
  const record = (value) =>
    value && typeof value === "object" && !Array.isArray(value);
  provenance(
    execution.kind === "execution" &&
      image.kind === "media" &&
      execution.project_id === image.project_id,
  );
  provenance(
    record(descriptor) &&
      descriptor.schema === "retouch.postprocess/v1" &&
      Array.isArray(descriptor.inputs) &&
      descriptor.inputs.length > 0 &&
      descriptor.inputs.every(
        (i) =>
          record(i) &&
          typeof i.id === "string" &&
          typeof i.sha256 === "string" &&
          typeof i.role === "string",
      ) &&
      Array.isArray(descriptor.operations) &&
      descriptor.operations.length > 0 &&
      descriptor.operations.every(
        (op) =>
          record(op) &&
          [
            "extract",
            "mask",
            "repair",
            "composite",
            "annotate",
            "resize",
            "extend",
            "encode",
          ].includes(op.op),
      ) &&
      record(descriptor.renderer),
  );
  provenance(
    record(transform) &&
      transform.schema === "retouch.postprocess/v1" &&
      transform.execution_id === execution.id &&
      Array.isArray(transform.inputs) &&
      Array.isArray(transform.trace) &&
      record(transform.renderer) &&
      record(em.renderer),
  );
  provenance(
    digest(transform.inputs) === digest(descriptor.inputs) &&
      digest(transform.renderer) === digest(descriptor.renderer) &&
      digest(em.renderer) === digest(descriptor.renderer),
  );
  provenance(
    Array.isArray(em.inputs) &&
      digest(em.inputs) === digest(descriptor.inputs.map((i) => i.id)),
  );
  provenance(transform.trace.length === descriptor.operations.length);
  const source = artifacts.find(
    (a) =>
      a.id === descriptor.input_id &&
      a.kind === "media" &&
      a.project_id === execution.project_id,
  );
  provenance(source && descriptor.inputs.some((i) => i.id === source.id));
  const input = meta(source);
  const frame = (value) =>
    record(value) &&
    Number.isSafeInteger(value.width) &&
    value.width > 0 &&
    Number.isSafeInteger(value.height) &&
    value.height > 0 &&
    value.width * value.height <= 50_000_000;
  let current = { width: input?.width, height: input?.height };
  provenance(frame(current));
  for (let n = 0; n < descriptor.operations.length; n++) {
    const step = transform.trace[n],
      operation = descriptor.operations[n];
    provenance(
      record(step) &&
        digest(step.operation) === digest(operation) &&
        frame(step.from) &&
        frame(step.to),
    );
    provenance(
      step.from.width === current.width && step.from.height === current.height,
    );
    let expected = current;
    if (operation.op === "resize")
      expected = { width: operation.width, height: operation.height };
    else if (operation.op === "extract")
      expected = {
        width: operation.region?.width,
        height: operation.region?.height,
      };
    else if (operation.op === "extend")
      expected = {
        width: current.width + operation.left + operation.right,
        height: current.height + operation.top + operation.bottom,
      };
    provenance(
      frame(expected) &&
        step.to.width === expected.width &&
        step.to.height === expected.height,
    );
    current = { width: step.to.width, height: step.to.height };
  }
  provenance(
    frame(im) && im.width === current.width && im.height === current.height,
  );
}

export function latest(artifacts, role, task) {
  return (
    artifacts
      .filter(
        (a) => meta(a).role === role && (!task || meta(a).task_id === task),
      )
      .sort((a, b) => a.version - b.version)
      .at(-1) ?? null
  );
}
const unique = (items) => new Set(items.map((x) => x.id)).size === items.length;
const key = (id) =>
  typeof id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(id);
export function sourceRef(s, artifacts) {
  need(
    s && typeof s.artifact_id === "string",
    "FLOW_SOURCE",
    "须引用已读取的原生来源",
  );
  const a = artifacts.find((a) => a.id === s.artifact_id);
  need(
    a &&
      ["spec", "design", "citation"].includes(a.kind) &&
      typeof s.quote === "string" &&
      s.quote.trim() &&
      a.content.includes(s.quote),
    "FLOW_SOURCE",
    "来源或精确摘录不匹配",
  );
  return a;
}
export function businessIntent(v, artifacts) {
  need(
    v?.schema === "retouch.business-intent/v1" &&
      v.business_intent &&
      Array.isArray(v.obligations) &&
      v.obligations.length > 0 &&
      v.obligations.length <= 60 &&
      unique(v.obligations),
    "BUSINESS_INTENT",
    "须声明用途与不重复的内容义务",
  );
  for (const k of ["problem", "audience", "how", "where"])
    need(
      v.business_intent[k] === null ||
        (typeof v.business_intent[k] === "string" &&
          v.business_intent[k].trim()),
      "BUSINESS_INTENT",
      "用途字段未知时使用null",
    );
  for (const o of v.obligations) {
    need(
      key(o.id) && typeof o.required === "boolean",
      "BUSINESS_INTENT",
      "内容项须有稳定ID和必检范围",
    );
    words(o.text, "内容义务");
    sourceRef(o.source, artifacts);
  }
  need(
    v.rollout &&
      ["sample-first", "direct-batch"].includes(v.rollout.mode) &&
      Array.isArray(v.rollout.representative_ids) &&
      v.rollout.representative_ids.length > 0 &&
      v.rollout.representative_ids.every((id) =>
        v.obligations.some((o) => o.id === id),
      ),
    "ROLLOUT",
    "须明确样张检查范围",
  );
  if (v.rollout.mode === "direct-batch")
    need(
      meta(sourceRef(v.rollout.user_decision, artifacts)).role ===
        "user-original",
      "ROLLOUT",
      "直接扩套须保留用户选择原文",
    );
  return structuredClone(v);
}
export function conflict(v, artifacts) {
  need(
    v?.schema === "retouch.evidence-conflict/v1" &&
      typeof v.field === "string" &&
      /^[a-z][a-z0-9_.-]{0,99}$/.test(v.field) &&
      Array.isArray(v.candidates) &&
      v.candidates.length >= 2 &&
      v.candidates.length <= 20 &&
      unique(v.candidates),
    "EVIDENCE_CONFLICT",
    "冲突须保留同一字段的多个候选",
  );
  for (const c of v.candidates) {
    need(
      key(c.id) &&
        (typeof c.value === "string" || Number.isFinite(c.value)) &&
        ["current-sku", "reference-sku", "unknown"].includes(c.subject) &&
        [
          "user-original",
          "verified-spec",
          "agent-interpretation",
          "reference",
          "hypothesis",
        ].includes(c.role) &&
        Number.isFinite(Date.parse(c.observed_at)),
      "EVIDENCE_CONFLICT",
      "候选须有值、角色、适用商品与观察时间",
    );
    sourceRef(c.source, artifacts);
  }
  need(
    new Set(v.candidates.map((c) => stable(c.value))).size > 1,
    "EVIDENCE_CONFLICT",
    "冲突不能只有同一个值",
  );
  if (v.research) {
    words(v.research.purpose, "补证目的");
    words(v.research.stop_when, "停止条件");
    need(
      Array.isArray(v.research.read_back) && v.research.read_back.length > 0,
      "EVIDENCE_CONFLICT",
      "先记录回读材料",
    );
    for (const s of v.research.read_back) sourceRef(s, artifacts);
  }
  need(
    ["unresolved", "selected", "deferred"].includes(v.status),
    "EVIDENCE_CONFLICT",
    "未决冲突不得被隐式覆盖",
  );
  if (v.status !== "unresolved") {
    words(v.decision?.statement, "选用或暂缓理由");
    words(v.decision?.reviewer, "复核者");
    words(v.decision?.source, "裁决来源");
    need(
      Array.isArray(v.decision.read_back) &&
        v.candidates.every((c) =>
          v.decision.read_back.some(
            (s) =>
              s.artifact_id === c.source.artifact_id &&
              s.quote === c.source.quote,
          ),
        ),
      "EVIDENCE_CONFLICT",
      "裁决前须回读所有冲突来源",
    );
    for (const s of v.decision.read_back) sourceRef(s, artifacts);
    if (v.status === "selected")
      need(
        v.candidates.some((c) => c.id === v.decision.candidate_id) &&
          ["concept-reference", "creative-choice", "verified-fact"].includes(
            v.decision.use,
          ),
        "EVIDENCE_CONFLICT",
        "须声明选用的候选及创作/事实边界",
      );
    if (v.decision.use === "verified-fact") {
      const selected = v.candidates.find(
        (c) => c.id === v.decision.candidate_id,
      );
      need(
        artifacts.some(
          (a) =>
            meta(a).role === "product-facts" &&
            content(a).fields.some(
              (f) =>
                f.key === v.field &&
                f.status === "confirmed" &&
                stable(f.value) === stable(selected.value),
            ),
        ),
        "EVIDENCE_CONFLICT",
        "事实裁决须已通过字段事实确认规则",
      );
    }
  }
  return structuredClone(v);
}
export function invariants(v, artifacts) {
  need(
    v?.schema === "retouch.invariants/v1" &&
      Array.isArray(v.items) &&
      v.items.length > 0 &&
      v.items.length <= 40 &&
      unique(v.items),
    "INVARIANTS",
    "保持项须有不重复清单",
  );
  for (const i of v.items) {
    need(
      key(i.id) && typeof i.required === "boolean",
      "INVARIANTS",
      "保持项须有ID和必检范围",
    );
    words(i.text, "保持项");
    words(i.scope, "适用视角/范围");
    const a = sourceRef(i.source, artifacts);
    need(
      !["hypothesis", "ai-reconstruction"].includes(meta(a).role),
      "INVARIANTS",
      "AI重建或假设不能作为确定的商品保持依据",
    );
  }
  return structuredClone(v);
}
export function inspectionItems(items, definitions) {
  need(
    Array.isArray(items) && items.length > 0 && unique(items),
    "INSPECTION",
    "逐项检查须有不重复的结果",
  );
  for (const i of items) {
    need(
      definitions.some((d) => d.id === i.id) &&
        ["PASS", "FAIL", "UNKNOWN"].includes(i.verdict),
      "INSPECTION",
      "检查项或结论无效",
    );
    words(i.observations, "实际观察");
    words(i.evidence, "观察证据及可见范围");
  }
  return structuredClone(items);
}
function itemVerdicts(artifacts, image, task, contract, role) {
  const result = new Map();
  for (const a of [...artifacts].sort((a, b) => a.version - b.version)) {
    const m = meta(a);
    if (
      a.kind === "review" &&
      m.role === role &&
      m.contract_id === contract.id &&
      m.media_id === image.id &&
      m.sha256 === meta(image).sha256 &&
      sameBinding(m, taskBinding(task, digest))
    )
      for (const i of content(a).items)
        result.set(i.id, { ...i, review_id: a.id });
  }
  return result;
}
export function invariantView(artifacts, image, task) {
  const contract = latest(artifacts, "product-invariants", task.id);
  if (!contract)
    return { status: "NOT_DECLARED", contract_id: null, items: [] };
  const assessed = itemVerdicts(
    artifacts,
    image,
    task,
    contract,
    "invariants-check",
  );
  const items = content(contract).items.map((i) => ({
    ...i,
    ...(assessed.get(i.id) ?? { verdict: "NOT_EVALUATED" }),
  }));
  const required = items.filter((i) => i.required);
  return {
    contract_id: contract.id,
    status: required.some((i) => i.verdict === "FAIL")
      ? "FAIL"
      : required.every((i) => i.verdict === "PASS")
        ? "PASS"
        : required.some((i) => i.verdict === "UNKNOWN")
          ? "UNKNOWN"
          : "NOT_EVALUATED",
    items,
  };
}
export function assertInvariants(artifacts, image, task) {
  const v = invariantView(artifacts, image, task);
  need(
    ["PASS", "NOT_DECLARED"].includes(v.status),
    "INVARIANTS_PENDING",
    "保持项存在失败/未知或尚未检查，候选保留",
  );
  return v;
}
export function coverageView(artifacts) {
  const contract = latest(artifacts, "business-intent");
  if (!contract)
    return {
      status: "NOT_DECLARED",
      contract_id: null,
      items: [],
      next_actions: [],
    };
  const v = content(contract),
    candidates = artifacts.filter(
      (a) =>
        a.kind === "media" &&
        !["original", "reference", "working"].includes(meta(a).role),
    );
  const items = v.obligations.map((o) => {
    const observations = [];
    for (const image of candidates) {
      const task = artifacts.find((t) => t.id === meta(image).task_id);
      if (
        !task ||
        !mediaApplicable(image, task, artifacts, digest) ||
        meta(task).retouch?.context_status === "needs_review"
      )
        continue;
      const item = itemVerdicts(
        artifacts,
        image,
        task,
        contract,
        "coverage-check",
      ).get(o.id);
      if (item)
        observations.push({
          ...item,
          media_id: image.id,
          sha256: meta(image).sha256,
        });
    }
    const verdict = observations.some((i) => i.verdict === "PASS")
      ? "PASS"
      : observations.some((i) => i.verdict === "FAIL")
        ? "FAIL"
        : observations.length
          ? "UNKNOWN"
          : "NOT_EVALUATED";
    return { ...o, verdict, observations };
  });
  const required = items.filter((i) => i.required),
    gaps = required.filter((i) => i.verdict !== "PASS");
  return {
    contract_id: contract.id,
    business_intent: v.business_intent,
    rollout: v.rollout,
    status: gaps.length
      ? gaps.some((i) => i.verdict === "FAIL")
        ? "FAIL"
        : gaps.some((i) => i.verdict === "UNKNOWN")
          ? "UNKNOWN"
          : "NOT_EVALUATED"
      : "PASS",
    items,
    next_actions: gaps.map((i) => ({
      obligation_id: i.id,
      action:
        i.verdict === "NOT_EVALUATED"
          ? "inspect_actual_candidate"
          : "revise_or_collect_evidence",
    })),
  };
}
export function conflictsView(artifacts) {
  const heads = new Map();
  for (const a of artifacts)
    if (meta(a).role === "evidence-conflict") {
      const f = content(a).field;
      if (!heads.has(f) || heads.get(f).version < a.version) heads.set(f, a);
    }
  return [...heads.values()].map((a) => ({
    id: a.id,
    version: a.version,
    ...content(a),
  }));
}
export function assertStepCoverage(artifacts, image, task, step, intentId) {
  if (!intentId) return;
  const contract = latest(artifacts, "business-intent");
  need(contract?.id === intentId, "PLAN_STALE", "业务意图规范已变化");
  const required = content(contract).obligations.filter(
    (o) => o.required && (step.coverage_ids ?? []).includes(o.id),
  );
  const assessed = itemVerdicts(
    artifacts,
    image,
    task,
    contract,
    "coverage-check",
  );
  need(
    required.every((o) => assessed.get(o.id)?.verdict === "PASS"),
    "CONTENT_COVERAGE",
    "当前候选尚未通过所承担内容义务的实际检查",
  );
}
export function planContracts(artifacts, steps, purpose, stage, taskId) {
  const intent = latest(artifacts, "business-intent"),
    warnings = [];
  const invariant = latest(artifacts, "product-invariants", taskId);
  if (invariant)
    for (const step of steps)
      step.invariant_items = content(invariant).items.map(
        ({ id, text, scope, required }) => ({ id, text, scope, required }),
      );
  if (intent) {
    const v = content(intent),
      coverage = coverageView(artifacts);
    need(
      ["sample", "expand"].includes(stage ?? "sample"),
      "ROLLOUT",
      "阶段须为sample/expand",
    );
    if (stage === "expand" && v.rollout.mode === "sample-first")
      need(
        v.rollout.representative_ids.every(
          (id) => coverage.items.find((i) => i.id === id)?.verdict === "PASS",
        ),
        "CONTENT_SAMPLE_REQUIRED",
        "扩套前先检查代表样张的内容覆盖",
      );
    for (const step of steps) {
      need(
        (step.coverage_ids ?? []).every((id) =>
          v.obligations.some((o) => o.id === id),
        ),
        "CONTENT_OBLIGATION",
        "步骤引用未知内容义务",
      );
      step.content_obligations = v.obligations
        .filter((o) => (step.coverage_ids ?? []).includes(o.id))
        .map(({ id, text }) => ({ id, text }));
    }
  }
  for (const c of conflictsView(artifacts)) {
    const relevant = steps.filter((s) => (s.fact_keys ?? []).includes(c.field));
    if (!relevant.length) continue;
    const facts = latest(artifacts, "product-facts"),
      selected = c.candidates.find((x) => x.id === c.decision?.candidate_id);
    const verified =
      c.status === "selected" &&
      c.decision.use === "verified-fact" &&
      facts &&
      content(facts).fields.some(
        (f) =>
          f.key === c.field &&
          f.status === "confirmed" &&
          stable(f.value) === stable(selected.value),
      );
    if (!verified) {
      need(
        purpose === "concept",
        "EVIDENCE_CONFLICT_PENDING",
        "当前步骤存在未核实争议，须明确概念用途或补证：" + c.field,
      );
      for (const s of relevant)
        s.fact_constraints = [
          ...(s.fact_constraints ?? []),
          "争议字段 " +
            c.field +
            " 仅作概念参考，不能确认商品结构/用途或适配。",
        ];
    }
    warnings.push({ conflict_id: c.id, field: c.field, status: c.status });
  }
  return {
    intent_id: intent?.id ?? null,
    invariants_id: invariant?.id ?? null,
    stage: stage ?? "sample",
    conflicts: warnings,
  };
}
export function suiteSnapshot(v, artifacts) {
  need(
    v?.schema === "retouch.suite/v1" &&
      Array.isArray(v.slots) &&
      v.slots.length > 0 &&
      v.slots.length <= 100 &&
      unique(v.slots),
    "SUITE",
    "套图须有1–100个稳定槽位",
  );
  words(v.name, "稳定系列名");
  for (const s of v.slots) {
    need(key(s.id), "SUITE", "槽位ID无效");
    words(s.role, "槽位角色");
    const image = artifacts.find(
      (a) => a.id === s.media_id && a.kind === "media",
    );
    need(
      image &&
        meta(image).sha256 === s.sha256 &&
        s.binding?.task_id === meta(image).task_id,
      "SUITE_MEDIA",
      "槽位须绑定本项目实际图片/hash/任务",
    );
  }
  return structuredClone(v);
}
export function suiteView(snapshot, artifacts) {
  const v = content(snapshot);
  return {
    id: snapshot.id,
    version: snapshot.version,
    ...v,
    slots: v.slots.map((s) => {
      const image = artifacts.find((a) => a.id === s.media_id),
        task = artifacts.find((a) => a.id === s.binding.task_id);
      const current =
        !!task &&
        sameBinding(s.binding, taskBinding(task, digest)) &&
        mediaApplicable(image, task, artifacts, digest) &&
        meta(task).retouch.context_status !== "needs_review";
      return {
        ...s,
        current,
        accepted:
          current &&
          artifacts.some((r) =>
            acceptedReview(r, image, task, artifacts, digest),
          ),
      };
    }),
  };
}
export function flowBrief(artifacts) {
  const heads = new Map();
  for (const a of artifacts)
    if (
      meta(a).role === "suite-snapshot" &&
      (!heads.has(a.title) || heads.get(a.title).version < a.version)
    )
      heads.set(a.title, a);
  const suites = [...heads.values()].map((a) => suiteView(a, artifacts));
  const checks = artifacts
    .filter(
      (a) =>
        a.kind === "media" &&
        !["original", "reference", "working"].includes(meta(a).role),
    )
    .flatMap((image) => {
      const task = artifacts.find((a) => a.id === meta(image).task_id);
      if (!task || !latest(artifacts, "product-invariants", task.id)) return [];
      return [
        {
          media_id: image.id,
          task_id: task.id,
          ...invariantView(artifacts, image, task),
        },
      ];
    });
  return {
    content_coverage: coverageView(artifacts),
    evidence_conflicts: conflictsView(artifacts),
    product_invariant_checks: checks,
    suite_snapshots: suites,
  };
}
export function validateFlowSnapshot(artifacts) {
  const find = (id) => artifacts.find((a) => a.id === id);
  for (const a of artifacts) {
    const m = meta(a);
    if (m.sealed_output) {
      const frozen = content(a),
        seal = m.sealed_output;
      need(
        m.role === "suite-export" &&
          seal.output_manifest?.snapshot_id === frozen.snapshot_id &&
          seal.output_manifest.snapshot_hash === frozen.snapshot_hash &&
          seal.output_manifest.profile_hash === digest(frozen.output_profile) &&
          seal.output_manifest.files.some(
            (f) => f.name === "review.zip" && f.sha256 === seal.sha256,
          ),
        "OUTPUT_SEAL_CONFLICT",
        "封存组件身份与冻结交付不符",
      );
      for (const ref of [
        ...seal.output_catalog.slots.flatMap((s) => [
          s.png,
          s.gallery,
          s.long_page,
        ]),
        seal.output_catalog.long,
        seal.output_catalog.reading,
        seal.output_catalog.overview,
      ])
        need(
          find(ref.media_id)?.kind === "media" &&
            meta(find(ref.media_id)).sha256 === ref.sha256,
          "OUTPUT_SEAL_CONFLICT",
          "封存输出媒体缺失或hash不符",
        );
    }
    if (m.role === "suite-export" && content(a).output_profile) {
      const { dimensions, ...profile } = content(a).output_profile;
      const checked = outputProfile(profile, content(a).slots, artifacts, true);
      need(
        stable(checked.dimensions) === stable(dimensions),
        "OUTPUT_PROFILE",
        "冻结输出尺寸与槽位来源不符",
      );
    }
    if (m.role === "business-intent") businessIntent(content(a), artifacts);
    if (m.role === "evidence-conflict") conflict(content(a), artifacts);
    if (m.role === "product-invariants") invariants(content(a), artifacts);
    if (m.role === "suite-snapshot") {
      const v = suiteSnapshot(content(a), artifacts),
        previous = v.previous_id && find(v.previous_id);
      need(
        !v.previous_id ||
          (previous &&
            previous.title === a.title &&
            previous.version < a.version),
        "SUITE",
        "套图历史链不完整",
      );
      for (const s of v.slots)
        need(
          find(s.binding.task_id)?.kind === "task" &&
            find(s.binding.goal_id)?.version === s.binding.goal_version &&
            /^[a-f0-9]{64}$/.test(s.binding.requirements_hash),
          "SUITE",
          "槽位来源上下文不完整",
        );
    }
    if (m.contract_id) {
      const c = find(m.contract_id);
      need(
        c && digest(c.content) === m.contract_hash,
        "INSPECTION_BINDING",
        "检查规范版本/hash不完整",
      );
      inspectionItems(
        content(a).items,
        content(c)[m.role === "coverage-check" ? "obligations" : "items"],
      );
    }
    if (m.role === "result-revalidation")
      need(
        find(m.media_id)?.kind === "media" &&
          meta(find(m.media_id)).sha256 === m.sha256 &&
          find(m.goal_id)?.version === m.goal_version &&
          ["adopt", "reject"].includes(m.decision),
        "REVALIDATION",
        "结果适用性复核引用不完整",
      );
    if (m.transform) {
      need(
        find(m.transform.execution_id)?.kind === "execution" &&
          m.transform.inputs.every(
            (i) => find(i.id) && meta(find(i.id)).sha256 === i.sha256,
          ),
        "POSTPROCESS_LINEAGE",
        "本地变换来源不完整",
      );
    }
    if (m.transform) {
      for (const step of m.transform.trace ?? [])
        if (step.operation?.op === "extract" && step.operation.approval)
          cropApproval(step.operation, artifacts, true);
    }
    if (m.role === "local-postprocess") {
      for (const op of content(a).operations ?? [])
        if (op.op === "extract" && op.approval)
          cropApproval(op, artifacts, true);
    }
    if (m.role === "local-postprocess")
      need(
        content(a).inputs.every(
          (i) => find(i.id) && meta(find(i.id)).sha256 === i.sha256,
        ),
        "POSTPROCESS_INPUT",
        "本地变换输入不完整",
      );
    let plan;
    try {
      plan = content(a);
    } catch {}
    if (plan?.contracts) {
      need(
        !plan.contracts.intent_id ||
          meta(find(plan.contracts.intent_id) ?? { meta: "{}" }).role ===
            "business-intent",
        "CONTENT_OBLIGATION",
        "计划缺少内容规范",
      );
      need(
        !plan.contracts.invariants_id ||
          meta(find(plan.contracts.invariants_id) ?? { meta: "{}" }).role ===
            "product-invariants",
        "INVARIANTS",
        "计划缺少保持项规范",
      );
      for (const c of plan.contracts.conflicts)
        need(
          meta(find(c.conflict_id) ?? { meta: "{}" }).role ===
            "evidence-conflict",
          "EVIDENCE_CONFLICT",
          "计划缺少冲突证据",
        );
    }
  }
}
