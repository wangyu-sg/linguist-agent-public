import { personaStatusForRunStatus, resolvePersona } from "./personas.ts";
import type { TaskAgentIdentity } from "../../../../../packages/cat-data/src/task_workspace_contract.ts";

const assert = {
  equal(actual: unknown, expected: unknown): void {
    if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
  },
  ok(value: unknown): void {
    if (!value) throw new Error("Expected value to be truthy");
  },
};

function test(name: string, run: () => void): void {
  try {
    run();
  } catch (cause) {
    throw new Error(name, { cause });
  }
}

function identity(roleId: string, overrides: Partial<TaskAgentIdentity> = {}): TaskAgentIdentity {
  return {
    kind: "specialist",
    roleId,
    displayName: roleId.replace(/_/g, " "),
    roleLabel: roleId,
    disclosureLabel: "Agent",
    ...overrides,
  };
}

test("maps every model-backed Team roleId to its persona name, title, hue, and mark", () => {
  const expected: Record<string, [string, string, string, string]> = {
    translator: ["Jules", "Translator", "translator", "swap"],
    editor: ["Noa", "Editor", "editor", "nib"],
    proofreader: ["Wren", "Proofreader", "proofreader", "lens-check"],
    lead_linguist_final: ["Auden", "Lead Linguist", "lead-final", "seal"],
    lead_linguist_setup: ["Auden", "Lead Linguist", "lead-final", "seal"],
    pre_lqa_reviewer: ["Kit", "Pre-LQA Reviewer", "pre-lqa", "scan"],
    producer: ["Marlow", "Producer", "producer", "clapper"],
    culturalization_reviewer: ["Sana", "Culturalization Reviewer", "culturalization", "globe"],
  };
  for (const [roleId, [name, title, hue, mark]] of Object.entries(expected)) {
    const persona = resolvePersona(identity(roleId));
    assert.equal(persona.personaName, name);
    assert.equal(persona.title, title);
    assert.equal(persona.hueKey, hue);
    assert.equal(persona.mark, mark);
    assert.equal(persona.deterministic, false);
    assert.ok(persona.blurb.length > 0);
  }
});

test("Setup and Final are two contracts owned by one Lead Linguist persona", () => {
  const setup = resolvePersona(identity("lead_linguist_setup"));
  const final = resolvePersona(identity("lead_linguist_final"));
  assert.equal(setup.personaName, "Auden");
  assert.equal(final.personaName, setup.personaName);
  assert.equal(final.title, "Lead Linguist");
  assert.equal(final.hueKey, setup.hueKey);
  assert.equal(final.mark, setup.mark);
});

test("deterministic Team stations stay non-human slate identities", () => {
  const engineer = resolvePersona(identity("loc_engineer_gate", { kind: "deterministic", disclosureLabel: "System" }));
  assert.equal(engineer.personaName, "Engineering Gate");
  assert.equal(engineer.title, "Deterministic System");
  assert.equal(engineer.hueKey, "slate");
  assert.equal(engineer.deterministic, true);
  assert.equal(engineer.icon, "cog");

  const delivery = resolvePersona(identity("delivery_manager", { kind: "deterministic", disclosureLabel: "System" }));
  assert.equal(delivery.personaName, "Delivery Gate");
  assert.equal(delivery.hueKey, "slate");
  assert.equal(delivery.deterministic, true);
  assert.equal(delivery.icon, "package-check");
});

test("main identities resolve to the Rowan owner persona", () => {
  for (const candidate of [
    undefined,
    null,
    identity("main", { kind: "main", displayName: "Linguist Agent", roleLabel: "Main Agent" }),
    identity("linguist-agent", { kind: "main", displayName: "Linguist Agent", roleLabel: "Main Agent" }),
  ]) {
    const persona = resolvePersona(candidate);
    assert.equal(persona.key, "main");
    assert.equal(persona.personaName, "Rowan");
    assert.equal(persona.title, "Studio Lead");
    assert.equal(persona.mark, "flag");
    assert.equal(persona.hueKey, "neutral");
  }
});

test("unknown roleIds fall back to the original displayName/roleLabel with a neutral avatar", () => {
  const persona = resolvePersona(identity("reviewer", { displayName: "LQA Reviewer", roleLabel: "语言质量审校" }));
  assert.equal(persona.personaName, "LQA Reviewer");
  assert.equal(persona.title, "语言质量审校");
  assert.equal(persona.hueKey, "neutral");
  assert.equal(persona.mark, "person");
  assert.equal(persona.deterministic, false);

  const system = resolvePersona(identity("qa_gate", { kind: "deterministic", disclosureLabel: "System", displayName: "QA Gate" }));
  assert.equal(system.personaName, "QA Gate");
  assert.equal(system.hueKey, "slate");
  assert.equal(system.deterministic, true);
});

test("run statuses map onto avatar status dots", () => {
  assert.equal(personaStatusForRunStatus("active"), "running");
  assert.equal(personaStatusForRunStatus("pending"), "running");
  assert.equal(personaStatusForRunStatus("awaiting_input"), "waiting");
  assert.equal(personaStatusForRunStatus("waiting"), "waiting");
  assert.equal(personaStatusForRunStatus("complete"), "done");
  assert.equal(personaStatusForRunStatus("failed"), "failed");
  assert.equal(personaStatusForRunStatus("stale"), "failed");
  assert.equal(personaStatusForRunStatus("stopping"), "stopped");
  assert.equal(personaStatusForRunStatus("stopped"), "stopped");
});
