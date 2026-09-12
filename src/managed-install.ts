/** Download and extract the pinned Google ACP pair into a DSH-managed directory. */
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolveAntigravityReleaseAsset, type AntigravityReleaseAsset } from './release.js'

export type ManagedInstallPhase = 'idle' | 'downloading' | 'extracting' | 'verifying' | 'succeeded' | 'failed'

/** Progress published to Settings while Install runs. */
export interface ManagedInstallProgress {
  readonly phase: ManagedInstallPhase
  readonly downloadedBytes: number
  readonly totalBytes: number
  readonly message: string
  readonly executablePath?: string
  readonly harnessPath?: string
}

export interface ManagedInstallIo {
  download(url: string, destination: string, onBytes: (n: number) => void, expectedBytes: number, expectedSha256: string): Promise<void>
  extract(archive: string, destination: string, files: readonly { name: string; bytes: number }[]): Promise<void>
}

const EXTRACT_SCRIPT = [
  'import json, os, sys, zipfile',
  'archive, dest, raw = sys.argv[1], sys.argv[2], sys.argv[3]',
  'expected = json.loads(raw)',
  'os.makedirs(dest, exist_ok=True)',
  'with zipfile.ZipFile(archive) as z:',
  '    names = z.namelist()',
  "    if sorted(names) != sorted(item['name'] for item in expected):",
  "        raise SystemExit('unexpected archive members: ' + ','.join(names))",
  "    sizes = {item['name']: item['bytes'] for item in expected}",
  '    for info in z.infolist():',
  '        if os.path.basename(info.filename) != info.filename:',
  "            raise SystemExit('unsafe archive member')",
  '        if info.file_size != sizes[info.filename]:',
  "            raise SystemExit('archive member has the wrong size: ' + info.filename)",
  '        z.extract(info, dest)',
  '        os.chmod(os.path.join(dest, info.filename), 0o755)',
].join(String.fromCharCode(10))

/** Stream a URL to disk and require the advertised length and SHA-256. */
export async function downloadReleaseArchive(url: string, destination: string, onBytes: (n: number) => void, expectedBytes: number, expectedSha256: string): Promise<void> {
  const response = await fetch(url, { headers: { 'accept-encoding': 'identity' } })
  if (!response.ok || response.body === null) throw new Error('Antigravity download failed: HTTP ' + String(response.status))
  await mkdir(join(destination, '..'), { recursive: true })
  const hash = createHash('sha256')
  let bytes = 0
  const file = createWriteStream(destination)
  const source = Readable.fromWeb(response.body as never)
  source.on('data', (chunk: Buffer) => {
    hash.update(chunk)
    bytes += chunk.length
    onBytes(bytes)
  })
  await pipeline(source, file)
  if (bytes !== expectedBytes) throw new Error('Antigravity archive length mismatch')
  if (hash.digest('hex') !== expectedSha256) throw new Error('Antigravity archive SHA-256 mismatch')
}

/** Extract only the two advertised files via Python's zipfile. */
export async function extractReleaseArchive(archive: string, destination: string, files: readonly { name: string; bytes: number }[]): Promise<void> {
  await promisify(execFile)('python3', ['-c', EXTRACT_SCRIPT, archive, destination, JSON.stringify(files)])
}

const defaultIo: ManagedInstallIo = {
  download: downloadReleaseArchive,
  extract: extractReleaseArchive,
}

function runtimeRoot(home: string): string {
  return join(home, 'runtimes', 'antigravity')
}

/** Directory for one pinned Google release. */
export function managedRuntimeDirectory(home: string, version: string): string {
  return join(runtimeRoot(home), 'versions', version)
}

async function existingPair(directory: string, asset: AntigravityReleaseAsset): Promise<{ executablePath: string; harnessPath: string } | undefined> {
  const executablePath = join(directory, asset.executable.name)
  const harnessPath = join(directory, asset.harness.name)
  try {
    const [execStat, harnessStat] = await Promise.all([stat(executablePath), stat(harnessPath)])
    if (execStat.size === asset.executable.bytes && harnessStat.size === asset.harness.bytes) return { executablePath, harnessPath }
  } catch { /* missing or wrong size */ }
  return undefined
}

/** Install or reuse the pinned Google ACP pair. */
export async function installManagedAntigravityRuntime(options: {
  readonly home: string
  readonly onProgress: (progress: ManagedInstallProgress) => void
  readonly io?: ManagedInstallIo
  readonly platform?: NodeJS.Platform
  readonly arch?: string
  readonly asset?: AntigravityReleaseAsset
}): Promise<ManagedInstallProgress> {
  const asset = options.asset ?? resolveAntigravityReleaseAsset(options.platform, options.arch)
  if (asset === undefined) throw new Error('No pinned Antigravity ACP zip for ' + (options.platform ?? process.platform) + '-' + (options.arch ?? process.arch))
  const io = options.io ?? defaultIo
  const report = (progress: ManagedInstallProgress): ManagedInstallProgress => {
    options.onProgress(progress)
    return progress
  }
  const dest = managedRuntimeDirectory(options.home, asset.version)
  const reused = await existingPair(dest, asset)
  if (reused !== undefined) {
    return report({ phase: 'succeeded', downloadedBytes: asset.archiveBytes, totalBytes: asset.archiveBytes, message: 'Using the managed Antigravity ACP runtime.', ...reused })
  }
  await mkdir(join(dest, '..'), { recursive: true })
  const staging = dest + '.partial-' + String(process.pid)
  const archive = staging + '.zip'
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { recursive: true })
  try {
    report({ phase: 'downloading', downloadedBytes: 0, totalBytes: asset.archiveBytes, message: 'Downloading the Google ACP runtime.' })
    await io.download(asset.url, archive, downloadedBytes => {
      report({ phase: 'downloading', downloadedBytes, totalBytes: asset.archiveBytes, message: 'Downloading the Google ACP runtime.' })
    }, asset.archiveBytes, asset.sha256)
    report({ phase: 'extracting', downloadedBytes: asset.archiveBytes, totalBytes: asset.archiveBytes, message: 'Extracting the verified runtime.' })
    await io.extract(archive, staging, [asset.executable, asset.harness])
    const pair = await existingPair(staging, asset)
    if (pair === undefined) throw new Error('Extracted Antigravity runtime is incomplete')
    report({ phase: 'verifying', downloadedBytes: asset.archiveBytes, totalBytes: asset.archiveBytes, message: 'Activating the managed runtime.', ...pair })
    await rm(dest, { recursive: true, force: true })
    await rename(staging, dest)
    const activated = await existingPair(dest, asset)
    if (activated === undefined) throw new Error('Activated Antigravity runtime is incomplete')
    await writeFile(join(runtimeRoot(options.home), 'active.json'), JSON.stringify({ version: asset.version, sha256: asset.sha256, ...activated }, null, 2) + String.fromCharCode(10))
    return report({ phase: 'succeeded', downloadedBytes: asset.archiveBytes, totalBytes: asset.archiveBytes, message: 'Installed the managed Antigravity ACP runtime.', ...activated })
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    await rm(archive, { force: true }).catch(() => undefined)
    const message = error instanceof Error ? error.message : String(error)
    return report({ phase: 'failed', downloadedBytes: 0, totalBytes: asset.archiveBytes, message })
  } finally {
    await rm(archive, { force: true }).catch(() => undefined)
  }
}
