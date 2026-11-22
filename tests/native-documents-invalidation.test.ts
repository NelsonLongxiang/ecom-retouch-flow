import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { outputFixture } from "./helpers/output-fixture.ts";
import { digest } from "../src/native/plugin/commands.mjs";
import { NativeClient } from "../src/native/client.ts";
import { RetouchError } from "../src/domain/model.ts";
const options = { skip: !process.env.RETOUCH_TEST_YGL_ENTRY, timeout: 300000 };
function state(root: string) {
  const db = new DatabaseSync(path.join(root, "ygl", "ygl-trees.db"), {
    readOnly: true,
  });
  try {
    return {
      artifacts: db.prepare("SELECT * FROM artifacts ORDER BY id").all(),
      relations: db.prepare("SELECT * FROM relations ORDER BY id").all(),
      nodes: db.prepare("SELECT * FROM nodes ORDER BY id").all(),
      node_state: db
        .prepare("SELECT * FROM node_state ORDER BY node_id,context")
        .all(),
      events: db
        .prepare("SELECT * FROM events WHERE kind<>'cmd.run' ORDER BY id")
        .all(),
    };
  } finally {
    db.close();
  }
}
async function nativeDocument(f: any, kind: string, title: string) {
  const name = (await f.c.call("brief", { project: f.p })).project.name;
  return f.c.raw([
    "produce",
    kind,
    title,
    "--project",
    name,
    "--body",
    "Synthetic native governance document; no business content",
    ...(kind === "design" ? ["--design-type", "decision"] : []),
  ]);
}
async function governance(f: any) {
  const name = (await f.c.call("brief", { project: f.p })).project.name;
  return f.c.raw([
    "task",
    "add",
    "Ordinary native governance",
    "--project",
    name,
  ]);
}
async function link(f: any, task: string, doc: string, rel = "decided-by") {
  return f.c.raw([
    "rel",
    "add",
    "task:" + task,
    "artifact:" + doc,
    "--rel",
    rel,
  ]);
}
const revise = (f: any, doc: any, key: string) =>
  f.c.call(
    "document-revise",
    {
      project: f.p,
      id: doc.id,
      expected_version: doc.version,
      expected_hash: digest(doc.content),
      content: "Synthetic revised document",
      reason: "Isolated #26 type propagation test",
      source: "fixture",
    },
    key,
  );
async function dependent(f: any, title: string, dependencies: string[]) {
  return (
    await f.call("task-new", {
      project: f.p,
      goal: f.goal.id,
      title,
      brief: "Synthetic dependency propagation",
      kind: "design",
      expected_output: "fixture",
      done_when: "fixture",
      dependencies,
    })
  ).task;
}

test(
  "#26 document revision handles no/native/retouch/mixed consumers with atomic history and replay",
  options,
  async () => {
    const failures: any[] = [];
    for (const scope of ["none", "native", "retouch", "mixed"]) {
      const f = await outputFixture({ retainRequests: true });
      const owner = scope === "retouch" || scope === "mixed" ? f.task : null;
      const ordinary =
        scope === "native" || scope === "mixed" ? await governance(f) : null;
      // Public retouch task-new requires a real retouch node for dependencies.
      // Ordinary governance artifacts stay node-less; do not invent unsupported dependencies.
      const child = owner
        ? await dependent(f, "Retouch dependent", [owner.id])
        : null;
      const grandchild = child
        ? await dependent(f, "Indirect retouch dependent", [child.id])
        : null;
      for (const kind of ["spec", "design"]) {
        const doc = await nativeDocument(
          f,
          kind,
          "Revision " + scope + " " + kind,
        );
        if (ordinary)
          await link(
            f,
            ordinary.id,
            doc.id,
            kind === "spec" ? "specified-by" : "decided-by",
          );
        if (owner) await link(f, owner.id, doc.id, "specified-by");
        const before = state(f.c.root),
          ordinaryBefore = ordinary
            ? before.artifacts.find((a: any) => a.id === ordinary.id)
            : null;
        let result: any;
        try {
          result = await revise(f, doc, "revise-" + scope + "-" + kind);
        } catch (error) {
          assert.deepEqual(
            state(f.c.root),
            before,
            "rejected revision must rollback native domain changes",
          );
          assert.deepEqual(
            await f.c.call("receipt", {
              request_id: "revise-" + scope + "-" + kind,
            }),
            {},
          );
          failures.push({
            scope,
            kind,
            code: (error as any).code,
            message: (error as any).message,
            domain_rollback: true,
          });
          continue;
        }
        assert.equal(result.artifact.version, 2);
        assert.equal(result.artifact.title, doc.title);
        assert.equal(
          (await f.c.call("show", { project: f.p, id: doc.id })).content,
          doc.content,
        );
        assert.ok(
          state(f.c.root).relations.some(
            (r: any) =>
              r.src_id === doc.id &&
              r.dst_id === result.artifact.id &&
              r.rel === "superseded-by",
          ),
        );
        if (ordinary) {
          assert.deepEqual(
            state(f.c.root).artifacts.find((a: any) => a.id === ordinary.id),
            ordinaryBefore,
          );
          assert.ok(
            state(f.c.root).relations.some(
              (r: any) =>
                r.src_id === ordinary.id && r.dst_id === result.artifact.id,
            ),
          );
        }
        if (owner || child) {
          for (const t of [owner, child, grandchild].filter(Boolean))
            assert.equal(
              (await f.c.call("task-view", { project: f.p, id: t.id })).task
                .meta.retouch.context_status,
              "needs_review",
            );
        }
        const completed = state(f.c.root);
        assert.equal(
          (await revise(f, doc, "revise-" + scope + "-" + kind)).replayed,
          true,
        );
        assert.deepEqual(
          state(f.c.root),
          completed,
          "same-key historical replay must not re-invalidate or append",
        );
        await assert.rejects(
          f.c.call(
            "document-revise",
            {
              project: f.p,
              id: doc.id,
              expected_version: doc.version,
              expected_hash: digest(doc.content),
              content: "Different intent",
              reason: "conflict",
              source: "fixture",
            },
            "revise-" + scope + "-" + kind,
          ),
          { code: "REQUEST_CONFLICT" },
        );
        await assert.rejects(revise(f, doc, "stale-" + scope + "-" + kind), {
          code: "DOCUMENT_STALE",
        });
        assert.deepEqual(
          state(f.c.root),
          completed,
          "conflict and stale must not write",
        );
      }
    }
    await fs.writeFile(
      path.join(
        process.env.RETOUCH_TEST_ROOT!,
        "document-invalidation-matrix.json",
      ),
      JSON.stringify({
        failures,
        scopes: 4,
        kinds: 2,
        real_business_access: 0,
      }) + "\n",
      { flag: "wx" },
    );
    assert.deepEqual(
      failures,
      [],
      "ordinary native consumers must not be coerced into retouch tasks",
    );
  },
);

test(
  "#26 revising a governance ADR cannot replace a different consumed design series",
  options,
  async () => {
    const f = await outputFixture({ retainRequests: true });
    const actual = (
      await f.call("document", {
        project: f.p,
        task: f.task.id,
        kind: "design",
        title: "Actual production design",
        content: "Actual synthetic production design",
        role: "agent-interpretation",
        source: "fixture",
        design_type: "ui-ux",
      })
    ).artifact;
    const child = await dependent(f, "Design consumer dependent", [f.task.id]);
    const adr = await nativeDocument(f, "design", "Unrelated governance ADR");
    await link(f, f.task.id, adr.id);
    const revised = await revise(f, adr, "governance-adr-revise");
    const owner = (await f.c.call("task-view", { project: f.p, id: f.task.id }))
      .task;
    await fs.writeFile(
      path.join(process.env.RETOUCH_TEST_ROOT!, "document-design-pointer.json"),
      JSON.stringify({
        actual: actual.id,
        adr: adr.id,
        adr_next: revised.artifact.id,
        observed_design: owner.meta.retouch.design_id,
      }) + "\n",
      { flag: "wx" },
    );
    assert.equal(
      owner.meta.retouch.design_id,
      actual.id,
      "governance decided-by is not the consumed production design",
    );
    assert.equal(owner.meta.retouch.context_status, "needs_review");
    assert.equal(
      (await f.c.call("task-view", { project: f.p, id: child.id })).task.meta
        .retouch.context_status,
      "needs_review",
    );
    const next = await revise(f, actual, "actual-design-revise");
    assert.equal(
      (await f.c.call("task-view", { project: f.p, id: f.task.id })).task.meta
        .retouch.design_id,
      next.artifact.id,
    );
    assert.equal(
      (await f.c.call("task-view", { project: f.p, id: child.id })).task.meta
        .retouch.design_id ?? null,
      null,
      "dependency invalidation must not adopt parent's design",
    );
    await fs.writeFile(
      path.join(
        process.env.RETOUCH_TEST_ROOT!,
        "native-document-invalidation-evidence.json",
      ),
      JSON.stringify({
        verdict: "PASS",
        matrix: true,
        exact_design_series: true,
        ordinary_task_unchanged: true,
        dependency_closure: true,
        history_replay_atomic: true,
        real_business_access: 0,
      }) + "\n",
      { flag: "wx" },
    );
  },
);

test(
  "#26 malformed retouch metadata rejects with safe typed errors and complete domain rollback",
  options,
  async () => {
    const f = await outputFixture({ retainRequests: true });
    const doc = await nativeDocument(f, "design", "Invalid profile document");
    await link(f, f.task.id, doc.id);
    const original = (await f.c.call("show", { project: f.p, id: f.task.id }))
      .meta;
    const value = JSON.parse(original);
    const bad = [
      {
        meta: JSON.stringify({
          ...value,
          retouch: { ...value.retouch, schema: "fake" },
        }),
        code: "DOCUMENT_TASK_PROFILE",
      },
      {
        meta: JSON.stringify({
          ...value,
          retouch: { ...value.retouch, revision: "zero" },
        }),
        code: "DOCUMENT_TASK_PROFILE",
      },
      {
        meta: JSON.stringify({
          ...value,
          retouch: { ...value.retouch, dependencies: "not-a-list" },
        }),
        code: "DOCUMENT_TASK_PROFILE",
      },
      { meta: "{bad-json", code: "METADATA_JSON" },
    ];
    for (let index = 0; index < bad.length; index++) {
      const sample = bad[index];
      const db = new DatabaseSync(path.join(f.c.root, "ygl", "ygl-trees.db"));
      try {
        db.prepare("UPDATE artifacts SET meta=? WHERE id=?").run(
          sample.meta,
          f.task.id,
        );
      } finally {
        db.close();
      }
      const before = state(f.c.root),
        key = "malformed-profile-" + index;
      await assert.rejects(revise(f, doc, key), (error: any) => {
        assert.equal(error.code, sample.code);
        assert.equal(error.effectStatus, "none");
        assert.ok(!error.message.includes("Synthetic revised document"));
        return true;
      });
      assert.deepEqual(
        state(f.c.root),
        before,
        "document/version/superseded/task/node/event/receipt rollback together",
      );
      assert.deepEqual(await f.c.call("receipt", { request_id: key }), {});
    }
    const restore = new DatabaseSync(
      path.join(f.c.root, "ygl", "ygl-trees.db"),
    );
    try {
      restore
        .prepare("UPDATE artifacts SET meta=? WHERE id=?")
        .run(original, f.task.id);
    } finally {
      restore.close();
    }
    assert.equal(
      (await revise(f, doc, "valid-after-profile-restored")).artifact.version,
      2,
    );
    await fs.writeFile(
      path.join(
        process.env.RETOUCH_TEST_ROOT!,
        "document-invalidation-negative.json",
      ),
      JSON.stringify({
        verdict: "PASS",
        typed_profile_errors: 3,
        malformed_JSON_rejected: true,
        complete_domain_rollback: true,
        real_business_access: 0,
      }) + "\n",
      { flag: "wx" },
    );
  },
);

test(
  "#24 C1 native committed revision survives discarded client response and reconnects by original receipt",
  options,
  async () => {
    const outcomes: any[] = [];
    for (const phase of ["before-submit", "after-native-commit"]) {
      const f = await outputFixture({ retainRequests: true }),
        doc = f.design,
        key = "C1-response-loss-" + phase;
      const body = {
        project: f.p,
        id: doc.id,
        expected_version: doc.version,
        expected_hash: digest(doc.content),
        content:
          "Synthetic revision with client response intentionally discarded",
        reason: "C1 bounded native receipt recovery",
        source: "fixture",
      };
      const before = state(f.c.root),
        raw = f.c.raw.bind(f.c);
      let nativeSubmissions = 0;
      f.c.raw = async (args: string[]) => {
        if (args[0] !== "retouch-native" || args[1] !== "document-revise")
          return raw(args);
        if (phase === "after-native-commit") {
          nativeSubmissions++;
          const committed = await raw(args);
          assert.equal(committed.ok, true);
          assert.equal(committed.result.artifact.version, doc.version + 1);
          const durable = state(f.c.root),
            receipts = durable.events.filter(
              (e: any) =>
                e.kind === "retouch.command" &&
                JSON.parse(e.payload).request_id === key,
            );
          assert.equal(
            receipts.length,
            1,
            "prove native receipt durable before discarding client result",
          );
          await fs.writeFile(
            path.join(
              process.env.RETOUCH_TEST_ROOT!,
              "C1-postcommit-durable-proof.json",
            ),
            JSON.stringify({
              phase,
              request_key: key,
              receipt: receipts[0],
              artifact: committed.result.artifact,
              fault_boundary:
                "NativeClient.raw caller boundary after successful actual native child result; not OS process kill or provider network loss",
            }) + "\n",
            { flag: "wx" },
          );
        }
        throw new RetouchError(
          "NATIVE_RESULT_UNKNOWN",
          "Synthetic client response loss; query original key",
          1,
          { phase },
          "unknown",
        );
      };
      try {
        await assert.rejects(f.c.call("document-revise", body, key), {
          code: "NATIVE_RESULT_UNKNOWN",
          effectStatus: "unknown",
        });
      } finally {
        f.c.raw = raw;
      }
      assert.equal(nativeSubmissions, phase === "after-native-commit" ? 1 : 0);
      const afterFault = state(f.c.root);
      if (phase === "before-submit")
        assert.deepEqual(
          afterFault,
          before,
          "same unknown error does not prove commit or noncommit without readback",
        );
      else assert.notDeepEqual(afterFault, before);
      const reopened = await NativeClient.open(f.c.root, {
        retainRequests: true,
      });
      const receipt = await reopened.call("receipt", { request_id: key });
      assert.deepEqual(
        state(f.c.root),
        afterFault,
        "receipt lookup and reconnect do not write domain state",
      );
      if (phase === "after-native-commit") {
        assert.equal(receipt.action, "document-revise");
        assert.equal(
          receipt.intent,
          digest({ action: "document-revise", body }),
        );
        assert.equal(receipt.result.artifact.version, doc.version + 1);
      } else assert.deepEqual(receipt, {});
      const recovered = await reopened.call("document-revise", body, key);
      assert.equal(recovered.artifact.version, doc.version + 1);
      assert.equal(
        recovered.replayed === true,
        phase === "after-native-commit",
      );
      const stable = state(f.c.root);
      if (phase === "after-native-commit")
        assert.deepEqual(
          stable,
          afterFault,
          "same-key recovery cannot append second version, relation, invalidation or receipt",
        );
      const versions = stable.artifacts.filter(
        (a: any) =>
          a.project_id === f.p && a.kind === doc.kind && a.title === doc.title,
      );
      assert.equal(versions.length, 2);
      assert.equal(
        versions.filter((a: any) => a.version === doc.version + 1).length,
        1,
      );
      assert.equal(
        stable.events.filter(
          (e: any) =>
            e.kind === "retouch.command" &&
            JSON.parse(e.payload).request_id === key,
        ).length,
        1,
      );
      assert.equal(
        (await reopened.call("show", { project: f.p, id: doc.id })).content,
        doc.content,
      );
      assert.equal(
        (await reopened.call("receipt", { request_id: key })).result.artifact
          .id,
        recovered.artifact.id,
      );
      await assert.rejects(
        reopened.call(
          "document-revise",
          { ...body, content: "Different intent must not reuse original key" },
          key,
        ),
        { code: "REQUEST_CONFLICT" },
      );
      await assert.rejects(
        reopened.call("document-revise", body, key + "-new-key-old-version"),
        { code: "DOCUMENT_STALE" },
      );
      assert.deepEqual(state(f.c.root), stable);
      outcomes.push({
        phase,
        error_status: "unknown",
        native_submissions_before_fault: nativeSubmissions,
        receipt_found_before_retry: phase === "after-native-commit",
        replayed: recovered.replayed === true,
        versions: 2,
        request_receipts: 1,
        conflict_and_stale_rejected: true,
        domain_replay_unchanged: true,
      });
    }
    await fs.writeFile(
      path.join(
        process.env.RETOUCH_TEST_ROOT!,
        "native-postcommit-recovery-evidence.json",
      ),
      JSON.stringify({
        verdict: "PASS",
        fault_boundary:
          "test adapter discards actual successful NativeClient.raw result, not process/socket interruption",
        cases: outcomes,
        actual_native_commit_and_receipt_verified: true,
        reconnect_original_key: true,
        no_duplicate_domain_state: true,
        provider_network_calls: 0,
        real_business_access: 0,
      }) + "\n",
      { flag: "wx" },
    );
  },
);
