/** CLI contract checks for scripts/check-provider.mjs (never runs live/model smokes). */
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const script = join(import.meta.dirname, '..', 'scripts', 'check-provider.mjs')
const providerPackage = '@deepseek-ai/dsh-acp-provider'

interface RunResult { code: number; stdout: string; stderr: string }

function runScript(args: readonly string[]): Promise<RunResult> {
  return new Promise((resolvePromise, reject) => {
    execFile(process.execPath, [script, ...args], (error, stdout, stderr) => {
      if (error && typeof error.code !== 'number') {
        reject(error)
        return
      }
      resolvePromise({ code: typeof error?.code === 'number' ? error.code : 0, stdout, stderr })
    })
  })
}

/** Minimal P-shaped fixture: declared exports plus one private module that must stay unmapped. */
async function fixtureProvider(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-check-provider-'))
  await mkdir(join(dir, 'src'), { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify({
    name: providerPackage,
    exports: { '.': './dist/index.js', './settings': './dist/settings.js', './turns': './dist/turns.js', './package.json': './package.json' },
  }))
  for (const base of ['index', 'settings', 'turns', 'extra']) {
    await writeFile(join(dir, 'src', base + '.ts'), 'export const marker = 1\n')
  }
  return dir
}

describe('check-provider script', () => {
  it('shows usage with --help', async () => {
    const result = await runScript(['--help'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('pnpm run check:provider --')
  })

  it('rejects a missing provider directory', async () => {
    const result = await runScript([])
    expect(result.code).not.toBe(0)
    expect(result.stderr + result.stdout).toContain('Usage:')
  })

  it('rejects a relative provider directory', async () => {
    const result = await runScript(['--print-map', 'relative/path'])
    expect(result.code).not.toBe(0)
  })

  it('maps root and every subpath export to current sources', async () => {
    const dir = await fixtureProvider()
    try {
      const result = await runScript(['--print-map', dir])
      expect(result.code).toBe(0)
      const map = JSON.parse(result.stdout) as { specifier: string; file: string }[]
      const bySpecifier = new Map(map.map(entry => [entry.specifier, entry.file]))
      expect(bySpecifier.get(providerPackage)).toBe(join(dir, 'src', 'index.ts'))
      expect(bySpecifier.get(providerPackage + '/settings')).toBe(join(dir, 'src', 'settings.ts'))
      expect(bySpecifier.get(providerPackage + '/turns')).toBe(join(dir, 'src', 'turns.ts'))
      expect(bySpecifier.has(providerPackage + '/extra')).toBe(false)
      expect([...bySpecifier.keys()].some(specifier => specifier.endsWith('package.json'))).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
