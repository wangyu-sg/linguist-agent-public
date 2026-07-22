import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { createWorkspace } from "@linguist-agent/cat-data";
import { buildCatRequestShape, CAT_SEGMENT_RUN_TOOLS, createCatAgentSession } from "@linguist-agent/cat-runtime";
import { serverOwnedRunDisabledTools } from "../packages/cat-server/src/task_run_resources.js";

const workspace = createWorkspace(process.cwd(), "prompt-isolation-probe");
const constitution = (await readFile(".pi/APPEND_SYSTEM.md", "utf8")).trim();

const cat = await createCatAgentSession({
  workspace,
  preset: "cat",
  sessionMode: "memory",
  runtimeExtension: false,
  runOptions: {
    noSession: true,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    tools: ["read"],
  },
});

try {
  const prompt = cat.session.systemPrompt;
  assert.doesNotMatch(prompt, /expert coding assistant|Pi documentation/, "CAT sessions must not inherit Pi's coding-agent system prompt");
  assert.doesNotMatch(prompt, /## Current State/, "CAT sessions must not inherit repository AGENTS.md");
  assert.doesNotMatch(prompt, /SwiftUI|build_and_run\.sh/, "CAT translation context must not contain legacy LA development instructions");
  assert.equal(
    prompt.split(constitution).length - 1,
    1,
    "the resolved CAT prompt must contain exactly one runtime constitution",
  );
  assert.match(cat.requestShape.requestShapeHash, /^[0-9a-f]{64}$/);
  assert.equal(cat.requestShape.resourceCount, 0, "isolated CAT profile must not index repository context/resources");
} finally {
  cat.session.dispose();
}

const dev = await createCatAgentSession({
  workspace,
  preset: "dev",
  sessionMode: "memory",
  runtimeExtension: false,
  runOptions: {
    noSession: true,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
  },
});

try {
  assert.ok(dev.session.systemPrompt.length > constitution.length, "Dev sessions should retain the full Pi development prompt");
  assert.doesNotMatch(dev.session.systemPrompt, /## Runtime constitution/, "Dev sessions must not inherit CAT translation rules");
} finally {
  dev.session.dispose();
}

for (const preset of ["scratch", "eval"] as const) {
  const isolated = await createCatAgentSession({
    workspace,
    preset,
    sessionMode: "memory",
    runtimeExtension: false,
    runOptions: {
      noSession: true,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
    },
  });
  try {
    assert.doesNotMatch(isolated.session.systemPrompt, /## Current State/, `${preset} must not inherit repository context`);
    assert.doesNotMatch(isolated.session.systemPrompt, /expert coding assistant|Pi documentation/, `${preset} must not inherit Pi's coding-agent system prompt`);
    assert.deepEqual(isolated.session.getActiveToolNames(), [], `${preset} must not expose tools`);
    assert.equal(
      isolated.session.systemPrompt.split(constitution).length - 1,
      1,
      `${preset} must inherit the single runtime constitution`,
    );
  } finally {
    isolated.session.dispose();
  }
}

const segmentCat = await createCatAgentSession({
  workspace,
  preset: "cat",
  sessionMode: "memory",
  runtimeExtension: false,
  runOptions: {
    noSession: true,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    tools: [...CAT_SEGMENT_RUN_TOOLS],
  },
});
try {
  const activeTools = new Set(segmentCat.session.getActiveToolNames());
  const extensionTools = new Set(["ask_user", "document_parse", "document_search", "document_screenshot"]);
  for (const tool of CAT_SEGMENT_RUN_TOOLS) {
    if (extensionTools.has(tool)) {
      assert.ok(!activeTools.has(tool), `noExtensions segment profile must not fabricate ${tool}`);
    } else {
      assert.ok(activeTools.has(tool), `segment profile must include ${tool}`);
    }
  }
  for (const unrelated of ["tm_import_tmx", "export_xlsx"]) {
    assert.ok(!activeTools.has(unrelated), `segment profile must exclude unrelated tool ${unrelated}`);
  }
} finally {
  segmentCat.session.dispose();
}

const hostToolCat = await createCatAgentSession({
  workspace,
  preset: "cat",
  sessionMode: "memory",
  runtimeExtension: false,
  isolatedResources: {},
  serverTools: [defineTool({
    name: "prepare_team_execution",
    label: "Prepare Team",
    description: "Prepare canonical Team execution.",
    parameters: Type.Object({ reason: Type.String() }),
    async execute() {
      return { content: [{ type: "text" as const, text: "prepared" }], details: {} };
    },
  })],
  runOptions: { noSession: true, tools: ["prepare_team_execution"] },
});
try {
  assert.equal(hostToolCat.session.getActiveToolNames().includes("prepare_team_execution"), true);
  assert.equal(hostToolCat.requestShape.activeToolNames.includes("prepare_team_execution"), true);
} finally {
  hostToolCat.session.dispose();
}

const repeatedSegmentCat = await createCatAgentSession({
  workspace,
  preset: "cat",
  sessionMode: "memory",
  runtimeExtension: false,
  runOptions: {
    noSession: true,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    tools: [...CAT_SEGMENT_RUN_TOOLS],
  },
});
try {
  const first = await createCatAgentSession({
    workspace,
    preset: "cat",
    sessionMode: "memory",
    runtimeExtension: false,
    runOptions: {
      noSession: true,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      tools: [...CAT_SEGMENT_RUN_TOOLS],
    },
  });
  try {
    assert.equal(repeatedSegmentCat.session.systemPrompt, first.session.systemPrompt, "equivalent CAT builds must be byte-stable");
    assert.deepEqual(repeatedSegmentCat.session.getActiveToolNames(), first.session.getActiveToolNames());
    assert.deepEqual(repeatedSegmentCat.requestShape, first.requestShape, "equivalent CAT request manifests must be byte-stable");
    assert.notEqual(repeatedSegmentCat.requestShape.toolSurfaceHash, cat.requestShape.toolSurfaceHash);
  } finally {
    first.session.dispose();
  }
} finally {
  repeatedSegmentCat.session.dispose();
}

const visibleToolShape = {
  systemPrompt: "system",
  activeToolNames: ["lookup"],
  resources: [],
};
const firstToolShape = buildCatRequestShape({
  ...visibleToolShape,
  tools: [{ name: "lookup", description: "Lookup evidence", parameters: { type: "object" }, promptGuidelines: ["internal"] } as never],
});
const internalMetadataChanged = buildCatRequestShape({
  ...visibleToolShape,
  tools: [{ name: "lookup", description: "Lookup evidence", parameters: { type: "object" }, promptGuidelines: ["changed"], sourceInfo: { path: "/tmp" } } as never],
});
const providerDescriptionChanged = buildCatRequestShape({
  ...visibleToolShape,
  tools: [{ name: "lookup", description: "Different provider-visible description", parameters: { type: "object" } }],
});
assert.equal(firstToolShape.toolSurfaceHash, internalMetadataChanged.toolSurfaceHash);
assert.notEqual(firstToolShape.toolSurfaceHash, providerDescriptionChanged.toolSurfaceHash);

const isolatedRoot = await mkdtemp(join(tmpdir(), "la-isolated-resources-"));
const agentDir = join(isolatedRoot, "agent");
const installMarker = join(isolatedRoot, "install-marker");
const rogueMarker = join(isolatedRoot, "rogue-marker");
const npmShim = join(isolatedRoot, "npm-shim.mjs");
const rogueExtension = join(isolatedRoot, "rogue.mjs");
const boundExtension = join(isolatedRoot, "bound.mjs");
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

await mkdir(agentDir, { recursive: true });
await writeFile(npmShim, `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(installMarker)}, "called"); process.exit(1);\n`);
await writeFile(rogueExtension, `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(rogueMarker)}, "loaded"); export default () => {};\n`);
await writeFile(boundExtension, `
export default function (pi) {
  pi.on("session_start", (_event, ctx) => {
    pi.registerTool({
      name: "bound_probe",
      label: "Bound probe",
      description: "Registered only after extension binding",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      async execute() { return { content: [{ type: "text", text: "ok" }], details: {} }; },
    });
    for (const name of ["ask_user", "document_parse", "document_search", "document_screenshot"]) {
      pi.registerTool({
        name,
        label: name,
        description: "Required canonical Main Package tool",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        async execute() { return { content: [{ type: "text", text: "required" }], details: {} }; },
      });
    }
    for (const name of ["subagent", "wait", "subagent_supervisor", "intercom", "contact_supervisor"]) {
      pi.registerTool({
        name,
        label: name,
        description: "Must be excluded from canonical product Sessions",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        async execute() { return { content: [{ type: "text", text: "forbidden" }], details: {} }; },
      });
    }
    ctx.ui.notify("bound", "info");
  });
}
`);
await writeFile(join(agentDir, "settings.json"), `${JSON.stringify({
  packages: ["la-definitely-missing-package@0.0.0"],
  extensions: [rogueExtension],
  npmCommand: [process.execPath, npmShim],
}, null, 2)}\n`);

try {
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const notifications: string[] = [];
  const isolatedBound = await createCatAgentSession({
    workspace,
    preset: "cat",
    sessionMode: "memory",
    runtimeExtension: false,
    isolatedResources: { extensionPaths: [boundExtension] },
    disabledTools: serverOwnedRunDisabledTools([
      "ask_user",
      "document_parse",
      "document_search",
      "document_screenshot",
    ]),
    extensionBinding: {
      mode: "rpc",
      uiContext: {
        notify(message: string) { notifications.push(message); },
      } as ExtensionUIContext,
    },
    runOptions: { noSession: true },
  });
  try {
    assert.equal(existsSync(installMarker), false, "isolated sessions must not install configured global packages");
    assert.equal(existsSync(rogueMarker), false, "isolated sessions must not load configured global extensions");
    assert.deepEqual(notifications, ["bound"], "server-owned extension UI must bind before the session is returned");
    assert.ok(isolatedBound.session.getActiveToolNames().includes("bound_probe"));
    for (const required of ["ask_user", "document_parse", "document_search", "document_screenshot"]) {
      assert.ok(
        isolatedBound.requestShape.activeToolNames.includes(required),
        `legacy disabledTools cannot remove required Main Package tool ${required}`,
      );
    }
    assert.ok(
      isolatedBound.requestShape.activeToolNames.includes("bound_probe"),
      "request shape must be computed after session_start registers dynamic tools",
    );
    for (const forbidden of ["edit", "write", "bash", "subagent", "wait", "subagent_supervisor", "intercom", "contact_supervisor"]) {
      assert.equal(
        isolatedBound.session.getActiveToolNames().includes(forbidden),
        false,
        `${forbidden} must not create parallel CAT or specialist authority`,
      );
      assert.equal(
        isolatedBound.requestShape.activeToolNames.includes(forbidden),
        false,
        `${forbidden} must be absent from the provider-visible request shape`,
      );
    }
  } finally {
    isolatedBound.session.dispose();
  }

  await assert.rejects(
    createCatAgentSession({
      workspace,
      sessionMode: "memory",
      isolatedResources: {},
      runOptions: { additionalExtensionPaths: [rogueExtension] },
    }),
    /isolatedResources cannot be combined with runOptions additional resource paths/,
  );

  const brokenExtension = join(isolatedRoot, "broken-extension.ts");
  await writeFile(brokenExtension, "export default function broken( {\n");
  await assert.rejects(
    createCatAgentSession({
      workspace,
      preset: "cat",
      sessionMode: "memory",
      runtimeExtension: false,
      isolatedResources: { extensionPaths: [brokenExtension] },
      runOptions: { noSession: true },
    }),
    /Pi Extension loading failed:.*broken-extension/,
    "an explicitly selected Extension must fail closed instead of disappearing from the Run manifest",
  );
} finally {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(isolatedRoot, { recursive: true, force: true });
}

console.log("CAT prompt isolation tests passed");
