import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import webAccessExtension from "./index.ts";

type ToolDefinition = Parameters<ExtensionAPI["registerTool"]>[0];

const SAFE_SEARCH_PROVIDERS = new Set([
	"openai",
	"brave",
	"parallel",
	"tavily",
	"exa",
	"perplexity",
]);

function requestedUrls(params: Record<string, unknown>): string[] {
	return [
		...(typeof params.url === "string" ? [params.url] : []),
		...(Array.isArray(params.urls) ? params.urls.filter((value): value is string => typeof value === "string") : []),
	];
}

function assertSafeDocumentUrls(params: Record<string, unknown>): void {
	if (params.timestamp !== undefined || params.frames !== undefined || params.model !== undefined || params.prompt !== undefined) {
		throw new Error("Native Research only fetches text pages. Video, frames, media prompts, and cloud media upload are disabled.");
	}
	for (const value of requestedUrls(params)) {
		let url: URL;
		try {
			url = new URL(value);
		} catch {
			throw new Error("Native Research only accepts absolute HTTPS URLs.");
		}
		if (url.protocol !== "https:") throw new Error("Native Research only accepts HTTPS URLs.");
		const host = url.hostname.toLowerCase();
		if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be" || host.endsWith(".vimeo.com")) {
			throw new Error("Video extraction and media upload are disabled for Native Research.");
		}
	}
}

function wrapTool(tool: ToolDefinition): ToolDefinition {
	if (tool.name === "web_search") {
		const execute = tool.execute.bind(tool);
		return {
			...tool,
			description: "Search the public web with source citations. Native Research runs headlessly: curator UI, browser-cookie auth, Gemini Web, and media upload are disabled.",
			async execute(callId, rawParams, signal, onUpdate, ctx) {
				const params = rawParams as Record<string, unknown>;
				const requestedProvider = typeof params.provider === "string" ? params.provider.trim().toLowerCase() : "";
				const provider = SAFE_SEARCH_PROVIDERS.has(requestedProvider) ? requestedProvider : "openai";
				return execute(callId, { ...params, provider, workflow: "none" } as never, signal, onUpdate, ctx);
			},
		} as ToolDefinition;
	}
	if (tool.name === "fetch_content") {
		const execute = tool.execute.bind(tool);
		return {
			...tool,
			description: "Fetch readable text from HTTPS pages. Local files, video extraction, browser cookies, and cloud media upload are disabled.",
			async execute(callId, rawParams, signal, onUpdate, ctx) {
				const params = rawParams as Record<string, unknown>;
				assertSafeDocumentUrls(params);
				return execute(callId, params as never, signal, onUpdate, ctx);
			},
		} as ToolDefinition;
	}
	return tool;
}

/**
 * LA's server-owned research profile. The upstream Package supplies search and
 * extraction semantics; this narrow wrapper removes its parallel browser UI,
 * ambient browser-cookie path, and media-upload surface before registration.
 */
export default function nativeResearchExtension(pi: ExtensionAPI) {
	const host = new Proxy(pi, {
		get(target, property, receiver) {
			if (property === "registerTool") {
				return (tool: ToolDefinition) => target.registerTool(wrapTool(tool));
			}
			if (property === "registerCommand" || property === "registerShortcut") {
				return () => undefined;
			}
			const value = Reflect.get(target, property, receiver);
			return typeof value === "function" ? value.bind(target) : value;
		},
	}) as ExtensionAPI;
	webAccessExtension(host);
}
