export const SSE_FIXTURES = Object.freeze({
	completed: Object.freeze(["opened", "text_delta", "usage_complete", "done"]),
	interruptedAfterOpen: Object.freeze(["opened", "interrupted"]),
	interruptedAfterText: Object.freeze(["opened", "text_delta", "interrupted"]),
	malformed: Object.freeze(["opened", "malformed"]),
	missingUsage: Object.freeze(["opened", "text_delta", "done"]),
	duplicateOpen: Object.freeze(["opened", "opened"]),
	unstarted: Object.freeze([]),
});
