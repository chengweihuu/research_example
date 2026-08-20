const BOUNDARIES = ["before_request", "after_request", "after_settlement"];
const PI_EVENTS = new Set(["agent_start", "stream_start", "assistant_message", "stream_end", "agent_end"]);

/** Create a payload-free receipt from fixed boundaries and allowlisted Pi event names. */
export function observePiEventStages(stages) {
	if (!Array.isArray(stages) || stages.some(stage => typeof stage !== "string")) throw new TypeError("Stages must be event-name strings only");
	const boundaries = stages.filter(stage => BOUNDARIES.includes(stage));
	if (boundaries.length !== 3 || boundaries.some((stage, index) => stage !== BOUNDARIES[index])) throw new Error("Lifecycle boundaries must appear exactly once in order");
	let boundaryIndex = 0;
	for (const stage of stages) {
		if (stage === BOUNDARIES[boundaryIndex]) { boundaryIndex += 1; continue; }
		if (!PI_EVENTS.has(stage)) throw new Error("Pi event type is not allowlisted");
		if (boundaryIndex === 0 || boundaryIndex === 3) throw new Error("Pi event is outside request boundaries");
	}
	return Object.freeze({ kind: "pi-event-stage-receipt", stages: Object.freeze([...stages]) });
}
