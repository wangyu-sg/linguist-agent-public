import { join } from "node:path";
import { createTmStore, type TmSeedEntry } from "./tm.js";
import { createWorkspace, type CatWorkspace } from "./workspace.js";

export const demoTmEntries: TmSeedEntry[] = [
  {
    source: "暗影徽记",
    target: "Shadow Emblem",
    srcLang: "zh-CN",
    tgtLang: "en-US",
    origin: "reviewed",
    quality: 100,
    project: "demo",
    note: "Auto chess item naming sample.",
  },
  {
    source: "勇者徽记",
    target: "Hero Emblem",
    srcLang: "zh-CN",
    tgtLang: "en-US",
    origin: "reviewed",
    quality: 100,
    project: "demo",
  },
  {
    source: "穿着这件装备的英雄转职为法师。",
    target: "When equipped, hero class changes to Mage.",
    srcLang: "zh-CN",
    tgtLang: "en-US",
    origin: "reviewed",
    quality: 100,
    project: "demo",
  },
];

export async function ensureDemoWorkspace(root = process.cwd()): Promise<CatWorkspace> {
  const workspace = createWorkspace(join(root, "tmp", "demo-workspace"), "demo");
  const store = createTmStore(workspace);
  const existing = await store.list();
  if (!existing.length) {
    await store.seed(demoTmEntries);
  }
  return workspace;
}
