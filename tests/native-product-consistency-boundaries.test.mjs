import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";

const taskRoot = process.env.RETOUCH_TEST_ROOT;
assert.ok(
  taskRoot,
  "Use the maintained project test runner with an isolated run root",
);
const entry = process.env.RETOUCH_TEST_YGL_ENTRY;
// Unit-only runs explicitly skip native integration, as do the other native fixtures.
const sharp = (await import("sharp")).default;
const { outputFixture } = await import("./helpers/output-fixture.ts");
const { registerProductConsistency, checkProductItems } = await import(
  "./helpers/product-consistency-fixture.ts"
);
const { registerBytes, objectBytes } = await import("../src/native/files.ts");
const { registerExecutor, executeApi } = await import("../src/native/api.ts");
const { transform } = await import("../src/native/postprocess.ts");
const { digest } = await import("../src/native/plugin/commands.mjs");
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const record = (name, value) =>
  fs.writeFile(
    path.join(taskRoot, name + ".json"),
    JSON.stringify(value, null, 2) + "\n",
    { flag: "wx" },
  );
const taskRevision = async (f) =>
  (await f.c.call("task-view", { project: f.p, id: f.task.id })).task.meta
    .retouch.revision;

// Scope: one node:test invocation, three bounded cases. Only loopback synthetic
// service and disposable native workspaces; no real image service or business media.
test(
  "product18 boundary: actual multipart carries normalized master and fixed structure role exactly once",
  { skip: !entry, timeout: 600000 },
  async (t) => {
    const f = await outputFixture({ retainRequests: true });
    const master = await f.image(8, 8, "#bd6a35", "independent-master");
    const old = await f.image(16, 16, "#335577", "independent-old-image");
    const q = await registerProductConsistency(
      f.c,
      f.p,
      f.task.id,
      master,
      "reference",
      "independent-api",
    );
    const response = await sharp({
      create: { width: 16, height: 16, channels: 4, background: "#7799aa" },
    })
      .png()
      .toBuffer();
    const observed = [];
    let receivedRequests = 0;
    const captureErrors = [];
    const server = http.createServer((req, res) => {
      const requestIndex = receivedRequests++;
      const captureName = (name) => `multipart-${requestIndex}-${name}`;
      void (async () => {
        const chunks = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const rawBody = Buffer.concat(chunks);
        await fs.writeFile(
          path.join(taskRoot, captureName("request.bin")),
          rawBody,
          { flag: "wx" },
        );
        await record(captureName("headers"), {
          url: req.url,
          content_type: req.headers["content-type"],
          bytes: rawBody.length,
          sha256: sha(rawBody),
        });
        const request = new Request("http://localhost" + req.url, {
          method: "POST",
          headers: { "content-type": req.headers["content-type"] },
          body: rawBody,
        });
        const form = await request.formData();
        const images = [];
        for (const image of form.getAll("image[]"))
          images.push(Buffer.from(await image.arrayBuffer()));
        await fs.writeFile(
          path.join(taskRoot, captureName("prompt.txt")),
          String(form.get("prompt")),
          { flag: "wx" },
        );
        for (let i = 0; i < images.length; i++)
          await fs.writeFile(
            path.join(taskRoot, captureName("image-" + i + ".png")),
            images[i],
            { flag: "wx" },
          );
        const parts = [];
        let partIndex = 0;
        for (const [name, value] of form.entries()) {
          const bytes =
            typeof value === "string"
              ? Buffer.from(value, "utf8")
              : Buffer.from(await value.arrayBuffer());
          const saved = captureName("part-" + partIndex + ".bin");
          await fs.writeFile(path.join(taskRoot, saved), bytes, { flag: "wx" });
          parts.push({
            index: partIndex++,
            name,
            type: typeof value === "string" ? "text" : value.type,
            filename: typeof value === "string" ? null : value.name,
            bytes: bytes.length,
            sha256: sha(bytes),
            file: saved,
          });
        }
        await record(captureName("parts"), parts);
        observed.push({
          url: req.url,
          content_type: req.headers["content-type"],
          rawBody,
          prompt: String(form.get("prompt")),
          model: form.get("model"),
          images,
          mask: form.has("mask"),
        });
        res.setHeader("content-type", "application/json");
        res.setHeader("x-request-id", "independent-loopback18");
        res.end(
          JSON.stringify({ data: [{ b64_json: response.toString("base64") }] }),
        );
      })().catch(async (error) => {
        captureErrors.push({
          request_index: requestIndex,
          message: String(error),
        });
        await record(captureName("capture-error"), {
          message: String(error),
        }).catch((saveError) =>
          captureErrors.push({
            request_index: requestIndex,
            evidence_error: String(saveError),
          }),
        );
        observed.push({ handler_error: String(error) });
        res.statusCode = 500;
        res.end("{}");
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    });
    const port = server.address().port;
    const env = {
      RETOUCH_TEST_IMAGE_API_BASE: "http://127.0.0.1:" + port + "/v1",
      RETOUCH_TEST_IMAGE_API_KEY: "synthetic18-never-a-business-credential",
    };
    const profile = (
      await registerExecutor(
        f.c,
        f.p,
        {
          title: "Independent loopback18",
          profile: {
            schema: "retouch.api-profile/v1",
            protocol: "openai-images-edits/v1",
            base_env: "RETOUCH_TEST_IMAGE_API_BASE",
            credential_env: "RETOUCH_TEST_IMAGE_API_KEY",
            model: "fixture-product18",
            allow_loopback_http: true,
            timeout_ms: 5000,
            response_limit_bytes: 1048576,
          },
        },
        "independent-api-profile",
        env,
      )
    ).profile;
    const prepare = (refs) =>
      f.call("plan", {
        project: f.p,
        task: f.task.id,
        input: old.id,
        expected_revision: preparedRevision,
        purpose: "product-accurate",
        fallback: { profile_id: profile.id },
        steps: [
          {
            id: "edit",
            prompt:
              "Use the current synthetic master for structure; environment only from old image.",
            needs: [],
            references: refs,
          },
        ],
      });
    const preparedRevision = await taskRevision(f);
    await assert.rejects(prepare([]), { code: "PRODUCT_REFERENCE_REQUIRED" });
    await assert.rejects(
      prepare([
        {
          media_id: master.id,
          role: "product-structure",
          purpose: "colour only",
        },
      ]),
      { code: "PRODUCT_REFERENCE_ROLE" },
    );
    assert.equal(
      observed.length,
      0,
      "missing or conflicting master must not reach HTTP",
    );
    const planned = await prepare([
      {
        media_id: master.id,
        role: "product-structure",
        purpose: "product-structure",
      },
    ]);
    const plan = JSON.parse(planned.plan.content);
    const grant = (
      await f.call("grant", {
        project: f.p,
        task: f.task.id,
        plan_id: planned.plan.id,
        plan_hash: planned.plan_hash,
        issuer: "host-human",
        confirmation:
          "ISOLATED synthetic loopback test; not real execution permission",
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        api_fallback: {
          ...plan.fallback,
          max_requests: 1,
          cost_confirmation: "no paid service; local synthetic only",
          upload_confirmation: "synthetic pixels to local loopback only",
        },
      })
    ).grant;
    const run = (
      await f.call("run-start", {
        project: f.p,
        task: f.task.id,
        grant: grant.id,
      })
    ).execution;
    await executeApi(f.c, f.p, run.id, {
      profileId: profile.id,
      revision: 0,
      requestId: "independent18-http-once",
      env,
    });
    assert.equal(receivedRequests, 1);
    assert.deepEqual(captureErrors, []);
    assert.equal(observed.length, 1);
    const sent = observed[0];
    assert.equal(sent.handler_error, undefined);
    assert.equal(sent.images.length, 2);
    assert.equal(sent.mask, false);
    assert.equal(sent.model, "fixture-product18");
    const expectedSection =
      "第一张图为编辑目标。第 2 张图为当前SKU结构母版，必须用于可见结构约束；此固定职责不可被其他说明降级。";
    assert.equal(
      sent.prompt.replaceAll("\r\n", "\n").split("\n\n").at(-2),
      expectedSection,
    );
    assert.equal(
      sent.prompt.split(expectedSection).length - 1,
      1,
      "fixed structure role must occur exactly once",
    );
    const normalizedPrompt = sent.prompt.replaceAll("\r\n", "\n");
    await record("multipart-prompt-comparison", {
      raw_sha256: sha(Buffer.from(sent.prompt)),
      normalized_sha256: sha(Buffer.from(normalizedPrompt)),
      raw_crlf_count: (sent.prompt.match(/\r\n/g) || []).length,
      rule: "CRLF to LF only; no trim or whitespace folding",
    });
    assert.equal(sent.prompt.includes("colour only"), false);
    const actualRun = await f.c.call("show", { project: f.p, id: run.id });
    const intent = JSON.parse(actualRun.meta).api_intent;
    const uploadIds = [
      intent.uploads.input_id,
      ...intent.uploads.reference_ids,
    ];
    const parentIds = [old.id, master.id];
    const mapping = [];
    for (let i = 0; i < uploadIds.length; i++) {
      const media = await f.c.call("show", { project: f.p, id: uploadIds[i] });
      const m = JSON.parse(media.meta);
      assert.ok(m.parents.includes(parentIds[i]));
      assert.equal(sha(sent.images[i]), m.sha256);
      assert.deepEqual(sent.images[i], await objectBytes(f.c.root, m));
      mapping.push({
        upload_media_id: media.id,
        original_media_id: parentIds[i],
        upload_sha256: m.sha256,
      });
    }
    const masterPixels = await sharp(
      await objectBytes(f.c.root, JSON.parse(master.meta)),
    )
      .toColourspace("srgb")
      .ensureAlpha()
      .raw()
      .toBuffer();
    const uploadedPixels = await sharp(sent.images[1])
      .toColourspace("srgb")
      .ensureAlpha()
      .raw()
      .toBuffer();
    assert.deepEqual(uploadedPixels, masterPixels);
    const replayBefore = await f.c.call("snapshot", { project: f.p });
    await executeApi(f.c, f.p, run.id, {
      profileId: profile.id,
      revision: 0,
      requestId: "independent18-http-once",
      env: {},
    });
    const replayAfter = await f.c.call("snapshot", { project: f.p });
    assert.deepEqual(
      replayAfter,
      replayBefore,
      "replay must not append attempts, artifacts, or business events",
    );
    assert.equal(
      observed.length,
      1,
      "replay must not call the loopback provider twice",
    );
    assert.equal(
      receivedRequests,
      1,
      "replay must not initiate any extra HTTP request, including failed captures",
    );
    assert.deepEqual(captureErrors, []);
    const outcome = {
      case: "actual-multipart",
      content_type: sent.content_type,
      raw_request_sha256: sha(sent.rawBody),
      requests: 1,
      missing_master_refused: true,
      conflicting_purpose_refused: true,
      fixed_reference_section: expectedSection,
      image_count: sent.images.length,
      mapping,
      normalized_master_pixels_exact: true,
      contract_id: q.contract.id,
      replay_no_network: true,
      real_image_requests: 0,
    };
    await record("multipart-observation", outcome);
    console.log(JSON.stringify({ product18_boundary: outcome }));
  },
);

async function protectedFixture(suffix) {
  const f = await outputFixture({ retainRequests: true });
  const master = await f.image(8, 8, "#bd6a35", "protected-master-" + suffix);
  const base = await f.image(
    16,
    16,
    "#335577",
    "protected-background-" + suffix,
  );
  const q = await registerProductConsistency(
    f.c,
    f.p,
    f.task.id,
    master,
    "protected-layer",
    "independent-" + suffix,
  );
  await f.call("plan", {
    project: f.p,
    task: f.task.id,
    input: base.id,
    expected_revision: await taskRevision(f),
    purpose: "product-accurate",
    steps: [
      {
        id: "environment",
        prompt: "Synthetic environment proposal; no model called.",
        needs: [],
      },
    ],
  });
  const inputs = [base, master, q.mask].map((a) => ({
    id: a.id,
    sha256: JSON.parse(a.meta).sha256,
    role:
      a.id === base.id
        ? "environment"
        : a.id === master.id
          ? "qualified-product"
          : "reviewed-product-alpha",
  }));
  const operation = {
    op: "product-composite",
    contract_id: q.contract.id,
    contract_version: q.contract.version,
    contract_hash: digest(q.contract.content),
    recipe_id: "png",
    x: 4,
    y: 4,
    width: 8,
    height: 8,
    encoding: { format: "png" },
  };
  const final = (
    await transform(
      f.c,
      f.p,
      f.task.id,
      { input_id: base.id, inputs, operations: [operation] },
      await taskRevision(f),
      "protected-final-" + suffix,
    )
  ).artifact;
  return { f, master, base, q, final };
}

test(
  "product18 boundary: a late required FAIL blocks native delivery completion and leaves no receipt",
  { skip: !entry, timeout: 600000 },
  async () => {
    const { f, q, final } = await protectedFixture("late-finalization");
    await checkProductItems(f.c, f.p, final, q.contract, "initial-items-pass");
    await f.call("media-review", {
      project: f.p,
      id: final.id,
      sha256: JSON.parse(final.meta).sha256,
      verdict: "PASS",
      accepted: true,
      source: "user",
      reviewer: "synthetic-fixture-user",
      observations: "synthetic native acceptance only; no business image",
    });
    const delivery = (
      await f.call("delivery-prepare", {
        project: f.p,
        id: final.id,
        directory: path.join(f.parent, "late-delivery"),
      })
    ).delivery;
    await checkProductItems(
      f.c,
      f.p,
      final,
      q.contract,
      "late-required-fail",
      "FAIL",
    );
    const before = await f.c.call("snapshot", { project: f.p });
    await assert.rejects(
      f.c.call(
        "delivery-complete",
        { project: f.p, id: delivery.id, manifest_sha256: "a".repeat(64) },
        "independent18-late-complete",
      ),
      { code: "INVARIANTS_PENDING" },
    );
    const after = await f.c.call("snapshot", { project: f.p });
    assert.deepEqual(
      after,
      before,
      "failed finalization must not change native state or events",
    );
    const actual = await f.c.call("show", { project: f.p, id: delivery.id });
    assert.equal(JSON.parse(actual.meta).status, "preparing");
    assert.deepEqual(
      await f.c.call("receipt", { request_id: "independent18-late-complete" }),
      {},
    );
    const outcome = {
      case: "late-finalization",
      late_required_verdict: "FAIL",
      code: "INVARIANTS_PENDING",
      native_status: "preparing",
      snapshot_unchanged: true,
      completion_receipt: false,
      actual_final_sha256: JSON.parse(final.meta).sha256,
      real_image_requests: 0,
    };
    await record("late-finalization-observation", outcome);
    console.log(JSON.stringify({ product18_boundary: outcome }));
  },
);

test(
  "product18 boundary: proof cannot move to an equal-byte media ID or a mismatched renderer execution",
  { skip: !entry, timeout: 600000 },
  async () => {
    const { f, q, final } = await protectedFixture("renderer-object");
    const fm = JSON.parse(final.meta),
      bytes = await objectBytes(f.c.root, fm);
    const foreign = (
      await registerBytes(
        f.c,
        f.p,
        f.task.id,
        bytes,
        { role: "postprocess", parents: fm.parents, transform: fm.transform },
        "equal-byte-wrong-media",
      )
    ).artifact;
    await checkProductItems(
      f.c,
      f.p,
      foreign,
      q.contract,
      "foreign-items-pass",
    );
    await assert.rejects(
      f.call("media-review", {
        project: f.p,
        id: foreign.id,
        sha256: JSON.parse(foreign.meta).sha256,
        verdict: "PASS",
        accepted: true,
        reviewer: "synthetic-fixture-user",
        source: "user",
        observations: "proof must bind exact output object, not only hash",
      }),
      { code: "PRODUCT_PROTECTION_REQUIRED" },
    );
    const goodExecution = await f.c.call("show", {
      project: f.p,
      id: fm.transform.execution_id,
    });
    const descriptor = JSON.parse(goodExecution.content);
    descriptor.renderer.versions = {
      ...descriptor.renderer.versions,
      vips: "independent-invalid-version",
    };
    const prepared = (
      await f.c.call(
        "postprocess-prepare",
        {
          project: f.p,
          task: f.task.id,
          expected_revision: await taskRevision(f),
          descriptor,
        },
        "renderer-drift-prepare",
      )
    ).execution;
    const fakeTransform = {
      ...fm.transform,
      execution_id: prepared.id,
      renderer: descriptor.renderer,
    };
    const fake = (
      await registerBytes(
        f.c,
        f.p,
        f.task.id,
        bytes,
        { role: "postprocess", parents: fm.parents, transform: fakeTransform },
        "renderer-drift-media",
      )
    ).artifact;
    const before = await f.c.call("snapshot", { project: f.p });
    await assert.rejects(
      f.c.call(
        "postprocess-complete",
        { project: f.p, id: prepared.id, output: fake.id },
        "renderer-drift-complete",
      ),
      { code: "PRODUCT_RENDERER_DRIFT" },
    );
    assert.deepEqual(await f.c.call("snapshot", { project: f.p }), before);
    assert.equal(
      JSON.parse(
        (await f.c.call("show", { project: f.p, id: prepared.id })).meta,
      ).status,
      "prepared",
    );
    assert.deepEqual(
      await f.c.call("receipt", { request_id: "renderer-drift-complete" }),
      {},
    );
    const outcome = {
      case: "renderer-object",
      equal_bytes_new_media_rejected: true,
      wrong_media_code: "PRODUCT_PROTECTION_REQUIRED",
      renderer_drift_code: "PRODUCT_RENDERER_DRIFT",
      failed_complete_snapshot_unchanged: true,
      failed_execution_status: "prepared",
      completion_receipt: false,
      real_image_requests: 0,
    };
    await record("renderer-object-observation", outcome);
    console.log(JSON.stringify({ product18_boundary: outcome }));
  },
);
