import assert from "node:assert/strict";
import {
  productFacts,
  factCheck,
  renderFacts,
} from "../../src/native/plugin/product-facts.mjs";
import { apiPrompt } from "../../src/native/plugin/api-contract.mjs";
import { digest } from "../../src/native/plugin/commands.mjs";
import {
  invariants,
  inspectionItems,
  invariantView,
  assertInvariants,
} from "../../src/native/plugin/flow-contracts.mjs";
import { taskBinding } from "../../src/native/plugin/applicability.mjs";

// Synthetic fixtures, not the user's SKU, source statement, permission or acceptance.
export function physicalFactsFixture(
  sku = "SYNTHETIC-A",
  values = [45, 25, 5],
) {
  const labels = ["back_height", "front_height", "board_thickness"];
  const quote =
    sku +
    ": " +
    labels.map((label, i) => label + "=" + values[i] + "mm").join("; ") +
    "; datum/depth not measured.";
  const source = {
    id: "source-" + sku,
    project_id: "project-" + sku,
    kind: "spec",
    version: 1,
    content: quote,
    meta: JSON.stringify({
      role: "user-original",
      source: "synthetic fixture only",
    }),
  };
  const facts = {
    schema: "retouch.product-facts/v1",
    fields: labels.map((label, i) => ({
      key: "dimensions." + label,
      value: values[i],
      unit: "mm",
      status: "confirmed",
      role: "user-original",
      subject: "current-sku",
      applies_to: "single-item",
      evidence_type: "user-field-confirmation",
      source: { artifact_id: source.id, quote, label_present: true },
      confirmation: {
        statement:
          "SYNTHETIC FIXTURE field confirmation; no actual user acceptance",
        source_ref: source.id,
      },
    })),
  };
  return { source, facts, keys: labels.map((label) => "dimensions." + label) };
}

export const physicalReferenceCases: { name: string; run: () => void }[] = [
  {
    name: "#16 facts: height/thickness remain distinct and a prompt control experiment cannot mutate physical fields",
    run: () => {
      const f = physicalFactsFixture(),
        before = digest(f);
      const facts = productFacts(f.facts, [f.source]);
      const step: any = {
        id: "edit",
        prompt:
          "Synthetic control trial: token30 is an experimental prompt control, not a measured height; do not relabel the product.",
        fact_keys: f.keys,
      };
      const checked = factCheck(facts, [step], "product-accurate");
      assert.equal(checked.status, "PASS_WITH_BOUNDARIES");
      step.bound_facts = renderFacts(checked.step_checks[0]);
      step.fact_constraints = checked.step_checks[0].constraints;
      const prompt = apiPrompt(step, [], []);
      assert.deepEqual(
        step.bound_facts.map((x: any) => [x.key, x.value, x.unit]),
        [
          [f.keys[0], 45, "mm"],
          [f.keys[1], 25, "mm"],
          [f.keys[2], 5, "mm"],
        ],
      );
      assert.ok(
        prompt.includes('"value":45') &&
          prompt.includes('"value":25') &&
          prompt.includes('"value":5') &&
          prompt.includes("token30"),
      );
      assert.equal(digest(f), before);
      assert.deepEqual(facts, f.facts);
      assert.notEqual(facts, f.facts);
    },
  },
  {
    name: "#16 facts: a new SKU reads its own values; absent or reference-SKU dimensions do not inherit old confirmation",
    run: () => {
      const a = physicalFactsFixture(),
        b = physicalFactsFixture("SYNTHETIC-B", [62, 18, 3]);
      const fa = productFacts(a.facts, [a.source]),
        fb = productFacts(b.facts, [b.source]);
      assert.deepEqual(
        fa.fields.map((x: any) => x.value),
        [45, 25, 5],
      );
      assert.deepEqual(
        fb.fields.map((x: any) => x.value),
        [62, 18, 3],
      );
      assert.equal(
        factCheck(
          null,
          [{ id: "missing", fact_keys: b.keys }],
          "product-accurate",
        ).status,
        "BLOCKED",
      );
      const fromOtherSku = structuredClone(a.facts);
      fromOtherSku.fields[0].subject = "reference-sku";
      assert.throws(() => productFacts(fromOtherSku, [a.source]), {
        code: "PRODUCT_FACTS",
      });
      assert.throws(() => productFacts(a.facts, [b.source]), {
        code: "PRODUCT_FACTS",
      });
    },
  },
  {
    name: "#16 conditions: a conditional exposed-height hypothesis is not confirmed structure",
    run: () => {
      const f = physicalFactsFixture();
      const hypothesis = {
        id: "conditional-source",
        kind: "design",
        version: 1,
        content:
          "Synthetic assumption only: same datum and near-horizontal occlusion might expose20mm; depth and mounting datum remain unknown.",
        meta: JSON.stringify({ role: "hypothesis" }),
      };
      const facts: any = productFacts(
        {
          ...f.facts,
          fields: [
            ...f.facts.fields,
            {
              key: "structure.visible_rear",
              value: 20,
              unit: "mm",
              status: "hypothesis",
              role: "hypothesis",
              subject: "current-sku",
              applies_to: "visible-part",
              evidence_type: "user-message",
              source: {
                artifact_id: hypothesis.id,
                quote: hypothesis.content,
                label_present: false,
              },
            },
          ],
        },
        [f.source, hypothesis],
      );
      const before = digest(facts);
      assert.equal(
        factCheck(
          facts,
          [{ id: "claimed", fact_keys: ["structure.visible_rear"] }],
          "product-accurate",
        ).status,
        "BLOCKED",
      );
      const conservative = factCheck(
        facts,
        [
          {
            id: "visible",
            fact_keys: ["structure.visible_rear"],
            safe_strategy: "visible-only",
          },
        ],
        "product-accurate",
      );
      assert.equal(conservative.status, "PASS_WITH_BOUNDARIES");
      assert.deepEqual(renderFacts(conservative.step_checks[0]), []);
      assert.deepEqual(conservative.step_checks[0].omitted, [
        "structure.visible_rear",
      ]);
      assert.equal(digest(facts), before);
      assert.equal(facts.fields.at(-1).status, "hypothesis");
      // No geometric truth or image ratio is inferred by this test or existing factCheck.
    },
  },
  {
    name: "#16 references: actual API prompt preserves ordered purposes and nonfinal edit boundaries",
    run: () => {
      const references = [
        {
          media_id: "synthetic-material",
          purpose: "仅参考材质；不保持旧错误轮廓；不得借用其他SKU尺寸",
        },
        {
          media_id: "synthetic-edit",
          purpose:
            "非成品、非实测；按新轮廓融合，修复接缝/台阶/阴影；不复制标线，不恢复旧错误轮廓",
        },
      ];
      const step = {
          id: "blend",
          prompt: "使用已读设计确定的参考分工。",
          references,
        },
        before = digest(step);
      const prompt = apiPrompt(step, [], ["不新增商品侧板"]);
      assert.ok(prompt.includes("第 2 张图仅用于：" + references[0].purpose));
      assert.ok(prompt.includes("第 3 张图仅用于：" + references[1].purpose));
      assert.ok(
        prompt.indexOf(references[0].purpose) <
          prompt.indexOf(references[1].purpose),
      );
      assert.ok(prompt.includes("参考图不是当前商品规格的确认依据。"));
      assert.ok(prompt.includes("不新增商品侧板"));
      assert.equal(prompt.includes("synthetic-edit"), false);
      assert.equal(digest(step), before);
      // This is transport of declared purposes, not automatic reference-conflict detection.
    },
  },
  {
    name: "#16 provenance: visual approval and AI reconstruction cannot confirm a millimetre specification",
    run: () => {
      const f = physicalFactsFixture();
      for (const evidence of ["visual-acceptance", "ai-output"]) {
        const facts = structuredClone(f.facts);
        facts.fields[2].evidence_type = evidence;
        assert.throws(() => productFacts(facts, [f.source]), {
          code: "PRODUCT_FACTS",
        });
      }
      const facts = structuredClone(f.facts);
      facts.fields[2].role = "ai-reconstruction";
      assert.throws(() => productFacts(facts, [f.source]), {
        code: "PRODUCT_FACTS",
      });
      facts.fields[2].status = "observed";
      assert.equal(
        productFacts(facts, [f.source]).fields[2].status,
        "observed",
      );
    },
  },
  {
    name: "#16 scope: unknown hidden assembly blocks only claims which depend on it",
    run: () => {
      const f = physicalFactsFixture(),
        facts = productFacts(f.facts, [f.source]);
      const visible = factCheck(
        facts,
        [{ id: "front-only", fact_keys: f.keys }],
        "product-accurate",
      );
      assert.equal(visible.status, "PASS_WITH_BOUNDARIES");
      assert.equal(
        factCheck(
          facts,
          [{ id: "hidden", fact_keys: ["structure.hidden_assembly"] }],
          "product-accurate",
        ).status,
        "BLOCKED",
      );
      const conservative = factCheck(
        facts,
        [
          {
            id: "front-only",
            fact_keys: ["structure.hidden_assembly"],
            safe_strategy: "visible-only",
          },
        ],
        "product-accurate",
      );
      assert.equal(conservative.status, "PASS_WITH_BOUNDARIES");
      assert.ok(
        conservative.step_checks[0].constraints.some((x: string) =>
          x.includes("不补造未知内部"),
        ),
      );
      assert.equal(
        factCheck(
          facts,
          [
            {
              id: "front-only",
              fact_keys: ["unverified_safety"],
              safe_strategy: "visible-only",
            },
          ],
          "product-accurate",
        ).status,
        "BLOCKED",
      );
    },
  },
];

physicalReferenceCases.push({
  name: "#16 measurement state: deployed approximations and folded ranges preserve their own meanings",
  run: () => {
    const quote =
      "SYNTHETIC: deployed/unloaded upper tread height approx380mm from ground; folded outer envelope thickness55-57mm; no tread thickness, load or measurement tolerance claim.";
    const source = {
      id: "state-source",
      kind: "spec",
      content: quote,
      meta: JSON.stringify({ role: "user-original" }),
    };
    const fields = [
      { key: "dimensions.deployed_unloaded.upper_height", value: "approx380" },
      { key: "dimensions.folded.outer_thickness", value: "55-57" },
    ].map((f) => ({
      ...f,
      unit: "mm",
      status: "confirmed",
      role: "user-original",
      subject: "current-sku",
      applies_to: "single-item",
      evidence_type: "user-field-confirmation",
      source: { artifact_id: source.id, quote, label_present: true },
      confirmation: {
        statement:
          "SYNTHETIC state-specific statement only; not a precise measurement",
        source_ref: source.id,
      },
    }));
    const facts = productFacts({ schema: "retouch.product-facts/v1", fields }, [
      source,
    ]);
    const before = digest(facts);
    const check = factCheck(
      facts,
      [
        { id: "deployed", fact_keys: [fields[0].key] },
        { id: "folded", fact_keys: [fields[1].key] },
      ],
      "product-accurate",
    );
    assert.equal(check.status, "PASS_WITH_BOUNDARIES");
    assert.deepEqual(
      renderFacts(check.step_checks[0]).map((f) => f.value),
      ["approx380"],
    );
    assert.deepEqual(
      renderFacts(check.step_checks[1]).map((f) => f.value),
      ["55-57"],
    );
    assert.equal(
      factCheck(
        facts,
        [{ id: "cannot-relabel", fact_keys: ["dimensions.tread_thickness"] }],
        "product-accurate",
      ).status,
      "BLOCKED",
    );
    const prompt = apiPrompt(
      {
        id: "deployed",
        prompt:
          "deployed and unloaded only; retain approximation, no precision/safety claim",
        bound_facts: renderFacts(check.step_checks[0]),
      },
      [],
      [],
    );
    assert.ok(prompt.includes('"value":"approx380"'));
    assert.equal(prompt.includes('"value":"55-57"'), false);
    assert.equal(digest(facts), before);
    // This checks representation/selection only, not physical accuracy or automatic state inference.
  },
});

// Supplied inspection records exercise the existing native gate, NOT image analysis.
// Required/optional scope is selected before recording any result and never lowered.
function relativeInspectionFixture(requireAbsolute: boolean) {
  const project = "synthetic-relative-project";
  const task = {
    id: "relative-task",
    project_id: project,
    kind: "task",
    version: 1,
    meta: JSON.stringify({
      status: "doing",
      retouch: {
        goal_id: "synthetic-goal",
        goal_version: 1,
        requirements: [],
        context_epoch: 0,
        revision: 0,
      },
    }),
  };
  const binding = taskBinding(task, digest);
  const source = {
    id: "relative-source",
    project_id: project,
    kind: "spec",
    version: 1,
    content:
      "SYNTHETIC RECORD CONTRACT: common sections stay consistent in comparable views; exact millimetres require independent measurement evidence.",
    meta: JSON.stringify({ role: "user-original" }),
  };
  const definitions = invariants(
    {
      schema: "retouch.invariants/v1",
      items: [
        {
          id: "relative-section",
          text: "preserve source-supported cross-section consistency",
          scope:
            "only comparable component identity/configuration, orientation and visible endpoints",
          required: true,
          source: {
            artifact_id: source.id,
            quote: "common sections stay consistent in comparable views",
          },
        },
        {
          id: "absolute-thickness",
          text: "exact millimetre thickness",
          scope:
            "only where the actual task requires metric verification with scale and endpoints",
          required: requireAbsolute,
          source: {
            artifact_id: source.id,
            quote: "exact millimetres require independent measurement evidence",
          },
        },
      ],
    },
    [source],
  );
  const image = {
    id: "relative-candidate",
    project_id: project,
    kind: "media",
    version: 1,
    meta: JSON.stringify({
      ...binding,
      role: "candidate",
      sha256: "a".repeat(64),
    }),
  };
  const contract = {
    id: "relative-invariants",
    project_id: project,
    kind: "spec",
    version: 1,
    content: JSON.stringify(definitions),
    meta: JSON.stringify({ ...binding, role: "product-invariants" }),
  };
  const artifacts: any[] = [task, source, image, contract];
  let serial = 0;
  const item = (id: string, verdict: string, observations: string) => ({
    id,
    verdict,
    observations,
    evidence:
      "SYNTHETIC supplied judgement only; no real candidate image was inspected",
  });
  const record = (items: any[], overrides: Record<string, unknown> = {}) => {
    const normalized = inspectionItems(items, definitions.items);
    const row = {
      id: "relative-review-" + ++serial,
      project_id: project,
      kind: "review",
      version: serial,
      content: JSON.stringify({ items: normalized }),
      meta: JSON.stringify({
        ...binding,
        role: "invariants-check",
        contract_id: contract.id,
        media_id: image.id,
        sha256: JSON.parse(image.meta).sha256,
        method: "fixture",
        reviewer: "fixture-not-visual-reviewer",
        ...overrides,
      }),
    };
    artifacts.push(row);
    return row;
  };
  return { task, image, contract, artifacts, item, record };
}

physicalReferenceCases.push(
  {
    name: "#16/#17 invariant gate: visible relative FAIL survives separate metric UNKNOWN and partial later checks",
    run: () => {
      const f = relativeInspectionFixture(false),
        originalContract = digest(f.contract);
      const examples = [
        "unexplained taper along the same plate under a comparable axis",
        "duplicate stacked edge where source specifies a single section",
        "heterogeneous section among comparable same-type components",
      ];
      for (const example of examples) {
        const prior = f.record([
          f.item("relative-section", "FAIL", example),
          f.item(
            "absolute-thickness",
            "UNKNOWN",
            "no scale/endpoint evidence for exact millimetres",
          ),
        ]);
        const original = structuredClone(prior);
        f.record([
          f.item(
            "absolute-thickness",
            "UNKNOWN",
            "metric still unknown; this does not resolve the structural failure",
          ),
        ]);
        const before = structuredClone(f.artifacts),
          view = invariantView(f.artifacts, f.image, f.task);
        assert.equal(view.status, "FAIL");
        assert.equal(
          view.items.find((i: any) => i.id === "relative-section").verdict,
          "FAIL",
        );
        assert.equal(
          view.items.find((i: any) => i.id === "absolute-thickness").verdict,
          "UNKNOWN",
        );
        assert.throws(() => assertInvariants(f.artifacts, f.image, f.task), {
          code: "INVARIANTS_PENDING",
        });
        assert.deepEqual(f.artifacts, before);
        assert.deepEqual(prior, original);
      }
      assert.equal(
        digest(f.contract),
        originalContract,
        "do not delete failures or lower required scope after seeing a result",
      );
    },
  },
  {
    name: "#17 invariant gate: perspective uncertainty is not invented as FAIL and metric scope stays predeclared",
    run: () => {
      const exterior = relativeInspectionFixture(false),
        original = digest(exterior.contract);
      exterior.record([
        exterior.item(
          "relative-section",
          "UNKNOWN",
          "oblique/occluded edges do not establish comparable cross-sections",
        ),
        exterior.item("absolute-thickness", "UNKNOWN", "no metric scale"),
      ]);
      assert.equal(
        invariantView(exterior.artifacts, exterior.image, exterior.task).status,
        "UNKNOWN",
      );
      assert.throws(
        () =>
          assertInvariants(exterior.artifacts, exterior.image, exterior.task),
        { code: "INVARIANTS_PENDING" },
      );
      exterior.record([
        exterior.item(
          "relative-section",
          "PASS",
          "supplied fixture judgement: known geometry and perspective explain unequal pixel widths; no observed relative contradiction",
        ),
      ]);
      const view = assertInvariants(
        exterior.artifacts,
        exterior.image,
        exterior.task,
      );
      assert.equal(view.status, "PASS");
      assert.equal(
        view.items.find((i: any) => i.id === "absolute-thickness").verdict,
        "UNKNOWN",
      );
      assert.equal(digest(exterior.contract), original);
      const exactMetricTask = relativeInspectionFixture(true);
      exactMetricTask.record([
        exactMetricTask.item(
          "relative-section",
          "PASS",
          "supplied relative judgement only",
        ),
        exactMetricTask.item(
          "absolute-thickness",
          "UNKNOWN",
          "the predeclared precise metric requirement lacks evidence",
        ),
      ]);
      assert.equal(
        invariantView(
          exactMetricTask.artifacts,
          exactMetricTask.image,
          exactMetricTask.task,
        ).status,
        "UNKNOWN",
      );
      assert.throws(
        () =>
          assertInvariants(
            exactMetricTask.artifacts,
            exactMetricTask.image,
            exactMetricTask.task,
          ),
        { code: "INVARIANTS_PENDING" },
      );
    },
  },
  {
    name: "#17 invariant gate: unseen or wrong-hash/context records cannot satisfy an actual candidate",
    run: () => {
      const f = relativeInspectionFixture(false);
      assert.equal(
        invariantView(f.artifacts, f.image, f.task).status,
        "NOT_EVALUATED",
      );
      f.record(
        [f.item("relative-section", "PASS", "different candidate judgement")],
        { sha256: "b".repeat(64) },
      );
      f.record(
        [f.item("relative-section", "PASS", "different context judgement")],
        { context_epoch: 1 },
      );
      assert.equal(
        invariantView(f.artifacts, f.image, f.task).status,
        "NOT_EVALUATED",
      );
      assert.throws(
        () =>
          inspectionItems(
            [f.item("relative-section", "NOT_RUN", "not inspected")],
            [{ id: "relative-section" }],
          ),
        { code: "INSPECTION" },
      );
      assert.throws(() => assertInvariants(f.artifacts, f.image, f.task), {
        code: "INVARIANTS_PENDING",
      });
      f.record([
        f.item(
          "relative-section",
          "FAIL",
          "current synthetic candidate has a supplied visible contradiction",
        ),
      ]);
      f.record(
        [
          f.item(
            "relative-section",
            "PASS",
            "other hash must not clear current failure",
          ),
        ],
        { sha256: "b".repeat(64) },
      );
      assert.equal(invariantView(f.artifacts, f.image, f.task).status, "FAIL");
    },
  },
);
