import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { listCatToolMetadata, renderCatToolCatalog, type CatToolMode } from "@linguist-agent/cat-tools";

const allowedModes = new Set<CatToolMode>(["onboarding", "asset_intake", "translate", "edit", "proof", "delivery", "maintenance"]);

function parseMode(value: string): CatToolMode | undefined {
  return allowedModes.has(value as CatToolMode) ? (value as CatToolMode) : undefined;
}

export default async function (pi: ExtensionAPI) {
  pi.registerCommand("cat-status", {
    description: "Show active Linguist Agent CAT workspace status.",
    handler: async (_args, ctx) => {
      const tools = listCatToolMetadata();
      const writeTools = tools.filter((tool) => tool.access === "write" || tool.access === "import" || tool.access === "export").length;
      ctx.ui.notify(
        `Linguist Agent CAT tools are project-scoped. ${tools.length} tools are available in CAT project sessions (${writeTools} write/import/export). Use cat_tools_list there for the full safety catalog.`,
        "info",
      );
    },
  });

  pi.registerCommand("cat-tools", {
    description: "Show the Linguist Agent CAT tool safety catalog.",
    handler: async (args, ctx) => {
      const mode = parseMode(args.trim());
      const catalog = renderCatToolCatalog({
        mode,
        includeWriteTools: true,
      });
      ctx.ui.notify(catalog, "info");
    },
  });
}
