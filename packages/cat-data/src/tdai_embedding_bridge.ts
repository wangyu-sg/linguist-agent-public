export interface TdaiEmbeddingBridgeOptions {
  gatewayUrl: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export interface TdaiEmbedResponse {
  provider: string;
  model: string;
  dimensions: number;
  ready: boolean;
  count: number;
  vectors: number[][];
}

export type TdaiEmbeddingBridgeState =
  | "gateway_unreachable"
  | "endpoint_missing"
  | "embedding_unavailable"
  | "not_ready"
  | "ready"
  | "error";

export interface TdaiEmbeddingBridgeStatus {
  gatewayUrl: string;
  state: TdaiEmbeddingBridgeState;
  provider?: string;
  model?: string;
  dimensions?: number;
  message?: string;
}

function normalizeGatewayUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, fetchFn: typeof fetch): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function postEmbed(options: TdaiEmbeddingBridgeOptions, texts: string[]): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.apiKey) headers.Authorization = `Bearer ${options.apiKey}`;
  return await fetchWithTimeout(
    `${normalizeGatewayUrl(options.gatewayUrl)}/embed`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ texts, timeout_ms: timeoutMs }),
    },
    timeoutMs,
    options.fetchFn ?? fetch,
  );
}

function statusFromError(gatewayUrl: string, error: unknown): TdaiEmbeddingBridgeStatus {
  return {
    gatewayUrl,
    state: "gateway_unreachable",
    message: error instanceof Error ? error.message : String(error),
  };
}

export async function probeTdaiEmbeddingBridge(options: TdaiEmbeddingBridgeOptions): Promise<TdaiEmbeddingBridgeStatus> {
  const gatewayUrl = normalizeGatewayUrl(options.gatewayUrl);
  try {
    const response = await postEmbed({ ...options, gatewayUrl }, []);
    if (response.status === 404) {
      return { gatewayUrl, state: "endpoint_missing", message: "TDAI Gateway does not expose POST /embed." };
    }
    let body: Partial<TdaiEmbedResponse> & { error?: string } = {};
    try {
      body = await response.json() as Partial<TdaiEmbedResponse> & { error?: string };
    } catch {
      body = {};
    }
    if (response.status === 503) {
      return {
        gatewayUrl,
        state: body.provider || body.model ? "not_ready" : "embedding_unavailable",
        provider: body.provider,
        model: body.model,
        dimensions: body.dimensions,
        message: body.error ?? "Embedding service is unavailable or not ready.",
      };
    }
    if (!response.ok) {
      return {
        gatewayUrl,
        state: "error",
        message: body.error ?? `TDAI /embed returned HTTP ${response.status}`,
      };
    }
    return {
      gatewayUrl,
      state: body.ready ? "ready" : "not_ready",
      provider: body.provider,
      model: body.model,
      dimensions: body.dimensions,
    };
  } catch (error) {
    return statusFromError(gatewayUrl, error);
  }
}

export async function embedTextsWithTdai(options: TdaiEmbeddingBridgeOptions, texts: string[]): Promise<TdaiEmbedResponse> {
  const gatewayUrl = normalizeGatewayUrl(options.gatewayUrl);
  const response = await postEmbed({ ...options, gatewayUrl }, texts);
  const body = await response.json().catch(() => ({})) as Partial<TdaiEmbedResponse> & { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? `TDAI /embed returned HTTP ${response.status}`);
  }
  if (!body.ready) {
    throw new Error("TDAI embedding service is not ready");
  }
  if (!Array.isArray(body.vectors) || body.vectors.length !== texts.length) {
    throw new Error(`TDAI /embed returned ${body.vectors?.length ?? 0} vectors for ${texts.length} texts`);
  }
  return {
    provider: body.provider ?? "unknown",
    model: body.model ?? "unknown",
    dimensions: body.dimensions ?? body.vectors[0]?.length ?? 0,
    ready: true,
    count: body.count ?? body.vectors.length,
    vectors: body.vectors,
  };
}
