import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { NativeClient } from "../src/native/client.ts";
import {
  registerBytes,
  deliverArtifact,
  objectBytes,
} from "../src/native/files.ts";
import { digest, validateSnapshot } from "../src/native/plugin/commands.mjs";
import {
  exportProject,
  importProject,
  inspectProject,
} from "../src/native/exchange.ts";
import { transform, registerFont } from "../src/native/postprocess.ts";
import { exportSuite } from "../src/native/suite.ts";
import { readZip } from "../src/infrastructure/zip.ts";
import { bytesHash } from "../src/domain/model.ts";
import { apiPrompt } from "../src/native/plugin/api-contract.mjs";
import { deliveryBindingCurrent } from "../src/native/plugin/applicability.mjs";
const entry = process.env.RETOUCH_TEST_YGL_ENTRY;
const options = { skip: !entry, timeout: 300000 };
async function fixture(name: string) {
  const parent = await fs.mkdtemp(
    path.join(process.env.RETOUCH_TEST_ROOT!, "engineering-"),
  );
  const c = await NativeClient.initialize(path.join(parent, "home"), entry!);
  let serial = 0;
  const call = (action: string, b: any, key?: string) =>
    c.call(action, b, key ?? "engineering-" + ++serial);
  const p = (
    await call("project-new", {
      name,
      intent: "匿名化工程验收，无客户资料、无真实接受或图像请求",
      tags: ["fixture"],
    })
  ).project.id;
  const goal = (
    await call("goal-new", {
      project: p,
      title: "工程验收目标",
      scope: "商品外观与使用方式",
      preserve: ["原始结构"],
      done_when: "检查实际结果后交付",
      source: "ISOLATED FIXTURE",
    })
  ).artifact;
  const task = async (title = "图片", kind = "image") =>
    (
      await call("task-new", {
        project: p,
        goal: goal.id,
        title,
        brief: "隔离夹具",
        kind,
        purpose: "concept",
        expected_output: "明确的结果",
        done_when: "真实状态可核验",
      })
    ).task;
  const t = await task();
  const view = (id = t.id) => c.call("task-view", { project: p, id });
  const image = async (
    colour: string,
    role = "postprocess",
    owner = t.id,
    w = 64,
    h = 64,
    parents: string[] = [],
  ) =>
    (
      await registerBytes(
        c,
        p,
        owner,
        await sharp({
          create: { width: w, height: h, channels: 4, background: colour },
        })
          .png()
          .toBuffer(),
        { role, parents, operation: "synthetic fixture; no image model" },
        "image-" + ++serial,
      )
    ).artifact;
  const source = async (title: string, text: string, role = "user-original") =>
    (
      await call("document", {
        project: p,
        task: t.id,
        kind: "spec",
        title,
        content: text,
        role,
        source: "ISOLATED FIXTURE",
      })
    ).artifact;
  return { parent, c, call, p, goal, t, task, view, image, source };
}
const sha = (a: any) => JSON.parse(a.meta).sha256;
test(
  "E03/E07：旧结果显式复核、接受隔离与完成证据在原生事务中一致",
  options,
  async () => {
    const { parent, c, call, p, goal, t, image, view } =
      await fixture("复用与关闭证据");
    const candidate = await image("#aabbcc");
    await call("media-review", {
      project: p,
      id: candidate.id,
      sha256: sha(candidate),
      verdict: "PASS",
      accepted: true,
      source: "user",
      reviewer: "fixture human",
      observations: "隔离用户接受夹具，不是真实业务接受",
    });
    const oldDelivery = await deliverArtifact(
      c,
      p,
      candidate.id,
      path.join(parent, "delivery-v1"),
      "deliver-v1",
    );
    const closeBody = {
      project: p,
      task: t.id,
      expected_revision: (await view()).task.meta.retouch.revision,
      statement: "fixture close",
    };
    await call("task-close", closeBody, "close-v1");
    assert.equal(
      (await call("task-close", closeBody, "close-v1")).replayed,
      true,
    );
    const g2 = (
      await call("document-revise", {
        project: p,
        id: goal.id,
        expected_version: goal.version,
        expected_hash: digest(goal.content),
        content: {
          ...JSON.parse(goal.content),
          scope: "增补其他画面；原外观图需显式复核",
        },
        reason: "fixture additive change",
        source: "fixture",
      })
    ).artifact;
    assert.equal((await view()).progress, "needs_review");
    await call("task-context-review", {
      project: p,
      task: t.id,
      goal: g2.id,
      expected_revision: (await view()).task.meta.retouch.revision,
      statement: "只复核上下文，不接受旧图片",
    });
    let v = await view();
    assert.equal(v.progress, "result_needs_review");
    assert.equal(v.task.image_outputs[0].status, "needs_review");
    await call("requirements", {
      project: p,
      task: t.id,
      expected_revision: v.task.meta.retouch.revision,
      groups: [
        {
          id: "scope-boundary",
          scope: "preserve",
          disabled: false,
          text: "新需求中当前外观仍可明确复核复用",
        },
      ],
    });
    v = await view();
    const adopt = {
      project: p,
      task: t.id,
      id: candidate.id,
      sha256: sha(candidate),
      goal_id: g2.id,
      requirements_hash: digest(v.task.meta.retouch.requirements),
      expected_revision: v.task.meta.retouch.revision,
      decision: "adopt",
      reviewer: "fixture",
      source: "fixture",
      statement: "外观未受增补用途图影响，仅复用像素，不继承接受",
    };
    const races = await Promise.allSettled([
      call("result-revalidate", adopt, "adopt-a"),
      call("result-revalidate", adopt, "adopt-b"),
    ]);
    assert.equal(races.filter((x) => x.status === "fulfilled").length, 1);
    const winner = races[0].status === "fulfilled" ? "adopt-a" : "adopt-b";
    assert.equal(
      (await call("result-revalidate", adopt, winner)).replayed,
      true,
    );
    v = await view();
    assert.equal(v.progress, "waiting_for_review");
    assert.equal(v.task.image_outputs[0].status, "candidate");
    const legacy = {
      ...oldDelivery.delivery,
      meta: JSON.stringify({
        ...JSON.parse(oldDelivery.delivery.meta),
        goal_id: undefined,
        goal_version: undefined,
        requirements_hash: undefined,
        context_epoch: undefined,
      }),
    };
    assert.equal(
      deliveryBindingCurrent(legacy, candidate, v.task, digest),
      false,
    );
    assert.equal(
      JSON.parse((await c.call("show", { project: p, id: candidate.id })).meta)
        .goal_id,
      goal.id,
    );
    await assert.rejects(
      deliverArtifact(
        c,
        p,
        candidate.id,
        path.join(parent, "no-old-acceptance"),
        "no-acceptance",
      ),
      { code: "ACCEPTANCE" },
    );
    await call("media-review", {
      project: p,
      id: candidate.id,
      sha256: sha(candidate),
      verdict: "PASS",
      accepted: true,
      source: "user",
      reviewer: "fixture human",
      observations: "新上下文的显式接受夹具",
    });
    const delivered = await deliverArtifact(
      c,
      p,
      candidate.id,
      path.join(parent, "delivery-v2"),
      "deliver-v2",
    );
    await call("task-close", {
      project: p,
      task: t.id,
      expected_revision: (await view()).task.meta.retouch.revision,
      statement: "current accepted delivery",
    });
    const dt = (
      await call("task-new", {
        project: p,
        goal: g2.id,
        title: "设计任务",
        brief: "合成设计",
        kind: "design",
        expected_output: "原生design",
        done_when: "design已关联",
      })
    ).task;
    const design = (
      await call("document", {
        project: p,
        task: dt.id,
        kind: "design",
        title: "实际设计工件",
        content: "合成的完整方案正文",
        role: "agent-interpretation",
        source: "fixture",
      })
    ).artifact;
    const dv = await c.call("task-view", { project: p, id: dt.id });
    await call("task-close", {
      project: p,
      task: dt.id,
      expected_revision: dv.task.meta.retouch.revision,
      statement: "fixture design close",
    });
    const s = await c.call("snapshot", { project: p });
    validateSnapshot(s);
    for (const [id, evidence] of [
      [t.id, delivered.delivery.id],
      [dt.id, design.id],
    ]) {
      const node = s.tables.nodes.find((n: any) => n.key === "task-" + id);
      assert.ok(
        s.tables.relations.some(
          (r: any) =>
            r.src_id === node.id &&
            r.dst_id === evidence &&
            r.rel === "evidenced-by",
        ),
      );
    }
    assert.equal(
      (await c.raw(["doctor"])).find((x: any) => x.name === "node_evidence")
        .status,
      "pass",
    );
    const zip = path.join(parent, "context.zip");
    await exportProject(c, p, zip);
    assert.ok(
      (await inspectProject(zip)).manifest.requires.includes(
        "retouch-result-revalidation/v1",
      ),
    );
    await importProject(zip, path.join(parent, "restored"), { entry });
    const restored = await NativeClient.open(path.join(parent, "restored"));
    assert.equal(
      (await restored.call("task-view", { project: p, id: t.id })).progress,
      "completed",
    );
    assert.equal(
      (await restored.raw(["doctor"])).find(
        (x: any) => x.name === "node_evidence",
      ).status,
      "pass",
    );
    await call("execution-record", {
      project: p,
      task: t.id,
      status: "unknown",
      inputs: [],
      outputs: [],
      statement: "合成未知请求夹具，未发网络",
      source: "fixture",
      external_request: "not-sent",
    });
    await assert.rejects(
      call(
        "result-revalidate",
        {
          ...adopt,
          expected_revision: (await view()).task.meta.retouch.revision,
        },
        "unknown-adopt",
      ),
      { code: "UNKNOWN_PENDING" },
    );
    assert.equal(JSON.parse(oldDelivery.delivery.meta).status, "completed");
  },
);

test(
  "E01/E02：用途覆盖依赖实际图片检查，多来源冲突与最小补证独立留痕",
  options,
  async () => {
    const { parent, c, call, p, goal, t, view, image, source, task } =
      await fixture("业务意图与冲突");
    const user = await source(
      "用户原文",
      "用户文字写手提；需要讲清实际用途、怎样安装和携带；允许直接批量制作。",
    );
    const ref = {
      artifact_id: user.id,
      quote: "需要讲清实际用途、怎样安装和携带",
    };
    const intent = {
      schema: "retouch.business-intent/v1",
      business_intent: {
        problem: "用途不清",
        audience: "购买者",
        how: "安装携带",
        where: null,
      },
      obligations: [
        { id: "usage", text: "实际展示用途", required: true, source: ref },
        { id: "operation", text: "说明安装关系", required: true, source: ref },
      ],
      rollout: {
        mode: "sample-first",
        representative_ids: ["usage", "operation"],
      },
    };
    const contract = (
      await call("intent-set", { project: p, intent, source: "fixture" })
    ).artifact;
    const images = [];
    for (let i = 0; i < 7; i++)
      images.push(await image("#" + (0x112233 + i).toString(16)));
    assert.equal(
      (await c.call("coverage-view", { project: p })).status,
      "NOT_EVALUATED",
    );
    const plan = {
      project: p,
      task: t.id,
      input: images[0].id,
      purpose: "concept",
      expected_revision: (await view()).task.meta.retouch.revision,
      stage: "expand",
      steps: [
        {
          id: "expand",
          prompt: "实际用途图",
          needs: [],
          coverage_ids: ["usage", "operation"],
        },
      ],
    };
    await assert.rejects(call("plan", plan), {
      code: "CONTENT_SAMPLE_REQUIRED",
    });
    const review = {
      project: p,
      id: images[0].id,
      sha256: sha(images[0]),
      contract_id: contract.id,
      method: "fixture",
      reviewer: "fixture",
      source: "fixture",
    };
    await call("coverage-check", {
      ...review,
      items: [
        {
          id: "usage",
          verdict: "FAIL",
          observations: "只有空背景外观，没有使用关系",
          evidence: "已查看实际64像素合成图",
        },
        {
          id: "operation",
          verdict: "UNKNOWN",
          observations: "无法识别安装",
          evidence: "当前候选不足以判断",
        },
      ],
    });
    assert.equal(
      (await c.call("coverage-view", { project: p })).status,
      "FAIL",
    );
    const sampleTask = await task("代表样张的连续流程"),
      sampleInput = await image("#8999aa", "original", sampleTask.id);
    const samplePlan = (
      await call("plan", {
        project: p,
        task: sampleTask.id,
        input: sampleInput.id,
        purpose: "concept",
        expected_revision: 0,
        steps: [
          { id: "quality", prompt: "质量样张", needs: [] },
          {
            id: "expand",
            prompt: "后续扩套",
            needs: ["quality"],
            coverage_ids: ["usage"],
          },
        ],
      })
    ).plan;
    const grant = (
      await call("grant", {
        project: p,
        task: sampleTask.id,
        plan_id: samplePlan.id,
        plan_hash: digest(JSON.parse(samplePlan.content)),
        issuer: "host-human",
        confirmation:
          "ISOLATED host protocol fixture, no actual image tool call",
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      })
    ).grant;
    const run = (
      await call("run-start", {
        project: p,
        task: sampleTask.id,
        grant: grant.id,
      })
    ).execution;
    await call("run-dispatch", {
      project: p,
      id: run.id,
      expected_revision: 0,
    });
    const sample = await image(
      "#99aabb",
      "postprocess",
      sampleTask.id,
      64,
      64,
      [sampleInput.id],
    );
    await call("run-complete", {
      project: p,
      id: run.id,
      output: sample.id,
      expected_revision: 1,
    });
    await call("run-review", {
      project: p,
      id: run.id,
      sha256: sha(sample),
      expected_revision: 2,
      verdict: "PASS",
      reviewer: "fixture",
      source: "fixture",
      observations: "只检查清晰度，不冒充用途覆盖",
    });
    await assert.rejects(
      call("run-dispatch", { project: p, id: run.id, expected_revision: 3 }),
      { code: "CONTENT_SAMPLE_REQUIRED" },
    );
    await call("coverage-check", {
      ...review,
      items: [
        {
          id: "usage",
          verdict: "PASS",
          observations: "隔离样张用途检查通过夹具",
          evidence: "synthetic semantic assertion, not real product proof",
        },
        {
          id: "operation",
          verdict: "PASS",
          observations: "隔离安装关系通过夹具",
          evidence: "fixture only",
        },
      ],
    });
    const covered = await c.call("coverage-view", { project: p });
    assert.equal(covered.status, "PASS");
    assert.equal(covered.items[0].observations.length, 1);
    const frozen = await call("plan", plan);
    assert.equal(
      JSON.parse(frozen.plan.content).steps[0].content_obligations.length,
      2,
    );
    assert.ok(
      apiPrompt(JSON.parse(frozen.plan.content).steps[0], [], []).includes(
        "说明安装关系",
      ),
    );
    const visual = await source(
      "图片观察解释",
      "原图安装结构可能用于车架携带；这只是图像解释。",
      "agent-interpretation",
    );
    const disputed = {
      schema: "retouch.evidence-conflict/v1",
      field: "carrying.mode",
      status: "unresolved",
      candidates: [
        {
          id: "text",
          value: "手提",
          subject: "current-sku",
          role: "user-original",
          observed_at: "2026-11-15T00:00:00Z",
          source: { artifact_id: user.id, quote: "用户文字写手提" },
        },
        {
          id: "visual",
          value: "车架固定",
          subject: "unknown",
          role: "agent-interpretation",
          observed_at: "2026-11-15T00:00:01Z",
          source: {
            artifact_id: visual.id,
            quote: "原图安装结构可能用于车架携带",
          },
        },
      ],
      research: {
        purpose: "只核实影响本次用途图的安装方式",
        stop_when: "找到安装关系或保留concept边界",
        read_back: [ref],
      },
    };
    const conflict = (
      await call("conflict-set", {
        project: p,
        conflict: disputed,
        source: "fixture",
      })
    ).artifact;
    assert.equal(
      (await c.call("brief", { project: p })).evidence_conflicts[0].status,
      "unresolved",
    );
    await assert.rejects(
      call("conflict-resolve", {
        project: p,
        id: conflict.id,
        status: "selected",
        source: "fixture",
        decision: {
          candidate_id: "visual",
          use: "creative-choice",
          statement: "按推荐创作不等于事实确认",
          reviewer: "fixture",
          source: "fixture",
          read_back: [],
        },
      }),
      { code: "EVIDENCE_CONFLICT" },
    );
    const resolved = (
      await call("conflict-resolve", {
        project: p,
        id: conflict.id,
        status: "selected",
        source: "fixture",
        decision: {
          candidate_id: "visual",
          use: "concept-reference",
          statement: "只用于概念用途方案，结构材质和适配仍未知",
          reviewer: "fixture",
          source: "fixture",
          read_back: disputed.candidates.map((x) => x.source),
        },
      })
    ).artifact;
    const unrelated = await task("不依赖携带方式的外观图");
    const original = await image("#778899", "original", unrelated.id);
    await call("plan", {
      project: p,
      task: unrelated.id,
      input: original.id,
      purpose: "concept",
      expected_revision: 0,
      steps: [{ id: "appearance", prompt: "仅外观", needs: [] }],
    });
    const v = await view();
    await call("plan", {
      project: p,
      task: t.id,
      input: images[0].id,
      purpose: "concept",
      expected_revision: v.task.meta.retouch.revision,
      steps: [
        {
          id: "concept",
          prompt: "概念用途",
          needs: [],
          fact_keys: ["carrying.mode"],
        },
      ],
    });
    const next = (
      await call("conflict-set", {
        project: p,
        expected_id: resolved.id,
        conflict: disputed,
        source: "new source must reopen decision",
      })
    ).artifact;
    assert.equal(
      JSON.parse(
        (await c.call("show", { project: p, id: resolved.id })).content,
      ).decision.use,
      "concept-reference",
    );
    assert.equal(
      (await view()).task.meta.retouch.context_status,
      "needs_review",
    );
    assert.notEqual(
      (await c.call("task-view", { project: p, id: unrelated.id })).task.meta
        .retouch.context_status,
      "needs_review",
    );
    await assert.rejects(
      call("intent-set", {
        project: p,
        expected_id: contract.id,
        intent: {
          ...intent,
          rollout: {
            ...intent.rollout,
            mode: "direct-batch",
            user_decision: {
              artifact_id: visual.id,
              quote: "原图安装结构可能用于车架携带",
            },
          },
        },
        source: "fixture",
      }),
      { code: "ROLLOUT" },
    );
    const direct = (
      await call("intent-set", {
        project: p,
        expected_id: contract.id,
        intent: {
          ...intent,
          rollout: {
            ...intent.rollout,
            mode: "direct-batch",
            user_decision: { artifact_id: user.id, quote: "允许直接批量制作" },
          },
        },
        source: "fixture user decision",
      })
    ).artifact;
    assert.equal(JSON.parse(direct.content).rollout.mode, "direct-batch");
    assert.equal(
      (await c.call("coverage-view", { project: p })).status,
      "NOT_EVALUATED",
    );
    const zip = path.join(parent, "contracts.zip");
    await exportProject(c, p, zip);
    await importProject(zip, path.join(parent, "restored"), { entry });
    const r = await NativeClient.open(path.join(parent, "restored"));
    assert.equal(
      (await r.call("conflicts-view", { project: p })).conflicts[0].id,
      next.id,
    );
    assert.ok(
      (await inspectProject(zip)).manifest.requires.includes(
        "retouch-flow-contracts/v1",
      ),
    );
  },
);

test(
  "E04：保持项FAIL/UNKNOWN不能被总体PASS绕过，修正后保留旧判断",
  options,
  async () => {
    const { parent, c, call, p, t, view, image, source, task } =
      await fixture("逐项商品保持");
    const s = await source(
      "保持依据",
      "可见一个孔；成年人须出现；文案须准确。",
    );
    const items = [
      {
        id: "holes",
        text: "只保留一个孔",
        scope: "可见正面",
        required: true,
        source: { artifact_id: s.id, quote: "可见一个孔" },
      },
      {
        id: "adult",
        text: "成年人不被裁切",
        scope: "场景画面",
        required: true,
        source: { artifact_id: s.id, quote: "成年人须出现" },
      },
      {
        id: "copy",
        text: "文字准确",
        scope: "可读区域",
        required: false,
        source: { artifact_id: s.id, quote: "文案须准确" },
      },
    ];
    const contract = (
      await call("invariants-set", {
        project: p,
        task: t.id,
        expected_revision: 0,
        invariants: { schema: "retouch.invariants/v1", items },
      })
    ).artifact;
    const bad = await image("#ee9900");
    const check = (a: any, results: any[]) =>
      call("invariants-check", {
        project: p,
        id: a.id,
        sha256: sha(a),
        contract_id: contract.id,
        method: "fixture",
        reviewer: "fixture",
        source: "fixture",
        items: results,
      });
    const item = (id: string, verdict: string) => ({
      id,
      verdict,
      observations:
        id === "holes" ? "实际候选出现两个孔/低清不可数" : "夹具逐项观察",
      evidence: "checked synthetic candidate, fixture only",
    });
    await check(bad, [
      item("holes", "UNKNOWN"),
      item("adult", "PASS"),
      item("copy", "UNKNOWN"),
    ]);
    assert.equal(
      (await c.call("invariant-view", { project: p, id: bad.id })).status,
      "UNKNOWN",
    );
    await assert.rejects(
      call("media-review", {
        project: p,
        id: bad.id,
        sha256: sha(bad),
        verdict: "PASS",
        accepted: true,
        source: "user",
        reviewer: "fixture",
        observations: "总体更清晰",
      }),
      { code: "INVARIANTS_PENDING" },
    );
    await check(bad, [item("holes", "FAIL")]);
    assert.equal(
      (await c.call("invariant-view", { project: p, id: bad.id })).status,
      "FAIL",
    );
    const good = await image("#eebb11", "postprocess", t.id, 64, 64, [bad.id]);
    await check(good, [
      item("holes", "PASS"),
      item("adult", "PASS"),
      item("copy", "UNKNOWN"),
    ]);
    assert.equal(
      (await c.call("invariant-view", { project: p, id: good.id })).status,
      "PASS",
    );
    await call("media-review", {
      project: p,
      id: good.id,
      sha256: sha(good),
      verdict: "PASS",
      accepted: false,
      source: "fixture",
      reviewer: "fixture",
      observations: "仅要求项通过，未代填用户接受",
    });
    const zip = path.join(parent, "invariants.zip");
    await exportProject(c, p, zip);
    await importProject(zip, path.join(parent, "restored"), { entry });
    const r = await NativeClient.open(path.join(parent, "restored"));
    assert.equal(
      (await r.call("invariant-view", { project: p, id: bad.id })).status,
      "FAIL",
    );
    assert.equal(
      (await r.call("invariant-view", { project: p, id: good.id })).status,
      "PASS",
    );
    assert.equal((await view()).task.image_outputs.length, 2);
    const plan = (
      await call("plan", {
        project: p,
        task: t.id,
        input: good.id,
        purpose: "concept",
        expected_revision: (await view()).task.meta.retouch.revision,
        steps: [{ id: "preserve", prompt: "保持商品", needs: [] }],
      })
    ).plan;
    assert.equal(JSON.parse(plan.content).contracts.invariants_id, contract.id);
    assert.ok(
      apiPrompt(JSON.parse(plan.content).steps[0], [], []).includes(
        "只保留一个孔",
      ),
    );
    const edge = await task("交付后新增必检项"),
      edgeImage = await image("#aacc55", "postprocess", edge.id);
    await call("media-review", {
      project: p,
      id: edgeImage.id,
      sha256: sha(edgeImage),
      verdict: "PASS",
      accepted: true,
      source: "user",
      reviewer: "fixture",
      observations: "隔离接受夹具",
    });
    await deliverArtifact(
      c,
      p,
      edgeImage.id,
      path.join(parent, "edge-delivery"),
      "edge-delivery",
    );
    const edgeContract = (
      await call("invariants-set", {
        project: p,
        task: edge.id,
        expected_revision: 0,
        invariants: { schema: "retouch.invariants/v1", items: [items[0]] },
      })
    ).artifact;
    const edgeView = () => c.call("task-view", { project: p, id: edge.id });
    await assert.rejects(
      call("task-close", {
        project: p,
        task: edge.id,
        expected_revision: (await edgeView()).task.meta.retouch.revision,
        statement: "不能绕过新必检项",
      }),
      { code: "TASK_INCOMPLETE" },
    );
    await call("invariants-check", {
      project: p,
      id: edgeImage.id,
      sha256: sha(edgeImage),
      contract_id: edgeContract.id,
      method: "fixture",
      reviewer: "fixture",
      source: "fixture",
      items: [item("holes", "PASS")],
    });
    await call("task-close", {
      project: p,
      task: edge.id,
      expected_revision: (await edgeView()).task.meta.retouch.revision,
      statement: "新必检项已检查，沿用同hash真实接受",
    });
  },
);

test(
  "E05：声明式本地修补/透明蒙版/文字合成与多输入血缘可重放",
  options,
  async () => {
    const { parent, c, p, t, image, view } = await fixture("原生本地变换");
    const base = await image("#224466", "model-output", t.id, 64, 64),
      patch = await image("#bb2200", "reference", t.id, 4, 4);
    const input = {
      input_id: base.id,
      inputs: [
        { id: base.id, sha256: sha(base), role: "商品原生图" },
        { id: patch.id, sha256: sha(patch), role: "批准区域修补" },
      ],
      operations: [
        {
          op: "repair",
          input_id: patch.id,
          region: { x: 9, y: 10, width: 4, height: 4 },
          coordinate_system: { width: 64, height: 64 },
        },
      ],
    };
    const fixed = await transform(c, p, t.id, input, 0, "repair");
    const before = await sharp(await objectBytes(c.root, JSON.parse(base.meta)))
        .ensureAlpha()
        .raw()
        .toBuffer(),
      after = await sharp(
        await objectBytes(c.root, JSON.parse(fixed.artifact.meta)),
      )
        .ensureAlpha()
        .raw()
        .toBuffer();
    let changed = 0;
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++) {
        const at = (y * 64 + x) * 4;
        if (!before.subarray(at, at + 4).equals(after.subarray(at, at + 4))) {
          assert.ok(x >= 9 && x < 13 && y >= 10 && y < 14);
          changed++;
        }
      }
    assert.equal(changed, 16);
    assert.equal(
      (await transform(c, p, t.id, input, 0, "repair")).artifact.id,
      fixed.artifact.id,
    );
    const fontFile =
      process.env.RETOUCH_TEST_FONT ??
      path.join(process.env.WINDIR!, "Fonts", "arial.ttf");
    const font = (await registerFont(c, p, fontFile, "font")).artifact;
    await assert.rejects(
      registerFont(c, p, path.join(parent, "missing.ttf"), "no-font"),
      { code: "FONT_MISSING" },
    );
    const bg = await image("#ffffff", "reference", t.id, 256, 256);
    const composed = await transform(
      c,
      p,
      t.id,
      {
        input_id: bg.id,
        inputs: [
          { id: bg.id, sha256: sha(bg), role: "背景" },
          {
            id: fixed.artifact.id,
            sha256: sha(fixed.artifact),
            role: "修正后的商品",
          },
          { id: font.id, sha256: sha(font), role: "显式标题字体" },
        ],
        operations: [
          { op: "composite", input_id: fixed.artifact.id, x: 96, y: 100 },
          {
            op: "annotate",
            text: "Style & Care <A>",
            font_id: font.id,
            font_size: 18,
            colour: "#111111",
            region: { x: 8, y: 8, width: 240, height: 60 },
            coordinate_system: { width: 256, height: 256 },
          },
          { op: "resize", width: 2048, height: 2048, fit: "contain" },
        ],
      },
      0,
      "layout",
    );
    const cm = JSON.parse(composed.artifact.meta);
    assert.equal(cm.width, 2048);
    assert.equal(cm.transform.inputs.length, 3);
    assert.equal(
      (
        await c.call("dimensions", { project: p, id: composed.artifact.id })
      ).images[0].lineage.some((a: any) => a.id === base.id && a.width === 64),
      true,
    );
    await assert.rejects(
      transform(
        c,
        p,
        t.id,
        {
          input_id: base.id,
          inputs: [input.inputs[0]],
          operations: [
            {
              op: "extract",
              region: { x: 63, y: 63, width: 2, height: 2 },
              coordinate_system: { width: 64, height: 64 },
            },
          ],
        },
        0,
        "bad-crop",
      ),
      { code: "TRANSFORM_REGION" },
    );
    await assert.rejects(
      transform(
        c,
        p,
        t.id,
        {
          input_id: base.id,
          inputs: [input.inputs[0]],
          operations: [{ op: "resize", width: 100, height: 50, fit: "fill" }],
        },
        0,
        "bad-ratio",
      ),
      { code: "TRANSFORM_ASPECT" },
    );
    const maskPixels = Buffer.alloc(64 * 64 * 4, 255);
    maskPixels[3] = 0;
    const mask = (
      await registerBytes(
        c,
        p,
        t.id,
        await sharp(maskPixels, { raw: { width: 64, height: 64, channels: 4 } })
          .png()
          .toBuffer(),
        { role: "reference" },
        "mask",
      )
    ).artifact;
    const masked = await transform(
      c,
      p,
      t.id,
      {
        input_id: base.id,
        inputs: [
          input.inputs[0],
          { id: mask.id, sha256: sha(mask), role: "透明蒙版" },
        ],
        operations: [{ op: "mask", input_id: mask.id }],
      },
      0,
      "mask-transform",
    );
    const mp = await sharp(
      await objectBytes(c.root, JSON.parse(masked.artifact.meta)),
    )
      .ensureAlpha()
      .raw()
      .toBuffer();
    assert.equal(mp[3], 0);
    assert.equal(mp[7], 255);
    const zip = path.join(parent, "postprocess.zip");
    await exportProject(c, p, zip);
    await importProject(zip, path.join(parent, "restored"), { entry });
    assert.ok(
      (await inspectProject(zip)).manifest.requires.includes(
        "retouch-postprocess/v1",
      ),
    );
    const r = await NativeClient.open(path.join(parent, "restored"));
    assert.equal(
      sha(await r.call("show", { project: p, id: composed.artifact.id })),
      sha(composed.artifact),
    );
    assert.ok((await view()).task.image_outputs.length >= 4);
  },
);

test(
  "E06：7图替换两张再扩9图，部分接受、快照总览及增量图片包一致",
  options,
  async () => {
    const { parent, c, call, p, t, image } = await fixture("稳定套图快照");
    const media: any[] = [];
    for (let i = 0; i < 11; i++)
      media.push(await image("#" + (0x334400 + i).toString(16)));
    const slots = media
      .slice(0, 7)
      .map((m, i) => ({
        id: String(i + 1).padStart(2, "0"),
        role: "画面职责" + (i + 1),
        media_id: m.id,
        sha256: sha(m),
      }));
    const snapshot = (selection: any[], old: any = null) =>
      call("suite-snapshot", {
        project: p,
        task: t.id,
        name: "商品系列",
        expected_id: old?.id ?? null,
        expected_revision: 0,
        slots: selection,
      });
    const first = (await snapshot(slots)).artifact;
    const accept = (id: string, selected: any[]) =>
      call("suite-accept", {
        project: p,
        id,
        source: "user",
        reviewer: "fixture human",
        statement: "隔离部分接受夹具，不是真实用户接受",
        slots: selected.map((s) => ({ id: s.id, sha256: s.sha256 })),
      });
    await accept(first.id, slots.slice(0, 2));
    const replacement = slots.map((s, i) =>
      i === 1 || i === 5
        ? {
            ...s,
            media_id: media[i === 1 ? 7 : 8].id,
            sha256: sha(media[i === 1 ? 7 : 8]),
          }
        : s,
    );
    const second = (await snapshot(replacement, first)).artifact;
    const nine = [
      ...replacement,
      ...media
        .slice(9)
        .map((m, i) => ({
          id: String(i + 8).padStart(2, "0"),
          role: "新增画面",
          media_id: m.id,
          sha256: sha(m),
        })),
    ];
    const third = (await snapshot(nine, second)).artifact;
    const current = await c.call("suite-view", { project: p, id: third.id });
    assert.equal(current.slots.length, 9);
    assert.equal(current.slots[0].accepted, true);
    assert.equal(current.slots[1].accepted, false);
    await assert.rejects(
      accept(third.id, [{ id: "01", sha256: "0".repeat(64) }]),
      { code: "SUITE_ACCEPTANCE" },
    );
    const full = path.join(parent, "preview-nine.zip"),
      delta = path.join(parent, "preview-added-two.zip");
    const exported = await exportSuite(
      c,
      p,
      third.id,
      full,
      { mode: "preview" },
      "preview-full",
    );
    const added = await exportSuite(
      c,
      p,
      third.id,
      delta,
      { mode: "preview", from_id: second.id },
      "preview-delta",
    );
    assert.equal(exported.manifest.image_count, 9);
    assert.equal(added.manifest.image_count, 2);
    assert.equal(exported.manifest.snapshot_id, added.manifest.snapshot_id);
    const fullFiles = await readZip(full),
      deltaFiles = await readZip(delta);
    for (const m of [exported.manifest, added.manifest])
      for (const slot of m.slots) {
        const bytes = (m === exported.manifest ? fullFiles : deltaFiles).get(
          slot.file,
        )!;
        assert.equal(bytesHash(bytes), slot.sha256);
      }
    assert.equal(
      [...fullFiles.keys()].filter((k) => k.startsWith("images/")).length,
      9,
    );
    assert.equal(
      [...deltaFiles.keys()].filter((k) => k.startsWith("images/")).length,
      2,
    );
    const mtime = (await fs.stat(full)).mtimeMs;
    assert.equal(
      (
        await exportSuite(
          c,
          p,
          third.id,
          full,
          { mode: "preview" },
          "preview-full",
        )
      ).replayed,
      true,
    );
    assert.equal((await fs.stat(full)).mtimeMs, mtime);
    await assert.rejects(
      exportSuite(
        c,
        p,
        third.id,
        path.join(parent, "unaccepted.zip"),
        { mode: "delivery" },
        "unaccepted",
      ),
      { code: "SUITE_ACCEPTANCE" },
    );
    await accept(third.id, nine.slice(7));
    const partial = await c.call("suite-view", { project: p, id: third.id });
    assert.equal(partial.slots.filter((s: any) => s.accepted).length, 3);
    const formal = await exportSuite(
      c,
      p,
      third.id,
      path.join(parent, "accepted-added-two.zip"),
      { mode: "delivery", from_id: second.id },
      "accepted-delta",
    );
    assert.equal(formal.manifest.schema, "retouch.image-delivery/v1");
    await assert.rejects(inspectProject(full));
    const foreign = (
      await call("project-new", {
        name: "另一个项目",
        intent: "隔离项目",
        tags: [],
      })
    ).project.id;
    const fg = (
      await call("goal-new", {
        project: foreign,
        title: "foreign goal",
        scope: "fixture",
        preserve: [],
        done_when: "fixture",
        source: "fixture",
      })
    ).artifact;
    const ft = (
      await call("task-new", {
        project: foreign,
        goal: fg.id,
        title: "foreign task",
        brief: "fixture",
        kind: "image",
        expected_output: "fixture",
        done_when: "fixture",
      })
    ).task;
    const foreignImage = (
      await registerBytes(
        c,
        foreign,
        ft.id,
        await sharp({
          create: { width: 8, height: 8, channels: 3, background: "#ff0000" },
        })
          .png()
          .toBuffer(),
        { role: "postprocess" },
        "foreign",
      )
    ).artifact;
    await assert.rejects(
      snapshot(
        [
          {
            id: "foreign",
            role: "非法混入",
            media_id: foreignImage.id,
            sha256: sha(foreignImage),
          },
        ],
        third,
      ),
      { code: "NOT_FOUND" },
    );
    assert.equal(
      (await c.call("suite-view", { project: p, id: first.id })).slots.length,
      7,
    );
    const context = path.join(parent, "context.zip");
    await exportProject(c, p, context);
    await importProject(context, path.join(parent, "restored"), { entry });
    const r = await NativeClient.open(path.join(parent, "restored"));
    assert.equal(
      (await r.call("suite-view", { project: p, id: third.id })).slots.length,
      9,
    );
    assert.ok(
      (await inspectProject(context)).manifest.requires.includes(
        "retouch-suite/v1",
      ),
    );
    await fs.writeFile(
      path.join(
        process.env.RETOUCH_TEST_ROOT!,
        "native-engineering-evidence.json",
      ),
      JSON.stringify({
        verdict: "PASS",
        local_issues: ["E01", "E02", "E03", "E04", "E05", "E06", "E07"],
        image_api_requests: 0,
        credentials_read: false,
        scope:
          "isolated fixtures, semantic checks supplied explicitly; no real product quality claim",
      }),
    );
  },
);
