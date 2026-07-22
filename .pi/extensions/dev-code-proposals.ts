/**
 * Linguist Agent — Dev preset: self-modification via code-proposals.
 *
 * In "Dev" mode the agent edits LA's OWN source, but every edit/write is captured as a
 * reviewable *code-proposal* instead of being applied directly — mirroring LA's CAT
 * proposal/apply gate, one layer up (the agent proposes code changes; a human approves).
 *
 * ARCHITECTURE (ecosystem-researched, native-backed — no new framework):
 * - Pi's `tool_call` hook fires BEFORE a tool runs and can `{ block: true }` + read the
 *   mutable `event.input` (docs/extensions.md). We intercept `edit`/`write`, block the
 *   real mutation, and record the intended change.
 * - This is the same propose→stage→accept→apply shape omp uses for `ast_edit`, and the
 *   plan-mode example extension's review-gate pattern. Reuses LA's existing
 *   proposal/apply mental model with kind:"code".
 * - On approval we REPLAY the captured edit (read→replace old→new / write content) for
 *   real — no separate diff engine needed; the input IS the patch.
 *
 * ACTIVATION (inert by default so it never intercepts normal agent edits):
 *   export LA_DEV_PROPOSALS=1
 * Then in a session whose cwd is the LA repo, the agent's edit/write calls are queued.
 * Review with `/code-proposals`; apply all approved with `/apply-code-proposals`.
 *
 * Lives in .pi/extensions/ (outside the repo tsconfig include globs) so it does not
 * affect `npm run typecheck`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

interface CodeProposal {
  id: string;
  tool: "edit" | "write";
  path: string;
  oldString?: string;
  newString?: string;
  content?: string;
  capturedAt: string;
  status: "proposed" | "applied" | "rejected";
}

const LEDGER_REL = join("data", "dev_code_proposals.jsonl");

function ledgerPath(cwd: string): string {
  return join(cwd, LEDGER_REL);
}

async function readLedger(cwd: string): Promise<CodeProposal[]> {
  try {
    const raw = await readFile(ledgerPath(cwd), "utf8");
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as CodeProposal);
  } catch {
    return [];
  }
}

// The ledger is append-only; the latest record per id wins (apply/reject append a new row).
function latestById(rows: CodeProposal[]): CodeProposal[] {
  const map = new Map<string, CodeProposal>();
  for (const row of rows) map.set(row.id, row);
  return [...map.values()];
}

async function appendLedger(cwd: string, row: CodeProposal): Promise<void> {
  const path = ledgerPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(row)}\n`, "utf8");
}

async function applyProposal(cwd: string, p: CodeProposal): Promise<void> {
  const abs = resolve(cwd, p.path);
  if (p.tool === "write") {
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, p.content ?? "", "utf8");
    return;
  }
  // edit: read → replace the (unique) old_string with new_string → write
  const current = await readFile(abs, "utf8");
  if (p.oldString != null && !current.includes(p.oldString)) {
    throw new Error(`edit target text not found in ${p.path} (file changed since proposal ${p.id})`);
  }
  const next = p.oldString != null ? current.replace(p.oldString, p.newString ?? "") : current;
  await writeFile(abs, next, "utf8");
}

export default function devCodeProposals(pi: ExtensionAPI): void {
  if (process.env.LA_DEV_PROPOSALS !== "1") return;
  const cwd = process.cwd();
  let counter = 0;

  pi.on("tool_call", (event) => {
    const id = `code_${Date.now().toString(36)}_${counter++}`;
    if (isToolCallEventType("edit", event)) {
      const input = event.input as { path?: string; old_string?: string; new_string?: string };
      void appendLedger(cwd, {
        id,
        tool: "edit",
        path: input.path ?? "",
        oldString: input.old_string,
        newString: input.new_string,
        capturedAt: new Date().toISOString(),
        status: "proposed",
      });
      return { block: true, reason: `Dev mode: edit to ${input.path} queued as code-proposal ${id} (review with /code-proposals).` };
    }
    if (isToolCallEventType("write", event)) {
      const input = event.input as { path?: string; content?: string };
      void appendLedger(cwd, {
        id,
        tool: "write",
        path: input.path ?? "",
        content: input.content,
        capturedAt: new Date().toISOString(),
        status: "proposed",
      });
      return { block: true, reason: `Dev mode: write to ${input.path} queued as code-proposal ${id} (review with /code-proposals).` };
    }
    return undefined;
  });

  pi.registerCommand("code-proposals", {
    description: "List pending Dev-mode code-proposals (agent edits to LA's own source).",
    handler: async (_args, ctx) => {
      const pending = latestById(await readLedger(cwd)).filter((p) => p.status === "proposed");
      if (!pending.length) {
        ctx.ui.notify("No pending code-proposals.", "info");
        return;
      }
      ctx.ui.notify(
        [`${pending.length} pending code-proposal(s):`, ...pending.map((p) => `  ${p.id} · ${p.tool} ${p.path}`)].join("\n"),
        "info",
      );
    },
  });

  pi.registerCommand("apply-code-proposals", {
    description: "Apply all pending Dev-mode code-proposals to LA's source (review first with /code-proposals).",
    handler: async (_args, ctx) => {
      const pending = latestById(await readLedger(cwd)).filter((p) => p.status === "proposed");
      if (!pending.length) {
        ctx.ui.notify("No pending code-proposals to apply.", "info");
        return;
      }
      const ok = await ctx.ui.confirm("Apply code-proposals?", `Apply ${pending.length} edit(s) to LA source now?`);
      if (!ok) return;
      let applied = 0;
      for (const p of pending) {
        try {
          await applyProposal(cwd, p);
          await appendLedger(cwd, { ...p, status: "applied" });
          applied += 1;
        } catch (err) {
          ctx.ui.notify(`code-proposal ${p.id} failed: ${err instanceof Error ? err.message : String(err)}`, "error");
        }
      }
      ctx.ui.notify(`Applied ${applied}/${pending.length} code-proposal(s). Restart the runtime for source changes to take effect.`, "info");
    },
  });
}
