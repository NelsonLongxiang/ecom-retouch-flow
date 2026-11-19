import { metadata as artifactMetadata } from "./value.mjs";
export function requestedDimensions(value) {
  if (value === undefined || value === null) return null;
  if (
    !value ||
    ![value.width, value.height].every(
      (v) => Number.isSafeInteger(v) && v > 0 && v <= 8192,
    ) ||
    !["api-request", "delivery-target"].includes(value.scope) ||
    typeof value.source_ref !== "string" ||
    !value.source_ref.trim()
  )
    throw Object.assign(
      new Error("请求尺寸须有真实宽高、api-request/delivery-target 范围及来源"),
      { code: "REQUEST_DIMENSIONS", rc: 2 },
    );
  return {
    width: value.width,
    height: value.height,
    scope: value.scope,
    source_ref: value.source_ref,
  };
}
export function dimensionView(artifacts, id) {
  const metadata = new Map(artifacts.map((a) => [a.id, artifactMetadata(a)]));
  const meta = (a) => metadata.get(a.id);
  const media = artifacts.filter((a) => a.kind === "media"),
    executions = artifacts.filter((a) => a.kind === "execution");
  const cache = new Map();
  function lineage(a) {
    if (cache.has(a.id)) return cache.get(a.id);
    const seen = new Set(),
      result = [],
      queue = [a];
    while (queue.length) {
      const item = queue.shift();
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      const m = meta(item);
      result.push({
        id: item.id,
        role: m.role,
        width: m.width,
        height: m.height,
        sha256: m.sha256,
        parents: m.parents ?? [],
        operation: m.operation ?? null,
        ...(m.transform ? { transform: m.transform } : {}),
      });
      for (const parent of m.parents ?? [])
        queue.push(media.find((x) => x.id === parent));
    }
    cache.set(a.id, result);
    return result;
  }
  const rows = media
    .filter((a) => !id || a.id === id)
    .map((a) => {
      const chain = lineage(a),
        ancestors = new Set(chain.map((x) => x.id));
      const requests = executions
        .filter((e) => {
          const m = meta(e);
          return (
            (m.outputs ?? []).some((x) => ancestors.has(x)) ||
            ancestors.has(m.raw_output) ||
            ancestors.has(m.api_response?.raw_output)
          );
        })
        .map((e) => {
          const m = meta(e);
          let content = {};
          try {
            content = JSON.parse(e.content);
          } catch {}
          const profile = artifacts.find(
            (x) => x.id === content.fallback?.profile_id,
          );
          const p = profile ? JSON.parse(profile.content).profile : null;
          const parsed = /^(\d+)x(\d+)$/.exec(p?.size ?? "");
          const inputIds = new Set(
            (m.inputs ?? [m.input_id]).filter(Boolean).flatMap((input) => {
              const a = media.find((x) => x.id === input);
              return a ? lineage(a).map((x) => x.id) : [];
            }),
          );
          const producedIds = m.raw_output
            ? [m.raw_output]
            : (m.outputs ?? []).flatMap((output) => {
                const a = media.find((x) => x.id === output);
                return a
                  ? lineage(a)
                      .filter(
                        (x) => x.role === "model-output" && !inputIds.has(x.id),
                      )
                      .map((x) => x.id)
                  : [];
              });
          return {
            execution_id: e.id,
            status: m.status,
            source: m.source ?? m.dispatch?.channel ?? "unspecified",
            native_output_ids: [...new Set(producedIds)],
            requested:
              m.requested_dimensions ??
              (parsed
                ? {
                    width: +parsed[1],
                    height: +parsed[2],
                    scope: "api-request",
                    source_ref: "frozen-executor-profile:" + profile.id,
                  }
                : (content.delivery_canvas ?? null)),
            profile_id: profile?.id ?? null,
            profile_version: profile?.version ?? null,
            requested_size_option: p?.size ?? null,
            delivery_canvas: content.delivery_canvas ?? null,
          };
        });
      const native_outputs = chain.filter((x) => x.role === "model-output");
      const mismatches = requests.flatMap((r) =>
        r.requested
          ? native_outputs
              .filter(
                (x) =>
                  r.native_output_ids.includes(x.id) &&
                  (x.width !== r.requested.width ||
                    x.height !== r.requested.height),
              )
              .map((x) => ({
                code:
                  r.requested.scope === "api-request"
                    ? "RESPONSE_SIZE_MISMATCH"
                    : "NATIVE_OUTPUT_DIFFERS_FROM_TARGET",
                execution_id: r.execution_id,
                media_id: x.id,
                requested: r.requested,
                observed: { width: x.width, height: x.height },
                cause:
                  "UNDETERMINED; provider compatibility and model behavior are separate",
              }))
          : [],
      );
      return {
        media_id: a.id,
        actual: { width: meta(a).width, height: meta(a).height },
        native_outputs,
        requests,
        lineage: chain,
        mismatches,
        detail_claim:
          "Canvas size and resizing do not establish additional real product detail.",
      };
    });
  return {
    images: rows,
    counts: {
      model_outputs: media.filter((a) => meta(a).role === "model-output")
        .length,
      postprocess: media.filter((a) => meta(a).role === "postprocess").length,
      executions: executions.length,
    },
    image_requests_issued_by_query: 0,
  };
}
export function freezeDimension(row) {
  return { ...row, requests: row.requests.map(({ status, ...r }) => r) };
}
