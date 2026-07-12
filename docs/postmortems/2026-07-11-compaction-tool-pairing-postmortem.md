# Post-mortem: compaction split an Anthropic tool-use/tool-result pair

**Local incident date:** 2026-07-11 (America/Los_Angeles)  
**Trace timestamps:** 2026-07-12 UTC  
**Run ID:** `9f395456-3acb-4a37-94ad-668b97f5de2b`  
**Owning runtime:** `claude-local-bridge-playground` runner  
**Target workspace:** `codex-local-bridge-playground`  
**Status:** root cause reproduced and confirmed; no fix applied in this investigation

## Executive verdict

The extreme run settings exposed a real architectural defect in the Claude runner's Anthropic-message compactor. They did not create an invalid condition that the runner was entitled to produce.

At step 52, the runner crossed the compactor's normal 80,000-token warning threshold. A small mid-session `CLAUDE.md` update had just inserted a standalone user instruction message. `summarizeOldTurns()` then kept the last 12 **raw messages** as if they were always six complete turns. That arbitrary cutoff retained a `tool_result` while summarizing away the immediately preceding assistant `tool_use`. Anthropic correctly rejected the malformed request with HTTP 400.

The same defect reproduces locally with a tiny synthetic history—no model, bridge, network, large prompt, or 52-turn run required. The max settings were therefore the **stress trigger and reachability condition**; the unsafe compaction boundary was the **root cause**.

### Severity and impact

| Dimension                | Assessment                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| Runner reliability       | **High** for long autonomous Claude runs that reach full summarization                        |
| Ordinary-run likelihood  | **Low to moderate** because the default 16-step ceiling often prevents reaching the threshold |
| Reproducibility          | **Deterministic** once the message alignment and summarize threshold are reproduced           |
| Worktree data loss       | **None observed**; all file edits survived and were later validated and committed             |
| Session-state corruption | **None observed**; the persisted 104-message session remains structurally valid               |
| Remote/API fault         | **No**; the upstream API rejected an invalid client request as designed                       |
| Model fault              | **No**; Fable 5 emitted valid tool calls and results before the runner compacted them         |

## What happened

```text
Long Fable 5 build run
        |
        | max_steps=1000 allowed 52 model turns
        v
Step 51 edits CLAUDE.md and other docs successfully
        |
        v
Step 52 detects CLAUDE.md small diff
and appends a standalone user instruction message
        |
        v
Estimated context reaches 81,944 tokens
(default compaction warning threshold: 80,000)
        |
        v
summarizeOldTurns keeps the last 12 raw messages
without finding a semantic/tool-pair boundary
        |
        v
First retained message is an old tool_result;
its assistant tool_use was summarized away
        |
        v
Anthropic returns HTTP 400
        |
        v
Runner retries the unchanged invalid request twice
and stops with bridge_error at step 54
```

## Confirmed timeline

| Time (UTC)  |  Step | Confirmed event                                                                                                                        |
| ----------- | ----: | -------------------------------------------------------------------------------------------------------------------------------------- |
| 00:07:22    | Start | Full tracing enabled; model `claude-fable-5`; `max_steps=1000`; request `max_tokens=128000`; shell/edit/no-prompt stress flags enabled |
| 00:14:04    |    13 | First `clip` compaction event at an estimated 42,373 tokens                                                                            |
| 00:14–00:41 | 13–51 | 39 `clip`-only records accumulate; no malformed outbound pair is detected through turn 51                                              |
| 00:41:31    |    51 | Final three file edits succeed, including `CLAUDE.md`                                                                                  |
| 00:42:02    |    52 | `instruction_delta` records a small `CLAUDE.md` change before request construction                                                     |
| 00:42:02    |    52 | First full ladder: `clip`, `snip`, `cost`, `ghost`, `summarize`; estimate 81,944 tokens                                                |
| 00:42:02    |    52 | Outbound history drops from 104 pre-compaction messages to 13 request messages                                                         |
| 00:42:09    |    52 | HTTP 400: orphaned `tool_result` id `toolu_01Xfnsz3ELyBXiFJus8DavAp`                                                                   |
| 00:42:13    |    53 | Same invalid 13-message history retried; same HTTP 400                                                                                 |
| 00:42:15    |    54 | Third attempt receives same HTTP 400; run ends `bridge_error`                                                                          |

The orphaned result belonged to a valid step-46 `read_file` call against `docs/codex-bridge-runner-roadmap.html`. It was correctly paired before summarization.

## Root cause

### Primary defect: raw-message slicing is not turn-aware

In `src/runner/context-compactor.js`, `summarizeOldTurns()` calculates:

```js
const cutoff = Math.max(0, messages.length - preserveRecent * 2);
const head = messages.slice(0, cutoff);
const tail = messages.slice(cutoff);
```

The comment describes `preserveRecentTurns`, but the implementation assumes every logical turn is exactly two raw messages. That assumption is false. The runner can append standalone user messages for instruction updates, and other future features can also produce non-alternating message sequences.

The function creates one synthetic user summary and prepends it to the arbitrary tail. If the tail starts with a user `tool_result`, the matching assistant `tool_use` is gone. Anthropic requires each `tool_result` to follow the assistant message containing its corresponding `tool_use`.

### Immediate trigger: instruction delta changed the alignment

`src/runner/run.js` checks for `CLAUDE.md` changes before compaction. A small change is appended as a standalone user message:

```js
messages.push({ role: 'user', content: instructionChange.deltaBlock });
```

Step 51 edited `CLAUDE.md`; step 52 inserted this message. That shifted the raw-message cutoff onto the step-46 tool result.

The instruction-delta feature behaved according to its own design. The defect is that the compactor treated an arbitrary message count as a semantic boundary.

### Missing invariant check

No pre-request validator verifies the Anthropic tool-pair rule after compaction and before sending the request. A local check could have caught the malformed history immediately, produced a precise internal error, and avoided three upstream requests.

## Reproduction and hypothesis results

The investigation used two feedback loops:

1. A shape-only validator over every captured `bridge_request_received` payload.
2. A tiny local harness calling the real `summarizeOldTurns()` and `applyCompactionLadder()` functions.

### Trace replay result

| Turns | Pairing result                                                                            |
| ----- | ----------------------------------------------------------------------------------------- |
| 1–51  | Valid: every `tool_result` had its matching `tool_use` in the preceding assistant message |
| 52–54 | Invalid: message index 1 contained the same orphaned step-46 result                       |

The malformed structure already existed in the bridge's request-received capture, before bridge transformation. This rules out the bridge as the mutating cause.

### Minimal harness result

| Synthetic history                                                | Forced summarization                                |
| ---------------------------------------------------------------- | --------------------------------------------------- |
| Normal alternating assistant tool call → user result pairs       | Valid in the selected alignment                     |
| Same history plus one standalone user instruction-update message | Deterministically orphaned a retained `tool_result` |

No network or model was involved. This confirms the root cause in the runner compactor.

### Ranked hypotheses: final disposition

| Hypothesis                                  | Result                             | Evidence                                                                                                            |
| ------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Arbitrary compaction cutoff split a pair    | **Confirmed**                      | Trace transition at turn 52 plus minimal local reproduction                                                         |
| Instruction delta shifted the cutoff        | **Confirmed contributing trigger** | `instruction_delta` occurs immediately before the first invalid request; synthetic extra user message reproduces it |
| Max settings caused malformed API semantics | **Rejected as root cause**         | Tiny forced-threshold harness reproduces the same defect; settings only made the path reachable                     |
| Bridge transformation corrupted the request | **Rejected**                       | `bridge_request_received` is already malformed                                                                      |
| Retry logic created the first defect        | **Rejected**                       | Turn 52 is invalid before retries; retries only repeat it                                                           |

## What the max settings did—and did not do

### `--max-steps 1000`

This was the strongest stress enabler. The default is 16 steps; the incident did not reach full summarization until step 52. A normal default run would have stopped much earlier, hiding the bug.

### `--max-tokens 128000`

This is a per-request output ceiling, not the compactor threshold. It gave the model generous response headroom, but the run used approximately 42,947 output tokens in total. It was not itself an invalid setting.

### `--max-context-tokens`

The captured run artifacts do not prove whether this flag was explicitly set. More importantly, current code does **not** feed this value into `applyCompactionLadder()`. It supplies advisory and cumulative-usage stop behavior elsewhere in `run.js`; the compactor continues to use its separate 80,000/160,000 policy unless a task-scope or compact-each-turn preset overrides it.

This separation is not obvious from the command-builder wording and should be clarified independently.

### Verdict on the stress test

The stress settings were useful and legitimate for testing limits. They revealed a correctness invariant that ordinary settings mostly conceal. The right response is to harden the runner, not to classify the run as user misconfiguration.

## Existing test gap

`test/runner/reactive-compaction.test.js` contains a test named:

> `summarizeOldTurns preserves recent turns and pairs`

Its fixture already produces an orphaned older result after summarization. The test still passes because it only asserts that the newest result remains somewhere in the tail; it never checks adjacency or id equality for every retained result.

This is a false-green test: its name claims an invariant that its assertions do not establish.

## Secondary findings

### 1. `clip` is not idempotent

`clipToolResults()` takes the first 12,000 characters and then appends a footer, leaving the new result longer than 12,000 characters. Every later compaction pass clips it again and reports another change.

That explains the 39 `clip`-only records from steps 13–51. They were not 39 deep summarizations. This creates event noise, repeated work, and confusing compaction telemetry.

### 2. Deterministic HTTP 400 responses are retried unchanged

`run.js` treats this invalid-request 400 like a generic bridge failure and retries until the consecutive failure limit is reached. Because no state changes between attempts, turns 53 and 54 were guaranteed to fail.

Client-shape errors should fail fast or invoke a local repair path. Retry/backoff is appropriate for transient failures, not a deterministic schema rejection.

### 3. The session store was not poisoned

The persisted state still contains 104 valid messages and no orphaned result. Compaction changed the in-memory request history, but the malformed 13-message history was not persisted before the request failed.

That preserved the work and forensic evidence. However, the session is correctly marked degraded, and overriding the resume warning may simply reproduce compaction. A fresh session is safer until the bug is fixed.

### 4. The bridge behaved correctly

The bridge forwarded an already-malformed native Anthropic Messages request. Upstream validation rejected it. The bridge should not weaken or repair this invariant silently.

## Repository and roadmap ownership

### Claude Local Bridge Playground

This repository owns the defect because the failing code path is its Anthropic-native runner:

- `src/runner/context-compactor.js`
- `src/runner/run.js`
- `src/runner/instruction-delta.js`
- `test/runner/reactive-compaction.test.js`

The primary fix and regression tests belong here. Bridge/auth/proxy internals are out of scope.

### Codex Local Bridge Playground

The Codex fork contains the inherited compactor file, but its native Responses history deliberately bypasses that Anthropic compactor. The current Codex run loop explicitly defers native compaction.

Therefore:

- Do **not** cherry-pick an Anthropic-message fix blindly into the active Codex path.
- Do carry over the behavioral invariant: a `function_call` and matching `function_call_output` must remain an atomic logical group.
- Codex compaction must also preserve opaque `reasoning` item order/adjacency as required by its native Responses history.
- Record any deliberately ported safety or harness fix in the Codex fork's `PORTING.md`.

### Codex roadmap implications

The current roadmap puts live compaction in Phase 4 and compaction goldens in Phase 5. This incident shows the order is backwards for a load-bearing history transform.

Recommended roadmap adjustment:

1. Keep Phase 3 Stage 7 focused on pricing, documentation alignment, and the first short live read-only run.
2. Before the Phase 4 live compaction rung, implement a native Responses compactor or explicitly keep that rung blocked.
3. Move the native compaction invariant tests ahead of the live compaction test:
   - function-call/output atomicity,
   - reasoning-item adjacency/order,
   - standalone instruction messages,
   - multiple tool calls in one model turn,
   - resume/replay input,
   - post-compaction request validation.
4. Keep Phase 5 for broader hardening and adversarial/fuzz coverage, not the first basic pairing test.

This is a behavioral convergence lesson, not a reason to share provider wire schemas. Claude and Codex should enforce the same logical guarantee using their own native history representations.

## Audience-specific guidance

### For Alan / operator

- Your max settings did not “break” a healthy runner; they surfaced a hidden correctness bug.
- Until fixed, avoid trusting a single very long Claude runner session to edit `CLAUDE.md` and then continue through full compaction.
- Prefer bounded phases with fresh sessions, plus wall-clock/cost budgets.
- Do not resume this degraded session with `--ack-resume-risk` for production work.

### For Claude-runner implementation agents

- Treat the tool call plus result as one atomic semantic group.
- Add a request-boundary invariant validator after compaction.
- Reproduce first with the existing test fixture and a standalone instruction message.
- Keep the fix in `claude-local-bridge-playground`; do not touch bridge credentials or proxy behavior.

### For Codex-roadmap agents

- Do not reactivate the inherited compactor for native Responses items.
- Use this incident as a required design input for the native compactor.
- Move pairing/reasoning invariant tests before live Phase 4 compaction.
- Preserve provider-native schemas while converging on behavior.

### For test and verification agents

- Validate every retained pair, not the presence of one recent result.
- Include odd/even message counts, standalone user messages, multi-tool batches, and repeated compaction.
- Test the full sequence `instruction delta → compaction → request validation`, not only each module separately.

### For bridge/transport agents

- No bridge change is indicated.
- Preserve the upstream 400 and trace correlation.
- Ensure redaction remains intact; do not log raw credentials while adding diagnostics.

## Recommended remediation sequence

### P0: immediate operating guardrail

Document that long Claude runs which mutate `CLAUDE.md` should start a fresh session before deep compaction. This reduces exposure but is not a fix.

### P1: Claude runner correctness fix

1. Replace raw `preserveRecent * 2` slicing with semantic boundary selection.
2. Never retain a `tool_result` unless its matching `tool_use` is retained immediately before it.
3. Add a local post-compaction validator before request construction.
4. Add an integration regression test for `instruction delta → summarize → request`.
5. Make deterministic invalid-request 400s non-retriable.

### P2: compaction quality fixes

1. Make `clipToolResults()` idempotent by keeping the footer inside the maximum length or recognizing an existing clip marker.
2. Improve compaction telemetry so “content clipped again” cannot masquerade as a new meaningful generation.
3. Clarify the difference between `--max-context-tokens` and compaction policy thresholds in the CLI/command builder.

### P3: Codex native-compaction gate

Design native item grouping and invariant tests before enabling compaction in Phase 4. Port concepts and tests deliberately; do not port Anthropic shapes.

## Candidate fix strategies and tradeoffs

| Strategy                                                 | Pros                                                                    | Cons                                                                         | Recommendation                               |
| -------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------- |
| Move cutoff backward when tail starts with `tool_result` | Small, easy to review                                                   | Handles the observed case but may miss more complex grouping/adjacency rules | Useful as part of a fix, insufficient alone  |
| Build semantic turn groups, then compact whole groups    | Correct abstraction; handles standalone messages and multi-tool batches | More code and requires explicit grouping rules                               | **Preferred core design**                    |
| Drop an orphan result after slicing                      | Produces valid syntax                                                   | Loses recent tool output and hides why; can degrade model behavior           | Avoid as primary repair                      |
| Pre-request validator only                               | Prevents invalid API calls and wasted retries                           | Detects but does not preserve progress                                       | Required defense-in-depth, not the whole fix |

## Definition of done for the Claude fix

- The exact existing test fixture fails before the fix with a full pairing validator.
- A standalone instruction-delta message cannot split any pair.
- Multiple tool calls and their result batch survive as a logical unit.
- The captured turn-52 shape passes the validator after repair/recompaction.
- The original synthetic reproduction no longer fails.
- `clip` reaches a stable no-change state on its second pass.
- Invalid-request 400s are not retried unchanged.
- Targeted runner tests and the full repository checks pass.
- The fix commit explains the root cause.
- If a related invariant is implemented in Codex, it is designed for native Responses items and logged in `PORTING.md`.

## Evidence inventory

Primary run artifacts:

- Runner transcript: `~/.bridge-runner/logs/2026-07-12T00-07-22-582Z.jsonl`
- Runner trace: `~/.bridge-runner/traces/2026-07-12T00-07-22-593Z-9f395456-3acb-4a37-94ad-668b97f5de2b.runner.jsonl`
- Bridge trace: `~/.claude-local-bridge/traces/9f395456-3acb-4a37-94ad-668b97f5de2b.bridge.jsonl`
- Session ledger: `~/.bridge-runner/sessions/codex-bridge-runner-roadmap-phase-3-stage-6-build-attempt-by-fable-5-run-1.ledger.jsonl`
- Session state: `~/.bridge-runner/sessions/codex-bridge-runner-roadmap-phase-3-stage-6-build-attempt-by-fable-5-run-1.state.json`
- Run archive: `~/.bridge-runner/archive/runs/9f395456-3acb-4a37-94ad-668b97f5de2b/`

Measured run outcome:

- Duration: 2,093,226 ms (about 34 minutes 53 seconds)
- Model steps attempted: 54
- Usage: 131,306 input; 42,947 output; 4,836,360 cache-read; 363,202 cache-creation tokens
- Estimated cost: $4.668243
- Terminal stop reason: `bridge_error`

## Limits of this post-mortem

- No implementation fix was applied or tested here.
- The investigation did not make a new live model call; it used captured traces and deterministic local function calls.
- The exact original CLI command is not stored as one reconstructable string in the examined artifacts. The trace confirms the material runtime values and flags listed above.
- Current OpenAI native compaction requirements must be validated against the Codex runtime's own item contract when that work begins; this report does not prescribe an Anthropic-shaped implementation for Codex.
