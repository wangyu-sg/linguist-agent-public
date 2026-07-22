import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

export const DESKTOP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PRODUCT_NAME = "Linguist Agent";
export const APP_BASENAME = "LinguistAgent";
export const APP_EXECUTABLE = PRODUCT_NAME;
export const BUNDLE_ID = "com.linguist-agent.mac";
export const TARGET_PLATFORM = "darwin";
export const TARGET_ARCH = "arm64";
export const DEFAULT_OUTPUT_ROOT = join(DESKTOP_ROOT, "out");
export const DEFAULT_PACKAGE_DIRECTORY = `${APP_BASENAME}-${TARGET_PLATFORM}-${TARGET_ARCH}`;
export const DEFAULT_APP_PATH = join(DEFAULT_OUTPUT_ROOT, DEFAULT_PACKAGE_DIRECTORY, `${APP_BASENAME}.app`);
export const DEFAULT_SIGNING_IDENTITY = "Linguist Agent Local Development";
export const DEFAULT_KEYCHAIN = join(homedir(), "Library", "Keychains", "login.keychain-db");
export const APP_ICON = resolve(DESKTOP_ROOT, "resources/AppIcon.icns");

export const PACKAGED_SOURCE_FILES = Object.freeze([
  "src/main.mjs",
  "src/preload.cjs",
  "src/desktop-security.mjs",
  "src/native-dialogs.mjs",
  "src/runtime-client.mjs",
  "src/runtime-installer.mjs",
  "src/notification-policy.mjs",
  "src/rich-artifact-export.mjs",
]);

export function parseCodeSigningIdentities(output) {
  return output.split("\n").flatMap((line) => {
    const match = line.match(/^\s*\d+\)\s+([0-9a-f]{40})\s+"([^"]+)"\s*$/i);
    return match ? [{ hash: match[1].toUpperCase(), name: match[2] }] : [];
  });
}

export async function resolveCodeSigningIdentity(environment = process.env) {
  const selector = environment.LA_MAC_CODESIGN_IDENTITY?.trim() || DEFAULT_SIGNING_IDENTITY;
  const keychain = environment.LA_MAC_LOCAL_CODESIGN_KEYCHAIN?.trim() || DEFAULT_KEYCHAIN;
  let stdout;
  try {
    ({ stdout } = await run("/usr/bin/security", ["find-identity", "-v", "-p", "codesigning", keychain]));
  } catch (error) {
    throw new Error(`Unable to read code-signing identities from ${keychain}.`, { cause: error });
  }
  const identities = parseCodeSigningIdentities(stdout);
  const hashSelector = /^[0-9a-f]{40}$/i.test(selector);
  const matches = identities.filter((identity) => hashSelector
    ? identity.hash.toLowerCase() === selector.toLowerCase()
    : identity.name === selector);
  if (matches.length === 0) {
    throw new Error(
      `Missing valid code-signing identity: ${selector}. Run apps/desktop/scripts/setup_local_codesigning_identity.sh once, or set LA_MAC_CODESIGN_IDENTITY. Ad-hoc signing is not allowed.`,
    );
  }
  if (matches.length > 1) throw new Error(`Code-signing identity selector is ambiguous: ${selector}`);
  return { ...matches[0], keychain };
}

export function assertBuildVersion(value) {
  if (!/^\d+(?:\.\d+){0,2}$/.test(value)) throw new Error(`Invalid macOS build version: ${value}`);
  return value;
}

export function createPackagerOptions({
  sourceDirectory,
  outputDirectory,
  version,
  buildVersion,
  electronVersion,
  signingIdentity,
  runtimeBundleDirectory,
}) {
  return {
    dir: sourceDirectory,
    out: outputDirectory,
    name: PRODUCT_NAME,
    executableName: APP_EXECUTABLE,
    platform: TARGET_PLATFORM,
    arch: TARGET_ARCH,
    electronVersion,
    appBundleId: BUNDLE_ID,
    helperBundleId: `${BUNDLE_ID}.helper`,
    appCategoryType: "public.app-category.productivity",
    appVersion: version,
    buildVersion: assertBuildVersion(buildVersion),
    icon: APP_ICON,
    asar: true,
    prune: false,
    overwrite: true,
    quiet: true,
    extraResource: [runtimeBundleDirectory],
    darwinDarkModeSupport: true,
    extendInfo: {
      CFBundleDisplayName: PRODUCT_NAME,
      LSMinimumSystemVersion: "12.0",
      NSHighResolutionCapable: true,
    },
    osxSign: {
      identity: signingIdentity.hash,
      keychain: signingIdentity.keychain,
      // @electron/osx-sign queries the default identity policy, which excludes
      // this intentionally local certificate. The explicit preflight above
      // validates it with Apple's codesigning policy before this is constructed.
      identityValidation: false,
      continueOnError: false,
      preAutoEntitlements: false,
      preEmbedProvisioningProfile: false,
      strictVerify: true,
      optionsForFile: () => ({ hardenedRuntime: false, timestamp: "none" }),
    },
  };
}
