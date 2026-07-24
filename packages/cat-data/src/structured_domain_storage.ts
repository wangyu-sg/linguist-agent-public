import { resolve } from "node:path";

export type StructuredStorageDomain = "settings" | "grants" | "trust";

export interface StructuredStorageAddress {
  domain: StructuredStorageDomain;
  key: string;
  scope: string;
}

export interface StructuredStorageValue extends StructuredStorageAddress {
  revision: number;
  payload: Record<string, unknown>;
  payloadSha256: string;
}

export interface StructuredStorageBackend {
  readonly root: string;
  read(address: StructuredStorageAddress): StructuredStorageValue | null;
  initialize(input: {
    address: StructuredStorageAddress;
    value: Record<string, unknown>;
  }): Promise<StructuredStorageValue>;
  write(input: {
    address: StructuredStorageAddress;
    expectedRevision: number;
    expectedValue: Record<string, unknown>;
    value: Record<string, unknown>;
  }): Promise<StructuredStorageValue>;
}

let installedBackend: Readonly<StructuredStorageBackend> | null = null;

export function installStructuredStorageBackend(input: StructuredStorageBackend): void {
  if (installedBackend) throw new Error("canonical settings/grants/trust storage is already installed.");
  installedBackend = Object.freeze({
    ...input,
    root: resolve(input.root),
  });
}

export function resolveStructuredStorageBackend(root: string): Readonly<StructuredStorageBackend> | null {
  if (!installedBackend) return null;
  if (installedBackend.root !== resolve(root)) {
    throw new Error("canonical settings/grants/trust storage is installed for another root.");
  }
  return installedBackend;
}

export function structuredStorageStatus(): {
  authority: "file-default" | "installed";
  root: string | null;
} {
  return installedBackend
    ? { authority: "installed", root: installedBackend.root }
    : { authority: "file-default", root: null };
}
