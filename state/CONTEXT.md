# Context Contract

## Durable state

Keep only: task/claim/protocol IDs, current decision, constraints, file pointers, artifact hashes,
and short accepted findings. `CURRENT.md`, `TASK.md`, Ideas, Protocols and Experiments are not raw logs.

## Progressive retrieval

1. Load root rules, `state/AGENTS.md`, `TASK.md`, and `CURRENT.md`.
2. Load only the referenced object headings and exact files needed for the current decision.
3. Read raw logs, tool output, or large data only through an explicit artifact pointer.
4. After compaction, restore from this contract plus the current task packet, not from the entire history.

## Delegation Packet (input)

```yaml
task_id: H-NNN
objective: one bounded question
inputs: [exact file or artifact pointers]
allowed_tools: [read-only tools or named commands]
acceptance: observable output fields
budget: {tokens: N, minutes: N}
```

## Result Packet (output)

```yaml
status: complete | blocked | inconclusive
answer: <= 500 tokens, synthesized
evidence: [{pointer: path, locator: string, sha256: string}]
uncertainties: [short items]
next_action: one action or ask
```

The supervisor receives only the Result Packet. Raw tool output remains in the task output directory and
is never copied into durable state by default.
