export type NativeCapabilityPackageId =
  | "subagents"
  | "docparser"
  | "ask"
  | "research"
  | "browser"
  | "computer"
  | "vision";

export type NativeCapabilityPackageActivation = "core" | "main" | "team" | "on-demand" | "experimental";
export type NativeCapabilityRuntimeReadiness = "ready" | "setup_required";
export type NativeCapabilitySetupRequirement =
  | "agent_browser_executable"
  | "signed_helper_accessibility_screen_recording";

export interface NativeCapabilityPackage {
  id: NativeCapabilityPackageId;
  packageName: string;
  version: string;
  source: string;
  integrity: string;
  extensionPath: string;
  activation: NativeCapabilityPackageActivation;
  runtimeReadiness: NativeCapabilityRuntimeReadiness;
  minimumNodeVersion?: string;
  setupRequirement?: NativeCapabilitySetupRequirement;
  patch?: "pi-ask-headless-v1" | "pi-web-access-headless-v1";
}

export const NATIVE_CAPABILITY_PACKAGES = [
  {
    id: "subagents",
    packageName: "pi-subagents",
    version: "0.35.1",
    source: "npm:pi-subagents@0.35.1",
    integrity: "sha512-nIH6liO541FZ1RoeEu58Ligd59tiNw0/ODPgHh7uvx9Dk4UpWH08F84/l1+hXCzUgC85OCmyVtngWkZjcK94Cg==",
    extensionPath: "src/extension/index.ts",
    activation: "team",
    runtimeReadiness: "ready",
  },
  {
    id: "docparser",
    packageName: "pi-docparser",
    version: "3.0.1",
    source: "npm:pi-docparser@3.0.1",
    integrity: "sha512-t08KQlV6jnvXM9usnOWMyxLJL5rlwHjOO/Dy/GXF8x6PIvaFW7FGk4+l3a+HQq+nJJZQ9no9ETQuNg4ZYcN9tg==",
    extensionPath: "extensions/docparser/index.ts",
    activation: "core",
    runtimeReadiness: "ready",
  },
  {
    id: "ask",
    packageName: "@eko24ive/pi-ask",
    version: "1.1.0",
    source: "npm:@eko24ive/pi-ask@1.1.0",
    integrity: "sha512-eK02qhHH9RF5riexmjKqs+yDZheFX+6im3Dt8KnhS3EWZGvuwN/G1XvXg8SZscgGlqhJOrKPETau/dLs3xtXiQ==",
    extensionPath: "src/index.ts",
    activation: "main",
    runtimeReadiness: "ready",
    patch: "pi-ask-headless-v1",
  },
  {
    id: "research",
    packageName: "pi-web-access",
    version: "0.13.0",
    source: "npm:pi-web-access@0.13.0",
    integrity: "sha512-ny0bHisMWdobmu1hcMp/jqjaRh6pYrH7dctBK2CVyRF4ia7bP47RnOPYdG1yiks9ohtcanWir5Hl9EFap8h0zQ==",
    extensionPath: "la-headless.ts",
    activation: "on-demand",
    runtimeReadiness: "ready",
    patch: "pi-web-access-headless-v1",
  },
  {
    id: "browser",
    packageName: "pi-agent-browser-native",
    version: "0.2.67",
    source: "npm:pi-agent-browser-native@0.2.67",
    integrity: "sha512-nl0+dFdzrQmptMD2ib9Eo5dWtutSvcH1r/4Z9QqMxhFnRE3wdtUuOe0gHSmiguwklxefT1TaThqEO0q2ieqMJg==",
    extensionPath: "dist/extensions/agent-browser/index.js",
    activation: "on-demand",
    runtimeReadiness: "setup_required",
    minimumNodeVersion: "22.19.0",
    setupRequirement: "agent_browser_executable",
  },
  {
    id: "computer",
    packageName: "@injaneity/pi-computer-use",
    version: "0.4.3",
    source: "npm:@injaneity/pi-computer-use@0.4.3",
    integrity: "sha512-kOURODGHXhlwUJAwv5PgxdCknjg88+274htEa2MaxnPLfEve9Mv8T28ymfH/kAFROVlRSfRshw3oNM6Sf1gD0A==",
    extensionPath: "extensions/computer-use.ts",
    activation: "on-demand",
    runtimeReadiness: "setup_required",
    minimumNodeVersion: "20.6.0",
    setupRequirement: "signed_helper_accessibility_screen_recording",
  },
  {
    id: "vision",
    packageName: "@getpipher/vision",
    version: "0.5.1",
    source: "npm:@getpipher/vision@0.5.1",
    integrity: "sha512-mCKw0lUZ/PLI0DyS8Q5VyxJccIKbLXdRnTEOpPuPPgmCwBV9WJlK5MfPOkzOzExYp4Pz3C3eFBnlDQayAP5wHg==",
    extensionPath: "extensions/vision.ts",
    activation: "experimental",
    runtimeReadiness: "ready",
  },
] as const satisfies readonly NativeCapabilityPackage[];
