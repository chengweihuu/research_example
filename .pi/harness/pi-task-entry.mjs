import { readFile } from "node:fs/promises";
import { AssistantMessageEventStream } from "../node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js";
import { runPiHarnessTask } from "./pi-task-adapter.mjs";

const FIELDS = new Set(["ideaId", "taskId", "runId", "question", "outputDir", "branch", "ref", "catalogModel", "mode"]);
const MODEL_FIELDS = new Set(["id", "provider", "api", "maxTokens", "cost"]);

function nonEmpty(value, name) {
	if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
}

export function validateEntryRequest(request) {
	if (!request || typeof request !== "object" || Array.isArray(request)) throw new TypeError("request must be an object");
	for (const key of Object.keys(request)) if (!FIELDS.has(key)) throw new TypeError(`unknown request field: ${key}`);
	for (const key of ["ideaId", "taskId", "runId", "question", "outputDir", "branch", "ref"]) nonEmpty(request[key], key);
	if (!request.outputDir.startsWith("/")) throw new TypeError("outputDir must be absolute");
	if (request.mode !== "fixture") throw new TypeError("mode must be fixture");
	const model = request.catalogModel;
	if (!model || typeof model !== "object" || Array.isArray(model)) throw new TypeError("catalogModel must be an object");
	for (const key of Object.keys(model)) if (!MODEL_FIELDS.has(key)) throw new TypeError(`unknown catalogModel field: ${key}`);
	for (const key of ["id", "provider", "api"]) nonEmpty(model[key], `catalogModel.${key}`);
	if (!Number.isInteger(model.maxTokens) || model.maxTokens < 1) throw new TypeError("catalogModel.maxTokens must be a positive integer");
	if (!model.cost || typeof model.cost !== "object") throw new TypeError("catalogModel.cost must be an object");
	return request;
}

function fixtureStream(model) {
	const stream = new AssistantMessageEventStream();
	const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
		content: [{ type: "text", text: "PI_HARNESS_FIXTURE_OK" }],
		usage: { input: 5, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 7,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 0 };
	queueMicrotask(() => {
		stream.push({ type: "start", partial: message });
		stream.push({ type: "text_start", contentIndex: 0, partial: message });
		stream.push({ type: "text_delta", contentIndex: 0, delta: "PI_HARNESS_FIXTURE_OK", partial: message });
		stream.push({ type: "text_end", contentIndex: 0, content: "PI_HARNESS_FIXTURE_OK", partial: message });
		stream.push({ type: "done", reason: "stop", message });
	});
	return stream;
}

export async function runEntryRequest(request) {
	validateEntryRequest(request);
	return runPiHarnessTask({ ...request, streamFn: async model => fixtureStream(model) });
}

async function main() {
	const inputIndex = process.argv.indexOf("--input");
	let raw;
	if (inputIndex >= 0) raw = await readFile(process.argv[inputIndex + 1], "utf8");
	else {
		const chunks = [];
		for await (const chunk of process.stdin) chunks.push(chunk);
		raw = Buffer.concat(chunks).toString("utf8");
	}
	const result = await runEntryRequest(JSON.parse(raw));
	process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch(error => { process.stderr.write(`${error.name}: ${error.message}\n`); process.exitCode = 2; });
}
