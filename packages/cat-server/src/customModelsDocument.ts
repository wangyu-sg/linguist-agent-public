export type CustomModelsProviderConfig = Record<string, unknown> & {
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  authHeader?: boolean;
  models?: Array<Record<string, unknown>>;
};

export interface CustomModelsDocument {
  providers?: Record<string, CustomModelsProviderConfig>;
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function cleanNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function copyObjectField(target: Record<string, unknown>, input: Record<string, unknown>, key: string): void {
  const value = objectValue(input[key]);
  if (value) target[key] = value;
}

const PROVIDER_UNSET_FIELDS = new Set(["baseUrl", "api", "authHeader", "headers", "modelOverrides", "compat"]);
const MODEL_UNSET_FIELDS = new Set(["name", "api", "reasoning", "input", "contextWindow", "maxTokens", "thinkingLevelMap", "cost", "headers", "compat"]);

function applyUnsetFields(target: Record<string, unknown>, input: Record<string, unknown>, allowed: Set<string>, label: string): void {
  if (input.unset === undefined) return;
  if (!Array.isArray(input.unset)) throw new Error(`${label} unset must be an array of field names.`);
  for (const field of input.unset) {
    if (typeof field !== "string" || !allowed.has(field)) {
      throw new Error(`Unsupported ${label} unset field '${String(field)}'.`);
    }
    delete target[field];
  }
}

export function mergeCustomModelProviderConfig(
  existing: CustomModelsProviderConfig,
  input: Record<string, unknown>,
  apiKeyReference?: string,
): CustomModelsProviderConfig {
  const next: CustomModelsProviderConfig = { ...existing };
  applyUnsetFields(next, input, PROVIDER_UNSET_FIELDS, "custom provider");
  const baseUrl = cleanString(input.baseUrl);
  const api = cleanString(input.api);
  if (baseUrl) next.baseUrl = baseUrl;
  if (api) next.api = api;
  if (typeof input.authHeader === "boolean") next.authHeader = input.authHeader;
  if (apiKeyReference) next.apiKey = apiKeyReference;
  copyObjectField(next, input, "headers");
  copyObjectField(next, input, "modelOverrides");
  copyObjectField(next, input, "compat");
  next.models = Array.isArray(existing.models) ? existing.models : [];
  return next;
}

export function mergeCustomModelConfig(
  existing: Record<string, unknown>,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const id = cleanString(input.id) ?? cleanString(existing.id);
  const next: Record<string, unknown> = { ...existing };
  applyUnsetFields(next, input, MODEL_UNSET_FIELDS, "custom model");
  if (id) next.id = id;
  const name = cleanString(input.name);
  const api = cleanString(input.api);
  if (name) next.name = name;
  if (api) next.api = api;
  if (typeof input.reasoning === "boolean") next.reasoning = input.reasoning;
  if (Array.isArray(input.input)) next.input = input.input.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  const contextWindow = cleanNumber(input.contextWindow);
  const maxTokens = cleanNumber(input.maxTokens);
  if (contextWindow !== undefined) next.contextWindow = contextWindow;
  if (maxTokens !== undefined) next.maxTokens = maxTokens;
  copyObjectField(next, input, "thinkingLevelMap");
  copyObjectField(next, input, "cost");
  copyObjectField(next, input, "headers");
  copyObjectField(next, input, "compat");
  return next;
}
