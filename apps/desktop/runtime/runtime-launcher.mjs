import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const runtimeRoot = dirname(fileURLToPath(import.meta.url));
process.chdir(runtimeRoot);
await import(pathToFileURL(join(runtimeRoot, "packages", "cat-server", "src", "server.js")).href);
