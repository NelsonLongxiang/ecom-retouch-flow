import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import sharp from "sharp";
import { NativeClient } from "../src/native/client.ts";
import { registerMedia, objectBytes } from "../src/native/files.ts";
import {
  registerExecutor,
  checkExecutor,
  executeApi,
  recoverApi,
  reconcileApiResult,
} from "../src/native/api.ts";
import { digest } from "../src/native/plugin/commands.mjs";
import { exportProject, importProject } from "../src/native/exchange.ts";
const entry = process.env.RETOUCH_TEST_YGL_ENTRY;
test(
  "显式 API fallback：授权、实际 multipart、单次提交、未知对账、原生恢复和凭证隔离",
  { skip: !entry, timeout: 300000 },
  async (t) => {
    const parent = await fs.mkdtemp(
        path.join(process.env.RETOUCH_TEST_ROOT!, "api-"),
      ),
      c = await NativeClient.initialize(path.join(parent, "home"), entry!);
    let mode = "success",
      count = 0,
      followed = 0;
    const observed: any[] = [];
    const result = await sharp({
        create: { width: 8, height: 8, channels: 4, background: "#aa2200" },
      })
        .png()
        .toBuffer(),
      large = await sharp({
        create: { width: 20, height: 20, channels: 4, background: "#aa2200" },
      })
        .png()
        .toBuffer();
    const secret = "fixture-credential-never-persisted";
    const server = http.createServer((req, res) => {
      void (async () => {
        if (req.url === "/must-not-follow") {
          followed++;
          res.end("forbidden");
          return;
        }
        count++;
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const request = new Request("http://localhost" + req.url, {
            method: "POST",
            headers: { "content-type": req.headers["content-type"]! },
            body: Buffer.concat(chunks),
          }),
          form = await request.formData();
        const images = form.getAll("image[]"),
          mask = form.get("mask") as File | null;
        observed.push({
          authorization: req.headers.authorization,
          model: form.get("model"),
          n: form.get("n"),
          prompt: form.get("prompt"),
          images: images.length,
          mask: mask ? Buffer.from(await mask.arrayBuffer()) : null,
        });
        res.setHeader("x-request-id", "req_fixture_" + count);
        res.setHeader("content-type", "application/json");
        if (mode === "redirect") {
          res.statusCode = 307;
          res.setHeader("location", "/must-not-follow");
          res.end();
          return;
        }
        if (mode === "refused") {
          res.statusCode = 401;
          res.end(
            JSON.stringify({
              error: { message: secret, code: "invalid_api_key" },
            }),
          );
          return;
        }
        if (mode === "timeout") {
          setTimeout(() => {
            if (!res.destroyed)
              res.end(
                JSON.stringify({
                  data: [{ b64_json: result.toString("base64") }],
                }),
              );
          }, 2300).unref();
          return;
        }
        if (mode === "url") {
          res.end(
            JSON.stringify({
              data: [{ url: "http://127.0.0.1/must-not-follow" }],
            }),
          );
          return;
        }
        if (mode === "limit") {
          res.setHeader("content-length", "2000000");
          res.end("{}");
          return;
        }
        res.end(
          JSON.stringify({
            data: [
              {
                b64_json: (mode === "mismatch" ? large : result).toString(
                  "base64",
                ),
              },
            ],
            usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
          }),
        );
      })().catch(() => {
        res.statusCode = 500;
        res.end("{}");
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    t.after(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const port = (server.address() as any).port,
      env = {
        RETOUCH_TEST_IMAGE_API_BASE: "http://127.0.0.1:" + port + "/v1",
        RETOUCH_TEST_IMAGE_API_KEY: secret,
      };
    let serial = 0;
    const call = (a: string, b: any) => c.call(a, b, "api-fixture-" + ++serial);
    const p = (
      await call("project-new", {
        name: "API 协议夹具",
        intent: "只验证本地模拟 API，不调用真实服务",
        tags: ["测试:API"],
      })
    ).project.id;
    const goal = (
      await call("goal-new", {
        project: p,
        title: "保持区",
        scope: "局部修改",
        preserve: ["区域外像素保持"],
        done_when: "检查实际候选",
        source: "synthetic fixture",
      })
    ).artifact;
    const profile = (
      await registerExecutor(
        c,
        p,
        {
          title: "本地模拟执行配置",
          profile: {
            schema: "retouch.api-profile/v1",
            protocol: "openai-images-edits/v1",
            base_env: "RETOUCH_TEST_IMAGE_API_BASE",
            credential_env: "RETOUCH_TEST_IMAGE_API_KEY",
            model: "fixture-image-model",
            allow_loopback_http: true,
            timeout_ms: 1000,
            response_limit_bytes: 1024,
          },
        },
        "profile",
        env,
      )
    ).profile;
    assert.equal((await checkExecutor(c, p, profile.id, env)).ready, true);
    assert.equal(count, 0);
    const source = path.join(parent, "input.png");
    await sharp({
      create: { width: 8, height: 8, channels: 4, background: "#ffffff" },
    })
      .png()
      .toFile(source);
    async function ready(
      approved = true,
      steps = 1,
      maxRequests = steps,
      withReference = false,
    ) {
      const task = (
        await call("task-new", {
          project: p,
          goal: goal.id,
          title: "API task " + serial,
          brief: "模拟服务测试",
          expected_output: "候选",
          done_when: "检查",
          kind: "image",
        })
      ).task;
      const input = (
        await registerMedia(
          c,
          p,
          task.id,
          source,
          { role: "original" },
          "input-" + task.id,
        )
      ).artifact;
      const planned = await call("plan", {
        project: p,
        task: task.id,
        input: input.id,
        expected_revision: 0,
        fallback: { profile_id: profile.id },
        steps: Array.from({ length: steps }, (_, i) => ({
          id: "s" + i,
          prompt: "只修改批准区域",
          needs: i ? ["s" + (i - 1)] : [],
          region: { x: i ? 5 : 1, y: 1, width: 2, height: 2 },
          coordinate_system: { width: 8, height: 8 },
          references: withReference
            ? [
                {
                  media_id: input.id,
                  purpose: "仅参考材质，不确认当前商品规格",
                },
              ]
            : [],
        })),
      });
      const terms = {
        ...JSON.parse(planned.plan.content).fallback,
        max_requests: maxRequests,
        cost_confirmation: "仅本地模拟服务的测试费用确认，无真实计费",
        upload_confirmation: "仅允许测试图发送给本机模拟服务",
      };
      const grantBody = {
        project: p,
        task: task.id,
        plan_id: planned.plan.id,
        plan_hash: planned.plan_hash,
        issuer: "host-human",
        confirmation: "合成协议夹具确认，不是真实业务用户授权",
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        ...(approved ? { api_fallback: terms } : {}),
      };
      const grant = (await call("grant", grantBody)).grant,
        run = (
          await call("run-start", {
            project: p,
            task: task.id,
            grant: grant.id,
          })
        ).execution;
      return { task, input, run, grantBody };
    }
    const unauthorized = await ready(false),
      before = count;
    await assert.rejects(
      executeApi(c, p, unauthorized.run.id, {
        profileId: profile.id,
        revision: 0,
        requestId: "unapproved",
        env,
      }),
      { code: "API_APPROVAL_REQUIRED" },
    );
    assert.equal(count, before);
    const local = await ready(true, 1, 1, true);
    await assert.rejects(
      executeApi(c, p, local.run.id, {
        profileId: profile.id,
        revision: 0,
        requestId: "missing-key",
        env: { ...env, RETOUCH_TEST_IMAGE_API_KEY: "" },
      }),
      { code: "API_CREDENTIAL_MISSING" },
    );
    await assert.rejects(
      executeApi(c, p, local.run.id, {
        profileId: profile.id,
        revision: 0,
        requestId: "drift",
        env: {
          ...env,
          RETOUCH_TEST_IMAGE_API_BASE:
            env.RETOUCH_TEST_IMAGE_API_BASE + "/different",
        },
      }),
      { code: "API_BINDING" },
    );
    assert.equal(count, before);
    const completed = await executeApi(c, p, local.run.id, {
      profileId: profile.id,
      revision: 0,
      requestId: "success",
      env,
    });
    assert.equal(
      JSON.parse(completed.execution.meta).status,
      "waiting_for_review",
    );
    assert.equal(completed.network, "RESPONSE_RECEIVED");
    assert.equal(completed.api_requests_submitted, 1);
    assert.equal(count, before + 1);
    assert.equal(observed.at(-1).authorization, "Bearer " + secret);
    assert.equal(observed.at(-1).n, "1");
    assert.equal(observed.at(-1).images, 2);
    assert.ok(observed.at(-1).prompt.includes("仅参考材质"));
    const mask = await sharp(observed.at(-1).mask)
      .ensureAlpha()
      .raw()
      .toBuffer();
    assert.equal(mask[(1 * 8 + 1) * 4 + 3], 0);
    assert.equal(mask[3], 255);
    const candidate = await c.call("show", {
        project: p,
        id: JSON.parse(completed.execution.meta).candidate,
      }),
      pixels = await sharp(
        await objectBytes(c.root, JSON.parse(candidate.meta)),
      )
        .ensureAlpha()
        .raw()
        .toBuffer();
    assert.deepEqual([...pixels.subarray(0, 4)], [255, 255, 255, 255]);
    assert.equal(pixels[(1 * 8 + 1) * 4], 170);
    const replayed = await executeApi(c, p, local.run.id, {
      profileId: profile.id,
      revision: 0,
      requestId: "success",
      env,
    });
    assert.equal(replayed.replayed, true);
    assert.equal(replayed.network, "NOT_RUN");
    assert.equal(count, before + 1);
    assert.equal((await recoverApi(c, p, local.run.id)).replayed, true);
    assert.equal(count, before + 1);
    const concurrent = await ready(),
      raceStart = count;
    const races = await Promise.allSettled([
      executeApi(c, p, concurrent.run.id, {
        profileId: profile.id,
        revision: 0,
        requestId: "race",
        env,
      }),
      executeApi(c, p, concurrent.run.id, {
        profileId: profile.id,
        revision: 0,
        requestId: "race",
        env,
      }),
    ]);
    assert.ok(races.some((r) => r.status === "fulfilled"));
    assert.equal(count, raceStart + 1);
    mode = "mismatch";
    const mismatch = await ready(),
      mismatchStart = count;
    await assert.rejects(
      executeApi(c, p, mismatch.run.id, {
        profileId: profile.id,
        revision: 0,
        requestId: "mismatch",
        env,
      }),
      { code: "API_LOCAL_RECOVERY_REQUIRED" },
    );
    const received = await c.call("show", { project: p, id: mismatch.run.id });
    assert.equal(JSON.parse(received.meta).status, "received");
    const raw = await c.call("show", {
      project: p,
      id: JSON.parse(received.meta).raw_output,
    });
    assert.equal(JSON.parse(raw.meta).width, 20);
    const fitted = await recoverApi(c, p, mismatch.run.id, { fitInput: true });
    assert.equal(
      JSON.parse(fitted.execution.meta).status,
      "waiting_for_review",
    );
    assert.equal(count, mismatchStart + 1);
    for (const [scenario, code, status] of [
      ["timeout", "API_TIMEOUT", "unknown"],
      ["redirect", "API_TRANSPORT_UNKNOWN", "unknown"],
      ["url", "API_RESPONSE_UNSUPPORTED", "unknown"],
      ["refused", "API_REJECTED", "failed"],
      ["limit", "API_RESPONSE_LIMIT", "unknown"],
    ]) {
      mode = scenario;
      const f = await ready(),
        n: number = count,
        key = "failure-" + scenario;
      await assert.rejects(
        executeApi(c, p, f.run.id, {
          profileId: profile.id,
          revision: 0,
          requestId: key,
          env,
        }),
        { code },
      );
      assert.equal(count, n + 1);
      const current = await c.call("show", { project: p, id: f.run.id });
      assert.equal(JSON.parse(current.meta).status, status);
      assert.equal(
        (
          await executeApi(c, p, f.run.id, {
            profileId: profile.id,
            revision: 0,
            requestId: key,
            env,
          })
        ).replayed,
        true,
      );
      assert.equal(count, n + 1);
      if (scenario === "url") {
        const late = path.join(parent, "late.png");
        await fs.writeFile(late, result);
        const reconciled = await reconcileApiResult(
          c,
          p,
          f.run.id,
          late,
          {
            operation_key: key,
            statement: "模拟提供商的原请求迟到结果",
            provider_request_id: "req_late",
          },
          JSON.parse(current.meta).revision,
        );
        assert.equal(
          JSON.parse(reconciled.execution.meta).status,
          "waiting_for_review",
        );
        const repeated = await reconcileApiResult(
          c,
          p,
          f.run.id,
          late,
          {
            operation_key: key,
            statement: "模拟提供商的原请求迟到结果",
            provider_request_id: "req_late",
          },
          JSON.parse(current.meta).revision,
        );
        assert.equal(repeated.replayed, true);
        assert.equal(count, n + 1);
      }
    }
    assert.equal(followed, 0);
    mode = "success";
    const budget = await ready(true, 2, 1);
    let run = (
      await executeApi(c, p, budget.run.id, {
        profileId: profile.id,
        revision: 0,
        requestId: "budget-first",
        env,
      })
    ).execution;
    const output = await c.call("show", {
      project: p,
      id: JSON.parse(run.meta).candidate,
    });
    run = (
      await call("run-review", {
        project: p,
        id: run.id,
        expected_revision: JSON.parse(run.meta).revision,
        sha256: JSON.parse(output.meta).sha256,
        verdict: "PASS",
        observations: "本地夹具检查",
        reviewer: "fixture",
        source: "synthetic fixture",
      })
    ).execution;
    const used = count;
    await assert.rejects(
      executeApi(c, p, run.id, {
        profileId: profile.id,
        revision: JSON.parse(run.meta).revision,
        requestId: "budget-denied",
        env,
      }),
      { code: "API_BUDGET" },
    );
    assert.equal(count, used);
    const fresh = (await call("grant", budget.grantBody)).grant;
    run = (
      await call("run-authorize", {
        project: p,
        id: run.id,
        grant: fresh.id,
        expected_revision: JSON.parse(run.meta).revision,
      })
    ).execution;
    const advanced = await executeApi(c, p, run.id, {
      profileId: profile.id,
      revision: JSON.parse(run.meta).revision,
      requestId: "budget-fresh-grant",
      env,
    });
    assert.equal(
      JSON.parse(advanced.execution.meta).status,
      "waiting_for_review",
    );
    assert.equal(count, used + 1);
    const gap = await ready(),
      gapCount = count;
    const nativeCall = c.call.bind(c);
    let failReceived = true;
    c.call = async (...args: Parameters<NativeClient["call"]>) => {
      if (args[0] === "run-api-received" && failReceived) {
        failReceived = false;
        throw new Error("synthetic native receipt failure");
      }
      return nativeCall(...args);
    };
    try {
      await assert.rejects(
        executeApi(c, p, gap.run.id, {
          profileId: profile.id,
          revision: 0,
          requestId: "persistence-gap",
          env,
        }),
        { code: "API_RESULT_PERSISTENCE" },
      );
    } finally {
      c.call = nativeCall;
    }
    assert.equal(count, gapCount + 1);
    assert.equal(
      JSON.parse((await c.call("show", { project: p, id: gap.run.id })).meta)
        .status,
      "unknown",
    );
    const gapZip = path.join(parent, "gap-context.zip");
    await exportProject(c, p, gapZip);
    const gapClone = await importProject(gapZip, c.root, {
        strategy: "clone",
        name: "API 持久化缺口克隆",
      }),
      cloneView = await c.call("brief", { project: gapClone.project_id });
    const clonedGap = cloneView.artifacts.find(
      (a: any) =>
        a.kind === "execution" &&
        JSON.parse(a.meta).api_intent?.operation_key === "persistence-gap",
    );
    assert.equal(
      JSON.parse(
        (await recoverApi(c, gapClone.project_id, clonedGap.id)).execution.meta,
      ).status,
      "waiting_for_review",
    );
    assert.equal(
      JSON.parse((await recoverApi(c, p, gap.run.id)).execution.meta).status,
      "waiting_for_review",
    );
    assert.equal(count, gapCount + 1);
    const portable = await ready();
    const snapshot = await c.call("snapshot", { project: p });
    assert.equal(JSON.stringify(snapshot).includes(secret), false);
    assert.ok(
      snapshot.tables.artifacts.some((a: any) => a.kind === "executor-profile"),
    );
    const zip = path.join(parent, "api-context.zip");
    await exportProject(c, p, zip);
    const target = path.join(parent, "restored");
    await importProject(zip, target, { entry });
    const restored = await NativeClient.open(target);
    const requestsBeforeRestore = count;
    await assert.rejects(
      executeApi(restored, p, portable.run.id, {
        profileId: profile.id,
        revision: 0,
        requestId: "restored-old-grant",
        env,
      }),
      { code: "GRANT_INVALID" },
    );
    assert.equal(count, requestsBeforeRestore);
    assert.equal(
      JSON.stringify(await restored.call("snapshot", { project: p })).includes(
        secret,
      ),
      false,
    );
    await fs.writeFile(
      path.join(process.env.RETOUCH_TEST_ROOT!, "native-api-evidence.json"),
      JSON.stringify({
        verdict: "PASS",
        transport: "LOCAL_HTTP_FIXTURE_ONLY",
        network_requests: count,
        redirect_followups: followed,
        assertions: [
          "explicit approval required",
          "base/key preflight no network",
          "multipart image and transparent mask",
          "single call and replay",
          "concurrent dispatch at most once",
          "raw dimensions preserved and local fit recovery",
          "timeouts and unsupported responses remain unknown",
          "known rejection retained",
          "late result reconciled without network",
          "per-grant request budget",
          "ZIP contains no credentials",
        ],
        real_image_service: "NOT_RUN",
        paid_api_calls: "NOT_RUN",
      }),
    );
  },
);
