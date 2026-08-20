export const DIAGNOSTIC_PHASES = Object.freeze(["model_resolution", "request_construction", "transport_open", "streaming", "response_parsing", "settled"]);

const EVENTS = Object.freeze({
	model_missing: ["model_resolution", "model_unavailable", true],
	request_rejected: ["request_construction", "request_rejected", true],
	transport_opened: ["transport_open", "opened", false],
	stream_interrupted: ["streaming", "interrupted", true],
	response_invalid: ["response_parsing", "invalid_response", true],
	response_settled: ["settled", "completed", true],
});

/** Accept one normalized lifecycle event and retain no provider error material. */
export function classifyTransportObservation(observation) {
	if (!observation || Object.getPrototypeOf(observation) !== Object.prototype || Object.keys(observation).length !== 1 || typeof observation.event !== "string") {
		throw new TypeError("Diagnostic observation must contain only an allowlisted event");
	}
	const mapped = EVENTS[observation.event];
	if (!mapped) throw new Error("Diagnostic event is not allowlisted");
	return Object.freeze({ phase: mapped[0], reasonCode: mapped[1], terminal: mapped[2] });
}
