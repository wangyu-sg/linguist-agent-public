// Registers the extensionless-import resolver for the node test runner.
// Used only by this package's `test` script (node --test); bun never loads it.
import { register } from 'node:module'
register('./loader-hooks.mjs', import.meta.url)
