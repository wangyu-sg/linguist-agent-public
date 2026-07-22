export type CatStreamRuleSeverity = "warning" | "blocker";
export type CatStreamRuleAction = "observe_only" | "abort_and_retry";

export interface CatStreamRuleContext {
  sourceText?: string;
  targetLocale?: string;
  forbiddenTerms?: string[];
  requiredFragments?: string[];
}

export interface CatStreamRuleViolation {
  code: "forbidden_term" | "cjk_punctuation" | "raw_placeholder" | "missing_required_fragment";
  severity: CatStreamRuleSeverity;
  action: CatStreamRuleAction;
  message: string;
  match: string;
  offset: number;
}

export interface CatStreamRuleMonitor {
  observeDelta(delta: string): CatStreamRuleViolation[];
  finalize(): CatStreamRuleViolation[];
  currentText(): string;
}

export interface CatStreamRetryInstruction {
  reason: string;
  correctiveInstruction: string;
}

const CJK_PUNCTUATION = /[，。！？；：、]/gu;
const RAW_PLACEHOLDER = /\{\d+\}/gu;

function shouldCheckEnglishPunctuation(context: CatStreamRuleContext): boolean {
  return context.targetLocale === undefined || /^en\b/i.test(context.targetLocale);
}

function firstNewMatch(regex: RegExp, text: string, seen: Set<string>, code: CatStreamRuleViolation["code"]): RegExpExecArray | undefined {
  regex.lastIndex = 0;
  for (;;) {
    const match = regex.exec(text);
    if (!match) return undefined;
    const key = `${code}:${match.index}:${match[0]}`;
    if (!seen.has(key)) {
      seen.add(key);
      return match;
    }
  }
}

function escapedRegex(value: string): RegExp {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
}

function uniqueFragments(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function requiredFragmentsFromSource(sourceText: string | undefined): string[] {
  if (!sourceText) return [];
  return Array.from(sourceText.matchAll(/\{[^{}\s]+\}/g)).map((match) => match[0]);
}

export function createCatStreamRuleMonitor(context: CatStreamRuleContext = {}): CatStreamRuleMonitor {
  let text = "";
  const seen = new Set<string>();
  const forbidden = (context.forbiddenTerms ?? []).map((term) => term.trim()).filter(Boolean);
  const requiredFragments = uniqueFragments([...(context.requiredFragments ?? []), ...requiredFragmentsFromSource(context.sourceText)]);
  const candidateTextInspection = Boolean(context.sourceText || context.targetLocale || forbidden.length || requiredFragments.length);

  return {
    observeDelta(delta: string): CatStreamRuleViolation[] {
      if (!delta) return [];
      text += delta;
      const violations: CatStreamRuleViolation[] = [];
      if (!candidateTextInspection) return violations;

      if (shouldCheckEnglishPunctuation(context)) {
        const match = firstNewMatch(CJK_PUNCTUATION, text, seen, "cjk_punctuation");
        if (match) {
          violations.push({
            code: "cjk_punctuation",
            severity: "warning",
            action: "observe_only",
            message: "English-target stream contains CJK punctuation.",
            match: match[0],
            offset: match.index,
          });
        }
      }

      const placeholder = firstNewMatch(RAW_PLACEHOLDER, text, seen, "raw_placeholder");
      if (placeholder) {
        violations.push({
          code: "raw_placeholder",
          severity: "warning",
          action: "observe_only",
          message: "Stream contains a raw numeric placeholder; verify tag chips/signature before apply.",
          match: placeholder[0],
          offset: placeholder.index,
        });
      }

      for (const term of forbidden) {
        const termKey = `forbidden_term:${term.toLocaleLowerCase()}`;
        if (seen.has(termKey)) continue;
        const regex = escapedRegex(term);
        const match = firstNewMatch(regex, text, seen, "forbidden_term");
        if (match) {
          seen.add(termKey);
          violations.push({
            code: "forbidden_term",
            severity: "blocker",
            action: "abort_and_retry",
            message: `Stream contains forbidden term: ${term}`,
            match: match[0],
            offset: match.index,
          });
        }
      }

      return violations;
    },
    finalize(): CatStreamRuleViolation[] {
      const violations: CatStreamRuleViolation[] = [];
      for (const fragment of requiredFragments) {
        const key = `missing_required_fragment:${fragment}`;
        if (seen.has(key) || text.includes(fragment)) continue;
        seen.add(key);
        violations.push({
          code: "missing_required_fragment",
          severity: "warning",
          action: "observe_only",
          message: `Final stream is missing required source/tag fragment: ${fragment}`,
          match: fragment,
          offset: -1,
        });
      }
      return violations;
    },
    currentText() {
      return text;
    },
  };
}

export function shouldAbortForCatStreamViolation(violation: CatStreamRuleViolation): boolean {
  return violation.severity === "blocker" && violation.action === "abort_and_retry";
}

export function buildCatStreamRetryInstruction(violation: CatStreamRuleViolation): CatStreamRetryInstruction {
  if (violation.code === "forbidden_term") {
    return {
      reason: `blocked streamed forbidden term: ${violation.match}`,
      correctiveInstruction: [
        `The previous streamed answer contained the forbidden term "${violation.match}".`,
        "Abort that draft. Retry from scratch and avoid the forbidden term completely.",
        "Use current CAT evidence before proposing terminology or target text.",
      ].join(" "),
    };
  }
  if (violation.code === "missing_required_fragment") {
    return {
      reason: `observed missing source fragment in advisory chat output: ${violation.match}`,
      correctiveInstruction: [
        `The streamed answer did not repeat source/tag fragment "${violation.match}".`,
        "Treat this as an advisory chat warning. Any candidate write or proposal must still pass the deterministic CAT signature gate.",
      ].join(" "),
    };
  }
  return {
    reason: `blocked stream rule violation: ${violation.code}`,
    correctiveInstruction: [
      `The previous streamed answer violated blocker rule "${violation.code}".`,
      "Abort that draft. Retry from scratch and correct the blocker before finalizing.",
    ].join(" "),
  };
}
