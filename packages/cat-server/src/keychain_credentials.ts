import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { CredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { getPiCredentialStore, refreshPiModelRuntime } from "./pi_model_runtime.js";

const execFileAsync = promisify(execFile);
const SERVICE_PREFIX = "com.linguist-agent.pi";
const SECRET_ENV_RE = /(API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|BEARER)/i;
const API_KEY_ENV_VARS: Record<string, string[]> = {
  anthropic: ["ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_API_KEY"],
  "ant-ling": ["ANT_LING_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  "azure-openai-responses": ["AZURE_OPENAI_API_KEY"],
  nvidia: ["NVIDIA_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  google: ["GEMINI_API_KEY"],
  "google-vertex": ["GOOGLE_CLOUD_API_KEY"],
  groq: ["GROQ_API_KEY"],
  cerebras: ["CEREBRAS_API_KEY"],
  xai: ["XAI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  "vercel-ai-gateway": ["AI_GATEWAY_API_KEY"],
  zai: ["ZAI_API_KEY"],
  "zai-coding-cn": ["ZAI_CODING_CN_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
  minimax: ["MINIMAX_API_KEY"],
  "minimax-cn": ["MINIMAX_CN_API_KEY"],
  moonshotai: ["MOONSHOT_API_KEY"],
  "moonshotai-cn": ["MOONSHOT_API_KEY"],
  huggingface: ["HF_TOKEN"],
  fireworks: ["FIREWORKS_API_KEY"],
  together: ["TOGETHER_API_KEY"],
  opencode: ["OPENCODE_API_KEY"],
  "opencode-go": ["OPENCODE_API_KEY"],
  "kimi-coding": ["KIMI_API_KEY"],
  "cloudflare-workers-ai": ["CLOUDFLARE_API_KEY"],
  "cloudflare-ai-gateway": ["CLOUDFLARE_API_KEY"],
  xiaomi: ["XIAOMI_API_KEY"],
  "xiaomi-token-plan-cn": ["XIAOMI_TOKEN_PLAN_CN_API_KEY"],
  "xiaomi-token-plan-ams": ["XIAOMI_TOKEN_PLAN_AMS_API_KEY"],
  "xiaomi-token-plan-sgp": ["XIAOMI_TOKEN_PLAN_SGP_API_KEY"],
};

type PiCredentialStoreLike = Pick<CredentialStore, "read" | "modify" | "delete">;

async function refreshCredentialRuntime(runtime?: ModelRuntime): Promise<void> {
  if (runtime) {
    await runtime.refresh({ allowNetwork: false });
    return;
  }
  await refreshPiModelRuntime();
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function sanitizeKeychainProviderId(provider: string): string {
  const normalized = provider.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-");
  if (!normalized) throw new Error("provider id is required for Keychain storage.");
  return normalized;
}

export function keychainServiceForProvider(provider: string): string {
  return `${SERVICE_PREFIX}.${sanitizeKeychainProviderId(provider)}`;
}

export function apiKeyEnvVarsForProvider(provider: string): string[] {
  return API_KEY_ENV_VARS[sanitizeKeychainProviderId(provider)] ?? [];
}

export interface AmbientCredentialCheck {
  id: string;
  label: string;
  envVars: string[];
  configured: boolean;
  secret: boolean;
}

export interface AmbientCredentialStatus {
  provider: string;
  configured: boolean;
  checks: AmbientCredentialCheck[];
  note: string;
}

function hasEnv(env: NodeJS.ProcessEnv | Record<string, string | undefined>, name: string): boolean {
  return Boolean(env[name]);
}

function hasAnyEnv(env: NodeJS.ProcessEnv | Record<string, string | undefined>, names: string[]): boolean {
  return names.some((name) => hasEnv(env, name));
}

export function ambientCredentialStatusForProvider(
  provider: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  fileExists: (path: string) => boolean = existsSync,
): AmbientCredentialStatus | undefined {
  const id = sanitizeKeychainProviderId(provider);
  if (id === "google-vertex") {
    const explicitAdcPath = env.GOOGLE_APPLICATION_CREDENTIALS;
    const explicitAdc = Boolean(explicitAdcPath && fileExists(explicitAdcPath));
    const defaultAdc = explicitAdcPath ? false : fileExists(join(homedir(), ".config", "gcloud", "application_default_credentials.json"));
    const project = hasAnyEnv(env, ["GOOGLE_CLOUD_PROJECT", "GCLOUD_PROJECT"]);
    const location = hasEnv(env, "GOOGLE_CLOUD_LOCATION");
    const apiKey = hasEnv(env, "GOOGLE_CLOUD_API_KEY");
    const adc = explicitAdcPath ? explicitAdc : defaultAdc;
    return {
      provider: id,
      configured: apiKey || (adc && project && location),
      checks: [
        { id: "vertex-api-key", label: "Google Cloud API key env", envVars: ["GOOGLE_CLOUD_API_KEY"], configured: apiKey, secret: true },
        { id: "vertex-adc", label: "Application Default Credentials", envVars: ["GOOGLE_APPLICATION_CREDENTIALS"], configured: adc, secret: false },
        { id: "vertex-project", label: "Google Cloud project", envVars: ["GOOGLE_CLOUD_PROJECT", "GCLOUD_PROJECT"], configured: project, secret: false },
        { id: "vertex-location", label: "Google Cloud location", envVars: ["GOOGLE_CLOUD_LOCATION"], configured: location, secret: false },
      ],
      note: "Pi accepts GOOGLE_CLOUD_API_KEY or ADC with project and location; LA reports presence only and does not store ADC secrets.",
    };
  }
  if (id === "amazon-bedrock") {
    const profile = hasEnv(env, "AWS_PROFILE");
    const iamPair = hasEnv(env, "AWS_ACCESS_KEY_ID") && hasEnv(env, "AWS_SECRET_ACCESS_KEY");
    const bearer = hasEnv(env, "AWS_BEARER_TOKEN_BEDROCK");
    const ecs = hasAnyEnv(env, ["AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "AWS_CONTAINER_CREDENTIALS_FULL_URI"]);
    const webIdentity = hasEnv(env, "AWS_WEB_IDENTITY_TOKEN_FILE");
    return {
      provider: id,
      configured: profile || iamPair || bearer || ecs || webIdentity,
      checks: [
        { id: "bedrock-profile", label: "AWS profile", envVars: ["AWS_PROFILE"], configured: profile, secret: false },
        { id: "bedrock-iam", label: "AWS IAM key pair", envVars: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"], configured: iamPair, secret: true },
        { id: "bedrock-bearer", label: "Bedrock bearer token", envVars: ["AWS_BEARER_TOKEN_BEDROCK"], configured: bearer, secret: true },
        { id: "bedrock-ecs", label: "ECS task credentials", envVars: ["AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "AWS_CONTAINER_CREDENTIALS_FULL_URI"], configured: ecs, secret: false },
        { id: "bedrock-web-identity", label: "Web identity token file", envVars: ["AWS_WEB_IDENTITY_TOKEN_FILE"], configured: webIdentity, secret: true },
      ],
      note: "Pi resolves Bedrock through the AWS credential chain; LA reports presence only and does not persist AWS secrets.",
    };
  }
  return undefined;
}

export function buildKeychainCredentialCommand(input: { account?: string; service: string }): string {
  const account = input.account?.trim() || userInfo().username || homedir().split("/").pop() || "user";
  return `!security find-generic-password -a ${shellSingleQuote(account)} -s ${shellSingleQuote(input.service)} -w`;
}

export function sanitizeProviderScopedEnv(env: Record<string, unknown> | undefined): Record<string, string> | undefined {
  if (!env) return undefined;
  const cleaned = Object.fromEntries(
    Object.entries(env)
      .filter(([key, value]) => /^[A-Z0-9_]+$/.test(key) && !SECRET_ENV_RE.test(key) && typeof value === "string" && value.trim().length > 0)
      .map(([key, value]) => [key, (value as string).trim()]),
  );
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

export function keychainGenericPasswordWriteArgs(input: {
  account?: string;
  service: string;
  password: string;
  trustedApplicationPaths?: string[];
}): string[] {
  const account = input.account?.trim() || userInfo().username || homedir().split("/").pop() || "user";
  const trustedApplications = (input.trustedApplicationPaths ?? [])
    .map((path) => path.trim())
    .filter(Boolean)
    .flatMap((path) => ["-T", path]);
  return ["add-generic-password", "-U", "-a", account, "-s", input.service, ...trustedApplications, "-w", input.password];
}

export async function writeKeychainGenericPassword(input: {
  account?: string;
  service: string;
  password: string;
  trustedApplicationPaths?: string[];
}): Promise<void> {
  await execFileAsync("security", keychainGenericPasswordWriteArgs(input));
}

export async function readKeychainGenericPassword(input: {
  account?: string;
  service: string;
  interactionNotAllowedAsMissing?: boolean;
}): Promise<string | undefined> {
  const account = input.account?.trim() || userInfo().username || homedir().split("/").pop() || "user";
  try {
    const { stdout } = await execFileAsync("security", ["find-generic-password", "-a", account, "-s", input.service, "-w"]);
    return stdout.trim() || undefined;
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? "";
    if (stderr.includes("could not be found") || stderr.includes("The specified item could not be found")) return undefined;
    if (input.interactionNotAllowedAsMissing && (error as { code?: number }).code === 51) return undefined;
    throw error;
  }
}

export async function deleteKeychainGenericPassword(input: { account?: string; service: string }): Promise<void> {
  const account = input.account?.trim() || userInfo().username || homedir().split("/").pop() || "user";
  try {
    await execFileAsync("security", ["delete-generic-password", "-a", account, "-s", input.service]);
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? "";
    if (!stderr.includes("could not be found")) throw error;
  }
}

export async function savePiProviderKeychainCredential(input: {
  provider: string;
  apiKey: string;
  env?: Record<string, unknown>;
  credentialStore?: PiCredentialStoreLike;
  modelRuntime?: ModelRuntime;
  account?: string;
  writeKeychain?: typeof writeKeychainGenericPassword;
}): Promise<{ provider: string; service: string; command: string; storage: "macos-keychain" }> {
  const provider = sanitizeKeychainProviderId(input.provider);
  const service = keychainServiceForProvider(provider);
  const writeKeychain = input.writeKeychain ?? writeKeychainGenericPassword;
  await writeKeychain({ account: input.account, service, password: input.apiKey });
  const command = buildKeychainCredentialCommand({ account: input.account, service });
  const env = sanitizeProviderScopedEnv(input.env);
  await (input.credentialStore ?? getPiCredentialStore()).modify(provider, async () => ({
    type: "api_key",
    key: command,
    ...(env ? { env } : {}),
  }));
  await refreshCredentialRuntime(input.modelRuntime);
  return { provider, service, command, storage: "macos-keychain" };
}

export async function removePiProviderKeychainCredential(input: {
  provider: string;
  credentialStore?: PiCredentialStoreLike;
  modelRuntime?: ModelRuntime;
  account?: string;
  deleteKeychain?: typeof deleteKeychainGenericPassword;
}): Promise<{ provider: string; service: string; removed: true }> {
  const provider = sanitizeKeychainProviderId(input.provider);
  const service = keychainServiceForProvider(provider);
  const deleteKeychain = input.deleteKeychain ?? deleteKeychainGenericPassword;
  await deleteKeychain({ account: input.account, service });
  await (input.credentialStore ?? getPiCredentialStore()).delete(provider);
  await refreshCredentialRuntime(input.modelRuntime);
  return { provider, service, removed: true };
}

export async function updatePiProviderScopedEnvCredential(input: {
  provider: string;
  env?: Record<string, unknown>;
  apiKeyEnvVar?: string;
  credentialStore?: PiCredentialStoreLike;
  modelRuntime?: ModelRuntime;
}): Promise<{ provider: string; env: Record<string, string>; storage: "auth-json-env"; removedEnv: boolean; createdCredential: boolean; keyReference?: string }> {
  const provider = sanitizeKeychainProviderId(input.provider);
  const credentialStore = input.credentialStore ?? getPiCredentialStore();
  const env = sanitizeProviderScopedEnv(input.env) ?? {};
  let result: { provider: string; env: Record<string, string>; storage: "auth-json-env"; removedEnv: boolean; createdCredential: boolean; keyReference?: string } | undefined;
  await credentialStore.modify(provider, async (credential) => {
    if (!credential) {
      const apiKeyEnvVar = typeof input.apiKeyEnvVar === "string" ? input.apiKeyEnvVar.trim() : "";
      const allowedApiKeyEnvVars = apiKeyEnvVarsForProvider(provider);
      if (!apiKeyEnvVar || !allowedApiKeyEnvVars.includes(apiKeyEnvVar)) {
        throw new Error(`No stored Pi auth entry for ${provider}; save an API key first or choose an official API key environment variable.`);
      }
      const keyReference = `$${apiKeyEnvVar}`;
      result = { provider, env, storage: "auth-json-env", removedEnv: !Object.keys(env).length, createdCredential: true, keyReference };
      return { type: "api_key", key: keyReference, ...(Object.keys(env).length ? { env } : {}) };
    }
    if (credential.type !== "api_key") {
      throw new Error(`Provider-scoped env editing is only supported for API-key auth entries; ${provider} uses ${credential.type}.`);
    }
    const next = { ...credential, ...(Object.keys(env).length ? { env } : {}) };
    if (!Object.keys(env).length) delete next.env;
    result = { provider, env, storage: "auth-json-env", removedEnv: !Object.keys(env).length, createdCredential: false };
    return next;
  });
  await refreshCredentialRuntime(input.modelRuntime);
  if (!result) throw new Error(`Failed to update Pi provider environment for ${provider}.`);
  return result;
}

export async function testPiProviderKeychainCredential(input: {
  provider: string;
  credentialStore?: PiCredentialStoreLike;
}): Promise<{ provider: string; configured: boolean; source: "authStorage"; storage: "macos-keychain-compatible" }> {
  const provider = sanitizeKeychainProviderId(input.provider);
  const credential = await (input.credentialStore ?? getPiCredentialStore()).read(provider);
  return { provider, configured: credential?.type === "api_key" && Boolean(credential.key), source: "authStorage", storage: "macos-keychain-compatible" };
}
