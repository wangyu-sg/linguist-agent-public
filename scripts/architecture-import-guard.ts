import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export interface ArchitectureImportFile {
  path: string;
  source: string;
}

export interface ArchitectureImportException {
  importer: string;
  specifier: "node:fs" | "node:fs/promises" | "@linguist-agent/cat-runtime";
  owner: string;
  reason: string;
}

/**
 * Compatibility debt is explicit, exact and short-lived: the owner must
 * remove the listed edge rather than widening a directory or glob exemption.
 */
export const architectureImportExceptions: readonly ArchitectureImportException[] = [
  {
    importer: "packages/cat-server/src/routes/maintainer_routes.ts",
    specifier: "node:fs/promises",
    owner: "LA-050",
    reason: "LA-050 owns removal of the blocked production Maintainer route rather than a second filesystem adapter.",
  },
];

const routeRoot = "packages/cat-server/src/routes/";
const applicationRoot = "packages/cat-server/src/application/";
const serverComposition = "packages/cat-server/src/server.ts";
const desktopComposition = "apps/desktop/src/main.ts";
const routeForbiddenSpecifiers = new Set<ArchitectureImportException["specifier"]>([
  "node:fs",
  "node:fs/promises",
  "@linguist-agent/cat-runtime",
]);

function repositoryPath(value: string): string {
  return value.split(path.sep).join("/");
}

function relativeImportTarget(importer: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier));
  return target.replace(/\.(?:[cm]?[jt]sx?)$/u, "") + ".ts";
}

function sourceImports(file: ArchitectureImportFile): string[] {
  const source = ts.createSourceFile(file.path, file.source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const imports: string[] = [];
  for (const statement of source.statements) {
    if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      imports.push(statement.moduleSpecifier.text);
    }
  }
  return imports;
}

function exceptionKey(importer: string, specifier: string): string {
  return `${importer}\0${specifier}`;
}

function validateExceptions(exceptions: readonly ArchitectureImportException[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const exception of exceptions) {
    const key = exceptionKey(exception.importer, exception.specifier);
    if (seen.has(key)) errors.push(`duplicate architecture exception: ${exception.importer} -> ${exception.specifier}`);
    seen.add(key);
    if (!/^LA-\d+$/u.test(exception.owner)) errors.push(`architecture exception has no exact owner: ${exception.importer} -> ${exception.specifier}`);
    if (!exception.reason.trim()) errors.push(`architecture exception has no reason: ${exception.importer} -> ${exception.specifier}`);
  }
  return errors;
}

function compositionErrors(file: ArchitectureImportFile): string[] {
  if (file.path === serverComposition) {
    const errors: string[] = [];
    for (const functionName of ["runAgentStreamingUnlocked", "compactProjectAgentSession"]) {
      if (new RegExp(`function ${functionName}\\(`, "u").test(file.source)) {
        errors.push(`${file.path}: composition root must not define ${functionName}`);
      }
    }
    return errors;
  }
  if (file.path === desktopComposition && /cat-server\/src\/server|createTaskWorkspace|createCatWorker/u.test(file.source)) {
    return [`${file.path}: desktop composition must not construct server Task/Run state or a CAT worker`];
  }
  return [];
}

export function validateArchitectureImportGraph(
  files: readonly ArchitectureImportFile[],
  exceptions: readonly ArchitectureImportException[] = architectureImportExceptions,
): string[] {
  const errors = validateExceptions(exceptions);
  const exceptionKeys = new Set(exceptions.map((exception) => exceptionKey(exception.importer, exception.specifier)));
  const usedExceptionKeys = new Set<string>();
  for (const file of files) {
    for (const specifier of sourceImports(file)) {
      const target = relativeImportTarget(file.path, specifier);
      if (file.path.startsWith(applicationRoot) && (target?.startsWith(routeRoot) || target === serverComposition)) {
        errors.push(`${file.path} -> ${specifier}: application must not depend on routes or the server composition root`);
      }
      if (file.path.startsWith(routeRoot) && routeForbiddenSpecifiers.has(specifier as ArchitectureImportException["specifier"])) {
        const key = exceptionKey(file.path, specifier);
        if (exceptionKeys.has(key)) usedExceptionKeys.add(key);
        else errors.push(`${file.path} -> ${specifier}: routes must not import ${specifier.startsWith("node:fs") ? "node:fs directly" : "@linguist-agent/cat-runtime directly"}`);
      }
    }
    errors.push(...compositionErrors(file));
  }
  for (const exception of exceptions) {
    const key = exceptionKey(exception.importer, exception.specifier);
    if (!usedExceptionKeys.has(key)) errors.push(`stale architecture exception: ${exception.importer} -> ${exception.specifier} (owner ${exception.owner})`);
  }
  return errors.sort();
}

function collectTypeScriptFiles(root: string, directory: string): ArchitectureImportFile[] {
  const absoluteDirectory = path.join(root, directory);
  const files: ArchitectureImportFile[] = [];
  for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const relativePath = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectTypeScriptFiles(root, relativePath));
    else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push({ path: relativePath, source: readFileSync(path.join(root, relativePath), "utf8") });
    }
  }
  return files;
}

export namespace validateArchitectureImportGraph {
  export function fromRepository(root: string): string[] {
    return validateArchitectureImportGraph([
      ...collectTypeScriptFiles(root, "packages/cat-server/src/application"),
      ...collectTypeScriptFiles(root, "packages/cat-server/src/routes"),
      { path: serverComposition, source: readFileSync(path.join(root, serverComposition), "utf8") },
      { path: desktopComposition, source: readFileSync(path.join(root, desktopComposition), "utf8") },
    ]);
  }
}

function runCli(): void {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const errors = validateArchitectureImportGraph.fromRepository(root);
  if (errors.length > 0) throw new Error(errors.join("\n"));
  process.stdout.write("architecture import graph passed\n");
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) runCli();
