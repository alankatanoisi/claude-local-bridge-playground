# Observability contract (playground runner)

Last updated: 2026-05-24  
Canonical code: [`src/runner/kernel/contract.js`](../../src/runner/kernel/contract.js)

Machine-readable surfaces: `--output-format json`, `--output-format stream-json`, session ledger, transcript JSONL, human log, loop autopsy.

## Stop reasons (`STOP_REASONS`)

| Value                                | When emitted                     | Human-visible | Evidence                 |
| ------------------------------------ | -------------------------------- | ------------- | ------------------------ |
| `success`                            | Normal completion                | yes           | `run.js` session_end     |
| `max_steps`                          | `--max-steps` exhausted          | yes           | `run.js`                 |
| `max_tool_calls_per_turn`            | Tool burst guard                 | yes           | `run.js`                 |
| `context_budget_exceeded`            | Token budget hit                 | yes           | `run.js`, context-budget |
| `bridge_error`                       | Model/bridge failure             | yes           | `run.js`                 |
| `cwd_invalid`                        | Bad `--cwd`                      | yes           | bootstrap / kernel       |
| `resume_failed`                      | Resume could not rebuild state   | yes           | `run.js`                 |
| `user_denied`                        | Permission confirmation rejected | yes           | permissions flow         |
| `tool_failure_escalation`            | Repeated tool errors             | yes           | `run.js`                 |
| `cancelled`                          | User/system cancel               | yes           | kernel                   |
| `workspace_not_trusted`              | Trust gate                       | yes           | `workspace-trust.js`     |
| `semantic_cycle_detected`            | Loop detector                    | yes           | `run.js`                 |
| `wall_clock_budget_exceeded`         | Time budget                      | yes           | `run.js`                 |
| `cost_budget_exceeded`               | Cost budget                      | yes           | `run.js`                 |
| `predictive_context_budget_exceeded` | Predictive guard                 | yes           | context-budget           |
| `retry_budget_exceeded`              | Retry cap                        | yes           | model client path        |

Legacy text in `finalText` is mapped to these via `normalizeKernelResult()`.

## Stream / kernel event types (`KERNEL_EVENT_TYPES`)

Validated in [`event-bus.js`](../../src/runner/event-bus.js) against this list.

| type                | Purpose                    | Typical payload keys       | Redaction            |
| ------------------- | -------------------------- | -------------------------- | -------------------- |
| `system`            | Bootstrap / config         | runId, cwd, model          | no secrets           |
| `model_request`     | Outbound API call metadata | step, token estimates      | no body paste        |
| `assistant`         | Model text / thinking      | content blocks             | scrubbed             |
| `tool_use`          | Tool invocation            | name, id, input            | scrubbed args        |
| `tool_result`       | Tool output                | tool_use_id, content       | **secrets scrubbed** |
| `approval_required` | Permission ask             | tool, reason               | scrubbed             |
| `error`             | Recoverable / fatal error  | message, stopReason        | scrubbed             |
| `result`            | Final run summary          | stopReason, usage, steps   | scrubbed             |
| `compaction`        | Context compaction         | generation, dropped counts | metadata only        |

## Usage block (`KernelUsage`)

| Field                         | Source          | Notes                |
| ----------------------------- | --------------- | -------------------- |
| `input_tokens`                | Anthropic usage | per turn + run total |
| `output_tokens`               | Anthropic usage |                      |
| `cache_read_input_tokens`     | Anthropic usage | live OAuth only      |
| `cache_creation_input_tokens` | Anthropic usage | live OAuth only      |

## Artifacts

| Artifact         | Module                  | Contents                                       |
| ---------------- | ----------------------- | ---------------------------------------------- |
| Transcript JSONL | `transcript.js`         | user/model/tool events                         |
| Human log        | `human-log.js`          | plain-text timeline                            |
| Session ledger   | `session-ledger.js`     | append-only canonical entries + `.cursor.json` |
| Session store    | `session-store.js`      | runner state blob (debounced save)             |
| Loop autopsy     | `loop-autopsy.js`       | post-run diagnostic summary                    |
| Trace            | optional `--trace-path` | flight-recorder detail                         |

## Example stream-json lines (synthetic)

```json
{"type":"system","runId":"run-abc","cwd":"/tmp/project"}
{"type":"tool_use","name":"read_file","input":{"path":"README.md"}}
{"type":"tool_result","content":"# Project\n..."}
{"type":"result","stopReason":"success","usage":{"input_tokens":1200,"output_tokens":80}}
```

## Gaps vs Claude Code

| CC feature                  | Playground                              |
| --------------------------- | --------------------------------------- |
| OpenTelemetry export        | not wired                               |
| Richer stream-json taxonomy | partial — 9 kernel types vs CC superset |
| Cost dashboard              | human log + usage fields only           |

## Evidence tests

- `test/runner/harness-architecture.test.js`
- `test/runner/session-ledger.test.js`
- `test/runner/loop-autopsy.test.js`
- `test/runner/hook-ledger-ordering.test.js`

## Related

- [claude-parity-matrix.md](../parity/claude-parity-matrix.md)
- [bench-parity-evidence.md](../parity/bench-parity-evidence.md)
