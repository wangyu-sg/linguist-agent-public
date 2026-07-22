import {
  detectTags,
  sourceTagChipRows,
  tagCount,
  tokenizeTags,
  validateTags,
  type ProjectTagRuleContext,
} from "@linguist-agent/cat-data";

export function buildTagTokenContract(input: { text?: string; source?: string; target?: string }, ruleContext?: ProjectTagRuleContext) {
  const textValue = input.text ?? "";
  const source = input.source ?? "";
  const target = input.target ?? "";
  const validation = validateTags(source, target, ruleContext);
  return {
    text: {
      value: textValue,
      tags: detectTags(textValue, ruleContext),
      tokens: tokenizeTags(textValue, ruleContext),
      tagCount: tagCount(textValue, ruleContext),
    },
    source,
    target,
    validation: {
      ...validation,
      missingKeys: [...validation.missingKeys],
      extraKeys: [...validation.extraKeys],
    },
    sourceTagChipRows: sourceTagChipRows(source, target, ruleContext),
  };
}
