import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  captureNode,
  nativeReceiptPassed,
  nativeClient,
  writeNativeReport,
} from "../scripts/lib/native-ygl.mjs";
import { outputFixture } from "./helpers/output-fixture.ts";
const root = path.resolve(import.meta.dirname, ".."),
  entry = process.env.RETOUCH_TEST_YGL_ENTRY;
const hash = (bytes: Buffer | string) =>
  crypto.createHash("sha256").update(bytes).digest("hex");
const runtime = () => {
  assert.ok(
    process.env.RETOUCH_TEST_ROOT,
    "Use maintained test runner with an isolated project run root",
  );
  return process.env.RETOUCH_TEST_ROOT!;
};

test(
  "validation transport preserves full byte logs independently of JSON parsing and rejects domain failures",
  { timeout: 60000 },
  async () => {
    const logs = path.join(runtime(), "process-evidence");
    const call = (source: string, options: any = {}) =>
      captureNode(["-e", source], { cwd: root, logRoot: logs, ...options });
    const good = await call(
      'process.stdout.write(JSON.stringify({ok:true,text:"中文😺",tmp:require("node:os").tmpdir(),env:process.env.TEMP}))',
    );
    assert.equal(nativeReceiptPassed(good), true);
    assert.equal(good.json.tmp, good.child_temp_root);
    assert.equal(good.json.env, good.child_temp_root);
    const big = await call(
      'process.stdout.write(JSON.stringify({data:"中".repeat(50000)}))',
      { maxJsonBytes: 512 },
    );
    assert.equal(big.exit_code, 0);
    assert.equal(big.output_truncated, false);
    assert.equal(big.parse_limited, true);
    assert.equal(big.parse_error, "JSON_PARSE_LIMIT");
    assert.equal(nativeReceiptPassed(big), false);
    const bytes = await fs.readFile(path.join(big.log_directory, "stdout.log"));
    assert.equal(bytes.length, big.stdout_bytes);
    assert.equal(hash(bytes), big.stdout_sha256);
    assert.ok(bytes.length > 100000);
    const cases = [
      ['process.stdout.write(JSON.stringify({overall:"FAIL"}))', false],
      ['process.stdout.write(JSON.stringify({ok:true,verdict:"FAIL"}))', false],
      ['process.stdout.write("not-json")', false],
      ["", false],
      ['process.stdout.write("{}");process.exitCode=2', false],
    ] as const;
    for (const [source, expected] of cases) {
      const result = await call(source);
      assert.equal(nativeReceiptPassed(result), expected);
      assert.equal(
        hash(await fs.readFile(path.join(result.log_directory, "stdout.log"))),
        result.stdout_sha256,
      );
    }
    const timeout = await call("setInterval(()=>{},1000)", { timeoutMs: 150 });
    assert.equal(timeout.timed_out, true);
    assert.equal(nativeReceiptPassed(timeout), false);
    assert.ok(timeout.exit_code !== 0 || timeout.signal !== null);
    const reports = path.join(runtime(), "immutable-developer-reports");
    const first = await writeNativeReport(
      "fixture",
      { verdict: "FAIL", witness: "retained" },
      { directory: reports },
    );
    const original = await fs.readFile(first.path);
    const second = await writeNativeReport(
      "fixture",
      { verdict: "PASS", witness: "new independent fixture" },
      { directory: reports },
    );
    assert.notEqual(first.path, second.path);
    assert.deepEqual(await fs.readFile(first.path), original);
    assert.equal(hash(original), first.sha256);
    assert.equal(JSON.parse(original.toString()).verdict, "FAIL");
    await assert.rejects(
      writeNativeReport("../escape", {}, { directory: reports }),
      /safe basename/,
    );
    const base = { ...good, json: [{ status: "pass" }] };
    assert.equal(nativeReceiptPassed(base, { doctor: true }), true);
    assert.equal(
      nativeReceiptPassed({ ...base, json: [] }, { doctor: true }),
      false,
    );
    assert.equal(
      nativeReceiptPassed({ ...base, json: [null] }, { doctor: true }),
      false,
    );
    for (const status of ["warn", "fail", "skip"])
      assert.equal(
        nativeReceiptPassed({ ...base, json: [{ status }] }, { doctor: true }),
        false,
      );
    await assert.rejects(
      captureNode(["-e", ""], { cwd: root, logRoot: path.dirname(root) }),
      /project tmp/,
    );
  },
);

test(
  "CLI canonical and real directory-link entries emit the same JSON; importing remains inert",
  { timeout: 60000 },
  async () => {
    const parent = await fs.mkdtemp(path.join(runtime(), "entry-")),
      linked = path.join(parent, "linked-source");
    await fs.symlink(
      root,
      linked,
      process.platform === "win32" ? "junction" : "dir",
    );
    const logs = path.join(parent, "processes"),
      canonical = path.join(root, "src", "cli.ts"),
      alias = path.join(linked, "src", "cli.ts");
    const direct = await captureNode([canonical, "help", "--json"], {
      cwd: root,
      logRoot: logs,
    });
    const throughLink = await captureNode([alias, "help", "--json"], {
      cwd: root,
      logRoot: logs,
    });
    for (const result of [direct, throughLink]) {
      assert.equal(result.exit_code, 0);
      assert.equal(result.json.schema_version, "retouch.cli/v2");
      assert.equal(result.json.ok, true);
      assert.ok(result.stdout_bytes > 0);
      assert.equal(result.stderr_bytes, 0);
    }
    assert.deepEqual(throughLink.json, direct.json);
    const imported = await captureNode(
      [
        "--input-type=module",
        "-e",
        "await import(" + JSON.stringify(pathToFileURL(alias).href) + ")",
      ],
      { cwd: root, logRoot: logs },
    );
    assert.equal(imported.exit_code, 0);
    assert.equal(imported.stdout_bytes, 0);
    assert.equal(imported.stderr_bytes, 0);
    const rejected = await captureNode(
      [alias, "--nonexistent-vrc-option", "--json"],
      { cwd: root, logRoot: logs },
    );
    assert.notEqual(rejected.exit_code, 0);
    assert.equal(rejected.json.ok, false);
    assert.ok(rejected.json.error.code);
  },
);

test(
  "project validation positive PASS and intended required-item FAIL remain separate, retained and self-checked",
  { skip: !entry, timeout: 300000 },
  async () => {
    const packRoot = path.join(root, "verify", "packs", "retouch-validation");
    const pack = JSON.parse(
      await fs.readFile(path.join(packRoot, "pack.json"), "utf8"),
    );
    assert.equal(pack.schema, "retouch.validation-project-pack/v1");
    assert.equal(pack.data_only, true);
    assert.equal(pack.engine.version, "0.125.0");
    const checked = [];
    for (const item of pack.files) {
      const file = path.resolve(packRoot, item.path);
      assert.ok(file.startsWith(packRoot + path.sep));
      assert.equal(await fs.realpath(file), file);
      const bytes = await fs.readFile(file);
      assert.equal(bytes.length, item.bytes);
      assert.equal(hash(bytes), item.sha256);
      assert.ok(!/\.(?:mjs|cjs|ts|js|ps1|sh|py)$/.test(item.path));
      checked.push({ path: item.path, sha256: hash(bytes) });
    }
    const cases = JSON.parse(
      await fs.readFile(path.join(packRoot, "fixtures", "cases.json"), "utf8"),
    );
    const f = await outputFixture({ retainRequests: true }),
      { c, p, task } = f;
    const source = (
      await f.call("document", {
        project: p,
        task: task.id,
        kind: "spec",
        title: "Validation required observation",
        content:
          "Required item: preserve the declared bottom-panel proportion.",
        role: "user-original",
        source: "SYNTHETIC validation fixture only",
      })
    ).artifact;
    const view = (await c.call("task-view", { project: p, id: task.id })).task;
    const contract = (
      await f.call("invariants-set", {
        project: p,
        task: task.id,
        expected_revision: view.meta.retouch.revision,
        invariants: {
          schema: "retouch.invariants/v1",
          items: [
            {
              id: "panel",
              text: "Preserve declared panel proportion",
              scope: "synthetic given observation",
              required: true,
              source: {
                artifact_id: source.id,
                quote: "preserve the declared bottom-panel proportion",
              },
            },
          ],
        },
      })
    ).artifact;
    const outcomes: any[] = [];
    for (const name of ["positive", "negative", "unknown"]) {
      const input = cases[name],
        image = await f.image(
          16,
          16,
          name === "positive"
            ? "#aabbcc"
            : name === "negative"
              ? "#bb9955"
              : "#8899aa",
          "validation-" + name,
        ),
        meta = JSON.parse(image.meta);
      const before = await fs.readFile(path.join(c.root, meta.object_path));
      const review = await f.call("invariants-check", {
        project: p,
        id: image.id,
        sha256: meta.sha256,
        contract_id: contract.id,
        method: "fixture",
        reviewer: "validation fixture",
        source: "fixture",
        items: [
          {
            id: "panel",
            verdict: input.verdict,
            observations: input.observation,
            evidence: "synthetic case " + name + "; no real visual verdict",
          },
        ],
      });
      const actual = await c.call("invariant-view", {
        project: p,
        id: image.id,
      });
      assert.equal(actual.status, input.expected);
      assert.deepEqual(
        await fs.readFile(path.join(c.root, meta.object_path)),
        before,
      );
      if (name !== "positive")
        await assert.rejects(
          f.call("media-review", {
            project: p,
            id: image.id,
            sha256: meta.sha256,
            verdict: "PASS",
            accepted: true,
            source: "user",
            reviewer: "fixture",
            observations: "must not override required outcome",
          }),
          { code: "INVARIANTS_PENDING" },
        );
      outcomes.push({
        name,
        expected: input.expected,
        actual: actual.status,
        review_id: review.artifact?.id ?? review.review?.id ?? null,
        media_id: image.id,
        sha256: meta.sha256,
        witness: actual,
      });
    }
    const snapshot = await c.call("snapshot", { project: p });
    const { validateSnapshot } = await import(
      "../src/native/plugin/commands.mjs"
    );
    assert.doesNotThrow(() => validateSnapshot(snapshot));
    const bad = outcomes.find((x) => x.name === "negative");
    assert.equal(
      (await c.call("invariant-view", { project: p, id: bad.media_id })).status,
      "FAIL",
    );
    assert.equal(
      snapshot.tables.artifacts.some(
        (a: any) => JSON.parse(a.meta || "{}").accepted === true,
      ),
      false,
    );
    const { NativeClient } = await import("../src/native/client.ts");
    const reopen = await NativeClient.open(c.root, { retainRequests: true });
    assert.equal(
      (await reopen.call("invariant-view", { project: p, id: bad.media_id }))
        .status,
      "FAIL",
    );
    const requests = await fs.readdir(
      path.join(c.root, "tmp", "native-requests"),
    );
    assert.ok(requests.length > 10);
    for (const name of requests)
      JSON.parse(
        await fs.readFile(
          path.join(c.root, "tmp", "native-requests", name),
          "utf8",
        ),
      );
    const developer = await nativeClient(entry!, {
      home: path.join(c.root, "ygl"),
      cwd: root,
      session: "vrc-validation",
      logRoot: path.join(runtime(), "native-transport"),
    });
    const doctor = await developer.call(["doctor"]);
    assert.equal(
      nativeReceiptPassed(doctor, { doctor: true }),
      true,
      "doctor requires a nonempty list with every status=pass, not merely exit0/no-fail",
    );
    const evidence = {
      schema: "retouch.validation-convergence-evidence/v1",
      verdict: "PASS",
      software_positive: outcomes[0],
      intended_business_negative: outcomes[1],
      unknown_control: outcomes[2],
      project_self_check: {
        status: "PASS",
        pack_hashes: checked.length,
        native_snapshot: "PASS",
        raw_case_expectations: "PASS",
        request_retention: requests.length,
        original_FAIL_preserved: true,
      },
      original_business_image:
        "NOT_READ_OR_MODIFIED; sender FAIL remains separate",
      upstream_full_verify: "NOT_RUN_TEMP_CLEANUP_CONFLICT",
      upstream_corpus_self_check: "NOT_RUN_CORPUS_MISSING_AND_DELETE_CONFLICT",
      doctor: doctor.json,
      models: 0,
      network: 0,
      controlled_source_deletions: 0,
    };
    await fs.writeFile(
      path.join(runtime(), "native-validation-evidence.json"),
      JSON.stringify(evidence, null, 2) + "\n",
      { flag: "wx" },
    );
  },
);

test(
  "design capture requires explicit valid probe evidence before opening a native home",
  { timeout: 60000 },
  async () => {
    const directory = await fs.mkdtemp(
      path.join(runtime(), "capture-preflight-"),
    );
    const bad = path.join(directory, "probe.json"),
      home = path.join(directory, "must-not-open-home");
    await fs.writeFile(
      bad,
      JSON.stringify({
        schema: "retouch.native-wrapper-probe/v1",
        core_verdict: "PASS",
        verdict: "PASS_WITH_GAPS",
        checks: { real_check: false },
        failures: [],
        gaps: [{ observed: "fixture" }],
      }),
      { flag: "wx" },
    );
    const args = [
      "scripts/capture-context-design.mjs",
      "--ygl-entry",
      entry ?? "not-used",
      "--home",
      home,
      "--project",
      "fixture-project",
      "--tree",
      "fixture-tree",
    ];
    const missing = await captureNode(args, {
      cwd: root,
      logRoot: path.join(directory, "logs"),
    });
    assert.notEqual(missing.exit_code, 0);
    assert.match(missing.stderr, /Missing --probe-report/);
    const rejected = await captureNode([...args, "--probe-report", bad], {
      cwd: root,
      logRoot: path.join(directory, "logs"),
    });
    assert.notEqual(rejected.exit_code, 0);
    assert.match(rejected.stderr, /Explicit probe evidence is incomplete/);
    await assert.rejects(fs.stat(home), { code: "ENOENT" });
    const source = await fs.readFile(
      path.join(root, "scripts/capture-context-design.mjs"),
      "utf8",
    );
    assert.doesNotMatch(source, /docs\/verification\/ygl-wrapper-probe[.]json/);
  },
);
