// Context review, media applicability and acceptance are separate immutable facts.
const meta = (a) => (typeof a.meta === "string" ? JSON.parse(a.meta) : a.meta);
export function taskBinding(task, digest) {
  const r = meta(task).retouch;
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
  const m = meta(delivery);
  return m.goal_id
    ? sameBinding(m, taskBinding(task, digest))
    : originalMediaContext(image, task, digest);
}
export function mediaApplicable(image, task, artifacts, digest) {
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
