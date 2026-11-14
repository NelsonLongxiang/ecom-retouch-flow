// The only production path into the v1 ledger: read-only inspection and explicit isolated migration.
import fs from "node:fs/promises";
import path from "node:path";
import { Store } from "../infrastructure/store.ts";
import { projectRecords } from "../application/projects.ts";
import { inspectContext } from "../application/context-exchange.ts";
import {
  taskProgress,
  graphDiagnostics,
  type ContextRecord,
} from "../domain/context.ts";
import { requireThat, bytesHash } from "../domain/model.ts";
import { NativeClient } from "./client.ts";
import { digest, stable, validateSnapshot } from "./plugin/commands.mjs";
import { putObject } from "./files.ts";

type LegacySource = {
  records: ContextRecord[];
  files: Map<string, Buffer>;
  events: any[];
  identity: string;
};
export async function readLegacy(
  root?: string,
  project?: string,
  zip?: string,
): Promise<LegacySource> {
  if (zip) {
    const bundle = await inspectContext(zip);
    return {
      records: bundle.records,
      files: bundle.files,
      events: bundle.events,
      identity: bundle.manifest.source.workspace_id,
    };
  }
  requireThat(
    root && project,
    "LEGACY_SOURCE",
    "须指定旧 --workspace 和 --project，或旧 ZIP --file",
  );
  const store = await Store.open(root, true);
  try {
    const records = projectRecords(store, project),
      files = new Map<string, Buffer>();
    for (const r of records.filter(
      (r) => r.kind === "asset" || r.kind === "artifact",
    )) {
      const d = r.data;
      if (!d.object_path) continue;
      const full = path.resolve(store.root, d.object_path);
      requireThat(
        full.startsWith(path.join(store.root, "objects") + path.sep) &&
          (await fs.realpath(full)) === full,
        "LEGACY_OBJECT",
        "旧素材路径越界",
        1,
      );
      const bytes = await fs.readFile(full);
      requireThat(
        bytesHash(bytes) === d.sha256 && bytes.length === d.bytes,
        "LEGACY_HASH",
        "旧素材字节不符",
        1,
      );
      files.set(d.object_path, bytes);
    }
    const tasks = new Set(
      records.filter((r) => r.kind === "task").map((r) => r.id),
    );
    const events = store.db
      .prepare("SELECT * FROM events ORDER BY rowid")
      .all()
      .filter(
        (e: any) =>
          tasks.has(e.task_id) || JSON.stringify(e.document).includes(project),
      );
    return { records, files, events, identity: store.config.id };
  } finally {
    store.close();
  }
}

export function legacySnapshot(source: LegacySource) {
  const rows = source.records,
    issues = graphDiagnostics(rows);
  requireThat(
    !issues.length,
    "LEGACY_GRAPH",
    "旧项目关系不完整，须先复核：" + issues.map((i) => i.code).join(","),
    1,
  );
  const old = rows.find((r) => r.kind === "project")!.data,
    pid = old.id,
    created = old.created_at;
  const mapped = new Map<string, string>(),
    n = (kind: string, id: string) => {
      const key = kind + ":" + id;
      if (!mapped.has(key))
        mapped.set(key, "m" + digest({ project: pid, kind, id }).slice(0, 31));
      return mapped.get(key)!;
    };
  for (const r of rows)
    if (!["project", "relation"].includes(r.kind)) n(r.kind, r.id);
  const treeId = "m" + digest({ project: pid, tree: true }).slice(0, 31),
    rootId = "m" + digest({ project: pid, root: true }).slice(0, 31),
    profileId = "m" + digest({ project: pid, profile: true }).slice(0, 31);
  const tables: any = {
    projects: [
      {
        id: pid,
        name: old.name,
        question: old.original_intent,
        inclusion: old.business_object,
        exclusion: "",
        status: old.status === "archived" ? "archived" : "active",
        created,
        updated: created,
      },
    ],
    trees: [
      {
        id: treeId,
        project_id: pid,
        name: "retouch-" + pid,
        note: "Read-only v1 migration",
        created,
      },
    ],
    nodes: [],
    node_edges: [],
    node_conditions: [],
    node_state: [],
    artifacts: [],
    relations: [],
    events: [],
  };
  const add = (
    id: string,
    kind: string,
    title: string,
    content: any,
    meta: any = {},
    version = 1,
    at = created,
  ) => {
    const a = {
      id,
      project_id: pid,
      kind,
      title,
      format: typeof content === "string" ? "markdown" : "json",
      content: typeof content === "string" ? content : stable(content),
      version,
      created: at,
      updated: "",
      meta: stable({ schema: "retouch.native/v1", ...meta }),
    };
    tables.artifacts.push(a);
    return a;
  };
  const rel = (
    st: string,
    si: string,
    dt: string,
    di: string,
    name: string,
  ) => {
    const id = "m" + digest({ st, si, dt, di, name }).slice(0, 31);
    if (!tables.relations.some((r: any) => r.id === id))
      tables.relations.push({
        id,
        src_type: st,
        src_id: si,
        dst_type: dt,
        dst_id: di,
        rel: name,
        weight: 1,
        created,
      });
  };
  const by = (kind: string, id: string) =>
    rows.find((r) => r.kind === kind && r.id === id)?.data;
  const goal = (d: any) => n("goal", d.goal_id + "@" + d.goal_version);
  add(
    profileId,
    "profile",
    "E-commerce project profile",
    {
      tags: [],
      rating: null,
      conclusion: "",
      completion:
        old.status === "archived"
          ? {
              reason: "historical",
              statement: "原工作区已归档；未补造用户结语",
            }
          : null,
      original_intent: old.original_intent,
    },
    {
      previous: null,
      legacy_identity: { workspace: source.identity, id: pid },
    },
  );
  tables.nodes.push({
    id: rootId,
    tree_id: treeId,
    key: "project",
    name: old.name,
    kind: "tech",
    tier: 0,
    cost: 0,
    cost_unit: "",
    payload: stable({ schema: "retouch.native/v1", profile_id: profileId }),
    tags: "",
    created,
  });
  rel("node", rootId, "artifact", profileId, "described-by");
  const assetOwners = new Map<string, string>();
  for (const r of rows.filter((r) => r.kind === "task"))
    for (const id of [r.data.original_asset_id, r.data.working_asset_id])
      if (id && !assetOwners.has(id)) assetOwners.set(id, r.id);
  for (const r of rows.filter((r) => r.kind === "artifact"))
    if (r.data.asset_id) assetOwners.set(r.data.asset_id, r.data.task_id);
  for (const r of rows.filter((r) => r.kind === "goal")) {
    const d = r.data;
    add(
      n(r.kind, r.id),
      "spec",
      "Goal " + d.id,
      {
        schema: "retouch.native/v1",
        role: "goal",
        scope: d.scope,
        preserve: [d.preserve],
        done_when: d.acceptance,
        original_text: d.original_text,
        interpretation: d.interpretation,
        confirmation: d.confirmation,
        source: d.confirmation_source,
      },
      { role: "goal", legacy_id: r.id },
      d.version,
      d.created_at,
    );
    rel("node", rootId, "artifact", n(r.kind, r.id), "specified-by");
  }
  for (const r of rows.filter((r) => r.kind === "task")) {
    const d = r.data,
      progress = taskProgress(rows, r.id),
      status =
        d.workflow_status === "completed"
          ? "done"
          : progress.status === "draft"
            ? "todo"
            : "doing";
    add(
      n(r.kind, r.id),
      "task",
      d.title,
      d.brief,
      {
        status,
        status_at: d.created_at,
        retouch: {
          schema: "retouch.native/v1",
          revision: r.revision,
          goal_id: goal(d),
          goal_version: d.goal_version,
          kind: d.kind ?? "image",
          expected_output: d.expected_output,
          done_when: d.done_when,
          dependencies: (d.dependencies ?? []).map((id: string) =>
            n("task", id),
          ),
          requirements: d.requirements,
          plan_id: d.active_plan ? n("plan", d.active_plan) : null,
          active_run: d.active_run ? n("run", d.active_run) : null,
          context_status: d.context_status,
          legacy_progress: progress,
          legacy_id: r.id,
        },
      },
      1,
      d.created_at,
    );
    const nodeId = "m" + digest({ task: r.id, node: true }).slice(0, 31);
    tables.nodes.push({
      id: nodeId,
      tree_id: treeId,
      key: "task-" + n(r.kind, r.id),
      name: d.title,
      kind: "tech",
      tier: 0,
      cost: 0,
      cost_unit: "",
      payload: stable({
        schema: "retouch.native/v1",
        task_id: n(r.kind, r.id),
      }),
      tags: "",
      created: d.created_at,
    });
    rel("node", nodeId, "task", n(r.kind, r.id), "tracked-by");
    rel("task", n(r.kind, r.id), "artifact", goal(d), "specified-by");
  }
  for (const r of rows.filter((r) => r.kind === "task"))
    for (const dep of r.data.dependencies ?? []) {
      const parent = tables.nodes.find(
          (x: any) => x.key === "task-" + n("task", dep),
        ),
        child = tables.nodes.find(
          (x: any) => x.key === "task-" + n("task", r.id),
        );
      tables.node_edges.push({
        id: "m" + digest({ dep, child: r.id }).slice(0, 31),
        tree_id: treeId,
        parent_id: parent.id,
        child_id: child.id,
        rel: "prereq",
        mode: "AND",
        required: 1,
        min_level: 1,
        weight: 1,
        note: "",
        created,
      });
    }
  for (const r of rows.filter(
    (r) => r.kind === "asset" || r.kind === "artifact",
  )) {
    const d = r.data,
      owner = d.task_id ?? assetOwners.get(r.id),
      t = by("task", owner);
    requireThat(t, "LEGACY_OWNER", "旧素材无法确认任务归属：" + r.id, 1);
    const bytes = source.files.get(d.object_path);
    requireThat(bytes, "LEGACY_FILE", "旧素材缺失：" + r.id, 1);
    const image = !!d.width,
      role =
        d.purpose ?? (r.id === t.original_asset_id ? "original" : "reference");
    add(
      n(r.kind, r.id),
      image ? "media" : "file",
      (image ? "Image " : "File ") + r.id,
      "",
      {
        task_id: n("task", owner),
        goal_id: goal(t),
        goal_version: t.goal_version,
        sha256: d.sha256,
        bytes: d.bytes,
        object_path: d.object_path,
        mime: d.mime,
        width: d.width,
        height: d.height,
        role,
        parents: [],
        confirmation: d.status ?? "unreviewed",
        fact_role: d.fact_role ?? "reference",
        source: d.source ?? "legacy actual bytes",
        legacy_id: r.id,
      },
      d.version ?? 1,
      d.created_at,
    );
    rel(
      "task",
      n("task", owner),
      "artifact",
      n(r.kind, r.id),
      ["original", "working", "reference"].includes(role) ? "uses" : "produced",
    );
  }
  for (const r of rows.filter((r) => r.kind === "plan")) {
    const d = r.data,
      t = by("task", d.task_id)!;
    const nativePlan = add(
      n(r.kind, r.id),
      "spec",
      "Workflow " + n("task", d.task_id),
      {
        schema: "retouch.native/v1",
        role: "workflow-plan",
        task_id: n("task", d.task_id),
        goal_id: goal(d),
        goal_version: d.goal_version,
        input_id: n("asset", d.working_asset_id),
        requirements: t.requirements.filter(
          (g: any) => g.text.trim() && !g.disabled,
        ),
        requirements_hash: digest(t.requirements),
        executor: "host",
        steps: d.steps.map((s: any) => ({
          ...s,
          ...(s.region
            ? {
                coordinate_system: {
                  width: by("asset", d.working_asset_id)!.width,
                  height: by("asset", d.working_asset_id)!.height,
                },
              }
            : {}),
          input: s.input,
          reference_asset_ids: (s.reference_asset_ids ?? []).map((id: string) =>
            n("asset", id),
          ),
        })),
        legacy_executor: d.executor,
      },
      { role: "workflow-plan", task_id: n("task", d.task_id), legacy_id: r.id },
      d.revision ?? 1,
      d.created_at,
    );
    let previousStep: string | null = null;
    for (let position = 0; position < d.steps.length; position++) {
      const nid = "m" + digest({ plan: nativePlan.id, position }).slice(0, 31);
      tables.nodes.push({
        id: nid,
        tree_id: treeId,
        key: "step-" + nativePlan.id + "-" + position,
        name: d.steps[position].id,
        kind: "tech",
        tier: position,
        cost: 0,
        cost_unit: "",
        payload: stable({
          schema: "retouch.native/v1",
          plan_id: nativePlan.id,
          task_id: n("task", d.task_id),
          step_id: d.steps[position].id,
          position,
        }),
        tags: "",
        created: d.created_at,
      });
      rel("artifact", nativePlan.id, "node", nid, "implemented-by");
      if (previousStep)
        tables.node_edges.push({
          id: "m" + digest({ parent: previousStep, child: nid }).slice(0, 31),
          tree_id: treeId,
          parent_id: previousStep,
          child_id: nid,
          rel: "prereq",
          mode: "AND",
          required: 1,
          min_level: 1,
          weight: 1,
          note: "",
          created: d.created_at,
        });
      previousStep = nid;
    }
  }
  for (const r of rows.filter((r) => r.kind === "grant")) {
    const d = r.data;
    add(
      n(r.kind, r.id),
      "authorization",
      "Historical authorization " + r.id,
      d.confirmation,
      {
        task_id: n("task", d.task_id),
        plan_id: n("plan", d.plan_hash),
        workspace_id: source.identity,
        issuer: d.issuer,
        expires_at: d.expires_at,
        legacy_id: r.id,
      },
      1,
      d.created_at,
    );
  }
  for (const r of rows.filter(
    (r) => r.kind === "run" || r.kind === "attempt" || r.kind === "execution",
  )) {
    const d = r.data,
      t = by("task", d.task_id)!,
      p = by("plan", d.plan_hash),
      isRun = r.kind === "run";
    const outputIds = isRun
      ? Object.values(d.completed_steps ?? {}).map((id: any) => n("asset", id))
      : r.kind === "attempt"
        ? [d.output_asset_id]
            .filter(Boolean)
            .map((id: string) => n("asset", id))
        : (d.output_artifact_ids ?? []).map((id: string) => n("artifact", id));
    const status = ["unknown", "intent"].includes(d.status)
      ? "unknown"
      : d.status === "waiting_for_host"
        ? "prepared"
        : d.status === "waiting_for_review" && isRun
          ? "waiting_for_acceptance"
          : d.status === "waiting_for_step_review"
            ? "waiting_for_review"
            : d.status;
    add(
      n(r.kind, r.id),
      "execution",
      (isRun ? "Workflow execution " : "Historical execution ") + r.id,
      isRun && p
        ? JSON.parse(
            tables.artifacts.find((a: any) => a.id === n("plan", d.plan_hash))
              .content,
          )
        : {
            original_operation: d.operation,
            scope: d.scope,
            recovery_note: d.recovery_note,
          },
      {
        role: isRun
          ? "workflow-run"
          : r.kind === "attempt"
            ? "historical-attempt"
            : "external",
        revision: r.revision,
        task_id: n("task", d.task_id),
        goal_id: goal(t),
        status,
        outputs: outputIds,
        ...(isRun
          ? {
              plan_id: n("plan", d.plan_hash),
              grant_id: n("grant", d.grant_id),
              step: outputIds.length,
              input_id:
                outputIds.at(-1) ??
                n("asset", p?.working_asset_id ?? t.working_asset_id),
              accepted_id: d.accepted_asset_id
                ? n("asset", d.accepted_asset_id)
                : null,
              candidate:
                d.current_attempt &&
                by("attempt", d.current_attempt)?.output_asset_id
                  ? n(
                      "asset",
                      by("attempt", d.current_attempt)!.output_asset_id,
                    )
                  : (outputIds.at(-1) ?? null),
            }
          : {
              inputs: (d.input_artifact_ids ?? []).map((id: string) =>
                n("artifact", id),
              ),
            }),
        legacy_id: r.id,
        legacy_status: d.status,
        external_request: d.request_id ?? null,
      },
      1,
      d.created_at,
    );
    rel(
      "task",
      n("task", d.task_id),
      "artifact",
      n(r.kind, r.id),
      "executed-by",
    );
    for (const id of outputIds)
      rel("artifact", n(r.kind, r.id), "artifact", id, "produced");
    if (isRun && p)
      for (let position = 0; position < p.steps.length; position++) {
        const step = tables.nodes.find(
            (s: any) =>
              s.key === "step-" + n("plan", d.plan_hash) + "-" + position,
          ),
          unlocked = !!d.completed_steps?.[p.steps[position].id];
        tables.node_state.push({
          tree_id: treeId,
          context: n("run", r.id),
          node_id: step.id,
          status: unlocked ? "unlocked" : "locked",
          level: unlocked ? 1 : 0,
          progress: unlocked ? 1 : 0,
          updated: d.created_at,
        });
      }
  }
  for (const r of rows.filter(
    (r) =>
      r.kind === "design" || r.kind === "provenance" || r.kind === "review",
  )) {
    const d = r.data,
      content =
        r.kind === "provenance"
          ? d.text
          : r.kind === "review"
            ? d.confirmation
            : {
                facts: d.facts,
                status: d.status,
                confirmation_source: d.confirmation_source,
              };
    add(
      n(r.kind, r.id),
      r.kind === "provenance" ? "note" : r.kind,
      r.kind + " " + r.id,
      content,
      {
        ...(d.task_id ? { task_id: n("task", d.task_id) } : {}),
        ...(d.goal_id ? { goal_id: goal(d) } : {}),
        ...(d.artifact_id ? { media_id: n("artifact", d.artifact_id) } : {}),
        source: d.source ?? d.confirmation_source,
        role: d.role ?? "reference",
        design_type: r.kind === "design" ? "arch" : undefined,
        legacy_id: r.id,
        legacy_fact_roles: d.facts,
      },
      d.version ?? 1,
      d.created_at,
    );
    rel(
      d.task_id ? "task" : "node",
      d.task_id ? n("task", d.task_id) : rootId,
      "artifact",
      n(r.kind, r.id),
      "described-by",
    );
  }
  for (const r of rows.filter((r) => r.kind === "relation")) {
    const d = r.data,
      ref = (v: string) => {
        const cut = v.indexOf(":"),
          kind = v.slice(0, cut),
          id = v.slice(cut + 1);
        return kind === "project"
          ? ["node", rootId]
          : [kind === "task" ? "task" : "artifact", n(kind, id)];
      };
    const [st, si] = ref(d.src),
      [dt, di] = ref(d.dst);
    if (
      (!tables.artifacts.some((a: any) => a.id === si) && si !== rootId) ||
      (!tables.artifacts.some((a: any) => a.id === di) && di !== rootId)
    )
      continue;
    rel(st, si, dt, di, d.rel);
    if (d.rel === "derived-from") {
      const child = tables.artifacts.find(
        (a: any) => a.id === si && a.kind === "media",
      );
      if (child) {
        const meta = JSON.parse(child.meta);
        meta.parents = [...new Set([...meta.parents, di])];
        child.meta = stable(meta);
      }
    }
  }
  for (const event of source.events)
    tables.events.push({
      id:
        "m" + digest({ source: source.identity, event: event.id }).slice(0, 31),
      ts: event.created_at,
      actor: "legacy-import",
      kind: "retouch.history",
      entity: "project",
      entity_id: pid,
      payload: stable({ source_workspace: source.identity, original: event }),
      level: "info",
      seq: null,
    });
  const snapshot = {
    schema: "retouch.native-project/v1",
    project_id: pid,
    tables,
    fingerprint: digest(tables),
  };
  validateSnapshot(snapshot);
  return {
    snapshot,
    mapping: [...mapped].map(([source, target]) => ({ source, target })),
    progress: rows
      .filter((r) => r.kind === "task")
      .map((r) => ({ task: r.id, ...taskProgress(rows, r.id) })),
  };
}
export async function migrateLegacy(
  source: LegacySource,
  target: string,
  entry: string,
  dryRun: boolean,
) {
  const converted = legacySnapshot(source);
  if (dryRun)
    return {
      dry_run: true,
      project_id: converted.snapshot.project_id,
      mapping: converted.mapping,
      progress: converted.progress,
      target: path.resolve(target),
      writes: "none",
    };
  requireThat(
    !(await fs.access(path.join(target, "workspace.json")).then(
      () => true,
      () => false,
    )),
    "MIGRATION_TARGET",
    "旧账本迁移只允许新的隔离目标，不修改已有业务工作区",
  );
  const client = await NativeClient.initialize(target, entry);
  for (const a of converted.snapshot.tables.artifacts.filter(
    (a: any) => JSON.parse(a.meta).object_path,
  )) {
    const meta = JSON.parse(a.meta);
    await putObject(client.root, source.files.get(meta.object_path)!);
  }
  const result = await client.call(
    "restore",
    { snapshot: converted.snapshot, strategy: "restore" },
    "legacy-migration:" + converted.snapshot.fingerprint,
  );
  return {
    ...result,
    mapping: converted.mapping,
    progress: converted.progress,
    source_access: "read-only",
  };
}
