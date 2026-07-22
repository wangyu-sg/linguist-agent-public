export type PiProviderOAuthRuntime = {
  getProvider?: (providerId: string) => { auth?: { oauth?: unknown } } | undefined;
  isUsingOAuth?: (providerId: string) => boolean;
};

export function piProviderUsesOAuth(
  provider: string,
  modelRuntime: PiProviderOAuthRuntime,
): boolean {
  const providerId = provider.trim();
  if (!providerId) return false;
  if (modelRuntime.getProvider?.(providerId)?.auth?.oauth) return true;
  return modelRuntime.isUsingOAuth?.(providerId) === true;
}
