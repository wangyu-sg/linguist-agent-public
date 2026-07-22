/**
 * Linguist Agent — Discord channel bridge (Scratch-preset general agent).
 *
 * Makes a general linguist agent reachable from Discord. This is the "Scratch"
 * session preset surfaced over a chat channel.
 *
 * ARCHITECTURE (ecosystem-researched, not reinvented):
 * - Pi has NO native channel transport — it gives the agent (createAgentSession /
 *   session.prompt / session.subscribe), you bring the transport. Confirmed against
 *   pi.dev/docs and the local 0.76 SDK type defs.
 * - omp has no channel bridge (its "channels" are internal swarm EventBus topics).
 * - OpenClaw HAS a Discord bridge (extensions/discord/) but it is coupled to its own
 *   gateway runtime and its repo license is NOASSERTION. We therefore borrow only its
 *   chatId→sessionKey *naming scheme* (a free idea), and write our own thin bridge on
 *   Pi's public SDK + discord.js.
 *
 * sessionKey scheme (mirrors OpenClaw's deterministic keying):
 *   - DM            → la:discord:dm:<userId>          (one durable scratch session per user)
 *   - Guild channel → la:discord:channel:<channelId>  (one session per channel, parallel)
 *
 * ACTIVATION (kept inert until deliberately enabled, so it never disturbs CAT work):
 *   1. npm i discord.js
 *   2. export DISCORD_BOT_TOKEN=...   (bot needs the privileged MessageContent intent,
 *      enabled in the Discord Developer Portal)
 *   3. optional: export LA_DISCORD_ALLOW=<comma-separated user/channel ids> allowlist
 * Without the token or the dependency, the extension logs a one-line notice and no-ops.
 *
 * NOTE: this file lives in .pi/extensions/ which is intentionally OUTSIDE the repo
 * tsconfig include globs, so it does not affect `npm run typecheck` and discord.js is
 * an optional runtime-only dependency.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  createAgentSession,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";

// discord.js is an optional runtime dependency — typed loosely so this file needs no
// @types and never blocks a build when the dep is absent.
/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyClient = any;

const SCRATCH_SYSTEM = [
  "You are Linguist Agent in Scratch mode: a general game-localization assistant reachable over Discord. Establish the language pair from the request instead of assuming one.",
  "You have NO open CAT project here — do not claim to read or write project TM/TB/segments.",
  "Answer localization, terminology, and language questions directly and concisely.",
  "If the user needs real CAT work (batch import, proposals, delivery), tell them to use the Linguist Agent native macOS app or CLI workspace.",
].join("\n");

function deriveSessionKey(msg: any): string {
  // Guild text channel → per-channel session; DM → per-user session.
  if (msg.guildId && msg.channelId) return `la:discord:channel:${msg.channelId}`;
  return `la:discord:dm:${msg.author?.id ?? "unknown"}`;
}

function extractAssistantDelta(event: unknown): string {
  const e = event as { type?: string; assistantMessageEvent?: { type?: string; delta?: string } };
  if (e.type === "message_update" && e.assistantMessageEvent?.type === "text_delta") {
    return e.assistantMessageEvent.delta ?? "";
  }
  return "";
}

export default async function discordBridge(_pi: ExtensionAPI): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.warn("[discord-bridge] DISCORD_BOT_TOKEN not set — Discord scratch agent disabled.");
    return;
  }

  let Discord: any;
  try {
    Discord = await import("discord.js" as string);
  } catch {
    console.warn("[discord-bridge] discord.js not installed (`npm i discord.js`) — Discord scratch agent disabled.");
    return;
  }

  const allow = (process.env.LA_DISCORD_ALLOW ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allowed = (msg: any): boolean => {
    if (!allow.length) return true;
    return allow.includes(msg.author?.id) || allow.includes(msg.channelId) || allow.includes(msg.guildId);
  };

  const { Client, GatewayIntentBits, Partials } = Discord;
  const client: AnyClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent, // privileged — enable in Dev Portal
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
  });

  // One Pi AgentSession per derived sessionKey, created lazily (the channel/gateway pattern).
  const sessions = new Map<string, AgentSession>();
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const provider = process.env.LA_MODEL_PROVIDER ?? "deepseek";
  const modelId = process.env.LA_MODEL_ID ?? "deepseek-v4-pro";

  async function sessionFor(key: string): Promise<AgentSession> {
    const existing = sessions.get(key);
    if (existing) return existing;
    const { session } = await createAgentSession({
      authStorage,
      modelRegistry,
      model: modelRegistry.find(provider, modelId) ?? undefined,
      sessionManager: SessionManager.inMemory(process.cwd()),
      noTools: "all", // scratch = conversational; no CAT/project tools over a chat channel
      systemPromptOverride: () => SCRATCH_SYSTEM,
    } as never);
    sessions.set(key, session);
    return session;
  }

  client.on("messageCreate", async (msg: any) => {
    try {
      if (msg.author?.bot) return;
      const content: string = (msg.content ?? "").trim();
      if (!content) return;
      if (!allowed(msg)) return;

      const key = deriveSessionKey(msg);
      const session = await sessionFor(key);

      if (typeof msg.channel?.sendTyping === "function") void msg.channel.sendTyping();

      let buffer = "";
      const unsubscribe = session.subscribe((event) => {
        buffer += extractAssistantDelta(event);
      });
      await session.prompt(content);
      unsubscribe();

      const reply = buffer.trim() || "(no response)";
      // Discord hard-caps a message at 2000 chars; chunk longer replies.
      for (let i = 0; i < reply.length; i += 1900) {
        await msg.reply(reply.slice(i, i + 1900));
      }
    } catch (err) {
      console.error(`[discord-bridge] message handling failed: ${err instanceof Error ? err.message : String(err)}`);
      try {
        await msg.reply("⚠️ Linguist Agent hit an error handling that message. It has been logged.");
      } catch {
        /* reply failed too — already logged */
      }
    }
  });

  client.once("ready", (c: any) => {
    console.log(`[discord-bridge] Linguist Agent scratch agent online as ${c.user?.tag ?? "bot"}`);
  });

  await client.login(token);
}
