# Plan mode authority

DSH keeps `exit_plan_mode` in the tool catalog while Plan mode is inactive. Catalog presence is not state. Markdown headings and words such as `Proceed` describe content; ACP `plan-update` describes native progress. None authorizes a plan-review question or another native prompt.

The bridge reviews a completed native response only when its host reports the exact session’s logged Plan flag as active. The plugin resolves that flag through `sessionProjections.stateOf(agent.session, 'plan').active`, using the same session agent as question delivery. The Plan controller is isolated inside the agent preset; the host reads its registered projection rather than looking up that controller in the parent realm. Pending selections apply at the next accepted pre-step and do not reclassify the current response. Missing plan projection or agent disables review; a failed state read stops the stream.

Explicit Plan mode keeps the existing Approve / Keep planning interaction and its approved native continuation. This change does not alter the existing Plan-mode exit transition behavior. Native plan updates remain transcript content.

## Verification

Bridge regressions distinguish ordinary first-level headings, `Proceed` / `plan.md`, and ACP progress from an explicitly active session whose draft has no headings. The ordinary cases make one native prompt and no review; active Plan mode reviews and continues only on approval. Existing continuation usage and failed-turn tests use the same authoritative state callback.

The keyless assembled GUI replay uses `scripts/check-user-question-gui.mjs --article`, with the existing local test GUI and environment setup documented in [native question delivery](2026-09-09-native-question-freeform.md). The peer emits a first-level Chinese article title and rejects an unrequested continuation. The `--plan` variant uses the GUI `/plan` prefix, checks that the review card appears, chooses Keep planning, and switches Plan mode off after completion. Both compare the rendered article with `tests/fixtures/acp-article.expected.md`; no paid model call is required for these regressions.
