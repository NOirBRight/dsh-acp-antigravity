## v0.1.6

- 详情页改用共享模板 `ProviderDetail`（由设置页通过 slot 上下文下发，插件不再自带模板与样式）。
- 模型行交给模板渲染：`items`（行数据）+ `extra`（该行的上下文窗口、能力勾选、默认思考等级等私有字段），插件不再画行卡片；行内字段固定列槽、排序态只读并收起、单层圆角。
- 详情模式下插件不再自行请求额度（`props.mode === 'detail'` 时直接返回），额度由设置页的共享缓存提供，右上角刷新走 `props.onRefresh`。
- 高级设置按原型：分隔线区块 + 折叠箭头 + 右侧说明，选项为「复选框 + 缩进说明」。
- 移动端：工具栏与标题同一行（无换行、无溢出），窄屏自动收紧。
- 依赖 `dsh-llm-providers-ui` 升级到 `0.2.0`（破坏性接口：必须使用 slot 下发的 `template`/`copy` 与 `items`/`extra`）。

# Changelog

## [Unreleased]

## [0.1.5] - DSH 0.1.5-rc.1 migration (W1 P4)

- Fix 3082 profile load crash: the settings RPC channel now registers through an injected connection scope instead of the plugin root ctx (missing inject throws fail-loud at apply).
- A stored catalog override is recognised by the fields it holds, not by comparing values with discovery, so setting a field back to the catalog value no longer lets a later save clear it.
- A model the accepted snapshot does not carry stores only what the editor actually set: adopting a discovered model no longer freezes the facts it was built from.
- Every catalog model carries a default thinking level like the sibling providers: discovery and the account default win, otherwise the highest level the model offers, and a saved override replaces it. Restoring the field returns to that preset, which is catalog data and never stored as an override.
- A saved catalog override survives any later save that does not touch that field: the payload keeps every field the snapshot already stored, not only the fields edited in this session. Restoring a field clears its override.
- Saving the model catalog compares each row with the snapshot the card rendered from, so a first edit to default thinking, vision, thinking, context window, name, or output persists instead of being discarded as "unchanged"; a row the user added persists too.
- Default thinking levels reach the Host model directory: the account-declared default model names its own model's default level, and a saved per-model default is projected instead of only showing in the card. A level the current catalog cannot route is omitted, never sent.
- The missing-providers-page warning waits out a 15s grace period, so a page load that registers the settings section after mount no longer reports a missing owner; a genuine absence still warns once.
- Native tool rows render through the plugin-owned read-only card; the private host GenericToolCard import and the unofficial ui-tool native.1 build (scripts/build-ui-tool.mjs, dsh-ui-tool-native-card.patch) are removed. No official ui-tool package is modified and no core patch is carried.
- Host stream usage chunks carry official TokenUsage keys only: plugin-owned completeness (usageComplete) stays in sidecar telemetry and snapshots, never in host chunks or the session log.
- A failed probe, initialization, or session start is reported as its own "Connection failed" card state with the host message and a refresh action, instead of claiming the account needs sign-in; a genuinely signed-out account still shows "Sign-in required".
- A cancelled operation no longer records a provider failure: stopping a turn, aborting a Settings request, or any other caller cancellation leaves the account status exactly as it was, so a cancelled turn can no longer read as "Sign-in required". A discovery deadline the provider itself arms still reports when it expires.
- DSH peer/dev declarations target 0.1.5-rc.1 only.

## [0.1.4] - 2026-09-10

- Settings catalog uses the shared model catalog editor and fetch overlay.
- Skip the native `default` routing alias as a catalog row; persist membership order and flagged overrides only.
- Integer quota percents, header reset time, and a single headline bucket for the directory cache.
- Forward validated usage and telemetry key aliases when the native runtime emits them.

## [0.1.3] - 2026-09-09

- Review native plans only when the session Plan projection is logged-active.
- Preserve Other/custom question answers through native freeform metadata.
- Reject converting a prior non-native request onto Antigravity before any assistant token.
- Forward native request telemetry and usage snapshots when the patched runtime emits them.
