import { acquireDataRootWriterLease } from "../../packages/cat-server/src/data_root_writer_lease.js";

const runtimeRoot = process.argv[2];
const mode = process.argv[3];
if (!runtimeRoot || !mode) throw new Error("runtimeRoot and mode are required");

try {
  const lease = await acquireDataRootWriterLease(runtimeRoot, { productVersion: "test-child" });
  if (mode === "hold") {
    process.send?.({ kind: "acquired", nonce: lease.owner.nonce });
    await new Promise<void>((resolve) => process.once("message", () => resolve()));
  }
  await lease.release();
  process.exit(0);
} catch (error) {
  process.send?.({ kind: "error", message: error instanceof Error ? error.message : String(error) });
  process.exit(2);
}
