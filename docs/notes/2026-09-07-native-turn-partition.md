# Native turn partition by loaded Chat starts

Per-turn containers share one session-scoped native history subscription and partition rows by firstSeenAt against loaded Chat turn starts (public uiConversation binding, target "chat"). The earliest loaded turn includes earlier records; each following turn takes [start, nextStart); the last turn is unbounded to now. Rows outside the actual Core [start, end) render "Recorded between turns; turn ownership unavailable" and are never assigned to the current turn. Late tool updates keep firstSeenAt, so rows never move or duplicate when the next turn loads; trailing records after a turn ends arrive while any native view stays mounted.

Regression checks: tests/native-turn.test.ts, tests/native-turn-container.test.ts, tests/native-activity.test.ts, tests/web-registration.test.ts. Live Chat placement requires verification on the existing GUI before release.
