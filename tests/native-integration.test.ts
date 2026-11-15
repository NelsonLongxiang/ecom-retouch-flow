import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import { NativeClient } from "../src/native/client.ts";
import {
  registerMedia,
  resizeMedia,
  completeRun,
  deliverRun,
  objectBytes,
} from "../src/native/files.ts";
import {
  exportProject,
  importProject,
  inspectProject,
} from "../src/native/exchange.ts";
import {
  registerWorkspace,
  taste,
  searchContext,
  cite,
} from "../src/native/context.ts";
import { digest, validateSnapshot } from "../src/native/plugin/commands.mjs";
import { execute } from "../src/cli.ts";

const entry = process.env.RETOUCH_TEST_YGL_ENTRY;
test(
  "原生 ygl：幂等任务、真实尺寸来源、工作流、ZIP、未知请求与全局上下文",
  { skip: !entry, timeout: 300000 },
  async (t) => {
    const parent = await fs.mkdtemp(
        path.join(process.env.RETOUCH_TEST_ROOT!, "wrapper-"),
      ),
      root = path.join(parent, "home");
    const client = await NativeClient.initialize(root, entry!);
    const emptyDb = new DatabaseSync(path.join(root, "ygl/ygl-trees.db"), {
      readOnly: true,
    });
    const tables = emptyDb
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all()
      .map((r) => r.name);
    emptyDb.close();
    let serial = 0;
    const call = (action: string, body: any, key?: string) =>
      client.call(action, body, key ?? "test-" + ++serial);
    const p = (
      await call("project-new", {
        name: "柜体修图",
        intent: "修复柜门，保留真实产品结构",
        tags: ["类目:家具", "风格:原木"],
      })
    ).project.id;
    const goal = (
      await call("goal-new", {
        project: p,
        title: "柜门高清重绘",
        scope: "柜门局部及尺寸提升",
        preserve: ["柜体结构不变"],
        done_when: "实际结果审核与交付",
        source: "user",
      })
    ).artifact;
    const newTask = {
      project: p,
      goal: goal.id,
      title: "高清重绘",
      brief: "先高清重绘，再后处理",
      expected_output: "2048px 候选",
      done_when: "用户接受实际图像并交付",
      kind: "image",
    };
    const task = (await call("task-new", newTask, "new-task")).task;
    assert.equal(
      (await call("task-new", newTask, "new-task")).task.id,
      task.id,
    );
    await assert.rejects(
      call("task-new", { ...newTask, title: "不同任务" }, "new-task"),
      { code: "REQUEST_CONFLICT" },
    );
    await call("requirements", {
      project: p,
      task: task.id,
      expected_revision: 0,
      groups: [
        {
          id: "door",
          text: "修复柜门纹理",
          disabled: false,
          scope: "operation",
        },
        { id: "off", text: "不执行这项", disabled: true, scope: "operation" },
        { id: "empty", text: " ", disabled: false, scope: "operation" },
      ],
    });
    const small = path.join(parent, "original.png"),
      rawFile = path.join(parent, "native-result.png");
    await sharp({
      create: { width: 200, height: 200, channels: 4, background: "#a89988" },
    })
      .png()
      .toFile(small);
    await sharp({
      create: { width: 1254, height: 1254, channels: 4, background: "#bdab98" },
    })
      .png()
      .toFile(rawFile);
    const original = (
      await registerMedia(
        client,
        p,
        task.id,
        small,
        { role: "original" },
        "original",
      )
    ).artifact;
    const external = (
      await registerMedia(
        client,
        p,
        task.id,
        rawFile,
        {
          role: "model-output",
          parents: [original.id],
          operation: "test fixture; no AI invocation",
        },
        "raw",
      )
    ).artifact;
    const resized = (
      await resizeMedia(client, p, external.id, 2048, 2048, "resize")
    ).artifact;
    assert.equal(JSON.parse(resized.meta).width, 2048);
    assert.equal(JSON.parse(external.meta).width, 1254);
    assert.equal(JSON.parse(original.meta).width, 200);
    const designTask = (
      await call("task-new", {
        ...newTask,
        title: "变体与七张套图方案",
        kind: "design",
      })
    ).task;
    await call("document", {
      project: p,
      task: designTask.id,
      kind: "design",
      title: "七张套图方案",
      content: "只规划七张套图；还没有实际生成",
      role: "agent-interpretation",
      source: "test fixture",
    });
    let view = await client.call("brief", { project: p });
    assert.equal(view.tasks.length, 2);
    const taskView = await execute([
      "task",
      "show",
      task.id,
      "--project",
      p,
      "--workspace",
      root,
      "--json",
    ]);
    assert.equal(taskView.result.data.progress, "waiting_for_review");
    const next = await execute([
      "next",
      task.id,
      "--project",
      p,
      "--workspace",
      root,
      "--json",
    ]);
    assert.equal(next.result.data.progress, taskView.result.data.progress);
    assert.equal(
      view.artifacts.filter(
        (a: any) =>
          a.kind === "media" && JSON.parse(a.meta).task_id === designTask.id,
      ).length,
      0,
    );
    const plan = (
      await call("plan", {
        project: p,
        task: task.id,
        input: original.id,
        expected_revision: 1,
        steps: [
          { id: "redraw", prompt: "高清重绘柜门，保留柜体结构", needs: [] },
        ],
      })
    ).plan;
    assert.equal(JSON.parse(plan.content).requirements.length, 1);
    await assert.rejects(
      call("document-revise", {
        project: p,
        id: plan.id,
        expected_version: plan.version,
        expected_hash: digest(plan.content),
        content: "绕过冻结计划",
        reason: "不应允许",
        source: "fixture",
      }),
      { code: "DOCUMENT_KIND" },
    );
    const grant = (
      await call("grant", {
        project: p,
        task: task.id,
        plan_id: plan.id,
        plan_hash: digest(JSON.parse(plan.content)),
        issuer: "host-human",
        confirmation: "隔离协议夹具授权，不代表真实用户业务授权",
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      })
    ).grant;
    let run = (
      await call("run-start", { project: p, task: task.id, grant: grant.id })
    ).execution;
    const cliArgs = [
      "run",
      "dispatch",
      run.id,
      "--workspace",
      root,
      "--project",
      p,
      "--expected-revision",
      "0",
      "--request-id",
      "dispatch",
      "--json",
    ];
    const dispatched = await execute(cliArgs),
      replayed = await execute(cliArgs);
    assert.equal(dispatched.result.data.allow_execute, true);
    assert.equal(replayed.result.data.allow_execute, false);
    assert.equal(replayed.result.replayed, true);
    await assert.rejects(
      call("run-dispatch", { project: p, id: run.id, expected_revision: 0 }),
      { code: "RUN_STATE" },
    );
    run = (await completeRun(client, p, run.id, rawFile, 1, "complete"))
      .execution;
    assert.equal(JSON.parse(run.meta).status, "waiting_for_review");
    assert.equal(
      (await completeRun(client, p, run.id, rawFile, 1, "complete")).replayed,
      true,
    );
    const candidate = await client.call("show", {
      project: p,
      id: JSON.parse(run.meta).candidate,
    });
    run = (
      await call("run-review", {
        project: p,
        id: run.id,
        expected_revision: 2,
        sha256: JSON.parse(candidate.meta).sha256,
        verdict: "PASS",
        observations: "协议夹具检查；不声称实际 AI 质量",
        reviewer: "fixture",
        source: "test fixture",
      })
    ).execution;
    const zip = path.join(parent, "context.zip");
    await exportProject(client, p, zip);
    assert.equal((await inspectProject(zip)).snapshot.project_id, p);
    const target = path.join(parent, "restored");
    const preview = await importProject(zip, target, { dryRun: true });
    assert.equal(preview.would_initialize, true);
    assert.equal(
      await fs.access(target).then(
        () => true,
        () => false,
      ),
      false,
    );
    const imported = await importProject(zip, target, { entry });
    assert.equal(imported.project_id, p);
    const restored = await NativeClient.open(target);
    assert.equal((await importProject(zip, target, {})).replayed, true);
    await assert.rejects(
      restored.call(
        "run-start",
        { project: p, task: task.id, grant: grant.id },
        "old-grant",
      ),
      { code: "GRANT_INVALID" },
    );
    view = await restored.call("brief", { project: p });
    assert.equal(view.tasks.length, 2);
    assert.equal(
      JSON.parse(view.artifacts.find((a: any) => a.id === run.id).meta).status,
      "waiting_for_acceptance",
    );
    assert.equal(
      view.artifacts.filter((a: any) => a.kind === "media").length,
      4,
    );
    const before = await restored.call("snapshot", { project: p });
    assert.ok(
      before.tables.nodes.some((n: any) => n.key === "step-" + plan.id + "-0"),
    );
    assert.ok(
      before.tables.node_state.some(
        (s: any) => s.context === run.id && s.status === "unlocked",
      ),
    );
    await registerWorkspace(client, target, [], "register");
    const global = await taste(client);
    assert.equal(global.denominator.projects, 1);
    assert.equal(global.conflicts.length, 0);
    assert.equal(global.denominator.unrated, 1);
    const hits = await searchContext(client, "七张");
    assert.ok(hits.hits.some((h: any) => h.kind === "design"));
    const sourceHit = hits.hits.find((h: any) => h.kind === "design");
    await cite(
      client,
      p,
      task.id,
      {
        ...sourceHit,
        purpose: "参考套图组织方式",
        conditions: "仅参考流程，不能作为当前商品规格",
      },
      "cite",
    );
    const split = await taste(client);
    assert.equal(split.conflicts.length, 1);
    assert.equal(split.denominator.projects, 0);
    await registerWorkspace(client, target, [p], "authority");
    assert.equal((await taste(client)).denominator.projects, 1);
    await restored.call(
      "project-feedback",
      {
        project: p,
        rating: 5,
        conclusion: "测试结语",
        source: "user",
        expected_revision: 1,
      },
      "feedback",
    );
    assert.equal((await taste(client)).frequency[0].mean_rating, 5);
    const freshGrant = (
      await restored.call(
        "grant",
        {
          project: p,
          task: task.id,
          plan_id: plan.id,
          plan_hash: digest(JSON.parse(plan.content)),
          issuer: "host-human",
          confirmation: "恢复工作区的全新测试夹具授权",
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        },
        "fresh-grant",
      )
    ).grant;
    await restored.call(
      "run-authorize",
      { project: p, id: run.id, grant: freshGrant.id, expected_revision: 3 },
      "authorize-restored",
    );
    await restored.call(
      "run-accept",
      {
        project: p,
        id: run.id,
        expected_revision: 4,
        sha256: JSON.parse(candidate.meta).sha256,
        statement: "恢复后的夹具接受，不是业务验收",
        source: "user",
      },
      "accept-restored",
    );
    await deliverRun(
      restored,
      p,
      run.id,
      path.join(parent, "restored-delivery"),
      5,
      "deliver-restored",
    );
    assert.equal(
      JSON.parse((await restored.call("show", { project: p, id: run.id })).meta)
        .status,
      "completed",
    );
    assert.equal((await importProject(zip, target, {})).replayed, true);
    assert.equal(
      (await restored.call("brief", { project: p })).profile.content.rating,
      5,
    );
    const snapshot = await restored.call("snapshot", { project: p });
    validateSnapshot(snapshot);
    const bad = structuredClone(snapshot);
    bad.tables.artifacts[0].project_id = "other";
    bad.fingerprint = digest(bad.tables);
    await assert.rejects(
      restored.call(
        "restore",
        { snapshot: bad, strategy: "restore" },
        "bad-import",
      ),
      { code: "SNAPSHOT_OWNERSHIP" },
    );
    assert.equal(
      (await restored.call("snapshot", { project: p })).fingerprint,
      snapshot.fingerprint,
    );
    const cloned = await importProject(zip, target, {
      strategy: "clone",
      name: "显式克隆",
    });
    assert.notEqual(cloned.project_id, p);
    const cloneView = await restored.call("brief", {
      project: cloned.project_id,
    });
    const mapping = JSON.parse(
      cloneView.artifacts.find((a: any) => a.kind === "provenance").content,
    );
    assert.ok(
      mapping.id_mapping.some(
        (m: any) => m.source === task.id && m.target !== task.id,
      ),
    );
    const cloneSnapshot = await restored.call("snapshot", {
      project: cloned.project_id,
    });
    assert.ok(
      cloneSnapshot.tables.nodes
        .filter((n: any) => n.key.startsWith("step-"))
        .every((n: any) =>
          n.key.startsWith("step-" + JSON.parse(n.payload).plan_id + "-"),
        ),
    );
    assert.equal(
      (await restored.call("brief", { project: cloned.project_id })).tasks
        .length,
      2,
    );
    run = (
      await call("run-accept", {
        project: p,
        id: run.id,
        expected_revision: 3,
        sha256: JSON.parse(candidate.meta).sha256,
        statement: "隔离夹具接受，不是业务用户验收",
        source: "user",
      })
    ).execution;
    await deliverRun(
      client,
      p,
      run.id,
      path.join(parent, "delivery"),
      4,
      "deliver",
    );
    assert.equal(
      JSON.parse((await client.call("show", { project: p, id: run.id })).meta)
        .status,
      "completed",
    );
    const timeline = await client.call("timeline", { project: p, id: run.id });
    assert.ok(timeline.some((e: any) => e.payload.action === "run-dispatch"));
    assert.ok(timeline.some((e: any) => e.payload.action === "run-delivered"));
    const unknownTask = (
      await call("task-new", { ...newTask, title: "未知外部请求" })
    ).task;
    const unknown = (
      await call("execution-record", {
        project: p,
        task: unknownTask.id,
        status: "unknown",
        inputs: [original.id],
        outputs: [],
        statement: "外部请求已发出，尚未确认结果",
        source: "test fixture",
        external_request: "request-unknown",
      })
    ).execution;
    await assert.rejects(
      call("requirements", {
        project: p,
        task: unknownTask.id,
        expected_revision: 0,
        groups: [],
      }),
      { code: "UNKNOWN_PENDING" },
    );
    await call("document-revise", {
      project: p,
      id: goal.id,
      expected_version: goal.version,
      expected_hash: digest(goal.content),
      reason: "修订目标范围",
      source: "user",
      content: {
        scope: "修改后的范围",
        preserve: ["结构"],
        done_when: "新验收",
        source: "user",
      },
    });
    assert.ok(
      (await client.call("brief", { project: p })).unknown_requests.some(
        (x: any) => x.id === unknown.id,
      ),
    );
    const db = new DatabaseSync(path.join(root, "ygl/ygl-trees.db"), {
      readOnly: true,
    });
    assert.deepEqual(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        )
        .all()
        .map((r) => r.name),
      tables,
    );
    db.close();
    assert.equal(
      await fs.access(path.join(root, "ledger.sqlite")).then(
        () => true,
        () => false,
      ),
      false,
    );
    for (const a of before.tables.artifacts.filter(
      (a: any) => a.kind === "media",
    ))
      await objectBytes(restored.root, JSON.parse(a.meta));
    await fs.writeFile(
      path.join(process.env.RETOUCH_TEST_ROOT!, "native-wrapper-evidence.json"),
      JSON.stringify({
        verdict: "PASS",
        engine: "0.125.0",
        home: root,
        target,
        assertions: [
          "native tables unchanged",
          "idempotent tasks",
          "200→1254→2048 actual fixture bytes",
          "dispatch replay cannot authorize second tool invocation",
          "ZIP transaction/identity/history",
          "restored permissions inactive",
          "dedup/conflict/authority",
          "unknown survives new goal",
        ],
        image_ai_generation: "NOT_RUN",
        paid_api_calls: "NOT_RUN",
      }),
    );
  },
);
