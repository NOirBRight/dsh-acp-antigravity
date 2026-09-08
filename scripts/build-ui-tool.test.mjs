/** Minimal checks for the native ui-tool builder (node:test, stdlib only). */
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BASE_VERSION, NATIVE_VERSION, PKG_NAME, resolveOptions, rewriteManifest } from './build-ui-tool.mjs'

const root = mkdtempSync(join(tmpdir(), 'ui-tool-builder-test-'))
after(() => rmSync(root, { recursive: true, force: true }))
const pristine = () => ({
  name: PKG_NAME,
  version: BASE_VERSION,
  license: 'MIT',
  dependencies: { clsx: '^2.0.0' },
  peerDependencies: { '@deepseek-ai/cordis': 'workspace:^' },
  devDependencies: {
    '@deepseek-ai/cordis': 'workspace:^',
    '@deepseek-ai/dsh-client-ui-chat': 'workspace:^',
    react: '^18.2.0',
  },
})

describe('rewriteManifest', () => {
  it('bumps to the native version and resolves workspace:^ to the public pins', () => {
    const out = rewriteManifest(pristine())
    assert.equal(out.version, NATIVE_VERSION)
    assert.equal(out.peerDependencies['@deepseek-ai/cordis'], '^4.0.2')
    assert.equal(out.devDependencies['@deepseek-ai/cordis'], '^4.0.2')
    assert.equal(out.devDependencies['@deepseek-ai/dsh-client-ui-chat'], '^0.1.2-rc.1')
    assert.equal(out.dependencies.clsx, '^2.0.0')
    assert.equal(out.license, 'MIT')
    assert.ok(!JSON.stringify(out).includes('workspace:'))
  })

  it('rejects a foreign workspace:^ with no public pin', () => {
    const bad = pristine()
    bad.devDependencies['@other/pkg'] = 'workspace:^'
    assert.throws(() => rewriteManifest(bad), /no public range for @other\/pkg/)
  })

  it('rejects a non-pristine name or version', () => {
    assert.throws(() => rewriteManifest({ ...pristine(), version: '0.0.0' }), /pristine version/)
    assert.throws(() => rewriteManifest({ ...pristine(), name: 'other' }), /pristine name/)
  })
})

describe('resolveOptions', () => {
  it('requires both flags', () => {
    assert.throws(() => resolveOptions({}), /both required/)
    assert.throws(() => resolveOptions({ source: '/s' }), /both required/)
    assert.throws(() => resolveOptions({ out: '/o' }), /both required/)
  })

  it('refuses an existing out', () => {
    const existing = mkdtempSync(join(root, 'out-'))
    assert.throws(() => resolveOptions({ source: '/s', out: existing }), /already exists/)
  })

  it('refuses out inside source', () => {
    const source = mkdtempSync(join(root, 'src-'))
    assert.throws(() => resolveOptions({ source, out: join(source, 'fresh') }), /must not be inside/)
    assert.throws(() => resolveOptions({ source, out: source }), /already exists/)
  })

  it('rejects dot-prefixed descendants and symlinked output parents', () => {
    const source = mkdtempSync(join(root, 'src-'))
    const hidden = join(source, '..cache')
    mkdirSync(hidden)
    assert.throws(() => resolveOptions({ source, out: join(hidden, 'fresh') }), /must not be inside/)
    const alias = join(root, 'alias')
    symlinkSync(source, alias, 'dir')
    assert.throws(() => resolveOptions({ source, out: join(alias, 'fresh') }), /must not be inside/)
  })

  it('resolves a fresh pair to absolute paths', () => {
    const source = mkdtempSync(join(root, 'src-'))
    const out = join(root, 'fresh')
    assert.deepEqual(resolveOptions({ source, out }), { source, out })
  })
})
