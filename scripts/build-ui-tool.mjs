#!/usr/bin/env node
/** Build the publishable @deepseek-ai/dsh-client-ui-tool 0.1.2-rc.1-native.1 tgz.
 *
 * BASE_SHA archive export (package + preset support files + tsconfigs + LICENSE)
 * plus the sibling dsh-ui-tool-native-card.patch (public read-only
 * GenericToolCard), compiled in an isolated workdir with the source checkout's
 * own tsc and the official clientBundle preset. Both flags are required; out
 * must not exist and must not sit inside source, and nothing is deleted:
 * validation failures leave existing data alone. Never writes the source
 * checkout or this package. Run:
 * `node scripts/build-ui-tool.mjs --source=DIR --out=DIR`.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

export const PKG_NAME = '@deepseek-ai/dsh-client-ui-tool'
export const BASE_VERSION = '0.1.2-rc.1'
export const NATIVE_VERSION = '0.1.2-rc.1-native.1'
export const BASE_SHA = 'a66e4702047846cdaa10c66c9d3df3951f5ea70d'
export const SOURCE_REPO = 'https://github.com/deepseek-ai/deepseek-harness.git'

// ponytail: public pins mirror the official 0.1.2-rc.1 tarball; re-verify against it if upstream republishes.
const CORDIS_PUBLIC = '^4.0.2'
const DSH_PUBLIC = '^0.1.2-rc.1'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const PATCH_FILE = join(HERE, 'dsh-ui-tool-native-card.patch')
// Every source input below comes from the BASE_SHA git archive, never the live
// worktree, so uncommitted worktree changes cannot leak into the artifact.
const ARCHIVE_PATHS = [
  'LICENSE',
  'tsconfig.base.json',
  'tsconfig.base.client.json',
  'scripts/types',
  'scripts/client-build-environment.ts',
  'packages/client/ui-tool',
  'packages/client/tsdown.client.ts',
  'packages/client/modules/src/client/manifest.ts',
  'packages/client/modules/src/client/system.ts',
  'packages/client/web/src/platform.ts',
]

const fail = (message) => { throw new Error(`build-ui-tool: ${message}`) }
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
const run = (cmd, args, opts) => execFileSync(cmd, args, { stdio: 'inherit', ...opts })

/** Rewrite a pristine manifest to the native release: bump version, resolve every
 * workspace:^ to its public range. Throws on anything unexpected. */
export function rewriteManifest(pristine) {
  if (pristine?.name !== PKG_NAME) fail(`pristine name is ${pristine?.name}`)
  if (pristine?.version !== BASE_VERSION) fail(`pristine version is ${pristine?.version}`)
  const mapSection = (section) => Object.fromEntries(Object.entries(section ?? {}).map(([name, range]) => {
    if (range !== 'workspace:^') return [name, range]
    if (name === '@deepseek-ai/cordis') return [name, CORDIS_PUBLIC]
    if (name.startsWith('@deepseek-ai/dsh-')) return [name, DSH_PUBLIC]
    return fail(`no public range for ${name}`)
  }))
  const manifest = {
    ...pristine,
    version: NATIVE_VERSION,
    dependencies: mapSection(pristine.dependencies),
    peerDependencies: mapSection(pristine.peerDependencies),
    devDependencies: mapSection(pristine.devDependencies),
  }
  if (JSON.stringify(manifest).includes('workspace:')) fail('workspace: spec survived the rewrite')
  return manifest
}

/** Delete every file under dir matching one of the suffixes (recursive). */
function stripSuffixes(dir, suffixes) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) { stripSuffixes(path, suffixes); continue }
    if (suffixes.some((suffix) => entry.name.endsWith(suffix))) rmSync(path)
  }
}

/** Validate raw CLI paths before writing; source and output parent must exist. */
export function resolveOptions(raw) {
  if (typeof raw?.source !== 'string' || raw.source === '') {
    fail('usage: build-ui-tool.mjs --source=DIR --out=DIR (both required)')
  }
  if (typeof raw?.out !== 'string' || raw.out === '') {
    fail('usage: build-ui-tool.mjs --source=DIR --out=DIR (both required)')
  }
  const requestedOut = resolve(raw.out)
  if (existsSync(requestedOut)) fail(`out already exists, refusing to overwrite: ${requestedOut}`)
  const source = realpathSync(resolve(raw.source))
  const out = join(realpathSync(dirname(requestedOut)), basename(requestedOut))
  const rel = relative(source, out)
  if (rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel))) {
    fail(`out must not be inside source: ${out}`)
  }
  return { source, out }
}

function main() {
  const { values } = parseArgs({ options: { source: { type: 'string' }, out: { type: 'string' } }, strict: true })
  const { source, out } = resolveOptions(values)
  if (!existsSync(PATCH_FILE)) fail(`patch not found: ${PATCH_FILE}`)
  const head = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  if (head !== BASE_SHA) fail(`source HEAD is ${head}, expected ${BASE_SHA}`)
  const tscBin = join(source, 'node_modules/typescript/bin/tsc')
  if (!existsSync(tscBin)) fail('source toolchain has no node_modules/typescript/bin/tsc')
  const tsdownBin = join(source, 'node_modules/tsdown/dist/run.mjs')
  if (!existsSync(tsdownBin)) fail('source toolchain has no node_modules/tsdown/dist/run.mjs')

  const work = join(out, 'work')
  const pkg = join(work, 'packages/client/ui-tool')
  mkdirSync(out)
  mkdirSync(work)
  const archive = join(work, 'pkg.tar')
  writeFileSync(archive, execFileSync('git', ['-C', source, 'archive', 'HEAD', ...ARCHIVE_PATHS]))
  run('tar', ['-xf', archive, '-C', work])
  rmSync(archive)
  symlinkSync(join(source, 'node_modules'), join(work, 'node_modules'))
  symlinkSync(join(source, 'packages/client/ui-tool/node_modules'), join(pkg, 'node_modules'))

  run('git', ['apply', '--check', '-p1', PATCH_FILE], { cwd: pkg })
  run('git', ['apply', '-p1', PATCH_FILE], { cwd: pkg })
  const indexTs = readFileSync(join(pkg, 'src/client/index.ts'), 'utf8')
  const cardTsx = readFileSync(join(pkg, 'src/client/tool/toolviews/GenericToolCard.tsx'), 'utf8')
  if (!indexTs.includes("export { GenericToolCard, type GenericToolCardProps }")) fail('patch did not add the GenericToolCard export')
  if (!cardTsx.includes("Omit<ToolCallOwnerProps, 'openFile' | 'inspect'>")) fail('patch did not make host callbacks optional')

  // Rolldown loads this tsconfig but resolves no project references; their targets
  // do not exist in isolation, so drop the key (tsc uses tsconfig.native.json).
  const tsconfigPath = join(pkg, 'tsconfig.json')
  const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8'))
  delete tsconfig.references
  writeFileSync(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`)

  const manifest = rewriteManifest(JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')))
  writeFileSync(join(pkg, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  cpSync(join(work, 'LICENSE'), join(pkg, 'LICENSE'))

  // paths:{} drops the repo source facade: workspace deps resolve to their built
  // lib/types .d.ts through the read-only node_modules symlink, so no upstream
  // source is ever compiled under this client face (official shape per package).
  // extends points at the isolated BASE-archive copy (with its scripts/types).
  writeFileSync(join(work, 'tsconfig.native.json'), JSON.stringify({
    extends: './tsconfig.base.client.json',
    compilerOptions: {
      rootDir: 'packages/client/ui-tool/src',
      outDir: 'packages/client/ui-tool/lib/types',
      tsBuildInfoFile: 'tsconfig.native.tsbuildinfo',
      paths: {},
    },
    include: ['packages/client/ui-tool/src'],
  }, null, 2))
  run(process.execPath, [tscBin, '-p', join(work, 'tsconfig.native.json')], { cwd: work })
  run(process.execPath, [tsdownBin, '--env.DSH_BUILD_FACE', 'client'], { cwd: pkg })

  const lib = join(pkg, 'lib')
  const clientJs = readFileSync(join(lib, 'client.js'), 'utf8')
  if (!clientJs.includes('__ModuleLoader__') || !clientJs.includes('GenericToolCard')) {
    fail('lib/client.js is not the ModuleLoader factory bundle with GenericToolCard')
  }
  const clientDts = readFileSync(join(lib, 'types/client/index.d.ts'), 'utf8')
  if (!clientDts.includes('GenericToolCard')) fail('lib/types/client/index.d.ts lacks the GenericToolCard export')
  stripSuffixes(join(lib, 'types'), ['.js', '.map'])
  rmSync(join(lib, 'tsconfig.tsbuildinfo'), { force: true })
  for (const entry of readdirSync(lib)) if (entry.endsWith('.map')) rmSync(join(lib, entry))

  run('npm', ['pack', '--pack-destination', out], { cwd: pkg })
  const tgzName = `deepseek-ai-dsh-client-ui-tool-${NATIVE_VERSION}.tgz`
  const tgz = join(out, tgzName)
  if (!existsSync(tgz)) fail('npm pack produced no tarball')
  const members = execFileSync('tar', ['-tzf', tgz], { encoding: 'utf8' }).split('\n')
  if (members.some((m) => m.includes('node_modules'))) fail('tarball ships node_modules')
  for (const required of ['package/lib/client.js', 'package/lib/index.js', 'package/lib/types/client/index.d.ts', 'package/package.json', 'package/LICENSE']) {
    if (!members.includes(required)) fail(`tarball lacks ${required}`)
  }
  const tscVersion = execFileSync(process.execPath, [tscBin, '--version'], { encoding: 'utf8' }).trim()
  const tsdownVersion = JSON.parse(readFileSync(join(source, 'node_modules/tsdown/package.json'), 'utf8')).version
  const provenance = {
    package: PKG_NAME,
    version: NATIVE_VERSION,
    source: { repo: SOURCE_REPO, baseSHA: BASE_SHA, path: 'packages/client/ui-tool' },
    patch: { file: 'scripts/dsh-ui-tool-native-card.patch', sha256: sha256(PATCH_FILE) },
    builder: { file: 'scripts/build-ui-tool.mjs', sha256: sha256(fileURLToPath(import.meta.url)) },
    workspaceRewrite: { '@deepseek-ai/cordis': `workspace:^ -> ${CORDIS_PUBLIC}`, '@deepseek-ai/dsh-*': `workspace:^ -> ${DSH_PUBLIC}` },
    toolchain: { node: process.version, tsc: tscVersion, tsdown: tsdownVersion },
    tarball: { file: tgzName, sha256: sha256(tgz), bytes: statSync(tgz).size },
  }
  writeFileSync(join(out, 'PROVENANCE.json'), `${JSON.stringify(provenance, null, 2)}\n`)
  writeFileSync(join(out, 'sha256sums.txt'), `${provenance.tarball.sha256}  ${tgzName}\n`)
  console.log(`built ${tgz} (${provenance.tarball.bytes} bytes)`)
}

const invoked = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invoked) main()
