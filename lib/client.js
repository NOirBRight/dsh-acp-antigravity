window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-acp-antigravity",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client-contract.ts
		/** Browser-safe RPC contract for the External Agents settings page. */
		const ACP_SETTINGS_RPC_CHANNEL = "/dsh-acp-antigravity";
		const SNAPSHOT_ENDPOINT = "snapshot";
		const SAVE_ENDPOINT = "save";
		const PICK_ENDPOINT = "pick";
		function isRecord(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value);
		}
		/** Decode a Settings snapshot from the host RPC. */
		function decodeSnapshot(value) {
			if (!isRecord(value) || value.title !== "External Agents" || !Array.isArray(value.rows)) return void 0;
			const rows = [];
			for (const row of value.rows) {
				if (!isRecord(row)) return void 0;
				if (typeof row.provider !== "string" || typeof row.instanceId !== "string" || typeof row.title !== "string") return void 0;
				if (typeof row.enabled !== "boolean" || typeof row.executablePath !== "string" || typeof row.harnessPath !== "string") return void 0;
				if (typeof row.stateDirectory !== "string" || typeof row.installed !== "boolean" || typeof row.authenticated !== "boolean") return void 0;
				if (typeof row.live !== "boolean" || typeof row.ready !== "boolean" || !Array.isArray(row.models)) return void 0;
				const models = [];
				for (const model of row.models) {
					if (!isRecord(model) || typeof model.id !== "string" || typeof model.name !== "string") return void 0;
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
			const install = isRecord(value.install) && typeof value.install.phase === "string" && typeof value.install.message === "string" && typeof value.install.downloadedBytes === "number" && typeof value.install.totalBytes === "number" ? {
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
		//#endregion
		//#region src/web/ExternalAgentsSection.tsx
		/** External Agents settings page for the Antigravity ACP provider. */
		const sectionStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 16,
			maxWidth: 760,
			color: "var(--dsw-alias-label-primary)"
		};
		const titleStyle = {
			margin: 0,
			fontSize: 20,
			fontWeight: 600,
			lineHeight: "28px"
		};
		const introStyle = {
			margin: 0,
			fontSize: 14,
			lineHeight: "22px",
			color: "var(--dsw-alias-label-tertiary)"
		};
		const cardsStyle = {
			listStyle: "none",
			margin: 0,
			padding: 0,
			display: "grid",
			gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
			gap: 14
		};
		const badge = {
			marginLeft: "auto",
			fontSize: 12,
			fontWeight: 500,
			color: "var(--dsw-alias-label-tertiary)"
		};
		const meta = {
			fontSize: 12,
			lineHeight: "18px",
			color: "var(--dsw-alias-label-tertiary)",
			minHeight: 18
		};
		const field = {
			display: "flex",
			flexDirection: "column",
			gap: 4,
			fontSize: 12,
			color: "var(--dsw-alias-label-secondary)"
		};
		const input = {
			height: 32,
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 8,
			padding: "0 10px",
			background: "var(--dsw-alias-bg-layer-1)",
			color: "var(--dsw-alias-label-primary)",
			fontFamily: "inherit",
			fontSize: 12,
			overflow: "hidden",
			textOverflow: "ellipsis"
		};
		const ghostBtn = {
			height: 32,
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 24,
			background: "transparent",
			color: "inherit",
			fontSize: 13,
			fontWeight: 500,
			cursor: "pointer",
			padding: "0 12px"
		};
		function cardShell(ready, missing) {
			return {
				border: "1px solid " + (ready ? "var(--dsw-alias-label-primary)" : "var(--dsw-alias-border-l2)"),
				borderRadius: 14,
				display: "flex",
				flexDirection: "column",
				background: ready ? "var(--dsw-alias-bg-layer-2)" : "var(--dsw-alias-bg-layer-3)",
				opacity: missing ? .7 : 1,
				minWidth: 0,
				padding: 16,
				gap: 12
			};
		}
		function statusBadge(row, t) {
			if (!row.enabled) return t("disabledBadge");
			if (!row.installed) return t("missingBadge");
			if (!row.authenticated) return t("authBadge");
			return t("enabledBadge");
		}
		function ProviderCard(props) {
			const { row, t, onChange, onLocate, onRun, onSignIn, install, signingIn } = props;
			const installing = install?.phase === "downloading" || install?.phase === "extracting" || install?.phase === "verifying";
			const missing = !row.installed;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				style: cardShell(row.ready && row.enabled, missing || !row.enabled),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							alignItems: "center",
							gap: 10
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								fontSize: 16,
								fontWeight: 600
							},
							children: row.title
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: badge,
							children: statusBadge(row, t)
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						style: {
							display: "flex",
							alignItems: "center",
							gap: 8,
							fontSize: 13,
							color: "var(--dsw-alias-label-secondary)"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "checkbox",
							checked: row.enabled,
							onChange: () => onChange({
								...row,
								enabled: !row.enabled
							})
						}), row.enabled ? t("enabledBadge") : t("disabledBadge")]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: meta,
						children: [row.version, row.message].filter(Boolean).join(" · ")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						style: field,
						children: [
							t("executable"),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								style: input,
								title: row.executablePath,
								value: row.executablePath,
								onChange: (event) => onChange({
									...row,
									executablePath: event.target.value
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: ghostBtn,
								onClick: () => onLocate("executablePath"),
								children: t("locateAcp")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						style: field,
						children: [
							t("harness"),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								style: input,
								title: row.harnessPath,
								value: row.harnessPath,
								onChange: (event) => onChange({
									...row,
									harnessPath: event.target.value
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: ghostBtn,
								onClick: () => onLocate("harnessPath"),
								children: t("locateHarness")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						style: field,
						children: [t("model"), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
							style: input,
							value: row.model ?? "",
							onChange: (event) => onChange({
								...row,
								model: event.target.value || void 0
							}),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: "",
								children: "account default"
							}), row.models.map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
								value: model.id,
								children: model.name
							}, model.id))]
						})]
					}),
					row.profileDirectory ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: meta,
						children: [
							t("profile"),
							": ",
							row.profileDirectory
						]
					}) : null,
					install !== void 0 && install.phase !== "idle" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: meta,
						children: [install.message, install.totalBytes > 0 && installing ? " " + String(Math.round(100 * install.downloadedBytes / install.totalBytes)) + "%" : ""]
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							gap: 8,
							flexWrap: "wrap"
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: ghostBtn,
								disabled: installing,
								onClick: () => onRun("install-runtime"),
								children: installing ? t("installing") : t("install")
							}),
							row.authenticated ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: ghostBtn,
								onClick: () => onRun("sign-out"),
								children: t("signOut")
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: ghostBtn,
								disabled: signingIn === true,
								onClick: onSignIn,
								children: signingIn === true ? t("signingIn") : t("signIn")
							}),
							row.authorizationUrl ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: ghostBtn,
								onClick: () => onRun("open-login"),
								children: t("openLogin")
							}) : null
						]
					})
				]
			});
		}
		function ExternalAgentsSection(props) {
			const { t, load, save, run, pick } = props;
			const [snapshot, setSnapshot] = (0, react.useState)(void 0);
			const [draft, setDraft] = (0, react.useState)(void 0);
			const [saveStatus, setSaveStatus] = (0, react.useState)("idle");
			const [error, setError] = (0, react.useState)(void 0);
			const refresh = async () => {
				let next = await load();
				setSnapshot(next);
				setDraft(next.rows[0]);
				try {
					if ((next.rows[0]?.executablePath ?? "").trim() === "") await run("probe-installation");
					next = await load();
					setSnapshot(next);
					setDraft(next.rows[0]);
				} catch {}
				if (next.rows[0]?.authenticated) {
					try {
						await run("refresh-models");
					} catch {}
					const after = await load();
					setSnapshot(after);
					setDraft(after.rows[0]);
				}
			};
			(0, react.useEffect)(() => {
				refresh().catch((caught) => setError(caught instanceof Error ? caught.message : t("failed")));
			}, []);
			const installPhase = snapshot?.install?.phase;
			(0, react.useEffect)(() => {
				if (installPhase !== "downloading" && installPhase !== "extracting" && installPhase !== "verifying") return;
				const timer = window.setInterval(() => {
					load().then((next) => {
						setSnapshot(next);
						setDraft(next.rows[0]);
						if (next.install?.phase === "succeeded" || next.install?.phase === "failed") return;
					}).catch(() => void 0);
				}, 500);
				return () => window.clearInterval(timer);
			}, [installPhase, load]);
			const signingIn = snapshot?.signingIn === true;
			(0, react.useEffect)(() => {
				if (!signingIn) return;
				const timer = window.setInterval(() => {
					load().then((next) => {
						setSnapshot(next);
						setDraft(next.rows[0]);
					}).catch(() => void 0);
				}, 500);
				return () => window.clearInterval(timer);
			}, [signingIn, load]);
			const row = draft;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				style: sectionStyle,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							alignItems: "center",
							gap: 8
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h1", {
								style: titleStyle,
								children: [
									t("title"),
									" ",
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: badge,
										children: t("badgeAgent")
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: { marginLeft: "auto" } }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: ghostBtn,
								onClick: () => {
									refresh().catch((caught) => setError(caught instanceof Error ? caught.message : t("failed")));
								},
								children: t("rescan")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								style: {
									...ghostBtn,
									background: "var(--dsw-alias-label-primary)",
									color: "var(--dsw-alias-bg-layer-1)",
									border: 0
								},
								disabled: row === void 0 || saveStatus === "saving",
								onClick: () => {
									if (row === void 0) return;
									setSaveStatus("saving");
									save(row).then(() => {
										setSaveStatus("saved");
										return refresh();
									}).catch((caught) => {
										setSaveStatus("idle");
										setError(caught instanceof Error ? caught.message : t("failed"));
									});
								},
								children: saveStatus === "saved" ? t("saved") : t("save")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: introStyle,
						children: t("intro")
					}),
					error ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						style: {
							...introStyle,
							color: "var(--dsw-alias-label-danger, #c00)"
						},
						children: error
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						style: cardsStyle,
						children: row === void 0 || snapshot === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProviderCard, {
							row,
							t,
							onChange: setDraft,
							onLocate: (target) => {
								pick().then((path) => {
									if (path === null) return;
									setDraft((current) => current === void 0 ? current : {
										...current,
										[target]: path,
										...target === "executablePath" && current.harnessPath === "" ? { harnessPath: path.replace(/agy_acp_server[^/]*$/u, "localharness_external") } : {}
									});
								});
							},
							install: snapshot.install,
							signingIn: snapshot.signingIn,
							onSignIn: () => {
								run("sign-in").then(() => load()).then((next) => {
									setSnapshot(next);
									setDraft(next.rows[0]);
								}).catch((caught) => setError(caught instanceof Error ? caught.message : t("failed")));
							},
							onRun: (action) => {
								run(action).then(() => refresh()).catch((caught) => setError(caught instanceof Error ? caught.message : t("failed")));
							}
						})
					})
				]
			});
		}
		/**
		* Fold one event in ascending session-log order.
		* @param state - Current row state, if its start is already loaded.
		* @param event - Next event for this row.
		* @returns The new row state.
		*/
		function foldAntigravityToolEvent(state, event) {
			if (event.type === "antigravity/tool-start") {
				if (state !== void 0) throw new Error("Antigravity tool start repeats toolId " + state.toolId);
				return event.data;
			}
			if (state === void 0) return {
				toolId: event.data.toolId,
				name: "native tool",
				status: event.data.status,
				...event.data.location === void 0 ? {} : { location: event.data.location },
				...event.data.output === void 0 ? {} : { output: event.data.output },
				...event.data.error === void 0 ? {} : { error: event.data.error }
			};
			if (event.data.toolId !== state.toolId) throw new Error("Antigravity tool update carries foreign toolId " + event.data.toolId);
			return {
				...state,
				status: event.data.status,
				...event.data.location === void 0 ? {} : { location: event.data.location },
				...event.data.output === void 0 ? {} : { output: event.data.output },
				...event.data.error === void 0 ? {} : { error: event.data.error }
			};
		}
		//#endregion
		//#region src/web/AntigravityToolNode.tsx
		/** Conversation node renderer for Antigravity native tool activity. */
		const rowStyle = {
			border: "1px solid var(--dsw-alias-border-secondary)",
			borderRadius: 8,
			background: "var(--dsw-alias-background-secondary)",
			color: "var(--dsw-alias-label-primary)",
			fontSize: 13,
			lineHeight: "20px",
			overflow: "hidden"
		};
		const triggerStyle = {
			display: "flex",
			alignItems: "center",
			width: "100%",
			minHeight: 36,
			border: 0,
			background: "transparent",
			color: "inherit",
			cursor: "pointer",
			padding: "8px 10px",
			textAlign: "left",
			gap: 8
		};
		const dotStyle = {
			pending: { background: "var(--dsw-alias-label-tertiary)" },
			running: { background: "var(--dsw-alias-function)" },
			completed: { background: "var(--dsw-alias-success)" },
			failed: { background: "var(--dsw-alias-danger)" }
		};
		/** Folded row definition consumed by DSH's conversation node assembler. */
		const antigravityToolDefinition = {
			kind: "antigravity-tool",
			target: "chat",
			match: (event) => event.type === "antigravity/tool-start" ? {
				id: event.data.toolId,
				role: "start"
			} : event.type === "antigravity/tool-update" ? {
				id: event.data.toolId,
				role: "update"
			} : null,
			start: (_context, match) => match.event.data,
			update: (context, match) => foldAntigravityToolEvent(context.state, match.event),
			publication: (match) => match.event.type === "antigravity/tool-update" ? "immediate" : "animation-frame",
			buildViewNode: (context) => context.state === void 0 ? null : {
				key: context.key,
				kind: "antigravity-tool",
				id: context.id,
				target: "chat",
				anchorSeq: context.start?.event.seq ?? context.matches[0]?.event.seq ?? 0,
				location: context.start?.location ?? context.matches[0]?.location ?? { kind: "unresolved" },
				visibility: "visible",
				data: context.state
			}
		};
		/** ToolRow-like disclosure for one folded native tool row. */
		function AntigravityToolNode({ node }) {
			const [expanded, setExpanded] = (0, react.useState)(false);
			const { data } = node;
			const detail = data.error ?? data.output;
			const terminal = data.status === "completed" || data.status === "failed";
			const canExpand = detail !== void 0 || terminal;
			const renderedDetail = detail ?? (terminal ? "No displayable output." : void 0);
			const link = data.location === void 0 ? null : (0, react.createElement)("a", {
				href: data.location.kind === "url" ? data.location.target : "file://" + data.location.target,
				onClick: (event) => {
					event.stopPropagation();
				},
				style: {
					color: "var(--dsw-alias-label-link)",
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap"
				},
				target: data.location.kind === "url" ? "_blank" : void 0,
				rel: data.location.kind === "url" ? "noreferrer" : void 0
			}, data.location.target);
			return (0, react.createElement)("section", { style: rowStyle }, (0, react.createElement)("button", {
				type: "button",
				style: triggerStyle,
				onClick: canExpand ? () => {
					setExpanded((value) => !value);
				} : void 0,
				"aria-expanded": canExpand ? expanded : void 0,
				"aria-label": data.name + ", " + data.status
			}, (0, react.createElement)("span", {
				"aria-hidden": true,
				style: {
					width: 8,
					height: 8,
					borderRadius: "50%",
					flex: "0 0 auto",
					...dotStyle[data.status]
				}
			}), (0, react.createElement)("span", { style: {
				fontWeight: 500,
				whiteSpace: "nowrap"
			} }, data.name), link === null ? null : (0, react.createElement)("span", { style: {
				minWidth: 0,
				flex: 1
			} }, link), (0, react.createElement)("span", { style: {
				color: "var(--dsw-alias-label-tertiary)",
				marginLeft: "auto",
				whiteSpace: "nowrap"
			} }, data.status), (0, react.createElement)("span", { style: { color: "var(--dsw-alias-label-tertiary)" } }, canExpand ? expanded ? "⌃" : "⌄" : null)), expanded && renderedDetail !== void 0 ? (0, react.createElement)("pre", { style: {
				maxHeight: 240,
				overflow: "auto",
				margin: 0,
				padding: "8px 12px 12px 28px",
				borderTop: "1px solid var(--dsw-alias-border-secondary)",
				background: "var(--dsw-alias-background-tertiary)",
				color: data.error === void 0 ? "var(--dsw-alias-label-secondary)" : "var(--dsw-alias-danger)",
				whiteSpace: "pre-wrap"
			} }, renderedDetail) : null);
		}
		//#endregion
		//#region src/web/locales.ts
		const zh = {
			nav: "External Agents",
			title: "External Agents",
			intro: "Install 会从 Google 下载 ACP 运行时（agy_acp_server.par + localharness_external），不使用 agy CLI。完成后 Sign in。",
			rescan: "Rescan",
			save: "Save",
			saved: "Saved",
			failed: "设置操作失败",
			locateAcp: "Locate ACP executable",
			locateHarness: "Locate harness",
			signIn: "Sign in",
			signOut: "Sign out",
			openLogin: "Open login URL",
			enabledBadge: "Enabled",
			disabledBadge: "Disabled",
			missingBadge: "Missing",
			authBadge: "Sign-in required",
			model: "Model",
			executable: "ACP server",
			harness: "localharness_external",
			profile: "Profile",
			install: "Install Antigravity",
			installing: "Installing…",
			signingIn: "Opening Google in your default browser…",
			badgeAgent: "Agent"
		};
		const en = { ...zh };
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
			let directory;
			try {
				directory = ctx.get("providerDirectory", false);
			} catch {
				return;
			}
			if (directory !== void 0) ctx.effect(() => directory.register({
				key: "antigravity",
				role: "agent"
			}), "dsh-acp-antigravity: provider directory registration");
		}
		function apply(ctx) {
			installProviderDirectory(ctx);
			ctx.effect(() => ctx.uiConversation.events.register(antigravityToolDefinition), "dsh-acp-antigravity: native tool event fold");
			ctx.effect(() => ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
				name: "conversation.chat.node",
				key: "antigravity-tool"
			}, AntigravityToolNode)), "dsh-acp-antigravity: native tool row");
			const localeNamespace = "settings.external-agents";
			ctx.effect(() => ctx.locale.register(localeNamespace, {
				zh,
				en
			}), "dsh-acp-antigravity: Settings page copy");
			const t = ctx.locale.bind(localeNamespace);
			const { rpc } = ctx.connection;
			const load = async () => {
				const result = await rpc.call(ACP_SETTINGS_RPC_CHANNEL, SNAPSHOT_ENDPOINT, {}, void 0);
				if (!result.ok) throw new Error(result.error.message);
				const decoded = decodeSnapshot(result.value);
				if (decoded === void 0) throw new Error(t("failed"));
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
					pick
				})
			}, ExternalAgentsSection));
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
