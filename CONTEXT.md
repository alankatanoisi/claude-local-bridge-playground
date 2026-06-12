# Claude Local Bridge Runner

Domain language for the runner layer — the local coding-agent loop that is this playground's
active product surface. The bridge layer (OAuth, proxy, transport) is deliberately out of scope
here. Architecture reviews and design conversations should use these terms exactly.

## Language

### Core

**Runner**:
The local coding-agent loop: prompt → model → tool use → tool result → repeat, driven from
`bin/local-bridge-runner.js`.
_Avoid_: agent (alone), CLI, harness

**Bridge**:
The VS Code extension exposing Claude Code credentials as a local `/v1/messages` HTTP endpoint.
Transport only; not part of runner design discussions.
_Avoid_: proxy (as a layer name), server

**Agent loop**:
The per-turn cycle inside the runner: send messages, receive `tool_use` blocks, execute tools,
append results. Lives in `src/runner/run.js`.
_Avoid_: main loop, turn engine

**Tool use**:
One tool invocation requested by the model in a turn — `{ id, name, input }`.
_Avoid_: tool call (in interfaces; fine in prose), action

### Tool pipeline (decided 2026-06-12, not yet implemented)

**Tool pipeline**:
The deep module owning everything between "the model emitted `tool_use` blocks" and "completed,
recorded tool results exist": name resolution, permission check, confirmation, plan-mode
fabrication, execution, scrubbing, summarization, envelope, write-cache invalidation, and the
sink fan-out. Interface: `createToolPipeline(deps)` → `toolDefinitions()` +
`executeTurn(step, toolUses, { midTurnCheck })`.
_Avoid_: tool dispatcher, tool registry (that name stays for the internal tool table)

**Sink**:
A record-keeping destination the tool pipeline notifies: ledger, transcript, human log, trace,
archive, hooks, output events. Injected at construction as a named bag; each nullable. The
ledger sink is critical (its failure aborts); all other sinks are best-effort (failures are
reported, never alter results).
_Avoid_: logger, observer, listener

**Confirm port**:
The injected interface the pipeline uses to resolve an 'ask' permission decision:
`ask(proposedAction, timeoutMs) → 'allow' | 'deny'`. Adapters: TTY prompt (production),
scripted answers (tests), deny-all (coordinator workers).
_Avoid_: prompter, confirmer

**Mid-turn check**:
An optional callback `executeTurn` invokes once — after the read-only batch, before any write
executes — so the agent loop can stop the turn (semantic cycle, wall-clock or cost budget)
before side effects happen. Loop-level state stays in the loop; only the checkpoint moment is
exposed.
_Avoid_: hook (reserved for the user-facing hooks system)

**Failure streak**:
The count of consecutive failed tool executions, owned by the tool pipeline (it appends the
escalation text before sinks record the result). Seeded on session resume via
`initialFailureStreak`; the loop reads it back for persistence and the stop decision.
_Avoid_: failure counter, retry count

**Effect pairing**:
The crash-recovery invariant that every tool execution appends a ledger `tool_effect_intent`
(fresh effectId) before any side effect and exactly one matching `tool_effect_result` after —
including on throw, deny, plan-mode fabrication, and user denial.
_Avoid_: intent/result logging

### Safety

**Plan mode**:
Runner mode in which write tools never execute; the pipeline fabricates
`Plan mode: would <action>` results instead.
_Avoid_: dry run, read-only mode

**Hard deny**:
A permission decision that survives forced execution: path confinement, the deny matrix, and
shell hard-denies. Contrast with bypassable ask/deny decisions resolved by mode flags or
confirmation.
_Avoid_: block (alone), fatal deny

**Accept-edits**:
The `--accept-edits` flag: write tools skip confirmation, and disjoint-path write groups may
pre-execute in parallel while sinks still record events in model-emitted order.

### Session records

**Session ledger**:
Append-only JSONL event log per session with a cursor sidecar; source of effect pairing and
crash recovery.
_Avoid_: event log, audit log

**Transcript**:
Append-only JSONL of scrubbed run events for machine replay/inspection.
_Avoid_: log (alone)

**Human log**:
The markdown mirror of a run, written for a person to read.
_Avoid_: readable log, summary log

## Flagged ambiguities

- **"Tool registry"** previously meant both the tool table and the dispatch entry points
  (`execute`/`executeForce`/`executeReadOnlyBatch`). After the tool pipeline lands, _tool
  registry_ refers only to the internal tool table; dispatch belongs to the _tool pipeline_.
- **"Hook"** means the user-facing `.bridge-runner/` hooks system. The pipeline's injected
  callbacks are the _confirm port_ and the _mid-turn check_, never "hooks".

## Example dialogue

> **Dev:** When a write tool fails three times, who notices?
> **Domain expert:** The tool pipeline owns the failure streak — it appends the escalation text
> to the result before any sink records it, so the transcript, human log, and ledger all agree.
> The agent loop reads the streak back and decides whether to stop the run.
>
> **Dev:** And if the cost budget blows mid-turn?
> **Domain expert:** The loop's mid-turn check fires after the read-only batch, before any write
> executes. The pipeline aborts the turn; effect pairing still holds because no intent was
> appended for the writes that never started.
>
> **Dev:** Can a coordinator worker prompt the user to confirm a write?
> **Domain expert:** No — workers construct the pipeline with the deny-all confirm port adapter.
> Only the interactive runner uses the TTY adapter.
