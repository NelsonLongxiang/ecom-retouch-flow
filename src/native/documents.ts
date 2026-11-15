import fs from "node:fs/promises";
import path from "node:path";
import { NativeClient } from "./client.ts";
import { assertNoCredentials } from "./plugin/commands.mjs";
import { requireThat, RetouchError, bytesHash } from "../domain/model.ts";

export async function exportDocument(
  client: NativeClient,
  project: string,
  id: string,
  to: string,
) {
  const a = await client.call("show", { project, id });
  assertNoCredentials(a);
  requireThat(
    a.native_document,
    "DOCUMENT_KIND",
    "此入口只导出原生文档；图片使用 artifact deliver",
  );
  const identity = await client.call("workspace-info", {});
  const source = { workspace_id: identity.id, ...a.native_document };
  const manifest = {
    schema: "retouch.document-copy/v1",
    authority: "exported-copy",
    source,
    exported_at: new Date().toISOString(),
    content_hash_scope:
      "native content string; SHA-256 of canonical JSON string",
  };
  const metadata = JSON.stringify(manifest)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e");
  const content =
    a.format === "json" ? "```json\n" + a.content + "\n```" : a.content;
  const bytes = Buffer.from(
    "---\nretouch_export: " +
      metadata +
      "\n---\n\n" +
      "> 可读导出副本。正式正文和版本由原生工件管理；本文件的编辑不会回写。\n\n" +
      content,
    "utf8",
  );
  const file = path.resolve(to);
  try {
    await fs.writeFile(file, bytes, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new RetouchError(
        "EXPORT_EXISTS",
        "导出目标已存在；请选择新的明确路径，历史副本不会覆盖",
        1,
      );
    throw error;
  }
  return {
    file,
    authority: "exported-copy",
    source,
    sha256: bytesHash(bytes),
    native_modified: false,
  };
}
