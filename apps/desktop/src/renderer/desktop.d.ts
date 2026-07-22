export {};

type RuntimeSummary = {
  productVersion: string;
  piVersion: string;
  protocolVersion: number | null;
};

type BootResult = {
  status: "ready" | "offline" | "incompatible" | "credential-unavailable" | "credential-rejected" | "error";
  message: string;
  baseURL: string;
  runtime?: RuntimeSummary;
};

type RuntimeInstallResult = {
  ok: boolean;
  status: "ready" | "failed";
  code: string;
  message: string;
  rollback: "available" | "restored" | "failed" | "not-needed";
};

type APIRequest = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: `/api/${string}`;
  body?: unknown;
};

type APIResponse<T = unknown> = {
  ok: boolean;
  status: number;
  data: T;
};

type StreamState = {
  status: "connected" | "reconnecting" | "closed" | "error";
  message?: string;
};

type TaskEventSubscription =
  | { kind: "standalone"; taskId: string; afterCursor?: string }
  | { kind: "project"; projectId: string; taskId: string; afterCursor?: string };

type TaskChatInput = {
  projectId: string;
  taskId: string;
  message: string;
  runId?: string;
  segmentId?: string;
  modelProvider?: string;
  modelId?: string;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  assetPaths?: string[];
  capabilityIds?: string[];
};

type StandaloneChatInput = {
  taskId: string;
  message: string;
  delivery?: "auto" | "steer" | "follow_up";
  agentThreadId?: string;
  modelProvider?: string;
  modelId?: string;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
};

type ImportKind = "batch" | "asset";
type AppCommand =
  | "new-project"
  | "import-batch"
  | "show-conversation"
  | "show-cat"
  | "show-settings"
  | "show-command-palette"
  | "toggle-sidebar"
  | "toggle-inspector"
  | "stop-run";

declare global {
  interface Window {
    linguist: Readonly<{
      runtime: Readonly<{
        status(): Promise<BootResult>;
        installOrRepair(): Promise<RuntimeInstallResult>;
        installCandidate(input: { bundleRoot: string }): Promise<RuntimeInstallResult>;
      }>;
      api: Readonly<{
        request<T = unknown>(input: APIRequest): Promise<APIResponse<T>>;
        subscribeTaskEvents(input: TaskEventSubscription, onEvent: (event: unknown) => void, onState?: (state: StreamState) => void): () => void;
        streamTaskChat(input: TaskChatInput, onEvent: (event: unknown) => void, onState?: (state: StreamState) => void): () => void;
        streamStandaloneChat(input: StandaloneChatInput, onEvent: (event: unknown) => void, onState?: (state: StreamState) => void): () => void;
      }>;
      system: Readonly<{
        pickProjectFolder(): Promise<string | null>;
        pickImportFiles(kind: ImportKind): Promise<string[]>;
        openExternal(url: string): Promise<true>;
        revealPath(path: string): Promise<true>;
        exportRichArtifact(input: {
          format: "html" | "pdf" | "png";
          html: string;
          suggestedName: string;
        }): Promise<{
          ok: true;
          canceled: boolean;
          format: "html" | "pdf" | "png";
          path?: string;
        }>;
        showNotification(candidate: {
          id: string;
          category: "waiting" | "failed" | "completed" | "permission";
          projectId: string;
          taskId: string;
          runId: string;
          occurredAt: string;
          title: string;
          body: string;
        }): Promise<boolean>;
        onNotification(listener: (candidate: unknown) => void): () => void;
        onCommand(listener: (command: AppCommand) => void): () => void;
      }>;
    }>;
  }
}
