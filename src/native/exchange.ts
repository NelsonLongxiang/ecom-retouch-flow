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
    requires: [
      "ygl-native-project/v1",
      "media-sha256",
      "historical-permission-isolation",
      ...(snapshot.tables.artifacts.some(
        (a: any) => a.kind === "executor-profile",
      )
        ? ["retouch-api-fallback/v1"]
        : []),
    ],
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
    !snapshot.tables.artifacts.some(
      (a: any) => a.kind === "executor-profile",
    ) || manifest.requires.includes("retouch-api-fallback/v1"),
    "ZIP_CAPABILITY",
    "API fallback 上下文必须声明所需能力，旧工具不能静默丢失语义",
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
