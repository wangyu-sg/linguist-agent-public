type RuntimeOverrides = Record<string, unknown>;
type RuntimeEnv = Record<string, string | undefined>;

function readNumberEnv(env: RuntimeEnv, name: string): number | undefined {
  const value = env[name];
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${name}: expected a finite number.`);
  return parsed;
}

function setIfPresent(target: RuntimeOverrides, key: string, value: number | undefined): void {
  if (value !== undefined) target[key] = value;
}

export function buildSharedPiRuntimeOverrides(env: RuntimeEnv = process.env): RuntimeOverrides {
  const compaction: RuntimeOverrides = {};
  setIfPresent(compaction, "reserveTokens", readNumberEnv(env, "LA_PI_COMPACT_RESERVE_TOKENS"));
  setIfPresent(compaction, "keepRecentTokens", readNumberEnv(env, "LA_PI_COMPACT_KEEP_RECENT_TOKENS"));

  const provider: RuntimeOverrides = {};
  setIfPresent(provider, "maxRetries", readNumberEnv(env, "LA_PI_PROVIDER_MAX_RETRIES"));
  setIfPresent(provider, "maxRetryDelayMs", readNumberEnv(env, "LA_PI_PROVIDER_MAX_RETRY_DELAY_MS"));

  const retry: RuntimeOverrides = {};
  setIfPresent(retry, "maxRetries", readNumberEnv(env, "LA_PI_RETRY_MAX_RETRIES"));
  setIfPresent(retry, "baseDelayMs", readNumberEnv(env, "LA_PI_RETRY_BASE_DELAY_MS"));
  if (Object.keys(provider).length > 0) retry.provider = provider;

  const overrides: RuntimeOverrides = {};
  if (Object.keys(compaction).length > 0) overrides.compaction = compaction;
  if (Object.keys(retry).length > 0) overrides.retry = retry;
  return overrides;
}

export function applySharedPiRuntimeOverrides(
  settingsManager: { applyOverrides(overrides: RuntimeOverrides): void },
  env: RuntimeEnv = process.env,
): void {
  const overrides = buildSharedPiRuntimeOverrides(env);
  if (Object.keys(overrides).length > 0) settingsManager.applyOverrides(overrides);
}
