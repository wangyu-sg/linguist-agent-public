export interface PrivateEvalPromptSession {
  prompt(message: string): Promise<void>;
  abort(): Promise<void>;
}

export interface PrivateEvalPromptOptions {
  label: string;
  timeoutMs?: number;
}

const DEFAULT_PRIVATE_EVAL_ROLE_TIMEOUT_MS = 3 * 60_000;

/**
 * Bound one isolated Eval model call. A provider/SDK stall must become a
 * visible failed run instead of holding the resident runtime forever.
 */
export async function promptPrivateEvalSession(
  session: PrivateEvalPromptSession,
  message: string,
  options: PrivateEvalPromptOptions,
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PRIVATE_EVAL_ROLE_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Private Eval role timeout must be a positive finite duration.");
  let timer: NodeJS.Timeout | undefined;
  let timedOut = false;
  const prompt = session.prompt(message);
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new Error(`${options.label} timed out after ${Math.max(1, Math.ceil(timeoutMs / 1000))} seconds.`));
      void session.abort().catch(() => undefined);
    }, timeoutMs);
  });
  try {
    await Promise.race([prompt, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    // The timed-out Pi promise may reject later when abort finishes. Keep that
    // late settlement observed so it cannot become an unhandled rejection.
    if (timedOut) void prompt.catch(() => undefined);
  }
}
