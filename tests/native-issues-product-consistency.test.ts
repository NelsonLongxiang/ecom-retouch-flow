import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { outputFixture } from "./helpers/output-fixture.ts";
import {
  registerProductConsistency,
  checkProductItems,
} from "./helpers/product-consistency-fixture.ts";
import {
  registerBytes,
  objectBytes,
  completeRun,
  resizeMedia,
} from "../src/native/files.ts";
import { transform } from "../src/native/postprocess.ts";
import { digest } from "../src/native/plugin/commands.mjs";
import { apiPrompt } from "../src/native/plugin/api-contract.mjs";
import {
  exportProject,
  importProject,
  inspectProject,
} from "../src/native/exchange.ts";
import { NativeClient } from "../src/native/client.ts";
const entry = process.env.RETOUCH_TEST_YGL_ENTRY;
const options = { skip: !entry, timeout: 600000 };
test(
  "#18: product-accurate planning refuses a missing current-SKU consistency contract",
  options,
  async () => {
    const f = await outputFixture(),
      input = await f.image(8, 8, "#557799", "product18-input");
    await assert.rejects(
      f.call("plan", {
        project: f.p,
        task: f.task.id,
        input: input.id,
        expected_revision: 0,
        purpose: "product-accurate",
        steps: [{ id: "edit", prompt: "preserve current product", needs: [] }],
      }),
      { code: "PRODUCT_CONTRACT_REQUIRED" },
    );
    const accurate = (
      await f.call("task-new", {
        project: f.p,
        goal: (await f.c.call("task-view", { project: f.p, id: f.task.id }))
          .task.meta.retouch.goal_id,
        title: "No-plan accurate task",
        brief: "synthetic missing contract",
        kind: "image",
        purpose: "product-accurate",
        expected_output: "not accepted without contract",
        done_when: "fixture",
      })
    ).task;
    const candidate = (
      await registerBytes(
        f.c,
        f.p,
        accurate.id,
        await sharp({
          create: { width: 4, height: 4, channels: 4, background: "#445566" },
        })
          .png()
          .toBuffer(),
        { role: "candidate" },
        "no-plan-candidate",
      )
    ).artifact;
    await assert.rejects(
      f.call("media-review", {
        project: f.p,
        id: candidate.id,
        sha256: JSON.parse(candidate.meta).sha256,
        verdict: "PASS",
        accepted: true,
        source: "user",
        reviewer: "fixture-user",
        observations: "must not bypass via no plan",
      }),
      { code: "PRODUCT_CONTRACT_REQUIRED" },
    );
    await assert.rejects(
      f.call("plan", {
        project: f.p,
        task: accurate.id,
        input: candidate.id,
        expected_revision: 0,
        purpose: "concept",
        steps: [{ id: "bypass", prompt: "implicit downgrade", needs: [] }],
      }),
      { code: "PRODUCT_PURPOSE_DOWNGRADE" },
    );
  },
);
test(
  "#18: registered or colour-only master is not request completeness; exact structure input/reference is frozen",
  options,
  async () => {
    const f = await outputFixture(),
      master = await f.image(8, 8, "#aa6633", "master"),
      old = await f.image(16, 16, "#335577", "old-generated");
    const q = await registerProductConsistency(
      f.c,
      f.p,
      f.task.id,
      master,
      "reference",
      "reference",
    );
    const revision = async () =>
      (await f.c.call("task-view", { project: f.p, id: f.task.id })).task.meta
        .retouch.revision;
    const unreliable = (
      await f.call("document", {
        project: f.p,
        task: f.task.id,
        kind: "spec",
        title: "Unreliable master inference",
        role: "agent-interpretation",
        source: "synthetic counterexample",
        content: q.basis.content,
      })
    ).artifact;
    await assert.rejects(
      f.call("invariants-set", {
        project: f.p,
        task: f.task.id,
        expected_revision: await revision(),
        invariants: {
          schema: "retouch.invariants/v1",
          items: q.items,
          product_consistency: {
            ...q.consistency,
            basis: {
              ...q.consistency.basis,
              artifact_id: unreliable.id,
              version: unreliable.version,
              content_hash: digest(unreliable.content),
            },
          },
        },
      }),
      { code: "PRODUCT_MASTER_QUALIFICATION" },
    );
    const plan = (refs: any[], input = old.id, input_role?: string) =>
      f.call("plan", {
        project: f.p,
        task: f.task.id,
        input,
        expected_revision: awaitedRevision,
        purpose: "product-accurate",
        steps: [
          {
            id: "edit",
            prompt: "synthetic structure edit",
            needs: [],
            references: refs,
            ...(input_role ? { input_role } : {}),
          },
        ],
      });
    let awaitedRevision = await revision();
    await assert.rejects(plan([]), { code: "PRODUCT_REFERENCE_REQUIRED" });
    await assert.rejects(
      plan([{ media_id: master.id, purpose: "colour only" }]),
      { code: "PRODUCT_REFERENCE_REQUIRED" },
    );
    await assert.rejects(
      plan([
        {
          media_id: master.id,
          purpose: "colour only",
          role: "product-structure",
        },
      ]),
      { code: "PRODUCT_REFERENCE_ROLE" },
    );
    const planned = await plan([
      {
        media_id: master.id,
        purpose: "product-structure",
        role: "product-structure",
      },
    ]);
    const frozen = JSON.parse(planned.plan.content);
    assert.equal(frozen.product_contract.contract_id, q.contract.id);
    const compiled = apiPrompt(frozen.steps[0], [], []);
    const expectedReferences =
      "第一张图为编辑目标。第 2 张图为当前SKU结构母版，必须用于可见结构约束；此固定职责不可被其他说明降级。";
    assert.equal(compiled.split("\n\n").at(-2), expectedReferences);
    const conflicting = apiPrompt(
      {
        ...frozen.steps[0],
        references: [
          {
            media_id: master.id,
            role: "product-structure",
            purpose: "colour only",
          },
        ],
      },
      [],
      [],
    );
    assert.equal(conflicting.split("\n\n").at(-2), expectedReferences);
    assert.equal(conflicting.includes("colour only"), false);
    assert.equal(
      frozen.product_contract.content_hash,
      digest(q.contract.content),
    );
    const grant = (
      await f.call("grant", {
        project: f.p,
        task: f.task.id,
        plan_id: planned.plan.id,
        plan_hash: planned.plan_hash,
        issuer: "host-human",
        confirmation: "SYNTHETIC no actual tool call",
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      })
    ).grant;
    const run = (
      await f.call("run-start", {
        project: f.p,
        task: f.task.id,
        grant: grant.id,
      })
    ).execution;
    const dispatched = await f.c.call(
      "run-dispatch",
      { project: f.p, id: run.id, expected_revision: 0 },
      "product-reference-dispatch",
    );
    assert.equal(dispatched.allow_execute, true);
    assert.equal(dispatched.job.references[0].id, master.id);
    assert.equal(
      dispatched.job.references[0].reference_role,
      "product-structure",
    );
    assert.deepEqual(dispatched.job.product_contract, frozen.product_contract);
    const replay = await f.c.call(
      "run-dispatch",
      { project: f.p, id: run.id, expected_revision: 0 },
      "product-reference-dispatch",
    );
    assert.equal(replay.replayed, true);
    assert.equal(
      replay.allow_execute === true && replay.replayed !== true,
      false,
    );
  },
);
test(
  "#18: protected product final bytes reject occlusion/forged proof/later derivative and survive native ZIP/clone",
  options,
  async () => {
    const f = await outputFixture(),
      master = await f.image(8, 8, "#bb6633", "protected-master"),
      background = await f.image(16, 16, "#335577", "environment-input");
    const front = (
      await registerBytes(
        f.c,
        f.p,
        f.task.id,
        await sharp({
          create: { width: 16, height: 16, channels: 4, background: "#ffffff" },
        })
          .png()
          .toBuffer(),
        { role: "reference" },
        "opaque-foreground",
      )
    ).artifact;
    const q = await registerProductConsistency(
      f.c,
      f.p,
      f.task.id,
      master,
      "protected-layer",
      "protected",
      front,
    );
    const revision = async () =>
      (await f.c.call("task-view", { project: f.p, id: f.task.id })).task.meta
        .retouch.revision;
    await assert.rejects(
      f.call("invariants-set", {
        project: f.p,
        task: f.task.id,
        expected_revision: await revision(),
        invariants: {
          schema: "retouch.invariants/v1",
          items: q.items,
          product_consistency: {
            ...q.consistency,
            allowed_changes: [
              ...q.consistency.allowed_changes,
              {
                kind: "lighting",
                conditions: "not implemented by protected renderer",
              },
            ],
          },
        },
      }),
      { code: "PRODUCT_TRANSFORM_UNSUPPORTED" },
    );
    const planned = await f.call("plan", {
      project: f.p,
      task: f.task.id,
      input: background.id,
      expected_revision: await revision(),
      purpose: "product-accurate",
      steps: [
        {
          id: "environment",
          prompt: "generate environment only; product restored locally",
          needs: [],
        },
      ],
    });
    const grant = (
      await f.call("grant", {
        project: f.p,
        task: f.task.id,
        plan_id: planned.plan.id,
        plan_hash: planned.plan_hash,
        issuer: "host-human",
        confirmation: "SYNTHETIC no model invocation",
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      })
    ).grant;
    const run = (
      await f.call("run-start", {
        project: f.p,
        task: f.task.id,
        grant: grant.id,
      })
    ).execution;
    const dispatched = await f.call("run-dispatch", {
      project: f.p,
      id: run.id,
      expected_revision: 0,
    });
    assert.equal(dispatched.allow_execute, true);
    assert.equal(dispatched.job.references.length, 0);
    const rawBytes = await sharp({
      create: { width: 16, height: 16, channels: 4, background: "#557799" },
    })
      .png()
      .toBuffer();
    const raw = (
      await registerBytes(
        f.c,
        f.p,
        f.task.id,
        rawBytes,
        {
          role: "model-output",
          parents: [background.id],
          operation: "synthetic raw environment, no product lock",
        },
        "protected-raw",
      )
    ).artifact;
    const op = (format = "png"): any => ({
      op: "product-composite",
      recipe_id: format,
      contract_id: q.contract.id,
      contract_version: q.contract.version,
      contract_hash: digest(q.contract.content),
      x: 4,
      y: 4,
      width: 8,
      height: 8,
      encoding:
        format === "jpeg"
          ? { format, quality: 90, background: "#ffffff" }
          : { format },
    });
    const inputs = [raw, master, q.mask].map((a) => ({
      id: a.id,
      sha256: JSON.parse(a.meta).sha256,
      role:
        a.id === raw.id
          ? "environment"
          : a.id === master.id
            ? "qualified-product"
            : "reviewed-product-alpha",
    }));
    const final = (
      await transform(
        f.c,
        f.p,
        f.task.id,
        { input_id: raw.id, inputs, operations: [op()] },
        await revision(),
        "product-final-png",
      )
    ).artifact;
    const rawFile = path.join(f.parent, "raw.png");
    await fs.writeFile(rawFile, rawBytes);
    const completed = await completeRun(
      f.c,
      f.p,
      run.id,
      rawFile,
      1,
      "product-complete",
      {
        tool: "fixture",
        tool_receipt: "synthetic only",
        raw_output_id: raw.id,
        processed_output_id: final.id,
      },
    );
    assert.equal(JSON.parse(completed.execution.meta).candidate, final.id);
    await checkProductItems(f.c, f.p, final, q.contract, "final-invariants");
    await f.call("media-review", {
      project: f.p,
      id: final.id,
      sha256: JSON.parse(final.meta).sha256,
      verdict: "PASS",
      accepted: true,
      reviewer: "fixture-user",
      source: "user",
      observations:
        "synthetic accepted final PNG; not a real business acceptance",
    });
    const pendingDelivery = (
      await f.call("delivery-prepare", {
        project: f.p,
        id: final.id,
        directory: path.join(f.parent, "pending-delivery"),
      })
    ).delivery;
    await checkProductItems(
      f.c,
      f.p,
      final,
      q.contract,
      "late-unknown",
      "UNKNOWN",
    );
    await assert.rejects(
      f.call("delivery-complete", {
        project: f.p,
        id: pendingDelivery.id,
        manifest_sha256: "a".repeat(64),
      }),
      { code: "INVARIANTS_PENDING" },
    );
    assert.equal(
      JSON.parse(
        (await f.c.call("show", { project: f.p, id: pendingDelivery.id })).meta,
      ).status,
      "preparing",
    );
    await checkProductItems(
      f.c,
      f.p,
      final,
      q.contract,
      "restore-pass-after-unknown",
    );
    const jpeg = (
      await transform(
        f.c,
        f.p,
        f.task.id,
        { input_id: raw.id, inputs, operations: [op("jpeg")] },
        await revision(),
        "product-final-jpeg",
      )
    ).artifact;
    await checkProductItems(f.c, f.p, jpeg, q.contract, "jpeg-invariants");
    await f.call("media-review", {
      project: f.p,
      id: jpeg.id,
      sha256: JSON.parse(jpeg.meta).sha256,
      verdict: "PASS",
      accepted: true,
      reviewer: "fixture-user",
      source: "user",
      observations: "synthetic final JPEG rebuilt with frozen encoder",
    });
    await assert.rejects(
      transform(
        f.c,
        f.p,
        f.task.id,
        {
          input_id: raw.id,
          inputs: [
            ...inputs,
            {
              id: front.id,
              sha256: JSON.parse(front.meta).sha256,
              role: "foreground",
            },
          ],
          operations: [
            { ...op(), recipe_id: "occluded", foreground_id: front.id },
          ],
        },
        await revision(),
        "occluded-product",
      ),
      { code: "PRODUCT_VISIBLE_REGION" },
    );
    await assert.rejects(
      transform(
        f.c,
        f.p,
        f.task.id,
        { input_id: raw.id, inputs, operations: [{ ...op(), x: 3 }] },
        await revision(),
        "unapproved-placement",
      ),
      { code: "PRODUCT_COMPOSITION" },
    );
    const changed = (
      await resizeMedia(f.c, f.p, final.id, 12, 12, "after-product-resize")
    ).artifact;
    await checkProductItems(
      f.c,
      f.p,
      changed,
      q.contract,
      "changed-invariants",
    );
    await assert.rejects(
      f.call("media-review", {
        project: f.p,
        id: changed.id,
        sha256: JSON.parse(changed.meta).sha256,
        verdict: "PASS",
        accepted: true,
        reviewer: "fixture-user",
        source: "user",
        observations: "must not inherit intermediate proof",
      }),
      { code: "PRODUCT_PROTECTION_REQUIRED" },
    );
    const goodExecution = await f.c.call("show", {
      project: f.p,
      id: JSON.parse(final.meta).transform.execution_id,
    });
    const descriptor = JSON.parse(goodExecution.content);
    const prepared = (
      await f.c.call(
        "postprocess-prepare",
        {
          project: f.p,
          task: f.task.id,
          expected_revision: await revision(),
          descriptor,
        },
        "forged-prepare",
      )
    ).execution;
    const fakeTrace = {
      ...JSON.parse(final.meta).transform,
      execution_id: prepared.id,
    };
    const fakeBytes = (
      await registerBytes(
        f.c,
        f.p,
        f.task.id,
        rawBytes,
        {
          role: "postprocess",
          parents: JSON.parse(final.meta).parents,
          transform: fakeTrace,
        },
        "forged-complete-media",
      )
    ).artifact;
    await assert.rejects(
      f.c.call(
        "postprocess-complete",
        { project: f.p, id: prepared.id, output: fakeBytes.id },
        "forged-complete",
      ),
      { code: "PRODUCT_PIXELS" },
    );
    assert.equal(
      JSON.parse(
        (await f.c.call("show", { project: f.p, id: prepared.id })).meta,
      ).status,
      "prepared",
    );
    const forged = (
      await registerBytes(
        f.c,
        f.p,
        f.task.id,
        rawBytes,
        {
          role: "postprocess",
          parents: JSON.parse(final.meta).parents,
          transform: JSON.parse(final.meta).transform,
        },
        "forged-final",
      )
    ).artifact;
    await checkProductItems(f.c, f.p, forged, q.contract, "forged-invariants");
    await assert.rejects(
      f.call("media-review", {
        project: f.p,
        id: forged.id,
        sha256: JSON.parse(forged.meta).sha256,
        verdict: "PASS",
        accepted: true,
        reviewer: "fixture-user",
        source: "user",
        observations: "parents/trace are not final pixel protection",
      }),
      { code: "PRODUCT_PROTECTION_REQUIRED" },
    );
    const zip = path.join(f.parent, "protected-context.zip");
    await exportProject(f.c, f.p, zip);
    const inspected = await inspectProject(zip);
    assert.ok(
      inspected.manifest.requires.includes("retouch-product-consistency/v1"),
    );
    const restoredHome = path.join(f.parent, "restored");
    await importProject(zip, restoredHome, { entry: entry! });
    const restored = await NativeClient.open(restoredHome);
    const restoredFinal = await restored.call("show", {
      project: f.p,
      id: final.id,
    });
    assert.deepEqual(
      await objectBytes(restored.root, JSON.parse(restoredFinal.meta)),
      await objectBytes(f.c.root, JSON.parse(final.meta)),
    );
    await restored.call(
      "media-review",
      {
        project: f.p,
        id: final.id,
        sha256: JSON.parse(final.meta).sha256,
        verdict: "PASS",
        accepted: true,
        reviewer: "fixture-user",
        source: "user",
        observations: "restored final bytes reverified",
      },
      "restored-final-check",
    );
    const clone = await importProject(zip, f.c.root, {
      strategy: "clone",
      name: "Protected product clone",
    });
    assert.notEqual(clone.project_id, f.p);
    await fs.writeFile(
      path.join(
        process.env.RETOUCH_TEST_ROOT!,
        "native-product-consistency-evidence.json",
      ),
      JSON.stringify({
        verdict: "PASS",
        issue: 18,
        missing_contract: true,
        reference_roles: true,
        protected_alternative: true,
        final_png_and_jpeg: true,
        occlusion_rejected: true,
        forged_and_later_derivative_rejected: true,
        zip: true,
        clone: true,
        real_image_requests: 0,
        semantic_visual: "NOT_RUN",
      }) + "\n",
      { flag: "wx" },
    );
  },
);
