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
		//#region node_modules/.pnpm/dsh-llm-providers-ui@file+..+dsh-providers-settings-a_@deepseek-ai+cordis@4.0.2_@deepse_d16fda1ec0c0eccdc68667da53c41be8/node_modules/dsh-llm-providers-ui/lib/provider-ui.js
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
		/** Antigravity provider settings: live ACP configuration and account quota, never CLI output. */
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
		const button$1 = {
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
		const muted$1 = {
			margin: 0,
			fontSize: 12,
			color: "var(--dsw-alias-label-tertiary)",
			overflowWrap: "anywhere"
		};
		const localCss$1 = "[data-provider-body][hidden]{display:none!important}[data-antigravity-quota]{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px 24px}[data-antigravity-heading]{font-size:13px;font-weight:600;margin:0}@media(max-width:680px){[data-antigravity-quota]{grid-template-columns:1fr}[data-provider-card=\"antigravity\"] button,[data-provider-card=\"antigravity\"] select,[data-provider-card=\"antigravity\"] input:not([type=checkbox]){min-height:44px}}";
		function ExternalAgentsSection({ t, load, save, run, pick, quota: readQuota }) {
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
				quotaEpoch.current++;
				quotaAbort.current?.abort();
				setQuota(void 0);
				setQuotaError(void 0);
				setQuotaLoading(false);
			};
			const accept = (next) => {
				const previous = snapshotRef.current?.rows[0], incoming = next.rows[0];
				if (previous?.instanceId !== incoming?.instanceId || previous?.stateDirectory !== incoming?.stateDirectory || !incoming?.authenticated) clearQuota();
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
					} else {
						if (next.status !== "error") setQuota(void 0);
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
			const locate = async (target) => {
				try {
					const path = await pick();
					if (!mounted.current || path === null) return;
					dirtyRef.current = true;
					setDirty(true);
					setDraft((current) => current === void 0 ? current : {
						...current,
						[target]: path,
						...target === "executablePath" && current.harnessPath === "" ? { harnessPath: path.replace(/agy_acp_server[^/]*$/u, "localharness_external") } : {}
					});
				} catch (caught) {
					fail(caught);
				}
			};
			const row = draft;
			const status = row === void 0 ? t("loading") : !row.enabled ? t("disabledBadge") : !row.installed ? t("missingBadge") : !row.authenticated ? t("authBadge") : t("connected");
			const first = quota?.groups.flatMap((group) => group.buckets.map((bucket) => ({
				group: group.displayName,
				bucket
			}))).find((item) => !item.bucket.disabled && item.bucket.remainingFraction !== void 0);
			const headerQuota = first === void 0 ? void 0 : {
				...first.bucket.remainingFraction === void 0 ? {} : { remainingFraction: first.bucket.remainingFraction },
				label: [first.group, first.bucket.window ?? first.bucket.displayName].filter(Boolean).join(" · "),
				...quotaError === void 0 ? {} : { detail: t("staleQuota") }
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				"data-provider-card": "antigravity",
				"data-provider-role": "agent",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: providerUiCss + localCss$1 }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						"data-provider-card-header": true,
						"aria-expanded": open,
						onClick: () => setOpen(!open),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProviderCardHeader, {
							title: "Antigravity",
							mark: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(BrandMark, {}),
							role: "agent",
							summary: t("modelCount").replace("{count}", String(row?.models.length ?? 0)),
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
								...muted$1,
								color: "var(--dsw-alias-state-error-primary)"
							},
							children: error
						}), row && snapshot ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
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
											onChange: () => change({
												...row,
												enabled: !row.enabled
											})
										}), t("enableProvider")]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										style: muted$1,
										children: [row.version, row.message].filter(Boolean).join(" · ")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: actions,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												style: button$1,
												disabled: working || polling,
												onClick: () => void action(row.authenticated ? "sign-out" : "sign-in"),
												children: snapshot.signingIn ? t("signingIn") : row.authenticated ? t("signOut") : t("signIn")
											}),
											row.authorizationUrl && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												style: button$1,
												disabled: working,
												onClick: () => void action("open-login"),
												children: t("openLogin")
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												style: button$1,
												disabled: working || polling,
												onClick: () => void refresh().catch(fail),
												children: t("rescan")
											})
										]
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
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
											style: button$1,
											disabled: !row.authenticated || quotaLoading || working,
											onClick: () => void fetchQuota(),
											children: quotaLoading ? t("loading") : t("refreshQuota")
										})]
									}),
									quotaError && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
										role: "status",
										style: muted$1,
										children: [quotaError, quota ? " · " + t("staleQuota") : ""]
									}),
									!quota && !quotaError && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										style: muted$1,
										children: row.authenticated ? t("quotaUnavailable") : t("authBadge")
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
										style: muted$1,
										children: [
											t("updatedAt"),
											" ",
											new Date(quota.observedAt).toLocaleString()
										]
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
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
											style: button$1,
											disabled: !row.authenticated || working,
											onClick: () => void action("refresh-models"),
											children: t("refreshModels")
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										style: field,
										children: [t("defaultModel"), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
											style: control,
											value: row.model ?? "",
											disabled: saving,
											onChange: (event) => {
												const next = { ...row };
												if (event.target.value) next.model = event.target.value;
												else delete next.model;
												change(next);
											},
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
										style: muted$1,
										children: t("nativeModels")
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
								style: section,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: t("advanced") }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										style: field,
										children: [
											t("executable"),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												style: control,
												value: row.executablePath,
												disabled: saving,
												onChange: (event) => change({
													...row,
													executablePath: event.target.value
												})
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												style: button$1,
												disabled: saving,
												onClick: () => void locate("executablePath"),
												children: t("locateAcp")
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										style: field,
										children: [
											t("harness"),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												style: control,
												value: row.harnessPath,
												disabled: saving,
												onChange: (event) => change({
													...row,
													harnessPath: event.target.value
												})
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												style: button$1,
												disabled: saving,
												onClick: () => void locate("harnessPath"),
												children: t("locateHarness")
											})
										]
									}),
									row.profileDirectory && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
										style: muted$1,
										children: [
											t("profile"),
											": ",
											row.profileDirectory
										]
									}),
									snapshot.install && phase !== "idle" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
										role: "status",
										style: muted$1,
										children: [snapshot.install.message, snapshot.install.totalBytes > 0 && polling ? " " + Math.round(100 * snapshot.install.downloadedBytes / snapshot.install.totalBytes) + "%" : ""]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: button$1,
										disabled: working || polling,
										onClick: () => void action("install-runtime"),
										children: polling ? t("installing") : t("install")
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
											...muted$1,
											marginRight: "auto"
										},
										children: t("unsaved")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: button$1,
										disabled: !dirty || saving,
										onClick: () => {
											dirtyRef.current = false;
											setDirty(false);
											setDraft(snapshot.rows[0]);
										},
										children: t("cancel")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: button$1,
										disabled: !dirty || saving || working,
										onClick: () => void persist(),
										children: saving ? t("saving") : t("save")
									})
								]
							})
						] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							role: "status",
							style: muted$1,
							children: t("loading")
						})]
					})
				]
			});
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
		//#region src/activity-contract.ts
		/** Browser-safe activity DTOs, endpoints, and decoders shared by the store and the settings RPC. */
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
			throw corrupt("line " + String(seq) + " has an unknown type or data");
		}
		function isSessionReadyData(value) {
			return isRecord(value) && value.provider === "antigravity";
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
			return value.location === void 0 || isToolLocation(value.location);
		}
		function isToolUpdateData(value) {
			if (!isRecord(value)) return false;
			if (stringValue(value.toolId) === void 0 || !isToolStatus(value.status)) return false;
			if (value.location !== void 0 && !isToolLocation(value.location)) return false;
			if (value.output !== void 0 && typeof value.output !== "string") return false;
			return value.error === void 0 || typeof value.error === "string";
		}
		//#endregion
		//#region src/web/AntigravityToolNode.tsx
		/** Disclosure row for one folded Antigravity native tool. Pure renderer: no Core, no Chat. */
		const rowStyle = {
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 8,
			background: "var(--dsw-alias-bg-layer-1)",
			color: "var(--dsw-alias-label-primary)",
			fontSize: 13,
			lineHeight: "20px",
			overflow: "hidden"
		};
		const summaryStyle = {
			display: "flex",
			alignItems: "center",
			width: "100%",
			minHeight: 44,
			cursor: "pointer",
			padding: "8px 10px",
			gap: 8,
			boxSizing: "border-box"
		};
		const dotStyle = {
			pending: { background: "var(--dsw-alias-label-tertiary)" },
			running: { background: "var(--dsw-alias-state-warn-primary)" },
			completed: { background: "var(--dsw-alias-state-success-primary)" },
			failed: { background: "var(--dsw-alias-state-error-primary)" }
		};
		const bodyStyle = {
			borderTop: "1px solid var(--dsw-alias-border-l2)",
			padding: "8px 12px 12px 26px",
			display: "flex",
			flexDirection: "column",
			gap: 6,
			minWidth: 0
		};
		const preStyle = {
			maxHeight: 240,
			overflow: "auto",
			margin: 0,
			whiteSpace: "pre-wrap",
			overflowWrap: "anywhere"
		};
		/** One folded tool row; detail disclosure needs no state. */
		function AntigravityToolNode({ row, noOutput }) {
			const { state } = row;
			const label = state.name + ", " + state.status;
			const summary = [
				(0, react.createElement)("span", {
					key: "dot",
					"aria-hidden": true,
					style: {
						width: 8,
						height: 8,
						borderRadius: "50%",
						flex: "0 0 auto",
						...dotStyle[state.status]
					}
				}),
				(0, react.createElement)("span", {
					key: "name",
					style: {
						fontWeight: 500,
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap"
					}
				}, state.name),
				(0, react.createElement)("span", {
					key: "status",
					style: {
						color: "var(--dsw-alias-label-tertiary)",
						marginLeft: "auto",
						whiteSpace: "nowrap"
					}
				}, state.status),
				(0, react.createElement)("time", {
					key: "time",
					dateTime: row.time,
					style: {
						color: "var(--dsw-alias-label-tertiary)",
						whiteSpace: "nowrap"
					}
				}, new Date(row.time).toLocaleString())
			];
			const detail = state.error ?? state.output;
			const terminal = state.status === "completed" || state.status === "failed";
			const location = state.location;
			const link = location === void 0 ? null : location.kind === "url" && /^https?:\/\//u.test(location.target) ? (0, react.createElement)("a", {
				style: {
					color: "var(--dsw-alias-label-primary)",
					overflowWrap: "anywhere"
				},
				href: location.target,
				target: "_blank",
				rel: "noreferrer"
			}, location.target) : (0, react.createElement)("span", { style: {
				color: "var(--dsw-alias-label-tertiary)",
				overflowWrap: "anywhere"
			} }, location.target);
			if (link === null && detail === void 0 && !terminal) return (0, react.createElement)("section", {
				style: rowStyle,
				"aria-label": label
			}, (0, react.createElement)("div", { style: {
				...summaryStyle,
				cursor: "default"
			} }, summary));
			return (0, react.createElement)("section", { style: rowStyle }, (0, react.createElement)("details", { style: { margin: 0 } }, (0, react.createElement)("summary", {
				style: summaryStyle,
				"aria-label": label
			}, summary), (0, react.createElement)("div", { style: bodyStyle }, link, detail === void 0 ? terminal ? (0, react.createElement)("span", { style: { color: "var(--dsw-alias-label-tertiary)" } }, noOutput) : null : (0, react.createElement)("pre", { style: {
				...preStyle,
				color: state.error === void 0 ? "var(--dsw-alias-label-primary)" : "var(--dsw-alias-state-error-primary)"
			} }, detail))));
		}
		//#endregion
		//#region src/web/AntigravityActivityView.tsx
		/** Standalone native activity sidecar view: one session history over RPC, never Core events. */
		/** Fold history records into display rows, oldest first. Native tool ids can repeat across startups: the (epoch, tool id) pair only routes updates, while every new row keys on its record seq, so ids containing newlines can never collide.
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
				const id = String(epoch) + "\n" + record.data.toolId;
				if (record.type === "antigravity/tool-start") {
					indexById.set(id, rows.length);
					rows.push({
						key: String(record.seq),
						state: record.data,
						time: record.time
					});
					continue;
				}
				const index = indexById.get(id);
				if (index === void 0) {
					indexById.set(id, rows.length);
					rows.push({
						key: String(record.seq),
						state: foldAntigravityToolEvent(void 0, {
							type: record.type,
							data: record.data
						}),
						time: record.time
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
			return rows;
		}
		const wrap = {
			display: "flex",
			flexDirection: "column",
			gap: 8,
			padding: "12px 0",
			minWidth: 0
		};
		const toolbar = {
			display: "flex",
			alignItems: "center",
			gap: 8
		};
		const button = {
			minHeight: 36,
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: 5,
			padding: "7px 10px",
			color: "var(--dsw-alias-label-primary)",
			background: "var(--dsw-alias-bg-layer-1)",
			cursor: "pointer"
		};
		const muted = {
			margin: 0,
			fontSize: 12,
			color: "var(--dsw-alias-label-tertiary)",
			overflowWrap: "anywhere"
		};
		const localCss = "@media(max-width:680px){[data-antigravity-activity] button{min-height:44px}}";
		/** Sidecar tab: initial load plus manual refresh; local failure stays inside the tab. */
		function AntigravityActivityView({ t, read }) {
			const [rows, setRows] = (0, react.useState)();
			const [error, setError] = (0, react.useState)();
			const [loading, setLoading] = (0, react.useState)(false);
			const epoch = (0, react.useRef)(0);
			const pending = (0, react.useRef)();
			const mounted = (0, react.useRef)(false);
			const fail = (caught) => {
				if (mounted.current) setError(caught instanceof Error ? caught.message : t("activityFailed"));
			};
			const refresh = async () => {
				const current = ++epoch.current;
				pending.current?.abort();
				const controller = new AbortController();
				pending.current = controller;
				setLoading(true);
				try {
					const next = await read(controller.signal);
					if (!mounted.current || current !== epoch.current) return;
					setRows(foldActivityRecords(next.records));
					setError(void 0);
				} catch (caught) {
					if (!mounted.current || current !== epoch.current || controller.signal.aborted) return;
					fail(caught);
				} finally {
					if (mounted.current && current === epoch.current) setLoading(false);
				}
			};
			(0, react.useEffect)(() => {
				mounted.current = true;
				setRows(void 0);
				setError(void 0);
				refresh().catch(fail);
				return () => {
					mounted.current = false;
					epoch.current++;
					pending.current?.abort();
				};
			}, [read]);
			const body = rows === void 0 ? !error && (0, react.createElement)("p", {
				role: "status",
				style: muted
			}, t("activityLoading")) : rows.length === 0 ? (0, react.createElement)("p", { style: muted }, t("activityEmpty")) : rows.map((row) => (0, react.createElement)(AntigravityToolNode, {
				key: row.key,
				row,
				noOutput: t("activityNoOutput")
			}));
			return (0, react.createElement)("section", {
				"data-antigravity-activity": true,
				"aria-label": t("activityView"),
				style: wrap
			}, (0, react.createElement)("style", null, localCss), (0, react.createElement)("div", { style: toolbar }, (0, react.createElement)("button", {
				type: "button",
				style: button,
				disabled: loading,
				onClick: () => void refresh().catch(fail)
			}, loading ? t("activityLoading") : t("activityRefresh"))), error && (0, react.createElement)("p", {
				role: "alert",
				style: {
					...muted,
					color: "var(--dsw-alias-state-error-primary)"
				}
			}, error), body);
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
			locateAcp: "Locate ACP executable",
			locateHarness: "Locate harness",
			signIn: "Sign in",
			signOut: "Sign out",
			openLogin: "Open login page",
			enabledBadge: "Enabled",
			disabledBadge: "Disabled",
			missingBadge: "Not installed",
			authBadge: "Sign-in required",
			connected: "Connected",
			model: "Models",
			executable: "ACP server",
			harness: "localharness_external",
			profile: "Profile",
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
			advanced: "Advanced / runtime",
			unsaved: "Unsaved changes",
			modelCount: "{count} models",
			refreshModels: "Refresh models",
			defaultModel: "Default model",
			accountDefault: "Account default",
			nativeModels: "Model availability and capabilities are supplied by the native ACP runtime. This card does not override unsupported model capabilities.",
			activityView: "Antigravity Activity",
			activityRefresh: "Refresh",
			activityLoading: "Loading activity…",
			activityEmpty: "No tool activity yet.",
			activityFailed: "Activity unavailable",
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
			locateAcp: "选择 ACP 可执行文件",
			locateHarness: "选择 harness",
			signIn: "登录",
			signOut: "退出登录",
			openLogin: "打开登录页",
			enabledBadge: "已启用",
			disabledBadge: "已禁用",
			missingBadge: "未安装",
			authBadge: "需要登录",
			connected: "已连接",
			model: "模型",
			executable: "ACP 服务",
			harness: "localharness_external",
			profile: "配置目录",
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
			advanced: "高级设置 / 运行时",
			unsaved: "有未保存修改",
			modelCount: "{count} 个模型",
			refreshModels: "更新模型目录",
			defaultModel: "默认模型",
			accountDefault: "跟随账户默认",
			nativeModels: "模型目录与能力由原生 ACP 运行时提供；此处不覆盖运行时未支持的模型能力。",
			activityView: "Antigravity 动态",
			activityRefresh: "刷新",
			activityLoading: "正在加载动态…",
			activityEmpty: "暂无工具动态。",
			activityFailed: "动态暂不可用",
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
			"connection"
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
				ctx.get("providerDirectory")?.invalidateUsage("antigravity");
			};
			const load = async () => {
				const result = await rpc.call(ACP_SETTINGS_RPC_CHANNEL, SNAPSHOT_ENDPOINT, {}, void 0);
				if (!result.ok) throw new Error(result.error.message);
				const decoded = decodeSnapshot(result.value);
				if (decoded === void 0) throw new Error(t("failed"));
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
			ctx.effect(() => ctx.slots.inject("conversation.view", () => ctx.slots.register({
				name: "conversation.view",
				id: "antigravity",
				order: 11,
				locale: localeNamespace,
				label: () => t("activityView"),
				inject: (sessionId) => ({
					t,
					read: async (signal) => {
						const result = await rpc.call(ACP_SETTINGS_RPC_CHANNEL, ACTIVITY_ENDPOINT, { sessionId }, signal);
						if (!result.ok) throw new Error(result.error.message);
						try {
							return decodeActivityHistory(result.value);
						} catch {
							throw new Error(t("activityFailed"));
						}
					}
				})
			}, AntigravityActivityView)), "dsh-acp-antigravity: native activity sidecar view");
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
