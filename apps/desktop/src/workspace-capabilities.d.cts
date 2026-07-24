export type WorkspaceMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export function workspaceCapabilityFor(method: unknown, path: unknown): string | null;
export function resolveWorkspaceCapabilityRequest(value: unknown): Readonly<{
  method: WorkspaceMethod;
  path: `/api/${string}`;
  body: unknown;
}>;
