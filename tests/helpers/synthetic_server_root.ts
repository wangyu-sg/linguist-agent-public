import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface SyntheticServerRoot {
  root: string;
  piAgentDir: string;
  cleanup(): Promise<void>;
}

/**
 * A minimal logical server root for HTTP integration fixtures. The source
 * code still comes from the checkout; only data/configuration resolution is
 * redirected to this disposable root by the explicit test-only server mode.
 */
export async function createSyntheticServerRoot(): Promise<SyntheticServerRoot> {
  const root = await mkdtemp(join(tmpdir(), "la-server-root-"));
  const piRoot = join(root, ".pi");
  const runtimePackageRoot = join(root, "packages", "cat-runtime");
  const piAgentDir = join(root, "pi-agent");
  await mkdir(join(piRoot, "skills"), { recursive: true });
  await mkdir(join(piRoot, "prompts"), { recursive: true });
  await mkdir(runtimePackageRoot, { recursive: true });
  await mkdir(piAgentDir, { recursive: true });
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: "linguist-agent-synthetic-server-root",
    version: "2.32.7",
    dependencies: {
      "@earendil-works/pi-coding-agent": "0.80.10",
      "@earendil-works/pi-ai": "0.80.10",
    },
  }, null, 2)}\n`, "utf8");
  await writeFile(join(runtimePackageRoot, "package.json"), `${JSON.stringify({
    name: "@linguist-agent/cat-runtime",
    version: "2.32.7",
    dependencies: {
      "@earendil-works/pi-coding-agent": "0.80.10",
      "@earendil-works/pi-ai": "0.80.10",
    },
  }, null, 2)}\n`, "utf8");
  await writeFile(join(piRoot, "settings.json"), "{}\n", "utf8");
  return {
    root,
    piAgentDir,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
