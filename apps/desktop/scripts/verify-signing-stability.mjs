import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packageMacApp } from "./package-macos.mjs";
import { verifyMacApp } from "./verify-macos.mjs";

const fixtureRoot = await mkdtemp(join(tmpdir(), "la-electron-signing-stability-"));
try {
  const firstApp = await packageMacApp({ outputRoot: join(fixtureRoot, "first"), buildVersion: "900001" });
  const secondApp = await packageMacApp({ outputRoot: join(fixtureRoot, "second"), buildVersion: "900002", skipBuild: true });
  const first = await verifyMacApp(firstApp);
  const second = await verifyMacApp(secondApp);
  if (first.buildVersion === second.buildVersion) throw new Error("Signing fixtures did not use distinct build versions.");
  if (first.requirement !== second.requirement) {
    throw new Error(`Designated requirement changed between packages.\nFirst: ${first.requirement}\nSecond: ${second.requirement}`);
  }
  console.log(`Stable designated requirement across builds ${first.buildVersion} and ${second.buildVersion}: ${first.requirement}`);
} finally {
  if (process.env.LA_KEEP_SIGNING_FIXTURES === "1") console.log(`Signing fixtures kept at ${fixtureRoot}`);
  else await rm(fixtureRoot, { recursive: true, force: true });
}
