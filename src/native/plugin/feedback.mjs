// Raw feedback remains on its original scale. These views never normalize user scores.
function need(ok, message) {
  if (!ok) throw Object.assign(new Error(message), { code: "RATING", rc: 2 });
}
export function rawRating(value) {
  need(
    value && typeof value === "object" && !Array.isArray(value),
    "评分须为包含原始量表的对象",
  );
  need(
    Object.keys(value).every((k) =>
      [
        "schema",
        "score",
        "scale_max",
        "scale_min",
        "step",
        "original_text",
        "source",
        "source_ref",
      ].includes(k),
    ),
    "评分包含未支持的派生或未知字段",
  );
  const { score, scale_max, original_text, source_ref } = value;
  const scale_min = value.scale_min ?? null,
    step = value.step ?? null;
  need(
    (value.schema === undefined || value.schema === "retouch.rating/v1") &&
      Number.isFinite(score) &&
      Number.isFinite(scale_max) &&
      scale_max > 0 &&
      score <= scale_max &&
      (scale_min === null ||
        (Number.isFinite(scale_min) &&
          scale_min < scale_max &&
          score >= scale_min)) &&
      (step === null || (Number.isFinite(step) && step > 0)),
    "评分或量表越界；未知下限与刻度保留 null",
  );
  need(
    (value.source === undefined || value.source === "user") &&
      typeof original_text === "string" &&
      original_text.trim() &&
      typeof source_ref === "string" &&
      source_ref.trim(),
    "原始评分须保留用户原文和实际来源",
  );
  return {
    schema: "retouch.rating/v1",
    score,
    scale_max,
    scale_min,
    step,
    original_text,
    source: "user",
    source_ref,
  };
}
export function effectiveRating(profile) {
  if (profile.rating_record)
    return { ...rawRating(profile.rating_record), legacy: false };
  if (
    Number.isInteger(profile.rating) &&
    profile.rating >= 1 &&
    profile.rating <= 5
  )
    return {
      schema: "retouch.rating/v1",
      score: profile.rating,
      scale_max: 5,
      scale_min: 1,
      step: 1,
      original_text: null,
      source: profile.feedback_source ?? null,
      source_ref: null,
      legacy: true,
    };
  return null;
}
export function ratingScale(record) {
  return JSON.stringify([record.scale_min, record.scale_max, record.step]);
}
export function summarizeRatings(records) {
  const groups = new Map();
  for (const r of records.filter(Boolean)) {
    const key = ratingScale(r);
    if (!groups.has(key))
      groups.set(key, {
        scale_key: key,
        scale_min: r.scale_min,
        scale_max: r.scale_max,
        step: r.step,
        scores: [],
      });
    groups.get(key).scores.push(r.score);
  }
  const scales = [...groups.values()]
    .sort((a, b) => a.scale_key.localeCompare(b.scale_key))
    .map(({ scores, ...g }) => ({
      ...g,
      projects: scores.length,
      mean: scores.reduce((a, b) => a + b, 0) / scores.length,
    }));
  return {
    rated_projects: records.filter(Boolean).length,
    mean_rating: scales.length === 1 ? scales[0].mean : null,
    mean_rating_scale:
      scales.length === 1
        ? {
            scale_min: scales[0].scale_min,
            scale_max: scales[0].scale_max,
            step: scales[0].step,
          }
        : null,
    rating_scales: scales,
    comparable: scales.length <= 1,
    normalization: "NOT_APPLIED",
  };
}
