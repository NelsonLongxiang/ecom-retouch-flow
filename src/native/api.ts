import path from "node:path";
import sharp from "sharp";
import { requireThat, RetouchError, bytesHash } from "../domain/model.ts";
import { NativeClient } from "./client.ts";
import { configuration } from "./configuration.ts";
import {
  objectBytes,
  registerBytes,
  completeRun,
  readImage,
  resizeMedia,
} from "./files.ts";
import { Images } from "../adapters/images.ts";
import { digest, assertNoCredentials } from "./plugin/commands.mjs";
import {
  apiProfile,
  apiEndpoint,
  apiPrompt,
  type ApiProfile,
} from "./plugin/api-contract.mjs";

type Environment = Record<string, string | undefined>;
type Receipt = {
  tool: string;
  tool_receipt: string;
  model: string;
  endpoint_fingerprint: string;
  provider_request_id: string | null;
  usage: Record<string, number>;
  http_status: number | null;
  response_sha256: string | null;
};
type ExecuteOptions = {
  profileId: string;
  revision: number;
  requestId: string;
  env?: Environment;
};
const json = (v: string) => JSON.parse(v);
const localKey = (execution: string, operation: string, phase: string) =>
  "api-local:" + execution + ":" + operation + ":" + phase;
async function resolve(
  profile: ApiProfile,
  env: Environment,
  needKey: boolean,
  workspaceId: string,
  known?: Awaited<ReturnType<typeof configuration>>,
) {
  const source = known ?? (await configuration(profile, env, workspaceId)),
    base = source.base;
  requireThat(
    base,
    "API_BASE_MISSING",
    "执行配置引用的 API base 环境变量未设置",
    1,
  );
  const endpoint = apiEndpoint(base, profile),
    endpoint_fingerprint = digest(endpoint);
  const key = needKey ? source.key : undefined;
  if (needKey)
    requireThat(
      typeof key === "string" && /^[\x21-\x7e]{1,4096}$/.test(key),
      "API_CREDENTIAL_MISSING",
      "执行配置引用的密钥变量未设置或无效",
      1,
    );
  return {
    endpoint,
    endpoint_fingerprint,
    key,
    source,
    credential_configured:
      typeof source.key === "string" &&
      /^[\x21-\x7e]{1,4096}$/.test(source.key),
  };
}
export async function registerExecutor(
  client: NativeClient,
  project: string,
  input: any,
  requestId: string,
  env: Environment = process.env,
) {
  assertNoCredentials(input);
  let profile = apiProfile(input.profile);
  const identity = await client.call("workspace-info", {});
  if (profile.configuration_source) {
    requireThat(
      !profile.configuration_source.workspace_id ||
        profile.configuration_source.workspace_id === identity.id ||
        (typeof input.configuration_authorization_ref === "string" &&
          input.configuration_authorization_ref.trim()),
      "CONFIG_SOURCE_REAUTHORIZE",
      "跨工作区配置读取须有新的本地授权来源",
      1,
    );
    profile = apiProfile({
      ...profile,
      configuration_source: {
        ...profile.configuration_source,
        ...(input.configuration_authorization_ref
          ? {
              authorized: true,
              authorization_ref: input.configuration_authorization_ref,
            }
          : {}),
        workspace_id: identity.id,
      },
    });
  }
  const resolved = await resolve(profile, env, false, identity.id),
    { endpoint_fingerprint } = resolved;
  if (profile.configuration_source)
    profile = apiProfile({
      ...profile,
      configuration_source: {
        ...profile.configuration_source,
        provider: resolved.source.provider,
      },
    });
  return client.call(
    "executor-register",
    { project, title: input.title, profile, endpoint_fingerprint },
    requestId,
  );
}
export async function checkExecutor(
  client: NativeClient,
  project: string,
  id: string,
  env: Environment = process.env,
) {
  const artifact = await client.call("show", { project, id });
  return inspectExecutor(client, project, artifact, env);
}
export async function diagnoseExecutor(
  client: NativeClient,
  project: string,
  input: any,
  env: Environment = process.env,
) {
  assertNoCredentials(input);
  let profile;
  try {
    profile = apiProfile(input.profile);
  } catch (e) {
    return {
      profile_id: null,
      protocol_support: { adapter_supported: false },
      diagnostic: (e as any).code,
      network: "NOT_RUN",
      configuration_read: "NOT_RUN",
    };
  }
  if (
    profile.configuration_source &&
    !profile.configuration_source.workspace_id
  )
    profile = apiProfile({
      ...profile,
      configuration_source: {
        ...profile.configuration_source,
        workspace_id: (await client.call("workspace-info", {})).id,
      },
    });
  return inspectExecutor(
    client,
    project,
    {
      id: null,
      version: null,
      kind: "executor-profile",
      content: JSON.stringify({ profile, endpoint_fingerprint: null }),
    },
    env,
  );
}
async function inspectExecutor(
  client: NativeClient,
  project: string,
  artifact: any,
  env: Environment,
) {
  const id = artifact.id;
  requireThat(
    artifact.kind === "executor-profile",
    "API_PROFILE",
    "需要原生 executor-profile 工件",
  );
  const content = json(artifact.content),
    profile = apiProfile(content.profile);
  let matches: boolean | null = null,
    code: string | null = null;
  let resolved: Awaited<ReturnType<typeof resolve>> | null = null;
  let source: Awaited<ReturnType<typeof configuration>> | null = null;
  try {
    const workspaceId = (await client.call("workspace-info", {})).id;
    source = await configuration(profile, env, workspaceId);
    resolved = await resolve(profile, env, false, workspaceId, source);
    matches = content.endpoint_fingerprint
      ? resolved.endpoint_fingerprint === content.endpoint_fingerprint
      : null;
    if (matches === false) code = "API_ENDPOINT_CHANGED";
  } catch (e) {
    code = (e as any).code ?? "API_BASE";
  }
  const configured = source
    ? typeof source.key === "string" && /^[\x21-\x7e]{1,4096}$/.test(source.key)
    : false;
  const view = await client.call("brief", { project });
  const history = view.artifacts
    .filter((a: any) => a.kind === "execution")
    .map((a: any) => {
      const m = json(a.meta);
      return {
        execution_id: a.id,
        observed_at: a.updated || a.created,
        source: m.role,
        source_ref: m.source ?? m.dispatch?.channel ?? "unspecified",
        model: m.api_intent?.model ?? m.model ?? null,
        status: m.status,
        profile_id: m.api_intent?.profile_id ?? null,
        has_registered_image: (m.outputs?.length ?? 0) > 0 || !!m.raw_output,
      };
    })
    .sort((a: any, b: any) => b.observed_at.localeCompare(a.observed_at));
  return {
    profile_id: artifact.id,
    version: artifact.version,
    protocol: profile.protocol,
    model: profile.model,
    base_configured: !!source?.base,
    credential_configured: configured,
    endpoint_matches: matches,
    ready: matches === true && configured,
    registration_ready: code === null && !!resolved && configured,
    diagnostic: code,
    configuration_read: source ? "READ_EXPLICIT_SOURCE" : "NOT_RUN",
    readiness_scope: "LOCAL_CONFIGURATION_ONLY",
    builtin_tool: view.executor_observations?.[0] ?? {
      state: "unknown",
      source: "host has not supplied an inventory observation",
    },
    protected_configuration: {
      kind: profile.configuration_source?.kind ?? "environment",
      authorized: profile.configuration_source?.authorized ?? true,
      present: !!source?.base,
      diagnostic: code,
    },
    protocol_support: {
      adapter_supported: true,
      protocol: profile.protocol,
      image_service_verified: false,
      request_sizes: ["auto", "1024x1024", "1536x1024", "1024x1536"],
    },
    recent_image_result:
      history.find(
        (r: any) => id && r.profile_id === id && r.has_registered_image,
      ) ?? null,
    latest_bound_call:
      history.find((r: any) => id && r.profile_id === id) ?? null,
    unbound_historical_results: history
      .filter((r: any) => !r.profile_id && r.status !== "planned")
      .slice(0, 5),
    historical_success_is_current_authentication: false,
    network: "NOT_RUN",
  };
}
async function artifact(client: NativeClient, project: string, id: string) {
  return client.call("show", { project, id });
}
async function replay(
  client: NativeClient,
  project: string,
  id: string,
  options: ExecuteOptions,
) {
  const prior = await client.call("receipt", {
    request_id: options.requestId + ":dispatch",
  });
  if (!prior?.result) return null;
  const original = prior.result.execution,
    meta = original && json(original.meta);
  requireThat(
    prior.action === "run-api-dispatch" &&
      original?.id === id &&
      original?.project_id === project &&
      meta.api_intent?.profile_id === options.profileId &&
      meta.api_intent?.expected_revision === options.revision,
    "REQUEST_CONFLICT",
    "相同 API 请求键携带不同执行意图",
    1,
  );
  const current = await artifact(client, project, id);
  return {
    replayed: true,
    allow_execute: false,
    execution: current,
    network: "NOT_RUN",
    next_action:
      json(current.meta).status === "received"
        ? "run recover-api"
        : "run status",
  };
}
async function upload(
  client: NativeClient,
  project: string,
  task: string,
  source: any,
  key: string,
) {
  const meta = json(source.meta),
    bytes = await objectBytes(client.root, meta);
  const png = await sharp(bytes, { limitInputPixels: 50_000_000 })
    .toColourspace("srgb")
    .ensureAlpha()
    .png()
    .toBuffer();
  requireThat(
    png.length <= 32 * 1024 * 1024,
    "API_UPLOAD_LIMIT",
    "规范化后的传输图超过 32 MiB，请先显式缩小素材再重新规划",
  );
  return (
    await registerBytes(
      client,
      project,
      task,
      png,
      {
        role: "reference",
        parents: [source.id],
        operation:
          "API transport: decoded pixels to sRGB RGBA PNG; no EXIF rotation",
      },
      key,
    )
  ).artifact;
}
async function preparedUploads(
  client: NativeClient,
  project: string,
  run: any,
  step: any,
  key: string,
) {
  const meta = json(run.meta),
    input = await artifact(client, project, meta.input_id),
    transportInput = await upload(
      client,
      project,
      meta.task_id,
      input,
      key + ":upload-input",
    );
  const references = [];
  for (let i = 0; i < (step.references ?? []).length; i++)
    references.push(
      await upload(
        client,
        project,
        meta.task_id,
        await artifact(client, project, step.references[i].media_id),
        key + ":upload-reference-" + i,
      ),
    );
  let mask: any = null;
  if (step.region) {
    const im = json(input.meta),
      r = step.region;
    requireThat(
      step.coordinate_system?.width === im.width &&
        step.coordinate_system?.height === im.height,
      "COORDINATE_SYSTEM",
      "区域坐标与当前输入不一致",
      1,
    );
    const pixels = Buffer.alloc(im.width * im.height * 4, 255);
    for (let y = r.y; y < r.y + r.height; y++)
      for (let x = r.x; x < r.x + r.width; x++)
        pixels[(y * im.width + x) * 4 + 3] = 0;
    const png = await sharp(pixels, {
      raw: { width: im.width, height: im.height, channels: 4 },
    })
      .png()
      .toBuffer();
    mask = (
      await registerBytes(
        client,
        project,
        meta.task_id,
        png,
        {
          role: "reference",
          parents: [input.id],
          operation:
            "API mask: transparent approved rectangle, opaque preserve region",
        },
        key + ":upload-mask",
      )
    ).artifact;
  }
  return { input: transportInput, references, mask };
}
async function responseBytes(response: Response, limit: number) {
  requireThat(response.body, "API_RESPONSE", "API 响应没有正文", 1);
  const length = response.headers.get("content-length");
  if (!(length === null || (/^\d+$/.test(length) && Number(length) <= limit))) {
    await response.body.cancel().catch(() => {});
    throw new RetouchError("API_RESPONSE_LIMIT", "API 响应超过配置上限", 1);
  }
  const reader = response.body.getReader(),
    chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      requireThat(
        total <= limit,
        "API_RESPONSE_LIMIT",
        "API 响应超过配置上限",
        1,
      );
      chunks.push(Buffer.from(value));
    }
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
function providerId(response: Response, credential: string) {
  const id =
    response.headers.get("x-request-id") ?? response.headers.get("request-id");
  return id &&
    id !== credential &&
    /^[A-Za-z0-9_.:-]{1,128}$/.test(id) &&
    !/^sk-/i.test(id)
    ? id
    : null;
}
async function rejectedDetails(response: Response, credential: string) {
  let value: any;
  try {
    value = JSON.parse((await responseBytes(response, 4096)).toString("utf8"));
  } catch {
    return {};
  }
  const code = value?.error?.code,
    param = value?.error?.param;
  return {
    ...(typeof code === "string" &&
    /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(code) &&
    code !== credential
      ? { provider_error_code: code }
      : {}),
    ...([
      "model",
      "image",
      "image[]",
      "mask",
      "prompt",
      "n",
      "size",
      "quality",
      "output_format",
    ].includes(param)
      ? { provider_error_param: param }
      : {}),
  };
}
function decode(body: Buffer) {
  let value: any;
  try {
    value = JSON.parse(body.toString("utf8"));
  } catch {
    throw new RetouchError(
      "API_RESPONSE_JSON",
      "API 未返回有效 JSON；保留未知状态，不重新提交",
      1,
      null,
      "unknown",
    );
  }
  requireThat(
    Array.isArray(value.data) &&
      value.data.length === 1 &&
      typeof value.data[0]?.b64_json === "string",
    "API_RESPONSE_UNSUPPORTED",
    "API 须返回单张 base64 图片；URL 或其他格式需对账，不自动下载或重发",
    1,
  );
  const encoded = value.data[0].b64_json;
  requireThat(
    encoded.length > 0 &&
      encoded.length <= Math.ceil((32 * 1024 * 1024) / 3) * 4 &&
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        encoded,
      ),
    "API_IMAGE_BASE64",
    "API 图像编码无效或超过大小限制",
    1,
  );
  const bytes = Buffer.from(encoded, "base64");
  requireThat(
    bytes.toString("base64") === encoded,
    "API_IMAGE_BASE64",
    "API 图像编码不规范",
    1,
  );
  const usage: Record<string, number> = {};
  for (const key of ["input_tokens", "output_tokens", "total_tokens"])
    if (Number.isSafeInteger(value.usage?.[key]) && value.usage[key] >= 0)
      usage[key] = value.usage[key];
  return { bytes, usage };
}
async function outcome(
  client: NativeClient,
  project: string,
  id: string,
  key: string,
  status: "failed" | "unknown",
  observed: Record<string, unknown>,
) {
  const current = await artifact(client, project, id),
    meta = json(current.meta);
  if (!["dispatched", "unknown"].includes(meta.status) || meta.api_response)
    return;
  await client.call(
    "run-api-outcome",
    {
      project,
      id,
      operation_key: key,
      status,
      observed,
      expected_revision: meta.revision,
    },
    localKey(id, key, "outcome"),
  );
}
export async function attachApiResult(
  client: NativeClient,
  project: string,
  id: string,
  bytes: Buffer,
  receipt: Receipt,
  operationKey: string,
) {
  const run = await artifact(client, project, id),
    meta = json(run.meta);
  requireThat(
    meta.api_intent?.operation_key === operationKey,
    "API_RESULT_BINDING",
    "结果不属于当前 API 调用意图",
    1,
  );
  assertNoCredentials(receipt);
  const raw = (
    await registerBytes(
      client,
      project,
      meta.task_id,
      bytes,
      {
        role: "model-output",
        parents: [meta.input_id],
        operation: "image API result; actual bytes; " + receipt.model,
        provider_receipt: receipt,
        api_operation: operationKey,
      },
      localKey(id, operationKey, "raw"),
    )
  ).artifact;
  const latest = await artifact(client, project, id),
    lm = json(latest.meta);
  return client.call(
    "run-api-received",
    {
      project,
      id,
      operation_key: operationKey,
      raw_output: raw.id,
      receipt,
      expected_revision: lm.revision,
    },
    localKey(id, operationKey, "received"),
  );
}
export async function recoverApi(
  client: NativeClient,
  project: string,
  id: string,
  options: { fitInput?: boolean } = {},
): Promise<any> {
  const run = await artifact(client, project, id),
    meta = json(run.meta),
    response = meta.api_response;
  if (!response && meta.api_intent) {
    const key = meta.api_intent.operation_key,
      stored = await client.call("receipt", {
        request_id: localKey(id, key, "raw"),
      });
    let raw = stored?.result?.artifact;
    if (!raw) {
      const matches = (
        await client.call("brief", { project })
      ).artifacts.filter(
        (a: any) =>
          a.kind === "media" &&
          json(a.meta).api_operation === key &&
          json(a.meta).task_id === meta.task_id &&
          json(a.meta).parents.includes(meta.input_id),
      );
      requireThat(
        matches.length <= 1,
        "API_RESULT_CONFLICT",
        "同一 API 操作有多个原始结果，须明确复核",
        1,
      );
      raw = matches[0];
    }
    const rm = raw && json(raw.meta);
    if (
      raw &&
      raw.project_id === project &&
      rm.api_operation === key &&
      rm.provider_receipt &&
      ["dispatched", "unknown"].includes(meta.status)
    ) {
      await objectBytes(client.root, rm);
      await client.call(
        "run-api-received",
        {
          project,
          id,
          operation_key: key,
          raw_output: raw.id,
          receipt: rm.provider_receipt,
          expected_revision: meta.revision,
        },
        localKey(id, key, "received"),
      );
      return recoverApi(client, project, id, options);
    }
  }
  requireThat(
    response && meta.api_intent?.operation_key === response.operation_key,
    "API_RESULT_MISSING",
    "没有已保全的 API 响应；先对账，不能重新请求",
    1,
  );
  const key = localKey(id, response.operation_key, "complete"),
    prior = await client.call("receipt", { request_id: key });
  if (prior?.result)
    return {
      replayed: true,
      allow_execute: false,
      execution: await artifact(client, project, id),
      network: "NOT_RUN",
    };
  requireThat(
    meta.status === "received",
    "API_RECOVERY_STATE",
    "当前运行没有待本地恢复的 API 响应",
    1,
  );
  const raw = await artifact(client, project, response.raw_output),
    rm = json(raw.meta);
  await objectBytes(client.root, rm);
  let processed: any = null;
  const step = json(run.content).steps[meta.step];
  if (options.fitInput && step?.region) {
    const input = json((await artifact(client, project, meta.input_id)).meta);
    if (rm.width !== input.width || rm.height !== input.height)
      processed = (
        await resizeMedia(
          client,
          project,
          raw.id,
          input.width,
          input.height,
          localKey(id, response.operation_key, "fit-input"),
        )
      ).artifact;
  }
  const completed = await completeRun(
    client,
    project,
    id,
    path.join(client.root, rm.object_path),
    meta.revision,
    key,
    response.receipt,
    raw,
    processed,
  );
  return { ...completed, allow_execute: false, network: "NOT_RUN" };
}
export async function reconcileApiResult(
  client: NativeClient,
  project: string,
  id: string,
  file: string,
  metadata: any,
  revision: number,
) {
  const run = await artifact(client, project, id),
    meta = json(run.meta);
  if (metadata?.operation_key === meta.api_intent?.operation_key) {
    const prior = await client.call("receipt", {
        request_id: localKey(id, metadata.operation_key, "received"),
      }),
      priorResponse =
        prior?.result?.execution &&
        json(prior.result.execution.meta).api_response;
    if (priorResponse) {
      const raw = await artifact(client, project, priorResponse.raw_output),
        receipt = priorResponse.receipt;
      requireThat(
        receipt?.tool === "image-api:manual-reconciliation" &&
          receipt.tool_receipt === metadata.statement &&
          receipt.provider_request_id ===
            (metadata.provider_request_id ?? null) &&
          json(raw.meta).sha256 === bytesHash((await readImage(file)).bytes),
        "REQUEST_CONFLICT",
        "相同 API 回接携带了不同文件或来源",
        1,
      );
      return recoverApi(client, project, id);
    }
  }
  requireThat(
    meta.revision === revision,
    "REVISION_CONFLICT",
    "执行记录已变化，请刷新后回接",
    1,
  );
  requireThat(
    metadata &&
      metadata.operation_key === meta.api_intent?.operation_key &&
      typeof metadata.statement === "string" &&
      metadata.statement.trim().length > 0,
    "API_RESULT_BINDING",
    "回接须绑定原 API 请求键及真实来源说明",
  );
  const provider = metadata.provider_request_id ?? null;
  requireThat(
    provider === null ||
      (typeof provider === "string" &&
        /^[A-Za-z0-9_.:-]{1,128}$/.test(provider)),
    "API_RECEIPT",
    "提供商请求身份无效",
  );
  const { bytes } = await readImage(file);
  await attachApiResult(
    client,
    project,
    id,
    bytes,
    {
      tool: "image-api:manual-reconciliation",
      tool_receipt: metadata.statement,
      model: meta.api_intent.model,
      endpoint_fingerprint: meta.api_intent.endpoint_fingerprint,
      provider_request_id: provider,
      usage: {},
      http_status: null,
      response_sha256: null,
    },
    metadata.operation_key,
  );
  return recoverApi(client, project, id);
}
export async function executeApi(
  client: NativeClient,
  project: string,
  id: string,
  options: ExecuteOptions,
) {
  const prior = await replay(client, project, id, options);
  if (prior) return prior;
  const run = await artifact(client, project, id),
    meta = json(run.meta),
    plan = json(run.content),
    step = plan.steps[meta.step];
  requireThat(
    meta.status === "prepared" && step,
    "API_RUN_STATE",
    "仅可显式执行未派发的当前步骤；已有请求须先对账",
    1,
  );
  requireThat(
    plan.fallback?.profile_id === options.profileId,
    "API_PROFILE_BINDING",
    "API 配置须在当前冻结计划中明确选择",
    1,
  );
  const grant = await artifact(client, project, meta.grant_id);
  requireThat(
    json(grant.meta).api_fallback?.profile_id === options.profileId,
    "API_APPROVAL_REQUIRED",
    "当前授权没有明确允许这个 API fallback",
    1,
  );
  const profileArtifact = await artifact(client, project, options.profileId),
    configuration = json(profileArtifact.content),
    profile = apiProfile(configuration.profile),
    resolved = await resolve(
      profile,
      options.env ?? process.env,
      true,
      (await client.call("workspace-info", {})).id,
    );
  requireThat(
    resolved.endpoint_fingerprint === configuration.endpoint_fingerprint,
    "API_BINDING",
    "API base 已变化，先登记并批准新的执行配置",
    1,
  );
  const uploads = await preparedUploads(
      client,
      project,
      run,
      step,
      options.requestId,
    ),
    goal = await artifact(client, project, plan.goal_id),
    prompt = apiPrompt(step, plan.requirements, json(goal.content).preserve);
  const descriptor = {
    profile_id: profileArtifact.id,
    profile_hash: digest(configuration),
    endpoint_fingerprint: resolved.endpoint_fingerprint,
    model: profile.model,
    size: profile.size,
    quality: profile.quality,
    prompt,
    uploads: {
      input: json(uploads.input.meta).sha256,
      references: uploads.references.map((r) => json(r.meta).sha256),
      mask: uploads.mask ? json(uploads.mask.meta).sha256 : null,
    },
  };
  const dispatched = await client.call(
    "run-api-dispatch",
    {
      project,
      id,
      profile_id: profileArtifact.id,
      endpoint_fingerprint: resolved.endpoint_fingerprint,
      request_digest: digest(descriptor),
      uploads: {
        input_id: uploads.input.id,
        reference_ids: uploads.references.map((r) => r.id),
        mask_id: uploads.mask?.id ?? null,
      },
      operation_key: options.requestId,
      expected_revision: options.revision,
    },
    options.requestId + ":dispatch",
  );
  if (dispatched.replayed || dispatched.allow_execute !== true)
    return {
      replayed: true,
      allow_execute: false,
      execution: await artifact(client, project, id),
      network: "NOT_RUN",
    };
  const signal = AbortSignal.timeout(profile.timeout_ms);
  let status: number | null = null,
    requestId: string | null = null,
    bodyHash: string | null = null;
  let received: ReturnType<typeof decode> | null = null,
    receipt: Receipt | null = null;
  try {
    const form = new FormData();
    form.set("model", profile.model);
    form.set("n", "1");
    form.set("size", profile.size);
    form.set("quality", profile.quality);
    form.set("output_format", "png");
    form.set("prompt", prompt);
    for (const image of [uploads.input, ...uploads.references])
      form.append(
        "image[]",
        new Blob(
          [new Uint8Array(await objectBytes(client.root, json(image.meta)))],
          { type: "image/png" },
        ),
        "image-" + json(image.meta).sha256 + ".png",
      );
    if (uploads.mask)
      form.set(
        "mask",
        new Blob(
          [
            new Uint8Array(
              await objectBytes(client.root, json(uploads.mask.meta)),
            ),
          ],
          { type: "image/png" },
        ),
        "mask.png",
      );
    const response = await fetch(resolved.endpoint, {
      method: "POST",
      headers: { Authorization: "Bearer " + resolved.key },
      body: form,
      redirect: "error",
      signal,
    });
    status = response.status;
    requestId = providerId(response, resolved.key!);
    if (!response.ok) {
      const details = await rejectedDetails(response, resolved.key!);
      const failed = [400, 401, 403, 404, 413, 415, 422].includes(
        response.status,
      );
      await outcome(
        client,
        project,
        id,
        options.requestId,
        failed ? "failed" : "unknown",
        {
          code: failed ? "API_REJECTED" : "API_HTTP_UNKNOWN",
          http_status: status,
          provider_request_id: requestId,
          ...details,
        },
      );
      throw new RetouchError(
        failed ? "API_REJECTED" : "API_REQUEST_UNKNOWN",
        failed
          ? "API 拒绝了该请求；不会自动重试"
          : "API 未返回可确认结果；先对账，不能自动重试",
        1,
        { http_status: status, ...details },
        failed ? "submitted" : "unknown",
      );
    }
    const bytes = await responseBytes(response, profile.response_limit_bytes);
    bodyHash = bytesHash(bytes);
    received = decode(bytes);
    await Images.metadata(received.bytes);
    receipt = {
      tool: "image-api:" + profile.protocol,
      tool_receipt:
        "Explicit API fallback; actual response preserved. No automatic retry.",
      model: profile.model,
      endpoint_fingerprint: resolved.endpoint_fingerprint,
      provider_request_id: requestId,
      usage: received.usage,
      http_status: status,
      response_sha256: bodyHash,
    };
  } catch (error) {
    if (
      error instanceof RetouchError &&
      ["API_REJECTED", "API_REQUEST_UNKNOWN"].includes(error.code)
    )
      throw error;
    const code =
      error instanceof RetouchError
        ? error.code
        : signal.aborted
          ? "API_TIMEOUT"
          : "API_TRANSPORT_UNKNOWN";
    await outcome(client, project, id, options.requestId, "unknown", {
      code,
      http_status: status,
      provider_request_id: requestId,
      response_sha256: bodyHash,
    });
    throw new RetouchError(
      code,
      "API 结果未能确认；保留原生调用意图，禁止自动重发",
      1,
      { http_status: status },
      "unknown",
    );
  }
  try {
    await attachApiResult(
      client,
      project,
      id,
      received!.bytes,
      receipt!,
      options.requestId,
    );
  } catch (error) {
    await outcome(client, project, id, options.requestId, "unknown", {
      code: "API_RESULT_PERSISTENCE",
      http_status: status,
      provider_request_id: requestId,
      response_sha256: bodyHash,
    });
    throw new RetouchError(
      "API_RESULT_PERSISTENCE",
      "API 已返回图片；先核对原生回执与对象库，不能重新发送请求",
      1,
      null,
      "submitted",
    );
  }
  try {
    const completed = await recoverApi(client, project, id);
    return {
      ...completed,
      network: "RESPONSE_RECEIVED",
      api_requests_submitted: 1,
    };
  } catch (error) {
    throw new RetouchError(
      "API_LOCAL_RECOVERY_REQUIRED",
      "API 原始结果已保全，本地合成尚未完成；使用 run recover-api，尺寸不符时可显式 --fit-input",
      1,
      { cause_code: (error as any).code ?? "LOCAL_RECOVERY" },
      "committed",
    );
  }
}
