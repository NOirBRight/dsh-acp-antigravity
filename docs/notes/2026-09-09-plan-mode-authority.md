# Plan mode authority

DSH keeps `exit_plan_mode` in the tool catalog while Plan mode is inactive. Catalog presence is not state. Markdown headings and words such as `Proceed` describe content; ACP `plan-update` describes native progress. None authorizes a plan-review question or another native prompt.

The bridge reviews a completed native response only when its host reports the exact session’s logged Plan flag as active. The plugin resolves that flag through `sessionProjections.stateOf(agent.session, 'plan').active`, using the same session agent as question delivery. The Plan controller is isolated inside the agent preset; the host reads its registered projection rather than looking up that controller in the parent realm. Missing plan projection or agent disables review; a failed state read stops the stream.

Explicit Plan mode keeps the Approve / Keep planning interaction. Approval queues Plan off before the approved native continuation. Because the controller is isolated inside the preset, the plugin resolves it through Cordis's public reflection store only when exactly one active Plan controller exists; absence or ambiguity fails closed. The adapter then waits for the public turn-boundary projection to become idle, cancels the queued choice, and commits the same choice through that controller. Refusal leaves Plan active. Native plan updates remain transcript content.

## Verification

Bridge regressions distinguish ordinary first-level headings, `Proceed` / `plan.md`, and ACP progress from an explicitly active session whose draft has no headings. The ordinary cases make one native prompt and no review; active Plan mode reviews and continues only on approval. Existing continuation usage and failed-turn tests use the same authoritative state callback.

The keyless assembled GUI replay uses `scripts/check-user-question-gui.mjs --article`, with the existing local test GUI and environment setup documented in [native question delivery](2026-09-09-native-question-freeform.md). The peer emits a first-level Chinese article title and rejects an unrequested continuation. The `--plan` variant uses the GUI `/plan` prefix and checks that the review card appears. Keep planning leaves Plan active; approval continues natively and commits Plan off after the Host turn becomes idle. Both compare the rendered article with `tests/fixtures/acp-article.expected.md`; no paid model call is required for these regressions.
