import { isIP } from "node:net";
import { domainToASCII } from "node:url";

export interface NetworkCapabilityGrant {
  id: string;
  toolName: string;
  hosts: readonly string[];
  schemes: readonly ("http" | "https")[];
  /** Omit to permit only the selected schemes' standard ports. */
  ports?: readonly number[];
  /** Test/development or an explicit private-network Decision only. */
  allowPrivateNetwork?: boolean;
}

export interface AuthorizedNetworkCapability {
  grantId: string;
  toolName: string;
  host: string;
  scheme: "http" | "https";
  port: number;
  url: string;
}

export function normalizeNetworkCapabilityHost(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed.includes("*") || trimmed.includes("\0") || trimmed.includes("%00")
    || /[\s\r\n/:]/.test(trimmed) || trimmed.startsWith(".") || trimmed.endsWith(".")) {
    throw new Error(`NETWORK_CAPABILITY_INVALID: exact host required, got ${value}.`);
  }
  const ascii = domainToASCII(trimmed);
  if (!ascii || ascii !== trimmed) throw new Error(`NETWORK_CAPABILITY_INVALID: exact ASCII host required, got ${value}.`);
  return ascii;
}

interface CanonicalNetworkCapabilityGrant extends Omit<NetworkCapabilityGrant, "hosts" | "schemes" | "ports"> {
  hosts: readonly string[];
  schemes: readonly ("http" | "https")[];
  ports: readonly number[];
}

export class NetworkCapabilityBroker {
  private constructor(private readonly grants: readonly CanonicalNetworkCapabilityGrant[]) {}

  static create(input: { grants: readonly NetworkCapabilityGrant[] }): NetworkCapabilityBroker {
    const grants = input.grants.map((grant): CanonicalNetworkCapabilityGrant => {
      if (!grant.id.trim() || !grant.toolName.trim()) throw new Error("NETWORK_CAPABILITY_INVALID: grant id and tool name are required.");
      const schemes = [...new Set(grant.schemes)];
      if (!schemes.length || schemes.some((scheme) => scheme !== "http" && scheme !== "https")) {
        throw new Error(`NETWORK_CAPABILITY_INVALID: ${grant.id} requires an explicit http/https scheme.`);
      }
      const ports = grant.ports ?? schemes.map((scheme) => scheme === "http" ? 80 : 443);
      if (!ports.length || ports.some((port) => !Number.isInteger(port) || port < 1 || port > 65_535)) {
        throw new Error(`NETWORK_CAPABILITY_INVALID: ${grant.id} contains an invalid exact port.`);
      }
      return { ...grant, hosts: [...new Set(grant.hosts.map(normalizeNetworkCapabilityHost))], schemes, ports: [...new Set(ports)] };
    });
    return new NetworkCapabilityBroker(grants);
  }

  authorizeUrl(toolName: string, rawUrl: string): AuthorizedNetworkCapability {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new Error(`NETWORK_CAPABILITY_DENIED: ${toolName} supplied an invalid URL.`);
    }
    if (url.username || url.password) throw new Error("NETWORK_CAPABILITY_DENIED: URLs containing credentials are forbidden.");
    const scheme = url.protocol.slice(0, -1);
    if (scheme !== "http" && scheme !== "https") throw new Error(`NETWORK_CAPABILITY_DENIED: unsupported scheme ${url.protocol}.`);
    const host = normalizeNetworkCapabilityHost(url.hostname);
    const port = url.port ? Number(url.port) : scheme === "http" ? 80 : 443;
    const grant = this.grants.find((candidate) => candidate.toolName === toolName
      && candidate.hosts.includes(host)
      && candidate.schemes.includes(scheme)
      && candidate.ports.includes(port));
    if (!grant) throw new Error(`NETWORK_CAPABILITY_DENIED: ${toolName} is not granted ${scheme}://${host}:${port}.`);
    if (privateNetworkHost(host) && grant.allowPrivateNetwork !== true) {
      throw new Error(`NETWORK_CAPABILITY_DENIED: ${toolName} cannot access private or loopback host ${host}.`);
    }
    return Object.freeze({ grantId: grant.id, toolName, host, scheme, port, url: url.toString() });
  }
}

function privateNetworkHost(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  const version = isIP(host);
  if (version === 4) {
    const parts = host.split(".").map(Number);
    return parts[0] === 0
      || parts[0] === 10
      || parts[0] === 127
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && (parts[1] ?? 0) >= 16 && (parts[1] ?? 0) <= 31)
      || (parts[0] === 192 && parts[1] === 168);
  }
  if (version === 6) {
    const normalized = host.toLowerCase();
    return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized);
  }
  return false;
}

export interface ProcessCapabilityGrant {
  id: string;
  toolName: string;
  templateIds: readonly string[];
}

export class ProcessCapabilityBroker {
  private constructor(private readonly grants: readonly ProcessCapabilityGrant[]) {}

  static create(input: { grants: readonly ProcessCapabilityGrant[] }): ProcessCapabilityBroker {
    const grants = input.grants.map((grant) => {
      if (!grant.id.trim() || !grant.toolName.trim() || !grant.templateIds.length || grant.templateIds.some((id) => !id.trim())) {
        throw new Error("PROCESS_CAPABILITY_INVALID: grant id, tool name, and exact template IDs are required.");
      }
      return { ...grant, templateIds: [...new Set(grant.templateIds)] };
    });
    return new ProcessCapabilityBroker(grants);
  }

  authorize(toolName: string, templateId: string): Readonly<{ grantId: string; toolName: string; templateId: string }> {
    const grant = this.grants.find((candidate) => candidate.toolName === toolName && candidate.templateIds.includes(templateId));
    if (!grant) throw new Error(`PROCESS_CAPABILITY_DENIED: ${toolName} is not granted process template ${templateId}.`);
    return Object.freeze({ grantId: grant.id, toolName, templateId });
  }
}

export interface SecretCapabilityGrant {
  id: string;
  consumer: string;
  secretIds: readonly string[];
}

export interface SecretCapabilityHandle {
  grantId: string;
  secretId: string;
  consumer: string;
}

export class SecretCapabilityBroker {
  private constructor(private readonly grants: readonly SecretCapabilityGrant[]) {}

  static create(input: { grants: readonly SecretCapabilityGrant[] }): SecretCapabilityBroker {
    const grants = input.grants.map((grant) => {
      if (!grant.id.trim() || !grant.consumer.trim() || !grant.secretIds.length || grant.secretIds.some((id) => !id.trim())) {
        throw new Error("SECRET_CAPABILITY_INVALID: grant id, consumer, and opaque secret IDs are required.");
      }
      return { ...grant, secretIds: [...new Set(grant.secretIds)] };
    });
    return new SecretCapabilityBroker(grants);
  }

  authorize(consumer: string, secretId: string): Readonly<SecretCapabilityHandle> {
    const grant = this.grants.find((candidate) => candidate.consumer === consumer && candidate.secretIds.includes(secretId));
    if (!grant) throw new Error(`SECRET_CAPABILITY_DENIED: ${consumer} is not granted opaque secret ${secretId}.`);
    return Object.freeze({ grantId: grant.id, secretId, consumer });
  }
}
