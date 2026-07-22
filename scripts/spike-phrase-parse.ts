import { readPhraseMxliff } from "@linguist-agent/cat-formats";

const [mxliffPath, masterPath] = process.argv.slice(2);

if (!mxliffPath) {
  console.error("Usage: npm run phrase:spike -- <file.mxliff> [master.xliff]");
  process.exit(2);
}

const batch = await readPhraseMxliff(mxliffPath, { masterPath });

console.log(JSON.stringify({
  batchId: batch.batchId,
  fileName: batch.fileName,
  sourceLanguage: batch.sourceLanguage,
  targetLanguage: batch.targetLanguage,
  segments: batch.segments.length,
  duplicateGroups: batch.duplicateSourceGroups.length,
  tagReport: batch.tagReport,
  firstSegments: batch.segments.slice(0, 3).map((segment) => ({
    id: segment.id,
    masterId: segment.masterId,
    source: segment.rehydratedSource,
    target: segment.rehydratedTarget,
    locked: segment.locked,
  })),
}, null, 2));
