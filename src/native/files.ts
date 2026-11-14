import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { bytesHash, requireThat } from "../domain/model.ts";
import { Images } from "../adapters/images.ts";
import type { NativeClient } from "./client.ts";
import { digest } from "./plugin/commands.mjs";

export async function safeDirectory(root: string, relative: string) {
  const target = path.resolve(root, relative);
  requireThat(
    target === root || target.startsWith(root + path.sep),
    "PATH_ESCAPE",
    "路径越出工作区",
    1,
  );
  let cursor = root;
  for (const part of path
    .relative(root, target)
    .split(path.sep)
    .filter(Boolean)) {
    cursor = path.join(cursor, part);
    await fs.mkdir(cursor).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "EEXIST") throw e;
    });
    const stat = await fs.lstat(cursor);
    requireThat(
      stat.isDirectory() && !stat.isSymbolicLink(),
      "LINK_PATH",
      "文件目录不能经过链接",
      1,
    );
  }
  return target;
}
export async function putObject(root: string, bytes: Buffer) {
  const sha256 = bytesHash(bytes),
    object_path = "objects/sha256/" + sha256.slice(0, 2) + "/" + sha256;
  await safeDirectory(root, path.dirname(object_path));
  const target = path.join(root, object_path);
  try {
    await fs.writeFile(target, bytes, { flag: "wx" });
  } catch (e) {
    requireThat(
      (e as NodeJS.ErrnoException).code === "EEXIST" &&
        !(await fs.lstat(target)).isSymbolicLink() &&
        bytesHash(await fs.readFile(target)) === sha256,
      "OBJECT_CONFLICT",
      "对象库内容冲突",
      1,
    );
  }
  return { sha256, object_path, bytes: bytes.length };
}
export async function objectBytes(root: string, meta: any): Promise<Buffer> {
  requireThat(
    /^[a-f0-9]{64}$/.test(meta.sha256) &&
      meta.object_path ===
        "objects/sha256/" + meta.sha256.slice(0, 2) + "/" + meta.sha256,
    "OBJECT_PATH",
    "对象路径无效",
    1,
  );
  const file = path.join(root, meta.object_path);
  requireThat(
    (await fs.realpath(file)) === file &&
      !(await fs.lstat(file)).isSymbolicLink(),
    "OBJECT_LINK",
    "对象路径不能经过链接",
    1,
  );
  const bytes = await fs.readFile(file);
  requireThat(
    bytesHash(bytes) === meta.sha256 && bytes.length === meta.bytes,
    "OBJECT_HASH",
    "对象字节不匹配",
    1,
  );
  return bytes;
}
export async function readImage(file: string) {
  const stat = await fs.lstat(file);
  requireThat(
    stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.size > 0 &&
      stat.size <= 32 * 1024 * 1024,
    "IMAGE_FILE",
    "图像须为本地非链接文件且不超过 32 MiB",
  );
  const bytes = await fs.readFile(file);
  return { bytes, metadata: await Images.metadata(bytes) };
}
export async function registerMedia(
  client: NativeClient,
  project: string,
  task: string,
  file: string,
  meta: Record<string, any>,
  requestId: string,
) {
  const { bytes, metadata } = await readImage(file);
  return client.call(
    "media",
    {
      ...meta,
      project,
      task,
      ...metadata,
      ...(await putObject(client.root, bytes)),
    },
    requestId,
  );
}
export async function registerBytes(
  client: NativeClient,
  project: string,
  task: string,
  bytes: Buffer,
  meta: Record<string, any>,
  requestId: string,
) {
  return client.call(
    "media",
    {
      ...meta,
      project,
      task,
      ...(await Images.metadata(bytes)),
      ...(await putObject(client.root, bytes)),
    },
    requestId,
  );
}
export async function completeRun(
  client: NativeClient,
  project: string,
  runId: string,
  file: string,
  revision: number,
  requestId: string,
  receipt: any = null,
  registeredRaw: any = null,
  processedOutput: any = null,
) {
  requireThat(
    receipt === null ||
      (receipt &&
        typeof receipt.tool === "string" &&
        typeof receipt.tool_receipt === "string"),
    "HOST_RECEIPT",
    "工具回执须包含 tool 和去敏后的 tool_receipt",
  );
  const prior = await client.call("receipt", { request_id: requestId });
  if (prior?.result) {
    const previous = prior.result.execution;
    requireThat(
      prior.action === "run-complete" &&
        previous.id === runId &&
        previous.project_id === project,
      "REQUEST_CONFLICT",
      "相同请求键用于不同运行",
      1,
    );
    const raw = await client.call("show", {
      project,
      id: JSON.parse(previous.meta).raw_output,
    });
    requireThat(
      JSON.parse(raw.meta).sha256 === bytesHash((await readImage(file)).bytes),
      "REQUEST_CONFLICT",
      "相同回接请求携带不同文件",
      1,
    );
    requireThat(
      digest(JSON.parse(previous.meta).tool_receipt ?? null) ===
        digest(receipt),
      "REQUEST_CONFLICT",
      "相同回接请求携带不同来源回执",
      1,
    );
    return { ...prior.result, replayed: true };
  }
  const run = await client.call("show", { project, id: runId }),
    rm = JSON.parse(run.meta),
    plan = JSON.parse(run.content),
    step = plan.steps[rm.step];
  const { bytes, metadata: rawMetadata } = await readImage(file);
  if (registeredRaw)
    requireThat(
      registeredRaw.project_id === project &&
        JSON.parse(registeredRaw.meta).sha256 === bytesHash(bytes),
      "API_RESULT_BINDING",
      "已登记的原始输出与实际文件不符",
      1,
    );
  const raw = registeredRaw
    ? { artifact: registeredRaw }
    : await registerBytes(
        client,
        project,
        rm.task_id,
        bytes,
        {
          role: "model-output",
          parents: [rm.input_id],
          operation: "host image tool; actual raw bytes",
        },
        requestId + ":raw",
      );
  let output = raw.artifact;
  let generatedBytes: Buffer = bytes,
    metadata = rawMetadata;
  if (processedOutput) {
    const m = JSON.parse(processedOutput.meta);
    requireThat(
      processedOutput.project_id === project &&
        m.task_id === rm.task_id &&
        m.parents.includes(raw.artifact.id),
      "POSTPROCESS_BINDING",
      "后处理图须派生于该原始 API 结果",
      1,
    );
    generatedBytes = await objectBytes(client.root, m);
    metadata = await Images.metadata(generatedBytes);
    output = processedOutput;
  }
  if (step?.region) {
    const input = await client.call("show", { project, id: rm.input_id }),
      im = JSON.parse(input.meta),
      r = step.region;
    requireThat(
      metadata.width === im.width && metadata.height === im.height,
      "REGION_DIMENSIONS",
      "局部修改结果须保持输入坐标系；需要变尺寸时使用全图步骤",
    );
    const before = await sharp(await objectBytes(client.root, im))
      .toColourspace("srgb")
      .ensureAlpha()
      .raw()
      .toBuffer();
    const generated = await sharp(generatedBytes)
      .toColourspace("srgb")
      .ensureAlpha()
      .raw()
      .toBuffer();
    for (let y = r.y; y < r.y + r.height; y++) {
      const start = (y * im.width + r.x) * 4;
      generated.copy(before, start, start, start + r.width * 4);
    }
    const composed = await sharp(before, {
      raw: { width: im.width, height: im.height, channels: 4 },
    })
      .png()
      .toBuffer();
    output = (
      await registerBytes(
        client,
        project,
        rm.task_id,
        composed,
        {
          role: "candidate",
          parents: [rm.input_id, processedOutput?.id ?? raw.artifact.id],
          operation: "approved-region composite",
        },
        requestId + ":composite",
      )
    ).artifact;
  }
  return client.call(
    "run-complete",
    {
      project,
      id: runId,
      output: output.id,
      raw_output: raw.artifact.id,
      ...(processedOutput ? { processed_output: processedOutput.id } : {}),
      expected_revision: revision,
      receipt,
    },
    requestId,
  );
}
export async function resizeMedia(
  client: NativeClient,
  project: string,
  id: string,
  width: number,
  height: number,
  requestId: string,
) {
  requireThat(
    [width, height].every((n) => Number.isSafeInteger(n) && n > 0 && n <= 8192),
    "DIMENSIONS",
    "后处理尺寸须为 1–8192 整数",
  );
  const parent = await client.call("show", { project, id }),
    m = JSON.parse(parent.meta);
  const bytes = await sharp(await objectBytes(client.root, m))
    .resize(width, height, { fit: "fill" })
    .png()
    .toBuffer();
  return registerBytes(
    client,
    project,
    m.task_id,
    bytes,
    {
      role: "postprocess",
      parents: [id],
      operation: "sharp resize " + width + "x" + height,
    },
    requestId,
  );
}
export async function deliverRun(
  client: NativeClient,
  project: string,
  id: string,
  directory: string,
  revision: number,
  requestId: string,
) {
  const target = path.resolve(directory);
  requireThat(
    !target.startsWith(client.root + path.sep) && target !== client.root,
    "DELIVERY_PATH",
    "交付目录须独立于运行工作区",
  );
  const reserved = await client.call(
    "run-deliver",
    { project, id, directory: target, expected_revision: revision },
    requestId + ":intent",
  );
  const rm = JSON.parse(reserved.execution.meta),
    image = await client.call("show", { project, id: rm.accepted_id });
  const manifest_sha256 = await publishMedia(client, image, target, {
    execution_id: id,
  });
  return client.call(
    "run-delivered",
    {
      project,
      id,
      directory: target,
      manifest_sha256,
      expected_revision: rm.revision,
    },
    requestId + ":commit",
  );
}
async function publishMedia(
  client: NativeClient,
  image: any,
  target: string,
  identity: Record<string, unknown>,
) {
  requireThat(
    !target.startsWith(client.root + path.sep) && target !== client.root,
    "DELIVERY_PATH",
    "交付须独立于运行工作区",
  );
  const im = JSON.parse(image.meta),
    bytes = await objectBytes(client.root, im);
  const parent = await fs.realpath(path.dirname(target));
  requireThat(
    parent === path.dirname(target),
    "DELIVERY_LINK",
    "交付父目录不能经链接改向",
    1,
  );
  await fs.mkdir(target).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== "EEXIST") throw e;
  });
  requireThat(
    !(await fs.lstat(target)).isSymbolicLink(),
    "DELIVERY_LINK",
    "交付目录不能为链接",
    1,
  );
  const manifest = {
    schema: "retouch.delivery/v2",
    project_id: image.project_id,
    ...identity,
    media_id: image.id,
    sha256: im.sha256,
    width: im.width,
    height: im.height,
    bytes: im.bytes,
  };
  async function immutable(name: string, data: Buffer) {
    const file = path.join(target, name);
    try {
      await fs.writeFile(file, data, { flag: "wx" });
    } catch (e) {
      requireThat(
        (e as NodeJS.ErrnoException).code === "EEXIST" &&
          !(await fs.lstat(file)).isSymbolicLink() &&
          bytesHash(await fs.readFile(file)) === bytesHash(data),
        "DELIVERY_CONFLICT",
        "交付已有不同内容，停止覆盖",
        1,
      );
    }
  }
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
  await immutable(
    "image." +
      (im.mime === "image/jpeg"
        ? "jpg"
        : im.mime === "image/webp"
          ? "webp"
          : "png"),
    bytes,
  );
  await immutable("manifest.json", manifestBytes);
  return bytesHash(manifestBytes);
}
export async function deliverArtifact(
  client: NativeClient,
  project: string,
  id: string,
  directory: string,
  requestId: string,
) {
  const target = path.resolve(directory),
    reserved = await client.call(
      "delivery-prepare",
      { project, id, directory: target },
      requestId + ":intent",
    );
  const manifest_sha256 = await publishMedia(client, reserved.media, target, {
    delivery_id: reserved.delivery.id,
  });
  return client.call(
    "delivery-complete",
    { project, id: reserved.delivery.id, manifest_sha256 },
    requestId + ":commit",
  );
}
