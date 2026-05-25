# Claude parity matrix (playground)

Last updated: 2026-05-24  
Sources: [HARNESS_VISION.md](../HARNESS_VISION.md) §B, [anthropic-official-posture.md](./anthropic-official-posture.md), [PERF_ROADMAP_RECONCILIATION.md](../PERF_ROADMAP_RECONCILIATION.md)

Legend:

- **Status:** `wired` | `partial` | `lab-only` | `missing`
- **Decision:** `adopt` | `skip` | `later`

| Capability                         | CC / SDK reference         | Playground status | Decision | Evidence                                                                | Policy note                |
| ---------------------------------- | -------------------------- | ----------------- | -------- | ----------------------------------------------------------------------- | -------------------------- |
| Core agent loop                    | prompt → tools → repeat    | wired             | adopt    | `src/runner/run.js`                                                     | n/a                        |
| OAuth via bridge (no API key)      | Claude Code OAuth          | lab-only          | later    | `lab-notes/OAUTH_ONLY_DIRECTION.md`                                     | unclear vs Agent SDK path  |
| Prompt caching (`cache_control`)   | Anthropic API feature      | wired             | adopt    | `run.js` `applyCacheControlBudget`, `test/runner/cache-control.test.js` | TTL aligned 1h with bridge |
| Repo context cache breakpoint (E1) | CC stable prefix           | wired             | adopt    | `run.js`, `test/runner/cache-control.test.js`                           | n/a                        |
| Compaction ladder                  | CC multi-stage             | partial           | later    | `context-compactor.js`, Ext-12 tests                                    | n/a                        |
| Token estimate memo (A2)           | —                          | wired             | adopt    | `context-compactor.js`, `context-compactor-memo.test.js`                | n/a                        |
| Static system cache (A3)           | —                          | wired             | adopt    | `context-budget.js`, `context-budget.test.js`                           | n/a                        |
| Session store debounce (C1)        | —                          | wired             | adopt    | `session-store.js`, `session-store-debounce.test.js`                    | n/a                        |
| Ledger cursor resume (C2)          | —                          | wired             | adopt    | `session-ledger.js`, `session-ledger-cursor.test.js`                    | n/a                        |
| Incremental transcript load (C3)   | —                          | wired             | adopt    | `run.js` `loadMessagesFromTranscript`, `resume.test.js`                 | n/a                        |
| File read cache (B1)               | CC read cache              | wired             | adopt    | `tools/_file-cache.js`, `read-file.test.js`                             | n/a                        |
| Persistent bash (B2)               | CC shell state             | partial           | adopt    | `persistent-shell.js`, env `BRIDGE_RUNNER_PERSISTENT_SHELL=1`           | opt-in; shell still gated  |
| Parallel disjoint writes (B3)      | CC parallel edits          | wired             | adopt    | `run.js`, `parallel-writes.test.js`                                     | requires `--accept-edits`  |
| Streaming large reads (B4)         | —                          | wired             | adopt    | `tool-registry.js`, `streaming-tool-result.test.js`                     | n/a                        |
| realpath cache (D2)                | —                          | wired             | adopt    | `safety.js`, `realpath-cache.test.js`                                   | n/a                        |
| Permission decision cache (Ext-8)  | —                          | wired             | adopt    | `permissions.js`, `permission-decision-cache.test.js`                   | never caches `ask`         |
| Turn-latency bench (D3)            | —                          | wired             | adopt    | `test/runner/bench/turn-latency.bench.js`                               | stub + `--live`            |
| Parallel coordinator phases (D1)   | CC subagent fanout         | partial           | later    | `coordinator.js` `runPhasePlan`, `coordinator-parallel.test.js`         | CLI path mostly serial     |
| Speculative prefetch (Ext-6)       | —                          | missing           | later    | `tool-prefetch.js` (infra)                                              | not wired in `run.js`      |
| Instruction delta (Ext-11)         | CLAUDE.md watch            | missing           | later    | `instruction-delta.js` (infra)                                          | not wired                  |
| Test watcher (Ext-13)              | —                          | missing           | later    | `test-watcher.js` (infra)                                               | not wired                  |
| Streaming write input (Ext-9)      | —                          | missing           | later    | `streaming-write.js` (infra)                                            | not wired                  |
| Permission modes (named)           | default/plan/bypass        | partial           | adopt    | `permission-modes.md`, `permissions.js`                                 | no `auto`/YOLO             |
| Structured stream-json             | CC rich events             | partial           | later    | `kernel/contract.js` `KERNEL_EVENT_TYPES`                               | see observability contract |
| Session fork / stable ID           | CC `/resume`               | partial           | later    | `session-store.js`, ledger                                              | transcript ≠ canonical     |
| Subagents / delegation             | Explore/Plan/background    | partial           | later    | `coordinator.js`, agent profiles                                        | coordinator experimental   |
| Skills lazy load                   | CC skills                  | missing           | skip     | —                                                                       | manual AGENTS.md only      |
| Hooks lifecycle                    | CC hooks                   | partial           | later    | `hooks/hook-dispatcher.js`                                              | not CC-equivalent surface  |
| Memory layers                      | CLAUDE.md + auto memory    | partial           | later    | `memory/*` modules                                                      | not fully wired            |
| Tool schema validation             | strict envelope            | partial           | adopt    | `tool-envelope.js`, tests                                               | n/a                        |
| Loop health stops                  | max steps, cycles, budgets | wired             | adopt    | `run.js`, `kernel/contract.js` `STOP_REASONS`                           | n/a                        |
| Bridge transport boundary          | model-client only          | wired             | adopt    | `model-client.js`                                                       | OAuth-only on main         |

## Next matrix revisions

1. After live OAuth demo — add row "live end-to-end policy run" with artifact links.
2. After Ext-6/11/13 wiring — bump infra rows to `wired`.
3. After D1 coordinator default path parallelizes — bump subagents row.

## Related

- [permission-modes.md](./permission-modes.md)
- [structured-output.md](./structured-output.md)
- [observability-contract.md](../observability/observability-contract.md)
