import { createProjectManifest } from "@linguist-agent/cat-data";

const root = process.argv.slice(2).join(" ");

if (!root) {
  console.error("Usage: LA_SOURCE_LANGUAGE=ja-JP LA_TARGET_LANGUAGE=fr-FR npm run spike:onboard -- <project-folder>");
  process.exit(2);
}

const sourceLanguage = process.env.LA_SOURCE_LANGUAGE?.trim();
const targetLanguage = process.env.LA_TARGET_LANGUAGE?.trim();
if (!sourceLanguage || !targetLanguage) throw new Error("LA_SOURCE_LANGUAGE and LA_TARGET_LANGUAGE are required.");

const { manifest, path } = await createProjectManifest(process.cwd(), root, {
  projectId: process.env.LA_PROJECT_ID,
  sourceLanguage,
  targetLanguage,
});
console.log(JSON.stringify({ manifest, path }, null, 2));
