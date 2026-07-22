import assert from "node:assert/strict";
import {
  dehydratePhraseTarget,
  extractInlineTags,
  parseMasterXliff,
  parsePhraseMxliff,
  stripInlineTags,
  writePhraseMxliffTargetsWithReport,
} from "@linguist-agent/cat-formats";

const masterFixture = `<?xml version="1.0"?>
<xliff xmlns="urn:oasis:names:tc:xliff:document:1.2" version="1.2">
  <file source-language="zh-CN" target-language="en-US">
    <body>
      <trans-unit id="1001" resname="#A#">
        <source>获得&lt;color=#ffffff&gt;30%攻击速度&lt;/color&gt;。</source>
        <target>Gain &lt;color=#ffffff&gt;30% Attack Speed&lt;/color&gt;.</target>
      </trans-unit>
      <trans-unit id="1002" resname="#B#">
        <source>重复文本</source>
        <target>Repeated Text</target>
      </trans-unit>
    </body>
  </file>
</xliff>`;

const mxliffFixture = `<?xml version="1.0"?>
<xliff xmlns="urn:oasis:names:tc:xliff:document:1.2" xmlns:m="http://www.memsource.com/mxlf/2.0" version="1.2">
  <file original="master.xliff" source-language="zh-cn" target-language="en-us">
    <body>
      <group id="1" m:para-id="1">
        <context-group>
          <context context-type="x-key">1001</context>
          <context context-type="x-key-note">Sheet: Demo!F1</context>
        </context-group>
        <trans-unit id="job:1" m:para-id="1" m:locked="false" m:confirmed="2">
          <source>获得{1}30%攻击速度{2}。</source>
          <target>Gain {1}30% Attack Speed{2}.</target>
        </trans-unit>
      </group>
      <group id="2" m:para-id="2">
        <context-group><context context-type="x-key">1002</context></context-group>
        <trans-unit id="job:2" m:para-id="2" m:locked="false">
          <source>重复文本</source><target>Repeated Text</target>
        </trans-unit>
      </group>
      <group id="3" m:para-id="3">
        <context-group><context context-type="x-key">1002</context></context-group>
        <trans-unit id="job:3" m:para-id="3" m:locked="true">
          <source>重复文本</source><target>Repeated Text</target>
        </trans-unit>
      </group>
    </body>
  </file>
</xliff>`;

{
  const master = parseMasterXliff(masterFixture);
  const batch = parsePhraseMxliff(mxliffFixture, { fileName: "sample.mxliff", master });
  assert.equal(batch.segments.length, 3);
  assert.equal(batch.sourceLanguage, "zh-cn");
  assert.equal(batch.targetLanguage, "en-us");
  assert.equal(batch.tagReport.placeholderSegments, 1);
  assert.equal(batch.tagReport.masterMatchedSegments, 3);
  assert.equal(batch.tagReport.replacedPlaceholders, 4);
  assert.equal(batch.tagReport.unresolvedPlaceholders, 0);
  assert.equal(batch.segments[0].rehydratedSource, "获得<color=#ffffff>30%攻击速度</color>。");
  assert.equal(batch.segments[0].rehydratedTarget, "Gain <color=#ffffff>30% Attack Speed</color>.");
  assert.equal(batch.segments[2].locked, true);
  assert.equal(batch.duplicateSourceGroups.length, 1);
  assert.deepEqual(batch.duplicateSourceGroups[0].segmentIds, ["job:2", "job:3"]);
}

{
  const writeResult = writePhraseMxliffTargetsWithReport(mxliffFixture, [
    {
      id: "job:1",
      target: "Gain <color=#ffffff>30% Attack Speed</color>!",
      rawSource: "获得{1}30%攻击速度{2}。",
      richSource: "获得<color=#ffffff>30%攻击速度</color>。",
    },
    {
      id: "missing-job",
      target: "Missing",
      rawSource: "Missing",
      richSource: "Missing",
    },
  ]);
  assert.deepEqual(writeResult.updatedIds, ["job:1"]);
  assert.deepEqual(writeResult.missingIds, ["missing-job"]);
  assert.match(writeResult.content, /<target>Gain \{1\}30% Attack Speed\{2\}!<\/target>/);
}

{
  const writeResult = writePhraseMxliffTargetsWithReport(mxliffFixture, [
    {
      id: "job:1",
      target: "Gain <color=#ffffff>30% Attack Speed</color>.",
      rawSource: "获得{1}30%攻击速度{2}。",
      richSource: "获得<color=#ffffff>30%攻击速度</color>。",
      targetChanged: false,
      nativeConfirmed: "3",
      modifiedAt: "1779843461052",
    },
  ]);
  assert.deepEqual(writeResult.updatedIds, ["job:1"]);
  assert.match(writeResult.content, /m:confirmed="3"/);
  assert.match(writeResult.content, /m:modified-at="1779843461052"/);
  assert.match(writeResult.content, /<target>Gain \{1\}30% Attack Speed\{2\}\.<\/target>/);
}

{
  assert.equal(stripInlineTags("按 &lt;enter&gt; 确认"), "按 <enter> 确认");
  assert.equal(stripInlineTags('点 <foo id="1"/> 继续'), "点 继续");
  assert.deepEqual(extractInlineTags("按 <enter> 确认").map((tag) => tag.raw), []);
  assert.deepEqual(extractInlineTags('点 <foo id="1"/> 继续').map((tag) => tag.raw), ['<foo id="1"/>']);
  const master = parseMasterXliff(`<?xml version="1.0"?>
  <xliff version="1.2"><file><body>
    <trans-unit id="literal-angle"><source>按 &lt;enter&gt; 确认</source></trans-unit>
  </body></file></xliff>`);
  assert.equal(master.units[0].sourcePlain, "按 <enter> 确认");
}

{
  const master = parseMasterXliff(`<?xml version="1.0"?>
  <xliff version="1.2"><file><body>
    <trans-unit id="literal-plus-tag">
      <source>按 &lt;enter&gt; 获得&lt;color=#fff&gt;奖励&lt;/color&gt;</source>
      <target>Press &lt;enter&gt; to get &lt;color=#fff&gt;Reward&lt;/color&gt;</target>
    </trans-unit>
  </body></file></xliff>`);
  const batch = parsePhraseMxliff(`<?xml version="1.0"?>
  <xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file source-language="zh-cn" target-language="en-us"><body>
    <group id="1" m:para-id="1"><context-group><context context-type="x-key">literal-plus-tag</context></context-group>
      <trans-unit id="job:literal-plus-tag" m:para-id="1">
        <source>按 &lt;enter&gt; 获得{1}奖励{2}</source>
        <target>Press &lt;enter&gt; to get {1}Reward{2}</target>
      </trans-unit>
    </group>
  </body></file></xliff>`, { fileName: "literal-plus-tag.mxliff", master });
  assert.equal(batch.tagReport.unresolvedPlaceholders, 0);
  assert.equal(batch.segments[0].rehydratedSource, "按 <enter> 获得<color=#fff>奖励</color>");
  assert.equal(batch.segments[0].rehydratedTarget, "Press <enter> to get <color=#fff>Reward</color>");
  assert.equal(
    dehydratePhraseTarget(
      "Press <enter> to get <color=#fff>Reward</color>",
      "按 <enter> 获得{1}奖励{2}",
      "按 <enter> 获得<color=#fff>奖励</color>",
    ),
    "Press &lt;enter&gt; to get {1}Reward{2}",
  );
}

{
  const master = parseMasterXliff(`<?xml version="1.0"?>
  <xliff version="1.2"><file><body>
    <trans-unit id="2001">
      <source>进入&lt;bpt id="1"&gt;&amp;lt;color=#ff0&amp;gt;&lt;/bpt&gt;战斗&lt;ept id="1"&gt;&amp;lt;/color&amp;gt;&lt;/ept&gt;</source>
    </trans-unit>
  </body></file></xliff>`);
  const batch = parsePhraseMxliff(`<?xml version="1.0"?>
  <xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file source-language="zh-cn" target-language="en-us"><body>
    <group id="1" m:para-id="1"><context-group><context context-type="x-key">2001</context></context-group>
      <trans-unit id="job:variant" m:para-id="1">
        <source>进入{1>}战斗&lt;1}</source>
        <target>Enter {1>}battle&lt;1}</target>
      </trans-unit>
    </group>
  </body></file></xliff>`, { fileName: "variant.mxliff", master });
  assert.equal(batch.tagReport.unresolvedPlaceholders, 0);
  assert.equal(
    batch.segments[0].rehydratedTarget,
    `Enter <bpt id="1">&lt;color=#ff0&gt;</bpt>battle<ept id="1">&lt;/color&gt;</ept>`,
  );
}

{
  const master = parseMasterXliff(`<?xml version="1.0"?>
  <xliff version="1.2"><file><body>
    <trans-unit id="runtime-variable">
      <source>当前阵营：{0}</source>
      <target>Current Faction: {0}</target>
    </trans-unit>
  </body></file></xliff>`);
  const batch = parsePhraseMxliff(`<?xml version="1.0"?>
  <xliff version="1.2" xmlns:m="http://www.memsource.com/mxlf/2.0"><file source-language="zh-cn" target-language="en-us"><body>
    <group id="1" m:para-id="1"><context-group><context context-type="x-key">runtime-variable</context></context-group>
      <trans-unit id="job:runtime-variable" m:para-id="1">
        <source>当前阵营：{1}</source>
        <target>Current Faction: {1}</target>
      </trans-unit>
    </group>
  </body></file></xliff>`, { fileName: "runtime-variable.mxliff", master });
  assert.equal(batch.tagReport.unresolvedPlaceholders, 2);
  assert.equal(batch.tagReport.unresolvedRuntimePlaceholders, 2);
  assert.equal(batch.tagReport.unresolvedTagPlaceholders, 0);
  assert.equal(batch.tagReport.tagCountMismatches, 0);
  assert.equal(batch.segments[0].unresolvedRuntimePlaceholderCount, 2);
  assert.equal(batch.segments[0].unresolvedTagPlaceholderCount, 0);
}

console.log("phrase_mxliff tests passed");
