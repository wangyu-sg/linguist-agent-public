const ENGLISH_MONTH_NUMBERS: Record<string, string> = {
  january: "1", february: "2", march: "3", april: "4", may: "5", june: "6",
  july: "7", august: "8", september: "9", october: "10", november: "11", december: "12",
};

function canonicalNumber(value: string): string {
  let normalized = value;
  if (/^\d{1,3}(?:,\d{3})+$/.test(normalized)) normalized = normalized.replace(/,/g, "");
  else if (/^\d+,\d{1,2}$/.test(normalized)) normalized = normalized.replace(",", ".");
  const [integer, fraction] = normalized.split(".");
  const normalizedInteger = integer.replace(/^0+(?=\d)/, "");
  if (fraction === undefined) return normalizedInteger;
  const normalizedFraction = fraction.replace(/0+$/, "");
  return normalizedFraction ? `${normalizedInteger}.${normalizedFraction}` : normalizedInteger;
}

/** Locale-tolerant semantic number multiset shared by Eval, QA, and Delivery. */
export function numberQaTokens(value: string): string[] {
  const normalized = value
    .replace(/\{\d+\}/g, "")
    .replace(/\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/gi,
      (month) => ENGLISH_MONTH_NUMBERS[month.toLowerCase()] ?? month)
    .replace(/(\d{1,2})\s*[点時时]\s*00\s*分/g, "$1")
    .replace(/\b(\d{1,2}):00\b/g, "$1");
  return Array.from(normalized.matchAll(/\d+(?:[.,]\d+)*/g))
    .map((match) => canonicalNumber(match[0]))
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
}

export function sameNumberQaMultiset(left: string, right: string): boolean {
  const source = numberQaTokens(left);
  const target = numberQaTokens(right);
  return source.length === target.length && source.every((value, index) => value === target[index]);
}
