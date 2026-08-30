import { execFileSync } from 'node:child_process'
import { delimiter, basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function withoutBunNodeShim(pathValue: string): string {
  return pathValue
    .split(delimiter)
    .filter((entry) => entry && !basename(entry).startsWith('bun-node-'))
    .join(delimiter)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const builder = resolve(import.meta.dir, '../../../node_modules/.bun/node_modules/electron-builder/out/cli/cli.js')
  execFileSync('node', [builder, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, PATH: withoutBunNodeShim(process.env.PATH ?? '') },
  })
}
