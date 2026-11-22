import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { NativeClient } from "../src/native/client.ts";
import { registerBytes, objectBytes } from "../src/native/files.ts";
import {
  cite,
  citationStatus,
  registerWorkspace,
} from "../src/native/context.ts";
import {
  exportProject,
  importProject,
  inspectProject,
} from "../src/native/exchange.ts";
import { digest } from "../src/native/plugin/commands.mjs";
import { physicalFactsFixture } from "./helpers/physical-reference-cases.ts";
import { registerProductConsistency } from "./helpers/product-consistency-fixture.ts";

const entry = process.env.RETOUCH_TEST_YGL_ENTRY;

test(
  "#16: native handoff pins physical method/facts/reference roles, protects in-flight changes and restores ZIP without executing source permission",
  { skip: !entry, timeout: 300000 },
  async () => {
    const parent = await fs.mkdtemp(
      path.join(process.env.RETOUCH_TEST_ROOT!, "physical16-"),
    );
    const methodHome = path.join(parent, "method-home"),
      home = path.join(parent, "sku-home");
    const library = await NativeClient.initialize(methodHome, entry!);
    const c = await NativeClient.initialize(home, entry!);
    let serial = 0;
    const call = (action: string, body: any, key?: string) =>
      c.call(action, body, key ?? "physical16-" + ++serial);
    const sourceProject = (
      await library.call(
        "project-new",
        {
          name: "Synthetic public method",
          intent: "method source, not a customer SKU",
          tags: [],
        },
        "method-project",
      )
    ).project.id;
    const methodContent = await fs.readFile(
      fileURLToPath(
        new URL("../docs/PHYSICAL-REFERENCE-WORKFLOW.md", import.meta.url),
      ),
      "utf8",
    );
    const method = (
      await library.call(
        "document",
        {
          project: sourceProject,
          kind: "spec",
          title: "Physical reference workflow",
          role: "agent-interpretation",
          source: "Issue16 development fixture; not business permission",
          content: methodContent,
        },
        "method-v1",
      )
    ).artifact;
    await registerWorkspace(c, methodHome, [], "register-method-home");
    const p = (
      await call("project-new", {
        name: "Synthetic SKU physical reference",
        intent: "No model request, no real visual acceptance",
        tags: [],
      })
    ).project.id;
    const goal = (
      await call("goal-new", {
        project: p,
        title: "Physical reference handoff",
        scope: "current-SKU sources, references and actual state",
        preserve: ["do not invent side panels or millimetre verification"],
        done_when: "real review and user acceptance, not fixture PASS",
        source: "ISOLATED FIXTURE",
      })
    ).artifact;
    const task = (
      await call("task-new", {
        project: p,
        goal: goal.id,
        title: "Physical reference sample",
        brief: "all parameters and grants below are synthetic",
        kind: "image",
        purpose: "product-accurate",
        expected_output: "candidate plus traceable references",
        done_when: "actual pixel review and scoped user acceptance",
      })
    ).task;
    const ws = await library.call("workspace-info", {});
    const citation = (
      await cite(
        c,
        p,
        task.id,
        {
          workspace_id: ws.id,
          project_id: sourceProject,
          artifact_id: method.id,
          version: method.version,
          content_hash: digest(method.content),
          purpose: "read the seven-stage method; not target-SKU facts",
          conditions:
            "no CAD precision; preserve unknown datum, roles and permission boundaries",
        },
        "cite-method-v1",
      )
    ).artifact;
    assert.equal(citation.content, method.content);
    const fixture = physicalFactsFixture("NATIVE-SYNTHETIC-A");
    const source = (
      await call("document", {
        project: p,
        task: task.id,
        kind: "spec",
        title: "Synthetic parameter source",
        role: "user-original",
        source: "ISOLATED SYNTHETIC DATA",
        content:
          fixture.source.content +
          " No side panels; leaning props require bottom support and real contact.",
      })
    ).artifact;
    const factBody = structuredClone(fixture.facts);
    for (const field of factBody.fields) {
      field.source.artifact_id = source.id;
      field.confirmation.source_ref = source.id;
    }
    const facts = (
      await call("facts-register", {
        project: p,
        source: "synthetic explicit field labels",
        facts: factBody,
      })
    ).artifact;
    const original = (
      await registerBytes(
        c,
        p,
        task.id,
        await sharp({
          create: { width: 48, height: 32, channels: 4, background: "#335577" },
        })
          .png()
          .toBuffer(),
        { role: "original" },
        "physical-original",
      )
    ).artifact;
    const edit = (
      await registerBytes(
        c,
        p,
        task.id,
        await sharp({
          create: { width: 48, height: 32, channels: 4, background: "#7799aa" },
        })
          .png()
          .toBuffer(),
        {
          role: "reference",
          parents: [original.id],
          operation:
            "SYNTHETIC NONFINAL EDIT: contour instruction only; not measured geometry",
        },
        "physical-edit",
      )
    ).artifact;
    const refs = [
      {
        media_id: original.id,
        purpose:
          "material only; do not restore the old erroneous contour; not other-SKU specifications",
      },
      {
        media_id: edit.id,
        purpose:
          "NONFINAL, NOT MEASURED; new contour only; remove dimension marks and repair seams, steps and shadows",
      },
    ];
    const designContent = [
      "Method=" +
        citation.id +
        ":" +
        method.version +
        ":" +
        digest(method.content),
      "Facts=" + facts.id + ":" + facts.version + ":" + digest(facts.content),
      "Six layers remain distinct: physical facts; structure; imaging; visual references; controls; review/acceptance.",
      "Datum and depth=UNKNOWN; 45/25/5 are synthetic field values, not visible-band pixel ratios. No fabricated side panel.",
      "References=" +
        JSON.stringify(refs) +
        "; parent=" +
        original.id +
        ":" +
        JSON.parse(original.meta).sha256,
      "Stage=5; next=freeze these exact inputs and inspect a synthetic dispatch job; no image generation authorized by this test.",
      "Observation=NOT_RUN; precision=UNKNOWN; no actual user image acceptance.",
    ].join("\n");
    const design = (
      await call("document", {
        project: p,
        task: task.id,
        kind: "design",
        title: "SKU physical-reference handoff",
        role: "agent-interpretation",
        source: "ISOLATED FIXTURE",
        design_type: "decision",
        content: designContent,
      })
    ).artifact;
    const nextRevision = async () =>
      (await c.call("task-view", { project: p, id: task.id })).task.meta.retouch
        .revision;
    await registerProductConsistency(
      c,
      p,
      task.id,
      original,
      "reference",
      "physical16",
    );
    const oldPrompt =
      "OLD FROZEN RULES: follow the reference purpose; no support/contact rule was added to this request yet.";
    const planned = await call("plan", {
      project: p,
      task: task.id,
      input: original.id,
      expected_revision: await nextRevision(),
      purpose: "product-accurate",
      steps: [
        {
          id: "blend",
          input_role: "product-structure",
          prompt: oldPrompt,
          needs: [],
          fact_keys: fixture.keys,
          references: refs,
        },
      ],
    });
    const frozen = JSON.parse(planned.plan.content);
    assert.equal(frozen.design_id, design.id);
    assert.equal(frozen.facts_id, facts.id);
    assert.deepEqual(
      frozen.steps[0].bound_facts.map((f: any) => f.value),
      [45, 25, 5],
    );
    assert.deepEqual(frozen.steps[0].references, refs);
    const grantBody = {
      project: p,
      task: task.id,
      plan_id: planned.plan.id,
      plan_hash: planned.plan_hash,
      issuer: "host-human",
      confirmation: "SYNTHETIC TEST GRANT ONLY; no real model execution",
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    };
    const grant = (await call("grant", grantBody)).grant;
    const run = (
      await call("run-start", { project: p, task: task.id, grant: grant.id })
    ).execution;
    const dispatchBody = { project: p, id: run.id, expected_revision: 0 };
    const sent = await call(
      "run-dispatch",
      dispatchBody,
      "physical-first-dispatch",
    );
    assert.equal(sent.allow_execute, true); // Test deliberately does NOT execute any image tool.
    assert.deepEqual(
      sent.job.references.map((r: any) => [r.id, r.purpose, r.sha256]),
      refs.map((r) => [
        r.media_id,
        r.purpose,
        JSON.parse((r.media_id === original.id ? original : edit).meta).sha256,
      ]),
    );
    assert.equal(sent.job.step.prompt, oldPrompt);
    const beforeReplay = await c.call("snapshot", { project: p });
    const replay = await call(
      "run-dispatch",
      dispatchBody,
      "physical-first-dispatch",
    );
    assert.equal(replay.replayed, true);
    // Raw native receipts retain their original result; only the public CLI adapter
    // suppresses allow_execute. Both callers must require !replayed before execution.
    assert.equal(
      replay.allow_execute === true && replay.replayed !== true,
      false,
    );
    assert.equal(
      (await c.call("snapshot", { project: p })).fingerprint,
      beforeReplay.fingerprint,
    );
    const newerRules = {
      project: p,
      task: task.id,
      expected_revision: await nextRevision(),
      groups: [
        {
          id: "book-support",
          text: "NEW RULE: leaning books need bottom support and true contact; no invented side panels",
          disabled: false,
          scope: "operation",
        },
      ],
    };
    await assert.rejects(call("requirements", newerRules), {
      code: "UNKNOWN_PENDING",
    });
    await assert.rejects(
      call("plan", {
        project: p,
        task: task.id,
        input: original.id,
        expected_revision: await nextRevision(),
        steps: [
          {
            id: "replacement",
            prompt: "do not send another image request",
            needs: [],
          },
        ],
      }),
      { code: "UNKNOWN_PENDING" },
    );
    const waiting = (
      await call("run-unknown", {
        project: p,
        id: run.id,
        expected_revision: JSON.parse(sent.execution.meta).revision,
        statement:
          "Synthetic unresolved dispatch; no external model was called",
      })
    ).execution;
    assert.equal(JSON.parse(waiting.content).steps[0].prompt, oldPrompt);
    const zip = path.join(parent, "physical-context.zip");
    await exportProject(c, p, zip);
    const inspected = await inspectProject(zip);
    assert.equal(
      inspected.manifest.requires.includes("retouch-product-facts/v1"),
      true,
    );
    const target = path.join(parent, "restored");
    assert.equal(
      (await importProject(zip, target, { dryRun: true })).can_restore,
      true,
    );
    await assert.rejects(fs.lstat(target), { code: "ENOENT" });
    const imported = await importProject(zip, target, { entry: entry! });
    assert.equal(
      imported.historical_permissions,
      "inactive-in-target-workspace",
    );
    const restored = await NativeClient.open(target);
    const view = await restored.call("brief", { project: p });
    assert.ok(view.documents.some((d: any) => d.artifact_id === design.id));
    assert.equal(
      (await restored.call("show", { project: p, id: design.id })).content,
      designContent,
    );
    assert.equal(
      (await restored.call("show", { project: p, id: citation.id })).content,
      method.content,
    );
    const restoredRef = await restored.call("show", {
      project: p,
      id: edit.id,
    });
    assert.deepEqual(JSON.parse(restoredRef.meta).parents, [original.id]);
    assert.deepEqual(
      await objectBytes(restored.root, JSON.parse(restoredRef.meta)),
      await objectBytes(c.root, JSON.parse(edit.meta)),
    );
    const restoredRun = await restored.call("show", { project: p, id: run.id });
    assert.equal(JSON.parse(restoredRun.meta).status, "unknown");
    await assert.rejects(
      restored.call(
        "run-authorize",
        {
          project: p,
          id: run.id,
          grant: grant.id,
          expected_revision: JSON.parse(restoredRun.meta).revision,
        },
        "old-permission-in-target",
      ),
      { code: "GRANT_INVALID" },
    );
    const before = await restored.call("snapshot", { project: p });
    await importProject(zip, target, {});
    assert.equal(
      (await restored.call("snapshot", { project: p })).fingerprint,
      before.fingerprint,
    );
    const nextMethod = (
      await library.call(
        "document-revise",
        {
          project: sourceProject,
          id: method.id,
          expected_version: method.version,
          expected_hash: digest(method.content),
          content:
            method.content + "\nSynthetic new camera-condition addendum.\n",
          reason: "isolated method-version change",
          source: "ISOLATED FIXTURE",
        },
        "method-v2",
      )
    ).artifact;
    assert.equal(nextMethod.version, 2);
    assert.equal(
      (await citationStatus(c, p)).find(
        (x: any) => x.citation_id === citation.id,
      )?.status,
      "stale",
    );
    assert.equal(
      (await c.call("show", { project: p, id: citation.id })).content,
      method.content,
    );
    const revisedDesign = (
      await call("document-revise", {
        project: p,
        id: design.id,
        expected_version: design.version,
        expected_hash: digest(design.content),
        content:
          designContent +
          "\nPending consumer review: new method available; do not modify old request.",
        reason: "new method requires consumer review",
        source: "ISOLATED FIXTURE",
      })
    ).artifact;
    const changed = await c.call("brief", { project: p });
    assert.equal(
      changed.tasks.find((t: any) => t.id === task.id).meta.retouch
        .context_status,
      "needs_review",
    );
    assert.ok(
      changed.documents.some((d: any) => d.artifact_id === revisedDesign.id),
    );
    assert.equal(
      (await c.call("show", { project: p, id: run.id })).content,
      waiting.content,
    );
    assert.equal(
      JSON.parse((await c.call("show", { project: p, id: run.id })).meta)
        .status,
      "unknown",
    );
    assert.deepEqual(
      JSON.parse((await c.call("show", { project: p, id: facts.id })).content),
      factBody,
    );
  },
);
