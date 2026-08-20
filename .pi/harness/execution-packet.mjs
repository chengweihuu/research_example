import { createHash } from "node:crypto";
import { isAbsolute, posix } from "node:path";

export function stableJson(value) {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

export function sha256(value) {
	return createHash("sha256").update(typeof value === "string" ? value : stableJson(value)).digest("hex");
}

export function normalizeRelativePath(path) {
	if (typeof path !== "string" || path.length === 0 || isAbsolute(path)) {
		throw new Error("Path must be a non-empty relative path");
	}
	const normalized = posix.normalize(path.replaceAll("\\", "/"));
	if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
		throw new Error("Path escapes the repository root");
	}
	return normalized;
}

export function pathIsAllowed(path, allowedChanges) {
	const normalized = normalizeRelativePath(path);
	return allowedChanges.some((entry) => {
		if (typeof entry !== "string" || entry.length === 0) return false;
		const directory = entry.endsWith("/");
		const allowed = normalizeRelativePath(directory ? entry.slice(0, -1) : entry);
		return directory ? normalized.startsWith(`${allowed}/`) : normalized === allowed;
	});
}

export function createExecutionPacket(input) {
	const requiredStrings = ["taskId", "branch", "ref", "outputDir"];
	for (const key of requiredStrings) {
		if (typeof input?.[key] !== "string" || input[key].length === 0) {
			throw new Error(`Execution Packet requires ${key}`);
		}
	}
	if (!isAbsolute(input.outputDir)) {
		throw new Error("Execution Packet outputDir must be absolute");
	}
	if (!Array.isArray(input.allowedChanges) || input.allowedChanges.length === 0) {
		throw new Error("Execution Packet requires non-empty allowedChanges");
	}
	if (!input.capabilityManifest || !input.contextManifest || !input.budgetQuote) {
		throw new Error("Execution Packet requires capabilityManifest, contextManifest, and budgetQuote");
	}
	for (const key of ["liveModelCalls", "fauxModelCalls", "tokenReservation", "currencyReservation", "retryLimit", "compactionLimit"]) {
		if (typeof input.budgetQuote[key] !== "number" || input.budgetQuote[key] < 0) {
			throw new Error(`Execution Packet budgetQuote requires non-negative ${key}`);
		}
	}
	const packet = {
		kind: "harness-execution-packet",
		version: 1,
		taskId: input.taskId,
		branch: input.branch,
		ref: input.ref,
		outputDir: input.outputDir,
		allowedChanges: input.allowedChanges.map(normalizeRelativePath),
		capabilityManifest: input.capabilityManifest,
		contextManifest: input.contextManifest,
		contextManifestHash: sha256(input.contextManifest),
		budgetQuote: input.budgetQuote,
	};
	return Object.freeze({ ...packet, packetHash: sha256(packet) });
}
