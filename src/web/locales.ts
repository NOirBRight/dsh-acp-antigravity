export type AcpSettingsKey =
  | 'nav'
  | 'title'
  | 'intro'
  | 'rescan'
  | 'save'
  | 'saved'
  | 'failed'
  | 'locateAcp'
  | 'locateHarness'
  | 'signIn'
  | 'signOut'
  | 'openLogin'
  | 'enabledBadge'
  | 'disabledBadge'
  | 'missingBadge'
  | 'authBadge'
  | 'model'
  | 'executable'
  | 'harness'
  | 'profile'
  | 'install'
  | 'installing'
  | 'signingIn'

export const zh: Record<AcpSettingsKey, string> = {
  nav: 'External Agents',
  title: 'External Agents',
  intro: 'Install 会从 Google 下载 ACP 运行时（agy_acp_server.par + localharness_external），不使用 agy CLI。完成后 Sign in。',
  rescan: 'Rescan',
  save: 'Save',
  saved: 'Saved',
  failed: '设置操作失败',
  locateAcp: 'Locate ACP executable',
  locateHarness: 'Locate harness',
  signIn: 'Sign in',
  signOut: 'Sign out',
  openLogin: 'Open login URL',
  enabledBadge: 'Enabled',
  disabledBadge: 'Disabled',
  missingBadge: 'Missing',
  authBadge: 'Sign-in required',
  model: 'Model',
  executable: 'ACP server',
  harness: 'localharness_external',
  profile: 'Profile',
  install: 'Install Antigravity',
  installing: 'Installing…',
  signingIn: 'Waiting for Google sign-in…',
}

export const en: Record<AcpSettingsKey, string> = { ...zh }
