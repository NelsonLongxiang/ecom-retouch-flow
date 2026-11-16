import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { NativeClient } from "../src/native/client.ts";
import { registerBytes } from "../src/native/files.ts";
import { exportProject, importProject } from "../src/native/exchange.ts";
import { exportSuite } from "../src/native/suite.ts";
import { digest } from "../src/native/plugin/commands.mjs";

const entry = process.env.RETOUCH_TEST_YGL_ENTRY;
test(
  "#11: native matrix/storyboard handoff and role-specific review examples preserve boundaries, not automatic vision",
  { skip: !entry, timeout: 180000 },
  async () => {
    const parent = await fs.mkdtemp(
      path.join(process.env.RETOUCH_TEST_ROOT!, "workflow-11-"),
    );
    const c = await NativeClient.initialize(path.join(parent, "home"), entry!);
    let serial = 0;
    const call = (a: string, b: any, key?: string) =>
      c.call(a, b, key ?? "workflow-" + ++serial);
    const p = (
      await call("project-new", {
        name: "Decision narrative fixture",
        intent: "Anonymous workflow, no image model or real visual acceptance",
        tags: [],
      })
    ).project.id;
    const goal = (
      await call("goal-new", {
        project: p,
        title: "Buyers understand product-specific value",
        scope: "Variable page count, references and facts first",
        preserve: ["product identity"],
        done_when: "actual review and user acceptance, not fixture PASS",
        source: "ISOLATED FIXTURE",
      })
    ).artifact;
    const task = (
      await call("task-new", {
        project: p,
        goal: goal.id,
        title: "Narrative matrix",
        brief: "low-cost storyboard before production",
        kind: "design",
        expected_output: "native design matrix",
        done_when: "review the declared role-specific criteria",
      })
    ).task;
    const imageTask = (
      await call("task-new", {
        project: p,
        goal: goal.id,
        title: "Gift narrative sample",
        brief: "record-level synthetic examples only",
        kind: "image",
        expected_output: "candidate",
        done_when: "independent actual observation and user acceptance",
      })
    ).task;
    const source = (
      await call("document", {
        project: p,
        task: task.id,
        kind: "spec",
        title: "Synthetic original brief and boundary",
        role: "user-original",
        source: "ISOLATED FIXTURE, not actual authorization",
        content:
          "Fixture buyer asks who the gift is for. Explain the actual product, not a generic gift box. Packaging fact is unknown unless explicitly cited. Page count is not fixed.",
      })
    ).artifact;
    const obligation = "gift-object";
    const intent = (
      await call("intent-set", {
        project: p,
        source: "ISOLATED FIXTURE",
        expected_id: null,
        intent: {
          schema: "retouch.business-intent/v1",
          business_intent: {
            problem: "generic emotional image without product referent",
            audience: "fixture buyer",
            how: "actual product explained",
            where: null,
          },
          obligations: [
            {
              id: obligation,
              text: "Explain the actual product, not a generic gift box.",
              required: true,
              source: {
                artifact_id: source.id,
                quote: "Explain the actual product, not a generic gift box.",
              },
            },
          ],
          rollout: { mode: "sample-first", representative_ids: [obligation] },
        },
      })
    ).artifact;
    const rows = [
      {
        id: "gift",
        question: "what is being gifted?",
        conclusion: "the actual product is introduced",
        evidence: {
          artifact_id: source.id,
          version: source.version,
          hash: digest(source.content),
          quote: "Packaging fact is unknown unless explicitly cited.",
        },
        frame:
          "people introduce and observe the actual product; no invented package",
        transition: "adds specific purchase meaning",
        obligation,
        counterexample: "unrelated box with product as incidental decoration",
        criterion: "visible product referent, physical/text consistency",
      },
      {
        id: "recognition",
        question: "what is it?",
        conclusion: "clear intact product",
        evidence: {
          artifact_id: goal.id,
          version: goal.version,
          hash: digest(goal.content),
        },
        frame: "whole product, no person required",
        transition: "recognition before emotional meaning",
        criterion: "recognizable product, not a mandatory touch scene",
      },
    ];
    const designBody = {
      project: p,
      task: task.id,
      kind: "design",
      title: "Buyer decision matrix and storyboard",
      role: "agent-interpretation",
      source: "ISOLATED FIXTURE",
      design_type: "decision",
      content: JSON.stringify({
        project: p,
        goal_id: goal.id,
        task_id: task.id,
        intent_id: intent.id,
        source_id: source.id,
        scope: {
          product: "synthetic stand",
          scene: "fixture",
          time: "fixture only",
          execution_boundary: "no real execution",
        },
        rows,
        storyboard: { type: "text-only", order: ["recognition", "gift"] },
        risks: ["product relation", "white material", "information density"],
        stage: "representative sample",
        next_action: "inspect actual sample before expansion",
        return_on_failure: {
          strategy: "storyboard",
          facts: "evidence or remove claim",
          relation: "production",
          type: "local layout",
        },
      }),
    };
    const design = (await call("document", designBody, "matrix")).artifact;
    assert.equal(
      (await call("document", designBody, "matrix")).artifact.id,
      design.id,
    );
    const brief = await c.call("brief", { project: p });
    const pointer = brief.documents.find(
      (d: any) => d.artifact_id === design.id,
    );
    assert.equal(pointer.version, design.version);
    assert.equal(pointer.content_hash, digest(design.content));
    const actual = JSON.parse(
      (await c.call("show", { project: p, id: pointer.artifact_id })).content,
    );
    assert.deepEqual(actual.rows, rows);
    assert.equal(actual.next_action, "inspect actual sample before expansion");
    assert.equal(actual.source_id, source.id);
    assert.equal(actual.storyboard.type, "text-only");

    const media = (
      await registerBytes(
        c,
        p,
        imageTask.id,
        await sharp({
          create: { width: 24, height: 12, channels: 3, background: "#bca987" },
        })
          .png()
          .toBuffer(),
        { role: "postprocess" },
        "example-media",
      )
    ).artifact;
    const hash = JSON.parse(media.meta).sha256;
    const check = (verdict: string, observations: string) =>
      call("coverage-check", {
        project: p,
        id: media.id,
        sha256: hash,
        contract_id: intent.id,
        method: "fixture",
        reviewer: "explicit synthetic observation author",
        source: "ISOLATED RECORD-LEVEL FIXTURE, NOT REAL VISION",
        items: [
          {
            id: obligation,
            verdict,
            observations,
            evidence:
              "synthetic case description only; actual host visual review NOT_RUN",
          },
        ],
      });
    await check(
      "PASS",
      "Historical erroneous conclusion: box, person and product all appear. This is a deliberately supplied bad judgment, not software inference.",
    );
    const rejected = await check(
      "FAIL",
      "Who/object: hands and gaze point to a different box; actual product remains an incidental prop. No packaging source establishes the box refers to this SKU. Gift-object obligation is not fulfilled; removing product leaves same generic emotional scene. Return to storyboard/production, not tiny disclaimer.",
    );
    assert.equal(rejected.assessment.status, "FAIL");
    const snap = (
      await call("suite-snapshot", {
        project: p,
        task: imageTask.id,
        name: "record-only cases",
        expected_id: null,
        expected_revision: 0,
        slots: [
          { id: "gift", role: "gift-object", media_id: media.id, sha256: hash },
        ],
      })
    ).artifact;
    await call("suite-accept", {
      project: p,
      id: snap.id,
      source: "user",
      reviewer: "synthetic fixture only",
      statement: "ISOLATED ACCEPTANCE FIXTURE, not real user acceptance",
      slots: [{ id: "gift", sha256: hash }],
    });
    await assert.rejects(
      exportSuite(
        c,
        p,
        snap.id,
        path.join(parent, "must-not-deliver.zip"),
        { mode: "delivery" },
        "bad-delivery",
      ),
      { code: "CONTENT_COVERAGE" },
    );
    const examples = [
      [
        "PASS",
        "Introduced/observed actual product: removing it removes the action object; candidate only, not performance/packaging confirmation.",
      ],
      [
        "PASS",
        "Legal packaging gift: this hypothetical fixture explicitly supplies matching SKU packaging evidence; indirect product relation can suffice, touch is not required.",
      ],
      [
        "PASS",
        "White-background/dimension role: no people or action required; judge recognizable whole product and properly sourced dimensions, not gift emotion.",
      ],
      [
        "FAIL",
        "Physical/text contradiction: visible interface relation conflicts with the declared source; identify affected obligation and return to production, not footnote.",
      ],
      [
        "UNKNOWN",
        "Important object occluded/low resolution or missing source: cannot establish referent; do not infer PASS from prompt.",
      ],
    ];
    for (const [verdict, observation] of examples)
      await check(verdict, observation);
    const final = await c.call("coverage-view", { project: p });
    assert.equal(final.status, "UNKNOWN");
    const before = await c.call("snapshot", { project: p });
    const checks = before.tables.artifacts.filter(
      (a: any) => JSON.parse(a.meta).role === "coverage-check",
    );
    assert.equal(checks.length, 7);
    assert.ok(
      checks.some(
        (a: any) => JSON.parse(a.content).items[0].verdict === "FAIL",
      ),
    );
    assert.ok(
      checks.every(
        (a: any) =>
          JSON.parse(a.meta).method === "fixture" &&
          JSON.parse(a.meta).accepted === false,
      ),
    );
    const zip = path.join(parent, "workflow.zip");
    await exportProject(c, p, zip);
    const restored = path.join(parent, "restored");
    await importProject(zip, restored, { entry });
    const r = await NativeClient.open(restored),
      handoff = await r.call("brief", { project: p });
    assert.equal(
      handoff.documents.find((d: any) => d.artifact_id === design.id)
        .content_hash,
      pointer.content_hash,
    );
    assert.equal(
      (await r.call("show", { project: p, id: design.id })).content,
      design.content,
    );
    assert.equal(handoff.content_coverage.status, "UNKNOWN");
    assert.equal(
      handoff.tasks.some((t: any) => t.meta.status === "done"),
      false,
    );
    // Actual host vision, independent blind review and real user acceptance are intentionally NOT_RUN.
  },
);
