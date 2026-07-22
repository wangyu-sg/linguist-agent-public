const CATEGORIES = new Set(["waiting", "failed", "completed", "permission"]);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;

function shortText(value, maximum) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum
    ? value
    : null;
}

/**
 * The renderer never sends arbitrary Electron Notification options. Only this
 * small canonical Task projection may cross into the main process.
 */
export function parseNotificationCandidate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = shortText(value.id, 256);
  const projectId = shortText(value.projectId, 192);
  const taskId = shortText(value.taskId, 192);
  const runId = shortText(value.runId, 192);
  const occurredAt = shortText(value.occurredAt, 64);
  const title = shortText(value.title, 96);
  const body = shortText(value.body, 240);
  if (!id || !projectId || !taskId || !runId || !occurredAt || !title || !body) return null;
  if (!CATEGORIES.has(value.category)) return null;
  if (![projectId, taskId, runId].every((candidate) => SAFE_ID.test(candidate))) return null;
  if (!Number.isFinite(new Date(occurredAt).valueOf())) return null;
  return { id, category: value.category, projectId, taskId, runId, occurredAt, title, body };
}

/**
 * Current foreground work stays quiet. A background window or a different
 * Task may surface the already validated canonical event.
 */
export function shouldPresentNotification(candidateValue, context) {
  const candidate = parseNotificationCandidate(candidateValue);
  if (!candidate) return false;
  if (!context?.windowFocused) return true;
  return context.presentedTask?.projectId !== candidate.projectId
    || context.presentedTask?.taskId !== candidate.taskId;
}
