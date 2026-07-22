import { strict as assert } from "node:assert";
import {
  createLocalAssetVectorRecords,
  createLocalE5Embedder,
  inspectLocalEmbeddingPack,
  normalizeVector,
} from "@linguist-agent/cat-data";

const fixtures = [
  {
    id: "thunder-term",
    text: "Terminology rule: translate 闪电伤害 as Thunder Damage. Do not use Lightning Damage in this project.",
    queries: ["闪电伤害应该怎么翻译", "preferred English term for lightning damage", "雷电属性的项目术语", "how do we localize 闪电伤害"],
  },
  {
    id: "cloud-save",
    text: "Feature note: Cloud Save synchronizes save data between devices after the player signs in.",
    queries: ["云存档如何跨设备同步", "what happens to save data after sign-in", "Cloud Save feature behavior", "玩家登录后的存档同步"],
  },
  {
    id: "formal-tone",
    text: "UI style: system notices use a polite, concise, and formal tone. Avoid slang and jokes.",
    queries: ["系统通知应该用什么语气", "formal tone for interface notices", "UI文案是否可以用俚语", "style rule for polite concise messages"],
  },
  {
    id: "placeholder",
    text: "Engineering constraint: preserve the %1$s placeholder exactly and never translate or reorder it without evidence.",
    queries: ["%1$s 占位符怎么处理", "placeholder preservation rule", "can the numbered string token be translated", "工程变量是否允许改顺序"],
  },
  {
    id: "warden-name",
    text: "Character naming: 铁卫 is the hero Iron Warden. Keep this proper name consistent in dialogue and menus.",
    queries: ["铁卫的英文角色名", "English name of the armored guardian hero", "how should 铁卫 appear in menus", "Iron Warden naming rule"],
  },
  {
    id: "blood-culture",
    text: "Culturalization rule for the youth edition: replace visible blood references with sparks, without changing combat meaning.",
    queries: ["青少年版本如何处理血液表现", "replace blood with sparks", "youth edition culturalization for combat effects", "战斗含义不变的审查规则"],
  },
  {
    id: "rarity-colors",
    text: "Item rarity mapping: Common is gray, Rare is blue, Epic is purple, and Legendary is orange.",
    queries: ["史诗稀有度是什么颜色", "color assigned to Legendary items", "item rarity color mapping", "稀有物品的蓝色等级"],
  },
  {
    id: "controller-buttons",
    text: "Platform copy: on PlayStation use Cross and Circle; on Xbox use A and B. Never call Cross the X button.",
    queries: ["PlayStation 的确认键叫什么", "Xbox A and B terminology", "should Cross be called the X button", "主机手柄按键命名规则"],
  },
  {
    id: "date-format",
    text: "Locale format for Singapore English: dates use DD MMM YYYY, for example 20 Jul 2026.",
    queries: ["新加坡英语日期格式", "how to write 20 July 2026", "DD MMM YYYY locale requirement", "日期年月日的项目顺序"],
  },
  {
    id: "neutral-player",
    text: "Inclusive language: refer to the player with singular they in English when gender is unknown.",
    queries: ["玩家性别未知时用什么代词", "gender-neutral English pronoun for the player", "singular they style guidance", "避免假设玩家性别"],
  },
  {
    id: "line-limit",
    text: "Subtitle constraint: each subtitle line may contain at most 42 visible characters, excluding markup tags.",
    queries: ["字幕每行最多多少字符", "42 character subtitle limit", "do markup tags count toward line length", "字幕可见字符限制"],
  },
  {
    id: "rating-language",
    text: "Age-rating rule: replace strong profanity with mild language in the Teen-rated build.",
    queries: ["Teen 版本如何处理脏话", "age rating rule for strong profanity", "replace harsh swearing with mild language", "青少年评级语言限制"],
  },
  {
    id: "quest-caps",
    text: "Quest titles use Title Case in English, while objective descriptions use sentence case.",
    queries: ["英文任务标题大小写", "capitalization for objective descriptions", "Title Case quest naming rule", "任务目标使用句首大写吗"],
  },
  {
    id: "pronunciation",
    text: "Voice direction: pronounce Aetherion as ee-THEER-ee-on, with stress on the second syllable.",
    queries: ["Aetherion 怎么发音", "which syllable is stressed in the fantasy name", "voice pronunciation ee-THEER-ee-on", "配音演员的专名读音"],
  },
  {
    id: "tagline",
    text: "Approved marketing tagline: Forge Your Legend. Keep the imperative energy and do not add punctuation.",
    queries: ["批准的英文营销口号", "Forge Your Legend punctuation rule", "marketing tagline imperative tone", "宣传标语是否加标点"],
  },
] as const;

assert.equal(fixtures.flatMap((fixture) => fixture.queries).length, 60, "the multilingual RAG fixture must remain exactly 60 fixed queries");

const runtimeRoot = process.cwd();
const pack = await inspectLocalEmbeddingPack(runtimeRoot);
if (pack.state !== "ready") {
  if (process.env.LA_REQUIRE_LOCAL_E5_EVAL === "1") throw new Error(pack.message ?? `multilingual E5 pack is ${pack.state}`);
  console.log(`asset_rag_multilingual_eval skipped: managed E5 pack is ${pack.state}; set LA_REQUIRE_LOCAL_E5_EVAL=1 for the acceptance gate`);
  process.exit(0);
}

const embedder = await createLocalE5Embedder(runtimeRoot);
const blocks = fixtures.map((fixture) => ({ blockId: fixture.id, text: fixture.text }));
const { records } = await createLocalAssetVectorRecords(blocks, embedder, 16);
const bestDocumentVectors = new Map<string, number[]>();
for (const record of records) bestDocumentVectors.set(record.blockId, record.vector);

const queries = fixtures.flatMap((fixture) => fixture.queries.map((query) => ({ expected: fixture.id, query })));
const queryVectors = await embedder.embed(queries.map(({ query }) => `query: ${query}`));

function cosine(left: number[], right: number[]): number {
  const a = normalizeVector(left);
  const b = normalizeVector(right);
  return a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0);
}

let recallAt5 = 0;
let reciprocalRankAt10 = 0;
const misses: Array<{ query: string; expected: string; rank: number }> = [];
for (const [index, row] of queries.entries()) {
  const ranked = [...bestDocumentVectors.entries()]
    .map(([id, vector]) => ({ id, score: cosine(queryVectors[index] ?? [], vector) }))
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  const rank = ranked.findIndex((candidate) => candidate.id === row.expected) + 1;
  if (rank > 0 && rank <= 5) recallAt5 += 1;
  if (rank > 0 && rank <= 10) reciprocalRankAt10 += 1 / rank;
  if (rank <= 0 || rank > 5) misses.push({ ...row, rank });
}

const recall = recallAt5 / queries.length;
const mrr = reciprocalRankAt10 / queries.length;
assert.ok(recall >= 0.90, `Recall@5 ${recall.toFixed(4)} is below 0.90; misses=${JSON.stringify(misses)}`);
assert.ok(mrr >= 0.75, `MRR@10 ${mrr.toFixed(4)} is below 0.75; misses=${JSON.stringify(misses)}`);
console.log(`asset_rag_multilingual_eval passed: queries=${queries.length} Recall@5=${recall.toFixed(4)} MRR@10=${mrr.toFixed(4)} model=${embedder.model}`);
