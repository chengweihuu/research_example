const KINDS = new Set(["opened", "text_delta", "usage_complete", "done", "malformed", "interrupted"]);

const result = outcome => Object.freeze({ outcome });

/** Classify sanitized event kinds only; payload-bearing frames are deliberately out of scope. */
export function classifySseBoundary(events) {
	if (!Array.isArray(events) || events.some(event => typeof event !== "string" || !KINDS.has(event))) {
		throw new TypeError("SSE boundary accepts only allowlisted event-kind strings");
	}
	if (events.length === 0 || events[0] !== "opened") return result("response_invalid");
	let usage = false;
	for (let index = 1; index < events.length; index += 1) {
		const event = events[index];
		if (event === "malformed" || event === "opened") return result("response_invalid");
		if (event === "interrupted") return index === events.length - 1 ? result("stream_interrupted") : result("response_invalid");
		if (event === "text_delta") continue;
		if (event === "usage_complete") {
			if (usage) return result("response_invalid");
			usage = true;
			continue;
		}
		if (event === "done") return usage && index === events.length - 1 ? result("response_settled") : result("response_invalid");
	}
	return result("response_invalid");
}
