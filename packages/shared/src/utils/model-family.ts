/**
 * 渠道、运行时与 UI 共用的 GPT-6 模型家族识别。
 * Astra 可带 Codex 返回的 SKU 后缀；Sol 和 Luna 仅匹配精确 ID。
 */
const GPT_6_ASTRA_FAMILY_PATTERN = /^gpt-6-astra(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?$/
const GPT_6_SOL_MODEL_ID = 'gpt-6-sol'
const GPT_6_LUNA_MODEL_ID = 'gpt-6-luna'

function normalizeModelId(modelId: string | undefined): string | undefined {
  return modelId?.trim().toLowerCase().replace(/\[1m\]$/i, '')
}

export function isGpt6AstraFamily(modelId: string | undefined): boolean {
  const normalized = normalizeModelId(modelId)
  return normalized !== undefined && GPT_6_ASTRA_FAMILY_PATTERN.test(normalized)
}

export function isGpt6SolFamily(modelId: string | undefined): boolean {
  return normalizeModelId(modelId) === GPT_6_SOL_MODEL_ID
}

export function isGpt6LunaFamily(modelId: string | undefined): boolean {
  return normalizeModelId(modelId) === GPT_6_LUNA_MODEL_ID
}
