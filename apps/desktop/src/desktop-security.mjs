export const DEFAULT_SERVER_BASE_URL = "http://127.0.0.1:8787";
export const REQUIRED_CAPABILITIES = Object.freeze([
  "local-auth",
  "native-extension-ui-v1",
  "run-resource-profile-v1",
  "runtime-migrations",
  "task-workspace-v2",
]);

export function resolveServerBaseURL(environment = process.env) {
  const candidate = environment.LA_MAC_LOCAL_SERVER_URL?.trim() || DEFAULT_SERVER_BASE_URL;
  try {
    const url = new URL(candidate);
    const localHost = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname.toLowerCase());
    const rootOnly = (url.pathname === "/" || url.pathname === "") && !url.search && !url.hash;
    if (url.protocol !== "http:" || !localHost || !url.port || url.username || url.password || !rootOnly) {
      return DEFAULT_SERVER_BASE_URL;
    }
    return url.origin;
  } catch {
    return DEFAULT_SERVER_BASE_URL;
  }
}

export function resolveAPIURL(baseURL, path) {
  if (typeof path !== "string" || !path.startsWith("/api/")) throw new Error("Only LA API paths are allowed.");
  const base = new URL(baseURL);
  const target = new URL(path, base);
  if (target.origin !== base.origin || !target.pathname.startsWith("/api/")) throw new Error("API path escaped the local runtime.");
  return target.href;
}

export function isAllowedExternalURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

// Codex Desktop's normal window opens at 1280×820. Larger sizes remain
// supported through the acceptance override, but the default must not drift
// into a bespoke LA breakpoint.
const DEFAULT_WINDOW_SIZE = Object.freeze({ width: 1280, height: 820 });
const MIN_WINDOW_SIZE = Object.freeze({ width: 480, height: 600 });
const MAX_WINDOW_SIZE = Object.freeze({ width: 4096, height: 4096 });

export function resolveWindowSize(argv = process.argv) {
  const argument = argv.find((value) => value.startsWith("--window-size="));
  const match = /^--window-size=(\d+),(\d+)$/.exec(argument ?? "");
  if (!match) return DEFAULT_WINDOW_SIZE;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) return DEFAULT_WINDOW_SIZE;
  return {
    width: Math.min(MAX_WINDOW_SIZE.width, Math.max(MIN_WINDOW_SIZE.width, width)),
    height: Math.min(MAX_WINDOW_SIZE.height, Math.max(MIN_WINDOW_SIZE.height, height)),
  };
}

export function handshakeProblem(value) {
  if (!value || value.ok !== true) return "运行时没有返回有效的健康状态。";
  if (value.apiProtocolVersion !== 2) return "本机运行时协议与桌面 App 不兼容。";
  if (value.authRequired !== true) return "本机运行时未启用必需的本地认证。";
  if (value.dataSchemaVersion !== 2) return "本机运行时数据版本与桌面 App 不兼容。";
  if (typeof value.runtimeInstanceId !== "string" || !value.runtimeInstanceId.trim()) return "本机运行时缺少实例标识。";
  const available = new Set(Array.isArray(value.capabilities) ? value.capabilities : []);
  const missing = REQUIRED_CAPABILITIES.filter((capability) => !available.has(capability));
  return missing.length ? `本机运行时缺少能力：${missing.join("、")}` : null;
}

export function browserWindowOptions(preload, dark = false, size = DEFAULT_WINDOW_SIZE) {
  return {
    width: size.width,
    height: size.height,
    minWidth: MIN_WINDOW_SIZE.width,
    minHeight: MIN_WINDOW_SIZE.height,
    show: false,
    backgroundColor: dark ? "#000000" : "#ffffff",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      safeDialogs: true,
      spellcheck: true,
    },
  };
}

export function isTrustedRendererURL(actual, expected) {
  try {
    const actualURL = new URL(actual);
    const expectedURL = new URL(expected);
    actualURL.hash = "";
    expectedURL.hash = "";
    return actualURL.href === expectedURL.href;
  } catch {
    return false;
  }
}
