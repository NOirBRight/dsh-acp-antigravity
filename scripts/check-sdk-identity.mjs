import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Run against the installed profile, not a hypothetical plugin location.
const [hostDirectory, profileDirectory] = process.argv.slice(2)
assert(hostDirectory && profileDirectory, 'Usage: node scripts/check-sdk-identity.mjs <host-directory> <profile-directory>')
const host = createRequire(resolve(hostDirectory, 'package.json'))
const profile = createRequire(resolve(profileDirectory, 'package.json'))
const loop = createRequire(host.resolve('@deepseek-ai/dsh-agent-loop'))
const plugin = createRequire(profile.resolve('@deepseek-ai/dsh-acp-antigravity'))
const coreSdk = await import(pathToFileURL(loop.resolve('@deepseek-ai/dsh-llm')).href)
const pluginSdk = await import(pathToFileURL(plugin.resolve('@deepseek-ai/dsh-llm')).href)
assert.equal(pluginSdk.isAgentLoopRequest(coreSdk.markAgentLoopRequest({})), true, 'Plugin does not recognize the actual Host request marker; check shadowing development dependencies')
assert.equal(pluginSdk.LlmError, coreSdk.LlmError, 'Plugin and Host use different LlmError classes')
console.log('Actual profile shares the Host request marker and LlmError identity.')
