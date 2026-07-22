import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";

export type PiThemeScope = "built-in" | "global" | "project" | "settings";

export interface PiThemeInfo {
  id: string;
  name: string;
  scope: PiThemeScope;
  path?: string;
  valid: boolean;
  colorCount: number;
  missingTokens: string[];
  selected: boolean;
}

export interface PiThemesCatalog {
  docs: string;
  paths: {
    globalDir: string;
    projectDir: string;
    globalSettings: string;
    projectSettings: string;
  };
  selected: {
    global?: string;
    project?: string;
    effective: string;
    source: "default" | "global" | "project";
  };
  requiredTokens: string[];
  themes: PiThemeInfo[];
}

export interface PiThemeSaveInput {
  scope: "global" | "project";
  name?: string;
  theme: unknown;
}

export const PI_THEME_REQUIRED_COLOR_TOKENS = [
  "accent",
  "border",
  "borderAccent",
  "borderMuted",
  "success",
  "error",
  "warning",
  "muted",
  "dim",
  "text",
  "thinkingText",
  "selectedBg",
  "userMessageBg",
  "userMessageText",
  "customMessageBg",
  "customMessageText",
  "customMessageLabel",
  "toolPendingBg",
  "toolSuccessBg",
  "toolErrorBg",
  "toolTitle",
  "toolOutput",
  "mdHeading",
  "mdLink",
  "mdLinkUrl",
  "mdCode",
  "mdCodeBlock",
  "mdCodeBlockBorder",
  "mdQuote",
  "mdQuoteBorder",
  "mdHr",
  "mdListBullet",
  "toolDiffAdded",
  "toolDiffRemoved",
  "toolDiffContext",
  "syntaxComment",
  "syntaxKeyword",
  "syntaxFunction",
  "syntaxVariable",
  "syntaxString",
  "syntaxNumber",
  "syntaxType",
  "syntaxOperator",
  "syntaxPunctuation",
  "thinkingOff",
  "thinkingMinimal",
  "thinkingLow",
  "thinkingMedium",
  "thinkingHigh",
  "thinkingXhigh",
  "bashMode",
];

export async function buildPiThemesCatalog(input: {
  globalSettings: Record<string, unknown>;
  projectSettings: Record<string, unknown>;
  paths: PiThemesCatalog["paths"];
  homeDir: string;
  repoRoot: string;
}): Promise<PiThemesCatalog> {
  const selected = selectedTheme(input.globalSettings, input.projectSettings);
  const themes: PiThemeInfo[] = [
    themeInfo({ name: "dark", scope: "built-in", selected: selected.effective === "dark" }),
    themeInfo({ name: "light", scope: "built-in", selected: selected.effective === "light" }),
    ...await discoverThemeDirectory(input.paths.globalDir, "global", selected.effective),
    ...await discoverThemeDirectory(input.paths.projectDir, "project", selected.effective),
    ...await discoverThemeSettings(input.globalSettings.themes, input.homeDir, "settings", selected.effective),
    ...await discoverThemeSettings(input.projectSettings.themes, input.repoRoot, "settings", selected.effective),
  ];
  return {
    docs: "https://pi.dev/docs/latest/themes",
    paths: input.paths,
    selected,
    requiredTokens: [...PI_THEME_REQUIRED_COLOR_TOKENS],
    themes: dedupeThemes(themes),
  };
}

export function preparePiThemeDocument(input: PiThemeSaveInput): { name: string; document: Record<string, unknown> } {
  if (!input.theme || typeof input.theme !== "object" || Array.isArray(input.theme)) {
    throw new Error("Pi theme must be a JSON object.");
  }
  const document = JSON.parse(JSON.stringify(input.theme)) as Record<string, unknown>;
  const name = normalizeThemeName(input.name ?? document.name);
  document.name = name;
  validatePiThemeDocument(document);
  return { name, document };
}

export async function writePiThemeFile(input: PiThemeSaveInput & { paths: { globalDir: string; projectDir: string } }): Promise<string> {
  const { name, document } = preparePiThemeDocument(input);
  const dir = input.scope === "global" ? input.paths.globalDir : input.paths.projectDir;
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${name}.json`);
  await writeFile(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return path;
}

function selectedTheme(globalSettings: Record<string, unknown>, projectSettings: Record<string, unknown>): PiThemesCatalog["selected"] {
  const global = typeof globalSettings.theme === "string" ? globalSettings.theme : undefined;
  const project = typeof projectSettings.theme === "string" ? projectSettings.theme : undefined;
  return {
    global,
    project,
    effective: project ?? global ?? "dark",
    source: project ? "project" : global ? "global" : "default",
  };
}

async function discoverThemeDirectory(dir: string, scope: PiThemeScope, selected: string): Promise<PiThemeInfo[]> {
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const files = names.filter((name) => name.endsWith(".json")).map((name) => join(dir, name));
  return Promise.all(files.map((path) => readThemeFile(path, scope, selected)));
}

async function discoverThemeSettings(value: unknown, baseDir: string, scope: PiThemeScope, selected: string): Promise<PiThemeInfo[]> {
  if (!Array.isArray(value)) return [];
  const rows: PiThemeInfo[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) continue;
    const path = isAbsolute(item) ? item : resolve(baseDir, item);
    if (path.endsWith(".json")) {
      rows.push(await readThemeFile(path, scope, selected));
    } else {
      rows.push(...await discoverThemeDirectory(path, scope, selected));
    }
  }
  return rows;
}

async function readThemeFile(path: string, scope: PiThemeScope, selected: string): Promise<PiThemeInfo> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    const analysis = analyzeThemeDocument(parsed);
    const name = analysis.name ?? basename(path, ".json");
    return {
      id: `${scope}:${path}`,
      name,
      scope,
      path,
      valid: analysis.missingTokens.length === 0 && Boolean(analysis.name),
      colorCount: analysis.colorCount,
      missingTokens: analysis.missingTokens,
      selected: selected === name,
    };
  } catch {
    const name = basename(path, ".json");
    return {
      id: `${scope}:${path}`,
      name,
      scope,
      path,
      valid: false,
      colorCount: 0,
      missingTokens: [...PI_THEME_REQUIRED_COLOR_TOKENS],
      selected: selected === name,
    };
  }
}

function themeInfo(input: { name: string; scope: PiThemeScope; selected: boolean }): PiThemeInfo {
  return {
    id: `${input.scope}:${input.name}`,
    name: input.name,
    scope: input.scope,
    valid: true,
    colorCount: PI_THEME_REQUIRED_COLOR_TOKENS.length,
    missingTokens: [],
    selected: input.selected,
  };
}

function dedupeThemes(themes: PiThemeInfo[]): PiThemeInfo[] {
  const seen = new Set<string>();
  const out: PiThemeInfo[] = [];
  for (const theme of themes) {
    const key = `${theme.scope}:${theme.path ?? theme.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(theme);
  }
  return out;
}

function validatePiThemeDocument(theme: Record<string, unknown>): void {
  const analysis = analyzeThemeDocument(theme);
  if (!analysis.name) throw new Error("Pi theme name is required.");
  if (analysis.missingTokens.length > 0) throw new Error(`Pi theme is missing color tokens: ${analysis.missingTokens.join(", ")}`);
  const colors = theme.colors as Record<string, unknown>;
  for (const [token, value] of Object.entries(colors)) {
    validateColorValue(value, `colors.${token}`);
  }
  const vars = theme.vars;
  if (vars !== undefined) {
    if (!vars || typeof vars !== "object" || Array.isArray(vars)) throw new Error("Pi theme vars must be an object.");
    for (const [key, value] of Object.entries(vars as Record<string, unknown>)) validateColorValue(value, `vars.${key}`);
  }
  const exportColors = theme.export;
  if (exportColors !== undefined) {
    if (!exportColors || typeof exportColors !== "object" || Array.isArray(exportColors)) throw new Error("Pi theme export must be an object.");
    for (const [key, value] of Object.entries(exportColors as Record<string, unknown>)) validateColorValue(value, `export.${key}`);
  }
}

function analyzeThemeDocument(theme: unknown): { name?: string; colorCount: number; missingTokens: string[] } {
  if (!theme || typeof theme !== "object" || Array.isArray(theme)) {
    return { colorCount: 0, missingTokens: [...PI_THEME_REQUIRED_COLOR_TOKENS] };
  }
  const record = theme as Record<string, unknown>;
  const name = typeof record.name === "string" && !record.name.includes("/") ? record.name : undefined;
  const colors = record.colors && typeof record.colors === "object" && !Array.isArray(record.colors) ? record.colors as Record<string, unknown> : {};
  const missingTokens = PI_THEME_REQUIRED_COLOR_TOKENS.filter((token) => colors[token] === undefined);
  return { name, colorCount: Object.keys(colors).length, missingTokens };
}

function normalizeThemeName(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Pi theme name is required.");
  const name = value.trim();
  if (name.includes("/")) throw new Error("Pi theme name must not contain '/'.");
  if (name === "." || name === ".." || name.includes("\0")) throw new Error("Pi theme name is invalid.");
  return name.replace(/\.json$/i, "");
}

function validateColorValue(value: unknown, label: string): void {
  if (typeof value === "string") return;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255) return;
  throw new Error(`${label} must be a string color, variable reference, default color, or 0-255 palette number.`);
}
