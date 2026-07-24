import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, readStoredCredential } from "@earendil-works/pi-coding-agent";
import {
  NetworkCapabilityBroker,
  ProcessCapabilityBroker,
  SecretCapabilityBroker,
  type SecretCapabilityHandle,
} from "@linguist-agent/cat-data";

export const WEB_BRIDGE_USER_AGENT = "Linguist-Agent web-evidence-bridge";
const execFileAsync = promisify(execFile);
const WEB_SECRET_BROKER = SecretCapabilityBroker.create({
  grants: [{
    id: "web-search-provider-secrets",
    consumer: "web_search",
    secretIds: ["env:TAVILY_API_KEY", "env:LA_TAVILY_API_KEY", "provider:tavily", "provider:tavily-search"],
  }],
});
const WEB_PROCESS_BROKER = ProcessCapabilityBroker.create({
  grants: [{ id: "web-search-keychain-reader", toolName: "web_search", templateIds: ["keychain-provider-read"] }],
});

const webFetchParameters = Type.Object({
  url: Type.String({ description: "HTTP/HTTPS URL to fetch for bounded evidence." }),
  maxChars: Type.Optional(Type.Number({ default: 12000, minimum: 1000, maximum: 50000 })),
});

const webSearchParameters = Type.Object({
  query: Type.String({ description: "Search query for public web evidence." }),
  maxResults: Type.Optional(Type.Number({ default: 5, minimum: 1, maximum: 10 })),
});

interface WebEvidence {
  url: string;
  title?: string;
  excerpt: string;
  fetchedAt: string;
  query?: string;
  provider?: string;
}

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  raw_content?: string;
  score?: number;
}

function assertHttpUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Only http/https URLs are allowed, got ${url.protocol}`);
  }
  return url;
}

function authorizePublicWebTarget(toolName: "web_fetch" | "web_search", url: URL, allowPrivateNetwork = false): URL {
  NetworkCapabilityBroker.create({
    grants: [{
      id: `${toolName}-exact-target`,
      toolName,
      hosts: [url.hostname],
      schemes: [url.protocol === "http:" ? "http" : "https"],
      ...(url.port ? { ports: [Number(url.port)] } : {}),
      ...(allowPrivateNetwork ? { allowPrivateNetwork: true } : {}),
    }],
  }).authorizeUrl(toolName, url.toString());
  return url;
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripHtml(html: string): string {
  return compactWhitespace(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'"),
  );
}

function titleFromHtml(html: string): string | undefined {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? compactWhitespace(stripHtml(match[1] ?? "")) : undefined;
}

function formatEvidence(evidence: WebEvidence[]): string {
  if (!evidence.length) return "No web evidence returned.";
  return evidence.map((item, index) => [
    `## ${index + 1}. ${item.title ?? item.url}`,
    item.query ? `Query: ${item.query}` : undefined,
    item.provider ? `Provider: ${item.provider}` : undefined,
    `URL: ${item.url}`,
    `Fetched: ${item.fetchedAt}`,
    `Excerpt: ${item.excerpt}`,
    `Evidence: ${item.url}`,
  ].filter(Boolean).join("\n")).join("\n\n");
}

function unquoteShellValue(value: string): string {
  return value.slice(1, -1).replaceAll("'\\''", "'");
}

async function storedApiKey(provider: string, handle: SecretCapabilityHandle): Promise<string | undefined> {
  if (handle.consumer !== "web_search" || handle.secretId !== `provider:${provider}`) {
    throw new Error(`SECRET_CAPABILITY_DENIED: invalid provider handle for ${provider}.`);
  }
  const credential = readStoredCredential(provider);
  if (credential?.type !== "api_key" || !credential.key) return undefined;
  const reference = authorizeStoredWebCredentialReference(provider, credential.key);
  if (reference.kind === "env") return process.env[reference.envName];
  const { stdout } = await execFileAsync("/usr/bin/security", [
    "find-generic-password",
    "-a", reference.account,
    "-s", reference.service,
    "-w",
  ]);
  return stdout.trim() || undefined;
}

export function authorizeStoredWebCredentialReference(
  provider: string,
  key: string,
): Readonly<
  | { kind: "env"; envName: string }
  | { kind: "keychain"; account: string; service: string }
> {
  if (key.startsWith("$")) {
    const envName = key.slice(1);
    WEB_SECRET_BROKER.authorize("web_search", `env:${envName}`);
    return Object.freeze({ kind: "env", envName });
  }
  if (!key.startsWith("!")) {
    throw new Error(`SECRET_CAPABILITY_DENIED: plaintext stored credential for ${provider} is not an approved secret reference.`);
  }
  const match = /^!security find-generic-password -a ('.*') -s ('.*') -w$/.exec(key);
  if (!match) throw new Error(`Unsupported Pi credential command for ${provider}; LA only executes its own macOS Keychain reference.`);
  const account = unquoteShellValue(match[1]);
  const service = unquoteShellValue(match[2]);
  if (service !== `com.linguist-agent.pi.${provider}`) {
    throw new Error(`SECRET_CAPABILITY_DENIED: Keychain service ${service} is not bound to provider ${provider}.`);
  }
  WEB_PROCESS_BROKER.authorize("web_search", "keychain-provider-read");
  return Object.freeze({ kind: "keychain", account, service });
}

async function tavilyApiKey(): Promise<string | undefined> {
  const primaryEnv = WEB_SECRET_BROKER.authorize("web_search", "env:TAVILY_API_KEY");
  const secondaryEnv = WEB_SECRET_BROKER.authorize("web_search", "env:LA_TAVILY_API_KEY");
  const tavily = WEB_SECRET_BROKER.authorize("web_search", "provider:tavily");
  const fallback = WEB_SECRET_BROKER.authorize("web_search", "provider:tavily-search");
  return process.env[primaryEnv.secretId.slice(4)] ||
    process.env[secondaryEnv.secretId.slice(4)] ||
    await storedApiKey("tavily", tavily) ||
    await storedApiKey("tavily-search", fallback);
}

export function createWebFetchTool(options: { allowPrivateNetwork?: boolean } = {}) {
  return defineTool<typeof webFetchParameters, { evidence: WebEvidence }>({
    name: "web_fetch",
    label: "Web Fetch",
    description: "Fetch a specific public URL and return bounded URL/excerpt/timestamp evidence for LA reasoning.",
    promptSnippet: "web_fetch: fetch one public URL and return URL/excerpt/timestamp evidence. It never writes CAT state.",
    promptGuidelines: [
      "Use web_fetch only for public HTTP/HTTPS references, docs, terminology pages, or user-requested URLs.",
      "When using fetched content for CAT accuracy, cite the returned Evidence URL and excerpt.",
      "A web_fetch result cannot bypass locked segment, tag, terminology, proposal, or delivery gates.",
    ],
    parameters: webFetchParameters,
    executionMode: "parallel",
    async execute(_toolCallId, params, signal) {
      const url = authorizePublicWebTarget("web_fetch", assertHttpUrl(params.url), options.allowPrivateNetwork === true);
      const response = await fetch(url, {
        signal,
        headers: {
          "User-Agent": WEB_BRIDGE_USER_AGENT,
          Accept: "text/html,text/plain,application/json,*/*;q=0.8",
        },
      });
      if (!response.ok) throw new Error(`web_fetch failed for ${url.toString()}: HTTP ${response.status}`);
      const contentType = response.headers.get("content-type") ?? "";
      const raw = await response.text();
      const text = contentType.includes("text/html") ? stripHtml(raw) : compactWhitespace(raw);
      const evidence: WebEvidence = {
        url: url.toString(),
        title: contentType.includes("text/html") ? titleFromHtml(raw) : undefined,
        excerpt: text.slice(0, params.maxChars ?? 12000),
        fetchedAt: new Date().toISOString(),
        provider: "direct_fetch",
      };
      return {
        content: [{ type: "text", text: formatEvidence([evidence]) }],
        details: { evidence },
      };
    },
  });
}

export function createWebSearchTool() {
  return defineTool<typeof webSearchParameters, { evidence: WebEvidence[] }>({
    name: "web_search",
    label: "Web Search",
    description: "Search public web evidence through the configured LA search bridge and return URL/excerpt/timestamp evidence.",
    promptSnippet: "web_search: search public web evidence and return URL/query/excerpt/timestamp evidence. It never writes CAT state.",
    promptGuidelines: [
      "Use web_search for current public evidence only when project assets, TM, glossary, and termbase are insufficient.",
      "When using web_search for CAT accuracy, cite returned Evidence URLs and excerpts.",
      "Search evidence is advisory; it cannot bypass locked segment, tag, terminology, proposal, or delivery gates.",
    ],
    parameters: webSearchParameters,
    executionMode: "parallel",
    async execute(_toolCallId, params, signal) {
      const apiKey = await tavilyApiKey();
      if (!apiKey) {
        throw new Error("web_search bridge is enabled but not configured. Add TAVILY_API_KEY, LA_TAVILY_API_KEY, or a Pi api_key credential for provider 'tavily'.");
      }
      const searchUrl = authorizePublicWebTarget("web_search", assertHttpUrl("https://api.tavily.com/search"));
      const response = await fetch(searchUrl, {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          "User-Agent": WEB_BRIDGE_USER_AGENT,
        },
        body: JSON.stringify({
          api_key: apiKey,
          query: params.query,
          max_results: params.maxResults ?? 5,
          include_answer: false,
          include_raw_content: false,
        }),
      });
      if (!response.ok) throw new Error(`web_search provider failed: HTTP ${response.status}`);
      const data = await response.json() as { results?: TavilyResult[] };
      const fetchedAt = new Date().toISOString();
      const evidence = (data.results ?? []).filter((item) => item.url).map((item) => ({
        url: item.url as string,
        title: item.title,
        excerpt: compactWhitespace(item.content ?? item.raw_content ?? "").slice(0, 1400),
        fetchedAt,
        query: params.query,
        provider: "tavily",
      }));
      return {
        content: [{ type: "text", text: formatEvidence(evidence) }],
        details: { evidence },
      };
    },
  });
}
