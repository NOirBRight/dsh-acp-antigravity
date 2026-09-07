# Keep native activity independent of Core history

**Status:** accepted for plugin-owned storage, authenticated `activity/read` RPC, and binding enforcement. The original `conversation.view` presentation is superseded; no Antigravity conversation tab is registered. Official Chat and Trajectory views remain unchanged. Supersedes the inline activity presentation in [the native-agent decision](0001-native-agent-on-dsh.md).

DSH owns the basic conversation; the Antigravity plugin owns native activity and runtime bindings in separate versioned storage. The rc1 writer cannot mark external events ignorable, and public inline tool slots require genuine DSH tool calls, so the original presentation used the public `conversation.view` slot rather than custom Core events, fabricated tool calls, package replacement or private hooks. Native activity is now available through authenticated `activity/read` RPC without a separate conversation view. Basic history remains readable independently of the plugin.

## Consequences

Reading activity does not start the runtime or check an account. Continuing a bound session checks its binding through the public `llm/stream` waterfall before invoking another provider; unreadable binding data fails execution closed, not history reading. Removing the plugin removes its activity RPC and binding enforcement, not the basic conversation; missing native binaries prevents native execution without preventing history access.

Activity RPC uses the same full-Host browser authentication as the rc1 session interface; a session identifier is an address, not a credential, and no per-session caller isolation is claimed. Activity storage errors are returned by the activity RPC without blocking Core history reads. Existing Core logs containing unsupported required custom events are not rewritten.

Acceptance requires a new native conversation, Host restart, and reads with the native runtime unavailable; verify the basic conversation independently of plugin rendering and reject execution on an incompatible bound route. No production deployment is authorized by this decision.
