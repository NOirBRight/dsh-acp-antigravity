# Changelog

## [0.1.5] - DSH 0.1.5-rc.1 migration (W1 P4)

- Fix 3082 profile load crash: the settings RPC channel now registers through an injected connection scope instead of the plugin root ctx (missing inject throws fail-loud at apply).

## [Unreleased] - DSH 0.1.5-rc.1 migration (W1 P4)

- Saving the model catalog compares each row with the snapshot the card rendered from, so a first edit to default thinking, vision, thinking, context window, name, or output persists instead of being discarded as "unchanged"; a row the user added persists too.
- Default thinking levels reach the Host model directory: the account-declared default model names its own model's default level, and a saved per-model default is projected instead of only showing in the card. A level the current catalog cannot route is omitted, never sent.
- The missing-providers-page warning waits out a 15s grace period, so a page load that registers the settings section after mount no longer reports a missing owner; a genuine absence still warns once.
- Native tool rows render through the plugin-owned read-only card; the private host GenericToolCard import and the unofficial ui-tool native.1 build (scripts/build-ui-tool.mjs, dsh-ui-tool-native-card.patch) are removed. No official ui-tool package is modified and no core patch is carried.
- Host stream usage chunks carry official TokenUsage keys only: plugin-owned completeness (usageComplete) stays in sidecar telemetry and snapshots, never in host chunks or the session log.
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
