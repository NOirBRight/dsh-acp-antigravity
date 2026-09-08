# Keep native activity independent of Core history

**Status:** accepted for plugin-owned storage, authenticated `activity/read` RPC, binding enforcement, and read-only per-turn Chat containers. No Antigravity conversation tab is registered. Supersedes the inline activity presentation in [the native-agent decision](0001-native-agent-on-dsh.md).

DSH owns the basic conversation; the Antigravity plugin owns native activity and runtime bindings in separate versioned storage. The rc1 writer cannot mark external events ignorable, and public inline tool slots require genuine DSH tool calls, so the original presentation used the public `conversation.view` slot rather than custom Core events, fabricated tool calls, package replacement or private hooks. Native activity is available through authenticated `activity/read` RPC. A plugin-owned Chat container folds standard `turn/start` and `turn/end` events and reads the sidecar for that turn; it writes no Core events and creates no executable tool calls. Rows retain their first-observed turn when results arrive later. Basic history remains readable independently of the plugin.

## Consequences

Reading activity does not start the runtime or check an account. Continuing a bound session checks its binding through the public `llm/stream` waterfall before invoking another provider; unreadable binding data fails execution closed, not history reading. Removing the plugin removes its activity RPC and binding enforcement, not the basic conversation; missing native binaries prevents native execution without preventing history access.

Activity RPC uses the same full-Host browser authentication as the rc1 session interface; a session identifier is an address, not a credential, and no per-session caller isolation is claimed. Activity storage errors are returned by the activity RPC without blocking Core history reads. Existing Core logs containing unsupported required custom events are not rewritten.

Ready records may include a native reference whose opaque cursor is bound to the account profile and workspace. History without that cursor remains readable but is not resumable. Unreadable bindings, incompatible configuration, and failed native resume reject execution without opening a replacement context. Full-access authorization is audited in the sidecar before execution; it does not alter tool or trajectory ownership.

Acceptance requires a new native conversation, Host restart, and reads with the native runtime unavailable; verify the basic conversation independently of plugin rendering and reject execution on an incompatible bound route. No production deployment is authorized by this decision.
