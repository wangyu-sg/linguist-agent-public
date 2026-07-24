import type { ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import { NetworkCapabilityBroker, ProcessCapabilityBroker } from "@linguist-agent/cat-data";
import { resolveToolCapabilityManifest } from "./toolCapabilities.js";

const URL_KEYS = ["url", "uri", "href", "endpoint"] as const;
const FIXED_NETWORK_TARGETS: Readonly<Record<string, string>> = Object.freeze({
  web_search: "https://api.tavily.com/search",
  code_search: "https://api.github.com/search/code",
});

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function networkUrls(input: unknown, depth = 0): string[] {
  if (!object(input) || depth > 5) return [];
  const urls: string[] = [];
  for (const key of URL_KEYS) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) urls.push(value.trim());
  }
  for (const value of Object.values(input)) {
    if (object(value)) urls.push(...networkUrls(value, depth + 1));
    else if (Array.isArray(value)) {
      for (const entry of value) urls.push(...networkUrls(entry, depth + 1));
    }
  }
  return [...new Set(urls)];
}

export function guardRuntimeCapabilities(event: { toolName: string; input: unknown }): ToolCallEventResult | undefined {
  const manifest = resolveToolCapabilityManifest(event.toolName);
  if (!manifest) return { block: true, reason: `TOOL_CAPABILITY_UNDECLARED: ${event.toolName} has no reviewed production capability manifest.` };
  for (const capability of manifest.capabilities) {
    if (capability.kind === "process") {
      const command = object(event.input) ? event.input.command : undefined;
      if (typeof command !== "string" || !command.trim()) {
        return { block: true, reason: `PROCESS_CAPABILITY_DENIED: ${event.toolName} requires a non-empty command for the sandboxed-shell template.` };
      }
      try {
        ProcessCapabilityBroker.create({
          grants: [{ id: "runtime-sandboxed-shell", toolName: event.toolName, templateIds: [capability.scope] }],
        }).authorize(event.toolName, "sandboxed-shell");
      } catch (error) {
        return { block: true, reason: error instanceof Error ? error.message : "PROCESS_CAPABILITY_DENIED: process authorization failed." };
      }
    }
    if (capability.kind === "network") {
      if (capability.scope === "approved-bridge") {
        return { block: true, reason: `NETWORK_CAPABILITY_DENIED: ${event.toolName} has no exact approved bridge grant for this Run.` };
      }
      const targets = networkUrls(event.input);
      const fixedTarget = FIXED_NETWORK_TARGETS[event.toolName];
      if (fixedTarget) targets.push(fixedTarget);
      if (!targets.length) {
        return { block: true, reason: `NETWORK_CAPABILITY_DENIED: ${event.toolName} supplied no exact network target.` };
      }
      try {
        for (const target of [...new Set(targets)]) {
          const url = new URL(target);
          NetworkCapabilityBroker.create({
            grants: [{
              id: `runtime-${event.toolName}`,
              toolName: event.toolName,
              hosts: [url.hostname],
              schemes: [url.protocol === "http:" ? "http" : "https"],
              ...(url.port ? { ports: [Number(url.port)] } : {}),
            }],
          }).authorizeUrl(event.toolName, target);
        }
      } catch (error) {
        return { block: true, reason: error instanceof Error ? error.message : "NETWORK_CAPABILITY_DENIED: network authorization failed." };
      }
    }
  }
  return undefined;
}
