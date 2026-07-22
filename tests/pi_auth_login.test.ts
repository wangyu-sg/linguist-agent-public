import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createPiAuthLoginCoordinator,
  logoutPiProviderAuth,
  validatePiAuthProviderId,
} from "../packages/cat-server/src/pi_auth_login.js";

const providersDocs = readFileSync("node_modules/@earendil-works/pi-coding-agent/docs/providers.md", "utf8");
assert.ok(providersDocs.includes("Use `/login` in interactive mode"), "providers.md documents /login");
assert.ok(providersDocs.includes("Use `/logout`"), "providers.md documents /logout");
assert.ok(providersDocs.includes("auth.json"), "providers.md documents auth.json storage");

function waitFor<T>(fn: () => T | undefined, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const result = fn();
      if (result !== undefined) {
        clearInterval(timer);
        resolve(result);
        return;
      }
      if (Date.now() - started > 1000) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for ${label}`));
      }
    }, 5);
  });
}

assert.equal(validatePiAuthProviderId("openai-codex"), "openai-codex");
assert.throws(() => validatePiAuthProviderId("../openai"), /Invalid Pi provider id/);

const loggedOut: string[] = [];
const fakeModelRuntime = {
  getProviders() {
    return [{ id: "demo-oauth", name: "Demo OAuth", auth: { oauth: {} } }];
  },
  async login(providerId: string, type: "oauth", interaction: {
    prompt: (prompt: {
      type: "text" | "secret" | "select" | "manual_code";
      message: string;
      placeholder?: string;
      options?: ReadonlyArray<{ id: string; label: string }>;
    }) => Promise<string>;
    notify: (event: unknown) => void;
  }) {
    assert.equal(providerId, "demo-oauth");
    assert.equal(type, "oauth");
    interaction.notify({ type: "auth_url", url: "https://login.example/start", instructions: "Open this URL" });
    interaction.notify({ type: "device_code", userCode: "ABCD-EFGH", verificationUri: "https://login.example/device" });
    const tenant = await interaction.prompt({ type: "text", message: "Tenant", placeholder: "workspace" });
    assert.equal(tenant, "la-team");
    const selected = await interaction.prompt({
      type: "select",
      message: "Login method",
      options: [
        { id: "browser", label: "Browser" },
        { id: "device", label: "Device code" },
      ],
    });
    assert.equal(selected, "browser");
    const manual = await interaction.prompt({
      type: "manual_code",
      message: "Paste the redirect URL or authorization code from the browser.",
    });
    assert.equal(manual, "https://localhost/callback?code=ok");
    interaction.notify({ type: "progress", message: "OAuth login complete" });
    return { type: "oauth", refresh: "refresh", access: "access", expires: Date.now() + 60_000 };
  },
  async logout(provider: string) {
    loggedOut.push(provider);
  },
};

const coordinator = createPiAuthLoginCoordinator({
  getModelRuntime: async () => fakeModelRuntime as never,
  idFactory: () => "attempt-1",
  now: () => new Date("2026-06-26T00:00:00.000Z"),
});

const started = await coordinator.start("demo-oauth");
assert.equal(started.status, "pending");
assert.equal(started.providerName, "Demo OAuth");
assert.equal(started.docs, "https://pi.dev/docs/latest/providers");
assert.equal(started.events[0].type, "auth");
assert.equal(started.events[0].url, "https://login.example/start");
assert.equal(started.events[1].type, "device_code");
assert.equal(started.events[1].userCode, "ABCD-EFGH");

const prompt = started.events.find((event) => event.type === "prompt");
assert.ok(prompt, "prompt event queued");
coordinator.answer({ attemptId: started.attemptId, eventId: prompt.id, value: "la-team" });

const select = await waitFor(
  () => coordinator.status(started.attemptId).events.find((event) => event.type === "select"),
  "select event",
);
assert.equal(select.options?.length, 2);
assert.throws(
  () => coordinator.answer({ attemptId: started.attemptId, eventId: select.id, value: "invalid" }),
  /Invalid Pi auth selection/,
);
coordinator.answer({ attemptId: started.attemptId, eventId: select.id, value: "browser" });

const manual = await waitFor(
  () => coordinator.status(started.attemptId).events.find((event) => event.type === "manual_code"),
  "manual code event",
);
coordinator.answer({ attemptId: started.attemptId, eventId: manual.id, value: "https://localhost/callback?code=ok" });

const completed = await waitFor(
  () => {
    const snapshot = coordinator.status(started.attemptId);
    return snapshot.status === "completed" ? snapshot : undefined;
  },
  "completed login",
);
assert.equal(completed.message, "Logged in to Demo OAuth. Credentials saved by Pi auth storage.");
assert.equal(completed.events.some((event) => event.message === "OAuth login complete"), true);

await assert.rejects(() => coordinator.start("missing-oauth"), /does not expose OAuth login/);

const cancelCoordinator = createPiAuthLoginCoordinator({
  getModelRuntime: async () => fakeModelRuntime as never,
  idFactory: () => "attempt-cancel",
});
const cancellable = await cancelCoordinator.start("demo-oauth");
const cancelPrompt = cancellable.events.find((event) => event.type === "prompt");
assert.ok(cancelPrompt, "cancel prompt event queued");
const cancelled = cancelCoordinator.cancel(cancellable.attemptId);
assert.equal(cancelled.status, "cancelled");
assert.equal(cancelled.message, "Pi auth login cancelled.");

const promptSignalRuntime = {
  getProviders: fakeModelRuntime.getProviders,
  async login(_providerId: string, _type: "oauth", interaction: {
    prompt: (prompt: { type: "manual_code"; message: string; signal?: AbortSignal }) => Promise<string>;
  }) {
    const controller = new AbortController();
    const pending = interaction.prompt({
      type: "manual_code",
      message: "Paste the callback URL.",
      signal: controller.signal,
    });
    controller.abort(new Error("OAuth callback completed first."));
    await assert.rejects(pending, /callback completed first/);
    return { type: "oauth", refresh: "refresh", access: "access", expires: Date.now() + 60_000 };
  },
  async logout() {},
};
const promptSignalCoordinator = createPiAuthLoginCoordinator({
  getModelRuntime: async () => promptSignalRuntime as never,
  idFactory: () => "attempt-prompt-signal",
});
const promptSignalStarted = await promptSignalCoordinator.start("demo-oauth");
const promptSignalCompleted = await waitFor(
  () => {
    const snapshot = promptSignalCoordinator.status(promptSignalStarted.attemptId);
    return snapshot.status === "completed" ? snapshot : undefined;
  },
  "prompt-signal login",
);
const cancelledPrompt = promptSignalCompleted.events.find((event) => event.type === "manual_code");
assert.equal(cancelledPrompt?.answered, true);
assert.throws(
  () => promptSignalCoordinator.answer({
    attemptId: promptSignalStarted.attemptId,
    eventId: cancelledPrompt!.id,
    value: "late answer",
  }),
  /already completed/,
);

const logout = await logoutPiProviderAuth({
  provider: "demo-oauth",
  modelRuntime: fakeModelRuntime as never,
});
assert.equal(logout.loggedOut, true);
assert.deepEqual(loggedOut, ["demo-oauth"]);

console.log("pi_auth_login tests passed");
