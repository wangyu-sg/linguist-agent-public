export type ApplicationRoutePortId = "task-run" | "workflow" | "settings" | "package" | "document";

export interface RouteDirectDependencyDebt {
  routeModule: string;
  importPattern: RegExp;
  reason: string;
  removalTicket: "LA-124";
}

export interface ApplicationRoutePort {
  id: ApplicationRoutePortId;
  input: "validated route DTO";
  output: "canonical response or stream";
  authority: string;
  routeModules: readonly string[];
  directDependencyDebt: readonly RouteDirectDependencyDebt[];
}

/**
 * LA-124 closes the route-local filesystem/Pi debt through these ports. This
 * inventory remains a boundary record, not a second runtime dispatcher.
 */
export const APPLICATION_ROUTE_PORTS: readonly ApplicationRoutePort[] = [
  {
    id: "task-run",
    input: "validated route DTO",
    output: "canonical response or stream",
    authority: "canonical Task/Run writer and server-owned active-run registry",
    routeModules: [
      "packages/cat-server/src/routes/standalone_task_routes.ts",
      "packages/cat-server/src/routes/task_workspace_routes.ts",
      "packages/cat-server/src/routes/eval_routes.ts",
    ],
    directDependencyDebt: [],
  },
  {
    id: "workflow",
    input: "validated route DTO",
    output: "canonical response or stream",
    authority: "canonical workflow/Task writer and server-owned Team execution authority",
    routeModules: ["packages/cat-server/src/routes/workflow_routes.ts"],
    directDependencyDebt: [],
  },
  {
    id: "settings",
    input: "validated route DTO",
    output: "canonical response or stream",
    authority: "server-owned settings and permission writer contracts",
    routeModules: [
      "packages/cat-server/src/routes/agent_permission_routes.ts",
      "packages/cat-server/src/routes/pi_settings_routes.ts",
    ],
    directDependencyDebt: [],
  },
  {
    id: "package",
    input: "validated route DTO",
    output: "canonical response or stream",
    authority: "canonical Package registry writer and preview/activation authority",
    routeModules: ["packages/cat-server/src/routes/package_center_routes.ts"],
    directDependencyDebt: [],
  },
  {
    id: "document",
    input: "validated route DTO",
    output: "canonical response or stream",
    authority: "server-owned Document capability and Artifact authority",
    routeModules: ["packages/cat-server/src/routes/document_capability_routes.ts"],
    directDependencyDebt: [],
  },
];
