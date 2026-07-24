import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { APPLICATION_ROUTE_PORTS } from "../packages/cat-server/src/application_port_inventory.js";

const root = path.resolve(import.meta.dirname, "..");

assert.deepEqual(
  APPLICATION_ROUTE_PORTS.map((port) => port.id),
  ["task-run", "workflow", "settings", "package", "document"],
);

for (const port of APPLICATION_ROUTE_PORTS) {
  assert.equal(port.input, "validated route DTO");
  assert.equal(port.output, "canonical response or stream");
  assert.match(port.authority, /canonical|server-owned|writer|Task|Package|Document/i);
  assert.ok(port.routeModules.length > 0);
  assert.deepEqual(port.directDependencyDebt, [], `${port.id} must have no remaining LA-124 direct-dependency debt`);
  for (const debt of port.directDependencyDebt) {
    assert.equal(debt.removalTicket, "LA-124");
    const source = readFileSync(path.join(root, debt.routeModule), "utf8");
    assert.match(source, debt.importPattern, `${debt.routeModule} must retain the inventoried direct import until LA-124 migrates it`);
  }
}

const routeSources = {
  agentPermission: readFileSync(path.join(root, "packages/cat-server/src/routes/agent_permission_routes.ts"), "utf8"),
  task: readFileSync(path.join(root, "packages/cat-server/src/routes/task_workspace_routes.ts"), "utf8"),
  workflow: readFileSync(path.join(root, "packages/cat-server/src/routes/workflow_routes.ts"), "utf8"),
  package: readFileSync(path.join(root, "packages/cat-server/src/routes/package_center_routes.ts"), "utf8"),
  document: readFileSync(path.join(root, "packages/cat-server/src/routes/document_capability_routes.ts"), "utf8"),
};

assert.doesNotMatch(routeSources.agentPermission, /from "@linguist-agent\/cat-runtime"/u);
assert.doesNotMatch(routeSources.task, /from "@linguist-agent\/cat-runtime"/u);
assert.doesNotMatch(routeSources.workflow, /from "node:fs\/promises"|from "@linguist-agent\/cat-runtime"/u);
assert.doesNotMatch(routeSources.package, /from "node:fs\/promises"/u);
assert.doesNotMatch(routeSources.document, /from "node:fs\/promises"/u);
assert.match(routeSources.workflow, /workflowApplicationPort/u);
assert.match(routeSources.agentPermission, /settingsPermissionApplicationPort/u);
assert.match(routeSources.package, /packageArchiveApplicationPort/u);
assert.match(routeSources.document, /documentEvidenceApplicationPort/u);

process.stdout.write("application route-port inventory passed\n");
