/** Provider settings copy shared by the native ACP card and quota reader. */
export const en = {
  nav: 'External Agents', title: 'Antigravity', intro: 'Native ACP runtime; no CLI required.',
  rescan: 'Refresh status', save: 'Save changes', saved: 'Saved', saving: 'Saving…', cancel: 'Discard', failed: 'Settings operation failed',
  locateAcp: 'Locate ACP executable', locateHarness: 'Locate harness', signIn: 'Sign in', signOut: 'Sign out', openLogin: 'Open login page',
  enabledBadge: 'Enabled', disabledBadge: 'Disabled', missingBadge: 'Not installed', authBadge: 'Sign-in required', connected: 'Connected',
  model: 'Models', executable: 'ACP server', harness: 'localharness_external', profile: 'Profile', install: 'Install Antigravity', installing: 'Installing…', signingIn: 'Opening Google sign-in…',
  loading: 'Loading…', quota: 'Account quota', quotaUnavailable: 'Quota unavailable', refreshQuota: 'Refresh quota', staleQuota: 'Previous snapshot; refresh failed',
  resetsAt: 'Resets', updatedAt: 'Updated', account: 'Account', enableProvider: 'Enable provider', advanced: 'Advanced / runtime', unsaved: 'Unsaved changes',
  modelCount: '{count} models', refreshModels: 'Refresh models', defaultModel: 'Default model', accountDefault: 'Account default',
  nativeModels: 'Model availability and capabilities are supplied by the native ACP runtime. This card does not override unsupported model capabilities.',
  activityView: 'Antigravity Activity', activityRefresh: 'Refresh', activityLoading: 'Loading activity…', activityEmpty: 'No tool activity yet.', activityFailed: 'Activity unavailable', activityNoOutput: 'No displayable output.',
}
export type AcpSettingsKey = keyof typeof en
export const zh: Record<AcpSettingsKey, string> = {
  nav: '外部 Agent', title: 'Antigravity', intro: '原生 ACP 运行时，无需 CLI。',
  rescan: '刷新状态', save: '保存更改', saved: '已保存', saving: '保存中…', cancel: '撤销', failed: '设置操作失败',
  locateAcp: '选择 ACP 可执行文件', locateHarness: '选择 harness', signIn: '登录', signOut: '退出登录', openLogin: '打开登录页',
  enabledBadge: '已启用', disabledBadge: '已禁用', missingBadge: '未安装', authBadge: '需要登录', connected: '已连接',
  model: '模型', executable: 'ACP 服务', harness: 'localharness_external', profile: '配置目录', install: '安装 Antigravity', installing: '安装中…', signingIn: '正在打开 Google 登录…',
  loading: '加载中…', quota: '账户额度', quotaUnavailable: '额度暂不可用', refreshQuota: '刷新额度', staleQuota: '刷新失败，显示上次快照',
  resetsAt: '重置时间', updatedAt: '更新时间', account: '账户', enableProvider: '启用 Provider', advanced: '高级设置 / 运行时', unsaved: '有未保存修改',
  modelCount: '{count} 个模型', refreshModels: '更新模型目录', defaultModel: '默认模型', accountDefault: '跟随账户默认',
  nativeModels: '模型目录与能力由原生 ACP 运行时提供；此处不覆盖运行时未支持的模型能力。',
  activityView: 'Antigravity 动态', activityRefresh: '刷新', activityLoading: '正在加载动态…', activityEmpty: '暂无工具动态。', activityFailed: '动态暂不可用', activityNoOutput: '无可显示的输出。',
}
