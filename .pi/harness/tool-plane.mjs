import { Type } from "../node_modules/@earendil-works/pi-coding-agent/node_modules/typebox/build/index.mjs";
import { normalizeRelativePath, pathIsAllowed, sha256, stableJson } from "./execution-packet.mjs";

const TOOL_SCHEMAS = Object.freeze({
	repo_read: Object.freeze({ path: "relative-path" }),
	repo_search: Object.freeze({ path: "relative-path", query: "non-empty-string" }),
	repo_apply_patch: Object.freeze({ path: "relative-path", content: "string" }),
	git_status: Object.freeze({}),
	git_diff: Object.freeze({ path: "relative-path" }),
});

export const GIT_ONLY_CAPABILITY_MANIFEST = Object.freeze({
	version: 1,
	tools: Object.freeze(["repo_read", "repo_search", "repo_apply_patch", "git_status", "git_diff"]),
	schemas: TOOL_SCHEMAS,
	normalizedActionVersion: "stable-json-v1",
	toolSchemaHash: sha256(TOOL_SCHEMAS),
	forbidden: Object.freeze(["bash", "write", "edit", "network", "docker", "gpu", "ros2", "robot", "git_commit", "process"]),
});

const PROGRESS_KIND = Object.freeze({
	repo_read: "DISCOVERY",
	repo_search: "DISCOVERY",
	repo_apply_patch: "CHANGE",
	git_status: "VERIFICATION",
	git_diff: "VERIFICATION",
});

function textResult(text, details) {
	return { content: [{ type: "text", text }], details };
}

export class GitToolPlane {
	#packet;
	#adapter;
	#ledger;
	#actions = new Map();
	#noProgressTurns = 0;

	constructor({ packet, adapter, ledger }) {
		this.#packet = packet;
		this.#adapter = adapter;
		this.#ledger = ledger;
	}

	preflight(name, args = {}) {
		if (!this.#packet.capabilityManifest.tools.includes(name)) {
			return { allowed: false, terminal: true, code: "CAPABILITY_MISSING", reason: `Capability ${name} is not declared` };
		}
		let normalizedArgs;
		try {
			normalizedArgs = this.#normalizeArgs(name, args);
		} catch (error) {
			return { allowed: false, terminal: true, code: "ALLOWED_CHANGES_REJECTED", reason: error.message };
		}
		const fingerprint = `${name}:${stableJson(normalizedArgs)}`;
		const attempts = this.#actions.get(fingerprint) ?? 0;
		if (attempts >= 2) {
			return { allowed: false, terminal: true, code: "REPEATED_ACTION_BLOCKED", reason: "Identical normalized action reached the fixed limit" };
		}
		this.#actions.set(fingerprint, attempts + 1);
		return { allowed: true, code: "ACCEPTED", fingerprint, normalizedArgs };
	}

	async execute(name, args = {}) {
		const decision = this.preflight(name, args);
		this.#ledger.append("tool_preflight", { name, args, decision });
		if (!decision.allowed) return { decision, result: textResult(decision.reason, decision), receipt: null };
		const result = await this.#adapter[name](decision.normalizedArgs);
		const resultHash = sha256(result);
		this.#ledger.append("tool_finished", { name, fingerprint: decision.fingerprint, resultHash });
		const receipt = {
			kind: PROGRESS_KIND[name],
			tool: name,
			fingerprint: decision.fingerprint,
			resultHash,
		};
		this.#ledger.append("progress_receipt", receipt);
		return { decision, result: textResult(JSON.stringify(result), { result, resultHash }), receipt };
	}

	tools() {
		return [
			this.#tool("repo_read", "Read one allowed repository file.", Type.Object({ path: Type.String() })),
			this.#tool("repo_search", "Search one allowed repository subtree.", Type.Object({ path: Type.String(), query: Type.String() })),
			this.#tool("repo_apply_patch", "Apply content only to one allowed repository file.", Type.Object({ path: Type.String(), content: Type.String() })),
			this.#tool("git_status", "Return the injected Git status snapshot.", Type.Object({})),
			this.#tool("git_diff", "Return the injected Git diff for an allowed path.", Type.Object({ path: Type.String() })),
		];
	}

	settleTurn(hasProgressReceipt) {
		this.#noProgressTurns = hasProgressReceipt ? 0 : this.#noProgressTurns + 1;
		return this.#noProgressTurns >= 2 ? { state: "STUCK", terminal: true } : { state: "RUNNING", terminal: false };
	}

	#tool(name, description, parameters) {
		return {
			name,
			label: name,
			description,
			parameters,
			execute: async (_id, args) => {
				const execution = await this.execute(name, args);
				return { ...execution.result, terminate: !execution.decision.allowed };
			},
		};
	}

	#normalizeArgs(name, args) {
		if (name === "git_status") return {};
		const path = normalizeRelativePath(args?.path);
		if (!pathIsAllowed(path, this.#packet.allowedChanges)) {
			throw new Error(`Path ${path} is outside packet Allowed Changes`);
		}
		if (name === "repo_search") {
			if (typeof args.query !== "string" || args.query.length === 0) throw new Error("repo_search requires query");
			return { path, query: args.query };
		}
		if (name === "repo_apply_patch") {
			if (typeof args.content !== "string") throw new Error("repo_apply_patch requires content");
			return { path, content: args.content };
		}
		return { path };
	}
}

export function createMockGitFileAdapter(initialFiles = {}) {
	const files = new Map(Object.entries(initialFiles));
	const changed = new Set();
	return {
		async repo_read({ path }) {
			return { path, content: files.get(path) ?? "" };
		},
		async repo_search({ path, query }) {
			return {
				path,
				matches: [...files.entries()]
					.filter(([file, content]) => file.startsWith(path) && content.includes(query))
					.map(([file]) => file),
			};
		},
		async repo_apply_patch({ path, content }) {
			files.set(path, content);
			changed.add(path);
			return { path, contentHash: sha256(content) };
		},
		async git_status() {
			return { changed: [...changed].sort() };
		},
		async git_diff({ path }) {
			return { path, changed: changed.has(path), contentHash: sha256(files.get(path) ?? "") };
		},
	};
}
