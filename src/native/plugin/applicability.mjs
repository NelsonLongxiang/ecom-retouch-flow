// Context review, media applicability and acceptance are separate immutable facts.
import { metadata } from "./value.mjs";
const meta = metadata;
export function taskBinding(task, digest) {
  const r = meta(task).retouch;
  if (
    !r ||
    typeof r !== "object" ||
    Array.isArray(r) ||
    r.schema !== "retouch.native/v1" ||
    !["image", "design"].includes(r.kind) ||
    typeof r.goal_id !== "string" ||
    !r.goal_id ||
    !Number.isSafeInteger(r.goal_version) ||
    r.goal_version < 1 ||
    !Array.isArray(r.requirements)
  )
    throw Object.assign(
      new Error(
        "需要已绑定的修图任务上下文，普通原生任务不能作为接受/交付依据",
      ),
      { code: "TASK_PROFILE", rc: 2 },
    );
  return {
    task_id: task.id,
    goal_id: r.goal_id,
    goal_version: r.goal_version,
    requirements_hash: digest(r.requirements),
    context_epoch: r.context_epoch ?? 0,
  };
}
export function sameBinding(a, b) {
  return [
    "task_id",
    "goal_id",
    "goal_version",
    "requirements_hash",
    "context_epoch",
  ].every((k) => (a[k] ?? (k === "context_epoch" ? 0 : null)) === b[k]);
}
export function originalMediaContext(image, task, digest) {
  if (meta(task).retouch === undefined) return false;
  const im = meta(image),
    b = taskBinding(task, digest);
  return (
    im.task_id === task.id &&
    image.project_id === task.project_id &&
    im.goal_id === b.goal_id &&
    (im.goal_version ?? b.goal_version) === b.goal_version &&
    (!im.requirements_hash || im.requirements_hash === b.requirements_hash) &&
    (im.context_epoch ?? 0) === b.context_epoch
  );
}
export function deliveryBindingCurrent(delivery, image, task, digest) {
  if (meta(task).retouch === undefined) return false;
  const m = meta(delivery);
  return m.goal_id
    ? sameBinding(m, taskBinding(task, digest))
    : originalMediaContext(image, task, digest);
}
export function mediaApplicable(image, task, artifacts, digest) {
  if (meta(task).retouch === undefined) return false;
  const im = meta(image),
    binding = taskBinding(task, digest);
  if (im.task_id !== task.id || image.project_id !== task.project_id)
    return false;
  const reviews = artifacts.filter(
    (a) =>
      a.kind === "review" &&
      meta(a).role === "result-revalidation" &&
      meta(a).media_id === image.id &&
      meta(a).sha256 === im.sha256 &&
      sameBinding(meta(a), binding),
  );
  if (reviews.length)
    return (
      meta(reviews.sort((a, b) => a.version - b.version).at(-1)).decision ===
      "adopt"
    );
  return originalMediaContext(image, task, digest);
}
export function acceptedReview(review, image, task, artifacts, digest) {
  const r = meta(review),
    im = meta(image);
  if (
    review.kind !== "review" ||
    r.media_id !== image.id ||
    r.sha256 !== im.sha256 ||
    !r.accepted ||
    r.source !== "user" ||
    (r.verdict && r.verdict !== "PASS")
  )
    return false;
  if (!mediaApplicable(image, task, artifacts, digest)) return false;
  if (r.goal_id) return sameBinding(r, taskBinding(task, digest));
  // Legacy acceptance belongs only to the original media context, never to a later adoption.
  const b = taskBinding(task, digest);
  return (
    im.goal_id === b.goal_id &&
    (im.context_epoch ?? 0) === b.context_epoch &&
    (!im.requirements_hash || im.requirements_hash === b.requirements_hash)
  );
}
