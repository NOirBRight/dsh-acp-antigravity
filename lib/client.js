window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-acp-antigravity",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let _deepseek_ai_dsh_client_ui_tool_client = require("@deepseek-ai/dsh-client-ui-tool/client");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client-contract.ts
		/** Browser-safe RPC contract for the External Agents settings page. */
		const ACP_SETTINGS_RPC_CHANNEL = "/dsh-acp-antigravity";
		const SNAPSHOT_ENDPOINT = "snapshot";
		const SAVE_ENDPOINT = "save";
		const PICK_ENDPOINT = "pick";
		const QUOTA_ENDPOINT = "quota";
		function isRecord$1(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value);
		}
		/** Decode a Settings snapshot from the host RPC. */
		function decodeSnapshot(value) {
			if (!isRecord$1(value) || value.title !== "External Agents" || !Array.isArray(value.rows)) return void 0;
			const rows = [];
			for (const row of value.rows) {
				if (!isRecord$1(row)) return void 0;
				if (typeof row.provider !== "string" || typeof row.instanceId !== "string" || typeof row.title !== "string") return void 0;
				if (typeof row.enabled !== "boolean" || typeof row.executablePath !== "string" || typeof row.harnessPath !== "string") return void 0;
				if (typeof row.stateDirectory !== "string" || typeof row.installed !== "boolean" || typeof row.authenticated !== "boolean") return void 0;
				if (typeof row.live !== "boolean" || typeof row.ready !== "boolean" || !Array.isArray(row.models)) return void 0;
				const models = [];
				for (const model of row.models) {
					if (!isRecord$1(model) || typeof model.id !== "string" || typeof model.name !== "string") return void 0;
					models.push({
						id: model.id,
						name: model.name
					});
				}
				rows.push({
					provider: row.provider,
					instanceId: row.instanceId,
					title: row.title,
					enabled: row.enabled,
					executablePath: row.executablePath,
					harnessPath: row.harnessPath,
					stateDirectory: row.stateDirectory,
					...typeof row.model === "string" ? { model: row.model } : {},
					models,
					installed: row.installed,
					authenticated: row.authenticated,
					live: row.live,
					ready: row.ready,
					...typeof row.message === "string" ? { message: row.message } : {},
					...typeof row.version === "string" ? { version: row.version } : {},
					...typeof row.profileDirectory === "string" ? { profileDirectory: row.profileDirectory } : {},
					...typeof row.authorizationUrl === "string" ? { authorizationUrl: row.authorizationUrl } : {}
				});
			}
			const install = isRecord$1(value.install) && typeof value.install.phase === "string" && typeof value.install.message === "string" && typeof value.install.downloadedBytes === "number" && typeof value.install.totalBytes === "number" ? {
				phase: value.install.phase,
				downloadedBytes: value.install.downloadedBytes,
				totalBytes: value.install.totalBytes,
				message: value.install.message
			} : void 0;
			return {
				title: "External Agents",
				rows,
				...install === void 0 ? {} : { install },
				...value.signingIn === true ? { signingIn: true } : {}
			};
		}
		function optionalString(record, key) {
			const value = record[key];
			return typeof value === "string" ? value : void 0;
		}
		function decodeQuotaBucket(value) {
			if (!isRecord$1(value)) return void 0;
			const remainingFraction = typeof value.remainingFraction === "number" && Number.isFinite(value.remainingFraction) ? value.remainingFraction : void 0;
			const remainingAmount = typeof value.remainingAmount === "string" || typeof value.remainingAmount === "number" ? String(value.remainingAmount) : void 0;
			const disabled = typeof value.disabled === "boolean" ? value.disabled : void 0;
			const bucketId = optionalString(value, "bucketId");
			const displayName = optionalString(value, "displayName");
			const description = optionalString(value, "description");
			const window = optionalString(value, "window");
			const resetTime = optionalString(value, "resetTime");
			return {
				...bucketId === void 0 ? {} : { bucketId },
				...displayName === void 0 ? {} : { displayName },
				...description === void 0 ? {} : { description },
				...window === void 0 ? {} : { window },
				...remainingFraction === void 0 ? {} : { remainingFraction },
				...remainingAmount === void 0 ? {} : { remainingAmount },
				...disabled === void 0 ? {} : { disabled },
				...resetTime === void 0 ? {} : { resetTime }
			};
		}
		/** Decode a quota snapshot from the host RPC. */
		function decodeQuotaSnapshot(value) {
			if (!isRecord$1(value)) return void 0;
			const status = value.status;
			if (status !== "ready" && status !== "authentication-required" && status !== "not-entitled" && status !== "account-changed" && status !== "error") return void 0;
			if (typeof value.observedAt !== "string" || !Array.isArray(value.groups)) return void 0;
			const groups = [];
			for (const group of value.groups) {
				if (!isRecord$1(group) || !Array.isArray(group.buckets)) return void 0;
				const buckets = [];
				for (const bucket of group.buckets) {
					const decoded = decodeQuotaBucket(bucket);
					if (decoded === void 0) return void 0;
					buckets.push(decoded);
				}
				const displayName = optionalString(group, "displayName");
				const description = optionalString(group, "description");
				groups.push({
					...displayName === void 0 ? {} : { displayName },
					...description === void 0 ? {} : { description },
					buckets
				});
			}
			const tier = isRecord$1(value.tier) ? value.tier : void 0;
			const current = tier === void 0 ? void 0 : optionalString(tier, "current");
			const paid = tier === void 0 ? void 0 : optionalString(tier, "paid");
			const message = optionalString(value, "message");
			return {
				status,
				groups,
				observedAt: value.observedAt,
				...current === void 0 && paid === void 0 ? {} : { tier: {
					...current === void 0 ? {} : { current },
					...paid === void 0 ? {} : { paid }
				} },
				...message === void 0 ? {} : { message }
			};
		}
		//#endregion
		//#region src/decode.ts
		/** Return whether a wire value is a plain JSON object. */
		function isRecord(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value);
		}
		/** Return a non-empty wire string. */
		function stringValue(value) {
			return typeof value === "string" && value.length > 0 ? value : void 0;
		}
		/** Validate one decoded _meta ownership bag.
		* @param value - The agy.trajectory bag, if present.
		* @returns True for a usable linkage: non-empty ids and a non-negative depth.
		*/
		function isToolOwnership(value) {
			if (!isRecord(value)) return false;
			if (stringValue(value.trajectoryId) === void 0) return false;
			const parent = value.parentTrajectoryId;
			if (parent !== void 0 && stringValue(parent) === void 0) return false;
			const depth = value.depth;
			return depth === void 0 || typeof depth === "number" && Number.isSafeInteger(depth) && depth >= 0;
		}
		/**
		* Fold one tool event in ascending session-log order.
		* @param state - Current row state, if its start is already loaded.
		* @param event - Next event for this row; agent-observed descriptors fold independently.
		* @returns The new row state.
		*/
		function foldAntigravityToolEvent(state, event) {
			if (event.type === "antigravity/agent-observed") throw new Error("Antigravity agent-observed is not a tool row event");
			if (event.type === "antigravity/tool-start") {
				if (state !== void 0) throw new Error("Antigravity tool start repeats toolId " + state.toolId);
				return event.data;
			}
			if (state === void 0) return {
				toolId: event.data.toolId,
				name: event.data.name ?? "native tool",
				status: event.data.status,
				...event.data.ownership === void 0 ? {} : { ownership: event.data.ownership },
				...event.data.location === void 0 ? {} : { location: event.data.location },
				...event.data.input === void 0 ? {} : { input: event.data.input },
				...event.data.output === void 0 ? {} : { output: event.data.output },
				...event.data.error === void 0 ? {} : { error: event.data.error }
			};
			if (event.data.toolId !== state.toolId) throw new Error("Antigravity tool update carries foreign toolId " + event.data.toolId);
			return {
				...state,
				...event.data.name === void 0 ? {} : { name: event.data.name },
				status: event.data.status,
				...event.data.ownership === void 0 ? {} : { ownership: event.data.ownership },
				...event.data.location === void 0 ? {} : { location: event.data.location },
				...event.data.input === void 0 ? {} : { input: event.data.input },
				...event.data.output === void 0 ? {} : { output: event.data.output },
				...event.data.error === void 0 ? {} : { error: event.data.error }
			};
		}
		//#endregion
		//#region src/activity-contract.ts
		/** Settings-channel endpoint returning one session history. */
		const ACTIVITY_ENDPOINT = "activity/read";
		/** Decode a history snapshot, throwing on any invalid version or record.
		* @param value - Wire snapshot claiming { version, records }.
		* @returns The validated history.
		*/
		function decodeActivityHistory(value) {
			if (!isRecord(value)) throw corrupt("history is not an object");
			if (value.version !== 1) throw corrupt("history has an unknown version");
			if (!Array.isArray(value.records)) throw corrupt("history has invalid records");
			return {
				version: 1,
				records: value.records.map((record, index) => decodeRecordValue(withVersion(record, index + 1), index + 1))
			};
		}
		function withVersion(record, seq) {
			if (!isRecord(record)) throw corrupt("line " + String(seq) + " is not an object");
			return {
				...record,
				v: 1
			};
		}
		function corrupt(reason) {
			return /* @__PURE__ */ new Error("Antigravity activity history is corrupt: " + reason);
		}
		function decodeRecordValue(value, seq) {
			if (!isRecord(value)) throw corrupt("line " + String(seq) + " is not an object");
			if (value.v !== 1) throw corrupt("line " + String(seq) + " has an unknown version");
			if (value.seq !== seq) throw corrupt("line " + String(seq) + " breaks the sequence");
			const time = value.time;
			if (typeof time !== "string" || Number.isNaN(Date.parse(time))) throw corrupt("line " + String(seq) + " has an invalid time");
			const type = value.type;
			if (type === "antigravity/full-access-authorized" && isRecord(value.data) && stringValue(value.data.provider) !== void 0 && stringValue(value.data.session) !== void 0 && value.data.mode === "full-access" && (value.data.auditId === void 0 || stringValue(value.data.auditId) !== void 0)) return {
				seq,
				time,
				type,
				data: value.data
			};
			if (type === "antigravity/session-ready" && isSessionReadyData(value.data)) return {
				seq,
				time,
				type,
				data: value.data
			};
			if (type === "antigravity/tool-start" && isToolStartData(value.data)) return {
				seq,
				time,
				type,
				data: value.data
			};
			if (type === "antigravity/tool-update" && isToolUpdateData(value.data)) return {
				seq,
				time,
				type,
				data: value.data
			};
			if (type === "antigravity/agent-observed" && isToolOwnership(value.data)) return {
				seq,
				time,
				type,
				data: value.data
			};
			throw corrupt("line " + String(seq) + " has an unknown type or data");
		}
		function isSessionReadyData(value) {
			if (!isRecord(value) || value.provider !== "antigravity") return false;
			if (value.ref === void 0) return true;
			const ref = value.ref;
			if (!isRecord(ref) || stringValue(ref.provider) === void 0 || stringValue(ref.session) === void 0 || ref.nativeSession !== void 0 && stringValue(ref.nativeSession) === void 0) return false;
			const cursor = ref.resumeCursor;
			return cursor === void 0 || isRecord(cursor) && cursor.provider === ref.provider && stringValue(cursor.value) !== void 0;
		}
		function isToolStatus(value) {
			return value === "pending" || value === "running" || value === "completed" || value === "failed";
		}
		function isToolLocation(value) {
			return isRecord(value) && stringValue(value.target) !== void 0 && (value.kind === "file" || value.kind === "url");
		}
		function isToolStartData(value) {
			if (!isRecord(value)) return false;
			if (stringValue(value.toolId) === void 0 || stringValue(value.name) === void 0) return false;
			if (!isToolStatus(value.status)) return false;
			if (value.input !== void 0 && typeof value.input !== "string") return false;
			if (value.location !== void 0 && !isToolLocation(value.location)) return false;
			return value.ownership === void 0 || isToolOwnership(value.ownership);
		}
		function isToolUpdateData(value) {
			if (!isRecord(value)) return false;
			if (stringValue(value.toolId) === void 0 || !isToolStatus(value.status)) return false;
			if (value.name !== void 0 && stringValue(value.name) === void 0) return false;
			if (value.input !== void 0 && typeof value.input !== "string") return false;
			if (value.location !== void 0 && !isToolLocation(value.location)) return false;
			if (value.output !== void 0 && typeof value.output !== "string") return false;
			if (value.error !== void 0 && typeof value.error !== "string") return false;
			return value.ownership === void 0 || isToolOwnership(value.ownership);
		}
		//#endregion
		//#region src/web/native-activity.ts
		/** Fold plugin-owned native tool history into transcript rows.
		*
		* Pure browser-safe fold over the activity/read sidecar: one row per native
		* tool launch, oldest first. A launch completion (or failure) is the launch
		* tool's own outcome; it never claims a child outcome, and no row is ever
		* inferred from thought text. Reuses the canonical fold, so display state
		* cannot drift from durable state.
		*/
		/** Fold first observations independently of tool launches, including zero-tool children.
		* @param records - Decoded sidecar history in sequence order.
		* @returns Agent observations scoped to native runtime epochs.
		*/
		function foldAgentRecords(records) {
			const agents = /* @__PURE__ */ new Map();
			let epoch = 0;
			for (const record of records) {
				if (record.type === "antigravity/session-ready") {
					epoch += 1;
					continue;
				}
				if (record.type !== "antigravity/agent-observed") continue;
				const key = `${epoch}\n${record.data.trajectoryId}`;
				if (!agents.has(key)) agents.set(key, {
					key: String(record.seq),
					epoch,
					firstSeenAt: record.time,
					ownership: record.data
				});
			}
			return [...agents.values()];
		}
		/** Fold history records into display rows, oldest first.
		* Native tool ids can repeat across startups: the (epoch, tool id) pair only
		* routes updates, while every new row keys on its record seq, so ids
		* containing newlines can never collide.
		* @param records - Decoded history records in seq order.
		* @returns Display rows, oldest first, keyed by record seq.
		*/
		function foldActivityRecords(records) {
			const rows = [];
			const indexById = /* @__PURE__ */ new Map();
			let epoch = 0;
			for (const record of records) {
				if (record.type === "antigravity/session-ready") {
					epoch += 1;
					continue;
				}
				if (record.type === "antigravity/agent-observed" || record.type === "antigravity/full-access-authorized") continue;
				const id = String(epoch) + "\n" + record.data.toolId;
				if (record.type === "antigravity/tool-start") {
					indexById.set(id, rows.length);
					rows.push({
						key: String(record.seq),
						epoch,
						state: record.data,
						time: record.time,
						firstSeenAt: record.time
					});
					continue;
				}
				const index = indexById.get(id);
				if (index === void 0) {
					indexById.set(id, rows.length);
					rows.push({
						key: String(record.seq),
						epoch,
						state: foldAntigravityToolEvent(void 0, {
							type: record.type,
							data: record.data
						}),
						time: record.time,
						firstSeenAt: record.time
					});
					continue;
				}
				const current = rows[index];
				if (current === void 0) continue;
				current.state = foldAntigravityToolEvent(current.state, {
					type: record.type,
					data: record.data
				});
				current.time = record.time;
			}
			return rows.filter((row) => row.state.status !== "pending" || row.state.ownership !== void 0);
		}
		/** Read one session history over RPC and fold it into rows.
		* Throws fail-closed on transport failure or corrupt history; aborts
		* propagate so the caller can drop stale generations.
		* @param rpc - Logical-channel RPC face.
		* @param sessionId - DSH session scoping the sidecar read.
		* @param signal - Caller cancellation for a superseded session or unmount.
		* @returns Folded tools and observed agents for this session only.
		*/
		async function loadActivityHistory(rpc, sessionId, signal) {
			const result = await rpc.call(ACP_SETTINGS_RPC_CHANNEL, ACTIVITY_ENDPOINT, { sessionId }, signal);
			if (!result.ok) throw new Error(result.error?.message ?? "Antigravity activity history is unavailable");
			const { records } = decodeActivityHistory(result.value);
			return {
				rows: foldActivityRecords(records),
				agents: foldAgentRecords(records)
			};
		}
		/** Poll interval for the session-scoped native history subscription. */
		const NATIVE_HISTORY_POLL_MS = 1e3;
		/** One entry per live connection and session: keying by the RPC face keeps
		* concurrent connections from sharing or resurrecting each other's history.
		* Entries are lightweight once unsubscribed (empty snapshot, no timer), so
		* React StrictMode remounts reuse them without holding full histories.
		*/
		const nativeHistoryStores = /* @__PURE__ */ new WeakMap();
		function entryFor(rpc, sessionId) {
			let bySession = nativeHistoryStores.get(rpc);
			if (bySession === void 0) {
				bySession = /* @__PURE__ */ new Map();
				nativeHistoryStores.set(rpc, bySession);
			}
			let entry = bySession.get(sessionId);
			if (entry === void 0) {
				entry = {
					snapshot: {
						rows: [],
						agents: []
					},
					listeners: /* @__PURE__ */ new Set(),
					timer: void 0,
					controller: void 0
				};
				bySession.set(sessionId, entry);
			}
			return entry;
		}
		function notifyEntry(entry) {
			for (const listener of [...entry.listeners]) listener();
		}
		async function pollNativeHistory(sessionId, entry, rpc) {
			if (entry.controller !== void 0 || entry.listeners.size === 0) return;
			const controller = new AbortController();
			entry.controller = controller;
			try {
				const snapshot = await loadActivityHistory(rpc, sessionId, controller.signal);
				if (entry.controller !== controller) return;
				entry.snapshot = snapshot;
			} catch (caught) {
				if (entry.controller !== controller) return;
				const message = caught instanceof Error ? caught.message : "Antigravity activity history is unavailable";
				entry.snapshot = {
					...entry.snapshot,
					error: message
				};
			} finally {
				if (entry.controller !== controller) return;
				entry.controller = void 0;
			}
			notifyEntry(entry);
			scheduleNativeHistory(sessionId, entry, rpc);
		}
		function scheduleNativeHistory(sessionId, entry, rpc) {
			if (entry.listeners.size === 0) return;
			if (entry.timer !== void 0) return;
			entry.timer = setTimeout(() => {
				entry.timer = void 0;
				pollNativeHistory(sessionId, entry, rpc);
			}, NATIVE_HISTORY_POLL_MS);
		}
		/** Session-scoped abortable subscription over native history: one poll loop
		* per connection and session no matter how many turn containers mount, so
		* trailing records after a turn ends still arrive while any native view stays
		* mounted. Late tool updates never move rows (partition keys on firstSeenAt).
		* Refresh and resubscribe cancel the active read and start a new one, so a
		* superseded promise can never stall the loop. No new framework dependency:
		* plain subscribe/getSnapshot for useSyncExternalStore.
		* @param rpc - Logical-channel RPC face scoping the store lifetime.
		* @param sessionId - DSH session scoping the sidecar read.
		* @returns Shared subscribe/getSnapshot/refresh triple.
		*/
		function getNativeHistoryStore(rpc, sessionId) {
			const entry = entryFor(rpc, sessionId);
			return {
				subscribe: (listener) => {
					entry.listeners.add(listener);
					if (entry.listeners.size === 1) pollNativeHistory(sessionId, entry, rpc);
					else scheduleNativeHistory(sessionId, entry, rpc);
					return () => {
						entry.listeners.delete(listener);
						if (entry.listeners.size === 0) {
							if (entry.timer !== void 0) {
								clearTimeout(entry.timer);
								entry.timer = void 0;
							}
							entry.controller?.abort();
							entry.controller = void 0;
							entry.snapshot = {
								rows: [],
								agents: []
							};
						}
					};
				},
				getSnapshot: () => entry.snapshot,
				refresh: () => {
					entry.controller?.abort();
					entry.controller = void 0;
					if (entry.timer !== void 0) {
						clearTimeout(entry.timer);
						entry.timer = void 0;
					}
					if (entry.listeners.size > 0) pollNativeHistory(sessionId, entry, rpc);
				}
			};
		}
		//#endregion
		//#region src/web/native-turn.ts
		/** Folded row definition registered on the Chat conversation target. */
		const nativeTurnDefinition = {
			kind: "antigravity-native",
			target: "chat",
			match: (event) => {
				if (event.type === "turn/start") return {
					id: String(event.data.turn),
					role: "start"
				};
				if (event.type === "turn/end") return {
					id: String(event.data.turn),
					role: "update"
				};
				return null;
			},
			start: (context, match) => {
				if (match.event.type !== "turn/start") throw new Error("Antigravity native turn starts on turn/start");
				return {
					turn: match.event.data.turn,
					startMs: match.event.time,
					endMs: null
				};
			},
			update: (context, match) => match.event.type === "turn/end" ? {
				...context.state,
				endMs: match.event.time
			} : context.state,
			publication: () => "immediate",
			buildViewNode: (context) => {
				if (context.state === void 0) return null;
				return {
					key: context.key,
					kind: "antigravity-native",
					id: context.id,
					target: "chat",
					anchorSeq: anchorOf(context),
					location: context.start?.location ?? context.matches[0]?.location ?? { kind: "unresolved" },
					visibility: "visible",
					data: context.state
				};
			}
		};
		/** Next loaded turn start after the current turn, or null when current is last/unknown.
		* @param orderedStarts - Loaded turn starts in timeline order.
		* @param currentTurn - Turn number owning the querying container.
		* @returns Next start wall clock, or null.
		*/
		function nextStartMs(orderedStarts, currentTurn) {
			const index = orderedStarts.findIndex((item) => item.turn === currentTurn);
			if (index < 0) return null;
			return orderedStarts[index + 1]?.startMs ?? null;
		}
		/** Whether a row is owned by its turn's actual Core window (vs recorded between turns).
		* @param firstSeenMs - Row firstSeenAt wall clock.
		* @param startMs - Owning turn/start wall clock.
		* @param endMs - Owning turn/end wall clock, or null for the open turn.
		* @returns True when the row falls inside Core [start, end).
		*/
		function isOwnedByTurn(firstSeenMs, startMs, endMs) {
			if (!Number.isFinite(firstSeenMs) || !Number.isFinite(startMs)) return false;
			if (firstSeenMs < startMs) return false;
			return endMs === null || firstSeenMs < endMs;
		}
		/** Rows partitioned to one turn by loaded starts, oldest first.
		* Later tool updates do not move a row into another turn (callers pass
		* firstSeenAt-derived rows). The earliest loaded turn may include earlier
		* records (explicitly unassigned); each following turn takes
		* [start, nextStart); the last turn is unbounded to now. Gaps and trailing
		* records therefore never vanish, and loading the next turn re-partitions
		* without duplicates.
		* @param rows - Folded session rows in seq order.
		* @param startMs - Owning turn/start wall clock.
		* @param nextStartMsValue - Next loaded turn/start wall clock, or null for last/unknown.
		* @param nowMs - Now for the open-ended window; defaults to the wall clock.
		* @param includeEarlier - True for the earliest loaded turn: include records before startMs.
		* @returns The owning turn's rows.
		*/
		function rowsForTurnWindow(rows, startMs, nextStartMsValue, nowMs = Date.now(), includeEarlier = false) {
			return rows.filter((row) => {
				const ms = Date.parse(row.firstSeenAt);
				if (!Number.isFinite(ms)) return false;
				if (!includeEarlier && ms < startMs) return false;
				if (nextStartMsValue !== null) return ms < nextStartMsValue;
				return ms <= nowMs;
			});
		}
		function anchorOf(context) {
			const seq = context.start?.event.seq ?? context.matches[0]?.event.seq;
			return typeof seq === "number" && Number.isFinite(seq) ? seq : 0;
		}
		//#endregion
		//#region src/web/native-tool-card.ts
		/** Known native tool name (after separator folding) to canonical wire name. */
		const NATIVE_TOOL_NAMES = {
			"run command": "bash",
			"view file": "read",
			"read file": "read",
			"fetch page": "web_fetch",
			fetch: "web_fetch",
			search: "web_search",
			grep: "grep",
			glob: "glob",
			"write file": "write",
			"edit file": "edit"
		};
		/** Native argument aliases to canonical DSH argument keys, each verified
		* against the card models that read them: command feeds the terminal shell
		* call, file_path is what the read model requires (path alone never
		* qualifies), url feeds web_fetch and renders as summary text without result
		* metadata. Unknown keys survive verbatim. */
		const ARG_KEY_ALIASES = {
			CommandLine: "command",
			commandLine: "command",
			command_line: "command",
			AbsolutePath: "file_path",
			URL: "url",
			uri: "url"
		};
		/** Path-ish keys a location fallback must not override. */
		const PATH_KEYS = [
			"path",
			"file_path",
			"directory_path"
		];
		function foldName(name) {
			return name.trim().replace(/[_-]+/gu, " ").replace(/\s+/gu, " ").toLowerCase();
		}
		function parseRecord(raw) {
			try {
				const value = JSON.parse(raw);
				return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
			} catch {
				return;
			}
		}
		/**
		* Map a recorded native tool name to its canonical DSH wire name. Declared
		* name table only: an unknown name stays verbatim no matter how suggestive
		* its arguments look, so a row never claims an unrelated tool.
		* @param name - name recorded on the sidecar start event.
		* @returns the canonical wire name, or the recorded name verbatim when unknown.
		*/
		function nativeToolName(name) {
			const folded = foldName(name.startsWith("Running ") ? name.slice(8) : name);
			const known = NATIVE_TOOL_NAMES[folded];
			if (known !== void 0) return known;
			if (folded === "grep" || folded.startsWith("grep ")) return "grep";
			if (folded === "glob" || folded.startsWith("glob ")) return "glob";
			return name;
		}
		/**
		* Build the canonical args JSON for one folded row. Known native keys move to
		* their canonical slots; every other key survives verbatim, so unknowns keep
		* their data. A sidecar location fills a missing path/url on a structured
		* args object only: raw non-JSON input passes through untouched (the generic
		* summary and body read it verbatim), and then a location has no canonical
		* slot — the output text still carries the readable result.
		* @param state - folded native row state.
		* @returns argsRaw for the presentation block: canonical JSON or raw input.
		*/
		function nativeToolArgs(state) {
			if (state.input === void 0) {
				if (state.location === void 0) return "";
				return JSON.stringify(state.location.kind === "file" ? { path: state.location.target } : { url: state.location.target });
			}
			const parsed = parseRecord(state.input);
			if (parsed === void 0) return state.input;
			const args = {};
			for (const [key, value] of Object.entries(parsed)) {
				const canonical = ARG_KEY_ALIASES[key] ?? key;
				if (args[canonical] === void 0) args[canonical] = value;
			}
			const location = state.location;
			if (location !== void 0) {
				if (location.kind === "file" && !PATH_KEYS.some((key) => typeof args[key] === "string" && args[key] !== "")) args.path = location.target;
				if (location.kind === "url" && typeof args.url !== "string") args.url = location.target;
			}
			return JSON.stringify(args);
		}
		/**
		* Build presentation props for one folded row: the normalized wire name plus a
		* running block while pending/running, or a settled block honoring the actual
		* outcome (failed settles isError, completed does not). The verbatim native
		* name rides along for accessibility wherever the canonical label renames it;
		* the row itself renders the exact native card with no second title slot.
		* No result metadata is ever synthesized, so rich cards trigger only off
		* genuine canonical arguments.
		* @param state - folded native row state.
		* @param timeMs - row wall clock for the block timestamps; defaults to 0.
		* @returns wire name, verbatim native name and tool id, and the presentation-only block.
		*/
		function nativeToolBlock(state, timeMs = 0) {
			const toolName = nativeToolName(state.name);
			const argsRaw = nativeToolArgs(state);
			const callId = state.toolId;
			if (state.status !== "completed" && state.status !== "failed") return {
				toolName,
				nativeName: state.name,
				callId,
				block: {
					callId,
					name: toolName,
					argsRaw,
					turn: 0,
					step: 0,
					time: timeMs,
					subCalls: []
				}
			};
			const text = state.status === "failed" ? state.error ?? state.output ?? "" : state.output ?? state.error ?? "";
			return {
				toolName,
				nativeName: state.name,
				callId,
				block: {
					kind: "tool-result",
					seq: 0,
					time: timeMs,
					callId,
					call: {
						name: toolName,
						argsRaw
					},
					callTime: null,
					content: text === "" ? [] : [{
						type: "text",
						text
					}],
					isError: state.status === "failed",
					subCalls: []
				}
			};
		}
		//#endregion
		//#region src/web/AntigravityToolNode.tsx
		/** One folded tool row as the exact native DSH card. */
		function AntigravityToolNode({ row, t }) {
			const parsed = Date.parse(row.firstSeenAt);
			const { toolName, callId, block } = nativeToolBlock(row.state, Number.isFinite(parsed) ? parsed : 0);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_tool_client.GenericToolCard, {
				callId,
				toolName,
				block,
				t
			});
		}
		//#endregion
		//#region src/web/NativeActivityNode.tsx
		/** Display native child trajectories using the shared DSH disclosure chrome. */
		function NativeSubagentNode({ branch, ...labels }) {
			const [open, setOpen] = (0, react.useState)(false);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
				"data-native-subagent": branch.key,
				"data-native-trajectory": branch.trajectoryId,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.DisclosureRow, {
					icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconAgentPresetOutline16, { size: 14 }),
					title: `${labels.t("activitySubagent")} · ${branch.trajectoryId.slice(0, 8)}`,
					open,
					expandable: true,
					expandOnRowClick: true,
					keepContentWhenOpen: true,
					onToggle: () => {
						setOpen((value) => !value);
					},
					collapsedContent: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: { color: "var(--dsw-alias-label-tertiary)" },
						children: labels.t("activityTools").replace("{count}", String(branch.toolCount))
					}),
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							paddingInlineStart: 16,
							borderInlineStart: "1px solid var(--dsw-alias-border-l2)"
						},
						children: [branch.children.map((child) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NativeActivityNode, {
							branch: child,
							...labels
						}, child.key)), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								fontSize: 12,
								color: "var(--dsw-alias-label-tertiary)"
							},
							children: labels.t("activityChildUnknown")
						})]
					})
				})
			});
		}
		/** Render one native tool or child group; children are never repeated as root rows.
		* @param props - Grouped activity and the separate native/conversation locale seats.
		* @returns A canonical tool card or a initially collapsed child trajectory.
		*/
		function NativeActivityNode({ branch, ...labels }) {
			switch (branch.kind) {
				case "tool": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					title: branch.row.state.name,
					"data-native-tool-id": branch.row.state.toolId,
					"data-native-trajectory": branch.row.state.ownership?.trajectoryId,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AntigravityToolNode, {
						row: branch.row,
						t: labels.conversationT
					})
				});
				case "agent": return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NativeSubagentNode, {
					branch,
					...labels
				});
			}
			return branch;
		}
		//#endregion
		//#region src/web/native-tree.ts
		/** Group child tools exactly once by native trajectory within a runtime epoch.
		* Missing or conflicting ancestry stays at the root; cycles are cut without losing rows.
		* @param rows - Folded native activity in first-seen order.
		* @param observations - First child sightings, including agents that emit no tools.
		* @returns Ordered root tools and recursively nested, independent child trajectories.
		*/
		function groupNativeActivity(rows, observations = []) {
			const agents = /* @__PURE__ */ new Map();
			const parents = /* @__PURE__ */ new Map();
			const conflicts = /* @__PURE__ */ new Set();
			const keyOf = (row, trajectory) => `${row.epoch}\n${trajectory}`;
			const points = [...observations, ...rows.flatMap((row) => row.state.ownership === void 0 ? [] : [{
				...row,
				ownership: row.state.ownership
			}])];
			points.sort((a, b) => Number(a.key) - Number(b.key));
			for (const row of points) {
				const order = Number(row.key);
				const owner = row.ownership;
				const key = keyOf(row, owner.trajectoryId);
				const parent = owner.parentTrajectoryId === void 0 ? void 0 : keyOf(row, owner.parentTrajectoryId);
				if (parent !== void 0) {
					if (parents.has(key) && parents.get(key) !== parent) conflicts.add(key);
					else parents.set(key, parent);
				}
				if ((parent !== void 0 || (owner.depth ?? 0) > 0) && !agents.has(key)) agents.set(key, {
					kind: "agent",
					key,
					trajectoryId: owner.trajectoryId,
					firstSeenAt: row.firstSeenAt,
					order,
					toolCount: 0,
					children: []
				});
			}
			for (const [key] of agents) {
				const parent = parents.get(key);
				if (conflicts.has(key) || parent === key || parent === void 0 || !agents.has(parent)) parents.delete(key);
			}
			const done = /* @__PURE__ */ new Set();
			for (const key of agents.keys()) {
				const path = /* @__PURE__ */ new Set();
				let cursor = key;
				while (cursor !== void 0 && !done.has(cursor)) {
					if (path.has(cursor)) {
						parents.delete(cursor);
						break;
					}
					path.add(cursor);
					cursor = parents.get(cursor);
				}
				for (const visited of path) done.add(visited);
			}
			const roots = [];
			for (const row of rows) {
				const order = Number(row.key);
				const owner = row.state.ownership;
				const agent = owner === void 0 ? void 0 : agents.get(keyOf(row, owner.trajectoryId));
				const branch = {
					kind: "tool",
					key: row.key,
					row,
					order
				};
				if (agent === void 0) roots.push(branch);
				else {
					agent.children.push(branch);
					agent.toolCount += 1;
					if (order < agent.order) {
						agent.order = order;
						agent.firstSeenAt = row.firstSeenAt;
					}
				}
			}
			for (const [key, agent] of agents) {
				const parentKey = parents.get(key);
				const parent = parentKey === void 0 ? void 0 : agents.get(parentKey);
				if (parent === void 0) roots.push(agent);
				else parent.children.push(agent);
			}
			const pending = new Map([...agents].map(([key, agent]) => [key, agent.children.filter((child) => child.kind === "agent").length]));
			const ready = [...agents.values()].filter((agent) => pending.get(agent.key) === 0);
			for (let index = 0; index < ready.length; index += 1) {
				const agent = ready[index];
				agent.children.sort((a, b) => a.order - b.order);
				const parentKey = parents.get(agent.key);
				const parent = parentKey === void 0 ? void 0 : agents.get(parentKey);
				if (parent === void 0) continue;
				parent.toolCount += agent.toolCount;
				if (agent.order < parent.order) {
					parent.order = agent.order;
					parent.firstSeenAt = agent.firstSeenAt;
				}
				const remaining = pending.get(parent.key) - 1;
				pending.set(parent.key, remaining);
				if (remaining === 0) ready.push(parent);
			}
			return roots.sort((a, b) => a.order - b.order);
		}
		//#endregion
		//#region src/web/NativeTurnContainer.tsx
		/** Per-turn native tool container mounted in the Chat transcript.
		*
		* One instance per turn renders that turn's sidecar rows through the pure
		* row renderer. Display only: never a DSH tool-call block, so the loop
		* never executes native tools. Rows come from one session-scoped shared
		* history subscription, so trailing records after a turn ends still arrive
		* while any native view stays mounted; each container partitions by the
		* loaded Chat timeline (public uiConversation binding, target "chat") and
		* marks rows outside its actual Core window as unattributed.
		*/
		const wrap = {
			display: "flex",
			flexDirection: "column",
			gap: 8,
			minWidth: 0
		};
		const head = {
			margin: 0,
			fontSize: 12,
			color: "var(--dsw-alias-label-tertiary)",
			overflowWrap: "anywhere"
		};
		const errorText = {
			margin: 0,
			fontSize: 12,
			color: "var(--dsw-alias-state-error-primary)",
			overflowWrap: "anywhere"
		};
		const EMPTY_NATIVE_ROWS = [];
		const retry = {
			minHeight: 36,
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 5,
			padding: "7px 10px",
			color: "var(--dsw-alias-label-primary)",
			background: "var(--dsw-alias-bg-layer-1)",
			cursor: "pointer",
			marginLeft: 8
		};
		function NativeTurnContainer(props) {
			const { turn, startMs, endMs } = props.node.data;
			const chatSource = (0, react.useMemo)(() => props.uiConversation.binding(props.sessionId).target("chat"), [props.uiConversation, props.sessionId]);
			const chatSnapshot = (0, react.useSyncExternalStore)(chatSource.subscribe, chatSource.getSnapshot);
			const historyStore = (0, react.useMemo)(() => getNativeHistoryStore(props.rpc, props.sessionId), [props.rpc, props.sessionId]);
			const history = (0, react.useSyncExternalStore)(historyStore.subscribe, historyStore.getSnapshot);
			const orderedStarts = (0, react.useMemo)(() => {
				const timeline = chatSnapshot?.timeline;
				if (timeline === void 0) return [];
				const out = [];
				for (const item of timeline.turnOrder) {
					const ms = timeline.turns.get(item)?.start?.time;
					if (typeof ms === "number" && Number.isFinite(ms)) out.push({
						turn: item,
						startMs: ms
					});
				}
				return out;
			}, [chatSnapshot]);
			const knownIndex = orderedStarts.findIndex((item) => item.turn === turn);
			const followingStartMs = knownIndex >= 0 ? nextStartMs(orderedStarts, turn) : null;
			const includeEarlier = knownIndex === 0;
			const rows = (0, react.useMemo)(() => {
				if (knownIndex < 0) return EMPTY_NATIVE_ROWS;
				return rowsForTurnWindow(history.rows, startMs, followingStartMs, Date.now(), includeEarlier);
			}, [
				history.rows,
				startMs,
				followingStartMs,
				includeEarlier,
				knownIndex
			]);
			const branches = (0, react.useMemo)(() => groupNativeActivity(rows, knownIndex < 0 ? [] : rowsForTurnWindow(history.agents, startMs, followingStartMs, Date.now(), includeEarlier)), [
				rows,
				history.agents,
				knownIndex,
				startMs,
				followingStartMs,
				includeEarlier
			]);
			if (branches.length === 0 && history.error === void 0) return null;
			const label = rows.length > 0 ? props.t("activityTools").replace("{count}", String(rows.length)) : void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				"data-antigravity-native-turn": turn,
				style: wrap,
				children: [
					label === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: head,
						children: label
					}),
					branches.map((branch) => {
						const unattributed = !isOwnedByTurn(Date.parse(branch.kind === "tool" ? branch.row.firstSeenAt : branch.firstSeenAt), startMs, endMs);
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react.default.Fragment, { children: [unattributed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							"data-native-unattributed": true,
							style: head,
							children: props.t("activityBetweenTurns")
						}) : null, /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NativeActivityNode, {
							branch,
							t: props.t,
							conversationT: props.conversationT
						})] }, branch.key);
					}),
					history.error === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						role: "alert",
						style: errorText,
						children: [history.error, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: retry,
							onClick: () => {
								historyStore.refresh();
							},
							children: props.t("activityRetry")
						})]
					})
				]
			});
		}
		//#endregion
		//#region node_modules/.pnpm/dsh-llm-providers-ui@https+++github.com+NOirBRight+dsh-llm-providers-ui+releases+downlo_0e33694df1c50dd9c9b7310f039f7d34/node_modules/dsh-llm-providers-ui/lib/provider-ui.js
		/**
		* Normalize remaining quota to a 0-100 percent value.
		* Valid readings keep their precision (99.9 stays 99.9, never rounds to 100).
		* NaN, Infinity, and out-of-range readings are unavailable, not clamped:
		* clamping would fabricate a full or empty bar from bad data.
		* @param input - percent and/or fraction quota reading.
		* @returns the 0-100 remaining value, or undefined when unavailable.
		*/
		function normalizeQuotaRemaining(input) {
			const percent = input.remainingPercent;
			if (percent !== void 0) return Number.isFinite(percent) && percent >= 0 && percent <= 100 ? percent : void 0;
			const fraction = input.remainingFraction;
			if (fraction !== void 0) return Number.isFinite(fraction) && fraction >= 0 && fraction <= 1 ? fraction * 100 : void 0;
		}
		const meterWrapStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 5,
			minWidth: 0
		};
		const meterTopStyle = {
			display: "flex",
			alignItems: "baseline",
			justifyContent: "space-between",
			gap: 8
		};
		const meterLabelStyle = {
			minWidth: 0,
			overflow: "hidden",
			textOverflow: "ellipsis",
			whiteSpace: "nowrap",
			color: "var(--dsw-alias-label-secondary)",
			fontSize: 12,
			lineHeight: "18px"
		};
		const meterValueStyle = {
			flex: "none",
			fontVariantNumeric: "tabular-nums",
			fontWeight: 500,
			fontSize: 12,
			lineHeight: "18px",
			color: "var(--dsw-alias-label-primary)"
		};
		const meterTrackStyle = {
			display: "block",
			width: "100%",
			height: 6,
			overflow: "hidden",
			border: 0,
			borderRadius: 2,
			background: "color-mix(in srgb, var(--dsw-alias-label-primary) 12%, transparent)",
			position: "relative"
		};
		const meterFillBase = {
			display: "block",
			height: "100%",
			borderRadius: 2,
			position: "relative",
			background: "color-mix(in srgb, var(--dsw-alias-label-primary) 55%, var(--dsw-alias-label-secondary))"
		};
		const meterKnobStyle = {
			position: "absolute",
			right: 0,
			top: 0,
			bottom: 0,
			width: 2,
			background: "var(--dsw-alias-label-primary)"
		};
		const meterSegmentsStyle = {
			position: "absolute",
			inset: 0,
			pointerEvents: "none",
			background: "repeating-linear-gradient(to right, transparent 0, transparent calc(10% - 1px), var(--dsw-alias-bg-layer-1) calc(10% - 1px), var(--dsw-alias-bg-layer-1) 10%)"
		};
		/** Approved A low-quota fill: amber only, no red tier, no hardcoded hue. */
		const meterWarnFill = { background: "var(--dsw-alias-state-warn-primary)" };
		const meterDetailStyle = {
			color: "var(--dsw-alias-label-tertiary)",
			fontSize: 11,
			lineHeight: "16px"
		};
		const meterMissingStyle = {
			color: "var(--dsw-alias-label-tertiary)",
			fontSize: 12,
			lineHeight: "18px"
		};
		/** Segmented remaining-quota meter. Unavailable quota renders a placeholder, never a zero bar. */
		function ProviderQuotaMeter(props) {
			const remaining = normalizeQuotaRemaining(props);
			const label = props.label ?? "Quota";
			if (remaining === void 0) return (0, react_jsx_runtime.jsx)("span", {
				"data-provider-quota-missing": "",
				style: meterMissingStyle,
				children: props.emptyLabel ?? "—"
			});
			const warn = remaining < 20;
			const text = String(remaining);
			return (0, react_jsx_runtime.jsxs)("span", {
				"data-provider-quota": "",
				style: meterWrapStyle,
				...props.id === void 0 ? {} : { id: props.id },
				children: [
					(0, react_jsx_runtime.jsxs)("span", {
						style: meterTopStyle,
						children: [(0, react_jsx_runtime.jsx)("span", {
							style: meterLabelStyle,
							children: label
						}), (0, react_jsx_runtime.jsx)("span", {
							style: meterValueStyle,
							children: text + "%"
						})]
					}),
					(0, react_jsx_runtime.jsxs)("span", {
						"data-provider-quota-meter": "",
						role: "meter",
						"aria-label": label,
						"aria-valuemin": 0,
						"aria-valuemax": 100,
						"aria-valuenow": remaining,
						style: meterTrackStyle,
						children: [(0, react_jsx_runtime.jsx)("span", {
							style: {
								...meterFillBase,
								...warn ? meterWarnFill : {},
								width: text + "%"
							},
							children: (0, react_jsx_runtime.jsx)("span", { style: meterKnobStyle })
						}), (0, react_jsx_runtime.jsx)("span", {
							"aria-hidden": "true",
							style: meterSegmentsStyle
						})]
					}),
					props.detail === void 0 ? null : (0, react_jsx_runtime.jsx)("span", {
						style: meterDetailStyle,
						children: props.detail
					})
				]
			});
		}
		const headerMainStyle = {
			display: "flex",
			alignItems: "center",
			gap: 14,
			minWidth: 0,
			flex: 1
		};
		const headerIdentityStyle = {
			display: "flex",
			alignItems: "center",
			gap: 12,
			minWidth: 0,
			flex: 1
		};
		const headerMarkStyle = {
			width: 28,
			height: 28,
			flex: "none",
			display: "grid",
			placeItems: "center",
			overflow: "visible"
		};
		const headerTitleColStyle = {
			display: "flex",
			flexDirection: "column",
			minWidth: 0,
			flex: 1
		};
		const headerTitleStyle = {
			display: "inline-flex",
			alignItems: "center",
			gap: 8,
			fontSize: 14,
			fontWeight: 600,
			lineHeight: "20px"
		};
		const headerBadgeBase = {
			display: "inline-flex",
			alignItems: "center",
			gap: 4,
			whiteSpace: "nowrap",
			fontSize: 10,
			fontWeight: 500,
			lineHeight: "16px",
			padding: "0 5px",
			borderRadius: 3,
			border: "1px solid transparent"
		};
		const headerBadgeLlm = {
			color: "var(--dsw-alias-label-secondary)",
			borderColor: "var(--dsw-alias-border-l2)",
			background: "transparent"
		};
		const headerBadgeAgent = {
			color: "var(--dsw-alias-bg-layer-1)",
			borderColor: "var(--dsw-alias-label-primary)",
			background: "var(--dsw-alias-label-primary)"
		};
		const headerSummaryStyle = {
			fontSize: 11,
			lineHeight: "16px",
			color: "var(--dsw-alias-label-tertiary)",
			whiteSpace: "nowrap",
			overflow: "hidden",
			textOverflow: "ellipsis"
		};
		const headerMiniStyle = {
			width: 172,
			flex: "none",
			minWidth: 0
		};
		const headerStatusStyle = {
			width: 96,
			flex: "none",
			textAlign: "right",
			fontSize: 11,
			lineHeight: "16px",
			color: "var(--dsw-alias-label-tertiary)",
			whiteSpace: "nowrap",
			overflow: "hidden",
			textOverflow: "ellipsis"
		};
		const headerSideStyle = {
			display: "inline-flex",
			alignItems: "center",
			gap: 10,
			flex: "none"
		};
		const headerUnsavedStyle = {
			fontSize: 12,
			color: "var(--dsw-alias-label-tertiary)"
		};
		const headerChevronStyle = {
			width: 15,
			fontSize: 20,
			lineHeight: 1,
			textAlign: "center",
			color: "var(--dsw-alias-label-tertiary)"
		};
		/**
		* Monochrome role badge: outlined message glyph for LLM, filled terminal glyph
		* for Agent. Shared by migrated card headers and the shell legacy fallback.
		*/
		function ProviderRoleBadge(props) {
			const agent = (props.role ?? "llm") === "agent";
			return (0, react_jsx_runtime.jsxs)("span", {
				"data-provider-role-badge": agent ? "agent" : "llm",
				style: {
					...headerBadgeBase,
					...agent ? headerBadgeAgent : headerBadgeLlm
				},
				children: [(0, react_jsx_runtime.jsx)("svg", {
					viewBox: "0 0 16 16",
					fill: "none",
					stroke: "currentColor",
					strokeWidth: 1.4,
					"aria-hidden": "true",
					children: agent ? (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("rect", {
						x: "1.5",
						y: "2",
						width: "13",
						height: "12",
						rx: "2"
					}), (0, react_jsx_runtime.jsx)("path", { d: "m4 5 3 3-3 3m5 0h3" })] }) : (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("rect", {
						x: "2",
						y: "2",
						width: "12",
						height: "9",
						rx: "3"
					}), (0, react_jsx_runtime.jsx)("path", { d: "m5 11-1 3 5-3M5 6h6" })] })
				}), agent ? "Agent" : "LLM"]
			});
		}
		/**
		* Approved A header geometry in one row: identity (mark beside title, badge,
		* and count) on the left, headline quota at the right, caller status, and the
		* chevron. Narrow screens stack identity plus chevron over quota plus status.
		* Renders a fragment for the caller-owned header button; props keep the legacy
		* codex provider-chrome signature so existing call sites keep working.
		*/
		function ProviderCardHeader(props) {
			const quota = props.quota === void 0 || props.quota === null ? void 0 : {
				...props.quota.remainingPercent === void 0 ? {} : { remainingPercent: props.quota.remainingPercent },
				...props.quota.remainingFraction === void 0 ? {} : { remainingFraction: props.quota.remainingFraction },
				...props.quota.label === void 0 ? {} : { label: props.quota.label },
				...props.quota.detail === void 0 ? {} : { detail: props.quota.detail }
			};
			return (0, react_jsx_runtime.jsxs)("span", {
				"data-provider-header-main": "",
				style: headerMainStyle,
				children: [
					(0, react_jsx_runtime.jsxs)("span", {
						"data-provider-header-identity": "",
						style: headerIdentityStyle,
						children: [(0, react_jsx_runtime.jsx)("span", {
							"data-provider-header-mark": "",
							style: headerMarkStyle,
							children: props.mark
						}), (0, react_jsx_runtime.jsxs)("span", {
							style: headerTitleColStyle,
							children: [(0, react_jsx_runtime.jsxs)("span", {
								style: headerTitleStyle,
								children: [(0, react_jsx_runtime.jsx)("span", { children: props.title }), (0, react_jsx_runtime.jsx)(ProviderRoleBadge, { ...props.role === void 0 ? {} : { role: props.role } })]
							}), (0, react_jsx_runtime.jsx)("span", {
								"data-provider-header-summary": "",
								style: headerSummaryStyle,
								children: props.summary
							})]
						})]
					}),
					quota === void 0 ? null : (0, react_jsx_runtime.jsx)("span", {
						"data-provider-quota-mini": "",
						style: headerMiniStyle,
						children: (0, react_jsx_runtime.jsx)(ProviderQuotaMeter, { ...quota })
					}),
					props.status === void 0 ? null : (0, react_jsx_runtime.jsx)("span", {
						"data-provider-header-status": "",
						style: headerStatusStyle,
						children: props.status
					}),
					(0, react_jsx_runtime.jsxs)("span", {
						"data-provider-header-side": "",
						style: headerSideStyle,
						children: [props.unsaved === true && props.unsavedLabel !== void 0 ? (0, react_jsx_runtime.jsx)("span", {
							style: headerUnsavedStyle,
							children: props.unsavedLabel
						}) : null, (0, react_jsx_runtime.jsx)("span", {
							"data-provider-header-chevron": "",
							"aria-hidden": "true",
							style: {
								...headerChevronStyle,
								transform: props.open ? "rotate(180deg)" : "none"
							},
							children: "⌄"
						})]
					})
				]
			});
		}
		/**
		* Scoped provider chrome CSS: plain card reset, header button layout, body and
		* model rows, quota meter responsive rules, and coarse-pointer touch targets.
		* The shell injects it once per page; provider cards may also inject it once
		* for standalone use. Duplicate style tags are harmless: every rule is scoped
		* to a data-provider-* attribute; shared geometry overrides legacy inline layout styles.
		*/
		const providerUiCss = [
			"[data-provider-card]{box-sizing:border-box;width:100%;min-width:0;list-style:none;margin:0!important;border:0!important;border-radius:0!important;background:none!important;box-shadow:none!important;overflow:visible}",
			"[data-provider-card-header]{box-sizing:border-box;width:100%;min-height:76px!important;display:flex;align-items:center;justify-content:space-between;gap:16px;border:0;padding:12px 14px!important;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}",
			"[data-provider-body][hidden]{display:none!important}",
			"[data-provider-role-badge] svg{width:12px;height:12px}",
			"[data-provider-card-header]:hover{background:color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent)}",
			"[data-provider-body]{display:flex;flex-direction:column;gap:18px;border-top:1px solid var(--dsw-alias-border-l2);padding:16px 14px 18px}",
			"[data-provider-model]{display:flex;align-items:center;gap:9px;min-height:40px}",
			"[data-provider-quota-mini]{display:block}",
			"[data-providers-list]{display:flex;flex-direction:column}",
			"[data-providers-list] [data-sortable-row]+[data-sortable-row]{border-top:1px solid var(--dsw-alias-border-l2)}",
			"[data-providers-section]{container-type:inline-size}",
			"@media (max-width:680px){[data-provider-card-header]{min-height:106px!important;padding:17px 4px!important}[data-provider-header-main]{display:grid!important;grid-template-columns:minmax(0,1fr) auto;gap:7px 9px!important;align-items:center}[data-provider-header-identity]{grid-column:1;grid-row:1;gap:9px!important}[data-provider-header-mark]{width:25px!important;height:25px!important}[data-provider-role-badge]{margin-left:4px;font-size:9px!important}[data-provider-role-badge] svg{width:11px!important;height:11px!important}[data-provider-header-side]{grid-column:2;grid-row:1;justify-self:end}[data-provider-header-side] [data-provider-header-chevron]{width:18px}[data-provider-quota-mini]{grid-column:1;grid-row:2;width:auto!important;max-width:none!important;text-align:left;padding-left:34px!important}[data-provider-header-status]{grid-column:2;grid-row:2;width:auto!important;max-width:100px}[data-provider-model]{min-height:48px}[data-provider-model] input[type=checkbox]{width:17px;height:17px}[data-providers-section] button,[data-provider-card] button{min-height:44px}}",
			"@container (max-width:540px){[data-provider-card-header]{min-height:106px!important;padding:17px 4px!important}[data-provider-header-main]{display:grid!important;grid-template-columns:minmax(0,1fr) auto;gap:7px 9px!important;align-items:center}[data-provider-header-identity]{grid-column:1;grid-row:1;gap:9px!important}[data-provider-header-mark]{width:25px!important;height:25px!important}[data-provider-role-badge]{margin-left:4px;font-size:9px!important}[data-provider-role-badge] svg{width:11px!important;height:11px!important}[data-provider-header-side]{grid-column:2;grid-row:1;justify-self:end}[data-provider-header-side] [data-provider-header-chevron]{width:18px}[data-provider-quota-mini]{grid-column:1;grid-row:2;width:auto!important;max-width:none!important;text-align:left;padding-left:34px!important}[data-provider-header-status]{grid-column:2;grid-row:2;width:auto!important;max-width:100px}[data-provider-model]{min-height:48px}[data-provider-model] input[type=checkbox]{width:17px;height:17px}[data-providers-section] button,[data-provider-card] button{min-height:44px}}",
			"@media (pointer:coarse){[data-sortable-handle],[data-sortable-move]{min-width:44px;min-height:44px}}"
		].join("\n");
		//#endregion
		//#region node_modules/.pnpm/dsh-llm-providers-ui@https+++github.com+NOirBRight+dsh-llm-providers-ui+releases+downlo_0e33694df1c50dd9c9b7310f039f7d34/node_modules/dsh-llm-providers-ui/lib/usage-readers.js
		/** Bundle-safe quota decoders, RPC readers, and browser cache helpers; no ModuleLoader wrapper or reactive store. */
		/** Plain-object guard shared by the reader factories and the sidebar cache validator. */
		function recordUsageValue(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
		}
		/** Non-empty string guard shared by the reader factories and the sidebar cache validator. */
		function nonEmptyString(value) {
			return typeof value === "string" && value.length > 0;
		}
		function finiteNumber(value) {
			return typeof value === "number" && Number.isFinite(value);
		}
		/** Non-negative finite number guard shared by the reader factories and the sidebar cache validator. */
		function nonNegativeNumber(value) {
			return finiteNumber(value) && value >= 0;
		}
		const PERIOD_RANK = {
			M: 6,
			W: 5,
			D: 4,
			CURS: 3,
			S: 1,
			A: 0,
			L: 0,
			CR: -1
		};
		function periodRank(shortLabelValue) {
			const normalized = shortLabelValue.toUpperCase();
			return PERIOD_RANK[normalized] ?? (/^\d+H$/.test(normalized) ? 2 : 0);
		}
		/** Headline window: longest percentage period, else the first text-only window. */
		function pickPrimaryWindow(windows) {
			let best;
			for (const quotaWindow of windows) {
				if (quotaWindow.remainingPercent === void 0) continue;
				if (best === void 0 || periodRank(quotaWindow.shortLabel) > periodRank(best.shortLabel)) best = quotaWindow;
			}
			return best ?? windows[0];
		}
		const USAGE_CACHE_KEY = "dsh-llm-providers-ui:usage-cache";
		/**
		* Browser last-good usage cache shared across bundles: the sidebar store and
		* each provider Settings card bundle their own copy of this module, so the
		* module-level memory map below is per-bundle while storage is shared.
		* Readable storage is authoritative, including empty after invalidation; memory
		* is only a fallback while storage is unavailable. Stale status persists
		* honestly, and collapsed-header headlines never replace a full multi-window
		* summary (a later full read upgrades a headline).
		*/
		let memoryUsageCache = /* @__PURE__ */ new Map();
		/** Whether a ready or stale summary retains displayable usage windows.
		* @param summary - Current or retained provider usage.
		* @returns Whether its windows can be displayed and persisted.
		*/
		function hasUsageData(summary) {
			return summary !== void 0 && summary.windows.length > 0 && (summary.status === "ready" || summary.status === "stale");
		}
		function cachedSummary(value) {
			const item = recordUsageValue(value);
			if (item === void 0 || !nonEmptyString(item.providerKey) || !nonEmptyString(item.name)) return void 0;
			const status = item.status;
			if (status !== "ready" && status !== "stale") return void 0;
			if (!Array.isArray(item.windows) || item.windows.length === 0) return void 0;
			const windows = [];
			for (const windowValue of item.windows) {
				const quotaWindow = recordUsageValue(windowValue);
				if (quotaWindow === void 0 || !nonEmptyString(quotaWindow.id) || !nonEmptyString(quotaWindow.label) || !nonEmptyString(quotaWindow.shortLabel) || !nonEmptyString(quotaWindow.valueText)) return void 0;
				if (quotaWindow.remainingPercent !== void 0 && (!nonNegativeNumber(quotaWindow.remainingPercent) || quotaWindow.remainingPercent > 100)) return void 0;
				if (quotaWindow.resetsAt !== void 0 && !nonEmptyString(quotaWindow.resetsAt)) return void 0;
				windows.push({
					id: quotaWindow.id,
					label: quotaWindow.label,
					shortLabel: quotaWindow.shortLabel,
					valueText: quotaWindow.valueText,
					...quotaWindow.remainingPercent === void 0 ? {} : { remainingPercent: quotaWindow.remainingPercent },
					...quotaWindow.resetsAt === void 0 ? {} : { resetsAt: quotaWindow.resetsAt }
				});
			}
			return {
				providerKey: item.providerKey,
				name: item.name,
				status,
				windows,
				...nonEmptyString(item.fetchedAt) ? { fetchedAt: item.fetchedAt } : {}
			};
		}
		/** Readable storage backends. A backend that throws on read is unusable and skipped. */
		function usageStorageBackends() {
			const backends = [];
			for (const name of ["localStorage", "sessionStorage"]) try {
				const backend = globalThis[name];
				if (backend === void 0 || backend === null) continue;
				backend.getItem(USAGE_CACHE_KEY);
				backends.push(backend);
			} catch {}
			return backends;
		}
		function storageRead() {
			const backends = usageStorageBackends();
			if (backends.length === 0) return {
				available: false,
				raw: null
			};
			for (const backend of backends) try {
				const raw = backend.getItem(USAGE_CACHE_KEY);
				if (raw !== null) return {
					available: true,
					raw
				};
			} catch {}
			return {
				available: true,
				raw: null
			};
		}
		function storageWrite(value) {
			for (const backend of usageStorageBackends()) try {
				backend.setItem(USAGE_CACHE_KEY, value);
			} catch {}
		}
		function parseUsageCache(raw) {
			const cached = /* @__PURE__ */ new Map();
			if (raw === null) return cached;
			try {
				const parsed = JSON.parse(raw);
				if (!Array.isArray(parsed)) return cached;
				for (const value of parsed) {
					const item = cachedSummary(value);
					if (item !== void 0) cached.set(item.providerKey, item);
				}
			} catch {}
			return cached;
		}
		function readUsageCache() {
			const { available, raw } = storageRead();
			if (!available) return new Map(memoryUsageCache);
			const fromStorage = parseUsageCache(raw);
			memoryUsageCache = new Map(fromStorage);
			return fromStorage;
		}
		/** Persistable copy: status stays ready/stale as the caller holds it, never laundered to ready. */
		function persistableUsage(summary) {
			return {
				providerKey: summary.providerKey,
				name: summary.name,
				status: summary.status,
				windows: summary.windows,
				...summary.fetchedAt === void 0 ? {} : { fetchedAt: summary.fetchedAt }
			};
		}
		/** A collapsed-header single window, never a full multi-window summary. */
		function isHeadlineOnly(summary) {
			return summary.windows.length === 1 && summary.windows[0]?.id === "headline";
		}
		function writeUsageCache(current) {
			const entries = [...current.values()].filter(hasUsageData);
			const { available, raw } = storageRead();
			if (!available) {
				for (const item of entries) memoryUsageCache.set(item.providerKey, persistableUsage(item));
				return;
			}
			const merged = parseUsageCache(raw);
			for (const item of entries) {
				const previous = merged.get(item.providerKey);
				if (previous !== void 0 && !isHeadlineOnly(previous) && isHeadlineOnly(item)) continue;
				merged.set(item.providerKey, persistableUsage(item));
			}
			memoryUsageCache = new Map(merged);
			if (merged.size === 0) return;
			storageWrite(JSON.stringify([...merged.values()]));
		}
		function dropPersistedUsageKeys(keys) {
			const drop = new Set(keys);
			for (const key of drop) memoryUsageCache.delete(key);
			const { available, raw } = storageRead();
			if (!available || raw === null) return;
			let parsed;
			try {
				parsed = JSON.parse(raw);
			} catch {
				return;
			}
			if (!Array.isArray(parsed)) return;
			const kept = parsed.filter((value) => {
				const item = recordUsageValue(value);
				return item === void 0 || !nonEmptyString(item.providerKey) || !drop.has(item.providerKey);
			});
			if (kept.length === parsed.length) return;
			storageWrite(JSON.stringify(kept));
		}
		/** Last-good quota for a Provider card header, available on first paint. */
		function peekCachedUsage(providerKey) {
			return readUsageCache().get(providerKey);
		}
		function rememberCachedUsage(summary) {
			if (!hasUsageData(summary)) return;
			writeUsageCache(/* @__PURE__ */ new Map([[summary.providerKey, summary]]));
		}
		/**
		* Collapsed-header last-good quota for first paint. Ignores headlines without
		* a finite in-range remaining percent so missing quota renders no meter, never
		* a zero bar. Never replaces a cached full multi-window summary, and records
		* no fetchedAt: a headline is display data, not a fetch, so freshness checks
		* treat it as expired and refetch.
		*/
		function rememberHeadlineQuota(providerKey, name, quota) {
			if (quota?.remainingPercent === void 0 || !Number.isFinite(quota.remainingPercent)) return;
			const remainingPercent = Math.round(quota.remainingPercent * 10) / 10;
			if (remainingPercent < 0 || remainingPercent > 100) return;
			const label = quota.label ?? "Quota";
			rememberCachedUsage({
				providerKey,
				name,
				status: "ready",
				windows: [{
					id: "headline",
					label,
					shortLabel: label,
					valueText: String(remainingPercent) + "%",
					remainingPercent
				}]
			});
		}
		function headerQuotaFromCache(summary) {
			if (summary === void 0) return void 0;
			const quotaWindow = pickPrimaryWindow(summary.windows);
			if (quotaWindow === void 0) return void 0;
			return {
				label: quotaWindow.shortLabel || quotaWindow.label,
				...quotaWindow.remainingPercent === void 0 ? {} : { remainingPercent: quotaWindow.remainingPercent },
				...quotaWindow.resetsAt === void 0 ? {} : { detail: quotaWindow.resetsAt }
			};
		}
		//#endregion
		//#region src/web/BrandMark.tsx
		/** User-supplied Antigravity silhouette, shared across light and dark themes. */
		function BrandMark() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: "24",
				height: "24",
				viewBox: "0 0 169 148",
				fill: "currentColor",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M84.5 16C64 16 57 39 49 67C42 93 36 111 24 122C18 128 22 132 28 132C42 132 50 116 59 99C66 85 72 78 84.5 78C97 78 103 85 110 99C119 116 127 132 141 132C147 132 151 128 145 122C133 111 127 93 120 67C112 39 105 16 84.5 16Z" })
			});
		}
		//#endregion
		//#region src/web/settings-state.ts
		/** Resolve setup from probe-backed installation and provider authentication status. */
		function resolveAntigravityCardState(row) {
			if (row === void 0) return "loading";
			if (!row.installed) return "missing";
			if (!row.authenticated) return "login";
			return "connected";
		}
		/** Whether a live snapshot invalidates retained account quota.
		* @param previous - Last accepted row, absent on first paint.
		* @param incoming - Newly received authentication and profile state.
		* @returns True on logout, missing provider, or a known profile change.
		*/
		function shouldClearQuota(previous, incoming) {
			return !incoming?.authenticated || previous !== void 0 && (previous.instanceId !== incoming.instanceId || previous.stateDirectory !== incoming.stateDirectory);
		}
		/** Merge live health/catalog data without overwriting unsaved configuration edits. */
		function mergeSettingsDraft(current, incoming, dirty) {
			if (!dirty || current === void 0 || incoming === void 0 || current.instanceId !== incoming.instanceId || current.stateDirectory !== incoming.stateDirectory) return incoming;
			const next = {
				...incoming,
				enabled: current.enabled,
				executablePath: current.executablePath,
				harnessPath: current.harnessPath
			};
			if (current.model === void 0) delete next.model;
			else next.model = current.model;
			return next;
		}
		//#endregion
		//#region src/web/ExternalAgentsSection.tsx
		/** Antigravity provider settings: state-driven Install, Sign in, then Account/Quota/Model. Runtime paths stay in backend config only. */
		const field = {
			display: "flex",
			flexDirection: "column",
			gap: 6,
			fontSize: 12,
			minWidth: 0
		};
		const control = {
			width: "100%",
			minWidth: 0,
			minHeight: 36,
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 5,
			padding: "7px 10px",
			color: "var(--dsw-alias-label-primary)",
			background: "var(--dsw-alias-bg-layer-1)"
		};
		const button = {
			...control,
			width: "auto",
			cursor: "pointer"
		};
		const actions = {
			display: "flex",
			flexWrap: "wrap",
			alignItems: "center",
			gap: 8
		};
		const section = {
			padding: "18px 0",
			borderTop: "1px solid var(--dsw-alias-border-l2)",
			display: "flex",
			flexDirection: "column",
			gap: 12,
			minWidth: 0
		};
		const muted = {
			margin: 0,
			fontSize: 12,
			color: "var(--dsw-alias-label-tertiary)",
			overflowWrap: "anywhere"
		};
		const localCss = "[data-provider-body][hidden]{display:none!important}[data-antigravity-quota]{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px 24px}[data-antigravity-heading]{font-size:13px;font-weight:600;margin:0}@media(max-width:680px){[data-antigravity-quota]{grid-template-columns:1fr}[data-provider-card=\"antigravity\"] button,[data-provider-card=\"antigravity\"] select,[data-provider-card=\"antigravity\"] input:not([type=checkbox]){min-height:44px}}";
		/** Render Install at top when missing, Sign in at top when installed, Account/Quota/Model when connected.
		* @param props the live row, snapshot, quota, and state callbacks.
		* @returns the ordered card sections without runtime path internals.
		*/
		function AntigravityCardBody({ t, row, snapshot, state, quota, quotaError, quotaLoading, working, polling, saving, dirty, onToggleEnabled, onAction, onRefresh, onRefreshQuota, onModelChange, onPersist, onDiscard }) {
			const phase = snapshot.install?.phase;
			const showInstall = state === "missing" || phase === "downloading" || phase === "extracting" || phase === "verifying" || phase === "failed";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				showInstall && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					style: section,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							"data-antigravity-heading": true,
							children: t("install")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: muted,
							children: row.message ?? t("missingBadge")
						}),
						snapshot.install && phase !== "idle" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							role: "status",
							style: muted,
							children: [snapshot.install.message, snapshot.install.totalBytes > 0 && polling ? " " + Math.round(100 * snapshot.install.downloadedBytes / snapshot.install.totalBytes) + "%" : ""]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: actions,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: button,
								disabled: working || polling,
								onClick: () => onAction("install-runtime"),
								children: polling ? t("installing") : t("install")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: button,
								disabled: working || polling,
								onClick: onRefresh,
								children: t("rescan")
							})]
						})
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					style: section,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							"data-antigravity-heading": true,
							children: t("account")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							style: actions,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "checkbox",
								disabled: saving || working,
								checked: row.enabled,
								onChange: onToggleEnabled
							}), t("enableProvider")]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: muted,
							children: [row.version, row.message].filter(Boolean).join(" · ")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: actions,
							children: [
								state !== "missing" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: button,
									disabled: working || polling,
									onClick: () => onAction(row.authenticated ? "sign-out" : "sign-in"),
									children: snapshot.signingIn ? t("signingIn") : row.authenticated ? t("signOut") : t("signIn")
								}),
								state !== "missing" && row.authorizationUrl && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: button,
									disabled: working,
									onClick: () => onAction("open-login"),
									children: t("openLogin")
								}),
								!showInstall && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: button,
									disabled: working || polling,
									onClick: onRefresh,
									children: t("rescan")
								})
							]
						})
					]
				}),
				state === "connected" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					style: section,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								...actions,
								justifyContent: "space-between"
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								"data-antigravity-heading": true,
								children: t("quota")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: button,
								disabled: !row.authenticated || quotaLoading || working,
								onClick: onRefreshQuota,
								children: quotaLoading ? t("loading") : t("refreshQuota")
							})]
						}),
						quotaError && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							role: "status",
							style: muted,
							children: [quotaError, quota ? " · " + t("staleQuota") : ""]
						}),
						!quota && !quotaError && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: muted,
							children: t("quotaUnavailable")
						}),
						quota?.groups.map((group, gi) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							"data-antigravity-heading": true,
							children: group.displayName ?? t("quota")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							"data-antigravity-quota": true,
							children: group.buckets.map((bucket, bi) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProviderQuotaMeter, {
								label: bucket.displayName ?? bucket.window ?? t("quota"),
								...bucket.disabled || bucket.remainingFraction === void 0 ? {} : { remainingFraction: bucket.remainingFraction },
								emptyLabel: bucket.disabled ? t("disabledBadge") : t("quotaUnavailable"),
								...bucket.resetTime ? { detail: t("resetsAt") + " " + new Date(bucket.resetTime).toLocaleString() } : {}
							}) }, bucket.bucketId ?? bi))
						})] }, gi)),
						quota && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							style: muted,
							children: [
								t("updatedAt"),
								" ",
								new Date(quota.observedAt).toLocaleString()
							]
						})
					]
				}),
				state === "connected" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					style: section,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								...actions,
								justifyContent: "space-between"
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								"data-antigravity-heading": true,
								children: t("model")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: button,
								disabled: !row.authenticated || working,
								onClick: () => onAction("refresh-models"),
								children: t("refreshModels")
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							style: field,
							children: [t("defaultModel"), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
								style: control,
								value: row.model ?? "",
								disabled: saving,
								onChange: (event) => onModelChange(event.target.value === "" ? void 0 : event.target.value),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: "",
									children: t("accountDefault")
								}), row.models.map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: model.id,
									children: model.name
								}, model.id))]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							style: muted,
							children: t("nativeModels")
						})
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("footer", {
					style: {
						...section,
						...actions,
						justifyContent: "flex-end"
					},
					children: [
						dirty && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								...muted,
								marginRight: "auto"
							},
							children: t("unsaved")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: button,
							disabled: !dirty || saving,
							onClick: onDiscard,
							children: t("cancel")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: button,
							disabled: !dirty || saving || working,
							onClick: onPersist,
							children: saving ? t("saving") : t("save")
						})
					]
				})
			] });
		}
		/** Provider card container: live snapshot, quota, install/sign-in actions, and shared header.
		* @param props the injected Settings face.
		* @returns the collapsible Antigravity provider card.
		*/
		function ExternalAgentsSection({ t, load, save, run, quota: readQuota }) {
			const [open, setOpen] = (0, react.useState)(false);
			const [snapshot, setSnapshot] = (0, react.useState)();
			const [draft, setDraft] = (0, react.useState)();
			const [dirty, setDirty] = (0, react.useState)(false);
			const dirtyRef = (0, react.useRef)(false);
			const snapshotRef = (0, react.useRef)();
			const [saving, setSaving] = (0, react.useState)(false);
			const [working, setWorking] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)();
			const [quota, setQuota] = (0, react.useState)();
			const [quotaError, setQuotaError] = (0, react.useState)();
			const [quotaLoading, setQuotaLoading] = (0, react.useState)(false);
			const epoch = (0, react.useRef)(0);
			const quotaEpoch = (0, react.useRef)(0);
			const quotaAbort = (0, react.useRef)();
			const mounted = (0, react.useRef)(false);
			const fail = (caught) => {
				if (mounted.current) setError(caught instanceof Error ? caught.message : t("failed"));
			};
			const clearQuota = () => {
				dropPersistedUsageKeys(["antigravity"]);
				quotaEpoch.current++;
				quotaAbort.current?.abort();
				setQuota(void 0);
				setQuotaError(void 0);
				setQuotaLoading(false);
			};
			const accept = (next) => {
				const previous = snapshotRef.current?.rows[0], incoming = next.rows[0];
				if (shouldClearQuota(previous, incoming)) clearQuota();
				snapshotRef.current = next;
				setSnapshot(next);
				setDraft((current) => mergeSettingsDraft(current, incoming, dirtyRef.current));
			};
			const fetchQuota = async () => {
				quotaAbort.current?.abort();
				const controller = new AbortController(), request = ++quotaEpoch.current;
				quotaAbort.current = controller;
				setQuotaLoading(true);
				try {
					const next = await readQuota(controller.signal);
					if (!mounted.current || request !== quotaEpoch.current) return;
					if (next.status === "ready") {
						setQuota(next);
						setQuotaError(void 0);
						const hit = next.groups.flatMap((group) => group.buckets.map((bucket) => ({
							group: group.displayName,
							bucket
						}))).find((item) => !item.bucket.disabled && item.bucket.remainingFraction !== void 0);
						if (hit?.bucket.remainingFraction !== void 0) rememberHeadlineQuota("antigravity", "Antigravity", {
							label: [hit.group, hit.bucket.window ?? hit.bucket.displayName].filter(Boolean).join(" · "),
							remainingPercent: Math.round(hit.bucket.remainingFraction * 1e3) / 10
						});
					} else {
						if (next.status !== "error") clearQuota();
						setQuotaError(next.message ?? t("quotaUnavailable"));
					}
				} catch (caught) {
					if (mounted.current && request === quotaEpoch.current && !controller.signal.aborted) setQuotaError(caught instanceof Error ? caught.message : t("quotaUnavailable"));
				} finally {
					if (mounted.current && request === quotaEpoch.current) setQuotaLoading(false);
				}
			};
			const refresh = async () => {
				const request = ++epoch.current;
				let next = await load();
				if (!mounted.current || request !== epoch.current) return;
				accept(next);
				if ((next.rows[0]?.executablePath ?? "").trim() === "") {
					try {
						await run("probe-installation");
						next = await load();
					} catch {}
					if (!mounted.current || request !== epoch.current) return;
					accept(next);
				}
				if (next.rows[0]?.authenticated) await fetchQuota();
			};
			(0, react.useEffect)(() => {
				mounted.current = true;
				refresh().catch(fail);
				return () => {
					mounted.current = false;
					epoch.current++;
					quotaEpoch.current++;
					quotaAbort.current?.abort();
				};
			}, [load, readQuota]);
			const phase = snapshot?.install?.phase;
			const polling = snapshot?.signingIn === true || phase === "downloading" || phase === "extracting" || phase === "verifying";
			(0, react.useEffect)(() => {
				if (!polling) return;
				let stopped = false, pending = false;
				const timer = window.setInterval(() => {
					if (pending) return;
					pending = true;
					const request = epoch.current;
					load().then((next) => {
						if (!stopped && request === epoch.current && mounted.current) accept(next);
					}).catch(fail).finally(() => {
						pending = false;
					});
				}, 500);
				return () => {
					stopped = true;
					window.clearInterval(timer);
				};
			}, [polling, load]);
			(0, react.useEffect)(() => {
				if (snapshot?.rows[0]?.authenticated) fetchQuota();
			}, [snapshot?.rows[0]?.authenticated]);
			const change = (row) => {
				dirtyRef.current = true;
				setDirty(true);
				setDraft(row);
			};
			const action = async (name) => {
				if (working) return;
				setWorking(true);
				setError(void 0);
				epoch.current++;
				if (name === "sign-in" || name === "sign-out") clearQuota();
				try {
					await run(name);
					await refresh();
				} catch (caught) {
					fail(caught);
				} finally {
					if (mounted.current) setWorking(false);
				}
			};
			const persist = async () => {
				if (!draft || saving) return;
				setSaving(true);
				setError(void 0);
				try {
					await save(draft);
					dirtyRef.current = false;
					setDirty(false);
					await refresh();
				} catch (caught) {
					fail(caught);
				} finally {
					if (mounted.current) setSaving(false);
				}
			};
			const row = draft;
			const state = resolveAntigravityCardState(row);
			const status = row === void 0 ? t("loading") : !row.enabled ? t("disabledBadge") : state === "missing" ? t("missingBadge") : state === "login" ? t("authBadge") : t("connected");
			const first = quota?.groups.flatMap((group) => group.buckets.map((bucket) => ({
				group: group.displayName,
				bucket
			}))).find((item) => !item.bucket.disabled && item.bucket.remainingFraction !== void 0);
			const liveQuota = first === void 0 ? void 0 : {
				remainingPercent: Math.round(first.bucket.remainingFraction * 1e3) / 10,
				label: [first.group, first.bucket.window ?? first.bucket.displayName].filter(Boolean).join(" · "),
				...quotaError === void 0 ? {} : { detail: t("staleQuota") }
			};
			const headerQuota = snapshot !== void 0 && !snapshot.rows[0]?.authenticated ? void 0 : liveQuota ?? headerQuotaFromCache(peekCachedUsage("antigravity"));
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				"data-provider-card": "antigravity",
				"data-provider-role": "agent",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: providerUiCss + localCss }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						"data-provider-card-header": true,
						"aria-expanded": open,
						onClick: () => setOpen(!open),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProviderCardHeader, {
							title: "Antigravity",
							mark: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BrandMark, {}),
							role: "agent",
							summary: row === void 0 ? "" : t("modelCount").replace("{count}", String(row.models.length)),
							status,
							open,
							unsaved: dirty,
							unsavedLabel: t("unsaved"),
							...headerQuota === void 0 ? {} : { quota: headerQuota }
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						"data-provider-body": true,
						hidden: !open,
						children: [error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							role: "alert",
							style: {
								...muted,
								color: "var(--dsw-alias-state-error-primary)"
							},
							children: error
						}), row && snapshot ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AntigravityCardBody, {
							t,
							row,
							snapshot,
							state,
							...quota === void 0 ? {} : { quota },
							...quotaError === void 0 ? {} : { quotaError },
							quotaLoading,
							working,
							polling,
							saving,
							dirty,
							onToggleEnabled: () => change({
								...row,
								enabled: !row.enabled
							}),
							onAction: (name) => void action(name),
							onRefresh: () => void refresh().catch(fail),
							onRefreshQuota: () => void fetchQuota(),
							onModelChange: (model) => {
								const next = { ...row };
								if (model === void 0) delete next.model;
								else next.model = model;
								change(next);
							},
							onPersist: () => void persist(),
							onDiscard: () => {
								dirtyRef.current = false;
								setDirty(false);
								setDraft(snapshot.rows[0]);
							}
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							role: "status",
							style: muted,
							children: t("loading")
						})]
					})
				]
			});
		}
		//#endregion
		//#region src/web/locales.ts
		/** Provider settings copy shared by the native ACP card and quota reader. */
		const en = {
			nav: "External Agents",
			title: "Antigravity",
			intro: "Native ACP runtime; no CLI required.",
			rescan: "Refresh status",
			save: "Save changes",
			saved: "Saved",
			saving: "Saving…",
			cancel: "Discard",
			failed: "Settings operation failed",
			signIn: "Sign in",
			signOut: "Sign out",
			openLogin: "Open login page",
			enabledBadge: "Enabled",
			disabledBadge: "Disabled",
			missingBadge: "Not installed",
			authBadge: "Sign-in required",
			connected: "Connected",
			model: "Models",
			install: "Install Antigravity",
			installing: "Installing…",
			signingIn: "Opening Google sign-in…",
			loading: "Loading…",
			quota: "Account quota",
			quotaUnavailable: "Quota unavailable",
			refreshQuota: "Refresh quota",
			staleQuota: "Previous snapshot; refresh failed",
			resetsAt: "Resets",
			updatedAt: "Updated",
			account: "Account",
			enableProvider: "Enable provider",
			unsaved: "Unsaved changes",
			modelCount: "{count} models",
			refreshModels: "Refresh models",
			defaultModel: "Default model",
			accountDefault: "Account default",
			nativeModels: "Model availability and capabilities are supplied by the native ACP runtime. This card does not override unsupported model capabilities.",
			activityRunning: "{count} native tools running",
			activityTools: "{count} native tools",
			activityBetweenTurns: "Outside this turn's recorded interval; ownership unavailable.",
			statusPending: "Pending",
			statusRunning: "Running",
			statusCompleted: "Completed",
			statusFailed: "Failed",
			activitySubagent: "Subagent",
			activityChildUnknown: "Child status unavailable",
			activityFailed: "Native tool activity is unavailable",
			activityRetry: "Retry",
			activityNoOutput: "No displayable output."
		};
		const zh = {
			nav: "外部 Agent",
			title: "Antigravity",
			intro: "原生 ACP 运行时，无需 CLI。",
			rescan: "刷新状态",
			save: "保存更改",
			saved: "已保存",
			saving: "保存中…",
			cancel: "撤销",
			failed: "设置操作失败",
			signIn: "登录",
			signOut: "退出登录",
			openLogin: "打开登录页",
			enabledBadge: "已启用",
			disabledBadge: "已禁用",
			missingBadge: "未安装",
			authBadge: "需要登录",
			connected: "已连接",
			model: "模型",
			install: "安装 Antigravity",
			installing: "安装中…",
			signingIn: "正在打开 Google 登录…",
			loading: "加载中…",
			quota: "账户额度",
			quotaUnavailable: "额度暂不可用",
			refreshQuota: "刷新额度",
			staleQuota: "刷新失败，显示上次快照",
			resetsAt: "重置时间",
			updatedAt: "更新时间",
			account: "账户",
			enableProvider: "启用 Provider",
			unsaved: "有未保存修改",
			modelCount: "{count} 个模型",
			refreshModels: "更新模型目录",
			defaultModel: "默认模型",
			accountDefault: "跟随账户默认",
			nativeModels: "模型目录与能力由原生 ACP 运行时提供；此处不覆盖运行时未支持的模型能力。",
			activityRunning: "{count} 个原生工具进行中",
			activityTools: "{count} 个原生工具",
			activityBetweenTurns: "不在本轮记录区间内；所属轮次未确认。",
			statusPending: "待处理",
			statusRunning: "进行中",
			statusCompleted: "已完成",
			statusFailed: "失败",
			activitySubagent: "子代理",
			activityChildUnknown: "子任务状态不可用",
			activityFailed: "原生工具动态暂不可用",
			activityRetry: "重试",
			activityNoOutput: "无可显示的输出。"
		};
		//#endregion
		//#region src/web/usage-reader.ts
		function createAntigravityUsageReader() {
			return {
				providerKey: "antigravity",
				name: "Antigravity",
				async read(rpc, _refresh, signal) {
					const result = await rpc.call(ACP_SETTINGS_RPC_CHANNEL, QUOTA_ENDPOINT, {}, signal);
					if (!result.ok) return {
						status: "error",
						message: result.error.message
					};
					const quota = decodeQuotaSnapshot(result.value);
					if (quota === void 0) return {
						status: "error",
						message: "Invalid Antigravity quota response"
					};
					if (quota.status === "authentication-required" || quota.status === "account-changed") return { status: "logged-out" };
					if (quota.status === "not-entitled") return { status: "unsupported" };
					if (quota.status !== "ready") return {
						status: "error",
						...quota.message === void 0 ? {} : { message: quota.message }
					};
					return {
						status: "ready",
						fetchedAt: quota.observedAt,
						windows: quota.groups.flatMap((group, gi) => group.buckets.map((bucket, bi) => {
							const remaining = bucket.disabled || bucket.remainingFraction === void 0 ? void 0 : bucket.remainingFraction * 100;
							const label = [group.displayName, bucket.displayName ?? bucket.window].filter(Boolean).join(" · ") || "Antigravity";
							return {
								id: String(gi) + ":" + (bucket.bucketId ?? String(bi)),
								label,
								shortLabel: bucket.window ?? label,
								valueText: remaining === void 0 ? "—" : new Intl.NumberFormat(void 0, { maximumFractionDigits: 2 }).format(remaining) + "%",
								...remaining === void 0 ? {} : { remainingPercent: remaining },
								...bucket.resetTime === void 0 ? {} : { resetsAt: bucket.resetTime }
							};
						}))
					};
				}
			};
		}
		//#endregion
		//#region src/web/index.ts
		const name = "dsh-acp-antigravity-client";
		const inject = [
			"slots",
			"locale",
			"connection",
			"uiConversation"
		];
		function installProviderDirectory(ctx) {
			ctx.inject(["providerDirectory"], (scope) => {
				const directory = scope.providerDirectory;
				scope.effect(() => directory.register({
					key: "antigravity",
					role: "agent",
					header: "shared",
					usage: createAntigravityUsageReader()
				}), "dsh-acp-antigravity: provider directory registration");
			});
		}
		function apply(ctx) {
			installProviderDirectory(ctx);
			const localeNamespace = "settings.external-agents";
			ctx.effect(() => ctx.locale.register(localeNamespace, {
				zh,
				en
			}), "dsh-acp-antigravity: Settings page copy");
			const t = ctx.locale.bind(localeNamespace);
			const { rpc } = ctx.connection;
			const invalidateUsage = () => {
				dropPersistedUsageKeys(["antigravity"]);
				ctx.get("providerDirectory")?.invalidateUsage("antigravity");
			};
			let acceptedRow;
			const load = async () => {
				const result = await rpc.call(ACP_SETTINGS_RPC_CHANNEL, SNAPSHOT_ENDPOINT, {}, void 0);
				if (!result.ok) throw new Error(result.error.message);
				const decoded = decodeSnapshot(result.value);
				if (decoded === void 0) throw new Error(t("failed"));
				if (shouldClearQuota(acceptedRow, decoded.rows[0])) invalidateUsage();
				acceptedRow = decoded.rows[0];
				return decoded;
			};
			const quota = async (signal) => {
				const result = await rpc.call(ACP_SETTINGS_RPC_CHANNEL, QUOTA_ENDPOINT, {}, signal);
				if (!result.ok) throw new Error(result.error.message);
				const decoded = decodeQuotaSnapshot(result.value);
				if (decoded === void 0) throw new Error(t("quotaUnavailable"));
				if (decoded.status === "account-changed" || decoded.status === "authentication-required" || decoded.status === "not-entitled") invalidateUsage();
				return decoded;
			};
			const save = async (row) => {
				const result = await rpc.call(ACP_SETTINGS_RPC_CHANNEL, SAVE_ENDPOINT, {
					executablePath: row.executablePath,
					harnessPath: row.harnessPath,
					stateDirectory: row.stateDirectory,
					instanceId: row.instanceId,
					...row.model === void 0 ? {} : { model: row.model },
					enabled: row.enabled
				}, void 0);
				if (!result.ok) throw new Error(result.error.message);
			};
			const run = async (action, value) => {
				const result = await rpc.call(ACP_SETTINGS_RPC_CHANNEL, "run", {
					action,
					...value === void 0 ? {} : { value }
				}, void 0);
				if (!result.ok) throw new Error(result.error.message);
				if (action === "sign-out" || action === "sign-in") invalidateUsage();
				return result.value;
			};
			const pick = async () => {
				const result = await rpc.call(ACP_SETTINGS_RPC_CHANNEL, PICK_ENDPOINT, {}, void 0);
				if (!result.ok) throw new Error(result.error.message);
				return result.value.path ?? null;
			};
			ctx.slots.inject("settings.provider.item", () => ctx.slots.register({
				name: "settings.provider.item",
				key: "antigravity",
				locale: localeNamespace,
				inject: () => ({
					t,
					load,
					save,
					run,
					pick,
					quota
				})
			}, ExternalAgentsSection));
			ctx.effect(() => ctx.uiConversation.events.register(nativeTurnDefinition), "dsh-acp-antigravity: native turn fold");
			ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
				name: "conversation.chat.node",
				key: "antigravity-native",
				inject: (sessionId) => ({
					t,
					conversationT: ctx.locale.bind("conversation"),
					rpc,
					sessionId,
					uiConversation: ctx.uiConversation
				})
			}, NativeTurnContainer));
			ctx.effect(() => {
				let warned = false;
				const check = () => {
					if (!ctx.slots.entries("settings.section").some((entry) => entry.options.id === "providers") && !warned) {
						warned = true;
						console.warn("[dsh-acp-antigravity] LLM Providers page missing; install dsh-llm-providers-ui to show the Antigravity card.");
					}
				};
				const timer = setTimeout(check, 0);
				const stop = ctx.slots.subscribe("settings.section", check);
				return () => {
					clearTimeout(timer);
					stop();
				};
			}, "dsh-acp-antigravity: providers page diagnostic");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
