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

export const zh: Record<AcpSettingsKey, string> = {
  nav: 'External Agents',
  title: 'External Agents',
  intro: '需要 Google 的 agy_acp_server 与同目录 localharness_external，不是 agy CLI。Rescan 会搜 PATH；找到后点 Save 再 Sign in。',
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
}

export const en: Record<AcpSettingsKey, string> = { ...zh }
