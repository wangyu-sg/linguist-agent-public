// ESM resolve hook for the node test runner: the workspace sources use
// extensionless relative imports (bundler-style, house convention), which
// Node ESM cannot resolve on its own. Retry with an explicit .ts suffix.
// Pattern reused from packages/linguist-cat-store/test/loader-hooks.mjs.
//
// PB-034 additions (binding tests import main-process session modules):
// - directory imports ('../types') resolve to '<dir>/index.ts';
// - the bare 'electron' specifier resolves to ./electron-stub.mjs (node has
//   no mock.module; several main/lib modules statically import electron).
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    return { url: new URL('./electron-stub.mjs', import.meta.url).href, shortCircuit: true }
  }
  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    if (err && err.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.')) {
      return nextResolve(`${specifier}.ts`, context)
    }
    if (err && err.code === 'ERR_UNSUPPORTED_DIR_IMPORT' && specifier.startsWith('.')) {
      return nextResolve(`${specifier}/index.ts`, context)
    }
    throw err
  }
}
