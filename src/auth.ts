import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { URL } from 'node:url'
import { isRecord } from './decode.js'
import type { AntigravityAuthMethod, AntigravityAuthorizationRequest, AntigravityProviderConfig } from './types.js'

/** Stdout prefix emitted by the personal Google OAuth ACP server. */
export const ANTIGRAVITY_AUTH_STDOUT_PREFIX = 'Open the following link to authenticate the ACP server: '
/** Maximum accepted authorization URL length. */
export const MAX_AUTHORIZATION_URL_BYTES = 16 * 1024
/** Maximum accepted prelude line length. */
export const MAX_AUTH_PRELUDE_LINE_BYTES = 16 * 1024 * 1024

const ambientCredentialKeys = new Set([
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_CLOUD_LOCATION',
  'GOOGLE_CLOUD_QUOTA_PROJECT',
  'GOOGLE_GENAI_USE_VERTEXAI',
  'GCLOUD_PROJECT',
  'CLOUDSDK_CORE_PROJECT',
  'AGY_ACP_CCPA_PROJECT',
  'AGY_ACP_ENABLE_OAUTH',
  'GEMINI_HOME',
  'AGY_ACP_FORCE_FILE_STORAGE',
  'ANTIGRAVITY_HARNESS_PATH',
])

/** Resolve an owner-isolated state directory without exposing the instance id in paths. */
export function resolveAntigravityProfileDirectory(stateDirectory: string, instanceId: string): string {
  if (instanceId.trim() === '') throw new TypeError('instanceId must not be empty')
  const digest = createHash('sha256').update(instanceId).digest('hex')
  return join(resolve(stateDirectory), 'providers', 'antigravity', digest)
}

/** Create private profile directories and the value-free settings file. */
export async function prepareAntigravityProfile(config: AntigravityProviderConfig, authMethod: AntigravityAuthMethod = 'oauth-personal'): Promise<string> {
  const profileDirectory = resolveAntigravityProfileDirectory(config.stateDirectory, config.instanceId)
  try {
    if ((await lstat(profileDirectory)).isSymbolicLink()) throw new Error('Antigravity profile path must not be a symbolic link')
  } catch (error) {
    if (!isFileNotFound(error)) throw error
  }
  await mkdir(profileDirectory, { recursive: true, mode: 0o700 })
  await chmod(profileDirectory, 0o700)
  const settingsPath = join(profileDirectory, 'settings.json')
  try {
    if ((await lstat(settingsPath)).isSymbolicLink()) throw new Error('Antigravity settings path must not be a symbolic link')
  } catch (error) {
    if (!isFileNotFound(error)) throw error
  }
  let settings: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(await readFile(settingsPath, 'utf8'))
    if (!isRecord(parsed)) throw new Error('Antigravity profile settings must be a JSON object')
    settings = parsed
  } catch (error) {
    if (!isFileNotFound(error)) throw error
  }
  const auth = isRecord(settings.auth) ? settings.auth : {}
  await writeFile(settingsPath, JSON.stringify({ ...settings, auth: { ...auth, type: authMethod } }) + '\n', { mode: 0o600 })
  await chmod(settingsPath, 0o600)
  return profileDirectory
}

/** Remove one provider-owned profile and recreate its empty private settings. */
export async function clearAntigravityProfile(config: AntigravityProviderConfig): Promise<string> {
  const profileDirectory = resolveAntigravityProfileDirectory(config.stateDirectory, config.instanceId)
  try {
    if ((await lstat(profileDirectory)).isSymbolicLink()) throw new Error('Antigravity profile path must not be a symbolic link')
  } catch (error) {
    if (!isFileNotFound(error)) throw error
  }
  await rm(profileDirectory, { recursive: true, force: true })
  return prepareAntigravityProfile(config)
}

function isFileNotFound(error: unknown): error is NodeJS.ErrnoException { return error instanceof Error && 'code' in error && error.code === 'ENOENT' }

/** Build a provider environment with ambient Google credentials removed first. */
export function buildAntigravityEnvironment(input: {
  readonly baseEnv?: NodeJS.ProcessEnv
  readonly profileDirectory: string
  readonly harnessPath: string
}): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(input.baseEnv ?? process.env)) {
    const upper = key.toUpperCase()
    if (!ambientCredentialKeys.has(upper) && !/(?:^|_)(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIALS?)(?:_|$)/.test(upper)) environment[key] = value
  }
  return {
    ...environment,
    GEMINI_HOME: input.profileDirectory,
    AGY_ACP_FORCE_FILE_STORAGE: '1',
    ANTIGRAVITY_HARNESS_PATH: input.harnessPath,
    PYTHONUNBUFFERED: '1',
    ELECTRON_RUN_AS_NODE: '1',
  }
}

/** Return a value-free profile settings document for personal OAuth. */
export function antigravityProfileSettings(authMethod: AntigravityAuthMethod = 'oauth-personal'): string {
  return JSON.stringify({ auth: { type: authMethod } }) + '\n'
}

/** Parse and validate the public Google authorization URL from ACP stdout. */
export function parseAntigravityAuthorizationUrl(authorizationUrl: string): AntigravityAuthorizationRequest {
  if (new TextEncoder().encode(authorizationUrl).byteLength > MAX_AUTHORIZATION_URL_BYTES || /\s/.test(authorizationUrl)) throw new Error('Antigravity returned an invalid Google sign-in URL')
  let url: URL
  try { url = new URL(authorizationUrl) } catch { throw new Error('Antigravity returned an invalid Google sign-in URL') }
  const state = url.searchParams.get('state')
  const redirectUri = url.searchParams.get('redirect_uri')
  const responseType = url.searchParams.get('response_type')
  if (url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth' || url.username !== '' || url.password !== '' || url.hash !== '' || url.searchParams.getAll('state').length !== 1 || url.searchParams.getAll('redirect_uri').length !== 1 || url.searchParams.getAll('response_type').length !== 1 || responseType !== 'code' || state === null || state.length === 0 || state.length > 512 || /\s/.test(state) || redirectUri === null || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/$/.test(redirectUri)) throw new Error('Antigravity returned an invalid Google sign-in URL')
  const redirect = new URL(redirectUri)
  if (redirect.port === '' || Number(redirect.port) < 1024 || redirect.pathname !== '/' || redirect.search !== '' || redirect.hash !== '') throw new Error('Antigravity returned an invalid Google redirect')
  return { authorizationUrl, redirectUri, state }
}

/** Extract the first validated OAuth link from fragmented ACP stdout. */
export function parseAntigravityAuthPrelude(stdout: string): AntigravityAuthorizationRequest | null {
  if (new TextEncoder().encode(stdout).byteLength > MAX_AUTH_PRELUDE_LINE_BYTES) throw new Error('Antigravity authentication prelude is too large')
  const prefixIndex = stdout.indexOf(ANTIGRAVITY_AUTH_STDOUT_PREFIX)
  if (prefixIndex < 0) return null
  const start = prefixIndex + ANTIGRAVITY_AUTH_STDOUT_PREFIX.length
  const end = stdout.indexOf('\n', start)
  const rawUrl = stdout.slice(start, end < 0 ? undefined : end).trim()
  if (rawUrl === '') return null
  return parseAntigravityAuthorizationUrl(rawUrl)
}

/** Remove bearer tokens, OAuth query values and likely API keys from diagnostics. */
export function redactAntigravityText(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]')
    .replace(/([?&](?:code|state|token|access_token|refresh_token|key|api_key)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/\b(?:AIza[0-9A-Za-z_-]{20,}|ya29\.[0-9A-Za-z._-]+)\b/g, '[REDACTED]')
}

/** Explain a sign-in-required response without echoing provider payloads. */
export function antigravitySignInRequiredMessage(): string { return 'Sign in to Antigravity in Settings before continuing.' }
