import { sha256, stableJson } from "./execution-packet.mjs";

export class HashLedger {
	#runId;
	#events = [];

	constructor(runId) {
		this.#runId = runId;
	}

	append(type, data = {}) {
		const sequence = this.#events.length + 1;
		const previousHash = this.#events.at(-1)?.eventHash ?? null;
		const event = {
			eventId: `${this.#runId}:${sequence}`,
			runId: this.#runId,
			sequence,
			type,
			previousHash,
			data,
		};
		const eventHash = sha256(event);
		const complete = Object.freeze({ ...event, eventHash });
		this.#events.push(complete);
		return complete;
	}

	events() {
		return [...this.#events];
	}

	toJsonl() {
		return `${this.#events.map((event) => stableJson(event)).join("\n")}\n`;
	}
}

export function verifyLedger(events, runId) {
	let previousHash = null;
	for (let index = 0; index < events.length; index += 1) {
		const event = events[index];
		const { eventHash, ...unsigned } = event;
		if (event.runId !== runId || event.sequence !== index + 1 || event.previousHash !== previousHash || sha256(unsigned) !== eventHash) {
			return { valid: false, failedSequence: index + 1 };
		}
		previousHash = eventHash;
	}
	return { valid: events.length > 0, terminalHash: previousHash, eventCount: events.length };
}
