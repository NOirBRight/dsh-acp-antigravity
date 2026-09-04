import type {
  ExternalAgentAttachment,
  ExternalAgentEvent,
  ExternalAgentModel,
  ExternalAgentOpenRequest,
  ExternalAgentPermissionDecision,
  ExternalAgentPermissionRequest,
  ExternalAgentProvider,
  ExternalAgentSession,
  ExternalAgentSessionId,
  ExternalAgentSessionRef,
  ExternalAgentTurnHost,
  ExternalAgentTurnRequest,
  ExternalAgentTurnResult,
  ExternalAgentUserInputAnswers,
  ExternalAgentUserInputRequest,
  ExternalAgentPermissionMode,
  ExternalAgentProviderInstanceId,
} from '@deepseek-ai/dsh-acp-provider'

/** Official Antigravity native permission mode values. */
export type AntigravityNativeMode = 'default' | 'auto_edit' | 'yolo'

/** Stable alias accepted for the account's current default model. */
export const ANTIGRAVITY_DEFAULT_MODEL = 'default'

/** First-release authentication method. */
export type AntigravityAuthMethod = 'oauth-personal'

/** Provider setup status shown by Settings. */
export type AntigravityStatus = 'missing-installation' | 'invalid-installation' | 'authentication-required' | 'ready' | 'error'

/** User-provided executable pair and isolated mutable profile. */
export interface AntigravityInstallationConfig {
  readonly executablePath: string
  readonly harnessPath: string
  readonly stateDirectory: string
  readonly instanceId: ExternalAgentProviderInstanceId
  readonly platform?: NodeJS.Platform
}

/** Provider configuration for one independently mounted instance. */
export interface AntigravityProviderConfig extends AntigravityInstallationConfig {
  readonly authMethod?: AntigravityAuthMethod
  readonly model?: string
  readonly clientName?: string
  readonly clientVersion?: string
  readonly maxEventTextBytes?: number
  readonly maxEventPayloadBytes?: number
  readonly cancelGraceMs?: number
}

/** Result of validating the explicit executable pair. */
export interface AntigravityInstallationStatus {
  readonly status: Exclude<AntigravityStatus, 'authentication-required' | 'ready'>
  readonly executablePath: string
  readonly harnessPath: string
  readonly version?: string
  readonly message: string
}

/** ACP identity and capabilities required by this provider. */
export interface AntigravityIdentity {
  readonly protocolVersion: number
  readonly agentName: string
  readonly agentVersion?: string
  readonly supportsResume: boolean
  readonly resumeMethod?: 'resume' | 'load'
}

/** Provider status and account metadata with no secret values. */
export interface AntigravityHealth {
  readonly status: AntigravityStatus
  readonly message?: string
  readonly version?: string
  readonly model?: string
  readonly profileDirectory: string
}

/** A parsed public OAuth link; tokens and codes never enter this type. */
export interface AntigravityAuthorizationRequest {
  readonly authorizationUrl: string
  readonly redirectUri: string
  readonly state: string
}

/** Filesystem roots a provider may request through DSH. */
export interface AntigravityClientFilesystem {
  readonly workspaceRoot: string
  readonly workspaceRoots?: readonly string[]
  readonly attachmentRoots: readonly string[]
  readTextFile(path: string, signal?: AbortSignal): Promise<string>
  writeTextFile(path: string, content: string, signal?: AbortSignal): Promise<void>
  /** Optional host-owned realpath/policy check for symlink and write containment. */
  resolvePath?(path: string, operation: 'read' | 'write'): Promise<string> | string
}

/** Advertise DSH filesystem methods only for sessions that receive its adapter. */
export function antigravityClientCapabilities(filesystem: boolean): Readonly<Record<string, unknown>> {
  return filesystem ? { fs: { readTextFile: true, writeTextFile: true } } : {}
}

/** Native mode values supported by the provider. */
export const ANTIGRAVITY_PERMISSION_MODES: readonly ExternalAgentPermissionMode[] = [
  'approval-required',
  'auto-accept-edits',
  'full-access',
]

/** Re-export the provider-neutral types used by Antigravity adapters. */
export type {
  ExternalAgentAttachment,
  ExternalAgentEvent,
  ExternalAgentModel,
  ExternalAgentOpenRequest,
  ExternalAgentPermissionDecision,
  ExternalAgentPermissionRequest,
  ExternalAgentProvider,
  ExternalAgentSession,
  ExternalAgentSessionId,
  ExternalAgentSessionRef,
  ExternalAgentTurnHost,
  ExternalAgentTurnRequest,
  ExternalAgentTurnResult,
  ExternalAgentUserInputAnswers,
  ExternalAgentUserInputRequest,
  ExternalAgentPermissionMode,
}
