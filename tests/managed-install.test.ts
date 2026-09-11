import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { extractReleaseArchive, installManagedAntigravityRuntime } from '../src/managed-install.js'
import { probeAntigravityInstallation } from '../src/probe.js'

async function makeZip(dir: string): Promise<{ zip: string; sha256: string; execBytes: number; harnessBytes: number }> {
  const execBytes = 8
  const harnessBytes = 4
  await writeFile(join(dir, 'agy_acp_server.par'), 'SERVER!!')
  await writeFile(join(dir, 'localharness_external'), 'HARN')
  const zip = join(dir, 'runtime.zip')
  await promisify(execFile)('python3', ['-c', 'import zipfile, sys; z=zipfile.ZipFile(sys.argv[1],"w"); z.write(sys.argv[2], "agy_acp_server.par"); z.write(sys.argv[3], "localharness_external")', zip, join(dir, 'agy_acp_server.par'), join(dir, 'localharness_external')])
  const sha256 = createHash('sha256').update(await readFile(zip)).digest('hex')
  return { zip, sha256, execBytes, harnessBytes }
}

describe('managed Antigravity install', () => {
  const dirs: string[] = []
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  it('extracts a two-file zip and installs into the managed directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-acp-zip-'))
    dirs.push(dir)
    const home = await mkdtemp(join(tmpdir(), 'dsh-acp-home-'))
    dirs.push(home)
    const { zip, sha256, execBytes, harnessBytes } = await makeZip(dir)
    const phases: string[] = []
    const result = await installManagedAntigravityRuntime({
      home,
      onProgress: progress => { phases.push(progress.phase) },
      asset: {
        version: 'test-runtime',
        url: 'https://example.test/runtime.zip',
        sha256,
        archiveBytes: (await readFile(zip)).length,
        executable: { name: 'agy_acp_server.par', bytes: execBytes },
        harness: { name: 'localharness_external', bytes: harnessBytes },
      },
      io: {
        download: async (_url, destination) => { await writeFile(destination, await readFile(zip)) },
        extract: extractReleaseArchive,
      },
    })
    expect(result.phase).toBe('succeeded')
    expect(result.executablePath).toMatch(/agy_acp_server\.par$/)
    expect(await readFile(result.executablePath!, 'utf8')).toBe('SERVER!!')
    expect(phases).toContain('extracting')
  })

  it('rejects an archive whose hash does not match', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-acp-bad-'))
    dirs.push(dir)
    const home = await mkdtemp(join(tmpdir(), 'dsh-acp-home-'))
    dirs.push(home)
    const { zip, execBytes, harnessBytes } = await makeZip(dir)
    const result = await installManagedAntigravityRuntime({
      home,
      onProgress: () => undefined,
      asset: {
        version: 'test-runtime',
        url: 'https://example.test/runtime.zip',
        sha256: '0'.repeat(64),
        archiveBytes: (await readFile(zip)).length,
        executable: { name: 'agy_acp_server.par', bytes: execBytes },
        harness: { name: 'localharness_external', bytes: harnessBytes },
      },
      io: {
        download: async () => { throw new Error('Antigravity archive SHA-256 mismatch') },
        extract: extractReleaseArchive,
      },
    })
    expect(result.phase).toBe('failed')
    expect(result.message).toMatch(/SHA-256/)
  })

  it('finds agy_acp_server.par on PATH', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-acp-par-'))
    dirs.push(dir)
    const server = join(dir, 'agy_acp_server.par')
    const harness = join(dir, 'localharness_external')
    await writeFile(server, '#!/bin/sh\n')
    await writeFile(harness, '#!/bin/sh\n')
    await chmod(server, 0o755)
    await chmod(harness, 0o755)
    const previous = process.env.PATH
    process.env.PATH = dir
    try {
      await expect(probeAntigravityInstallation('linux')).resolves.toMatchObject({ executablePath: server, harnessPath: harness })
    } finally {
      process.env.PATH = previous
    }
  })
})
