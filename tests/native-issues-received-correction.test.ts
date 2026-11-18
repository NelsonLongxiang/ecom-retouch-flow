import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { outputFixture } from "./helpers/output-fixture.ts";
import { registerBytes, objectBytes } from "../src/native/files.ts";
import { digest, pendingExecution } from "../src/native/plugin/commands.mjs";
import { correctionConfirmation } from "../src/native/plugin/received-correction.mjs";
import { readZip, writeZip } from "../src/infrastructure/zip.ts";
import { bytesHash } from "../src/domain/model.ts";
import {
  exportProject,
  importProject,
  inspectProject,
} from "../src/native/exchange.ts";
import { NativeClient } from "../src/native/client.ts";
const entry = process.env.RETOUCH_TEST_YGL_ENTRY;
const invoke = promisify(execFile);
test(
  "received output registration correction is audited, readonly-preflighted, idempotent and never acceptance",
  { skip: !entry, timeout: 600000 },
  async () => {
    const f = await outputFixture(),
      { c, p, task } = f;
    const bytes = await sharp({
      create: { width: 8, height: 8, channels: 4, background: "#997755" },
    })
      .png()
      .toBuffer();
    const image = (
      await registerBytes(
        c,
        p,
        task.id,
        bytes,
        {
          role: "reference",
          operation:
            "actual isolated local renderer output; misclassified role",
        },
        "misclassified-output",
      )
    ).artifact;
    const sha = JSON.parse(image.meta).sha256;
    const fail = (
      await f.call("media-review", {
        project: p,
        id: image.id,
        sha256: sha,
        verdict: "FAIL",
        accepted: false,
        observations: "synthetic structural FAIL must remain",
        reviewer: "fixture",
        source: "user",
      })
    ).artifact;
    const unknown = (
      await f.call("media-review", {
        project: p,
        id: image.id,
        sha256: sha,
        verdict: "UNKNOWN",
        accepted: false,
        observations: "synthetic UNKNOWN must remain",
        reviewer: "fixture",
        source: "agent",
      })
    ).artifact;
    const execution = (
      await f.call("execution-record", {
        project: p,
        task: task.id,
        status: "received",
        inputs: [],
        outputs: [image.id],
        statement: "one actual isolated local render result",
        source: "fixture local renderer",
      })
    ).execution;
    for (const suffix of ["first", "second"])
      await f.call("document", {
        project: p,
        task: task.id,
        kind: "design",
        title: "Context " + suffix,
        role: "agent-interpretation",
        source: "fixture",
        content: "New context " + suffix,
      });
    const taskBefore = (await c.call("task-view", { project: p, id: task.id }))
      .task;
    assert.equal(taskBefore.meta.retouch.context_status, "needs_review");
    await assert.rejects(
      f.call("task-context-review", {
        project: p,
        task: task.id,
        goal: f.goal.id,
        expected_revision: taskBefore.meta.retouch.revision,
        statement: "cannot bypass pending result",
      }),
      { code: "RESULT_PENDING" },
    );
    const workspaceId = (await c.call("workspace-info", {})).id;
    const permission = {
      schema: "retouch.output-correction-permission/v1",
      decision: "allow",
      workspace_id: workspaceId,
      project_id: p,
      task_id: task.id,
      execution_id: execution.id,
      media_id: image.id,
      sha256: sha,
      from_role: "reference",
      to_role: "candidate",
      confirmation: correctionConfirmation,
    };
    const registerPermission = async (
      title: string,
      value: any,
      role = "user-original",
    ) =>
      (
        await f.call("document", {
          project: p,
          task: task.id,
          kind: "spec",
          title,
          role,
          source: "SYNTHETIC owner decision, not a business authorization",
          content: JSON.stringify(value),
        })
      ).artifact;
    const source = await registerPermission(
      "Explicit correction permission",
      permission,
    );
    const body = {
      project: p,
      id: execution.id,
      task: task.id,
      output_id: image.id,
      sha256: sha,
      expected_revision: 0,
      expected_role: "reference",
      role: "candidate",
      workspace_id: workspaceId,
      confirmation: correctionConfirmation,
      actor: "fixture maintainer",
      reason: "actual output was mislabeled, not visual acceptance",
      source: {
        artifact_id: source.id,
        version: source.version,
        content_hash: digest(source.content),
        quote: correctionConfirmation,
      },
    };
    const pendingZip = path.join(f.parent, "before-correction.zip");
    await exportProject(c, p, pendingZip);
    const pendingHome = path.join(f.parent, "restored-pending");
    await importProject(pendingZip, pendingHome, { entry: entry! });
    const pending = await NativeClient.open(pendingHome),
      pendingBefore = await pending.call("snapshot", { project: p });
    await assert.rejects(
      pending.call("execution-output-correct", body, "old-workspace-denied"),
      { code: "OUTPUT_CORRECTION_AUTHORITY_LOCAL" },
    );
    await assert.rejects(
      pending.call(
        "execution-output-correct",
        {
          ...body,
          workspace_id: (await pending.call("workspace-info", {})).id,
        },
        "new-workspace-old-source-denied",
      ),
      { code: "OUTPUT_CORRECTION_PERMISSION" },
    );
    assert.deepEqual(
      await pending.call("snapshot", { project: p }),
      pendingBefore,
    );
    for (const [label, patch] of [
      ["denied", { decision: "deny" }],
      ["contradiction", { denied: true }],
      ["wrong-workspace", { workspace_id: "source-workspace" }],
      ["wrong-hash", { sha256: "a".repeat(64) }],
    ] as const) {
      const denied = await registerPermission("Rejected permission " + label, {
        ...permission,
        ...patch,
      });
      const snapshot = await c.call("snapshot", { project: p });
      await assert.rejects(
        c.call(
          "execution-output-correct",
          {
            ...body,
            source: {
              artifact_id: denied.id,
              version: denied.version,
              content_hash: digest(denied.content),
              quote: correctionConfirmation,
            },
          },
          "denied-permission-" + label,
        ),
        { code: "OUTPUT_CORRECTION_PERMISSION" },
      );
      assert.deepEqual(await c.call("snapshot", { project: p }), snapshot);
    }
    const negative = await registerPermission(
      "Explicitly negative correction",
      {
        ...permission,
        decision: "deny",
        confirmation: "明确拒绝本次角色更正，不允许执行",
      },
    );
    const negativeBefore = await c.call("snapshot", { project: p });
    await assert.rejects(
      c.call(
        "execution-output-correct",
        {
          ...body,
          confirmation: "明确拒绝本次角色更正，不允许执行",
          source: {
            artifact_id: negative.id,
            version: negative.version,
            content_hash: digest(negative.content),
            quote: "明确拒绝本次角色更正，不允许执行",
          },
        },
        "negative-wording",
      ),
      { code: "OUTPUT_CORRECTION_SOURCE" },
    );
    await assert.rejects(
      c.call(
        "execution-output-correct",
        { ...body, confirmation: "allow and deny this correction" },
        "contradictory-request",
      ),
      { code: "OUTPUT_CORRECTION_PERMISSION" },
    );
    assert.deepEqual(await c.call("snapshot", { project: p }), negativeBefore);
    const before = await c.call("snapshot", { project: p });
    const checked = await c.call("execution-output-check", body);
    assert.equal(checked.dry_run, true);
    assert.equal(checked.acceptance_changed, false);
    assert.deepEqual(await c.call("snapshot", { project: p }), before);
    for (const [patch, code] of [
      [{ sha256: "a".repeat(64) }, "OUTPUT_CORRECTION_HASH"],
      [{ expected_revision: 1 }, "REVISION_CONFLICT"],
      [{ expected_role: "original" }, "OUTPUT_CORRECTION_ROLE"],
      [
        { workspace_id: "other-workspace" },
        "OUTPUT_CORRECTION_AUTHORITY_LOCAL",
      ],
      [{ status: "failed" }, "OUTPUT_CORRECTION_FIELDS"],
    ] as const) {
      await assert.rejects(
        c.call(
          "execution-output-correct",
          { ...body, ...patch },
          "wrong-" + code,
        ),
        { code },
      );
      assert.deepEqual(await c.call("snapshot", { project: p }), before);
    }
    const payload = path.join(f.parent, "correction.json");
    const { project, id, expected_revision, ...cliBody } = body;
    await fs.writeFile(payload, JSON.stringify(cliBody));
    const cliArgs = [
      "src/cli.ts",
      "execution",
      "correct-output",
      execution.id,
      "--workspace",
      c.root,
      "--project",
      p,
      "--file",
      payload,
      "--expected-revision",
      "0",
      "--request-id",
      "correct-once",
      "--json",
    ];
    const cli = JSON.parse(
      (
        await invoke(process.execPath, cliArgs, {
          cwd: path.resolve(import.meta.dirname, ".."),
          timeout: 60000,
          maxBuffer: 8 * 1024 * 1024,
        })
      ).stdout,
    );
    assert.equal(cli.ok, true);
    assert.equal(cli.data.acceptance_changed, false);
    const replay = await c.call(
      "execution-output-correct",
      body,
      "correct-once",
    );
    assert.equal(replay.replayed, true);
    assert.equal(replay.historical_receipt, true);
    assert.equal(replay.correction_execution_allowed, false);
    assert.equal(replay.current_authorization_revalidated, false);
    await assert.rejects(
      c.call(
        "execution-output-correct",
        { ...body, reason: "different key content" },
        "correct-once",
      ),
      { code: "REQUEST_CONFLICT" },
    );
    const after = await c.call("snapshot", { project: p });
    const updated = await c.call("show", { project: p, id: execution.id }),
      output = await c.call("show", { project: p, id: image.id });
    assert.equal(JSON.parse(updated.meta).status, "received");
    assert.equal(JSON.parse(updated.meta).revision, 1);
    assert.deepEqual(JSON.parse(updated.meta).outputs, [image.id]);
    assert.equal(JSON.parse(output.meta).role, "candidate");
    assert.equal(pendingExecution(updated, after.tables.artifacts), false);
    const im = JSON.parse(output.meta),
      originalIm = JSON.parse(image.meta),
      em = JSON.parse(updated.meta),
      originalEm = JSON.parse(execution.meta);
    delete im.registration_corrections;
    delete em.registration_corrections;
    im.role = originalIm.role;
    em.revision = originalEm.revision;
    assert.deepEqual(im, originalIm);
    assert.deepEqual(em, originalEm);
    for (const old of [fail, unknown])
      assert.deepEqual(
        after.tables.artifacts.find((a: any) => a.id === old.id),
        before.tables.artifacts.find((a: any) => a.id === old.id),
      );
    assert.deepEqual(
      after.tables.artifacts.find((a: any) => a.id === task.id),
      before.tables.artifacts.find((a: any) => a.id === task.id),
      "persisted task/context/revision stays unchanged; candidate projection may change",
    );
    const projected = (await c.call("task-view", { project: p, id: task.id }))
      .task;
    assert.deepEqual(projected.meta, taskBefore.meta);
    assert.ok(
      projected.image_outputs.some(
        (a: any) => a.id === image.id && a.role === "candidate",
      ),
    );
    assert.deepEqual(await objectBytes(c.root, JSON.parse(output.meta)), bytes);
    assert.equal(
      after.tables.artifacts.filter((a: any) => a.kind === "execution").length,
      before.tables.artifacts.filter((a: any) => a.kind === "execution").length,
    );
    assert.equal(
      after.tables.artifacts.filter(
        (a: any) =>
          JSON.parse(a.meta).role === "output-registration-correction",
      ).length,
      1,
    );
    assert.equal(
      after.tables.events.filter((e: any) => {
        try {
          return JSON.parse(e.payload).request_id === "correct-once";
        } catch {
          return false;
        }
      }).length,
      1,
    );
    await assert.rejects(
      f.call("media-review", {
        project: p,
        id: image.id,
        sha256: sha,
        verdict: "PASS",
        accepted: true,
        observations: "must not accept due to correction",
        reviewer: "fixture",
        source: "user",
      }),
      { code: "CONTEXT_STALE" },
    );
    const context = (
      await f.call("task-context-review", {
        project: p,
        task: task.id,
        goal: f.goal.id,
        expected_revision: taskBefore.meta.retouch.revision,
        statement: "actual isolated context review after metadata correction",
      })
    ).task;
    assert.equal(JSON.parse(context.meta).retouch.context_status, "current");
    await assert.rejects(
      f.call("delivery-prepare", {
        project: p,
        id: image.id,
        directory: path.join(f.parent, "must-not-deliver"),
      }),
      { code: "MEDIA_STALE" },
    );
    const pendingExecutionB = (
      await f.call("execution-record", {
        project: p,
        task: task.id,
        status: "unknown",
        inputs: [],
        outputs: [],
        statement: "isolated unresolved B, never rendered",
        source: "fixture",
      })
    ).execution;
    const beforeLateAttachment = await c.call("snapshot", { project: p });
    await assert.rejects(
      f.call("execution-record", {
        project: p,
        task: task.id,
        status: "received",
        inputs: [],
        outputs: [image.id],
        statement: "must not share corrected output",
        source: "fixture",
      }),
      { code: "OUTPUT_CORRECTION_SHARED_OUTPUT" },
    );
    await assert.rejects(
      f.call("execution-reconcile", {
        project: p,
        id: pendingExecutionB.id,
        expected_revision: 0,
        status: "received",
        outputs: [image.id],
        statement: "must not attach corrected output",
      }),
      { code: "OUTPUT_CORRECTION_SHARED_OUTPUT" },
    );
    assert.deepEqual(
      await c.call("snapshot", { project: p }),
      beforeLateAttachment,
    );
    const otherMedia = await f.image(8, 8, "#123456", "unrelated-audit-media");
    const zip = path.join(f.parent, "audit.zip");
    await exportProject(c, p, zip);
    const inspected = await inspectProject(zip);
    assert.ok(
      inspected.manifest.requires.includes(
        "retouch-output-registration-correction/v1",
      ),
    );
    const corruptPackage = async (
      name: string,
      mutate: (artifacts: any[]) => void,
    ) => {
      const entries = await readZip(zip),
        native = JSON.parse(
          entries.get("native-project.json")!.toString("utf8"),
        ),
        manifest = JSON.parse(entries.get("manifest.json")!.toString("utf8"));
      mutate(native.tables.artifacts);
      native.fingerprint = digest(native.tables);
      const bytes = Buffer.from(JSON.stringify(native, null, 2) + "\n");
      entries.set("native-project.json", bytes);
      manifest.snapshot_id = native.fingerprint;
      manifest.fingerprint = native.fingerprint;
      const row = manifest.files.find(
        (x: any) => x.name === "native-project.json",
      );
      row.sha256 = bytesHash(bytes);
      row.bytes = bytes.length;
      entries.set(
        "manifest.json",
        Buffer.from(JSON.stringify(manifest, null, 2) + "\n"),
      );
      const target = path.join(f.parent, name + ".zip");
      await writeZip(target, entries);
      await assert.rejects(inspectProject(target), {
        code: "OUTPUT_CORRECTION_AUDIT",
      });
    };
    const auditId = JSON.parse(output.meta).registration_corrections[0];
    await corruptPackage("extra-current-output", (all) => {
      const ex = all.find((a) => a.id === execution.id),
        m = JSON.parse(ex.meta);
      m.outputs.push(otherMedia.id);
      ex.meta = JSON.stringify(m);
    });
    await corruptPackage("foreign-media-audit-ref", (all) => {
      const im = all.find((a) => a.id === otherMedia.id),
        m = JSON.parse(im.meta);
      m.registration_corrections = [auditId];
      im.meta = JSON.stringify(m);
    });
    await corruptPackage("note-metadata-subject-swap", (all) => {
      const audit = all.find((a) => a.id === auditId),
        m = JSON.parse(audit.meta);
      m.media_id = otherMedia.id;
      audit.meta = JSON.stringify(m);
    });
    const restoredRoot = path.join(f.parent, "restored");
    await importProject(zip, restoredRoot, { entry: entry! });
    const restored = await NativeClient.open(restoredRoot);
    assert.equal(
      JSON.parse(
        (await restored.call("show", { project: p, id: image.id })).meta,
      ).role,
      "candidate",
    );
    const restoredBeforeReplay = await restored.call("snapshot", {
      project: p,
    });
    await assert.rejects(
      restored.call("execution-output-correct", body, "correct-once"),
      { code: "OUTPUT_CORRECTION_AUTHORITY_LOCAL" },
    );
    assert.deepEqual(
      await restored.call("snapshot", { project: p }),
      restoredBeforeReplay,
    );
    const cloned = await importProject(zip, c.root, {
      strategy: "clone",
      name: "Audit correction clone",
    });
    assert.notEqual(cloned.project_id, p);
    await fs.writeFile(
      path.join(
        process.env.RETOUCH_TEST_ROOT!,
        "native-received-correction-evidence.json",
      ),
      JSON.stringify({
        verdict: "PASS",
        readonly_preflight: true,
        wrong_inputs_atomic: true,
        official_cli: true,
        exact_native_idempotency: true,
        only_role_revision_and_audit_refs_changed: true,
        received_and_old_reviews_preserved: true,
        context_review_separate: true,
        not_accepted_or_delivered: true,
        zip_restore_and_clone: true,
        rehashed_tampered_zip_refused: true,
        denied_and_conflicting_permissions_refused: true,
        old_workspace_receipt_refused: true,
        later_record_reconcile_shared_output_refused: true,
        real_render_requests: 0,
      }) + "\n",
      { flag: "wx" },
    );
  },
);

test(
  "received correction refuses output shared by another execution without changing either",
  { skip: !entry, timeout: 300000 },
  async () => {
    const f = await outputFixture(),
      image = await f.image(8, 8, "#aabbcc", "shared-output");
    // This fixture deliberately registers the actual synthetic bytes as a reference.
    const shared = (
      await registerBytes(
        f.c,
        f.p,
        f.task.id,
        await objectBytes(f.c.root, JSON.parse(image.meta)),
        { role: "reference" },
        "shared-reference",
      )
    ).artifact;
    const executions = [];
    for (const id of ["A", "B"])
      executions.push(
        (
          await f.call("execution-record", {
            project: f.p,
            task: f.task.id,
            status: "received",
            inputs: [],
            outputs: [shared.id],
            statement: "synthetic received execution " + id,
            source: "fixture",
          })
        ).execution,
      );
    const workspace = (await f.c.call("workspace-info", {})).id,
      hash = JSON.parse(shared.meta).sha256;
    const permission = {
      schema: "retouch.output-correction-permission/v1",
      decision: "allow",
      workspace_id: workspace,
      project_id: f.p,
      task_id: f.task.id,
      execution_id: executions[0].id,
      media_id: shared.id,
      sha256: hash,
      from_role: "reference",
      to_role: "candidate",
      confirmation: correctionConfirmation,
    };
    const source = (
      await f.call("document", {
        project: f.p,
        task: f.task.id,
        kind: "spec",
        title: "Shared output correction permission",
        role: "user-original",
        source: "synthetic owner",
        content: JSON.stringify(permission),
      })
    ).artifact;
    const body = {
      project: f.p,
      id: executions[0].id,
      task: f.task.id,
      output_id: shared.id,
      sha256: hash,
      expected_revision: 0,
      expected_role: "reference",
      role: "candidate",
      workspace_id: workspace,
      confirmation: correctionConfirmation,
      actor: "fixture",
      reason: "must reject scope ambiguity",
      source: {
        artifact_id: source.id,
        version: source.version,
        content_hash: digest(source.content),
        quote: correctionConfirmation,
      },
    };
    const before = await f.c.call("snapshot", { project: f.p });
    for (const action of ["execution-output-check", "execution-output-correct"])
      await assert.rejects(f.c.call(action, body, "shared-denied-" + action), {
        code: "OUTPUT_CORRECTION_SHARED_OUTPUT",
      });
    const after = await f.c.call("snapshot", { project: f.p });
    assert.deepEqual(after, before);
    for (const e of executions)
      assert.equal(pendingExecution(e, after.tables.artifacts), true);
  },
);
