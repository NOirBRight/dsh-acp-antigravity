import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Verifies A against P working-tree sources without touching node_modules:
// one compiler-API typecheck per tsconfig face with a paths override, then
// vitest with DSH_ACP_PROVIDER_SRC. Only manifest-published exports map
// (root + subpaths); unexported P modules stay unmapped so a passing check
// matches the published artifact. Live/model smokes never run.

const PACKAGE = '@deepseek-ai/dsh-acp-provider'
const ENV_VAR = 'DSH_ACP_PROVIDER_SRC'
const A_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const USAGE = 'Usage: pnpm run check:provider -- /absolute/path/to/dsh-acp-provider [vitest args...]\n'
  + 'Options: --print-map (specifier map as JSON, used by tests), -h/--help'
const LIVE_ENV = [
  'ANTIGRAVITY_ACP_EXECUTABLE',
  'ANTIGRAVITY_HARNESS_EXECUTABLE',
  'ANTIGRAVITY_AUTHENTICATED_STATE_DIRECTORY',
  'ANTIGRAVITY_AUTHENTICATED_INSTANCE_ID',
]

function providerMap(providerDir) {
  assert.ok(isAbsolute(providerDir), 'provider directory must be absolute, got: ' + providerDir)
  assert.ok(existsSync(join(providerDir, 'package.json')), 'not a package directory: ' + providerDir)
  const manifest = JSON.parse(readFileSync(join(providerDir, 'package.json'), 'utf8'))
  assert.equal(manifest.name, PACKAGE, 'expected ' + PACKAGE + ', got: ' + manifest.name)
  assert.ok(manifest.exports && typeof manifest.exports === 'object', 'provider package.json has no exports map')
  return Object.keys(manifest.exports)
    .filter(subpath => subpath !== './package.json')
    .map(subpath => {
      const base = subpath === '.' ? 'index' : subpath.slice(2)
      assert.ok(!base.includes('/') && !base.includes('*'), 'unsupported export subpath: ' + subpath)
      const file = join(providerDir, 'src', base + '.ts')
      assert.ok(existsSync(file), 'published export has no current source: ' + subpath)
      return { specifier: subpath === '.' ? PACKAGE : PACKAGE + subpath.slice(1), file }
    })
    .sort((a, b) => b.specifier.length - a.specifier.length)
}

function typecheckFace(ts, face, providerPaths) {
  const file = join(A_ROOT, face)
  const raw = ts.readConfigFile(file, ts.sys.readFile)
  assert.ok(!raw.error, 'cannot read ' + face)
  const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, A_ROOT, undefined, file)
  assert.ok(parsed.errors.length === 0, 'invalid ' + face)
  const ownPaths = {}
  for (const [key, values] of Object.entries(parsed.options.paths ?? {})) {
    ownPaths[key] = values.map(value => (value.startsWith('.') ? resolve(A_ROOT, value) : value))
  }
  const program = ts.createProgram(parsed.fileNames, {
    ...parsed.options, paths: { ...ownPaths, ...providerPaths }, noEmit: true,
  })
  const diagnostics = ts.getPreEmitDiagnostics(program)
  if (diagnostics.length > 0) {
    console.error(face + ': ' + diagnostics.length + ' diagnostic(s)')
    console.error(ts.formatDiagnostics(diagnostics.slice(0, 60), {
      getCanonicalFileName: name => name,
      getCurrentDirectory: ts.sys.getCurrentDirectory,
      getNewLine: () => ts.sys.newLine,
    }))
  }
  return diagnostics.length
}

async function main(argv) {
  const args = argv.filter(arg => arg !== '--')
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE)
    return
  }
  const printMap = args.includes('--print-map')
  const index = args.findIndex(arg => !arg.startsWith('-'))
  assert.ok(index !== -1, 'missing provider directory.\n' + USAGE)
  const providerDir = args[index]
  const vitestArgs = args.slice(index + 1)
  assert.ok(!printMap || vitestArgs.length === 0, '--print-map takes no vitest args')
  const map = providerMap(providerDir)
  if (printMap) {
    console.log(JSON.stringify(map, null, 2))
    return
  }
  const ts = createRequire(join(A_ROOT, 'package.json'))('typescript')
  const providerPaths = {}
  for (const { specifier, file } of map) providerPaths[specifier] = [file]
  let failures = 0
  for (const face of ['tsconfig.json', 'tsconfig.web.json']) failures += typecheckFace(ts, face, providerPaths)
  assert.ok(failures === 0, 'source typecheck failed with ' + failures + ' diagnostic(s)')
  console.log('check-provider: source typecheck passed')
  const env = { ...process.env, [ENV_VAR]: providerDir }
  for (const name of LIVE_ENV) delete env[name]
  const code = await new Promise((done, failed) => {
    const child = spawn('pnpm', ['vitest', 'run', ...vitestArgs], { cwd: A_ROOT, env, stdio: 'inherit' })
    child.on('error', failed)
    child.on('close', done)
  })
  assert.ok(code === 0, 'vitest exited with code ' + code)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    () => {},
    error => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    },
  )
}
