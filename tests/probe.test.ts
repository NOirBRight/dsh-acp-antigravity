import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { probeAntigravityInstallation } from '../src/probe.js'

describe('ACP installation probe', () => {
  const dirs: string[] = []
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  it('finds the ACP pair on PATH and ignores a sibling agy CLI name', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-acp-probe-'))
    dirs.push(dir)
    const server = join(dir, 'agy_acp_server')
    const harness = join(dir, 'localharness_external')
    await writeFile(server, '#!/bin/sh\n')
    await writeFile(harness, '#!/bin/sh\n')
    await chmod(server, 0o755)
    await chmod(harness, 0o755)
    const previous = process.env.PATH
    process.env.PATH = dir
    try {
      await expect(probeAntigravityInstallation('linux')).resolves.toMatchObject({
        executablePath: server,
        harnessPath: harness,
      })
    } finally {
      process.env.PATH = previous
    }
  })

  it('reports that agy CLI is not the ACP pair', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-acp-cli-'))
    dirs.push(dir)
    const cli = join(dir, 'agy')
    await writeFile(cli, '#!/bin/sh\n')
    await chmod(cli, 0o755)
    const previous = process.env.PATH
    process.env.PATH = dir
    try {
      const found = await probeAntigravityInstallation('linux')
      expect(found.agyCli).toBe(cli)
      expect(found.executablePath).toBeUndefined()
      expect(found.message).toMatch(/agy CLI/)
    } finally {
      process.env.PATH = previous
    }
  })
})
