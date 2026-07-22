export interface PiKeybindingActionDefinition {
  section: string;
  id: string;
  defaultKeys: string[];
  description: string;
}

export interface PiKeybindingActionView extends PiKeybindingActionDefinition {
  known: boolean;
  userKeys?: string[];
  effectiveKeys: string[];
  customized: boolean;
}

export interface PiKeybindingSectionView {
  id: string;
  label: string;
  actionIds: string[];
}

export interface PiKeybindingConflict {
  key: string;
  actionIds: string[];
}

export interface PiKeybindingsCatalog {
  docs: string;
  path: string;
  reloadHint: string;
  keyFormat: {
    modifiers: string[];
    special: string[];
    functions: string[];
    symbols: string[];
  };
  sections: PiKeybindingSectionView[];
  actions: PiKeybindingActionView[];
  conflicts: PiKeybindingConflict[];
  raw: Record<string, string | string[]>;
}

export const PI_KEYBINDING_ACTIONS: PiKeybindingActionDefinition[] = [
  { section: "TUI Editor Cursor Movement", id: "tui.editor.cursorUp", defaultKeys: ["up"], description: "Move cursor up" },
  { section: "TUI Editor Cursor Movement", id: "tui.editor.cursorDown", defaultKeys: ["down"], description: "Move cursor down" },
  { section: "TUI Editor Cursor Movement", id: "tui.editor.cursorLeft", defaultKeys: ["left", "ctrl+b"], description: "Move cursor left" },
  { section: "TUI Editor Cursor Movement", id: "tui.editor.cursorRight", defaultKeys: ["right", "ctrl+f"], description: "Move cursor right" },
  { section: "TUI Editor Cursor Movement", id: "tui.editor.cursorWordLeft", defaultKeys: ["alt+left", "ctrl+left", "alt+b"], description: "Move cursor word left" },
  { section: "TUI Editor Cursor Movement", id: "tui.editor.cursorWordRight", defaultKeys: ["alt+right", "ctrl+right", "alt+f"], description: "Move cursor word right" },
  { section: "TUI Editor Cursor Movement", id: "tui.editor.cursorLineStart", defaultKeys: ["home", "ctrl+a"], description: "Move to line start" },
  { section: "TUI Editor Cursor Movement", id: "tui.editor.cursorLineEnd", defaultKeys: ["end", "ctrl+e"], description: "Move to line end" },
  { section: "TUI Editor Cursor Movement", id: "tui.editor.jumpForward", defaultKeys: ["ctrl+]"], description: "Jump forward to character" },
  { section: "TUI Editor Cursor Movement", id: "tui.editor.jumpBackward", defaultKeys: ["ctrl+alt+]"], description: "Jump backward to character" },
  { section: "TUI Editor Cursor Movement", id: "tui.editor.pageUp", defaultKeys: ["pageUp"], description: "Scroll up by page" },
  { section: "TUI Editor Cursor Movement", id: "tui.editor.pageDown", defaultKeys: ["pageDown"], description: "Scroll down by page" },
  { section: "TUI Editor Deletion", id: "tui.editor.deleteCharBackward", defaultKeys: ["backspace"], description: "Delete character backward" },
  { section: "TUI Editor Deletion", id: "tui.editor.deleteCharForward", defaultKeys: ["delete", "ctrl+d"], description: "Delete character forward" },
  { section: "TUI Editor Deletion", id: "tui.editor.deleteWordBackward", defaultKeys: ["ctrl+w", "alt+backspace"], description: "Delete word backward" },
  { section: "TUI Editor Deletion", id: "tui.editor.deleteWordForward", defaultKeys: ["alt+d", "alt+delete"], description: "Delete word forward" },
  { section: "TUI Editor Deletion", id: "tui.editor.deleteToLineStart", defaultKeys: ["ctrl+u"], description: "Delete to line start" },
  { section: "TUI Editor Deletion", id: "tui.editor.deleteToLineEnd", defaultKeys: ["ctrl+k"], description: "Delete to line end" },
  { section: "TUI Input", id: "tui.input.newLine", defaultKeys: ["shift+enter", "ctrl+j"], description: "Insert new line" },
  { section: "TUI Input", id: "tui.input.submit", defaultKeys: ["enter"], description: "Submit input" },
  { section: "TUI Input", id: "tui.input.tab", defaultKeys: ["tab"], description: "Tab / autocomplete" },
  { section: "TUI Kill Ring", id: "tui.editor.yank", defaultKeys: ["ctrl+y"], description: "Paste most recently deleted text" },
  { section: "TUI Kill Ring", id: "tui.editor.yankPop", defaultKeys: ["alt+y"], description: "Cycle through deleted text after yank" },
  { section: "TUI Kill Ring", id: "tui.editor.undo", defaultKeys: ["ctrl+-"], description: "Undo last edit" },
  { section: "TUI Clipboard and Selection", id: "tui.input.copy", defaultKeys: ["ctrl+c"], description: "Copy selection" },
  { section: "TUI Clipboard and Selection", id: "tui.select.up", defaultKeys: ["up"], description: "Move selection up" },
  { section: "TUI Clipboard and Selection", id: "tui.select.down", defaultKeys: ["down"], description: "Move selection down" },
  { section: "TUI Clipboard and Selection", id: "tui.select.pageUp", defaultKeys: ["pageUp"], description: "Page up in list" },
  { section: "TUI Clipboard and Selection", id: "tui.select.pageDown", defaultKeys: ["pageDown"], description: "Page down in list" },
  { section: "TUI Clipboard and Selection", id: "tui.select.confirm", defaultKeys: ["enter"], description: "Confirm selection" },
  { section: "TUI Clipboard and Selection", id: "tui.select.cancel", defaultKeys: ["escape", "ctrl+c"], description: "Cancel selection" },
  { section: "Application", id: "app.interrupt", defaultKeys: ["escape"], description: "Cancel / abort" },
  { section: "Application", id: "app.clear", defaultKeys: ["ctrl+c"], description: "Clear editor" },
  { section: "Application", id: "app.exit", defaultKeys: ["ctrl+d"], description: "Exit when editor empty" },
  { section: "Application", id: "app.suspend", defaultKeys: ["ctrl+z"], description: "Suspend to background; no default on native Windows" },
  { section: "Application", id: "app.editor.external", defaultKeys: ["ctrl+g"], description: "Open in external editor" },
  { section: "Application", id: "app.clipboard.pasteImage", defaultKeys: ["ctrl+v"], description: "Paste image from clipboard; alt+v on Windows" },
  { section: "Sessions", id: "app.session.new", defaultKeys: [], description: "Start a new session (/new)" },
  { section: "Sessions", id: "app.session.tree", defaultKeys: [], description: "Open session tree navigator (/tree)" },
  { section: "Sessions", id: "app.session.fork", defaultKeys: [], description: "Fork current session (/fork)" },
  { section: "Sessions", id: "app.session.resume", defaultKeys: [], description: "Open session resume picker (/resume)" },
  { section: "Sessions", id: "app.session.togglePath", defaultKeys: ["ctrl+p"], description: "Toggle path display" },
  { section: "Sessions", id: "app.session.toggleSort", defaultKeys: ["ctrl+s"], description: "Toggle sort mode" },
  { section: "Sessions", id: "app.session.toggleNamedFilter", defaultKeys: ["ctrl+n"], description: "Toggle named-only filter" },
  { section: "Sessions", id: "app.session.rename", defaultKeys: ["ctrl+r"], description: "Rename session" },
  { section: "Sessions", id: "app.session.delete", defaultKeys: ["ctrl+d"], description: "Delete session" },
  { section: "Sessions", id: "app.session.deleteNoninvasive", defaultKeys: ["ctrl+backspace"], description: "Delete session when query is empty" },
  { section: "Models and Thinking", id: "app.model.select", defaultKeys: ["ctrl+l"], description: "Open model selector" },
  { section: "Models and Thinking", id: "app.model.cycleForward", defaultKeys: ["ctrl+p"], description: "Cycle to next model" },
  { section: "Models and Thinking", id: "app.model.cycleBackward", defaultKeys: ["shift+ctrl+p"], description: "Cycle to previous model" },
  { section: "Models and Thinking", id: "app.thinking.cycle", defaultKeys: ["shift+tab"], description: "Cycle thinking level" },
  { section: "Models and Thinking", id: "app.thinking.toggle", defaultKeys: ["ctrl+t"], description: "Collapse or expand thinking blocks" },
  { section: "Display and Message Queue", id: "app.tools.expand", defaultKeys: ["ctrl+o"], description: "Collapse or expand tool output" },
  { section: "Display and Message Queue", id: "app.message.copy", defaultKeys: ["ctrl+x"], description: "Copy the last assistant message, or the selected message in /tree" },
  { section: "Display and Message Queue", id: "app.message.followUp", defaultKeys: ["alt+enter"], description: "Queue follow-up message" },
  { section: "Display and Message Queue", id: "app.message.dequeue", defaultKeys: ["alt+up"], description: "Restore queued messages to editor" },
  { section: "Tree Navigation", id: "app.tree.foldOrUp", defaultKeys: ["ctrl+left", "alt+left"], description: "Fold current branch segment or jump to previous segment start" },
  { section: "Tree Navigation", id: "app.tree.unfoldOrDown", defaultKeys: ["ctrl+right", "alt+right"], description: "Unfold current branch segment or jump to next segment start or branch end" },
  { section: "Tree Navigation", id: "app.tree.editLabel", defaultKeys: ["shift+l"], description: "Edit the label on the selected tree node" },
  { section: "Tree Navigation", id: "app.tree.toggleLabelTimestamp", defaultKeys: ["shift+t"], description: "Toggle label timestamps in the tree" },
  { section: "Tree Navigation", id: "app.tree.filter.default", defaultKeys: ["ctrl+d"], description: "Set tree filter to default view" },
  { section: "Tree Navigation", id: "app.tree.filter.noTools", defaultKeys: ["ctrl+t"], description: "Toggle tree filter that hides tool results" },
  { section: "Tree Navigation", id: "app.tree.filter.userOnly", defaultKeys: ["ctrl+u"], description: "Toggle tree filter that shows only user messages" },
  { section: "Tree Navigation", id: "app.tree.filter.labeledOnly", defaultKeys: ["ctrl+l"], description: "Toggle tree filter that shows only labeled entries" },
  { section: "Tree Navigation", id: "app.tree.filter.all", defaultKeys: ["ctrl+a"], description: "Toggle tree filter that shows all entries" },
  { section: "Tree Navigation", id: "app.tree.filter.cycleForward", defaultKeys: ["ctrl+o"], description: "Cycle tree filter forward" },
  { section: "Tree Navigation", id: "app.tree.filter.cycleBackward", defaultKeys: ["shift+ctrl+o"], description: "Cycle tree filter backward" },
  { section: "Scoped Models Selector", id: "app.models.save", defaultKeys: ["ctrl+s"], description: "Save current model selection to settings" },
  { section: "Scoped Models Selector", id: "app.models.enableAll", defaultKeys: ["ctrl+a"], description: "Enable all models or all matching the current search" },
  { section: "Scoped Models Selector", id: "app.models.clearAll", defaultKeys: ["ctrl+x"], description: "Clear all models or all matching the current search" },
  { section: "Scoped Models Selector", id: "app.models.toggleProvider", defaultKeys: ["ctrl+p"], description: "Toggle all models for the current provider" },
  { section: "Scoped Models Selector", id: "app.models.reorderUp", defaultKeys: ["alt+up"], description: "Move the selected model up in the cycle order" },
  { section: "Scoped Models Selector", id: "app.models.reorderDown", defaultKeys: ["alt+down"], description: "Move the selected model down in the cycle order" },
];

const MODIFIER_ORDER = ["ctrl", "shift", "alt"];
const SPECIAL_KEYS = ["escape", "esc", "enter", "return", "tab", "space", "backspace", "delete", "insert", "clear", "home", "end", "pageUp", "pageDown", "up", "down", "left", "right"];
const FUNCTION_KEYS = Array.from({ length: 12 }, (_, index) => `f${index + 1}`);
const SYMBOL_KEYS = ["`", "-", "=", "[", "]", "\\", ";", "'", ",", ".", "/", "!", "@", "#", "$", "%", "^", "&", "*", "(", ")", "_", "+", "|", "~", "{", "}", ":", "<", ">", "?"];

export function normalizePiKeybindingKeys(value: unknown): string[] {
  const raw = typeof value === "string" ? [value] : Array.isArray(value) ? value : undefined;
  if (!raw) throw new Error("Pi keybinding value must be a string or string array.");
  const normalized = raw.map((key) => {
    if (typeof key !== "string") throw new Error("Pi keybinding entries must be strings.");
    return normalizePiKeyCombo(key);
  });
  return Array.from(new Set(normalized));
}

export function buildPiKeybindingsCatalog(input: {
  keybindingsPath: string;
  keybindings: Record<string, unknown>;
}): PiKeybindingsCatalog {
  const raw = normalizeKeybindingsRecord(input.keybindings);
  const knownIds = new Set(PI_KEYBINDING_ACTIONS.map((action) => action.id));
  const actions: PiKeybindingActionView[] = PI_KEYBINDING_ACTIONS.map((action) => actionView(action, raw[action.id]));
  for (const id of Object.keys(raw).filter((id) => !knownIds.has(id)).sort()) {
    actions.push(actionView({ section: "Custom / Extension Actions", id, defaultKeys: [], description: "User-defined or extension-provided keybinding action" }, raw[id], false));
  }
  return {
    docs: "https://pi.dev/docs/latest/keybindings",
    path: input.keybindingsPath,
    reloadHint: "Run /reload in Pi to apply keybindings without restarting the session.",
    keyFormat: {
      modifiers: [...MODIFIER_ORDER],
      special: [...SPECIAL_KEYS],
      functions: [...FUNCTION_KEYS],
      symbols: [...SYMBOL_KEYS],
    },
    sections: sectionsFor(actions),
    actions,
    conflicts: conflictsFor(actions),
    raw,
  };
}

export function upsertPiKeybindingAction(
  keybindings: Record<string, unknown>,
  input: { id: unknown; keys?: unknown; unset?: boolean },
): Record<string, string | string[]> {
  const id = normalizeActionId(input.id);
  const next = normalizeKeybindingsRecord(keybindings);
  if (input.unset === true) {
    delete next[id];
    return next;
  }
  const keys = normalizePiKeybindingKeys(input.keys);
  next[id] = keys.length === 1 ? keys[0] : keys;
  return next;
}

function normalizeKeybindingsRecord(keybindings: Record<string, unknown>): Record<string, string | string[]> {
  const next: Record<string, string | string[]> = {};
  for (const [rawId, rawKeys] of Object.entries(keybindings)) {
    const id = normalizeActionId(rawId);
    const keys = normalizePiKeybindingKeys(rawKeys);
    next[id] = keys.length === 1 ? keys[0] : keys;
  }
  return next;
}

function normalizeActionId(id: unknown): string {
  if (typeof id !== "string" || !id.trim()) throw new Error("Pi keybinding action id is required.");
  return id.trim();
}

function actionView(definition: PiKeybindingActionDefinition, rawKeys: string | string[] | undefined, known = true): PiKeybindingActionView {
  const userKeys = rawKeys === undefined ? undefined : normalizePiKeybindingKeys(rawKeys);
  return {
    ...definition,
    known,
    userKeys,
    effectiveKeys: userKeys ?? definition.defaultKeys,
    customized: userKeys !== undefined,
  };
}

function sectionsFor(actions: PiKeybindingActionView[]): PiKeybindingSectionView[] {
  const sections = new Map<string, string[]>();
  for (const action of actions) {
    sections.set(action.section, [...(sections.get(action.section) ?? []), action.id]);
  }
  return [...sections.entries()].map(([label, actionIds]) => ({
    id: label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""),
    label,
    actionIds,
  }));
}

function conflictsFor(actions: PiKeybindingActionView[]): PiKeybindingConflict[] {
  const byKey = new Map<string, PiKeybindingActionView[]>();
  for (const action of actions) {
    for (const key of action.effectiveKeys) {
      byKey.set(key, [...(byKey.get(key) ?? []), action]);
    }
  }
  return [...byKey.entries()]
    .filter(([, rows]) => rows.length > 1 && rows.some((row) => row.customized))
    .map(([key, rows]) => ({ key, actionIds: rows.map((row) => row.id) }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function normalizePiKeyCombo(combo: string): string {
  const trimmed = combo.trim();
  if (!trimmed) throw new Error("Pi keybinding key cannot be empty.");
  const { modifiers, key } = splitCombo(trimmed);
  const uniqueModifiers = Array.from(new Set(modifiers.map((modifier) => modifier.toLowerCase())));
  for (const modifier of uniqueModifiers) {
    if (!MODIFIER_ORDER.includes(modifier)) throw new Error(`Unsupported Pi keybinding modifier: ${modifier}`);
  }
  if (uniqueModifiers.length !== modifiers.length) throw new Error(`Duplicate Pi keybinding modifier in ${combo}.`);
  const normalizedKey = normalizeBaseKey(key);
  const sortedModifiers = MODIFIER_ORDER.filter((modifier) => uniqueModifiers.includes(modifier));
  return [...sortedModifiers, normalizedKey].join("+");
}

function splitCombo(combo: string): { modifiers: string[]; key: string } {
  if (combo === "+") return { modifiers: [], key: "+" };
  const parts = combo.split("+");
  if (combo.endsWith("+") && parts.length > 2) {
    return { modifiers: parts.slice(0, -2), key: "+" };
  }
  if (parts.length === 1) return { modifiers: [], key: parts[0] ?? combo };
  return { modifiers: parts.slice(0, -1), key: parts.at(-1) ?? "" };
}

function normalizeBaseKey(key: string): string {
  const trimmed = key.trim();
  if (/^[a-z]$/i.test(trimmed)) return trimmed.toLowerCase();
  if (/^[0-9]$/.test(trimmed)) return trimmed;
  if (/^f([1-9]|1[0-2])$/i.test(trimmed)) return trimmed.toLowerCase();
  const lower = trimmed.toLowerCase();
  if (lower === "pageup") return "pageUp";
  if (lower === "pagedown") return "pageDown";
  const special = SPECIAL_KEYS.find((candidate) => candidate.toLowerCase() === lower);
  if (special) return special;
  if (SYMBOL_KEYS.includes(trimmed)) return trimmed;
  throw new Error(`Unsupported Pi keybinding key: ${key}`);
}
