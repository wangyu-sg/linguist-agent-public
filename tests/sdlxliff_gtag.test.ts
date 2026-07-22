import assert from "node:assert/strict";
import {
  parseSdlxliff,
  sdlxliffInlineTagSignatureFromTags,
  sdlxliffInlineTagSignatureFromText,
  writeSdlxliffTargets,
} from "@linguist-agent/cat-formats";

// H4 + M7 regression: <g> paired formatting tags must round-trip (span preserved,
// inner text translated), and a trans-unit translate="no" must lock its mrk segments.
const fixture = `<?xml version="1.0" encoding="utf-8"?>
<xliff xmlns="urn:oasis:names:tc:xliff:document:1.2" xmlns:sdl="http://sdl.com/FileTypes/SdlXliff/1.0" version="1.2">
  <sdl:doc-info><sdl:seg-defs>
    <sdl:seg id="1" conf="Translated"><sdl:value key="modified_on">old</sdl:value></sdl:seg>
    <sdl:seg id="2" conf="Translated"><sdl:value key="modified_on">old</sdl:value></sdl:seg>
  </sdl:seg-defs></sdl:doc-info>
  <file original="g.docx" source-language="zh-CN" target-language="en-US"><body>
    <trans-unit id="tu1">
      <source>aggregate</source>
      <seg-source>
        <mrk mtype="seg" mid="1"><g id="1">点击开始</g></mrk>
      </seg-source>
      <target>
        <mrk mtype="seg" mid="1"><g id="1">点击开始</g></mrk>
      </target>
    </trans-unit>
    <trans-unit id="tu2" translate="no">
      <source>aggregate2</source>
      <seg-source>
        <mrk mtype="seg" mid="2">不可翻译</mrk>
      </seg-source>
      <target>
        <mrk mtype="seg" mid="2">do not translate</mrk>
      </target>
    </trans-unit>
  </body></file>
</xliff>`;

// H4: <g> unwraps to a translatable open/close token pair, not a collapsed display value.
const batch = parseSdlxliff(fixture, { fileName: "g.sdlxliff" });
const seg1 = batch.segments.find((s) => s.id === "1");
assert.ok(seg1, "segment 1 parsed");
assert.equal(seg1.source, "{g1}点击开始{/g1}", "<g> inner text stays editable between open/close tokens");
assert.deepEqual(
  sdlxliffInlineTagSignatureFromTags(seg1.sourceTags),
  ["{g1}", "{/g1}"],
  "<g> contributes a distinct open + close signature",
);
assert.equal(seg1.locked, false);

// M7: trans-unit translate="no" locks its mrk segment.
const seg2 = batch.segments.find((s) => s.id === "2");
assert.ok(seg2, "segment 2 parsed");
assert.equal(seg2.locked, true, "translate=no must lock mrk-segmented units");

// H4: translating the inner text preserves the <g> span on export.
const result = writeSdlxliffTargets(fixture, [
  { id: "1", target: "{g1}Click Start{/g1}" },
  { id: "2", target: "should be ignored" },
]);
assert.match(result.content, /<g id="1">Click Start<\/g>/, "<g> span preserved with translated inner text");
assert.ok(result.skippedLockedIds.includes("2"), "translate=no mrk segment must be skipped on write");

// Round-trip: re-parse the emitted file; the <g> target signature matches source.
const reparsed = parseSdlxliff(result.content, { fileName: "g.sdlxliff" });
const out1 = reparsed.segments.find((s) => s.id === "1");
assert.ok(out1);
const expected = sdlxliffInlineTagSignatureFromTags(out1.sourceTags);
const actual = sdlxliffInlineTagSignatureFromText(out1.target, out1.sourceTags);
assert.deepEqual(actual, expected, "emitted <g> target signature round-trips against source");

console.log("sdlxliff_gtag tests passed");
