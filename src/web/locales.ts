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
  intro: '配置 Antigravity ACP 可执行文件对，校验安装，并用个人 Google 账号登录。保存后写入本机 profile。',
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
