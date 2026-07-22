import type { Api, Model } from "@earendil-works/pi-ai/compat";

type RuntimeModelShape = {
  api?: unknown;
  baseUrl?: unknown;
  compat?: unknown;
  provider?: unknown;
};

export function normalizePiRuntimeModel<T extends Model<Api> | undefined>(model: T): T {
  if (!model) return model;
  const shape = model as unknown as RuntimeModelShape;
  if (!isOpenCodeCompletionsModel(shape)) return model;
  const compat = typeof shape.compat === "object" && shape.compat !== null ? shape.compat : {};
  return {
    ...model,
    compat: {
      ...compat,
      supportsLongCacheRetention: false,
    },
  } as T;
}

function isOpenCodeCompletionsModel(model: RuntimeModelShape): boolean {
  const provider = typeof model.provider === "string" ? model.provider : "";
  const baseUrl = typeof model.baseUrl === "string" ? model.baseUrl : "";
  return (
    model.api === "openai-completions" &&
    (provider === "opencode" ||
      provider === "opencode-go" ||
      baseUrl.includes("opencode.ai/zen"))
  );
}
