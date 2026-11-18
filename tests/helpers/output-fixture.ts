import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { NativeClient } from "../../src/native/client.ts";
import { registerBytes } from "../../src/native/files.ts";
import { digest } from "../../src/native/plugin/commands.mjs";
const entry = process.env.RETOUCH_TEST_YGL_ENTRY;
export async function outputFixture(
  options: { retainRequests?: boolean } = {},
) {
  const parent = await fs.mkdtemp(
    path.join(process.env.RETOUCH_TEST_ROOT!, "outputs-"),
  );
  const c = await NativeClient.initialize(
    path.join(parent, "home"),
    entry!,
    options,
  );
  let serial = 0;
  const call = (a: string, b: any) => c.call(a, b, "outputs-" + ++serial);
  const p = (
    await call("project-new", {
      name: "Output orchestration",
      intent: "isolated synthetic pages; no image API or real acceptance",
      tags: [],
    })
  ).project.id;
  const goal = (
    await call("goal-new", {
      project: p,
      title: "Snapshot outputs",
      scope: "whole pages, ratio preserving",
      preserve: ["actual page boundaries"],
      done_when: "verify components, not real visual quality",
      source: "fixture",
    })
  ).artifact;
  const task = (
    await call("task-new", {
      project: p,
      goal: goal.id,
      title: "Page set",
      brief: "fixture pages",
      kind: "image",
      purpose: "concept",
      expected_output: "review components",
      done_when: "verify file contracts",
    })
  ).task;
  const designTask = (
    await call("task-new", {
      project: p,
      goal: goal.id,
      title: "Narrative design",
      brief: "declared reading order",
      kind: "design",
      expected_output: "native matrix",
      done_when: "declared order",
    })
  ).task;
  const design = (
    await call("document", {
      project: p,
      task: designTask.id,
      kind: "design",
      title: "Reading order",
      content:
        "Variable page count; whole-page narrative before gift meaning. No factual product or user acceptance claims.",
      role: "agent-interpretation",
      source: "fixture",
      design_type: "decision",
    })
  ).artifact;
  const image = async (w: number, h: number, bg: string, key: string) =>
    (
      await registerBytes(
        c,
        p,
        task.id,
        await sharp({
          create: { width: w, height: h, channels: 3, background: bg },
        })
          .png()
          .toBuffer(),
        { role: "postprocess" },
        key,
      )
    ).artifact;
  const snapshot = async (name: string, media: any[], old: any = null) =>
    (
      await call("suite-snapshot", {
        project: p,
        task: task.id,
        name,
        expected_id: old?.id ?? null,
        expected_revision: 0,
        slots: media.map((a, i) => ({
          id: "p" + i,
          role: "buyer question " + i,
          media_id: a.id,
          sha256: JSON.parse(a.meta).sha256,
        })),
      })
    ).artifact;
  const profile = (count: number, width = 100) => ({
    schema: "retouch.suite-output/v1",
    design: {
      artifact_id: design.id,
      version: design.version,
      content_hash: digest(design.content),
    },
    order: Array.from({ length: count }, (_, i) => "p" + i),
    gallery: { size: 2400, padding: 40, background: "#ffffff", quality: 90 },
    long: { width, gap: 8, background: "#ffffff", max_pixels: 50_000_000 },
    reading: { width: Math.min(width, 80), quality: 80 },
    overflow: "reject",
  });
  return {
    parent,
    c,
    p,
    task,
    goal,
    designTask,
    design,
    call,
    image,
    snapshot,
    profile,
  };
}
