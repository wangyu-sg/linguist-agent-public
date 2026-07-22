import { randomUUID } from "node:crypto";
import type { AuthEvent, AuthInteraction, AuthPrompt } from "@earendil-works/pi-ai";
import { getPiModelRuntime } from "./pi_model_runtime.js";

type PiAuthLoginStatus = "pending" | "completed" | "failed" | "cancelled";
type PiAuthLoginEventType = "auth" | "device_code" | "prompt" | "select" | "manual_code" | "progress";

type PiAuthProviderLike = {
  id: string;
  name: string;
  auth: { oauth?: unknown };
};

type PiModelRuntimeLike = {
  getProviders(): readonly PiAuthProviderLike[];
  login(providerId: string, type: "oauth", interaction: AuthInteraction): Promise<unknown>;
  logout(provider: string): Promise<void>;
};

export type PiAuthLoginEvent = {
  id: string;
  type: PiAuthLoginEventType;
  createdAt: string;
  answered?: boolean;
  url?: string;
  instructions?: string;
  userCode?: string;
  verificationUri?: string;
  intervalSeconds?: number;
  expiresInSeconds?: number;
  message?: string;
  placeholder?: string;
  allowEmpty?: boolean;
  options?: Array<{ id: string; label: string }>;
};

export type PiAuthLoginSnapshot = {
  docs: string;
  attemptId: string;
  provider: string;
  providerName: string;
  authType: "oauth";
  status: PiAuthLoginStatus;
  createdAt: string;
  updatedAt: string;
  message?: string;
  events: PiAuthLoginEvent[];
};

type PendingAnswer = {
  type: "prompt" | "select" | "manual_code";
  resolve: (value: string | undefined) => void;
  reject: (error: Error) => void;
  allowEmpty?: boolean;
  options?: Set<string>;
  cleanup?: () => void;
};

type PiAuthLoginAttempt = {
  attemptId: string;
  provider: string;
  providerName: string;
  authType: "oauth";
  status: PiAuthLoginStatus;
  createdAt: string;
  updatedAt: string;
  message?: string;
  events: PiAuthLoginEvent[];
  pending: Map<string, PendingAnswer>;
  controller: AbortController;
  eventCounter: number;
};

export type PiAuthLoginCoordinatorOptions = {
  getModelRuntime?: () => Promise<PiModelRuntimeLike>;
  idFactory?: () => string;
  now?: () => Date;
};

const AUTH_DOCS_URL = "https://pi.dev/docs/latest/providers";
const PROVIDER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export function validatePiAuthProviderId(provider: string): string {
  const trimmed = provider.trim();
  if (!trimmed) throw new Error("provider is required.");
  if (!PROVIDER_ID_RE.test(trimmed)) throw new Error(`Invalid Pi provider id: ${provider}`);
  return trimmed;
}

export class PiAuthLoginCoordinator {
  private readonly attempts = new Map<string, PiAuthLoginAttempt>();
  private readonly getModelRuntime: () => Promise<PiModelRuntimeLike>;
  private readonly idFactory: () => string;
  private readonly now: () => Date;

  constructor(options: PiAuthLoginCoordinatorOptions = {}) {
    this.getModelRuntime = options.getModelRuntime ?? getPiModelRuntime;
    this.idFactory = options.idFactory ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  async start(providerInput: string): Promise<PiAuthLoginSnapshot> {
    const provider = validatePiAuthProviderId(providerInput);
    const modelRuntime = await this.getModelRuntime();
    const oauthProviders = modelRuntime.getProviders().filter((item) => item.auth.oauth);
    const providerInfo = oauthProviders.find((item) => item.id === provider);
    if (!providerInfo) {
      const knownProviders = oauthProviders.map((item) => item.id).sort().join(", ");
      throw new Error(`Pi provider "${provider}" does not expose OAuth login in this Pi version. Available OAuth providers: ${knownProviders || "none"}.`);
    }

    const now = this.timestamp();
    const attempt: PiAuthLoginAttempt = {
      attemptId: this.idFactory(),
      provider,
      providerName: providerInfo.name || provider,
      authType: "oauth",
      status: "pending",
      createdAt: now,
      updatedAt: now,
      events: [],
      pending: new Map(),
      controller: new AbortController(),
      eventCounter: 0,
    };
    this.attempts.set(attempt.attemptId, attempt);
    void this.runLogin(attempt, modelRuntime);
    return this.snapshot(attempt);
  }

  status(attemptId: string): PiAuthLoginSnapshot {
    return this.snapshot(this.requireAttempt(attemptId));
  }

  answer(input: { attemptId: string; eventId: string; value?: string }): PiAuthLoginSnapshot {
    const attempt = this.requireAttempt(input.attemptId);
    if (attempt.status !== "pending") throw new Error(`Pi auth login is already ${attempt.status}.`);
    const pending = attempt.pending.get(input.eventId);
    if (!pending) throw new Error(`No pending Pi auth prompt for event ${input.eventId}.`);

    const raw = typeof input.value === "string" ? input.value : "";
    const value = raw.trim();
    if (pending.type === "select") {
      if (!pending.options?.has(value)) throw new Error(`Invalid Pi auth selection: ${value}`);
    } else {
      if (!value && !pending.allowEmpty) throw new Error("Pi auth prompt response cannot be empty.");
    }
    pending.cleanup?.();
    attempt.pending.delete(input.eventId);
    pending.resolve(value);
    const event = attempt.events.find((item) => item.id === input.eventId);
    if (event) event.answered = true;
    this.touch(attempt);
    return this.snapshot(attempt);
  }

  cancel(attemptId: string): PiAuthLoginSnapshot {
    const attempt = this.requireAttempt(attemptId);
    if (attempt.status === "pending") {
      attempt.status = "cancelled";
      attempt.message = "Pi auth login cancelled.";
      attempt.controller.abort();
      for (const pending of attempt.pending.values()) {
        pending.cleanup?.();
        pending.reject(new Error("Login cancelled"));
      }
      attempt.pending.clear();
      this.touch(attempt);
    }
    return this.snapshot(attempt);
  }

  private async runLogin(attempt: PiAuthLoginAttempt, modelRuntime: PiModelRuntimeLike): Promise<void> {
    try {
      await modelRuntime.login(attempt.provider, "oauth", {
        signal: attempt.controller.signal,
        prompt: (prompt) => this.handlePrompt(attempt, prompt),
        notify: (event) => this.handleAuthEvent(attempt, event),
      });
      if (attempt.status === "cancelled") return;
      attempt.status = "completed";
      attempt.message = `Logged in to ${attempt.providerName}. Credentials saved by Pi auth storage.`;
      this.touch(attempt);
    } catch (error) {
      if (attempt.status === "cancelled") return;
      attempt.status = "failed";
      attempt.message = error instanceof Error ? error.message : String(error);
      this.touch(attempt);
    }
  }

  private handlePrompt(attempt: PiAuthLoginAttempt, prompt: AuthPrompt): Promise<string> {
    if (prompt.type === "select") {
      return this.waitForAnswer(attempt, {
        type: "select",
        message: prompt.message,
        options: prompt.options.map(({ id, label }) => ({ id, label })),
      }, prompt.signal) as Promise<string>;
    }
    if (prompt.type === "manual_code") {
      return this.waitForAnswer(attempt, {
        type: "manual_code",
        message: prompt.message,
        placeholder: prompt.placeholder,
      }, prompt.signal) as Promise<string>;
    }
    return this.waitForAnswer(attempt, {
      type: "prompt",
      message: prompt.message,
      placeholder: prompt.placeholder,
      allowEmpty: false,
    }, prompt.signal) as Promise<string>;
  }

  private handleAuthEvent(attempt: PiAuthLoginAttempt, event: AuthEvent): void {
    if (event.type === "auth_url") {
      this.addEvent(attempt, { type: "auth", url: event.url, instructions: event.instructions });
      return;
    }
    if (event.type === "device_code") {
      this.addEvent(attempt, {
        type: "device_code",
        userCode: event.userCode,
        verificationUri: event.verificationUri,
        intervalSeconds: event.intervalSeconds,
        expiresInSeconds: event.expiresInSeconds,
      });
      this.addEvent(attempt, { type: "progress", message: "Waiting for authentication..." });
      return;
    }
    this.addEvent(attempt, { type: "progress", message: event.message });
  }

  private waitForAnswer(
    attempt: PiAuthLoginAttempt,
    event: Omit<PiAuthLoginEvent, "id" | "createdAt" | "answered">,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    const fullEvent = this.addEvent(attempt, { ...event, answered: false });
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        const pending = attempt.pending.get(fullEvent.id);
        if (!pending) return;
        pending.cleanup?.();
        attempt.pending.delete(fullEvent.id);
        fullEvent.answered = true;
        this.touch(attempt);
        pending.reject(signal?.reason instanceof Error ? signal.reason : new Error("Pi auth prompt cancelled."));
      };
      const pending: PendingAnswer = {
        type: fullEvent.type as PendingAnswer["type"],
        resolve,
        reject,
        allowEmpty: fullEvent.allowEmpty,
        options: fullEvent.options ? new Set(fullEvent.options.map((option) => option.id)) : undefined,
        cleanup: signal ? () => signal.removeEventListener("abort", onAbort) : undefined,
      };
      attempt.pending.set(fullEvent.id, pending);
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private addEvent(attempt: PiAuthLoginAttempt, event: Omit<PiAuthLoginEvent, "id" | "createdAt">): PiAuthLoginEvent {
    attempt.eventCounter += 1;
    const fullEvent: PiAuthLoginEvent = {
      id: `${attempt.attemptId}:${attempt.eventCounter}`,
      createdAt: this.timestamp(),
      ...event,
    };
    attempt.events.push(fullEvent);
    this.touch(attempt);
    return fullEvent;
  }

  private requireAttempt(attemptId: string): PiAuthLoginAttempt {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) throw new Error(`Unknown Pi auth login attempt: ${attemptId}`);
    return attempt;
  }

  private snapshot(attempt: PiAuthLoginAttempt): PiAuthLoginSnapshot {
    return {
      docs: AUTH_DOCS_URL,
      attemptId: attempt.attemptId,
      provider: attempt.provider,
      providerName: attempt.providerName,
      authType: attempt.authType,
      status: attempt.status,
      createdAt: attempt.createdAt,
      updatedAt: attempt.updatedAt,
      message: attempt.message,
      events: attempt.events.map((event) => ({ ...event, options: event.options?.map((option) => ({ ...option })) })),
    };
  }

  private touch(attempt: PiAuthLoginAttempt): void {
    attempt.updatedAt = this.timestamp();
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

export function createPiAuthLoginCoordinator(options: PiAuthLoginCoordinatorOptions = {}): PiAuthLoginCoordinator {
  return new PiAuthLoginCoordinator(options);
}

export async function logoutPiProviderAuth(input: {
  provider: string;
  modelRuntime?: PiModelRuntimeLike;
}): Promise<{ docs: string; provider: string; loggedOut: true; message: string }> {
  const provider = validatePiAuthProviderId(input.provider);
  const modelRuntime = input.modelRuntime ?? await getPiModelRuntime();
  await modelRuntime.logout(provider);
  return {
    docs: AUTH_DOCS_URL,
    provider,
    loggedOut: true,
    message: `Removed Pi auth entry for ${provider}. Environment variables and models.json config are unchanged.`,
  };
}
