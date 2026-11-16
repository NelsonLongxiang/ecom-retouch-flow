import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { readZip, writeZip } from "../infrastructure/zip.ts";
import { bytesHash, requireThat } from "../domain/model.ts";
import {
  validateSnapshot,
  digest,
  assertNoCredentials,
} from "./plugin/commands.mjs";
import { NativeClient } from "./client.ts";
import { objectBytes, putObject } from "./files.ts";
import { Images } from "../adapters/images.ts";
import { fontInfo } from "./fonts.ts";
export function contextCapabilities(snapshot: any): string[] {
  const artifacts = snapshot.tables.artifacts;
  const has = (predicate: (a: any, m: any, c: any) => boolean) =>
    artifacts.some((a: any) => {
      let c: any = null;
      try {
        c = JSON.parse(a.content);
      } catch {}
      return predicate(a, JSON.parse(a.meta || "{}"), c);
    });
  return [
    "ygl-native-project/v1",
    "media-sha256",
    "historical-permission-isolation",
    ...(has(
      (a, m) =>
        m.context_epoch > 0 ||
        m.retouch?.context_epoch > 0 ||
        m.role === "result-revalidation",
    )
      ? ["retouch-result-revalidation/v1"]
      : []),
    ...(has((a, m) =>
      [
        "business-intent",
        "coverage-check",
        "evidence-conflict",
        "product-invariants",
        "invariants-check",
      ].includes(m.role),
    )
      ? ["retouch-flow-contracts/v1"]
      : []),
    ...(has(
      (a, m) =>
        m.role === "font" || m.role === "local-postprocess" || !!m.transform,
    )
      ? ["retouch-postprocess/v1"]
      : []),
    ...(has((a, m) =>
      ["suite-snapshot", "suite-acceptance", "suite-export"].includes(m.role),
    )
      ? ["retouch-suite/v1"]
      : []),
    ...(has(
      (a, m, c) =>
        !!c?.output_profile ||
        c?.operations?.some((op: any) => ["extend", "encode"].includes(op.op)),
    )
      ? ["retouch-suite-output/v1"]
      : []),
    ...(has(
      (a, m, c) =>
        !!m.sealed_output ||
        !!m.source_sealed_output ||
        c?.operations?.some((op: any) => !!op.approval),
    )
      ? ["retouch-output-recovery/v1"]
      : []),
    ...(has(
      (a, m) =>
        m.sealed_output?.output_manifest?.requires_native_current_check ===
          true || m.output_manifest?.requires_native_current_check === true,
    )
      ? ["retouch-output-contract/v1"]
      : []),
    ...(has((a) => a.kind === "executor-profile")
      ? ["retouch-api-fallback/v1"]
      : []),
    ...(has((a, m, c) => a.kind === "profile" && !!c?.rating_record)
      ? ["retouch-rating-scale/v1"]
      : []),
    ...(has(
      (a, m, c) =>
        m.role === "product-facts" ||
        !!c?.facts_id ||
        (m.retouch?.purpose && m.retouch.purpose !== "unspecified") ||
        (c?.fact_check &&
          (c.fact_check.purpose !== "unspecified" ||
            c.fact_check.required_keys?.length)),
    )
      ? ["retouch-product-facts/v1"]
      : []),
    ...(has((a, m, c) => !!c?.profile?.private_http)
      ? ["retouch-private-http/v1"]
      : []),
    ...(has((a, m, c) => !!c?.profile?.configuration_source)
      ? ["retouch-configuration-source/v1"]
      : []),
    ...(has(
      (a, m, c) =>
        !!m.dimension_provenance ||
        !!m.delivery_dimensions ||
        !!m.requested_dimensions ||
        !!c?.delivery_canvas,
    )
      ? ["retouch-dimensions/v1"]
      : []),
  ];
}

export async function exportProject(
  client: NativeClient,
  project: string,
  file: string,
) {
  const bundle = await client.call("bundle", { project }),
    snapshot = validateSnapshot(bundle.snapshot),
    view = bundle.view;
  assertNoCredentials(snapshot);
  const entries = new Map<string, Buffer>();
  entries.set(
    "native-project.json",
    Buffer.from(JSON.stringify(snapshot, null, 2) + "\n"),
  );
  entries.set(
    "BRIEF.md",
    Buffer.from(
      "# " +
        view.project.name +
        "\n\n" +
        view.project.question +
        "\n\n```json\n" +
        JSON.stringify(view, null, 2) +
        "\n```\n",
    ),
  );
  for (const a of snapshot.tables.artifacts.filter(
    (a: any) => JSON.parse(a.meta || "{}").object_path,
  )) {
    const meta = JSON.parse(a.meta);
    entries.set(meta.object_path, await objectBytes(client.root, meta));
  }
  const manifest = {
    schema: "retouch.context/v2",
    producer: { name: "ecom-retouch-flow", version: "0.4.0" },
    exported_at: new Date().toISOString(),
    snapshot_id: snapshot.fingerprint,
    scope: "full_project",
    completeness: { status: "complete", missing: [] },
    requires: contextCapabilities(snapshot),
    project_id: snapshot.project_id,
    fingerprint: snapshot.fingerprint,
    files: [...entries]
      .map(([name, bytes]) => ({
        name,
        sha256: bytesHash(bytes),
        bytes: bytes.length,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
  entries.set(
    "manifest.json",
    Buffer.from(JSON.stringify(manifest, null, 2) + "\n"),
  );
  const target = path.resolve(file),
    parent = path.dirname(target);
  requireThat(
    (await fs.realpath(parent)) === parent,
    "ZIP_TARGET",
    "ZIP 目标目录不能通过链接改向",
    1,
  );
  const staged = path.join(
    parent,
    ".retouch-export-" + crypto.randomUUID() + ".zip",
  );
  try {
    await writeZip(staged, entries);
    await inspectProject(staged);
    // A hard link publishes a fully validated file atomically and refuses an existing target.
    await fs.link(staged, target);
  } finally {
    await fs.unlink(staged).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "ENOENT") throw e;
    });
  }
  return {
    file: target,
    project_id: snapshot.project_id,
    fingerprint: snapshot.fingerprint,
    files: entries.size,
  };
}
export async function inspectProject(file: string) {
  const entries = await readZip(file);
  let manifest: any, snapshot: any;
  try {
    manifest = JSON.parse(entries.get("manifest.json")!.toString());
    snapshot = JSON.parse(entries.get("native-project.json")!.toString());
  } catch {
    requireThat(false, "ZIP_MANIFEST", "ZIP 缺少有效清单或原生快照", 1);
  }
  requireThat(
    manifest.schema === "retouch.context/v2" &&
      Array.isArray(manifest.requires) &&
      [
        "ygl-native-project/v1",
        "media-sha256",
        "historical-permission-isolation",
      ].every((r) => manifest.requires.includes(r)) &&
      manifest.requires.every((r: string) =>
        [
          "ygl-native-project/v1",
          "media-sha256",
          "historical-permission-isolation",
          "retouch-api-fallback/v1",
          "retouch-rating-scale/v1",
          "retouch-product-facts/v1",
          "retouch-private-http/v1",
          "retouch-configuration-source/v1",
          "retouch-dimensions/v1",
          "retouch-result-revalidation/v1",
          "retouch-flow-contracts/v1",
          "retouch-postprocess/v1",
          "retouch-suite/v1",
          "retouch-suite-output/v1",
          "retouch-output-recovery/v1",
          "retouch-output-contract/v1",
        ].includes(r),
      ),
    "ZIP_VERSION",
    "此入口接收原生 v2 ZIP；旧 v1 包须走 legacy inspect/migrate，不能混合恢复",
    1,
  );
  requireThat(
    Array.isArray(manifest.files) &&
      manifest.files.length === entries.size - 1 &&
      new Set(manifest.files.map((f: any) => f.name)).size ===
        manifest.files.length,
    "ZIP_MANIFEST",
    "清单文件数量或名称不一致",
    1,
  );
  for (const f of manifest.files) {
    const bytes = entries.get(f.name);
    requireThat(
      bytes &&
        f.name !== "manifest.json" &&
        bytes.length === f.bytes &&
        bytesHash(bytes) === f.sha256,
      "ZIP_HASH",
      "文件缺失或 hash 不符：" + f.name,
      1,
    );
  }
  validateSnapshot(snapshot);
  requireThat(
    contextCapabilities(snapshot).every((cap) =>
      manifest.requires.includes(cap),
    ),
    "ZIP_CAPABILITY",
    "上下文必须声明评分、商品事实、执行配置等所需能力，旧工具不能静默丢失语义",
    1,
  );
  assertNoCredentials(snapshot);
  requireThat(
    manifest.producer?.name === "ecom-retouch-flow" &&
      typeof manifest.producer.version === "string" &&
      Number.isFinite(Date.parse(manifest.exported_at)) &&
      manifest.snapshot_id === snapshot.fingerprint &&
      manifest.scope === "full_project" &&
      manifest.completeness?.status === "complete" &&
      Array.isArray(manifest.completeness.missing) &&
      manifest.completeness.missing.length === 0,
    "ZIP_MANIFEST",
    "清单缺少来源、快照或完整性声明",
    1,
  );
  requireThat(
    manifest.project_id === snapshot.project_id &&
      manifest.fingerprint === snapshot.fingerprint &&
      entries.has("BRIEF.md"),
    "ZIP_BINDING",
    "清单身份不匹配",
    1,
  );
  const needed = new Set<string>([
    "manifest.json",
    "native-project.json",
    "BRIEF.md",
  ]);
  for (const a of snapshot.tables.artifacts.filter(
    (a: any) => JSON.parse(a.meta || "{}").object_path,
  )) {
    const m = JSON.parse(a.meta),
      bytes = entries.get(m.object_path);
    needed.add(m.object_path);
    requireThat(
      bytes && bytesHash(bytes) === m.sha256 && bytes.length === m.bytes,
      "ZIP_MEDIA",
      "素材缺失或身份不匹配",
      1,
    );
    if (a.kind === "media") {
      const actual = await Images.metadata(bytes);
      requireThat(
        actual.width === m.width &&
          actual.height === m.height &&
          actual.mime === m.mime,
        "ZIP_DIMENSIONS",
        "素材实际尺寸与原生记录不符",
        1,
      );
    }
    if (a.kind === "resource" && m.role === "font")
      requireThat(
        fontInfo(bytes).family === m.family,
        "ZIP_FONT",
        "字体字节与登记family不匹配",
        1,
      );
  }
  requireThat(
    [...entries.keys()].every((name) => needed.has(name)),
    "ZIP_EXTRA",
    "ZIP 包含未关联文件",
    1,
  );
  return { manifest, snapshot, entries };
}
export async function importProject(
  file: string,
  root: string,
  options: {
    dryRun?: boolean;
    entry?: string;
    strategy?: string;
    name?: string;
  },
) {
  const inspected = await inspectProject(file),
    strategy = options.strategy ?? "restore";
  requireThat(
    ["restore", "clone"].includes(strategy),
    "IMPORT_STRATEGY",
    "策略须为 restore 或 clone",
  );
  if (strategy === "clone")
    requireThat(options.name?.trim(), "CLONE_NAME", "clone 必须指定新项目名");
  let client: NativeClient | undefined;
  const exists = await fs
    .access(path.join(root, "workspace.json"))
    .then(() => true)
    .catch(() => false);
  if (exists) client = await NativeClient.open(root);
  if (options.dryRun) {
    if (!client) {
      const stat = await fs.lstat(root).catch((e: NodeJS.ErrnoException) => {
        if (e.code === "ENOENT") return null;
        throw e;
      });
      const conflicts =
        stat &&
        (!stat.isDirectory() ||
          stat.isSymbolicLink() ||
          (await fs.readdir(root)).length > 0)
          ? ["target-not-empty-or-linked"]
          : [];
      return {
        dry_run: true,
        can_restore: conflicts.length === 0,
        conflicts,
        would_initialize: true,
        project_id: inspected.snapshot.project_id,
        strategy,
      };
    }
    const preview = await client.call("restore-preview", {
      snapshot: inspected.snapshot,
      strategy,
      ...(options.name ? { name: options.name } : {}),
    });
    return {
      dry_run: true,
      ...preview,
      strategy,
      clone_requires_new_name: strategy === "clone",
    };
  }
  if (!client)
    client = await NativeClient.initialize(root, options.entry ?? "");
  // Write validated content-addressed bytes first. A failed DB transaction leaves only unreferenced bytes.
  for (const a of inspected.snapshot.tables.artifacts.filter(
    (a: any) => JSON.parse(a.meta || "{}").object_path,
  )) {
    const m = JSON.parse(a.meta);
    await putObject(client.root, inspected.entries.get(m.object_path)!);
  }
  return client.call(
    "restore",
    {
      snapshot: inspected.snapshot,
      strategy,
      ...(options.name ? { name: options.name } : {}),
    },
    "import:" +
      digest({
        fingerprint: inspected.snapshot.fingerprint,
        strategy,
        name: options.name ?? null,
      }),
  );
}
