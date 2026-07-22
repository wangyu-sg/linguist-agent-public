export function canonicalLocale(value: string, label = "locale"): string {
  const normalized = value.trim().replaceAll("_", "-");
  if (!normalized) throw new Error(`${label} is required.`);
  try {
    return Intl.getCanonicalLocales(normalized)[0] ?? normalized;
  } catch {
    throw new Error(`${label} must be a valid locale tag.`);
  }
}

export function localeKey(value: string): string {
  return value.trim().replaceAll("_", "-").toLowerCase();
}

export function localesMatch(left: string, right: string): boolean {
  return localeKey(left) === localeKey(right);
}
