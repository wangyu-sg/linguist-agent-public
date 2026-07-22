import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import nspell from "nspell";
import wordListPath from "word-list";
import { localeKey } from "./locale.js";

const DICTIONARY_ID = "dictionary-en";
const DICTIONARY_VERSION = "4.0.0";
const DICTIONARY_LOCALE = "en-US";
const SUPPLEMENT_ID = "word-list";
const SUPPLEMENT_VERSION = "4.1.0";
const DOMAIN_DICTIONARY_ID = "la-game-localization";
const DOMAIN_DICTIONARY_VERSION = "1";
const DICTIONARY_DIRECTORY = dirname(createRequire(import.meta.url).resolve("dictionary-en"));
const SUPPORTED_LOCALES = new Set(["en", "en-us"]);
const GAME_LOCALIZATION_WORDS = new Set(`
  aggro aimbot aoe buff cooldown craftable cutscene dbno debuff deathmatch despawn dispellable dps
  equippable f2p fps gacha gameplay glhf hitbox hitpoint hitpoints hitscan hotbar hp iap jrpg leyline
  lod lv mana matchmaking metagame minimap mmo mmorpg moba mp navmesh nerf noob npc permadeath
  playstyle prefill proc pve pvp questline quickslot ragequit respawn rng roguelike rpg sidequest
  speedrun ui unequippable unlockable untradeable ux vr xp
`.trim().split(/\s+/));

export type SpellingQaCoverage = {
  status: "checked";
  requestedLocale: string;
  dictionaryId: string;
  dictionaryVersion: string;
  dictionaryLocale: string;
  supplementId: string;
  supplementVersion: string;
  domainDictionaryId: string;
  domainDictionaryVersion: string;
  checkedWordCount: number;
  unknownWordCount: number;
} | {
  status: "unsupported";
  requestedLocale?: string;
  checkedWordCount: 0;
  unknownWordCount: 0;
  reason: "missing_target_locale" | "unsupported_target_locale";
};

export interface SpellingQaIssue {
  segmentId: string;
  word: string;
  message: string;
  evidence: string[];
}

export interface SpellingQaResult {
  coverage: SpellingQaCoverage;
  issues: SpellingQaIssue[];
}

export interface SpellingQaSegment {
  id: string;
  target: string;
  locked?: boolean;
}

export function describeSpellingQaCoverage(coverage?: SpellingQaCoverage): string {
  if (!coverage) return "Spelling: unavailable · historical report without coverage metadata";
  if (coverage.status === "unsupported") {
    return `Spelling: unsupported${coverage.requestedLocale ? ` · ${coverage.requestedLocale}` : ""} · ${coverage.reason ?? "unknown_reason"}`;
  }
  return `Spelling: checked ${coverage.checkedWordCount} word(s), ${coverage.unknownWordCount} unknown · ${coverage.dictionaryLocale} · ${coverage.dictionaryId}@${coverage.dictionaryVersion} + ${coverage.supplementId}@${coverage.supplementVersion} + ${coverage.domainDictionaryId}@${coverage.domainDictionaryVersion}`;
}

let checker: ReturnType<typeof nspell> | undefined;
let supplementalWords: Set<string> | undefined;

function englishChecker(): ReturnType<typeof nspell> {
  checker ??= nspell({
    aff: readFileSync(join(DICTIONARY_DIRECTORY, "index.aff")),
    dic: readFileSync(join(DICTIONARY_DIRECTORY, "index.dic")),
  });
  return checker;
}

function englishSupplement(): Set<string> {
  supplementalWords ??= new Set(readFileSync(wordListPath, "utf8").split("\n"));
  return supplementalWords;
}

function words(value: string): string[] {
  const visibleText = value
    .replace(/<([A-Za-z][\w-]*)\^([\s\S]*?)\^\1>/g, "$2")
    .replace(/https?:\/\/[^\s)]+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, " ")
    .replace(/(?:[A-Za-z0-9._-]+[\\/])+[A-Za-z0-9._-]+|\b[A-Za-z0-9_-]+\.[A-Za-z0-9]{1,8}\b/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:#\d+|#x[\da-f]+|[a-z][a-z0-9]+);/gi, " ")
    .replace(/\[\/?[A-Za-z][A-Za-z0-9_-]*(?:=[^\]]*)?\]/g, " ")
    .replace(/\{\{[^{}]*}}|\$\{[^{}]*}|\{\/?[A-Za-z_][\w.:-]*}|\{\d+}|%(?:\d+\$)?[-+#0]*\d*(?:\.\d+)?[A-Za-z]/g, " ")
    .replace(/\\[A-Za-z]/g, " ")
    .replace(/\b[\p{L}\p{N}_-]*[\p{N}_][\p{L}\p{N}_-]*\b/gu, " ");
  return Array.from(visibleText.matchAll(/\p{Script=Latin}+(?:['’]\p{Script=Latin}+)*/gu), (match) => match[0].replaceAll("’", "'"));
}

function baseWord(value: string): string {
  return value.toLocaleLowerCase().replace(/'s$/u, "");
}

export function checkSpelling(
  segments: readonly SpellingQaSegment[],
  targetLocale?: string,
  allowedTerms: readonly string[] = [],
): SpellingQaResult {
  const requestedLocale = targetLocale?.trim() || undefined;
  if (!requestedLocale) {
    return {
      coverage: { status: "unsupported", checkedWordCount: 0, unknownWordCount: 0, reason: "missing_target_locale" },
      issues: [],
    };
  }
  if (!SUPPORTED_LOCALES.has(localeKey(requestedLocale))) {
    return {
      coverage: { status: "unsupported", requestedLocale, checkedWordCount: 0, unknownWordCount: 0, reason: "unsupported_target_locale" },
      issues: [],
    };
  }

  const allowed = new Set(allowedTerms.flatMap(words).map(baseWord));
  const spell = englishChecker();
  const supplement = englishSupplement();
  const issues: SpellingQaIssue[] = [];
  let checkedWordCount = 0;
  for (const segment of segments) {
    if (segment.locked || !segment.target.trim()) continue;
    const unknown = new Map<string, string>();
    for (const word of words(segment.target)) {
      checkedWordCount += 1;
      const normalized = baseWord(word);
      if (!normalized || allowed.has(normalized) || GAME_LOCALIZATION_WORDS.has(normalized) || supplement.has(normalized) || spell.correct(word) || spell.correct(normalized)) continue;
      unknown.set(normalized, word);
    }
    for (const word of unknown.values()) {
      issues.push({
        segmentId: segment.id,
        word,
        message: `Target contains a word not found in the ${DICTIONARY_LOCALE} spelling dictionary: "${word}".`,
        evidence: [
          `word:${word}`,
          `dictionary:${DICTIONARY_ID}@${DICTIONARY_VERSION}`,
          `supplement:${SUPPLEMENT_ID}@${SUPPLEMENT_VERSION}`,
          `domain:${DOMAIN_DICTIONARY_ID}@${DOMAIN_DICTIONARY_VERSION}`,
          `locale:${DICTIONARY_LOCALE}`,
        ],
      });
    }
  }
  return {
    coverage: {
      status: "checked",
      requestedLocale,
      dictionaryId: DICTIONARY_ID,
      dictionaryVersion: DICTIONARY_VERSION,
      dictionaryLocale: DICTIONARY_LOCALE,
      supplementId: SUPPLEMENT_ID,
      supplementVersion: SUPPLEMENT_VERSION,
      domainDictionaryId: DOMAIN_DICTIONARY_ID,
      domainDictionaryVersion: DOMAIN_DICTIONARY_VERSION,
      checkedWordCount,
      unknownWordCount: issues.length,
    },
    issues,
  };
}
