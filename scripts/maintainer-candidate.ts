import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  buildMaintenanceCandidate,
  previewMaintenance,
  type MaintenanceCandidate,
  type MaintenancePlan,
} from "../packages/cat-server/src/maintainer.ts";

type PreviewCommand = {
  command: "preview";
  repoPath: string;
  targetPiVersion: string;
  candidateRoot: string;
};

type BuildCommand = {
  command: "build";
  planPath: string;
  planHash: string;
};

export type MaintainerCandidateCommand = PreviewCommand | BuildCommand;

export type MaintainerCandidateToolDeps = {
  preview: (input: { repoPath: string; targetPiVersion: string; candidateRoot: string }) => Promise<MaintenancePlan>;
  readPlan: (path: string) => Promise<MaintenancePlan>;
  build: (input: { plan: MaintenancePlan; approvedPlanHash: string }) => Promise<MaintenanceCandidate>;
};

function required(options: Map<string, string>, name: string): string {
  const value = options.get(name);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function optionsFor(args: string[]): Map<string, string> {
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || !value || options.has(name)) throw new Error("Options must be unique --name value pairs.");
    options.set(name, value);
  }
  return options;
}

function only(options: Map<string, string>, names: string[]): void {
  for (const name of options.keys()) if (!names.includes(name)) throw new Error(`Unsupported option: ${name}.`);
}

export function parseMaintainerCandidateArgs(args: string[]): MaintainerCandidateCommand {
  const [command, ...rest] = args;
  const options = optionsFor(rest);
  if (command === "preview") {
    only(options, ["--repo", "--target-pi", "--candidate-root"]);
    return {
      command,
      repoPath: required(options, "--repo"),
      targetPiVersion: required(options, "--target-pi"),
      candidateRoot: required(options, "--candidate-root"),
    };
  }
  if (command === "build") {
    only(options, ["--plan", "--plan-hash"]);
    return {
      command,
      planPath: required(options, "--plan"),
      planHash: required(options, "--plan-hash"),
    };
  }
  throw new Error("Usage: maintainer:candidate preview --repo <git-root> --target-pi <version> --candidate-root <path> | build --plan <json> --plan-hash <sha256>");
}

const defaults: MaintainerCandidateToolDeps = {
  preview: previewMaintenance,
  readPlan: async (path) => JSON.parse(await readFile(path, "utf8")) as MaintenancePlan,
  build: buildMaintenanceCandidate,
};

export async function runMaintainerCandidate(
  args: string[],
  dependencies: MaintainerCandidateToolDeps = defaults,
): Promise<MaintenancePlan | MaintenanceCandidate> {
  const command = parseMaintainerCandidateArgs(args);
  if (command.command === "preview") {
    return dependencies.preview({
      repoPath: command.repoPath,
      targetPiVersion: command.targetPiVersion,
      candidateRoot: command.candidateRoot,
    });
  }
  const plan = await dependencies.readPlan(command.planPath);
  if (plan.planHash !== command.planHash) throw new Error("--plan-hash does not match the supplied plan.");
  return dependencies.build({ plan, approvedPlanHash: command.planHash });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMaintainerCandidate(process.argv.slice(2)).then(
    (result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`),
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
