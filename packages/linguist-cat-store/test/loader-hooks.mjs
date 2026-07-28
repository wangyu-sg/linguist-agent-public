// ESM resolve hook for the node test runner: the workspace sources use
// extensionless relative imports (bundler-style, house convention), which
// Node ESM cannot resolve on its own. Retry with an explicit .ts suffix.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    if (err && err.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.')) {
      return nextResolve(`${specifier}.ts`, context)
    }
    throw err
  }
}
