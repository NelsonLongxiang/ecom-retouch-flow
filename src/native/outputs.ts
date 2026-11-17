import fs from "node:fs/promises";
import path from "node:path";
import { NativeClient } from "./client.ts";
import { transform, renderingFingerprint } from "./postprocess.ts";
import { objectBytes, safeDirectory } from "./files.ts";
import { digest, assertNoCredentials } from "./plugin/commands.mjs";
import { outputProfile } from "./plugin/output-profile.mjs";
import { taskBinding } from "./plugin/applicability.mjs";
import { writeZip, readZip, ZIP_LIMITS } from "../infrastructure/zip.ts";
import {
  bytesHash,
  requireThat,
  RetouchError,
  stable,
} from "../domain/model.ts";

const jsonBytes = (v: any) =>
  Buffer.from(JSON.stringify(JSON.parse(stable(v)), null, 2) + "\n");
const encode = (
  format: "png" | "jpeg",
  quality = 90,
  background = "#ffffff",
) => ({ op: "encode", format, quality, background, colourspace: "srgb" });
const safeName = (v: string) => /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(v);
async function statOrNull(file: string) {
  return fs.lstat(file).catch((e) => {
    if (e.code === "ENOENT") return null;
    throw e;
  });
}
async function verifyDirectory(directory: string, expected: any) {
  const stat = await fs.lstat(directory);
  requireThat(
    stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      (await fs.realpath(directory)) === directory,
    "OUTPUT_LINK",
    "输出目录不得为链接",
  );
  requireThat(
    expected?.schema === "retouch.output-components/v1" &&
      Array.isArray(expected.files),
    "OUTPUT_MANIFEST",
    "缺少原生组件清单",
  );
  requireThat(
    JSON.stringify((await fs.readdir(directory)).sort()) ===
      JSON.stringify(
        [...expected.files.map((f: any) => f.name), "components.json"].sort(),
      ),
    "OUTPUT_CONFLICT",
    "输出目录有未声明或缺失组件",
  );
  for (const file of expected.files) {
    requireThat(
      safeName(file.name) && /^[a-f0-9]{64}$/.test(file.sha256),
      "OUTPUT_MANIFEST",
      "组件路径/hash无效",
    );
    const target = path.join(directory, file.name),
      s = await fs.lstat(target);
    requireThat(
      s.isFile() &&
        !s.isSymbolicLink() &&
        bytesHash(await fs.readFile(target)) === file.sha256 &&
        s.size === file.bytes,
      "OUTPUT_CONFLICT",
      "组件缺失、链接或字节已变：" + file.name,
    );
  }
  const marker = path.join(directory, "components.json");
  requireThat(
    !(await fs.lstat(marker)).isSymbolicLink() &&
      (await fs.readFile(marker)).equals(jsonBytes(expected)),
    "OUTPUT_CONFLICT",
    "完成标记与原生组件清单不一致",
  );
}

async function resumePublished(
  c: NativeClient,
  project: string,
  target: string,
  delivery: any,
  frozen: any,
  key: string,
) {
  const sealed = JSON.parse(delivery.meta).sealed_output;
  requireThat(
    sealed,
    "OUTPUT_UNSEALED",
    "已发布标记没有原生封存身份；保留现场，不重建或猜测完成",
  );
  const marker = path.join(target, "components.json"),
    stat = await fs.lstat(marker);
  requireThat(
    stat.isFile() && !stat.isSymbolicLink() && stat.size <= ZIP_LIMITS.entry,
    "OUTPUT_MANIFEST",
    "完成标记必须为受限非链接文件",
  );
  let components: any;
  try {
    components = JSON.parse(await fs.readFile(marker, "utf8"));
  } catch {
    throw new RetouchError(
      "OUTPUT_MANIFEST",
      "完成标记不是有效JSON；保留现场，不重建已发布文件",
    );
  }
  requireThat(
    components.project_id === project &&
      components.snapshot_id === frozen.snapshot_id &&
      components.snapshot_hash === frozen.snapshot_hash &&
      components.profile_hash === digest(frozen.output_profile) &&
      components.mode === frozen.mode &&
      components.restorable_workspace === false,
    "OUTPUT_BINDING",
    "完成标记与原生冻结意图不符",
  );
  requireThat(
    stable(components) === stable(sealed.output_manifest),
    "OUTPUT_SEAL_CONFLICT",
    "完成标记与原生封存不符",
  );
  await verifyDirectory(target, components);
  const files = await readZip(path.join(target, "review.zip"));
  let catalog: any;
  try {
    catalog = JSON.parse(files.get("manifest.json")!.toString());
  } catch {
    throw new RetouchError("OUTPUT_MANIFEST", "已发布图片包缺少有效清单");
  }
  requireThat(
    stable(catalog) === stable(sealed.output_catalog),
    "OUTPUT_SEAL_CONFLICT",
    "包内清单与原生封存不符",
  );
  const profile = frozen.output_profile;
  requireThat(
    catalog.project_id === project &&
      catalog.snapshot_id === frozen.snapshot_id &&
      catalog.snapshot_hash === frozen.snapshot_hash &&
      catalog.profile_hash === digest(profile) &&
      stable(catalog.output_profile) === stable(profile) &&
      catalog.restorable_workspace === false &&
      catalog.schema ===
        (frozen.mode === "preview"
          ? "retouch.image-preview/v1"
          : "retouch.image-delivery/v1") &&
      Array.isArray(catalog.slots) &&
      catalog.slots.length === frozen.slots.length,
    "OUTPUT_BINDING",
    "已发布清单与原生冻结意图不符",
  );
  const brief = await c.call("brief", { project }),
    { dimensions, ...rawProfile } = profile;
  outputProfile(rawProfile, frozen.slots, brief.artifacts);
  const checkMedia = async (ref: any, bytes?: Buffer) => {
    const a = brief.artifacts.find(
      (a: any) => a.id === ref?.media_id && a.kind === "media",
    );
    requireThat(a, "OUTPUT_BINDING", "已发布清单引用不存在的原生媒体");
    const m = JSON.parse(a.meta);
    requireThat(
      m.sha256 === ref.sha256,
      "OUTPUT_BINDING",
      "已发布媒体hash与原生事实不符",
    );
    const nativeBytes = await objectBytes(c.root, m);
    if (bytes)
      requireThat(
        bytes.equals(nativeBytes),
        "OUTPUT_CONFLICT",
        "已发布字节与原生媒体不符",
      );
    return { a, m };
  };
  const expected = new Set([
    "manifest.json",
    "README.md",
    "reading.jpg",
    "overview.jpg",
  ]);
  const seen = new Set();
  for (let i = 0; i < catalog.slots.length; i++) {
    const slot = catalog.slots[i],
      source = frozen.slots.find((s: any) => s.id === slot.id);
    requireThat(
      source &&
        !seen.has(slot.id) &&
        profile.order[i] === slot.id &&
        source.media_id === slot.media_id &&
        source.sha256 === slot.sha256,
      "OUTPUT_BINDING",
      "已发布槽位或顺序不符",
    );
    seen.add(slot.id);
    for (const [ref, extension, directory] of [
      [slot.png, "png", "pages"],
      [slot.gallery, "jpg", "gallery"],
    ] as const) {
      const name =
        directory +
        "/" +
        String(i + 1).padStart(2, "0") +
        "__" +
        slot.id +
        "." +
        extension;
      requireThat(
        ref?.file === name && files.has(name),
        "OUTPUT_BINDING",
        "已发布单页名称或内容缺失",
      );
      expected.add(name);
      await checkMedia(ref, files.get(name));
    }
    await checkMedia(slot.long_page);
    requireThat(
      stable(slot.long_page.crop) === stable(profile.crops[slot.id] ?? null) &&
        slot.long_page.width === dimensions.pages[i].width &&
        slot.long_page.height === dimensions.pages[i].height,
      "OUTPUT_BINDING",
      "已发布长图页裁切或尺寸与冻结配置不符",
    );
  }
  const external = catalog.long?.location === "outside-package";
  requireThat(
    catalog.long?.file === "long-hd.png" &&
      ["outside-package", "in-package"].includes(catalog.long.location) &&
      (!external || profile.overflow === "split") &&
      components.package_self_contained === !external &&
      stable(components.files.map((f: any) => f.name).sort()) ===
        stable(["review.zip", ...(external ? ["long-hd.png"] : [])].sort()),
    "OUTPUT_BINDING",
    "已发布组件范围或分离策略不符",
  );
  const longBytes = external
    ? await fs.readFile(path.join(target, "long-hd.png"))
    : files.get("long-hd.png");
  requireThat(
    longBytes &&
      longBytes.length === catalog.long.bytes &&
      catalog.long.width === dimensions.width &&
      catalog.long.height === dimensions.height,
    "OUTPUT_BINDING",
    "已发布高清组件或尺寸不符",
  );
  if (!external) expected.add("long-hd.png");
  await checkMedia(catalog.long, longBytes);
  await checkMedia(catalog.reading, files.get("reading.jpg"));
  await checkMedia(catalog.overview, files.get("overview.jpg"));
  requireThat(
    files.size === expected.size &&
      [...expected].every((name) => files.has(name)),
    "OUTPUT_CONFLICT",
    "已发布图片包有未声明或缺失文件",
  );
  const result = await c.call(
    "suite-export-complete",
    {
      project,
      id: delivery.id,
      sha256: components.files.find((f: any) => f.name === "review.zip").sha256,
      output_manifest: components,
      output_catalog: catalog,
    },
    key + ":complete",
  );
  return {
    ...result,
    file: target,
    manifest: components,
    outputs: catalog,
    replayed: false,
    image_api_requests: 0,
  };
}

export async function exportOutputs(
  c: NativeClient,
  project: string,
  id: string,
  file: string,
  input: any,
  key: string,
) {
  assertNoCredentials(input);
  requireThat(
    Object.keys(input).every((k) =>
      ["mode", "from_id", "output_profile"].includes(k),
    ),
    "OUTPUT_PROFILE",
    "输出编排不接受未知顶层字段",
  );
  const target = path.resolve(file),
    parent = path.dirname(target),
    rel = path.relative(c.root, target),
    inverse = path.relative(target, c.root);
  requireThat(
    rel &&
      (rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) &&
      inverse &&
      (inverse.startsWith(".." + path.sep) || path.isAbsolute(inverse)),
    "DELIVERY_PATH",
    "输出组件目录须在业务工作区之外",
  );
  requireThat(
    (await fs.realpath(parent)) === parent,
    "DELIVERY_LINK",
    "输出父目录不能经链接改向",
  );
  const parentStat = await fs.stat(parent),
    existing = await statOrNull(target),
    prior = await c.call("receipt", { request_id: key + ":prepare" });
  requireThat(
    !existing ||
      (existing.isDirectory() && !existing.isSymbolicLink() && prior?.result),
    "DELIVERY_CONFLICT",
    "输出目录已存在或为链接",
  );
  requireThat(
    (await fs.stat(c.root)).dev === parentStat.dev,
    "OUTPUT_VOLUME",
    "组件目录须与工作区同卷以便独占发布；跨卷请先同卷导出，再显式复制并核对组件清单",
  );
  if (!prior?.result) {
    const view = await c.call("suite-view", { project, id });
    let slots = view.slots;
    if (input.from_id) {
      const previous = await c.call("suite-view", {
        project,
        id: input.from_id,
      });
      slots = slots.filter(
        (s: any) =>
          !previous.slots.some(
            (x: any) =>
              x.id === s.id &&
              x.media_id === s.media_id &&
              x.sha256 === s.sha256,
          ),
      );
    }
    const brief = await c.call("brief", { project });
    try {
      outputProfile(input.output_profile, slots, brief.artifacts);
    } catch (e) {
      throw new RetouchError(
        (e as any).code ?? "OUTPUT_PROFILE",
        (e as Error).message,
        2,
        (e as any).details ?? null,
        "none",
      );
    }
    requireThat(
      slots.every((s: any) => s.current),
      "SUITE_MEDIA_STALE",
      "先review/adopt过期媒体并冻结新快照，不自动改原media或继承接受",
    );
  }
  const prepared = await c.call(
    "suite-export-prepare",
    {
      project,
      id,
      file: target,
      mode: input.mode,
      from_id: input.from_id ?? null,
      renderer: { ...renderingFingerprint(), operations: "retouch-local/v2" },
      output_profile: input.output_profile,
    },
    key + ":prepare",
  );
  const delivery = await c.call("show", { project, id: prepared.delivery.id }),
    dm = JSON.parse(delivery.meta),
    frozen = JSON.parse(delivery.content);
  if (
    dm.status !== "completed" &&
    frozen.output_profile?.overflow === "split"
  ) {
    throw new RetouchError(
      "OUTPUT_SPLIT_UNSUPPORTED",
      "首版不执行split，包括历史未完成意图；保留原交付准备事实，降低尺寸或分批后使用新意图",
      1,
      { delivery_id: delivery.id },
      "committed",
    );
  }
  if (dm.status === "completed") {
    await verifyDirectory(target, dm.output_manifest);
    return {
      delivery,
      file: target,
      manifest: dm.output_manifest,
      replayed: true,
      image_api_requests: 0,
    };
  }
  let stageParent = "",
    stage: string | null = null;
  try {
    if (existing && (await statOrNull(path.join(target, "components.json")))) {
      return await resumePublished(c, project, target, delivery, frozen, key);
    }
    stageParent = await safeDirectory(c.root, "tmp/suite-outputs");
    stage = await fs.mkdtemp(path.join(stageParent, "staged-"));
    const profile = frozen.output_profile,
      slots = frozen.slots;
    requireThat(
      profile && slots.every((s: any) => safeName(s.id)),
      "OUTPUT_PROFILE",
      "缺少冻结输出配置或槽位身份",
    );
    const brief = await c.call("brief", { project }),
      sources = new Map<string, any>(
        brief.artifacts.map((a: any) => [a.id, a]),
      );
    const current = await c.call("suite-view", { project, id });
    requireThat(
      slots.every((s: any) =>
        current.slots.some(
          (x: any) =>
            x.id === s.id &&
            x.current &&
            x.media_id === s.media_id &&
            x.sha256 === s.sha256,
        ),
      ),
      "SUITE_MEDIA_STALE",
      "准备后上下文已变化，先按原生review/adopt复核，不能自动刷新",
    );
    const derive = async (
      task: string,
      main: any,
      images: any[],
      operations: any[],
    ) => {
      const owner = brief.tasks.find((t: any) => t.id === task);
      requireThat(
        owner && owner.meta.retouch.context_status !== "needs_review",
        "CONTEXT_STALE",
        "后处理任务须当前有效",
      );
      const descriptor = {
        input_id: main.id,
        inputs: [...new Map(images.map((a) => [a.id, a])).values()].map(
          (a) => ({
            id: a.id,
            sha256: JSON.parse(a.meta).sha256,
            role: "snapshot output source",
          }),
        ),
        operations,
      };
      const renderKey =
        "suite-output:" +
        digest({
          project,
          task,
          binding: taskBinding(owner, digest),
          ...descriptor,
          renderer: frozen.renderer,
        });
      const result = await transform(
        c,
        project,
        task,
        descriptor,
        owner.meta.retouch.revision,
        renderKey,
        { reuseCompleted: true },
      );
      const a = result.artifact;
      sources.set(a.id, a);
      return a;
    };
    const bytes = async (a: any) => objectBytes(c.root, JSON.parse(a.meta));
    const entries = new Map<string, Buffer>(),
      list: any[] = [],
      longPages: any[] = [];
    const ownerTask = JSON.parse(prepared.snapshot.meta).task_id;
    for (let n = 0; n < profile.order.length; n++) {
      const slot = slots.find((s: any) => s.id === profile.order[n]),
        source = sources.get(slot.media_id),
        m = JSON.parse(source.meta);
      requireThat(m.sha256 === slot.sha256, "SUITE_MEDIA", "槽位媒体hash变化");
      const canonical = await derive(
        m.task_id,
        source,
        [source],
        [encode("png")],
      );
      const gallery = await derive(
        m.task_id,
        canonical,
        [canonical],
        [
          {
            op: "resize",
            width: profile.gallery.size - profile.gallery.padding * 2,
            height: profile.gallery.size - profile.gallery.padding * 2,
            fit: "contain",
            background: profile.gallery.background,
          },
          ...(profile.gallery.padding
            ? [
                {
                  op: "extend",
                  top: profile.gallery.padding,
                  bottom: profile.gallery.padding,
                  left: profile.gallery.padding,
                  right: profile.gallery.padding,
                  background: profile.gallery.background,
                },
              ]
            : []),
          encode("jpeg", profile.gallery.quality, profile.gallery.background),
        ],
      );
      const crop = profile.crops[slot.id],
        dim = profile.dimensions.pages[n];
      const page = await derive(
        m.task_id,
        canonical,
        [canonical],
        [
          ...(crop
            ? [
                {
                  op: "extract",
                  region: crop.region,
                  coordinate_system: crop.coordinate_system,
                  approval: crop.approval,
                  quote: crop.quote,
                  source_media_id: source.id,
                  source_sha256: m.sha256,
                },
              ]
            : []),
          {
            op: "resize",
            width: dim.width,
            height: dim.height,
            fit: "contain",
            background: profile.long.background,
          },
          encode("png"),
        ],
      );
      longPages.push(page);
      const prefix = String(n + 1).padStart(2, "0") + "__" + slot.id,
        png = "pages/" + prefix + ".png",
        jpg = "gallery/" + prefix + ".jpg";
      entries.set(png, await bytes(canonical));
      entries.set(jpg, await bytes(gallery));
      list.push({
        ...slot,
        source: {
          media_id: source.id,
          sha256: m.sha256,
          width: m.width,
          height: m.height,
        },
        png: {
          file: png,
          media_id: canonical.id,
          sha256: JSON.parse(canonical.meta).sha256,
        },
        gallery: {
          file: jpg,
          media_id: gallery.id,
          sha256: JSON.parse(gallery.meta).sha256,
        },
        long_page: {
          media_id: page.id,
          sha256: JSON.parse(page.meta).sha256,
          crop: crop ?? null,
          width: dim.width,
          height: dim.height,
        },
      });
    }
    let top = profile.dimensions.pages[0].height;
    const operations: any[] = [
      {
        op: "extend",
        top: 0,
        bottom: profile.dimensions.height - top,
        left: 0,
        right: 0,
        background: profile.long.background,
      },
    ];
    for (let n = 1; n < longPages.length; n++) {
      top += profile.long.gap;
      operations.push({
        op: "composite",
        input_id: longPages[n].id,
        x: 0,
        y: top,
      });
      list[n].long_page.top = top;
      top += profile.dimensions.pages[n].height;
    }
    list[0].long_page.top = 0;
    operations.push(encode("png"));
    const long = await derive(ownerTask, longPages[0], longPages, operations),
      lm = JSON.parse(long.meta),
      longBytes = await bytes(long);
    const readingHeight = Math.max(
      1,
      Math.round(
        (profile.dimensions.height * profile.reading.width) /
          profile.long.width,
      ),
    );
    const reading = await derive(
      ownerTask,
      long,
      [long],
      [
        {
          op: "resize",
          width: profile.reading.width,
          height: readingHeight,
          fit: "contain",
          background: profile.long.background,
        },
        encode("jpeg", profile.reading.quality, profile.long.background),
      ],
    );
    const overviewWidth = Math.min(480, profile.reading.width),
      overview = await derive(
        ownerTask,
        reading,
        [reading],
        [
          {
            op: "resize",
            width: overviewWidth,
            height: Math.max(
              1,
              Math.round(
                (readingHeight * overviewWidth) / profile.reading.width,
              ),
            ),
            fit: "contain",
            background: profile.long.background,
          },
          encode("jpeg", 75, profile.long.background),
        ],
      );
    entries.set("reading.jpg", await bytes(reading));
    entries.set("overview.jpg", await bytes(overview));
    const external = longBytes.length > ZIP_LIMITS.entry;
    requireThat(
      !external,
      "OUTPUT_OVERSIZE",
      "高清长图 " +
        long.id +
        " 实际 " +
        longBytes.length +
        " bytes 超过ZIP条目 " +
        ZIP_LIMITS.entry +
        "；首版仅reject，请降低长图宽度或分批，不会发布缺项包",
    );
    if (!external) entries.set("long-hd.png", longBytes);
    const manifest: any = {
      schema:
        input.mode === "preview"
          ? "retouch.image-preview/v1"
          : "retouch.image-delivery/v1",
      restorable_workspace: false,
      project_id: project,
      snapshot_id: id,
      snapshot_version: prepared.snapshot.version,
      snapshot_hash: frozen.snapshot_hash,
      selection: frozen.from_id ? "delta" : "full",
      from_snapshot_id: frozen.from_id,
      output_profile: profile,
      profile_hash: digest(profile),
      renderer: frozen.renderer,
      slots: list,
      long: {
        media_id: long.id,
        sha256: lm.sha256,
        bytes: longBytes.length,
        width: lm.width,
        height: lm.height,
        file: "long-hd.png",
        location: external ? "outside-package" : "in-package",
      },
      reading: {
        media_id: reading.id,
        sha256: JSON.parse(reading.meta).sha256,
      },
      overview: {
        media_id: overview.id,
        sha256: JSON.parse(overview.meta).sha256,
      },
      completeness: {
        status: external
          ? "requires-external-component"
          : "self-contained-review",
        missing: [],
        restorable_workspace: false,
      },
      image_api_requests: 0,
    };
    entries.set("manifest.json", jsonBytes(manifest));
    entries.set(
      "README.md",
      Buffer.from(
        "# Snapshot review outputs\n\nSnapshot " +
          id +
          " / " +
          frozen.snapshot_hash +
          "\nMode " +
          input.mode +
          ". Original-aspect PNG, contain sRGB gallery JPEG, whole-page/crop long image and lightweight reading derive from the same frozen selection.\n" +
          (external
            ? "High-resolution long-hd.png is OUTSIDE review.zip; verify components.json and retain that file. The ZIP alone is not the complete review set."
            : "High-resolution long-hd.png is inside review.zip.") +
          "\ncomponents.json verifies frozen bytes only, not current business applicability, native completed status or user acceptance. Query the native delivery/current snapshot before treating it as a current business delivery. This is not a restorable workspace. Use context export separately; oversize native CAS objects must be diagnosed, never silently omitted. No user acceptance is inferred from formatting or export.\n",
      ),
    );
    for (const [name, b] of entries)
      requireThat(
        b.length <= ZIP_LIMITS.entry,
        "OUTPUT_ENTRY_OVERSIZE",
        name +
          " 实际 " +
          b.length +
          " bytes 超过ZIP条目 " +
          ZIP_LIMITS.entry +
          "；只支持高清长图显式split，其他页请降低尺寸/编码质量后新建意图",
      );
    await writeZip(path.join(stage, "review.zip"), entries);
    const checked = await readZip(path.join(stage, "review.zip"));
    requireThat(
      checked.size === entries.size &&
        [...entries].every(([k, b]) => checked.get(k)?.equals(b)),
      "OUTPUT_PACKAGE",
      "发布前ZIP回读不一致",
    );
    if (external)
      await fs.writeFile(path.join(stage, "long-hd.png"), longBytes, {
        flag: "wx",
      });
    const names = ["review.zip", ...(external ? ["long-hd.png"] : [])],
      files: { name: string; sha256: string; bytes: number }[] = [];
    for (const name of names) {
      const b = await fs.readFile(path.join(stage, name));
      files.push({ name, sha256: bytesHash(b), bytes: b.length });
    }
    const components = {
      schema: "retouch.output-components/v1",
      project_id: project,
      snapshot_id: id,
      snapshot_hash: frozen.snapshot_hash,
      profile_hash: digest(profile),
      mode: input.mode,
      restorable_workspace: false,
      completeness: "complete-review-components",
      authority: "frozen-bytes-only",
      native_delivery_id: delivery.id,
      requires_native_current_check: true,
      not_business_acceptance: true,
      package_self_contained: !external,
      files,
    };
    await fs.writeFile(
      path.join(stage, "components.json"),
      jsonBytes(components),
      { flag: "wx" },
    );
    requireThat(
      (await fs.stat(parent)).ino === parentStat.ino &&
        (await fs.stat(parent)).dev === parentStat.dev &&
        (await fs.realpath(parent)) === parent,
      "DELIVERY_PATH_CHANGED",
      "发布前父目录变化",
    );
    const publicationView = await c.call("brief", { project });
    const { dimensions: frozenDimensions, ...profileInput } = profile;
    outputProfile(profileInput, slots, publicationView.artifacts);
    const publicationSuite = await c.call("suite-view", { project, id });
    requireThat(
      slots.every((s: any) =>
        publicationSuite.slots.some(
          (x: any) =>
            x.id === s.id &&
            x.current &&
            x.media_id === s.media_id &&
            x.sha256 === s.sha256,
        ),
      ),
      "SUITE_MEDIA_STALE",
      "发布前媒体已过期，保留准备事实",
    );
    await c.call(
      "suite-export-seal",
      {
        project,
        id: delivery.id,
        sha256: files[0].sha256,
        output_manifest: components,
        output_catalog: manifest,
      },
      key + ":seal",
    );
    const checkPublication = () =>
      c.call("suite-export-check", {
        project,
        id: delivery.id,
        sha256: files[0].sha256,
        output_manifest: components,
        output_catalog: manifest,
      });
    await checkPublication();
    await fs.mkdir(target).catch((e) => {
      if (e.code !== "EEXIST" || !prior?.result) throw e;
    });
    requireThat(
      !(await fs.lstat(target)).isSymbolicLink() &&
        (await fs.realpath(target)) === target,
      "OUTPUT_LINK",
      "输出目录改向",
    );
    const allowed = new Set([...names, "components.json"]);
    requireThat(
      (await fs.readdir(target)).every((n) => allowed.has(n)),
      "OUTPUT_CONFLICT",
      "准备目录含不同输出，不覆盖",
    );
    // Components publish exclusively; components.json is written last. A partial directory is
    // intentionally recoverable, not represented as an atomic multi-file completed delivery.
    for (const name of [...names, "components.json"]) {
      await checkPublication();
      const dest = path.join(target, name),
        old = await statOrNull(dest);
      if (old)
        requireThat(
          old.isFile() &&
            !old.isSymbolicLink() &&
            (await fs.readFile(dest)).equals(
              await fs.readFile(path.join(stage, name)),
            ),
          "OUTPUT_CONFLICT",
          "恢复目录含异内容：" + name,
        );
      else await fs.link(path.join(stage, name), dest);
    }
    await verifyDirectory(target, components);
    requireThat(
      (await fs.stat(parent)).ino === parentStat.ino &&
        (await fs.stat(parent)).dev === parentStat.dev &&
        (await fs.realpath(parent)) === parent,
      "DELIVERY_PATH_CHANGED",
      "发布后父目录变化，保留准备事实",
    );
    const result = await c.call(
      "suite-export-complete",
      {
        project,
        id: delivery.id,
        sha256: files[0].sha256,
        output_manifest: components,
        output_catalog: manifest,
      },
      key + ":complete",
    );
    return {
      ...result,
      file: target,
      manifest: components,
      outputs: manifest,
      replayed: false,
      image_api_requests: 0,
    };
  } catch (e) {
    throw new RetouchError(
      (e as any).code ?? "OUTPUT_EXPORT",
      "输出准备已登记；保留组件目录，同键同配置恢复，不覆盖异内容。 " +
        (e as Error).message,
      1,
      { delivery_id: delivery.id, cause: (e as any).code ?? "IO" },
      "committed",
    );
  } finally {
    // Only unlink known regular files under this invocation-owned staging directory.
    if (stage !== null) {
      requireThat(
        path.dirname(stage) === stageParent &&
          path.basename(stage).startsWith("staged-") &&
          (await fs.realpath(stage)) === stage &&
          !(await fs.lstat(stage)).isSymbolicLink(),
        "OUTPUT_LINK",
        "暂存目录身份变化，保留现场",
      );
      for (const name of await fs.readdir(stage)) {
        requireThat(
          ["review.zip", "long-hd.png", "components.json"].includes(name),
          "OUTPUT_CONFLICT",
          "暂存含意外文件，保留现场",
        );
        await fs.unlink(path.join(stage, name));
      }
      await fs.rmdir(stage);
    }
  }
}
