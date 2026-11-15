import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { NativeClient } from "../src/native/client.ts";
import {
  completeRun,
  registerMedia,
  objectBytes,
} from "../src/native/files.ts";
import { digest } from "../src/native/plugin/commands.mjs";
import {
  exportProject,
  inspectProject,
  importProject,
} from "../src/native/exchange.ts";
import {
  registerWorkspace,
  searchContext,
  cite,
  citationStatus,
  taste,
} from "../src/native/context.ts";
import { readZip, writeZip } from "../src/infrastructure/zip.ts";
import { execute } from "../src/cli.ts";
const entry = process.env.RETOUCH_TEST_YGL_ENTRY;
async function fixture() {
  const parent = await fs.mkdtemp(
      path.join(process.env.RETOUCH_TEST_ROOT!, "safety-"),
    ),
    c = await NativeClient.initialize(path.join(parent, "home"), entry!);
  let n = 0;
  const call = (action: string, body: any) =>
    c.call(action, body, "safety-" + ++n);
  const p = (
    await call("project-new", {
      name: "保持区测试",
      intent: "验证局部合成及边界",
      tags: ["风格:原木"],
    })
  ).project.id;
  const goal = (
    await call("goal-new", {
      project: p,
      title: "局部保持",
      scope: "2×2 区域",
      preserve: ["其余像素"],
      done_when: "实际检查",
      source: "fixture",
    })
  ).artifact;
  const task = (
    await call("task-new", {
      project: p,
      goal: goal.id,
      title: "局部修改",
      brief: "测试夹具",
      expected_output: "图片",
      done_when: "检查",
      kind: "image",
    })
  ).task;
  return { parent, c, call, p, goal, task };
}
test(
  "局部合成、并发派发、版本冲突、畸形 ZIP 及事务回滚",
  { skip: !entry, timeout: 180000 },
  async () => {
    const { parent, c, call, p, task } = await fixture(),
      file = path.join(parent, "input.png"),
      output = path.join(parent, "output.png");
    await sharp({
      create: { width: 8, height: 8, channels: 4, background: "#ffffff" },
    })
      .png()
      .toFile(file);
    await sharp({
      create: { width: 8, height: 8, channels: 4, background: "#aa0000" },
    })
      .png()
      .toFile(output);
    const input = (
      await registerMedia(c, p, task.id, file, { role: "original" }, "input")
    ).artifact;
    const plan = (
      await call("plan", {
        project: p,
        task: task.id,
        input: input.id,
        expected_revision: 0,
        steps: [
          {
            id: "r",
            prompt: "修改该区域",
            needs: [],
            region: { x: 2, y: 2, width: 2, height: 2 },
          },
        ],
      })
    ).plan;
    const grant = (
      await call("grant", {
        project: p,
        task: task.id,
        plan_id: plan.id,
        plan_hash: digest(JSON.parse(plan.content)),
        issuer: "host-human",
        confirmation: "测试夹具授权",
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      })
    ).grant;
    const run = (
      await call("run-start", { project: p, task: task.id, grant: grant.id })
    ).execution;
    const args = [
      "run",
      "dispatch",
      run.id,
      "--project",
      p,
      "--workspace",
      c.root,
      "--expected-revision",
      "0",
      "--request-id",
      "concurrent-dispatch",
      "--json",
    ];
    const races = await Promise.allSettled([execute(args), execute(args)]),
      success = races.filter(
        (r): r is PromiseFulfilledResult<any> => r.status === "fulfilled",
      );
    assert.equal(
      success.filter((r) => r.value.result.data.allow_execute === true).length,
      1,
    );
    assert.equal((await execute(args)).result.data.allow_execute, false);
    const candidate = (await completeRun(c, p, run.id, output, 1, "completed"))
      .execution;
    const media = await c.call("show", {
      project: p,
      id: JSON.parse(candidate.meta).candidate,
    });
    const originalPixels = await sharp(
        await objectBytes(c.root, JSON.parse(input.meta)),
      )
        .ensureAlpha()
        .raw()
        .toBuffer(),
      pixels = await sharp(await objectBytes(c.root, JSON.parse(media.meta)))
        .ensureAlpha()
        .raw()
        .toBuffer();
    let inside = 0,
      outside = 0;
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        const changed = !originalPixels
          .subarray((y * 8 + x) * 4, (y * 8 + x + 1) * 4)
          .equals(pixels.subarray((y * 8 + x) * 4, (y * 8 + x + 1) * 4));
        if (changed) {
          if (x >= 2 && x < 4 && y >= 2 && y < 4) inside++;
          else outside++;
        }
      }
    assert.equal(inside, 4);
    assert.equal(outside, 0);
    await assert.rejects(
      call("project-feedback", {
        project: p,
        rating: 0,
        source: "user",
        expected_revision: 1,
      }),
      { code: "RATING" },
    );
    const zip = path.join(parent, "good.zip");
    await exportProject(c, p, zip);
    const published = await fs.readFile(zip);
    await assert.rejects(exportProject(c, p, zip));
    assert.deepEqual(await fs.readFile(zip), published);
    const entries = await readZip(zip);
    entries.set("BRIEF.md", Buffer.from("tampered"));
    const bad = path.join(parent, "bad.zip");
    await writeZip(bad, entries);
    await assert.rejects(inspectProject(bad), { code: "ZIP_HASH" });
    const snapshot = (await inspectProject(zip)).snapshot;
    // This collision is only discovered after project rows would have been inserted; the transaction must roll back all of them.
    const target = await NativeClient.initialize(
      path.join(parent, "target"),
      entry!,
    );
    const other = (
      await target.call(
        "project-new",
        { name: "占用树名", intent: "用于冲突测试", tags: [] },
        "other",
      )
    ).project;
    const collision = structuredClone(snapshot);
    collision.tables.trees[0].name = "retouch-" + other.id;
    collision.fingerprint = digest(collision.tables);
    const before = await target.call("projects", {});
    await assert.rejects(
      target.call(
        "restore",
        { snapshot: collision, strategy: "restore" },
        "transaction-conflict",
      ),
    );
    assert.deepEqual(await target.call("projects", {}), before);
    const dry = await importProject(zip, c.root, {
      dryRun: true,
      strategy: "clone",
      name: "克隆预检",
    });
    assert.equal(dry.can_restore, true);
  },
);
test(
  "引用保持精确版本，来源更新和工作区失联明确诊断",
  { skip: !entry, timeout: 180000 },
  async () => {
    const { parent, c, call, p, task } = await fixture();
    const design = (
      await call("document", {
        project: p,
        task: task.id,
        kind: "design",
        title: "原木材质设计",
        content: "保留真实木纹和柜体结构；只调整表面视觉",
        role: "agent-interpretation",
        source: "fixture",
      })
    ).artifact;
    const source = await searchContext(c, "木纹"),
      hit = source.hits.find((x: any) => x.artifact_id === design.id);
    const citation = (
      await cite(
        c,
        p,
        task.id,
        { ...hit, purpose: "参考保持项", conditions: "不作为新商品事实" },
        "citation",
      )
    ).artifact;
    await call("document-revise", {
      project: p,
      id: design.id,
      expected_version: design.version,
      expected_hash: digest(design.content),
      reason: "补充光照条件",
      content: "新版设计补充光照条件",
      role: "agent-interpretation",
      source: "fixture",
    });
    assert.equal(
      (await citationStatus(c, p)).find((x) => x.citation_id === citation.id)
        ?.status,
      "stale",
    );
    assert.equal(
      (await c.call("show", { project: p, id: citation.id })).content,
      design.content,
    );
    const remote = await NativeClient.initialize(
      path.join(parent, "remote"),
      entry!,
    );
    await registerWorkspace(c, remote.root, [], "register");
    const config = path.join(remote.root, "workspace.json"),
      moved = path.join(remote.root, "workspace.unavailable-fixture.json");
    await fs.rename(config, moved);
    try {
      const view = await taste(c);
      assert.equal(view.unavailable.length, 1);
      assert.equal(view.denominator.projects, 1);
    } finally {
      await fs.rename(moved, config);
    }
    const citationZip = path.join(parent, "citations.zip");
    await exportProject(c, p, citationZip);
    const cloned = await importProject(citationZip, c.root, {
      strategy: "clone",
      name: "引用克隆",
    });
    const cloneView = await c.call("brief", { project: cloned.project_id });
    const cloneCitation = cloneView.artifacts.find(
      (a: any) => a.kind === "citation",
    );
    assert.equal(JSON.parse(cloneCitation.meta).citation.source_project, p);
    assert.notEqual(JSON.parse(cloneCitation.meta).task_id, task.id);
  },
);
