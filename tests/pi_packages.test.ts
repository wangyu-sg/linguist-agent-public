import assert from "node:assert/strict";
import {
  buildPiPackageResourceVisibility,
  buildPiPackagesCatalog,
  deletePiPackageEntry,
  togglePiPackageResource,
  upsertPiPackageEntry,
} from "../packages/cat-server/src/pi_packages.js";

let globalSettings: Record<string, unknown> = {};
let projectSettings: Record<string, unknown> = {};

globalSettings = upsertPiPackageEntry(globalSettings, { source: "npm:@scope/pkg@1.2.3" });
assert.deepEqual(globalSettings.packages, ["npm:@scope/pkg@1.2.3"]);

projectSettings = upsertPiPackageEntry(projectSettings, {
  source: "git:github.com/user/repo@v1",
  filters: {
    extensions: ["extensions/*.ts", "!extensions/legacy.ts"],
    skills: [],
    prompts: ["prompts/review.md"],
    themes: ["+themes/legacy.json"],
  },
});
assert.deepEqual(projectSettings.packages, [
  {
    source: "git:github.com/user/repo@v1",
    extensions: ["extensions/*.ts", "!extensions/legacy.ts"],
    skills: [],
    prompts: ["prompts/review.md"],
    themes: ["+themes/legacy.json"],
  },
]);

const catalog = buildPiPackagesCatalog({
  globalSettings,
  projectSettings,
  paths: { global: "/home/me/.pi/agent/settings.json", project: "/repo/.pi/settings.json" },
  configuredPackages: [
    {
      source: "npm:@scope/pkg@1.2.3",
      scope: "user",
      filtered: false,
      installedPath: "/home/me/.pi/agent/npm/@scope/pkg",
    },
  ],
  resources: buildPiPackageResourceVisibility({
    projectTrusted: true,
    defaultProjectTrust: "ask",
    skippedMissingSources: ["npm:missing", "npm:missing"],
    resolvedPaths: {
      extensions: [
        {
          path: "/repo/.pi/extensions/demo.ts",
          enabled: true,
          metadata: { source: "auto", scope: "project", origin: "top-level" },
        },
      ],
      skills: [
        {
          path: "/home/me/.pi/agent/npm/@scope/pkg/skills/review/SKILL.md",
          enabled: false,
          metadata: {
            source: "npm:@scope/pkg@1.2.3",
            scope: "user",
            origin: "package",
            baseDir: "/home/me/.pi/agent/npm/@scope/pkg",
          },
        },
      ],
      prompts: [],
      themes: [],
    },
  }),
});
assert.equal(catalog.entries.length, 2);
assert.equal(catalog.entries[0]?.sourceType, "npm");
assert.equal(catalog.entries[1]?.sourceType, "git");
assert.equal(catalog.entries[1]?.filtered, true);
assert.equal(catalog.entries[1]?.filters.skills?.length, 0);
assert.equal(catalog.configuredPackages[0]?.installedPath, "/home/me/.pi/agent/npm/@scope/pkg");
assert.equal(catalog.resources.projectTrusted, true);
assert.deepEqual(catalog.resources.skippedMissingSources, ["npm:missing"]);
assert.equal(catalog.resources.counts.extensions.enabled, 1);
assert.equal(catalog.resources.counts.skills.disabled, 1);
assert.equal(catalog.resources.entries[1]?.scope, "global");
assert.equal(catalog.resources.entries[1]?.origin, "package");

const removed = deletePiPackageEntry(projectSettings, "git:github.com/user/repo@v1");
assert.equal(removed.removed, true);
assert.deepEqual(removed.settings.packages, []);

let packageResourceSettings = togglePiPackageResource({ packages: ["npm:@scope/pkg@1.2.3"] }, {
  type: "skills",
  path: "/home/me/.pi/agent/npm/@scope/pkg/skills/review/SKILL.md",
  enabled: false,
  source: "npm:@scope/pkg@1.2.3",
  scope: "global",
  origin: "package",
  baseDir: "/home/me/.pi/agent/npm/@scope/pkg",
});
assert.deepEqual(packageResourceSettings.packages, [
  { source: "npm:@scope/pkg@1.2.3", skills: ["-skills/review/SKILL.md"] },
]);
packageResourceSettings = togglePiPackageResource(packageResourceSettings, {
  type: "skills",
  path: "/home/me/.pi/agent/npm/@scope/pkg/skills/review/SKILL.md",
  enabled: true,
  source: "npm:@scope/pkg@1.2.3",
  scope: "global",
  origin: "package",
  baseDir: "/home/me/.pi/agent/npm/@scope/pkg",
});
assert.deepEqual(packageResourceSettings.packages, [
  { source: "npm:@scope/pkg@1.2.3", skills: ["+skills/review/SKILL.md"] },
]);

const topLevelResourceSettings = togglePiPackageResource({
  skills: ["skills/legacy/SKILL.md", "-skills/review/SKILL.md"],
}, {
  type: "skills",
  path: "/repo/.pi/skills/review/SKILL.md",
  enabled: true,
  source: "auto",
  scope: "project",
  origin: "top-level",
  baseDir: "/repo/.pi",
});
assert.deepEqual(topLevelResourceSettings.skills, ["skills/legacy/SKILL.md", "+skills/review/SKILL.md"]);

assert.throws(() => upsertPiPackageEntry({}, { source: "not-a-supported-source" }), /Unsupported Pi package source/);
assert.throws(() => togglePiPackageResource({}, {
  type: "skills",
  path: "/missing/skills/review/SKILL.md",
  enabled: false,
  source: "npm:missing",
  scope: "global",
  origin: "package",
  baseDir: "/missing",
}), /No matching Pi package entry/);

console.log("pi_packages tests passed");
