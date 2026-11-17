import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import sharp from "sharp";
import { NativeClient } from "../src/native/client.ts";
import {
  registerMedia,
  resizeMedia,
  deliverArtifact,
  abandonDelivery,
  objectBytes,
} from "../src/native/files.ts";
import {
  registerExecutor,
  checkExecutor,
  diagnoseExecutor,
  executeApi,
  attachApiResult,
  recoverApi,
} from "../src/native/api.ts";
import { digest, validateSnapshot } from "../src/native/plugin/commands.mjs";
import {
  exportProject,
  importProject,
  inspectProject,
} from "../src/native/exchange.ts";
import { registerWorkspace, taste } from "../src/native/context.ts";
import { readZip, writeZip } from "../src/infrastructure/zip.ts";
import { apiPrompt } from "../src/native/plugin/api-contract.mjs";
import {
  registerProductConsistency,
  checkProductItems,
} from "./helpers/product-consistency-fixture.ts";
const entry = process.env.RETOUCH_TEST_YGL_ENTRY;
async function fixture(name: string) {
  const parent = await fs.mkdtemp(
    path.join(process.env.RETOUCH_TEST_ROOT!, "issue-"),
  );
  const c = await NativeClient.initialize(path.join(parent, "home"), entry!);
  let serial = 0;
  const call = (action: string, b: any, key?: string) =>
    c.call(action, b, key ?? "issue-" + ++serial);
  const p = (
    await call("project-new", {
      name,
      intent: "脱敏真实试点回放",
      tags: ["风格:原木"],
    })
  ).project.id;
  const goal = (
    await call("goal-new", {
      project: p,
      title: "商品图交付",
      scope: "修图及事实边界",
      preserve: ["商品结构"],
      done_when: "实际验收并交付",
      source: "fixture",
    })
  ).artifact;
  const t = (
    await call("task-new", {
      project: p,
      goal: goal.id,
      title: "修图",
      brief: "隔离测试",
      expected_output: "商品图",
      done_when: "用户接受并交付",
      kind: "image",
    })
  ).task;
  const originalFile = path.join(parent, "original.png");
  await sharp({
    create: { width: 200, height: 200, channels: 4, background: "#aa9988" },
  })
    .png()
    .toFile(originalFile);
  const input = (
    await registerMedia(
      c,
      p,
      t.id,
      originalFile,
      { role: "original" },
      "original",
    )
  ).artifact;
  const task = async () =>
    (await c.call("task-view", { project: p, id: t.id })).task;
  return { parent, c, call, p, goal, t, input, originalFile, task };
}
test(
  "#5/#6/#8：外部 received 正确收口，交付预检/中断恢复/处置不重新出图",
  { skip: !entry, timeout: 300000 },
  async () => {
    const { parent, c, call, p, t, input, task } =
      await fixture("外部结果交付");
    const unknown = (
      await call("execution-record", {
        project: p,
        task: t.id,
        status: "unknown",
        inputs: [input.id],
        outputs: [],
        statement: "已发出的外部调用，等待结果",
        source: "fixture",
        external_request: "fixture-external",
        requested_dimensions: {
          width: 2048,
          height: 2048,
          scope: "api-request",
          source_ref: "fixture recorded request",
        },
      })
    ).execution;
    const rawFile = path.join(parent, "native-1254.png");
    await sharp({
      create: { width: 1254, height: 1254, channels: 4, background: "#ccbb99" },
    })
      .png()
      .toFile(rawFile);
    const raw = (
      await registerMedia(
        c,
        p,
        t.id,
        rawFile,
        {
          role: "model-output",
          parents: [input.id],
          operation: "fixture real bytes, no AI",
        },
        "raw",
      )
    ).artifact;
    await call("execution-reconcile", {
      project: p,
      id: unknown.id,
      status: "received",
      outputs: [raw.id],
      statement: "真实图片已保存",
      expected_revision: 0,
    });
    const output = (await resizeMedia(c, p, raw.id, 2048, 2048, "resize"))
      .artifact;
    const close = async (key: string) =>
      call(
        "task-close",
        {
          project: p,
          task: t.id,
          expected_revision: (await task()).meta.retouch.revision,
          statement: "隔离夹具：已接受并交付",
        },
        key,
      );
    await assert.rejects(close("not-accepted"), { code: "TASK_INCOMPLETE" });
    const om = JSON.parse(output.meta);
    await call("media-review", {
      project: p,
      id: output.id,
      sha256: om.sha256,
      verdict: "PASS",
      observations: "fixture visual check",
      reviewer: "fixture-user",
      accepted: true,
      source: "user",
    });
    await assert.rejects(close("not-delivered"), { code: "TASK_INCOMPLETE" });
    const before = await c.call("snapshot", { project: p });
    await assert.rejects(
      deliverArtifact(
        c,
        p,
        output.id,
        path.join(c.root, "bad-delivery"),
        "inside",
      ),
      { code: "DELIVERY_PATH" },
    );
    await assert.rejects(
      deliverArtifact(
        c,
        p,
        output.id,
        path.join(parent, "missing", "out"),
        "missing-parent",
      ),
    );
    assert.ok(
      !(await c.call("receipt", { request_id: "inside:intent" })).result,
    );
    assert.equal(
      (await c.call("snapshot", { project: p })).fingerprint,
      before.fingerprint,
    );
    const conflict = path.join(parent, "conflict");
    await fs.mkdir(conflict);
    await fs.writeFile(path.join(conflict, "image.png"), "other bytes");
    await assert.rejects(
      deliverArtifact(c, p, output.id, conflict, "conflict"),
      { code: "DELIVERY_CONFLICT" },
    );
    assert.ok(
      !(await c.call("receipt", { request_id: "conflict:intent" })).result,
    );
    const linked = path.join(parent, "linked");
    await fs.symlink(conflict, linked, "junction");
    await assert.rejects(deliverArtifact(c, p, output.id, linked, "linked"), {
      code: "DELIVERY_LINK",
    });
    assert.ok(
      !(await c.call("receipt", { request_id: "linked:intent" })).result,
    );
    const destination = path.join(parent, "delivered"),
      originalWrite = fs.writeFile;
    let injected = false;
    fs.writeFile = (async (...args: Parameters<typeof fs.writeFile>) => {
      if (
        String(args[0]) === path.join(destination, "manifest.json") &&
        !injected
      ) {
        injected = true;
        throw Object.assign(new Error("fixture publication interruption"), {
          code: "EIO",
        });
      }
      return originalWrite(...args);
    }) as typeof fs.writeFile;
    try {
      await assert.rejects(
        deliverArtifact(c, p, output.id, destination, "deliver"),
        (e: any) =>
          e.code === "EIO" &&
          e.effectStatus === "committed" &&
          e.details.preparation_committed === true,
      );
    } finally {
      fs.writeFile = originalWrite;
    }
    assert.ok(injected);
    await fs.access(path.join(destination, "image.png"));
    await assert.rejects(fs.access(path.join(destination, "manifest.json")), {
      code: "ENOENT",
    });
    const completed = await deliverArtifact(
      c,
      p,
      output.id,
      destination,
      "deliver",
    );
    assert.equal(JSON.parse(completed.delivery.meta).status, "completed");
    assert.equal(
      (await deliverArtifact(c, p, output.id, destination, "deliver")).replayed,
      true,
    );
    await assert.rejects(
      deliverArtifact(
        c,
        p,
        output.id,
        path.join(parent, "different"),
        "deliver",
      ),
      { code: "REQUEST_CONFLICT" },
    );
    const dims = (await c.call("dimensions", { project: p, id: output.id }))
      .images[0];
    assert.equal(dims.actual.width, 2048);
    assert.equal(dims.native_outputs[0].width, 1254);
    assert.equal(dims.requests[0].requested.width, 2048);
    assert.equal(dims.mismatches[0].code, "RESPONSE_SIZE_MISMATCH");
    const manifest = JSON.parse(
      await fs.readFile(path.join(destination, "manifest.json"), "utf8"),
    );
    assert.equal(manifest.dimension_provenance.native_outputs[0].width, 1254);
    assert.equal(JSON.parse((await close("close")).task.meta).status, "done");
    const stableCall = c.call.bind(c),
      movingParent = path.join(parent, "moving"),
      movedParent = path.join(parent, "moved"),
      alternate = path.join(parent, "alternate");
    await fs.mkdir(movingParent);
    await fs.mkdir(alternate);
    c.call = async (action, body, key) => {
      const r = await stableCall(action, body, key);
      if (action === "delivery-prepare" && key === "moving:intent") {
        await fs.rename(movingParent, movedParent);
        await fs.symlink(alternate, movingParent, "junction");
      }
      return r;
    };
    try {
      await assert.rejects(
        deliverArtifact(
          c,
          p,
          output.id,
          path.join(movingParent, "out"),
          "moving",
        ),
        (e: any) =>
          e.effectStatus === "committed" &&
          ["DELIVERY_LINK", "DELIVERY_PATH_CHANGED"].includes(e.code),
      );
    } finally {
      c.call = stableCall;
    }
    const pending = (await c.call("receipt", { request_id: "moving:intent" }))
      .result.delivery;
    assert.equal(
      JSON.parse(
        (
          await abandonDelivery(
            c,
            p,
            pending.id,
            "已核对没有清单发布；保留旧意图",
            "abandon",
          )
        ).delivery.meta,
      ).status,
      "abandoned",
    );
    const legacy = (
      await call("delivery-prepare", {
        project: p,
        id: output.id,
        directory: path.join(c.root, "legacy-invalid"),
      })
    ).delivery;
    await abandonDelivery(
      c,
      p,
      legacy.id,
      "回放旧版本无效路径记录，无文件发布",
      "abandon-legacy",
    );
    await call("execution-record", {
      project: p,
      task: t.id,
      status: "unknown",
      inputs: [input.id],
      outputs: [],
      statement: "另一个真实未知调用",
      source: "fixture",
      external_request: "unresolved",
    });
    await assert.rejects(close("close-with-unknown"), {
      code: "UNKNOWN_PENDING",
    });
    assert.ok(
      (await c.call("business-check", { project: p })).findings.some(
        (f: any) => f.code === "CLOSED_WITH_PENDING_EXECUTION",
      ),
    );
    assert.equal(
      (await c.call("brief", { project: p })).artifacts.filter(
        (a: any) => a.kind === "execution",
      ).length,
      2,
    );
  },
);
test(
  "#3/#4：显式 Codex 配置复用、独立能力诊断、单次提交与 unknown/received 本地恢复",
  { skip: !entry, timeout: 300000 },
  async () => {
    const { parent, c, call, p, t, input, task } = await fixture("配置复用");
    const result = await sharp({
      create: { width: 200, height: 200, channels: 4, background: "#abccdd" },
    })
      .png()
      .toBuffer();
    let requests = 0,
      mode = "ok";
    const server = http.createServer(async (req, res) => {
      requests++;
      assert.equal(req.headers.authorization, "Bearer fixture-only-bearer");
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      assert.ok(Buffer.concat(chunks).includes(Buffer.from("gpt-image-2")));
      assert.ok(Buffer.concat(chunks).includes(Buffer.from("1024x1024")));
      if (mode === "timeout")
        await new Promise((resolve) => setTimeout(resolve, 500));
      if (!res.destroyed) {
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({ data: [{ b64_json: result.toString("base64") }] }),
        );
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as any).port,
      configHome = path.join(parent, "codex");
    await fs.mkdir(configHome);
    const toml = (provider = "fixture", base = `http://127.0.0.1:${port}/v1`) =>
      `model_provider = "${provider}"\nmodel = "language-model-not-the-image-model"\n[model_providers.${provider}]\nbase_url = "${base}"\nexperimental_bearer_token = "fixture-only-bearer"\n`;
    await fs.writeFile(path.join(configHome, "config.toml"), toml());
    const env = { CODEX_HOME: configHome };
    const candidate = {
      title: "当前模型服务",
      profile: {
        schema: "retouch.api-profile/v1",
        protocol: "openai-images-edits/v1",
        model: "gpt-image-2",
        allow_loopback_http: true,
        // Positive-path I/O budget is independent of the deliberate timeout fixture.
        timeout_ms: 5000,
        size: "1024x1024",
        configuration_source: {
          kind: "codex-model",
          authorized: true,
          authorization_ref:
            "fixture explicit user instruction to use current Codex configuration",
        },
      },
    };
    try {
      const absent = await diagnoseExecutor(
        c,
        p,
        {
          profile: {
            ...candidate.profile,
            configuration_source: { kind: "codex-model", authorized: false },
          },
        },
        { CODEX_HOME: path.join(parent, "not-readable") },
      );
      assert.equal(absent.diagnostic, "CONFIG_SOURCE_UNAUTHORIZED");
      assert.equal(
        (
          await diagnoseExecutor(c, p, candidate, {
            CODEX_HOME: path.join(parent, "missing"),
          })
        ).diagnostic,
        "CONFIG_SOURCE_MISSING",
      );
      const incompatible = await diagnoseExecutor(
        c,
        p,
        { profile: { ...candidate.profile, protocol: "unimplemented" } },
        env,
      );
      assert.equal(incompatible.configuration_read, "NOT_RUN");
      const profile = (await registerExecutor(c, p, candidate, "executor", env))
        .profile;
      await call("executor-observe", {
        project: p,
        state: "unavailable",
        source: "fixture actual tool inventory",
      });
      const initial = await checkExecutor(c, p, profile.id, env);
      assert.equal(initial.builtin_tool.state, "unavailable");
      assert.equal(initial.protected_configuration.present, true);
      assert.equal(initial.credential_configured, true);
      assert.equal(initial.network, "NOT_RUN");
      assert.equal(requests, 0);
      assert.equal(initial.ready, true);
      assert.equal(
        JSON.stringify(initial).includes("fixture-only-bearer"),
        false,
      );
      await fs.writeFile(path.join(configHome, "config.toml"), toml("other"));
      assert.equal(
        (await checkExecutor(c, p, profile.id, env)).diagnostic,
        "CONFIG_SELECTION_DRIFT",
      );
      assert.equal(requests, 0);
      await fs.writeFile(path.join(configHome, "config.toml"), toml());
      const plan = (
        await call("plan", {
          project: p,
          task: t.id,
          input: input.id,
          fallback: { profile_id: profile.id },
          expected_revision: (await task()).meta.retouch.revision,
          steps: [{ id: "edit", prompt: "保留商品，只调整背景", needs: [] }],
        })
      ).plan;
      const fallback = JSON.parse(plan.content).fallback;
      const grant = (
        await call("grant", {
          project: p,
          task: t.id,
          plan_id: plan.id,
          plan_hash: digest(JSON.parse(plan.content)),
          issuer: "host-human",
          confirmation: "fixture explicit image request",
          expires_at: new Date(Date.now() + 3600000).toISOString(),
          api_fallback: {
            ...fallback,
            max_requests: 1,
            cost_confirmation: "fixture-only local server, no paid API",
            upload_confirmation: "fixture synthetic pixels",
          },
        })
      ).grant;
      let run = (
        await call("run-start", { project: p, task: t.id, grant: grant.id })
      ).execution;
      await executeApi(c, p, run.id, {
        profileId: profile.id,
        revision: 0,
        requestId: "execute",
        env,
      });
      assert.equal(requests, 1);
      const observed = (
        await c.call("dimensions", {
          project: p,
          id: JSON.parse(
            (await c.call("show", { project: p, id: run.id })).meta,
          ).raw_output,
        })
      ).images[0];
      assert.ok(
        observed.mismatches.some(
          (m: any) =>
            m.code === "RESPONSE_SIZE_MISMATCH" &&
            m.requested.width === 1024 &&
            m.observed.width === 200,
        ),
      );
      await executeApi(c, p, run.id, {
        profileId: profile.id,
        revision: 0,
        requestId: "execute",
        env: {},
      });
      assert.equal(requests, 1);
      const recent = await checkExecutor(c, p, profile.id, env);
      assert.equal(recent.recent_image_result.execution_id, run.id);
      assert.equal(recent.historical_success_is_current_authentication, false);
      const timeoutProfile = (
        await registerExecutor(
          c,
          p,
          {
            ...candidate,
            title: "故意超时的独立配置",
            profile: { ...candidate.profile, timeout_ms: 100 },
          },
          "executor-timeout",
          env,
        )
      ).profile;
      assert.equal(JSON.parse(profile.content).profile.timeout_ms, 5000);
      assert.equal(JSON.parse(timeoutProfile.content).profile.timeout_ms, 100);
      const second = (
        await call("task-new", {
          project: p,
          goal: (await task()).meta.retouch.goal_id,
          title: "未知结果",
          brief: "fixture",
          expected_output: "image",
          done_when: "review",
          kind: "image",
        })
      ).task;
      const input2 = (
        await registerMedia(
          c,
          p,
          second.id,
          path.join(parent, "original.png"),
          { role: "original" },
          "input2",
        )
      ).artifact;
      const plan2 = (
        await call("plan", {
          project: p,
          task: second.id,
          input: input2.id,
          fallback: { profile_id: timeoutProfile.id },
          expected_revision: 0,
          steps: [{ id: "edit", prompt: "fixture", needs: [] }],
        })
      ).plan;
      const grant2 = (
        await call("grant", {
          project: p,
          task: second.id,
          plan_id: plan2.id,
          plan_hash: digest(JSON.parse(plan2.content)),
          issuer: "host-human",
          confirmation: "fixture",
          expires_at: new Date(Date.now() + 3600000).toISOString(),
          api_fallback: {
            ...JSON.parse(plan2.content).fallback,
            max_requests: 1,
            cost_confirmation: "local fixture",
            upload_confirmation: "synthetic",
          },
        })
      ).grant;
      run = (
        await call("run-start", {
          project: p,
          task: second.id,
          grant: grant2.id,
        })
      ).execution;
      mode = "timeout";
      await assert.rejects(
        executeApi(c, p, run.id, {
          profileId: timeoutProfile.id,
          revision: 0,
          requestId: "timeout",
          env,
        }),
        { code: "API_TIMEOUT" },
      );
      assert.equal(requests, 2);
      run = await c.call("show", { project: p, id: run.id });
      assert.equal(JSON.parse(run.meta).status, "unknown");
      await executeApi(c, p, run.id, {
        profileId: timeoutProfile.id,
        revision: 0,
        requestId: "timeout",
        env,
      });
      assert.equal(requests, 2);
      const intent = JSON.parse(run.meta).api_intent;
      await attachApiResult(
        c,
        p,
        run.id,
        result,
        {
          tool: "fixture late original response",
          tool_receipt: "same request, no retry",
          model: "gpt-image-2",
          endpoint_fingerprint: intent.endpoint_fingerprint,
          provider_request_id: null,
          usage: {},
          http_status: 200,
          response_sha256: null,
        },
        intent.operation_key,
      );
      await assert.rejects(
        call("requirements", {
          project: p,
          task: second.id,
          expected_revision: 1,
          groups: [],
        }),
        { code: "RESULT_PENDING" },
      );
      await recoverApi(c, p, run.id);
      assert.equal(requests, 2);
      assert.equal(
        JSON.parse((await c.call("show", { project: p, id: run.id })).meta)
          .status,
        "waiting_for_review",
      );
      const zip = path.join(parent, "config.zip");
      await exportProject(c, p, zip);
      const target = path.join(parent, "restored");
      await importProject(zip, target, { entry: entry! });
      const restored = await NativeClient.open(target);
      assert.equal(
        (
          await checkExecutor(restored, p, profile.id, {
            CODEX_HOME: path.join(parent, "missing"),
          })
        ).diagnostic,
        "CONFIG_SOURCE_REAUTHORIZE",
      );
      assert.equal(requests, 2);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
test(
  "#9/#10：字段事实、概念/实物用途、原始量表、跨工作区统计及 ZIP 不丢语义",
  { skip: !entry, timeout: 300000 },
  async () => {
    const { parent, c, call, p, t, input, task } =
      await fixture("商品事实与评分");
    const source = (
      await call("document", {
        project: p,
        kind: "spec",
        title: "用户原文",
        role: "user-original",
        source: "fixture user message",
        content:
          "200px原图；无表头：2 | 3 | 1。用户明确确认：单柜宽14.96英寸。",
      })
    ).artifact;
    const ai = (
      await call("document", {
        project: p,
        kind: "spec",
        title: "AI解释",
        role: "agent-interpretation",
        source: "fixture AI reconstruction",
        content: "抽屉内部仍未知，AI补绘不是规格。",
      })
    ).artifact;
    const fields = [
      {
        key: "dimensions.width",
        value: 14.96,
        unit: "inch",
        status: "confirmed",
        role: "user-original",
        subject: "current-sku",
        applies_to: "single-item",
        evidence_type: "user-field-confirmation",
        source: {
          artifact_id: source.id,
          quote: "用户明确确认：单柜宽14.96英寸。",
          label_present: true,
        },
        confirmation: {
          statement: "fixture actual field confirmation",
          source_ref: "fixture user message",
        },
      },
      {
        key: "drawer.interior",
        value: null,
        status: "unknown",
        role: "ai-reconstruction",
        subject: "unknown",
        applies_to: "unknown",
        evidence_type: "ai-output",
        source: {
          artifact_id: ai.id,
          quote: "抽屉内部仍未知，AI补绘不是规格。",
          label_present: false,
        },
      },
      {
        key: "unlabeled.number",
        value: 3,
        status: "observed",
        role: "user-original",
        subject: "unknown",
        applies_to: "unknown",
        evidence_type: "user-message",
        source: {
          artifact_id: source.id,
          quote: "2 | 3 | 1",
          label_present: false,
        },
      },
    ];
    const facts = (
      await call("facts-register", {
        project: p,
        source: "fixture evidence-first field capture",
        facts: { schema: "retouch.product-facts/v1", fields },
      })
    ).artifact;
    const rawFacts = JSON.parse(facts.content);
    const consistency = await registerProductConsistency(
      c,
      p,
      t.id,
      input,
      "reference",
      "facts9",
    );
    const plan = async (purpose: string, safe_strategy?: string) =>
      call("plan", {
        project: p,
        task: t.id,
        input: input.id,
        expected_revision: (await task()).meta.retouch.revision,
        purpose,
        steps: [
          {
            id: "storage",
            input_role: "product-structure",
            prompt: "收纳展示",
            needs: [],
            fact_keys: ["drawer.interior", "dimensions.width"],
            ...(safe_strategy ? { safe_strategy } : {}),
          },
        ],
      });
    const concept = (await plan("concept")).plan;
    assert.equal(
      JSON.parse(concept.content).fact_check.missing[0],
      "drawer.interior",
    );
    await assert.rejects(plan("product-accurate"), {
      code: "FACTS_INCOMPLETE",
    });
    const safe = (await plan("product-accurate", "closed-drawer")).plan;
    await checkProductItems(
      c,
      p,
      input,
      consistency.contract,
      "facts9-invariants",
    );
    const compiled = apiPrompt(JSON.parse(safe.content).steps[0], [], []);
    assert.ok(
      compiled.includes("14.96") &&
        compiled.includes('"unit":"inch"') &&
        compiled.includes('"applies_to":"single-item"'),
    );
    assert.equal(compiled.includes(source.id), false);
    assert.ok(
      JSON.parse(safe.content).steps[0].fact_constraints.some((s: string) =>
        s.includes("抽屉保持闭合"),
      ),
    );
    await call("media-review", {
      project: p,
      id: input.id,
      sha256: JSON.parse(input.meta).sha256,
      verdict: "PASS",
      observations: "仅接受配色，未确认内部",
      reviewer: "fixture-user",
      accepted: true,
      source: "user",
    });
    assert.equal(
      (await c.call("show", { project: p, id: facts.id })).content,
      facts.content,
    );
    const revise = {
      project: p,
      id: facts.id,
      expected_version: 1,
      expected_hash: digest(facts.content),
      reason: "fixture update",
      source: "fixture actual source",
    };
    await assert.rejects(
      call("document-revise", {
        ...revise,
        content: {
          ...rawFacts,
          fields: fields.map((f) =>
            f.key === "drawer.interior"
              ? {
                  ...f,
                  status: "confirmed",
                  value: "unknown",
                  confirmation: { statement: "配色通过", source_ref: "visual" },
                }
              : f,
          ),
        },
      }),
      { code: "PRODUCT_FACTS" },
    );
    const updated = (
      await call("document-revise", {
        ...revise,
        content: {
          ...rawFacts,
          fields: fields.map((f) =>
            f.key === "unlabeled.number" ? { ...f, value: 2 } : f,
          ),
        },
      })
    ).artifact;
    assert.notEqual((await task()).meta.retouch.context_status, "needs_review");
    const newSource = (
      await call("document", {
        project: p,
        kind: "spec",
        title: "抽屉实物确认",
        role: "user-original",
        source: "fixture new user field confirmation",
        content: "用户实物确认：抽屉内部为封闭空间。",
      })
    ).artifact;
    const newFields = JSON.parse(updated.content).fields.map((f: any) =>
      f.key === "drawer.interior"
        ? {
            ...f,
            value: "封闭空间",
            status: "confirmed",
            role: "user-original",
            subject: "current-sku",
            applies_to: "single-item",
            evidence_type: "user-field-confirmation",
            source: {
              artifact_id: newSource.id,
              quote: newSource.content,
              label_present: true,
            },
            confirmation: {
              statement: "fixture actual current product confirmation",
              source_ref: "fixture later user message",
            },
          }
        : f,
    );
    await call("document-revise", {
      ...revise,
      id: updated.id,
      expected_version: 2,
      expected_hash: digest(updated.content),
      content: { ...rawFacts, fields: newFields },
    });
    assert.equal((await task()).meta.retouch.context_status, "needs_review");
    let view = await c.call("brief", { project: p });
    await call("project-feedback", {
      project: p,
      expected_revision: view.profile.version,
      rating: 4,
      conclusion: "历史四星",
      source: "user",
    });
    view = await c.call("brief", { project: p });
    const feedback = {
      project: p,
      expected_revision: view.profile.version,
      rating: {
        score: 8,
        scale_max: 10,
        original_text: "满分10星，我给8星",
        source_ref: source.id,
      },
      conclusion: "保留原始八星",
      source: "user",
    };
    const rated = await call("project-feedback", feedback, "raw-feedback");
    assert.equal(
      (await call("project-feedback", feedback, "raw-feedback")).profile.id,
      rated.profile.id,
    );
    await assert.rejects(
      call("project-feedback", {
        ...feedback,
        rating: { ...feedback.rating, score: 11 },
      }),
      { code: "RATING" },
    );
    view = await c.call("brief", { project: p });
    assert.equal(view.profile.content.rating, null);
    assert.equal(view.profile.content.rating_record.score, 8);
    assert.equal(view.profile.content.rating_record.scale_min, null);
    assert.equal(
      view.reminders.some((s: string) => s.includes("评分")),
      false,
    );
    const other = await NativeClient.initialize(
      path.join(parent, "other"),
      entry!,
    );
    const p2 = (
      await other.call(
        "project-new",
        { name: "历史五分制", intent: "fixture", tags: ["风格:原木"] },
        "other-project",
      )
    ).project.id;
    await other.call(
      "project-feedback",
      {
        project: p2,
        expected_revision: 1,
        rating: 4,
        source: "user",
        conclusion: "legacy four out of five",
      },
      "other-feedback",
    );
    await registerWorkspace(c, other.root, [], "register-other");
    const stats = await taste(c);
    assert.equal(stats.denominator.rated, 2);
    assert.equal(stats.rating_summary.mean_rating, null);
    assert.equal(stats.rating_summary.rating_scales.length, 2);
    assert.equal(stats.frequency[0].rated_projects, 2);
    const zip = path.join(parent, "facts-rating.zip");
    await exportProject(c, p, zip);
    const inspected = await inspectProject(zip);
    assert.ok(inspected.manifest.requires.includes("retouch-rating-scale/v1"));
    assert.ok(inspected.manifest.requires.includes("retouch-product-facts/v1"));
    const entries = await readZip(zip),
      manifest = JSON.parse(entries.get("manifest.json")!.toString());
    manifest.requires = manifest.requires.filter(
      (cap: string) => cap !== "retouch-rating-scale/v1",
    );
    entries.set("manifest.json", Buffer.from(JSON.stringify(manifest)));
    const badZip = path.join(parent, "missing-cap.zip");
    await writeZip(badZip, entries);
    await assert.rejects(inspectProject(badZip), { code: "ZIP_CAPABILITY" });
    const target = path.join(parent, "restored");
    await importProject(zip, target, { entry: entry! });
    const restored = await NativeClient.open(target);
    assert.deepEqual(
      (await restored.call("brief", { project: p })).profile.content
        .rating_record,
      view.profile.content.rating_record,
    );
    await registerWorkspace(c, restored.root, [], "register-restored");
    assert.equal((await taste(c)).denominator.projects, 2);
    await importProject(zip, target, { strategy: "clone", name: "独立副本" });
    const clone = (await restored.call("projects", {})).find(
      (x: any) => x.name === "独立副本",
    );
    const cloneSnapshot = await restored.call("snapshot", {
      project: clone.id,
    });
    validateSnapshot(cloneSnapshot);
    assert.deepEqual(
      (await restored.call("brief", { project: clone.id })).profile.content
        .rating_record,
      view.profile.content.rating_record,
    );
    const original = await objectBytes(
      restored.root,
      JSON.parse(
        (await restored.call("show", { project: p, id: input.id })).meta,
      ),
    );
    assert.equal((await sharp(original).metadata()).width, 200);
    await fs.writeFile(
      path.join(process.env.RETOUCH_TEST_ROOT!, "native-issues-evidence.json"),
      JSON.stringify(
        {
          verdict: "PASS",
          issues: [3, 5, 6, 8, 9, 10],
          issue4: { mock: "PASS", real_service: "NOT_RUN" },
          image_ai_generation: "NOT_RUN",
          raw_rating: "8/10, no normalization",
          facts: "purpose and field gates; visual acceptance stays separate",
        },
        null,
        2,
      ),
    );
  },
);
