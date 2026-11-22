import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { NativeClient } from "../src/native/client.ts";
import { execute } from "../src/cli.ts";
import { exportDocument } from "../src/native/documents.ts";
import { digest } from "../src/native/plugin/commands.mjs";
import { cite, citationStatus, searchContext } from "../src/native/context.ts";
import { exportProject, importProject } from "../src/native/exchange.ts";
import { bytesHash } from "../src/domain/model.ts";

const entry = process.env.RETOUCH_TEST_YGL_ENTRY;
test(
  "正式文档从原生上下文读取、修订、导出并跨工作区恢复",
  { skip: !entry, timeout: 300000 },
  async () => {
    const parent = await fs.mkdtemp(
      path.join(process.env.RETOUCH_TEST_ROOT!, "documents-"),
    );
    const c = await NativeClient.initialize(path.join(parent, "home"), entry!);
    let n = 0;
    const call = (action: string, b: any, key?: string) =>
      c.call(action, b, key ?? "documents-" + ++n);
    const p = (
      await call("project-new", {
        name: "原生文档",
        intent: "设计与规格版本",
        tags: [],
      })
    ).project.id;
    const goal = (
      await call("goal-new", {
        project: p,
        title: "套图目标",
        scope: "七张套图",
        preserve: ["商品结构"],
        done_when: "评审设计",
        source: "fixture",
      })
    ).artifact;
    const task = (
      await call("task-new", {
        project: p,
        goal: goal.id,
        title: "设计任务",
        brief: "设计任务夹具",
        expected_output: "原生 design",
        done_when: "设计评审",
        kind: "design",
      })
    ).task;
    const dependent = (
      await call("task-new", {
        project: p,
        goal: goal.id,
        title: "下游任务",
        brief: "依赖设计",
        expected_output: "后续工件",
        done_when: "后续评审",
        kind: "design",
        dependencies: [task.id],
      })
    ).task;
    const third = (
      await call("task-new", {
        project: p,
        goal: goal.id,
        title: "再下游",
        brief: "间接依赖设计",
        expected_output: "后续工件",
        done_when: "后续评审",
        kind: "design",
        dependencies: [dependent.id],
      })
    ).task;
    const input = {
      project: p,
      task: task.id,
      kind: "design",
      title: "变体套图方案",
      content:
        "# 套图方案 v2（历史标题，不代表原生版本）\n\n原木材质，旧版专用词。\n",
      role: "agent-interpretation",
      source: "fixture",
      design_type: "decision",
    };
    const design = (await call("document", input, "register-design")).artifact;
    const legacyFile = path.join(parent, "old-v2.md");
    await fs.writeFile(legacyFile, design.content);
    const legacyFileHash = bytesHash(await fs.readFile(legacyFile));
    assert.equal(
      (await call("document", input, "register-design")).artifact.id,
      design.id,
    );
    await assert.rejects(call("document", input), { code: "DOCUMENT_EXISTS" });
    const companion = (
      await call("document", {
        ...input,
        title: "构图补充",
        content: "并列设计文档",
      })
    ).artifact;
    let view = await c.call("brief", { project: p });
    assert.equal(
      view.tasks.find((t: any) => t.id === task.id).meta.retouch.design_id,
      companion.id,
      "second design registration selects the companion series before revision",
    );
    assert.equal(
      view.relations.some(
        (r: any) =>
          r.src_id === design.id &&
          r.dst_id === companion.id &&
          r.rel === "superseded-by",
      ),
      false,
    );
    const reviewedTask = (
      await call("task-context-review", {
        project: p,
        task: task.id,
        goal: goal.id,
        expected_revision: view.tasks.find((t: any) => t.id === task.id).meta
          .retouch.revision,
        statement: "隔离夹具复核并列设计",
      })
    ).task;
    await call("task-close", {
      project: p,
      task: task.id,
      expected_revision: JSON.parse(reviewedTask.meta).retouch.revision,
      statement: "隔离夹具设计已登记",
    });
    const initialSnapshot = await c.call("snapshot", { project: p });
    const taskNode = initialSnapshot.tables.nodes.find(
      (node: any) => node.key === "task-" + task.id,
    );
    assert.equal(
      initialSnapshot.tables.node_state.find(
        (state: any) =>
          state.node_id === taskNode.id && state.context === "default",
      ).status,
      "unlocked",
    );
    const shown = (
      await execute([
        "artifact",
        "show",
        design.id,
        "--workspace",
        c.root,
        "--project",
        p,
      ])
    ).result.data;
    assert.equal(shown.native_document.content_hash, digest(design.content));
    const hit = (await searchContext(c, "旧版专用词")).hits.find(
      (a: any) => a.artifact_id === design.id,
    );
    const citation = (
      await cite(
        c,
        p,
        task.id,
        { ...hit, purpose: "保留参考", conditions: "仅为历史提案" },
        "reference",
      )
    ).artifact;
    await c.raw([
      "rel",
      "add",
      "task:" + dependent.id,
      "artifact:" + design.id,
      "--rel",
      "references",
    ]);
    const anotherCitation = (
      await cite(
        c,
        p,
        dependent.id,
        {
          ...hit,
          purpose: "另一个任务的独立参考",
          conditions: "仍为历史提案",
        },
        "reference-for-dependent",
      )
    ).artifact;
    const pinned = (await c.call("brief", { project: p })).documents.filter(
      (a: any) => a.kind === "citation",
    );
    assert.deepEqual(
      new Set(pinned.map((a: any) => a.artifact_id)),
      new Set([citation.id, anotherCitation.id]),
    );
    for (const pin of pinned) {
      assert.equal(pin.status, "pinned-snapshot");
      assert.equal(pin.current_id, pin.artifact_id);
    }
    const citationHistory = await c.call("document-history", {
      project: p,
      id: citation.id,
    });
    assert.equal(citationHistory.current_id, citation.id);
    assert.equal(citationHistory.versions.length, 1);
    const payload = {
      content: "# 当前方案\n\n补充照明条件，保留商品结构。\n",
      reason: "根据新约束修订照明",
      source: "fixture",
    };
    const file = path.join(parent, "revise.json");
    await fs.writeFile(file, JSON.stringify(payload));
    const args = [
      "artifact",
      "revise",
      design.id,
      "--workspace",
      c.root,
      "--project",
      p,
      "--file",
      file,
      "--expected-version",
      "1",
      "--expected-hash",
      digest(design.content),
      "--request-id",
      "revise-design",
    ];
    const revised = (await execute(args)).result.data.artifact;
    assert.equal(revised.version, 2);
    assert.equal(revised.title, design.title);
    assert.equal((await execute(args)).result.replayed, true);
    assert.equal(
      (await c.call("show", { project: p, id: design.id })).content,
      design.content,
    );
    assert.equal(JSON.parse(revised.meta).task_id, task.id);
    assert.equal(JSON.parse(revised.meta).goal_id, goal.id);
    assert.equal(JSON.parse(revised.meta).role, "agent-interpretation");
    assert.equal(JSON.parse(revised.meta).design_type, "decision");
    const revise = {
      project: p,
      id: design.id,
      expected_version: 1,
      expected_hash: digest(design.content),
      ...payload,
    };
    await assert.rejects(call("document-revise", revise), {
      code: "DOCUMENT_STALE",
    });
    await assert.rejects(
      call("document-revise", {
        ...revise,
        id: revised.id,
        expected_version: 2,
        expected_hash: "0".repeat(64),
      }),
      { code: "DOCUMENT_STALE" },
    );
    await assert.rejects(
      call("document-revise", {
        ...revise,
        id: revised.id,
        title: "另一个文件v3.md",
      }),
      { code: "DOCUMENT_FIELDS" },
    );
    await assert.rejects(
      call("document-revise", { ...revise, id: citation.id }),
      { code: "DOCUMENT_KIND" },
    );
    view = await c.call("brief", { project: p });
    assert.equal(
      view.documents.find((a: any) => a.title === design.title).artifact_id,
      revised.id,
    );
    assert.equal(
      view.documents.filter((a: any) => a.title === design.title).length,
      1,
    );
    for (const id of [task.id, dependent.id, third.id])
      assert.equal(
        view.tasks.find((t: any) => t.id === id).progress,
        "needs_review",
      );
    const invalidatedSnapshot = await c.call("snapshot", { project: p });
    assert.equal(
      invalidatedSnapshot.tables.node_state.find(
        (state: any) =>
          state.node_id === taskNode.id && state.context === "default",
      ).status,
      "locked",
    );
    assert.equal(
      view.tasks.find((t: any) => t.id === task.id).meta.retouch.design_id,
      companion.id, // Revising another related series cannot replace the actual selected design.
    );
    assert.ok(
      view.relations.some(
        (r: any) =>
          r.src_id === design.id &&
          r.dst_id === revised.id &&
          r.rel === "superseded-by",
      ),
    );
    assert.ok(
      view.relations.some(
        (r: any) =>
          r.src_id === task.id &&
          r.dst_id === revised.id &&
          r.rel === "described-by",
      ),
    );
    assert.equal(
      view.relations.some(
        (r: any) =>
          r.src_id === dependent.id &&
          r.dst_id === revised.id &&
          r.rel === "references",
      ),
      false,
    );
    const history = (
      await execute([
        "artifact",
        "history",
        design.id,
        "--workspace",
        c.root,
        "--project",
        p,
      ])
    ).result.data;
    assert.equal(history.current_id, revised.id);
    // Replay the redacted real case: a file named v2 contains native v1, while the current native version is now v2.
    const originalNative = await c.call("show", { project: p, id: design.id });
    assert.equal(originalNative.version, 1);
    assert.equal(await fs.readFile(legacyFile, "utf8"), originalNative.content);
    const archive = path.join(parent, "archive");
    await fs.mkdir(archive);
    const archivedFile = path.join(archive, path.basename(legacyFile));
    await fs.rename(legacyFile, archivedFile);
    assert.equal(bytesHash(await fs.readFile(archivedFile)), legacyFileHash);
    const mapping = (
      await call("document", {
        project: p,
        task: task.id,
        kind: "spec",
        title: "旧副本归档映射",
        role: "reference",
        source: "Issue #7 redacted business replay",
        content: JSON.stringify({
          schema: "retouch.export-archive-map/v1",
          source_workspace: (await c.call("workspace-info", {})).id,
          source_project: p,
          source_artifact: design.id,
          source_version: 1,
          source_hash: originalNative.native_document.content_hash,
          file_name: path.basename(legacyFile),
          file_sha256: legacyFileHash,
          status: "archived",
        }),
      })
    ).artifact;
    await assert.rejects(fs.access(legacyFile), { code: "ENOENT" });
    const freshSession = await NativeClient.open(c.root),
      handoff = await freshSession.call("brief", { project: p });
    assert.equal(
      handoff.documents.find((a: any) => a.title === design.title).artifact_id,
      revised.id,
    );
    assert.equal(
      JSON.parse(
        (await freshSession.call("show", { project: p, id: mapping.id }))
          .content,
      ).source_version,
      1,
    );
    assert.deepEqual(
      history.versions.map((a: any) => [a.version, a.status]),
      [
        [1, "superseded"],
        [2, "observed-current"],
      ],
    );
    assert.equal(
      (await searchContext(c, "旧版专用词")).hits.find(
        (a: any) => a.artifact_id === design.id,
      )?.status,
      "superseded",
    );
    assert.equal(
      (await citationStatus(c, p)).find(
        (a: any) => a.citation_id === citation.id,
      )?.status,
      "stale",
    );
    assert.equal(
      (await c.call("show", { project: p, id: citation.id })).content,
      design.content,
    );
    const exportFile = path.join(parent, "readable.md");
    const exported = (
      await execute([
        "artifact",
        "export",
        revised.id,
        "--workspace",
        c.root,
        "--project",
        p,
        "--to",
        exportFile,
      ])
    ).result.data;
    const copy = await fs.readFile(exportFile, "utf8");
    assert.equal(exported.authority, "exported-copy");
    assert.equal(
      exported.source.workspace_id,
      (await c.call("workspace-info", {})).id,
    );
    assert.equal(exported.source.content_hash, digest(revised.content));
    assert.ok(copy.includes("可读导出副本"));
    assert.ok(copy.endsWith(revised.content));
    const blockedCopy = path.join(parent, "protected.md");
    const protectedSource = {
      call: async () => ({
        ...shown,
        meta: JSON.stringify({ api_key: "fixture-only" }),
      }),
    } as unknown as NativeClient;
    await assert.rejects(
      exportDocument(protectedSource, p, revised.id, blockedCopy),
      { code: "CONTEXT_CREDENTIAL" },
    );
    await assert.rejects(fs.access(blockedCopy), { code: "ENOENT" });
    await assert.rejects(
      execute([
        "artifact",
        "export",
        revised.id,
        "--workspace",
        c.root,
        "--project",
        p,
        "--to",
        exportFile,
      ]),
      { code: "EXPORT_EXISTS" },
    );
    await fs.writeFile(exportFile, "人为编辑副本");
    assert.equal(
      (await c.call("show", { project: p, id: revised.id })).content,
      revised.content,
    );
    const goalPayload = {
      ...JSON.parse(goal.content),
      scope: "六张套图",
      confirmation: "confirmed",
      confirmation_source: null,
    };
    await assert.rejects(
      call("document-revise", {
        project: p,
        id: goal.id,
        expected_version: 1,
        expected_hash: digest(goal.content),
        content: goalPayload,
        reason: "调整范围",
        source: "fixture",
      }),
      { code: "GOAL_CONFIRMATION" },
    );
    goalPayload.confirmation = "pending";
    const nextGoal = (
      await call("document-revise", {
        project: p,
        id: goal.id,
        expected_version: 1,
        expected_hash: digest(goal.content),
        content: goalPayload,
        reason: "调整范围",
        source: "fixture",
      })
    ).artifact;
    assert.equal(nextGoal.version, 2);
    const afterGoal = await c.call("brief", { project: p });
    assert.equal(
      afterGoal.tasks.find((t: any) => t.id === task.id).meta.retouch.goal_id,
      goal.id,
    );
    assert.equal(
      afterGoal.relations.some(
        (r: any) =>
          r.src_type === "task" &&
          r.dst_id === nextGoal.id &&
          r.rel === "specified-by",
      ),
      false,
    );
    const goalCopy = path.join(parent, "goal.md");
    await execute([
      "artifact",
      "export",
      nextGoal.id,
      "--workspace",
      c.root,
      "--project",
      p,
      "--to",
      goalCopy,
    ]);
    assert.ok(
      (await fs.readFile(goalCopy, "utf8")).endsWith(
        "```json\n" + nextGoal.content + "\n```",
      ),
    );
    const spec = (
      await call("document", {
        ...input,
        kind: "spec",
        title: "材质约束",
        content: "只改纹理",
      })
    ).artifact;
    const nextSpec = (
      await call("document-revise", {
        project: p,
        id: spec.id,
        expected_version: 1,
        expected_hash: digest(spec.content),
        ...payload,
      })
    ).artifact;
    assert.equal(nextSpec.version, 2);
    const zip = path.join(parent, "project.zip");
    await exportProject(c, p, zip);
    const target = path.join(parent, "restored");
    await importProject(zip, target, { entry: entry! });
    const restored = await NativeClient.open(target);
    const restoreHistory = await restored.call("document-history", {
      project: p,
      id: design.id,
    });
    assert.deepEqual(restoreHistory, history);
    assert.equal(
      (await restored.call("show", { project: p, id: citation.id })).content,
      design.content,
    );
    const before = await restored.call("snapshot", { project: p });
    await importProject(zip, target, {});
    assert.equal(
      (await restored.call("snapshot", { project: p })).fingerprint,
      before.fingerprint,
    );
    const restoredView = await restored.call("brief", { project: p });
    assert.equal(restoredView.tasks.length, 3);
    assert.equal(
      restoredView.artifacts.filter((a: any) =>
        ["execution", "media"].includes(a.kind),
      ).length,
      0,
    );
    await fs.writeFile(
      path.join(
        process.env.RETOUCH_TEST_ROOT!,
        "native-documents-evidence.json",
      ),
      JSON.stringify(
        {
          verdict: "PASS",
          native_revision: "PASS",
          stale_revision_rejected: true,
          citation_snapshot_pinned: true,
          export_authority: "copy-only",
          legacy_archive_replay: "PASS",
          zip_history_restored: true,
          tasks_restored: restoredView.tasks.length,
          image_execution: "NOT_RUN",
        },
        null,
        2,
      ),
    );
  },
);
