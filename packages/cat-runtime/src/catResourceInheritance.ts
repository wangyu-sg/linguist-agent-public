import type { Extension, LoadExtensionsResult } from "@earendil-works/pi-coding-agent";

function isProjectCatToolsExtension(extension: Extension): boolean {
  const path = (extension.resolvedPath || extension.path).replaceAll("\\", "/");
  return /\/\.pi\/extensions\/cat-tools\.(ts|js|mts|mjs|cts|cjs)$/.test(path);
}

function conflictToolName(error: string): string | undefined {
  return error.match(/^Tool "([^"]+)" conflicts with /)?.[1];
}

export function applyCatSessionExtensionsOverride(base: LoadExtensionsResult): LoadExtensionsResult {
  const droppedPaths = new Set<string>();
  const duplicateToolNames = new Set<string>();
  const seenToolNames = new Set<string>();
  const extensions: Extension[] = [];

  for (const extension of base.extensions) {
    if (isProjectCatToolsExtension(extension)) {
      droppedPaths.add(extension.path);
      droppedPaths.add(extension.resolvedPath);
      for (const toolName of extension.tools.keys()) duplicateToolNames.add(toolName);
      continue;
    }

    let tools = extension.tools;
    for (const toolName of extension.tools.keys()) {
      if (seenToolNames.has(toolName)) {
        if (tools === extension.tools) tools = new Map(extension.tools);
        tools.delete(toolName);
        duplicateToolNames.add(toolName);
        continue;
      }
      seenToolNames.add(toolName);
    }
    extensions.push(tools === extension.tools ? extension : { ...extension, tools });
  }

  const errors = base.errors.filter((entry) => {
    if (droppedPaths.has(entry.path)) return false;
    const duplicate = conflictToolName(entry.error);
    return !duplicate || !duplicateToolNames.has(duplicate);
  });

  return {
    ...base,
    extensions,
    errors,
  };
}
