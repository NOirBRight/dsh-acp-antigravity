# Native token accounting and request throughput

The pinned SDK prompt and total counters exclude cache. Native ACP aggregate input and total add the cache delta; the adapter then separates cache exactly once. Unknown cache cannot form ACP aggregate usage. Provisional SDK observations can retain known uncached input/output while omitting unknown cache and total. Only a declared fresh session establishes a zero baseline for missing start fields; restored sessions and counter rewinds do not.

Live observations carry `usageComplete: false`. Final same-attempt reports replace provisional counts; distinct native prompts add reported counts while retaining partiality. Cancellation preserves only observations delivered before the host expires. Missing historical counters and request spans are not reconstructed from wall time.

Child-owned text (`parentTrajectoryId` set and different from `trajectoryId`) stays in the sidecar and child panel, not the parent assistant stream. Request telemetry is native-session scoped, not child-attributed.

`generationElapsedMs` stays `null`. `requestThroughput` pairs raw completed-request output with its measured span, including queue/prefill/TTFT, and sums concurrent durations rather than wall time. It is not decode throughput and does not subtract tool waits from a turn.

Missing or partial usage hides the session cache-hit share and displays partial statistics. Per-turn partial reports disclose the same limitation in usage and time dialogs. A complete explicit cache zero remains 0%.

Regression evidence belongs to the native patch checkers, SDK/bridge usage tests, owning token folds, and assembled GUI snapshots. Actual native usage and the existing 3082 GUI require live verification independently of mocked examples or archive loader checks.
