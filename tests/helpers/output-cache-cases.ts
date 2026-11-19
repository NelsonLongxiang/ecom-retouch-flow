import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import sharp from "sharp";
import {
  transform,
  renderingFingerprint,
} from "../../src/native/postprocess.ts";
import type { NativeClient } from "../../src/native/client.ts";
import { objectBytes } from "../../src/native/files.ts";
import {
  flowCommand,
  flowReadActions,
} from "../../src/native/plugin/flow-commands.mjs";
import { taskBinding } from "../../src/native/plugin/applicability.mjs";
import { digest } from "../../src/native/plugin/commands.mjs";

// Real synthetic image/CAS reads plus actual handlers. NativeClient, database,
// native CLI, child processes and image providers are never invoked by this fixture.
async function fixture() {
  const parent =
    process.env.RETOUCH_TEST_ROOT ??
    fileURLToPath(new URL("../../tmp/cache-reuse-unit/", import.meta.url));
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.realpath(await fs.mkdtemp(path.join(parent, "reuse-")));
  const project = "synthetic-project",
    taskId = "synthetic-task",
    key = "synthetic-derived-key";
  const task: any = {
    id: taskId,
    project_id: project,
    kind: "task",
    content: "",
    meta: JSON.stringify({
      status: "todo",
      retouch: {
        schema: "retouch.native/v1",
        kind: "image",
        revision: 2,
        goal_id: "goal",
        goal_version: 1,
        requirements: [],
        context_epoch: 0,
        context_status: "current",
      },
    }),
  };
  const binding = taskBinding(task, digest);
  const sourceBytes = await sharp({
    create: { width: 2, height: 1, channels: 3, background: "#335577" },
  })
    .png()
    .toBuffer();
  const outputBytes = await sharp(sourceBytes)
    .resize({ width: 2, height: 2, fit: "contain", background: "#ffffff" })
    .png()
    .toBuffer();
  async function media(
    id: string,
    bytes: Buffer,
    width: number,
    height: number,
    parents: string[],
  ) {
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    const object_path = "objects/sha256/" + sha256.slice(0, 2) + "/" + sha256;
    await fs.mkdir(path.dirname(path.join(root, object_path)), {
      recursive: true,
    });
    await fs.writeFile(path.join(root, object_path), bytes, { flag: "wx" });
    return {
      id,
      project_id: project,
      kind: "media",
      content: "",
      version: 1,
      meta: JSON.stringify({
        ...binding,
        role: "postprocess",
        sha256,
        object_path,
        bytes: bytes.length,
        width,
        height,
        mime: "image/png",
        parents,
      }),
    };
  }
  const source = await media("source", sourceBytes, 2, 1, []),
    output = await media("output", outputBytes, 2, 2, ["source"]);
  const input = {
    input_id: source.id,
    inputs: [
      {
        id: source.id,
        sha256: JSON.parse(source.meta).sha256,
        role: "snapshot output source",
      },
    ],
    operations: [
      {
        op: "resize",
        width: 2,
        height: 2,
        fit: "contain",
        background: "#ffffff",
      },
    ],
  };
  const descriptor = {
    schema: "retouch.postprocess/v1",
    ...input,
    renderer: renderingFingerprint(),
  };
  const execution: any = {
    id: "cached-execution",
    project_id: project,
    kind: "execution",
    content: JSON.stringify(descriptor),
    version: 1,
    meta: JSON.stringify({
      ...binding,
      role: "local-postprocess",
      status: "completed",
      revision: 1,
      inputs: [source.id],
      outputs: [output.id],
      renderer: descriptor.renderer,
    }),
  };
  output.meta = JSON.stringify({
    ...JSON.parse(output.meta),
    transform: {
      schema: "retouch.postprocess/v1",
      execution_id: execution.id,
      inputs: structuredClone(descriptor.inputs),
      renderer: structuredClone(descriptor.renderer),
      trace: [
        {
          operation: structuredClone(descriptor.operations[0]),
          from: { width: 2, height: 1 },
          to: { width: 2, height: 2 },
          outside_region_unchanged: null,
        },
      ],
    },
  });
  const rows: any[] = [task, source, output, execution],
    calls: any[] = [];
  const originalBody = {
    project,
    task: taskId,
    expected_revision: 2,
    descriptor,
  };
  const receipt: any = {
    action: "postprocess-prepare",
    request_id: key + ":prepare",
    intent: digest({ action: "postprocess-prepare", body: originalBody }),
    result: { execution },
  };
  const lookup = (id: string, kind?: string) => {
    const a = rows.find(
      (a) =>
        a.id === id && a.project_id === project && (!kind || a.kind === kind),
    );
    if (!a)
      throw Object.assign(new Error("missing synthetic artifact"), {
        code: "ARTIFACT",
      });
    return structuredClone(a);
  };
  const h = {
    p: { id: project },
    node: {},
    mgr: { query: async () => structuredClone(rows) },
    artifact: async (_mgr: any, id: string, _p: any, kind?: string) =>
      lookup(id, kind),
    currentTask: async () => {
      const a = lookup(taskId, "task"),
        meta = JSON.parse(a.meta);
      if (meta.retouch.context_status === "needs_review")
        throw Object.assign(new Error("synthetic context stale"), {
          code: "CONTEXT_STALE",
        });
      return { a, meta };
    },
    append: async () => {
      throw new Error("cache check must not append");
    },
    relation: async () => {
      throw new Error("cache check must not write relations");
    },
    updateTask: async () => {
      throw new Error("cache check must not update tasks");
    },
  };
  const client = {
    root,
    call: async (action: string, body: any, requestId?: string) => {
      calls.push({ action, body: structuredClone(body), requestId });
      if (action === "show") return lookup(body.id);
      if (action === "brief") return { artifacts: structuredClone(rows) };
      if (action === "receipt")
        return body.request_id === key + ":prepare"
          ? structuredClone(receipt)
          : {};
      if (action === "postprocess-prepare") {
        if (
          requestId !== key + ":prepare" ||
          digest({ action, body }) !== receipt.intent
        )
          throw Object.assign(new Error("same key, different request body"), {
            code: "REQUEST_CONFLICT",
          });
        return { execution: structuredClone(execution), replayed: true };
      }
      if (action === "postprocess-reuse") return flowCommand(action, body, h);
      throw new Error("unexpected command: " + action);
    },
  } as unknown as NativeClient;
  const setTask = (changes: Record<string, unknown>) => {
    const meta = JSON.parse(task.meta);
    Object.assign(meta.retouch, changes);
    task.meta = JSON.stringify(meta);
  };
  return {
    root,
    project,
    taskId,
    task,
    source,
    output,
    execution,
    input,
    descriptor,
    key,
    rows,
    calls,
    client,
    h,
    receipt,
    setTask,
    media,
    sourceBytes,
  };
}

export const outputCacheCases: { name: string; run: () => Promise<void> }[] = [
  {
    name: "suite cache reuses a completed derivative after non-context task revision without replaying prepare",
    run: async () => {
      const f = await fixture();
      f.setTask({ revision: 3 });
      const before = structuredClone(f.rows);
      const result = await transform(
        f.client,
        f.project,
        f.taskId,
        f.input,
        3,
        f.key,
        { reuseCompleted: true },
      );
      assert.equal(result.replayed, true);
      assert.equal(result.artifact.id, f.output.id);
      assert.equal(result.image_api_requests, 0);
      assert.equal(
        f.calls.filter((c) => c.action === "postprocess-prepare").length,
        0,
      );
      assert.equal(
        f.calls.filter((c) => c.action === "postprocess-reuse").length,
        1,
      );
      assert.deepEqual(f.rows, before);
    },
  },
  {
    name: "ordinary transform keeps exact request-key conflict across task revisions",
    run: async () => {
      const f = await fixture();
      f.setTask({ revision: 3 });
      await assert.rejects(
        transform(f.client, f.project, f.taskId, f.input, 3, f.key),
        { code: "REQUEST_CONFLICT" },
      );
    },
  },
  {
    name: "native cache check is read-only and rejects revision, descriptor and stale context",
    run: async () => {
      const f = await fixture();
      f.setTask({ revision: 3 });
      const before = structuredClone(f.rows);
      const request = {
        project: f.project,
        task: f.taskId,
        id: f.execution.id,
        expected_revision: 3,
        descriptor: f.descriptor,
      };
      assert.ok(flowReadActions.includes("postprocess-reuse"));
      const ok = await flowCommand("postprocess-reuse", request, f.h);
      assert.equal(ok.artifact.id, f.output.id);
      assert.deepEqual(f.rows, before);
      await assert.rejects(
        flowCommand(
          "postprocess-reuse",
          { ...request, expected_revision: 2 },
          f.h,
        ),
        { code: "REVISION_CONFLICT" },
      );
      await assert.rejects(
        flowCommand(
          "postprocess-reuse",
          {
            ...request,
            descriptor: {
              ...f.descriptor,
              operations: [{ op: "resize", width: 3, height: 3 }],
            },
          },
          f.h,
        ),
        { code: "RENDERER_DRIFT" },
      );
      f.setTask({ context_epoch: 1 });
      await assert.rejects(flowCommand("postprocess-reuse", request, f.h), {
        code: "POSTPROCESS_CONTEXT",
      });
      f.setTask({ context_epoch: 0, context_status: "needs_review" });
      await assert.rejects(flowCommand("postprocess-reuse", request, f.h), {
        code: "CONTEXT_STALE",
      });
    },
  },
  {
    name: "suite reuse verifies real cached output CAS rather than returning missing media",
    run: async () => {
      const f = await fixture();
      f.setTask({ revision: 3 });
      const m = JSON.parse(f.output.meta);
      const file = path.join(f.root, m.object_path),
        preserved = file + ".preserved";
      assert.equal(await fs.realpath(file), file);
      assert.ok(file.startsWith(f.root + path.sep));
      await assert.rejects(fs.lstat(preserved), { code: "ENOENT" });
      await fs.rename(file, preserved);
      await assert.rejects(
        transform(f.client, f.project, f.taskId, f.input, 3, f.key, {
          reuseCompleted: true,
        }),
        { code: "ENOENT" },
      );
      assert.equal(
        f.calls.filter((c) => c.action === "postprocess-prepare").length,
        0,
      );
    },
  },
  {
    name: "suite cache rejects corrupted CAS output even when the cached metadata remains unchanged",
    run: async () => {
      const f = await fixture();
      f.setTask({ revision: 3 });
      const m = JSON.parse(f.output.meta);
      const file = path.join(f.root, m.object_path);
      assert.equal(await fs.realpath(file), file);
      assert.ok(file.startsWith(f.root + path.sep));
      // This file is owned by this isolated fixture, never a business CAS object.
      const before = await fs.readFile(file);
      assert.equal(
        crypto.createHash("sha256").update(before).digest("hex"),
        m.sha256,
      );
      await fs.writeFile(file, Buffer.from("synthetic changed bytes"));
      await assert.rejects(
        transform(f.client, f.project, f.taskId, f.input, 3, f.key, {
          reuseCompleted: true,
        }),
        { code: "OBJECT_HASH" },
      );
      assert.equal(
        f.calls.filter((c) => c.action === "postprocess-prepare").length,
        0,
      );
    },
  },
  {
    name: "native cache check rejects output binding, explicit rejection and stale source hash",
    run: async () => {
      const f = await fixture();
      f.setTask({ revision: 3 });
      const request = {
        project: f.project,
        task: f.taskId,
        id: f.execution.id,
        expected_revision: 3,
        descriptor: f.descriptor,
      };
      const original = f.output.meta;
      f.output.meta = JSON.stringify({
        ...JSON.parse(original),
        context_epoch: 99,
      });
      await assert.rejects(flowCommand("postprocess-reuse", request, f.h), {
        code: "POSTPROCESS_CONTEXT",
      });
      f.output.meta = original;
      f.rows.push({
        id: "rejected",
        project_id: f.project,
        kind: "review",
        version: 1,
        meta: JSON.stringify({
          ...taskBinding(f.task, digest),
          role: "result-revalidation",
          media_id: f.output.id,
          sha256: JSON.parse(original).sha256,
          decision: "reject",
        }),
      });
      await assert.rejects(flowCommand("postprocess-reuse", request, f.h), {
        code: "POSTPROCESS_CONTEXT",
      });
      f.rows.pop();
      f.source.meta = JSON.stringify({
        ...JSON.parse(f.source.meta),
        sha256: "0".repeat(64),
      });
      await assert.rejects(flowCommand("postprocess-reuse", request, f.h), {
        code: "POSTPROCESS_INPUT",
      });
    },
  },
  {
    name: "unchanged ordinary request still replays its exact previous preparation",
    run: async () => {
      const f = await fixture();
      const result = await transform(
        f.client,
        f.project,
        f.taskId,
        f.input,
        2,
        f.key,
      );
      assert.equal(result.replayed, true);
      assert.equal(result.artifact.id, f.output.id);
      assert.equal(
        f.calls.filter((c) => c.action === "postprocess-prepare").length,
        1,
      );
    },
  },
  {
    name: "suite cache cannot bypass receipt action identity or changed descriptor",
    run: async () => {
      const f = await fixture();
      f.setTask({ revision: 3 });
      f.receipt.action = "different-action";
      await assert.rejects(
        transform(f.client, f.project, f.taskId, f.input, 3, f.key, {
          reuseCompleted: true,
        }),
        { code: "REQUEST_CONFLICT" },
      );
      f.receipt.action = "postprocess-prepare";
      await assert.rejects(
        transform(
          f.client,
          f.project,
          f.taskId,
          {
            ...f.input,
            operations: [{ op: "resize", width: 3, height: 3, fit: "contain" }],
          },
          3,
          f.key,
          { reuseCompleted: true },
        ),
        { code: "RENDERER_DRIFT" },
      );
      assert.equal(
        f.calls.filter((c) => c.action === "postprocess-prepare").length,
        0,
      );
    },
  },
  {
    name: "native cache check rejects missing input lineage and renderer mismatches",
    run: async () => {
      const f = await fixture();
      f.setTask({ revision: 3 });
      const request = {
        project: f.project,
        task: f.taskId,
        id: f.execution.id,
        expected_revision: 3,
        descriptor: f.descriptor,
      };
      const outputMeta = f.output.meta;
      f.output.meta = JSON.stringify({
        ...JSON.parse(outputMeta),
        parents: [],
      });
      await assert.rejects(flowCommand("postprocess-reuse", request, f.h), {
        code: "POSTPROCESS_LINEAGE",
      });
      f.output.meta = outputMeta;
      await assert.rejects(
        flowCommand(
          "postprocess-reuse",
          {
            ...request,
            descriptor: {
              ...f.descriptor,
              renderer: {
                ...f.descriptor.renderer,
                operations: "changed-renderer",
              },
            },
          },
          f.h,
        ),
        { code: "RENDERER_DRIFT" },
      );
    },
  },
  {
    name: "suite cache rechecks revision if task changes between cache lookup and native reuse",
    run: async () => {
      const f = await fixture();
      f.setTask({ revision: 3 });
      const original = f.client.call.bind(f.client);
      f.client.call = async (...args: Parameters<typeof f.client.call>) => {
        if (args[0] === "postprocess-reuse") f.setTask({ revision: 4 });
        return original(...args);
      };
      await assert.rejects(
        transform(f.client, f.project, f.taskId, f.input, 3, f.key, {
          reuseCompleted: true,
        }),
        { code: "REVISION_CONFLICT" },
      );
      assert.equal(
        f.calls.filter((c) => c.action === "postprocess-prepare").length,
        0,
      );
    },
  },
  {
    name: "incomplete executions are not reusable completed-cache facts",
    run: async () => {
      const f = await fixture();
      f.setTask({ revision: 3 });
      f.execution.meta = JSON.stringify({
        ...JSON.parse(f.execution.meta),
        status: "prepared",
      });
      const request = {
        project: f.project,
        task: f.taskId,
        id: f.execution.id,
        expected_revision: 3,
        descriptor: f.descriptor,
      };
      await assert.rejects(flowCommand("postprocess-reuse", request, f.h), {
        code: "POSTPROCESS_CONTEXT",
      });
      await assert.rejects(
        transform(f.client, f.project, f.taskId, f.input, 3, f.key, {
          reuseCompleted: true,
        }),
        { code: "REQUEST_CONFLICT" },
      );
    },
  },
];

function completionFixture(f: Awaited<ReturnType<typeof fixture>>) {
  const writes: string[] = [];
  return {
    writes,
    helpers: {
      ...f.h,
      mgr: {
        query: async (sql: string, params?: unknown[]) => {
          if (sql.startsWith("SELECT")) return structuredClone(f.rows);
          assert.match(sql, /^UPDATE artifacts SET meta=/);
          assert.ok(
            params &&
              typeof params[0] === "string" &&
              params[2] === f.execution.id,
          );
          writes.push("artifact-update");
          f.execution.meta = String(params![0]);
          return [];
        },
      },
      relation: async (...args: unknown[]) => {
        assert.equal(args[5], "produced");
        writes.push("produced-relation");
      },
    },
  };
}

async function foreignOutput(f: Awaited<ReturnType<typeof fixture>>) {
  const other = structuredClone(f.descriptor);
  other.operations[0].background = "#aa0000";
  const bytes = await sharp(f.sourceBytes)
    .resize({ width: 2, height: 2, fit: "contain", background: "#aa0000" })
    .png()
    .toBuffer();
  const image = await f.media("different-output", bytes, 2, 2, [f.source.id]);
  image.meta = JSON.stringify({
    ...JSON.parse(image.meta),
    transform: {
      schema: "retouch.postprocess/v1",
      execution_id: "other-execution",
      inputs: structuredClone(other.inputs),
      renderer: structuredClone(other.renderer),
      trace: [
        {
          operation: structuredClone(other.operations[0]),
          from: { width: 2, height: 1 },
          to: { width: 2, height: 2 },
          outside_region_unchanged: null,
        },
      ],
    },
  });
  f.rows.push(
    {
      ...structuredClone(f.execution),
      id: "other-execution",
      content: JSON.stringify(other),
      meta: JSON.stringify({
        ...JSON.parse(f.execution.meta),
        outputs: [image.id],
      }),
    },
    image,
  );
  assert.notEqual(
    JSON.parse(image.meta).sha256,
    JSON.parse(f.output.meta).sha256,
  );
  assert.equal(
    crypto
      .createHash("sha256")
      .update(
        await fs.readFile(
          path.join(f.root, JSON.parse(image.meta).object_path),
        ),
      )
      .digest("hex"),
    JSON.parse(image.meta).sha256,
  );
  return image;
}

outputCacheCases.push(
  {
    name: "review R1: complete and reuse reject a same-parent different-operation output with intact CAS",
    run: async () => {
      for (const action of ["postprocess-complete", "postprocess-reuse"]) {
        const f = await fixture(),
          other = await foreignOutput(f),
          state = JSON.parse(f.execution.meta);
        f.execution.meta = JSON.stringify({
          ...state,
          status: action === "postprocess-complete" ? "prepared" : "completed",
          outputs: action === "postprocess-complete" ? [] : [other.id],
        });
        const io = completionFixture(f),
          before = structuredClone(f.rows);
        const body =
          action === "postprocess-complete"
            ? { project: f.project, id: f.execution.id, output: other.id }
            : {
                project: f.project,
                task: f.taskId,
                id: f.execution.id,
                expected_revision: 2,
                descriptor: f.descriptor,
              };
        await assert.rejects(flowCommand(action, body, io.helpers), {
          code: "POSTPROCESS_PROVENANCE",
        });
        assert.deepEqual(io.writes, []);
        assert.deepEqual(f.rows, before);
      }
    },
  },
  {
    name: "review R1: complete and reuse reject missing or drifted transform identity, inputs, renderer and trace",
    run: async () => {
      const mutations: [string, (m: any) => void][] = [
        [
          "missing transform",
          (m) => {
            delete m.transform;
          },
        ],
        [
          "null transform",
          (m) => {
            m.transform = null;
          },
        ],
        [
          "missing inputs",
          (m) => {
            delete m.transform.inputs;
          },
        ],
        [
          "missing renderer",
          (m) => {
            delete m.transform.renderer;
          },
        ],
        [
          "null trace step",
          (m) => {
            m.transform.trace[0] = null;
          },
        ],
        [
          "execution id",
          (m) => {
            m.transform.execution_id = "other-execution";
          },
        ],
        [
          "input hash",
          (m) => {
            m.transform.inputs[0].sha256 = "0".repeat(64);
          },
        ],
        [
          "input role",
          (m) => {
            m.transform.inputs[0].role = "not the declared role";
          },
        ],
        [
          "renderer",
          (m) => {
            m.transform.renderer.operations = "changed";
          },
        ],
        [
          "trace operation",
          (m) => {
            m.transform.trace[0].operation.background = "#123456";
          },
        ],
        [
          "trace missing",
          (m) => {
            m.transform.trace = [];
          },
        ],
        [
          "trace initial frame",
          (m) => {
            m.transform.trace[0].from.width = 99;
          },
        ],
        [
          "trace final frame",
          (m) => {
            m.transform.trace[0].to.height = 99;
          },
        ],
        [
          "output dimensions",
          (m) => {
            m.height = 99;
          },
        ],
      ];
      const f = await fixture(),
        originalOutput = f.output.meta,
        originalExecution = f.execution.meta;
      for (const action of ["postprocess-complete", "postprocess-reuse"])
        for (const [label, mutate] of mutations) {
          const state = JSON.parse(originalExecution);
          f.execution.meta = JSON.stringify({
            ...state,
            status:
              action === "postprocess-complete" ? "prepared" : "completed",
            outputs: action === "postprocess-complete" ? [] : [f.output.id],
          });
          const m = JSON.parse(originalOutput);
          mutate(m);
          f.output.meta = JSON.stringify(m);
          const io = completionFixture(f),
            before = structuredClone(f.rows);
          const body =
            action === "postprocess-complete"
              ? { project: f.project, id: f.execution.id, output: f.output.id }
              : {
                  project: f.project,
                  task: f.taskId,
                  id: f.execution.id,
                  expected_revision: 2,
                  descriptor: f.descriptor,
                };
          await assert.rejects(
            flowCommand(action, body, io.helpers),
            { code: "POSTPROCESS_PROVENANCE" },
            action + ":" + label,
          );
          assert.deepEqual(io.writes, []);
          assert.deepEqual(f.rows, before);
        }
    },
  },
  {
    name: "review R1: matched provenance completes once and remains readonly reusable after revision changes",
    run: async () => {
      const f = await fixture(),
        state = JSON.parse(f.execution.meta);
      f.execution.meta = JSON.stringify({
        ...state,
        status: "prepared",
        outputs: [],
        revision: 0,
      });
      const io = completionFixture(f);
      const completed = await flowCommand(
        "postprocess-complete",
        { project: f.project, id: f.execution.id, output: f.output.id },
        io.helpers,
      );
      assert.equal(JSON.parse(completed.execution.meta).status, "completed");
      assert.deepEqual(io.writes, ["artifact-update", "produced-relation"]);
      f.setTask({ revision: 3 });
      const before = structuredClone(f.rows);
      const reused = await flowCommand(
        "postprocess-reuse",
        {
          project: f.project,
          task: f.taskId,
          id: f.execution.id,
          expected_revision: 3,
          descriptor: f.descriptor,
        },
        f.h,
      );
      assert.equal(reused.artifact.id, f.output.id);
      assert.deepEqual(f.rows, before);
    },
  },
);

outputCacheCases.push(
  {
    name: "review R1: multistep provenance binds the full operation sequence and continuous dimensions",
    run: async () => {
      const f = await fixture();
      const descriptor: any = {
        ...structuredClone(f.descriptor),
        operations: [
          {
            op: "resize",
            width: 2,
            height: 2,
            fit: "contain",
            background: "#ffffff",
          },
          {
            op: "extend",
            top: 1,
            bottom: 0,
            left: 1,
            right: 0,
            background: "#ffffff",
          },
          { op: "encode", format: "png", colourspace: "srgb" },
        ],
      };
      const pixels = await sharp(f.sourceBytes)
        .resize({ width: 2, height: 2, fit: "contain", background: "#ffffff" })
        .extend({ top: 1, bottom: 0, left: 1, right: 0, background: "#ffffff" })
        .png()
        .toBuffer();
      const image = await f.media("multistep-output", pixels, 3, 3, [
        f.source.id,
      ]);
      const proof = {
        schema: "retouch.postprocess/v1",
        execution_id: f.execution.id,
        inputs: structuredClone(descriptor.inputs),
        renderer: structuredClone(descriptor.renderer),
        trace: [
          {
            operation: structuredClone(descriptor.operations[0]),
            from: { width: 2, height: 1 },
            to: { width: 2, height: 2 },
          },
          {
            operation: structuredClone(descriptor.operations[1]),
            from: { width: 2, height: 2 },
            to: { width: 3, height: 3 },
          },
          {
            operation: structuredClone(descriptor.operations[2]),
            from: { width: 3, height: 3 },
            to: { width: 3, height: 3 },
          },
        ],
      };
      image.meta = JSON.stringify({
        ...JSON.parse(image.meta),
        transform: proof,
      });
      f.rows.push(image);
      f.execution.content = JSON.stringify(descriptor);
      f.execution.meta = JSON.stringify({
        ...JSON.parse(f.execution.meta),
        outputs: [image.id],
      });
      const request = {
        project: f.project,
        task: f.taskId,
        id: f.execution.id,
        expected_revision: 2,
        descriptor,
      };
      const before = structuredClone(f.rows);
      assert.equal(
        (await flowCommand("postprocess-reuse", request, f.h)).artifact.id,
        image.id,
      );
      assert.deepEqual(f.rows, before);
      const originalImage = image.meta,
        originalExecution = f.execution.meta;
      const mutations: [string, (m: any) => void][] = [
        [
          "broken middle input frame",
          (m) => {
            m.transform.trace[1].from.width = 1;
          },
        ],
        [
          "wrong extend result",
          (m) => {
            m.transform.trace[1].to.width = 4;
          },
        ],
        [
          "operation order reversed",
          (m) => {
            m.transform.trace.reverse();
          },
        ],
        [
          "extra operation proof",
          (m) => {
            m.transform.trace.push(structuredClone(m.transform.trace[2]));
          },
        ],
        [
          "pixel-preserving encode resized",
          (m) => {
            m.transform.trace[2].to.height = 4;
          },
        ],
      ];
      for (const [label, mutate] of mutations) {
        const m = JSON.parse(originalImage);
        mutate(m);
        image.meta = JSON.stringify(m);
        await assert.rejects(
          flowCommand("postprocess-reuse", request, f.h),
          { code: "POSTPROCESS_PROVENANCE" },
          label,
        );
      }
      image.meta = originalImage;
      for (const field of ["inputs", "renderer"]) {
        const m = JSON.parse(originalExecution);
        delete m[field];
        f.execution.meta = JSON.stringify(m);
        await assert.rejects(
          flowCommand("postprocess-reuse", request, f.h),
          { code: "POSTPROCESS_PROVENANCE" },
          "missing execution " + field,
        );
      }
      f.execution.meta = originalExecution;
    },
  },
  {
    name: "review R1: ordinary completed replay rejects the existing mismatched output without relaxing request identity",
    run: async () => {
      const f = await fixture(),
        other = await foreignOutput(f);
      f.execution.meta = JSON.stringify({
        ...JSON.parse(f.execution.meta),
        outputs: [other.id],
      });
      const before = structuredClone(f.rows);
      await assert.rejects(
        transform(f.client, f.project, f.taskId, f.input, 2, f.key),
        { code: "POSTPROCESS_PROVENANCE" },
      );
      assert.deepEqual(f.rows, before);
      assert.equal(
        f.calls.filter((c) => c.action === "postprocess-prepare").length,
        1,
        "ordinary replay still checks original exact intent first",
      );
    },
  },
);

// Exercise the actual fresh transform/registration/complete path. Only the native
// transport, request-intent store and database services below are simulated.
async function freshRenderFixture() {
  const f = await fixture();
  const requests = new Map<
    string,
    { intent: string; action: string; result: any }
  >();
  const writes: { action: string; id?: string; relation?: unknown[] }[] = [];
  let serial = 0;
  const helpers = {
    ...f.h,
    mgr: {
      query: async (sql: string, params?: any[]) => {
        if (sql.startsWith("SELECT")) return structuredClone(f.rows);
        assert.match(sql, /^UPDATE artifacts SET meta=/);
        const row = f.rows.find((a) => a.id === params?.[2]);
        assert.ok(row && typeof params?.[0] === "string");
        row.meta = params![0];
        writes.push({ action: "update", id: row.id });
        return [];
      },
    },
    append: async (
      _mgr: any,
      p: any,
      kind: string,
      title: string,
      value: any,
      meta: any,
    ) => {
      const row = {
        id: "fresh-" + kind + "-" + ++serial,
        project_id: p.id,
        kind,
        title,
        version: 1,
        content: JSON.stringify(value),
        meta: JSON.stringify(meta),
      };
      f.rows.push(row);
      writes.push({ action: "append", id: row.id });
      return structuredClone(row);
    },
    relation: async (...args: any[]) => {
      writes.push({ action: "relation", relation: args.slice(1) });
    },
  };
  const client = {
    root: f.root,
    call: async (action: string, body: any, requestId?: string) => {
      f.calls.push({ action, body: structuredClone(body), requestId });
      if (action === "show") return f.h.artifact(null, body.id, f.h.p);
      if (action === "brief") return { artifacts: structuredClone(f.rows) };
      if (action === "receipt")
        return structuredClone(requests.get(body.request_id) ?? {});
      const intent = digest({ action, body }),
        prior = requestId ? requests.get(requestId) : undefined;
      if (prior) {
        if (prior.intent !== intent)
          throw Object.assign(new Error("fixture request intent conflict"), {
            code: "REQUEST_CONFLICT",
          });
        return structuredClone(prior.result);
      }
      let result: any;
      if (action === "media") {
        const bytes = await objectBytes(f.root, body),
          actual = await sharp(bytes).metadata();
        assert.deepEqual(
          [body.width, body.height],
          [actual.width, actual.height],
        );
        const row = {
          id: "fresh-media-" + ++serial,
          project_id: f.project,
          kind: "media",
          version: 1,
          content: "",
          meta: JSON.stringify({
            schema: "retouch.native/v1",
            ...taskBinding(f.task, digest),
            role: body.role,
            sha256: body.sha256,
            object_path: body.object_path,
            bytes: body.bytes,
            width: body.width,
            height: body.height,
            mime: body.mime,
            parents: body.parents ?? [],
            operation: body.operation ?? "",
            transform: body.transform,
            confirmation: "unreviewed",
          }),
        };
        f.rows.push(row);
        writes.push({ action: "media", id: row.id });
        result = { artifact: structuredClone(row) };
      } else if (
        [
          "postprocess-prepare",
          "postprocess-complete",
          "postprocess-reuse",
        ].includes(action)
      ) {
        result = await flowCommand(action, body, helpers);
      } else throw new Error("unexpected fresh-render command: " + action);
      if (requestId)
        requests.set(requestId, structuredClone({ intent, action, result }));
      return result;
    },
  } as unknown as NativeClient;
  const image = async (id: string, bytes: Buffer) => {
    const actual = await sharp(bytes).metadata();
    const row = await f.media(id, bytes, actual.width!, actual.height!, []);
    row.meta = JSON.stringify({
      ...JSON.parse(row.meta),
      mime: "image/" + actual.format,
    });
    f.rows.push(row);
    return row;
  };
  return { ...f, client, image, requests, writes };
}

outputCacheCases.push(
  {
    name: "renderer compatibility: real resize/extend/JPEG trace completes, strictly replays and reuses after revision",
    run: async () => {
      const f = await freshRenderFixture();
      const source = await f.image(
        "transparent-source",
        await sharp({
          create: {
            width: 12,
            height: 6,
            channels: 4,
            background: { r: 51, g: 85, b: 119, alpha: 0.35 },
          },
        })
          .png()
          .toBuffer(),
      );
      const input = {
        input_id: source.id,
        inputs: [
          {
            id: source.id,
            sha256: JSON.parse(source.meta).sha256,
            role: "real synthetic transparent source",
          },
        ],
        operations: [
          {
            op: "resize",
            width: 24,
            height: 24,
            fit: "contain",
            background: "#ffffff",
          },
          {
            op: "extend",
            top: 2,
            bottom: 2,
            left: 2,
            right: 2,
            background: "#ffffff",
          },
          {
            op: "encode",
            format: "jpeg",
            quality: 90,
            background: "#ffffff",
            colourspace: "srgb",
          },
        ],
      };
      const first = await transform(
        f.client,
        f.project,
        f.taskId,
        input,
        2,
        "actual-jpeg",
      );
      assert.equal(first.replayed, false);
      assert.equal(first.image_api_requests, 0);
      const m = JSON.parse(first.artifact.meta),
        bytes = await objectBytes(f.root, m),
        actual = await sharp(bytes).metadata();
      assert.deepEqual(
        [actual.width, actual.height, actual.format, actual.hasAlpha],
        [28, 28, "jpeg", false],
      );
      assert.ok(actual.icc);
      assert.equal(JSON.parse(first.execution.meta).status, "completed");
      assert.deepEqual(
        m.transform.trace.map((s: any) => [
          s.from.width,
          s.from.height,
          s.to.width,
          s.to.height,
        ]),
        [
          [12, 6, 24, 24],
          [24, 24, 28, 28],
          [28, 28, 28, 28],
        ],
      );
      const writes = structuredClone(f.writes),
        rows = structuredClone(f.rows),
        stamp = (await fs.stat(path.join(f.root, m.object_path))).mtimeMs;
      const replay = await transform(
        f.client,
        f.project,
        f.taskId,
        input,
        2,
        "actual-jpeg",
      );
      assert.equal(replay.replayed, true);
      assert.equal(replay.artifact.id, first.artifact.id);
      f.setTask({ revision: 3 });
      const beforeReuse = structuredClone(f.rows),
        calls = f.calls.length;
      const reused = await transform(
        f.client,
        f.project,
        f.taskId,
        input,
        3,
        "actual-jpeg",
        { reuseCompleted: true },
      );
      assert.equal(reused.replayed, true);
      assert.equal(reused.artifact.id, first.artifact.id);
      assert.deepEqual(f.rows, beforeReuse);
      assert.deepEqual(f.writes, writes);
      assert.equal(f.rows.length, rows.length);
      assert.equal(
        f.calls.slice(calls).some((c) => c.action === "postprocess-prepare"),
        false,
      );
      assert.equal(
        (await fs.stat(path.join(f.root, m.object_path))).mtimeMs,
        stamp,
      );
      assert.deepEqual(await objectBytes(f.root, m), bytes);
    },
  },
  {
    name: "renderer compatibility: real repair/mask/composite/extract trace keeps sources and expected pixels",
    run: async () => {
      const f = await freshRenderFixture();
      const make = async (
        id: string,
        width: number,
        height: number,
        background: string,
      ) =>
        f.image(
          id,
          await sharp({ create: { width, height, channels: 4, background } })
            .png()
            .toBuffer(),
        );
      const source = await make("real-source", 6, 4, "#335577"),
        patch = await make("real-patch", 2, 2, "#ff0000"),
        mask = await make("real-mask", 6, 4, "#ffffff"),
        layer = await make("real-layer", 1, 1, "#0000ff");
      const input = {
        input_id: source.id,
        inputs: [source, patch, mask, layer].map((a) => ({
          id: a.id,
          sha256: JSON.parse(a.meta).sha256,
          role: "synthetic " + a.id,
        })),
        operations: [
          {
            op: "repair",
            input_id: patch.id,
            region: { x: 1, y: 1, width: 2, height: 2 },
            coordinate_system: { width: 6, height: 4 },
          },
          { op: "mask", input_id: mask.id },
          { op: "composite", input_id: layer.id, x: 5, y: 3 },
          {
            op: "extract",
            region: { x: 1, y: 1, width: 5, height: 3 },
            coordinate_system: { width: 6, height: 4 },
          },
          { op: "encode", format: "png", colourspace: "srgb" },
        ],
      };
      const result = await transform(
        f.client,
        f.project,
        f.taskId,
        input,
        2,
        "actual-pixels",
      );
      const m = JSON.parse(result.artifact.meta),
        raw = await sharp(await objectBytes(f.root, m))
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
      assert.deepEqual([raw.info.width, raw.info.height], [5, 3]);
      assert.deepEqual([...raw.data.subarray(0, 4)], [255, 0, 0, 255]);
      const at = (2 * 5 + 4) * 4;
      assert.deepEqual([...raw.data.subarray(at, at + 4)], [0, 0, 255, 255]);
      assert.deepEqual(
        m.parents,
        input.inputs.map((i) => i.id),
      );
      assert.equal(m.transform.trace[0].outside_region_unchanged, true);
      assert.deepEqual(
        m.transform.trace.map((s: any) => s.operation),
        input.operations,
      );
      assert.deepEqual(
        m.transform.trace.map((s: any) => [
          s.from.width,
          s.from.height,
          s.to.width,
          s.to.height,
        ]),
        [
          [6, 4, 6, 4],
          [6, 4, 6, 4],
          [6, 4, 6, 4],
          [6, 4, 5, 3],
          [5, 3, 5, 3],
        ],
      );
      assert.equal(JSON.parse(result.execution.meta).status, "completed");
      assert.equal(result.image_api_requests, 0);
    },
  },
  {
    name: "renderer compatibility: actual EXIF JPEG preserves encoded coordinates through trace validation",
    run: async () => {
      const f = await freshRenderFixture();
      const bytes = await sharp({
        create: { width: 6, height: 4, channels: 3, background: "#335577" },
      })
        .jpeg()
        .withMetadata({ orientation: 6 })
        .toBuffer();
      assert.equal((await sharp(bytes).metadata()).orientation, 6);
      const source = await f.image("encoded-exif-source", bytes);
      const input = {
        input_id: source.id,
        inputs: [
          {
            id: source.id,
            sha256: JSON.parse(source.meta).sha256,
            role: "EXIF synthetic encoded coordinate source",
          },
        ],
        operations: [
          {
            op: "extract",
            region: { x: 2, y: 1, width: 4, height: 3 },
            coordinate_system: { width: 6, height: 4 },
          },
          {
            op: "resize",
            width: 8,
            height: 6,
            fit: "contain",
            background: "#ffffff",
          },
          { op: "encode", format: "png", colourspace: "srgb" },
        ],
      };
      const result = await transform(
        f.client,
        f.project,
        f.taskId,
        input,
        2,
        "actual-exif",
      );
      const m = JSON.parse(result.artifact.meta),
        actual = await sharp(await objectBytes(f.root, m)).metadata();
      assert.deepEqual(
        [actual.width, actual.height, actual.orientation],
        [8, 6, undefined],
      );
      assert.deepEqual(m.transform.trace[0].from, { width: 6, height: 4 });
      assert.deepEqual(m.transform.trace[0].to, { width: 4, height: 3 });
      assert.equal(JSON.parse(result.execution.meta).status, "completed");
      assert.equal(result.image_api_requests, 0);
    },
  },
);
