import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { defineConfig } from 'vitest/config'

// Opt-in P working-tree override for cross-repo verification, set by
// `pnpm run check:provider` via DSH_ACP_PROVIDER_SRC. Unset by default, so
// normal runs keep resolving the pinned remote archive from node_modules.
// The manifest-driven derivation mirrors scripts/check-provider.mjs, which
// owns the same mapping for the compiler-API typecheck.
function providerSourceAlias(providerDir: string): { find: RegExp; replacement: string }[] {
  if (!isAbsolute(providerDir)) throw new Error('DSH_ACP_PROVIDER_SRC must be absolute, got: ' + providerDir)
  const manifestPath = join(providerDir, 'package.json')
  if (!existsSync(manifestPath)) throw new Error('DSH_ACP_PROVIDER_SRC is not a package directory: ' + providerDir)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: unknown; exports?: unknown }
  if (manifest.name !== '@deepseek-ai/dsh-acp-provider') {
    throw new Error('DSH_ACP_PROVIDER_SRC is not the provider package: ' + providerDir)
  }
  if (!manifest.exports || typeof manifest.exports !== 'object') {
    throw new Error('DSH_ACP_PROVIDER_SRC package.json has no exports map: ' + providerDir)
  }
  const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return Object.keys(manifest.exports)
    .filter(subpath => subpath !== './package.json')
    .map(subpath => {
      const specifier = subpath === '.' ? '@deepseek-ai/dsh-acp-provider' : '@deepseek-ai/dsh-acp-provider' + subpath.slice(1)
      const file = join(providerDir, 'src', (subpath === '.' ? 'index' : subpath.slice(2)) + '.ts')
      if (!existsSync(file)) throw new Error('declared export has no current source file: ' + subpath + ' -> ' + file)
      return { find: new RegExp('^' + escapeRegExp(specifier) + '$'), replacement: file }
    })
}

const providerDir = process.env.DSH_ACP_PROVIDER_SRC
const providerAlias = providerDir ? providerSourceAlias(providerDir) : []

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
  ...(providerAlias.length > 0 ? { resolve: { alias: providerAlias } } : {}),
})
