import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { metadata } from "../src/native/plugin/value.mjs";
import {
  meta,
  latest,
  suiteView,
} from "../src/native/plugin/flow-contracts.mjs";
import {
  taskBinding,
  mediaApplicable,
  acceptedReview,
} from "../src/native/plugin/applicability.mjs";
import { digest } from "../src/native/plugin/commands.mjs";
import { objectBytes, registerBytes } from "../src/native/files.ts";
import {
  apiProfile,
  apiEndpoint,
  apiPrompt,
} from "../src/native/plugin/api-contract.mjs";
import sharp from "sharp";
import { transform } from "../src/native/postprocess.ts";
import { outputFixture } from "./helpers/output-fixture.ts";
const entry = process.env.RETOUCH_TEST_YGL_ENTRY;

test("native metadata: only absent or empty native fields become roleless records", () => {
  for (const value of [undefined, null, "", {}, "{}"])
    assert.deepEqual(metadata({ meta: value }), {});
  for (const value of [" ", "{", "not-json", '{"role":'])
    assert.throws(() => metadata({ meta: value }), { code: "METADATA_JSON" });
  for (const value of [
    "null",
    "[]",
    "false",
    "42",
    '"reference"',
    [],
    false,
    42,
  ])
    assert.throws(() => metadata({ meta: value }), { code: "METADATA_SHAPE" });
  const ordinary = {
    id: "plain",
    kind: "spec",
    project_id: "p",
    meta: "",
    version: 99,
  };
  assert.deepEqual(meta(ordinary), {});
  assert.equal(latest([ordinary], "product-invariants", "image-task"), null);
  const actual = {
    id: "actual",
    kind: "spec",
    project_id: "p",
    meta: JSON.stringify({ role: "product-invariants", task_id: "image-task" }),
    version: 1,
  };
  assert.equal(
    latest([ordinary, actual], "product-invariants", "image-task").id,
    "actual",
  );
  assert.throws(
    () =>
      latest(
        [{ ...ordinary, meta: "{broken" }, actual],
        "product-invariants",
        "image-task",
      ),
    { code: "METADATA_JSON" },
  );
  assert.equal(
    metadata({ meta: JSON.stringify({ role: "reference" }) }).role,
    "reference",
  );
});

test("ordinary governance tasks cannot provide media acceptance or retouch bindings", () => {
  const task = {
    id: "task",
    project_id: "p",
    kind: "task",
    meta: JSON.stringify({ status: "done" }),
  };
  const image = {
    id: "image",
    kind: "media",
    project_id: "p",
    meta: JSON.stringify({
      task_id: "task",
      goal_id: "goal",
      role: "candidate",
      sha256: "a".repeat(64),
    }),
  };
  const review = {
    id: "review",
    kind: "review",
    project_id: "p",
    meta: JSON.stringify({
      media_id: "image",
      sha256: "a".repeat(64),
      accepted: true,
      source: "user",
      verdict: "PASS",
    }),
  };
  assert.throws(() => taskBinding(task, digest), { code: "TASK_PROFILE" });
  assert.equal(mediaApplicable(image, task, [], digest), false);
  assert.equal(acceptedReview(review, image, task, [], digest), false);
  for (const retouch of [
    null,
    false,
    [],
    {},
    { goal_id: "g", goal_version: 1 },
  ])
    assert.throws(
      () => taskBinding({ ...task, meta: JSON.stringify({ retouch }) }, digest),
      { code: "TASK_PROFILE" },
    );
  const bound = {
    ...task,
    meta: JSON.stringify({
      retouch: {
        schema: "retouch.native/v1",
        kind: "image",
        goal_id: "goal",
        goal_version: 1,
        requirements: [],
      },
    }),
  };
  assert.equal(
    mediaApplicable(
      { ...image, project_id: "other-project" },
      bound,
      [],
      digest,
    ),
    false,
  );
});

test("suite accepted display rejects fake schema or kind even with matching user acceptance", () => {
  const profile = {
    schema: "retouch.native/v1",
    kind: "image",
    goal_id: "goal",
    goal_version: 1,
    requirements: [],
    context_status: "current",
    context_epoch: 0,
  };
  const task = {
    id: "task",
    kind: "task",
    project_id: "p",
    meta: JSON.stringify({ retouch: profile }),
  };
  const binding = taskBinding(task, digest),
    sha256 = "b".repeat(64);
  const image = {
    id: "image",
    kind: "media",
    project_id: "p",
    meta: JSON.stringify({ ...binding, role: "candidate", sha256 }),
  };
  const review = {
    id: "review",
    kind: "review",
    project_id: "p",
    meta: JSON.stringify({
      ...binding,
      media_id: image.id,
      sha256,
      accepted: true,
      source: "user",
      verdict: "PASS",
    }),
  };
  const snapshot = {
    id: "suite",
    kind: "spec",
    project_id: "p",
    version: 1,
    content: JSON.stringify({
      schema: "retouch.suite/v1",
      name: "synthetic",
      slots: [{ id: "one", role: "test", media_id: image.id, sha256, binding }],
    }),
  };
  const valid = suiteView(snapshot, [task, image, review]).slots[0];
  assert.equal(valid.current, true);
  assert.equal(valid.accepted, true);
  for (const changes of [
    { schema: undefined },
    { schema: "fake-native" },
    { kind: undefined },
    { kind: "governance" },
  ]) {
    const corrupt = {
      ...task,
      meta: JSON.stringify({ retouch: { ...profile, ...changes } }),
    };
    assert.throws(() => suiteView(snapshot, [corrupt, image, review]), {
      code: "TASK_PROFILE",
    });
    assert.throws(
      () =>
        acceptedReview(
          review,
          image,
          corrupt,
          [corrupt, image, review],
          digest,
        ),
      { code: "TASK_PROFILE" },
    );
    assert.equal(
      JSON.parse(review.meta).accepted,
      true,
      "original review record remains untouched",
    );
  }
});

test(
  "mixed native documents and governance tasks preserve retouch brief/invariants/transform and atomic rejection",
  { skip: !entry, timeout: 300000 },
  async () => {
    const f = await outputFixture({ retainRequests: true }),
      { c, p, task } = f;
    const nativeProjectName = (await c.call("brief", { project: p })).project
      .name;
    const plain = await c.raw([
      "produce",
      "spec",
      "Plain governance spec",
      "--project",
      nativeProjectName,
      "--body",
      "A native note without ecommerce metadata",
    ]);
    const otherPlain = await c.raw([
      "produce",
      "spec",
      "Another plain native spec",
      "--project",
      nativeProjectName,
      "--body",
      "A second native note",
    ]);
    assert.equal(plain.meta, "");
    assert.equal(otherPlain.meta, "");
    const governance = await c.raw([
      "task",
      "add",
      "Native governance, not retouch acceptance",
      "--project",
      nativeProjectName,
    ]);
    assert.equal(metadata(governance).retouch, undefined);
    const state = () => {
      const db = new DatabaseSync(path.join(c.root, "ygl", "ygl-trees.db"), {
        readOnly: true,
      });
      try {
        return {
          artifacts: db.prepare("SELECT * FROM artifacts ORDER BY id").all(),
          relations: db.prepare("SELECT * FROM relations ORDER BY id").all(),
          commands: db
            .prepare(
              "SELECT * FROM events WHERE kind='retouch.command' ORDER BY id",
            )
            .all(),
        };
      } finally {
        db.close();
      }
    };
    const nativeRows = () =>
      state().artifacts.filter((a: any) =>
        [plain.id, otherPlain.id, governance.id].includes(a.id),
      );
    const nativeBefore = nativeRows();
    const beforeView = state();
    const brief = await c.call("brief", { project: p });
    assert.deepEqual(state(), beforeView, "brief must be read-only");
    const nativeTask = brief.tasks.find((a: any) => a.id === governance.id);
    assert.equal(nativeTask.progress, "native_task");
    assert.equal(nativeTask.workflow_scope, "native");
    assert.deepEqual(nativeTask.image_outputs, []);
    assert.equal(
      brief.next_actions.some((a: any) => a.id === governance.id),
      false,
    );
    assert.equal(
      brief.business_health.findings.some(
        (a: any) => a.task_id === governance.id,
      ),
      false,
    );
    const source = (
      await f.call("document", {
        project: p,
        task: task.id,
        kind: "spec",
        title: "Required panel source",
        content: "Keep the panel unchanged.",
        role: "user-original",
        source: "synthetic owner",
      })
    ).artifact;
    const current = () => c.call("task-view", { project: p, id: task.id });
    const revision = (await current()).task.meta.retouch.revision;
    const spec = {
      schema: "retouch.invariants/v1",
      items: [
        {
          id: "panel",
          text: "Keep panel unchanged",
          scope: "synthetic visible product",
          required: true,
          source: {
            artifact_id: source.id,
            quote: "Keep the panel unchanged.",
          },
        },
      ],
    };
    const contract = (
      await f.call("invariants-set", {
        project: p,
        task: task.id,
        expected_revision: revision,
        invariants: spec,
      })
    ).artifact;
    const image = await f.image(16, 16, "#334455", "mixed-input"),
      im = JSON.parse(image.meta);
    const beforeInspect = state();
    assert.equal(
      (await c.call("invariant-view", { project: p, id: image.id })).status,
      "NOT_EVALUATED",
    );
    assert.deepEqual(state(), beforeInspect);
    const inspection = (
      await f.call("invariants-check", {
        project: p,
        id: image.id,
        sha256: im.sha256,
        contract_id: contract.id,
        method: "fixture",
        reviewer: "fixture",
        source: "fixture",
        items: [
          {
            id: "panel",
            verdict: "FAIL",
            observations: "Synthetic panel mismatch",
            evidence: "given observation, not real visual review",
          },
        ],
      })
    ).artifact;
    const oldFail = state().artifacts.find((a: any) => a.id === inspection.id);
    const foreignProject = (
      await f.call("project-new", {
        name: "Unrelated isolated project",
        intent: "must not own the other project task",
        tags: [],
      })
    ).project.id;
    const unchanged = state();
    await assert.rejects(
      f.call("media-review", {
        project: p,
        id: image.id,
        sha256: im.sha256,
        verdict: "PASS",
        accepted: true,
        reviewer: "fixture",
        source: "user",
        observations: "must not override required FAIL",
      }),
      { code: "INVARIANTS_PENDING", effectStatus: "none" },
    );
    await assert.rejects(
      f.call("invariants-set", {
        project: p,
        task: governance.id,
        expected_revision: 0,
        invariants: spec,
      }),
      { code: "TASK_PROFILE", effectStatus: "none" },
    );
    await assert.rejects(
      f.call("invariants-set", {
        project: foreignProject,
        task: task.id,
        expected_revision: revision + 1,
        invariants: spec,
      }),
      { code: "NOT_FOUND", effectStatus: "none" },
    );
    assert.deepEqual(
      state(),
      unchanged,
      "rejected writes must not append artifacts/relations/retouch receipts",
    );
    const beforeBytes = await objectBytes(c.root, im);
    const converted = await transform(
      c,
      p,
      task.id,
      {
        input_id: image.id,
        inputs: [
          {
            id: image.id,
            sha256: im.sha256,
            role: "actual synthetic product image",
          },
        ],
        operations: [
          {
            op: "resize",
            width: 8,
            height: 8,
            fit: "contain",
            background: "#ffffff",
          },
        ],
      },
      (await current()).task.meta.retouch.revision,
      "mixed-local-transform",
    );
    assert.equal(JSON.parse(converted.execution.meta).status, "completed");
    assert.equal(JSON.parse(converted.artifact.meta).width, 8);
    assert.deepEqual(await objectBytes(c.root, im), beforeBytes);
    assert.equal(
      (await c.call("invariant-view", { project: p, id: image.id })).status,
      "FAIL",
    );
    assert.deepEqual(
      state().artifacts.find((a: any) => a.id === inspection.id),
      oldFail,
    );
    assert.deepEqual(
      nativeRows(),
      nativeBefore,
      "ordinary native objects remain byte-for-byte unchanged",
    );
    const latestRevision = (await current()).task.meta.retouch.revision;
    const offlineStep = {
      id: "offline",
      prompt:
        "Synthetic metadata compatibility request; not sent to any service",
      needs: [],
    };
    const offlinePlan = {
      project: p,
      task: task.id,
      input: image.id,
      purpose: "concept",
      expected_revision: latestRevision,
      steps: [offlineStep],
    };
    const originalGovernanceMeta = (
      state().artifacts.find((a: any) => a.id === governance.id) as any
    ).meta;
    const injection = new DatabaseSync(
      path.join(c.root, "ygl", "ygl-trees.db"),
    );
    try {
      injection.prepare("UPDATE artifacts SET meta=? WHERE id=?").run(
        JSON.stringify({
          status: "done",
          retouch: { schema: "not-retouch", kind: "image" },
        }),
        governance.id,
      );
    } finally {
      injection.close();
    }
    const fakeBefore = state();
    await assert.rejects(c.call("brief", { project: p }), {
      code: "TASK_PROFILE",
      effectStatus: "none",
    });
    await assert.rejects(
      f.call("invariants-set", {
        project: p,
        task: governance.id,
        expected_revision: 0,
        invariants: spec,
      }),
      { code: "TASK_PROFILE", effectStatus: "none" },
    );
    assert.deepEqual(
      state(),
      fakeBefore,
      "fake retouch metadata is not downgraded to a safe roleless native task",
    );
    // Restore only this explicitly injected synthetic row; no business workspace is accessed.
    const restoration = new DatabaseSync(
      path.join(c.root, "ygl", "ygl-trees.db"),
    );
    try {
      restoration
        .prepare("UPDATE artifacts SET meta=? WHERE id=?")
        .run(originalGovernanceMeta, governance.id);
    } finally {
      restoration.close();
    }
    assert.deepEqual(nativeRows(), nativeBefore);
    const beforeBad = state();
    // Fault injection only in this synthetic isolated database, never a business workspace.
    const db = new DatabaseSync(path.join(c.root, "ygl", "ygl-trees.db"));
    try {
      db.prepare("UPDATE artifacts SET meta=? WHERE id=?").run(
        "{broken",
        plain.id,
      );
    } finally {
      db.close();
    }
    const corruptBefore = state();
    for (const [action, body] of [
      ["brief", { project: p }],
      ["invariant-view", { project: p, id: image.id }],
      ["plan", offlinePlan],
      [
        "invariants-set",
        {
          project: p,
          task: task.id,
          expected_revision: latestRevision,
          invariants: spec,
        },
      ],
    ] as const)
      await assert.rejects(c.call(action, body, "corrupt-meta-" + action), {
        code: "METADATA_JSON",
        effectStatus: "none",
      });
    assert.deepEqual(
      state(),
      corruptBefore,
      "malformed nonempty metadata rejects without domain writes",
    );
    assert.equal(beforeBad.artifacts.length, corruptBefore.artifacts.length);
    // Restore only injected synthetic data, then test the other former SQL
    // metadata reader with both malformed and legitimately empty execution meta.
    const restoreSpec = new DatabaseSync(
      path.join(c.root, "ygl", "ygl-trees.db"),
    );
    try {
      restoreSpec
        .prepare("UPDATE artifacts SET meta=? WHERE id=?")
        .run(plain.meta, plain.id);
    } finally {
      restoreSpec.close();
    }
    const executionId = converted.execution.id,
      executionMeta = converted.execution.meta;
    const malformedExecution = new DatabaseSync(
      path.join(c.root, "ygl", "ygl-trees.db"),
    );
    try {
      malformedExecution
        .prepare("UPDATE artifacts SET meta=? WHERE id=?")
        .run("{broken", executionId);
    } finally {
      malformedExecution.close();
    }
    const corruptExecutionBefore = state();
    await assert.rejects(
      c.call("plan", offlinePlan, "corrupt-execution-plan"),
      { code: "METADATA_JSON", effectStatus: "none" },
    );
    assert.deepEqual(state(), corruptExecutionBefore);
    const rolelessExecution = new DatabaseSync(
      path.join(c.root, "ygl", "ygl-trees.db"),
    );
    try {
      rolelessExecution
        .prepare("UPDATE artifacts SET meta=? WHERE id=?")
        .run("", executionId);
    } finally {
      rolelessExecution.close();
    }
    const definition = apiProfile({
      schema: "retouch.api-profile/v1",
      protocol: "openai-images-edits/v1",
      base_env: "RETOUCH_OFFLINE_API_BASE",
      credential_env: "RETOUCH_OFFLINE_API_KEY",
      model: "synthetic-offline-image-model",
    });
    const endpointFingerprint = digest(
      apiEndpoint("https://example.invalid/v1", definition),
    );
    const profile = (
      await f.call("executor-register", {
        project: p,
        title: "Offline preparation only",
        profile: definition,
        endpoint_fingerprint: endpointFingerprint,
      })
    ).profile;
    const oldFetch = globalThis.fetch;
    let fetchCalls = 0;
    let dispatch: any, workflowRun: any;
    try {
      globalThis.fetch = async () => {
        fetchCalls++;
        throw new Error(
          "Network forbidden in mixed-native preparation fixture",
        );
      };
      const planned = await c.call(
        "plan",
        { ...offlinePlan, fallback: { profile_id: profile.id } },
        "mixed-offline-plan",
      );
      const frozen = JSON.parse(planned.plan.content);
      assert.equal(
        frozen.facts_id,
        null,
        "ordinary empty native specs are not product-facts",
      );
      assert.equal(frozen.contracts.invariants_id, contract.id);
      const terms = {
        ...frozen.fallback,
        max_requests: 1,
        cost_confirmation: "Synthetic no-charge fixture, no actual request",
        upload_confirmation:
          "Synthetic local intent only; no network transmission",
      };
      const grant = (
        await f.call("grant", {
          project: p,
          task: task.id,
          plan_id: planned.plan.id,
          plan_hash: planned.plan_hash,
          issuer: "host-human",
          confirmation:
            "Synthetic fixture approval only; not business permission",
          expires_at: new Date(Date.now() + 3600000).toISOString(),
          api_fallback: terms,
        })
      ).grant;
      workflowRun = (
        await f.call("run-start", {
          project: p,
          task: task.id,
          grant: grant.id,
        })
      ).execution;
      assert.equal(JSON.parse(workflowRun.meta).status, "prepared");
      const restoreExecution = new DatabaseSync(
        path.join(c.root, "ygl", "ygl-trees.db"),
      );
      try {
        restoreExecution
          .prepare("UPDATE artifacts SET meta=? WHERE id=?")
          .run(executionMeta, executionId);
      } finally {
        restoreExecution.close();
      }
      const png = await sharp(beforeBytes)
        .toColourspace("srgb")
        .ensureAlpha()
        .png()
        .toBuffer();
      const upload = (
        await registerBytes(
          c,
          p,
          task.id,
          png,
          {
            role: "reference",
            parents: [image.id],
            operation: "Offline synthetic API transport preparation",
          },
          "mixed-offline-upload",
        )
      ).artifact;
      const descriptor = {
        profile_id: profile.id,
        profile_hash: terms.profile_hash,
        endpoint_fingerprint: endpointFingerprint,
        model: definition.model,
        size: definition.size,
        quality: definition.quality,
        prompt: apiPrompt(
          frozen.steps[0],
          frozen.requirements,
          JSON.parse(f.goal.content).preserve,
        ),
        uploads: {
          input: JSON.parse(upload.meta).sha256,
          references: [],
          mask: null,
        },
      };
      dispatch = await c.call(
        "run-api-dispatch",
        {
          project: p,
          id: workflowRun.id,
          expected_revision: 0,
          profile_id: profile.id,
          endpoint_fingerprint: endpointFingerprint,
          operation_key: "mixed-offline-operation",
          request_digest: digest(descriptor),
          uploads: { input_id: upload.id, reference_ids: [], mask_id: null },
        },
        "mixed-offline-dispatch",
      );
      assert.equal(
        dispatch.allow_execute,
        true,
        "only local dispatch intent, never executed",
      );
      const execution = JSON.parse(dispatch.execution.meta);
      assert.equal(execution.status, "dispatched");
      assert.equal(
        execution.api_intent.operation_key,
        "mixed-offline-operation",
      );
      assert.equal(execution.api_intent.request_digest, digest(descriptor));
      assert.equal(execution.api_attempts.length, 1);
      const afterIntent = state();
      const replay = await c.call(
        "run-api-dispatch",
        {
          project: p,
          id: workflowRun.id,
          expected_revision: 0,
          profile_id: profile.id,
          endpoint_fingerprint: endpointFingerprint,
          operation_key: "mixed-offline-operation",
          request_digest: digest(descriptor),
          uploads: { input_id: upload.id, reference_ids: [], mask_id: null },
        },
        "mixed-offline-dispatch",
      );
      assert.equal(replay.replayed, true);
      assert.deepEqual(
        state(),
        afterIntent,
        "intent replay creates no second local attempt",
      );
    } finally {
      globalThis.fetch = oldFetch;
    }
    assert.equal(
      fetchCalls,
      0,
      "no provider request or network API is invoked",
    );
    assert.equal(
      (await c.call("invariant-view", { project: p, id: image.id })).status,
      "FAIL",
    );
    assert.deepEqual(
      state().artifacts.find((a: any) => a.id === inspection.id),
      oldFail,
    );
    assert.deepEqual(
      nativeRows(),
      nativeBefore,
      "ordinary governance records remain unchanged through plan/grant/run/API intent",
    );
    assert.deepEqual(await objectBytes(c.root, im), beforeBytes);
    await fs.writeFile(
      path.join(
        process.env.RETOUCH_TEST_ROOT!,
        "native-mixed-metadata-evidence.json",
      ),
      JSON.stringify({
        verdict: "PASS",
        native_empty_meta_documents: 2,
        ordinary_governance_task_preserved: true,
        brief_readonly: true,
        view_and_set_work: true,
        local_transform_completed: true,
        plan_grant_run_start_and_api_intent_prepared: true,
        empty_execution_meta_handled_before_task_filter: true,
        malformed_spec_and_execution_plan_rejected: true,
        local_api_intent_replay_idempotent: true,
        network_requests: 0,
        old_FAIL_preserved: true,
        governance_not_accepted: true,
        malformed_nonempty_meta_rejected: true,
        foreign_existing_project_refused: true,
        fake_retouch_metadata_refused: true,
        rejected_writes_effect_none: true,
        real_business_access: 0,
        models: 0,
      }) + "\n",
      { flag: "wx" },
    );
  },
);
