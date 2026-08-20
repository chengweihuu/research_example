import { projectCanary } from "./canary-runner.mjs";

/** Execute one injected async transport, then project its sanitized outcome canonically. */
export async function executeCanary({ transport, session, ...input }) {
	if (typeof transport !== "function") throw new TypeError("transport must be an async function");
	if (!session || !Array.isArray(session.eventTypes) || session.eventTypes.some(type => typeof type !== "string")) throw new TypeError("session must contain event type strings only");
	let calls = 0;
	const invoke = async () => {
		if (calls >= 1) throw new Error("Executor call cap exceeded");
		calls += 1;
		const result = await transport();
		if (!result || !Array.isArray(result.sseEvents) || !Array.isArray(result.stages) || (result.assistant && typeof result.assistant !== "object")) throw new TypeError("transport returned malformed sanitized result");
		return result;
	};
	const result = await invoke();
	const projection = projectCanary({ ...input, stages: result.stages, sseEvents: result.sseEvents, assistant: result.assistant, invoke: () => undefined });
	return Object.freeze({ ...projection, executorCalls: calls, session: Object.freeze({ sessionId: session.sessionId, eventTypes: Object.freeze([...session.eventTypes]) }) });
}
