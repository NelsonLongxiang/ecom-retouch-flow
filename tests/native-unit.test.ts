import test from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../src/native/context.ts";
import {
  tags,
  validateSnapshot,
  digest,
  assertNoCredentials,
} from "../src/native/plugin/commands.mjs";
import { execute } from "../src/cli.ts";

test("动态上下文：按不同项目计数、未评分不填零，二次分类不改原标签", () => {
  const records = [
    {
      project: { id: "a" },
      profile: {
        content: { tags: ["风格:原木", "风格:原木", "柜门"], rating: 5 },
      },
    },
    {
      project: { id: "b" },
      profile: { content: { tags: ["风格:原木"], rating: null } },
    },
    { project: { id: "c" }, profile: { content: { tags: [], rating: null } } },
  ];
  const original = structuredClone(records),
    view = analyze(records, {
      schema: "retouch.method/v1",
      version: "1",
      rules: [{ tag: "柜门", dimension: "部位", value: "柜门" }],
    });
  assert.equal(view.frequency[0].projects, 2);
  assert.equal(view.frequency[0].rated_projects, 1);
  assert.equal(view.frequency[0].mean_rating, 5);
  assert.deepEqual(view.denominator, {
    projects: 3,
    untagged: 1,
    unrated: 2,
    rated: 1,
  });
  assert.equal(
    view.classification.find((x) => x.tag === "部位:柜门")?.projects,
    1,
  );
  assert.deepEqual(records, original);
});
test("标签校验、ZIP 原生 schema 与 CLI 无效输入拒绝", async () => {
  assert.deepEqual(tags([" 原木 ", "原木"]), ["原木"]);
  assert.throws(() => tags(["a,b"]));
  assert.throws(
    () =>
      assertNoCredentials({
        meta: JSON.stringify({ api_key: "REDACTED_TEST_ONLY" }),
      }),
    { code: "CONTEXT_CREDENTIAL" },
  );
  assert.throws(() =>
    validateSnapshot({
      schema: "retouch.native-project/v1",
      tables: {},
      fingerprint: digest({}),
    }),
  );
  for (const args of [
    ["--imaginary"],
    ["doctor", "--file", "ignored"],
    ["doctor", "--workspace", "a", "--workspace", "b"],
    ["task", "new", "--workspace", "none", "--imaginary"],
  ])
    await assert.rejects(execute(args));
  const help = await execute(["--help"]);
  assert.equal(help.result.data.version, "0.3.0");
  assert.match(help.result.data.storage, /no retouch ledger/);
});
