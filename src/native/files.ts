import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { bytesHash, requireThat, RetouchError } from "../domain/model.ts";
import { Images } from "../adapters/images.ts";
import type { NativeClient } from "./client.ts";
import { digest } from "./plugin/commands.mjs";
import { freezeDimension } from "./plugin/media-diagnostics.mjs";

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
  const run = await client.call("show", { project, id }),
    rmBefore = JSON.parse(run.meta);
  requireThat(
    typeof rmBefore.accepted_id === "string",
    "RUN_STATE",
    "交付前须有用户接受",
    1,
  );
  const image = await client.call("show", {
    project,
    id: rmBefore.accepted_id,
  });
  const prior = await client.call("receipt", {
    request_id: requestId + ":intent",
  });
  if (prior?.result)
    requireThat(
      prior.action === "run-deliver" &&
        prior.result.execution?.id === id &&
        prior.result.execution?.project_id === project &&
        samePath(
          JSON.parse(prior.result.execution.meta).delivery_directory,
          target,
        ),
      "REQUEST_CONFLICT",
      "相同请求键用于其他交付意图",
      1,
    );
  const previousDimensions = prior?.result
    ? JSON.parse(prior.result.execution.meta).delivery_dimensions
    : (rmBefore.delivery_dimensions ??
      freezeDimension(
        (await client.call("dimensions", { project, id: image.id })).images[0],
      ));
  let prepared: Publication;
  try {
    prepared = await preparePublication(client, image, target, {
      execution_id: id,
      ...(previousDimensions
        ? { dimension_provenance: previousDimensions }
        : {}),
    });
  } catch (error) {
    if (prior?.result || rmBefore.status === "delivering")
      publicationError(error, id);
    throw error;
  }
  const reserved = await client.call(
    "run-deliver",
    { project, id, directory: target, expected_revision: revision },
    requestId + ":intent",
  );
  try {
    const dimensions = JSON.parse(reserved.execution.meta).delivery_dimensions;
    prepared.manifestBytes = manifestBytes(image, {
      execution_id: id,
      ...(dimensions ? { dimension_provenance: dimensions } : {}),
    });
    const manifest_sha256 = await publishMedia(client, image, target, prepared);
    return await client.call(
      "run-delivered",
      {
        project,
        id,
        directory: target,
        manifest_sha256,
        expected_revision: JSON.parse(reserved.execution.meta).revision,
      },
      requestId + ":commit",
    );
  } catch (error) {
    publicationError(error, id);
  }
}
const pathKey = (value: string) =>
  process.platform === "win32" ? value.toLowerCase() : value;
const samePath = (a: string, b: string) => pathKey(a) === pathKey(b);
type Publication = {
  parent: string;
  directory: string | null;
  imageName: string;
  bytes: Buffer;
  manifest: any;
  manifestBytes: Buffer | null;
};
const fileIdentity = (stat: Awaited<ReturnType<typeof fs.stat>>) =>
  stat.dev + ":" + stat.ino;
function manifestBytes(image: any, identity: Record<string, unknown>) {
  const im = JSON.parse(image.meta);
  return Buffer.from(
    JSON.stringify(
      {
        schema: "retouch.delivery/v2",
        project_id: image.project_id,
        ...identity,
        media_id: image.id,
        sha256: im.sha256,
        width: im.width,
        height: im.height,
        bytes: im.bytes,
      },
      null,
      2,
    ) + "\n",
  );
}
function publicationError(error: unknown, id: string): never {
  const e = error as any;
  throw new RetouchError(
    e.code ?? "DELIVERY_PUBLISH",
    "交付准备已登记，发布未确认完成；请核对后以同键同路径恢复。",
    1,
    {
      preparation_committed: true,
      artifact_id: id,
      cause: e.code ?? "IO",
      recovery:
        "replay same request; or delivery abandon after inspecting files",
    },
    e.effectStatus === "unknown" ? "unknown" : "committed",
  );
}
async function directoryState(client: NativeClient, target: string) {
  const rel = path.relative(client.root, target),
    inverse = path.relative(target, client.root);
  requireThat(
    rel &&
      (rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) &&
      inverse &&
      (inverse.startsWith(".." + path.sep) || path.isAbsolute(inverse)),
    "DELIVERY_PATH",
    "交付目录须独立于运行工作区",
    1,
  );
  const parent = path.dirname(target);
  requireThat(
    samePath(await fs.realpath(parent), parent),
    "DELIVERY_LINK",
    "交付父目录不能经链接改向",
    1,
  );
  const ps = await fs.stat(parent);
  requireThat(ps.isDirectory(), "DELIVERY_PATH", "交付父目录须已存在", 1);
  const stat = await fs.lstat(target).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return null;
    throw e;
  });
  requireThat(
    !stat ||
      (stat.isDirectory() &&
        !stat.isSymbolicLink() &&
        samePath(await fs.realpath(target), target)),
    "DELIVERY_LINK",
    "交付目标须为非链接目录",
    1,
  );
  return {
    parent: fileIdentity(ps),
    directory: stat ? fileIdentity(stat) : null,
  };
}
async function checkPublishedFile(
  target: string,
  name: string,
  bytes: Buffer | null,
) {
  const file = path.join(target, name);
  const stat = await fs.lstat(file).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return null;
    throw e;
  });
  if (!stat) return;
  requireThat(
    bytes &&
      stat.isFile() &&
      !stat.isSymbolicLink() &&
      bytesHash(await fs.readFile(file)) === bytesHash(bytes),
    "DELIVERY_CONFLICT",
    "交付已有不同内容或不属于本次意图的文件，停止覆盖",
    1,
  );
}
async function preparePublication(
  client: NativeClient,
  image: any,
  target: string,
  identity: Record<string, unknown> | null,
): Promise<Publication> {
  const state = await directoryState(client, target);
  const im = JSON.parse(image.meta),
    bytes = await objectBytes(client.root, im);
  const manifest = {
    schema: "retouch.delivery/v2",
    project_id: image.project_id,
    ...(identity ?? {}),
    media_id: image.id,
    sha256: im.sha256,
    width: im.width,
    height: im.height,
    bytes: im.bytes,
  };
  const imageName =
    "image." +
    (im.mime === "image/jpeg"
      ? "jpg"
      : im.mime === "image/webp"
        ? "webp"
        : "png");
  const expectedManifest = identity ? manifestBytes(image, identity) : null;
  if (state.directory) {
    await checkPublishedFile(target, imageName, bytes);
    await checkPublishedFile(target, "manifest.json", expectedManifest);
  }
  return {
    ...state,
    imageName,
    bytes,
    manifest,
    manifestBytes: expectedManifest,
  };
}
async function publishMedia(
  client: NativeClient,
  image: any,
  target: string,
  prepared: Publication,
) {
  let state = await directoryState(client, target);
  requireThat(
    state.parent === prepared.parent && state.directory === prepared.directory,
    "DELIVERY_PATH_CHANGED",
    "交付路径在准备后发生变化，请先核对",
    1,
  );
  if (!state.directory) await fs.mkdir(target);
  state = await directoryState(client, target);
  const recheck = async () => {
    const now = await directoryState(client, target);
    requireThat(
      now.parent === state.parent && now.directory === state.directory,
      "DELIVERY_PATH_CHANGED",
      "发布目录已发生变化",
      1,
    );
  };
  const manifestBytes = prepared.manifestBytes!;
  async function immutable(name: string, data: Buffer) {
    await recheck();
    const file = path.join(target, name);
    try {
      await fs.writeFile(file, data, { flag: "wx" });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
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
  await immutable(prepared.imageName, prepared.bytes);
  await immutable("manifest.json", manifestBytes);
  await recheck();
  return bytesHash(manifestBytes);
}
export async function deliverArtifact(
  client: NativeClient,
  project: string,
  id: string,
  directory: string,
  requestId: string,
) {
  const target = path.resolve(directory);
  const prior = await client.call("receipt", {
    request_id: requestId + ":intent",
  });
  if (prior?.result) {
    const d = prior.result.delivery,
      m = d && JSON.parse(d.meta);
    requireThat(
      prior.action === "delivery-prepare" &&
        d?.project_id === project &&
        m.media_id === id &&
        samePath(m.directory, target),
      "REQUEST_CONFLICT",
      "相同请求键携带不同交付意图",
      1,
    );
    requireThat(
      JSON.parse((await client.call("show", { project, id: d.id })).meta)
        .status !== "abandoned",
      "DELIVERY_ABANDONED",
      "该交付已显式放弃，不能重放发布",
      1,
    );
  }
  const image = await client.call("show", { project, id });
  const previousDimensions = prior?.result
    ? JSON.parse(prior.result.delivery.meta).dimension_provenance
    : null;
  let prepared: Publication;
  try {
    prepared = await preparePublication(
      client,
      image,
      target,
      prior?.result
        ? {
            delivery_id: prior.result.delivery.id,
            ...(previousDimensions
              ? { dimension_provenance: previousDimensions }
              : {}),
          }
        : null,
    );
  } catch (error) {
    if (prior?.result) publicationError(error, prior.result.delivery.id);
    throw error;
  }
  const reserved = await client.call(
    "delivery-prepare",
    { project, id, directory: target },
    requestId + ":intent",
  );
  const dimensions = JSON.parse(reserved.delivery.meta).dimension_provenance;
  prepared.manifestBytes = manifestBytes(image, {
    delivery_id: reserved.delivery.id,
    ...(dimensions ? { dimension_provenance: dimensions } : {}),
  });
  try {
    const manifest_sha256 = await publishMedia(
      client,
      reserved.media,
      target,
      prepared,
    );
    return await client.call(
      "delivery-complete",
      { project, id: reserved.delivery.id, manifest_sha256 },
      requestId + ":commit",
    );
  } catch (error) {
    publicationError(error, reserved.delivery.id);
  }
}
export async function abandonDelivery(
  client: NativeClient,
  project: string,
  id: string,
  statement: string,
  requestId: string,
) {
  const delivery = await client.call("show", { project, id }),
    m = JSON.parse(delivery.meta);
  requireThat(delivery.kind === "delivery", "DELIVERY", "需要交付工件", 1);
  const manifestFile = path.join(m.directory, "manifest.json");
  const stat = await fs
    .lstat(manifestFile)
    .catch((e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") return null;
      throw e;
    });
  requireThat(
    !stat || (stat.isFile() && !stat.isSymbolicLink()),
    "DELIVERY_LINK",
    "处置前不能沿清单链接读取其他文件",
    1,
  );
  const manifest = await fs
    .readFile(path.join(m.directory, "manifest.json"), "utf8")
    .then(JSON.parse)
    .catch((e) => {
      if (e.code === "ENOENT" || e instanceof SyntaxError) return null;
      throw e;
    });
  requireThat(
    manifest?.delivery_id !== id,
    "DELIVERY_ALREADY_PUBLISHED",
    "已存在此交付的发布清单，请重放原意图完成登记",
    1,
  );
  return client.call(
    "delivery-abandon",
    { project, id, statement, publication_inspected: true },
    requestId,
  );
}
