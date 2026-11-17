// Native transaction handlers; all state is in ygl artifacts/relations/events.
import { digest, stable } from "./value.mjs";
import { outputProfile, cropApproval } from "./output-profile.mjs";
import {
  taskBinding,
  sameBinding,
  mediaApplicable,
  acceptedReview,
} from "./applicability.mjs";
import {
  meta,
  content,
  need,
  words,
  latest,
  businessIntent,
  conflict,
  invariants,
  inspectionItems,
  coverageView,
  conflictsView,
  invariantView,
  suiteSnapshot,
  suiteView,
  assertInvariants,
  assertPostprocessOutput,
} from "./flow-contracts.mjs";
export const flowReadActions = [
  "coverage-view",
  "conflicts-view",
  "invariant-view",
  "suite-view",
  "suite-export-check",
  "postprocess-reuse",
];
export const flowActions = [
  ...flowReadActions,
  "intent-set",
  "conflict-set",
  "conflict-resolve",
  "invariants-set",
  "coverage-check",
  "invariants-check",
  "font-resource",
  "postprocess-prepare",
  "postprocess-complete",
  "suite-snapshot",
  "suite-accept",
  "suite-export-prepare",
  "suite-export-seal",
  "suite-export-complete",
];
export async function flowCommand(action, b, h) {
  const {
    mgr,
    p,
    node,
    append,
    artifact,
    task,
    currentTask,
    relation,
    updateTask,
    noUnknown,
  } = h;
  const all = await mgr.query(
    "SELECT * FROM artifacts WHERE project_id=? ORDER BY created,id",
    [p.id],
  );
  const add = (kind, title, value, m = {}) =>
    append(mgr, p, kind, title, value, { schema: "retouch.native/v1", ...m });
  const link = (from, to, rel) =>
    relation(mgr, "artifact", from, "artifact", to, rel);
  const head = (role, title) =>
    all
      .filter((a) => meta(a).role === role && (!title || a.title === title))
      .sort((a, b) => a.version - b.version)
      .at(-1) ?? null;
  const expect = (old) =>
    need(
      (b.expected_id ?? null) === (old?.id ?? null),
      "CONTRACT_CONFLICT",
      "工件已变化，请先读取当前ID",
    );
  if (action === "coverage-view") return coverageView(all);
  if (action === "conflicts-view") return { conflicts: conflictsView(all) };
  if (action === "invariant-view") {
    const image = await artifact(mgr, b.id, p, "media"),
      t = await task(mgr, p, meta(image).task_id);
    return invariantView(all, image, t.a);
  }
  if (action === "suite-view") {
    const a = await artifact(mgr, b.id, p, "spec");
    need(meta(a).role === "suite-snapshot", "SUITE", "需要套图快照");
    return suiteView(a, all);
  }
  if (action === "intent-set") {
    const old = head("business-intent");
    expect(old);
    const value = businessIntent(b.intent, all);
    const a = await add("spec", "Business intent", value, {
      role: "business-intent",
      source: words(b.source, "意图来源"),
      previous_id: old?.id ?? null,
    });
    await relation(mgr, "node", node.id, "artifact", a.id, "specified-by");
    const affected = all.filter(
      (a) =>
        a.kind === "task" &&
        (old
          ? meta(a).retouch?.intent_id === old.id
          : !!meta(a).retouch?.plan_id),
    );
    await h.invalidateDocumentTasks(
      mgr,
      p,
      affected.map((t) => t.id),
      null,
    );
    return { artifact: a };
  }
  if (action === "conflict-set" || action === "conflict-resolve") {
    let value, old;
    if (action === "conflict-set") {
      old = head("evidence-conflict", "Evidence conflict " + b.conflict.field);
      expect(old);
      value = conflict(
        { ...b.conflict, status: "unresolved", decision: null },
        all,
      );
    } else {
      old = await artifact(mgr, b.id, p, "spec");
      need(
        meta(old).role === "evidence-conflict" &&
          head("evidence-conflict", old.title)?.id === old.id,
        "CONTRACT_CONFLICT",
        "只能复核当前冲突版本",
      );
      value = conflict(
        { ...content(old), status: b.status, decision: b.decision },
        all,
      );
      if (value.decision?.use === "verified-fact") {
        const f = latest(all, "product-facts"),
          chosen = value.candidates.find(
            (c) => c.id === value.decision.candidate_id,
          );
        need(
          f &&
            content(f).fields.some(
              (i) =>
                i.key === value.field &&
                i.status === "confirmed" &&
                stable(i.value) === stable(chosen.value),
            ),
          "EVIDENCE_CONFLICT",
          "当前字段事实尚未确认该候选",
        );
      }
    }
    const a = await add("spec", "Evidence conflict " + value.field, value, {
      role: "evidence-conflict",
      previous_id: old?.id ?? null,
      source: words(b.source, "来源"),
    });
    for (const c of value.candidates)
      await link(a.id, c.source.artifact_id, "evidenced-by");
    await relation(mgr, "node", node.id, "artifact", a.id, "specified-by");
    await h.invalidateDocumentTasks(
      mgr,
      p,
      all
        .filter(
          (a) =>
            a.kind === "task" &&
            (meta(a).retouch?.fact_keys ?? []).includes(value.field),
        )
        .map((t) => t.id),
      null,
    );
    return { artifact: a };
  }
  if (action === "invariants-set") {
    const t = await currentTask(mgr, p, b.task);
    await noUnknown(mgr, p, t.a.id);
    need(
      t.meta.retouch.revision === b.expected_revision,
      "REVISION_CONFLICT",
      "任务已变化",
    );
    const old = latest(all, "product-invariants", t.a.id),
      value = invariants(b.invariants, all);
    const a = await add("spec", "Product invariants " + t.a.id, value, {
      role: "product-invariants",
      task_id: t.a.id,
      ...taskBinding(t.a, digest),
      previous_id: old?.id ?? null,
    });
    await relation(mgr, "task", t.a.id, "artifact", a.id, "specified-by");
    t.meta.retouch.invariants_id = a.id;
    const updated = await updateTask(mgr, t.a, t.meta, b.expected_revision);
    if (t.meta.retouch.plan_id || t.meta.status === "done") {
      await h.invalidateDocumentTasks(mgr, p, [t.a.id], null);
      return { artifact: a, task: (await task(mgr, p, t.a.id)).a };
    }
    return { artifact: a, task: updated };
  }
  if (action === "coverage-check" || action === "invariants-check") {
    const image = await artifact(mgr, b.id, p, "media"),
      t = await currentTask(mgr, p, meta(image).task_id);
    need(
      mediaApplicable(image, t.a, all, digest),
      "MEDIA_STALE",
      "先复核当前图片适用性",
    );
    const contract =
      action === "coverage-check"
        ? latest(all, "business-intent")
        : latest(all, "product-invariants", t.a.id);
    need(
      contract &&
        b.contract_id === contract.id &&
        b.sha256 === meta(image).sha256,
      "INSPECTION_BINDING",
      "检查须绑定当前规范与实际图片hash",
    );
    const items = inspectionItems(
      b.items,
      content(contract)[action === "coverage-check" ? "obligations" : "items"],
    );
    need(
      ["human", "host-visual", "fixture"].includes(b.method),
      "INSPECTION_CAPABILITY",
      "仅记录实际人工/宿主视觉/夹具检查；不自动调用评估模型",
    );
    const review = await add(
      "review",
      action + " " + image.id,
      { items },
      {
        role: action,
        contract_id: contract.id,
        contract_hash: digest(contract.content),
        ...taskBinding(t.a, digest),
        media_id: image.id,
        sha256: b.sha256,
        reviewer: words(b.reviewer, "复核人"),
        source: words(b.source, "来源"),
        method: b.method,
        accepted: false,
      },
    );
    await link(image.id, review.id, "reviewed-by");
    await link(review.id, contract.id, "specified-by");
    return {
      artifact: review,
      assessment:
        action === "coverage-check"
          ? coverageView([...all, review])
          : invariantView([...all, review], image, t.a),
    };
  }
  if (action === "font-resource") {
    need(
      /^[a-f0-9]{64}$/.test(b.sha256) &&
        b.object_path ===
          "objects/sha256/" + b.sha256.slice(0, 2) + "/" + b.sha256 &&
        Number.isSafeInteger(b.bytes) &&
        b.bytes > 0 &&
        b.bytes <= 16 * 1024 * 1024,
      "FONT_RESOURCE",
      "字体须绑定实际CAS字节",
    );
    return {
      artifact: await add("resource", words(b.title, "字体名称"), "", {
        role: "font",
        sha256: b.sha256,
        object_path: b.object_path,
        bytes: b.bytes,
        family: words(b.family, "字体内部名称"),
        mime: "font/sfnt",
      }),
    };
  }
  if (action === "postprocess-reuse") {
    const t = await currentTask(mgr, p, b.task);
    need(
      t.meta.retouch.revision === b.expected_revision,
      "REVISION_CONFLICT",
      "任务已变化，先读取当前版本",
    );
    const ex = await artifact(mgr, b.id, p, "execution"),
      m = meta(ex);
    need(
      m.role === "local-postprocess" &&
        m.status === "completed" &&
        sameBinding(m, taskBinding(t.a, digest)) &&
        Array.isArray(m.outputs) &&
        m.outputs.length === 1,
      "POSTPROCESS_CONTEXT",
      "只有同业务上下文的已完成后处理可复用",
    );
    const descriptor = content(ex);
    need(
      digest(descriptor) === digest(b.descriptor),
      "RENDERER_DRIFT",
      "输入、变换或渲染指纹变化不能复用",
    );
    for (const input of descriptor.inputs) {
      const source = await artifact(mgr, input.id, p);
      need(
        ["media", "resource"].includes(source.kind) &&
          meta(source).sha256 === input.sha256,
        "POSTPROCESS_INPUT",
        "缓存输入须保留原生媒体/hash",
      );
    }
    for (const op of descriptor.operations)
      if (
        op.op === "extract" &&
        (op.approval || op.source_media_id || op.source_sha256)
      )
        cropApproval(op, all);
    const image = await artifact(mgr, m.outputs[0], p, "media"),
      im = meta(image);
    need(
      im.role === "postprocess" &&
        im.task_id === t.a.id &&
        sameBinding(im, m) &&
        mediaApplicable(image, t.a, all, digest),
      "POSTPROCESS_CONTEXT",
      "缓存输出已过期、被拒绝或不属于当前任务",
    );
    need(
      descriptor.inputs
        .filter((i) => all.find((a) => a.id === i.id)?.kind === "media")
        .every((i) => im.parents?.includes(i.id)),
      "POSTPROCESS_LINEAGE",
      "缓存输出必须保留全部图像来源",
    );
    assertPostprocessOutput(ex, image, all);
    // Read-only: no event, artifact, relation, acceptance or task status is written.
    return { execution: ex, artifact: image };
  }
  if (action === "postprocess-prepare") {
    const t = await currentTask(mgr, p, b.task);
    need(
      t.meta.retouch.revision === b.expected_revision,
      "REVISION_CONFLICT",
      "任务已变化",
    );
    need(
      b.descriptor?.schema === "retouch.postprocess/v1" &&
        Array.isArray(b.descriptor.inputs) &&
        b.descriptor.inputs.length > 0 &&
        Array.isArray(b.descriptor.operations) &&
        b.descriptor.operations.length > 0,
      "POSTPROCESS",
      "缺少本地变换描述",
    );
    for (const input of b.descriptor.inputs) {
      const a = await artifact(mgr, input.id, p);
      need(
        ["media", "resource"].includes(a.kind) &&
          meta(a).sha256 === input.sha256,
        "POSTPROCESS_INPUT",
        "输入须绑定本项目实际素材hash",
      );
      words(input.role, "输入职责");
    }
    const cropSources = b.descriptor.operations
      .filter(
        (op) =>
          op.op === "extract" &&
          (op.approval || op.source_media_id || op.source_sha256),
      )
      .map((op) => cropApproval(op, all));
    const m = {
      role: "local-postprocess",
      ...taskBinding(t.a, digest),
      status: "prepared",
      revision: 0,
      inputs: b.descriptor.inputs.map((i) => i.id),
      outputs: [],
      renderer: b.descriptor.renderer,
    };
    const a = await add(
      "execution",
      "Local postprocess " + digest(b.descriptor),
      b.descriptor,
      m,
    );
    await relation(mgr, "task", t.a.id, "artifact", a.id, "tracked-by");
    for (const id of m.inputs) await link(a.id, id, "uses");
    for (const source of cropSources) await link(a.id, source.id, "references");
    return { execution: a };
  }
  if (action === "postprocess-complete") {
    const ex = await artifact(mgr, b.id, p, "execution"),
      m = meta(ex),
      image = await artifact(mgr, b.output, p, "media"),
      t = await currentTask(mgr, p, m.task_id);
    need(
      m.role === "local-postprocess" &&
        m.status === "prepared" &&
        sameBinding(m, taskBinding(t.a, digest)) &&
        meta(image).task_id === m.task_id &&
        meta(image).role === "postprocess" &&
        sameBinding(meta(image), m),
      "POSTPROCESS_CONTEXT",
      "后处理上下文或输出已变化",
    );
    need(
      content(ex)
        .inputs.filter((i) => all.find((a) => a.id === i.id)?.kind === "media")
        .every((i) => meta(image).parents.includes(i.id)),
      "POSTPROCESS_LINEAGE",
      "输出须保留全部图像输入",
    );
    assertPostprocessOutput(ex, image, all);
    m.status = "completed";
    m.outputs = [image.id];
    m.revision++;
    await mgr.query("UPDATE artifacts SET meta=?,updated=? WHERE id=?", [
      stable(m),
      new Date().toISOString(),
      ex.id,
    ]);
    await link(ex.id, image.id, "produced");
    return { execution: { ...ex, meta: stable(m) }, artifact: image };
  }
  if (action === "suite-snapshot") {
    const t = await currentTask(mgr, p, b.task),
      title = "Suite " + words(b.name, "稳定系列名");
    const old = head("suite-snapshot", title);
    expect(old);
    need(
      t.meta.retouch.revision === b.expected_revision,
      "REVISION_CONFLICT",
      "任务已变化",
    );
    need(Array.isArray(b.slots), "SUITE", "缺少套图槽位");
    const slots = [];
    for (const s of b.slots) {
      const image = await artifact(mgr, s.media_id, p, "media"),
        owner = await currentTask(mgr, p, meta(image).task_id);
      need(
        mediaApplicable(image, owner.a, all, digest) &&
          s.sha256 === meta(image).sha256,
        "SUITE_MEDIA",
        "套图须选择当前有效图片和实际hash",
      );
      slots.push({
        id: s.id,
        role: s.role,
        media_id: image.id,
        sha256: s.sha256,
        binding: taskBinding(owner.a, digest),
      });
    }
    const value = suiteSnapshot(
      {
        schema: "retouch.suite/v1",
        name: b.name,
        previous_id: old?.id ?? null,
        slots,
      },
      all,
    );
    const a = await add("spec", title, value, {
      role: "suite-snapshot",
      task_id: t.a.id,
      previous_id: old?.id ?? null,
    });
    await relation(mgr, "task", t.a.id, "artifact", a.id, "produced");
    for (const slot of slots) await link(a.id, slot.media_id, "selects");
    return { artifact: a, suite: suiteView(a, [...all, a]) };
  }
  if (action === "suite-accept") {
    const a = await artifact(mgr, b.id, p, "spec");
    need(meta(a).role === "suite-snapshot", "SUITE", "需要套图快照");
    const v = suiteView(a, all);
    need(
      b.source === "user" &&
        Array.isArray(b.slots) &&
        b.slots.length > 0 &&
        new Set(b.slots.map((s) => s.id)).size === b.slots.length,
      "SUITE_ACCEPTANCE",
      "须由用户明确接受部分槽位",
    );
    const reviews = [];
    for (const selected of b.slots) {
      const slot = v.slots.find((s) => s.id === selected.id);
      need(
        slot?.current && slot.sha256 === selected.sha256,
        "SUITE_ACCEPTANCE",
        "接受范围须绑定当前槽位hash",
      );
      const image = await artifact(mgr, slot.media_id, p, "media"),
        t = await currentTask(mgr, p, slot.binding.task_id);
      assertInvariants(all, image, t.a);
      const review = await add(
        "review",
        "Suite acceptance " + a.id + "/" + slot.id,
        words(b.statement, "用户接受原文"),
        {
          ...slot.binding,
          role: "suite-acceptance",
          suite_id: a.id,
          slot_id: slot.id,
          media_id: slot.media_id,
          sha256: slot.sha256,
          accepted: true,
          verdict: "PASS",
          source: "user",
          reviewer: words(b.reviewer, "接受者"),
        },
      );
      await link(image.id, review.id, "accepted-by");
      await link(a.id, review.id, "reviewed-by");
      reviews.push(review);
    }
    return { artifacts: reviews, suite: suiteView(a, [...all, ...reviews]) };
  }
  if (action === "suite-export-prepare") {
    const a = await artifact(mgr, b.id, p, "spec");
    need(meta(a).role === "suite-snapshot", "SUITE", "需要套图快照");
    const v = suiteView(a, all);
    need(
      ["preview", "delivery"].includes(b.mode),
      "SUITE_EXPORT",
      "图片包须明确preview/delivery",
    );
    const previous = b.from_id
      ? await artifact(mgr, b.from_id, p, "spec")
      : null;
    need(
      !previous ||
        (meta(previous).role === "suite-snapshot" &&
          previous.title === a.title &&
          previous.version < a.version),
      "SUITE_DELTA",
      "增量包须比较同一系列的较早快照",
    );
    const old = previous ? content(previous).slots : [];
    const slots = v.slots.filter(
      (s) =>
        !previous ||
        !old.some(
          (x) =>
            x.id === s.id && x.sha256 === s.sha256 && x.media_id === s.media_id,
        ),
    );
    need(slots.length > 0, "SUITE_DELTA", "此快照没有新增或替换图片");
    if (b.mode === "delivery") {
      need(
        slots.every((s) => s.current && s.accepted),
        "SUITE_ACCEPTANCE",
        "正式图片包须逐项接受且适用于当前目标",
      );
      for (const s of slots) {
        const image = all.find((a) => a.id === s.media_id),
          t = await currentTask(mgr, p, s.binding.task_id);
        await noUnknown(mgr, p, t.a.id);
        assertInvariants(all, image, t.a);
      }
      need(
        ["PASS", "NOT_DECLARED"].includes(coverageView(all).status),
        "CONTENT_COVERAGE",
        "正式套图交付前仍有内容覆盖缺口",
      );
    }
    const profile = b.output_profile
      ? outputProfile(b.output_profile, slots, all)
      : null;
    if (profile)
      need(
        slots.every((s) => s.current),
        "SUITE_MEDIA_STALE",
        "输出编排须先复核/adopt过期媒体，再建新快照；不得自动刷新或沿用旧接受",
      );
    const d = await add(
      "delivery",
      "Suite export " + a.id,
      {
        snapshot_id: a.id,
        snapshot_hash: digest(a.content),
        from_id: previous?.id ?? null,
        slots,
        mode: b.mode,
        renderer: b.renderer,
        ...(profile ? { output_profile: profile } : {}),
      },
      {
        role: "suite-export",
        ...(profile ? { output_contract: "retouch-output-contract/v1" } : {}),
        task_id: meta(a).task_id,
        snapshot_id: a.id,
        status: "preparing",
        directory: words(b.file, "图片包目标"),
        mode: b.mode,
      },
    );
    await link(a.id, d.id, "exported-by");
    if (profile) {
      await link(d.id, profile.design.artifact_id, "references");
      for (const crop of Object.values(profile.crops))
        await link(d.id, crop.approval.artifact_id, "references");
    }
    return { delivery: d, snapshot: a, slots };
  }
  if (
    [
      "suite-export-complete",
      "suite-export-seal",
      "suite-export-check",
    ].includes(action)
  ) {
    const a = await artifact(mgr, b.id, p, "delivery"),
      m = meta(a);
    need(
      m.role === "suite-export" &&
        m.status === "preparing" &&
        /^[a-f0-9]{64}$/.test(b.sha256),
      "SUITE_EXPORT",
      "图片包回执无效",
    );
    const sealing = action === "suite-export-seal",
      checking = action === "suite-export-check";
    need(
      !(sealing || checking) || content(a).output_profile,
      "OUTPUT_BINDING",
      "只有有限输出组件使用发布前封存",
    );
    if (content(a).output_profile) {
      const identity = {
        sha256: b.sha256,
        output_manifest: b.output_manifest,
        output_catalog: b.output_catalog,
      };
      need(
        !m.sealed_output || digest(m.sealed_output) === digest(identity),
        "OUTPUT_SEAL_CONFLICT",
        "组件与原生发布前封存不符，保留现场",
      );
      need(
        sealing || m.sealed_output,
        "OUTPUT_UNSEALED",
        "须先原生封存精确组件，不能凭磁盘标记登记完成",
      );
      need(
        b.output_manifest?.schema === "retouch.output-components/v1" &&
          Array.isArray(b.output_manifest.files) &&
          b.output_manifest.files.length > 0,
        "SUITE_EXPORT",
        "编排发布须保留组件清单",
      );
      const frozen = content(a),
        catalog = b.output_catalog;
      const { dimensions, ...profile } = frozen.output_profile;
      outputProfile(profile, frozen.slots, all);
      need(
        catalog?.snapshot_id === frozen.snapshot_id &&
          catalog.snapshot_hash === frozen.snapshot_hash &&
          catalog.profile_hash === digest(frozen.output_profile) &&
          catalog.restorable_workspace === false &&
          catalog.schema ===
            (frozen.mode === "preview"
              ? "retouch.image-preview/v1"
              : "retouch.image-delivery/v1") &&
          Array.isArray(catalog.slots) &&
          catalog.slots.length === frozen.slots.length,
        "OUTPUT_BINDING",
        "输出清单须绑定原冻结快照/配置",
      );
      need(
        b.output_manifest.snapshot_id === frozen.snapshot_id &&
          b.output_manifest.snapshot_hash === frozen.snapshot_hash &&
          b.output_manifest.profile_hash === digest(frozen.output_profile) &&
          b.output_manifest.mode === frozen.mode &&
          b.output_manifest.restorable_workspace === false &&
          b.output_manifest.authority === "frozen-bytes-only" &&
          b.output_manifest.native_delivery_id === a.id &&
          b.output_manifest.requires_native_current_check === true &&
          b.output_manifest.not_business_acceptance === true &&
          b.output_manifest.files.some(
            (f) => f.name === "review.zip" && f.sha256 === b.sha256,
          ),
        "OUTPUT_BINDING",
        "组件清单身份或包hash不符",
      );
      const outputIds = new Set();
      for (const slot of catalog.slots) {
        need(
          frozen.slots.some(
            (s) =>
              s.id === slot.id &&
              s.media_id === slot.media_id &&
              s.sha256 === slot.sha256,
          ),
          "OUTPUT_BINDING",
          "输出槽位不匹配",
        );
        for (const ref of [slot.png, slot.gallery, slot.long_page]) {
          const media = await artifact(mgr, ref.media_id, p, "media");
          need(
            meta(media).sha256 === ref.sha256,
            "OUTPUT_BINDING",
            "输出媒体/hash不符",
          );
          outputIds.add(media.id);
        }
      }
      for (const ref of [catalog.long, catalog.reading, catalog.overview]) {
        const media = await artifact(mgr, ref.media_id, p, "media");
        need(
          meta(media).sha256 === ref.sha256,
          "OUTPUT_BINDING",
          "输出媒体/hash不符",
        );
        outputIds.add(media.id);
      }
      const suite = await artifact(mgr, frozen.snapshot_id, p, "spec"),
        current = suiteView(suite, all);
      need(
        frozen.slots.every((s) =>
          current.slots.some(
            (x) =>
              x.id === s.id &&
              x.current &&
              x.media_id === s.media_id &&
              x.sha256 === s.sha256,
          ),
        ),
        "SUITE_MEDIA_STALE",
        "发布登记时快照上下文已变化",
      );
      if (frozen.mode === "delivery") {
        need(
          frozen.slots.every(
            (s) => current.slots.find((x) => x.id === s.id)?.accepted,
          ),
          "SUITE_ACCEPTANCE",
          "发布登记时接受范围已变化",
        );
        for (const slot of frozen.slots) {
          const image = await artifact(mgr, slot.media_id, p, "media"),
            t = await currentTask(mgr, p, slot.binding.task_id);
          await noUnknown(mgr, p, t.a.id);
          assertInvariants(all, image, t.a);
        }
        need(
          ["PASS", "NOT_DECLARED"].includes(coverageView(all).status),
          "CONTENT_COVERAGE",
          "发布登记时内容覆盖已变化",
        );
      }
      if (checking)
        return {
          current: true,
          delivery_id: a.id,
          snapshot_id: frozen.snapshot_id,
        };
      if (sealing) m.sealed_output = identity;
      else {
        m.output_manifest = b.output_manifest;
        m.output_catalog = catalog;
      }
      m.outputs = [...outputIds];
      for (const output of outputIds) await link(a.id, output, "uses");
    }
    if (!sealing) {
      m.status = "completed";
      m.package_sha256 = b.sha256;
    }
    await mgr.query("UPDATE artifacts SET meta=?,updated=? WHERE id=?", [
      stable(m),
      new Date().toISOString(),
      a.id,
    ]);
    return { delivery: { ...a, meta: stable(m) } };
  }
  throw new Error("Unrouted flow action");
}
