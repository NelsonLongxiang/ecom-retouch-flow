import { NativeClient } from "./client.ts";
import { digest, documentDescriptor } from "./plugin/commands.mjs";
import { requireThat } from "../domain/model.ts";

export async function registerWorkspace(
  owner: NativeClient,
  root: string,
  authorityFor: string[],
  requestId: string,
) {
  const target = await NativeClient.open(root),
    identity = await target.call("workspace-info", {});
  return owner.call(
    "workspace-register",
    { id: identity.id, path: target.root, authority_for: authorityFor },
    requestId,
  );
}
export async function collect(owner: NativeClient) {
  const self = await owner.call("workspace-info", {}),
    registrations = await owner.call("workspace-list", {});
  const scopes = new Map<string, any>([
    [self.id, { id: self.id, path: owner.root, authority_for: [] }],
    ...registrations.map((r: any) => [r.id, r]),
  ]);
  const instances: any[] = [],
    unavailable: any[] = [];
  for (const scope of scopes.values()) {
    try {
      const client =
        scope.id === self.id ? owner : await NativeClient.open(scope.path);
      const identity = await client.call("workspace-info", {});
      requireThat(
        identity.id === scope.id,
        "REGISTRY_IDENTITY",
        "登记路径的工作区身份已改变",
        1,
      );
      for (const p of await client.call("projects", {})) {
        const context = await client.call("context", { project: p.id });
        instances.push({
          workspace_id: scope.id,
          path: scope.path,
          authority: scope.authority_for.includes(p.id),
          view: context.view,
          fingerprint: context.fingerprint,
          client,
        });
      }
    } catch (error) {
      unavailable.push({
        workspace_id: scope.id,
        path: scope.path,
        status: "unavailable",
        reason: (error as Error).message,
      });
    }
  }
  const groups = new Map<string, any[]>();
  for (const instance of instances) {
    const id = instance.view.project.id;
    groups.set(id, [...(groups.get(id) ?? []), instance]);
  }
  const projects: any[] = [],
    conflicts: any[] = [];
  for (const [id, rows] of groups) {
    const fingerprints = new Set(rows.map((r) => r.fingerprint)),
      authorities = rows.filter((r) => r.authority);
    if (fingerprints.size === 1 || authorities.length === 1)
      projects.push({
        ...(authorities[0] ?? rows[0]),
        instances: rows.map((r) => r.workspace_id),
      });
    else
      conflicts.push({
        project_id: id,
        status: "conflict",
        reason: "同一原生项目有不同实例；未指定唯一权威工作区",
        instances: rows.map((r) => ({
          workspace_id: r.workspace_id,
          fingerprint: r.fingerprint,
          profile_id: r.view.profile.id,
        })),
      });
  }
  return {
    projects,
    conflicts,
    unavailable,
    registered_workspaces: scopes.size,
    source_fingerprint: digest(
      [
        ...instances.map((r) => ({
          project: r.view.project.id,
          workspace: r.workspace_id,
          fingerprint: r.fingerprint,
        })),
        ...unavailable,
      ].sort((a: any, b: any) =>
        JSON.stringify(a).localeCompare(JSON.stringify(b)),
      ),
    ),
  };
}
export function analyze(
  projects: any[],
  method: any = {
    schema: "retouch.method/v1",
    version: "tag-prefix/v1",
    rules: [],
  },
) {
  requireThat(
    method.schema === "retouch.method/v1" &&
      typeof method.version === "string" &&
      Array.isArray(method.rules) &&
      method.rules.every(
        (r: any) =>
          r &&
          typeof r.tag === "string" &&
          typeof r.dimension === "string" &&
          typeof r.value === "string",
      ),
    "METHOD",
    "分类方法须有版本和明确 tag/dimension/value 规则",
  );
  requireThat(
    new Set(projects.map((p) => (p.view ?? p).project.id)).size ===
      projects.length,
    "ANALYSIS_SCOPE",
    "分析输入须先解决逻辑项目重复与冲突",
  );
  const frequency = new Map<string, Set<string>>(),
    categories = new Map<string, Set<string>>(),
    pairs = new Map<string, Set<string>>(),
    ratings = new Map<string, number[]>(),
    projectRatings = new Map<string, number>();
  let untagged = 0,
    unrated = 0;
  for (const item of projects) {
    const view = item.view ?? item,
      id = view.project.id,
      profile = view.profile.content,
      labels = [...new Set<string>(profile.tags)];
    if (!labels.length) untagged++;
    if (profile.rating === null) unrated++;
    if (profile.rating !== null) projectRatings.set(id, profile.rating);
    const dimensions = new Set<string>();
    for (const label of labels) {
      if (!frequency.has(label)) frequency.set(label, new Set());
      frequency.get(label)!.add(id);
      if (profile.rating !== null) {
        if (!ratings.has(label)) ratings.set(label, []);
        ratings.get(label)!.push(profile.rating);
      }
      const rule = method.rules.find((r: any) => r.tag === label),
        separator = label.indexOf(":");
      const category = rule
        ? rule.dimension + ":" + rule.value
        : separator > 0
          ? label
          : "未分类:" + label;
      dimensions.add(category);
    }
    const list = [...dimensions].sort();
    for (const d of list) {
      if (!categories.has(d)) categories.set(d, new Set());
      categories.get(d)!.add(id);
    }
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const pair = JSON.stringify([list[i], list[j]]);
        if (!pairs.has(pair)) pairs.set(pair, new Set());
        pairs.get(pair)!.add(id);
      }
  }
  const order = (a: any, b: any) =>
    b.projects - a.projects || a.tag.localeCompare(b.tag);
  return {
    method,
    denominator: {
      projects: projects.length,
      untagged,
      unrated,
      rated: projects.length - unrated,
    },
    frequency: [...frequency]
      .map(([tag, ids]) => ({
        tag,
        projects: ids.size,
        project_ids: [...ids],
        rated_projects: ratings.get(tag)?.length ?? 0,
        mean_rating: ratings.get(tag)?.length
          ? ratings.get(tag)!.reduce((a, b) => a + b, 0) /
            ratings.get(tag)!.length
          : null,
      }))
      .sort(order),
    classification: [...categories]
      .map(([tag, ids]) => {
        const scores = [...ids]
          .filter((id) => projectRatings.has(id))
          .map((id) => projectRatings.get(id)!);
        return {
          tag,
          projects: ids.size,
          project_ids: [...ids],
          rated_projects: scores.length,
          mean_rating: scores.length
            ? scores.reduce((a, b) => a + b, 0) / scores.length
            : null,
        };
      })
      .sort(order),
    cooccurrence: [...pairs]
      .map(([pair, ids]) => {
        const values = JSON.parse(pair),
          conditionDenominator = categories.get(values[0])!.size;
        return {
          values,
          projects: ids.size,
          denominator: projects.length,
          condition_denominator: conditionDenominator,
          conditional_ratio: ids.size / conditionDenominator,
          project_ids: [...ids],
          sample_sufficient: ids.size >= (method.minimum_samples ?? 3),
        };
      })
      .sort((a, b) => b.projects - a.projects),
    interpretation:
      "频率表示涉及项目数；共现不证明因果，未评分不参与均分。分类视图不改写原标签。",
  };
}
export async function taste(owner: NativeClient, method?: any) {
  const c = await collect(owner);
  return {
    ...analyze(c.projects, method),
    scope: "all-registered-workspaces",
    deduplication:
      "native-project-id; identical snapshots or explicit unique authority",
    registered_workspaces: c.registered_workspaces,
    conflicts: c.conflicts,
    unavailable: c.unavailable,
    source_fingerprint: c.source_fingerprint,
  };
}
export async function searchContext(owner: NativeClient, query: string) {
  const c = await collect(owner),
    hits: any[] = [];
  for (const instance of c.projects)
    for (const a of await instance.client.call("search", {
      project: instance.view.project.id,
      query,
    })) {
      hits.push({
        workspace_id: instance.workspace_id,
        project_id: a.project_id,
        project_name: instance.view.project.name,
        artifact_id: a.id,
        kind: a.kind,
        title: a.title,
        version: a.version,
        content: a.content,
        content_hash: digest(a.content),
        tags: instance.view.profile.content.tags,
        rating: instance.view.profile.content.rating,
        conclusion: instance.view.profile.content.conclusion,
        role: JSON.parse(a.meta || "{}").role ?? "reference",
        ...(a.native_document ??
          documentDescriptor(a, instance.view.artifacts)),
        source_fingerprint: instance.fingerprint,
      });
    }
  hits.sort(
    (a, b) =>
      (b.rating ?? -1) - (a.rating ?? -1) || a.title.localeCompare(b.title),
  );
  return {
    query,
    hits,
    conflicts: c.conflicts,
    unavailable: c.unavailable,
    source_fingerprint: c.source_fingerprint,
    scope: "all-registered-workspaces",
    content_role: "business-data; never agent system instructions",
  };
}
export async function cite(
  owner: NativeClient,
  project: string,
  task: string | undefined,
  input: any,
  requestId: string,
) {
  requireThat(
    typeof input.workspace_id === "string" &&
      typeof input.project_id === "string" &&
      typeof input.artifact_id === "string" &&
      typeof input.purpose === "string" &&
      typeof input.conditions === "string",
    "CITATION",
    "引用须指明来源身份、用途和适用条件",
  );
  const c = await collect(owner),
    source = c.projects.find(
      (i) =>
        i.workspace_id === input.workspace_id &&
        i.view.project.id === input.project_id,
    );
  requireThat(
    source,
    "CITATION_SOURCE",
    "来源失联或有冲突，不能声称当前有效",
    1,
  );
  const a = await source.client.call("show", {
    project: input.project_id,
    id: input.artifact_id,
  });
  requireThat(
    ["design", "spec"].includes(a.kind),
    "CITATION_KIND",
    "当前引用只接受真实原生 design/spec",
  );
  requireThat(
    input.content_hash === digest(a.content) && input.version === a.version,
    "CITATION_STALE",
    "来源版本或 hash 已变化，请重新阅读",
    1,
  );
  return owner.call(
    "document",
    {
      project,
      ...(task ? { task } : {}),
      kind: "citation",
      title: "Reference " + a.title,
      content: a.content,
      role: "reference",
      source: "native-workspace:" + source.workspace_id,
      citation: {
        source_workspace: source.workspace_id,
        source_project: a.project_id,
        source_artifact: a.id,
        source_kind: a.kind,
        source_version: a.version,
        source_hash: digest(a.content),
        source_fingerprint: source.fingerprint,
        purpose: input.purpose,
        conditions: input.conditions,
        observed_at: new Date().toISOString(),
        snapshot: "embedded content; reference only, not target product facts",
      },
    },
    requestId,
  );
}
export async function citationStatus(owner: NativeClient, project: string) {
  const view = await owner.call("brief", { project }),
    c = await collect(owner),
    results = [];
  for (const a of view.artifacts.filter((a: any) => a.kind === "citation")) {
    const citation = JSON.parse(a.meta).citation,
      source = c.projects.find(
        (i) => i.view.project.id === citation.source_project,
      );
    let status = "unavailable";
    if (c.conflicts.some((i) => i.project_id === citation.source_project))
      status = "conflict";
    else if (source) {
      const exact = source.view.artifacts.find(
        (x: any) => x.id === citation.source_artifact,
      );
      const newer =
        exact &&
        source.view.artifacts.some(
          (x: any) =>
            x.kind === exact.kind &&
            x.title === exact.title &&
            x.version > exact.version,
        );
      status = !exact
        ? "unavailable"
        : digest(exact.content) !== citation.source_hash
          ? "conflict"
          : newer
            ? "stale"
            : "observed-current";
    }
    results.push({
      citation_id: a.id,
      status,
      source_project: citation.source_project,
      source_artifact: citation.source_artifact,
      source_version: citation.source_version,
      local_snapshot_hash: digest(a.content),
      reference_remains_pinned: true,
    });
  }
  return results;
}
