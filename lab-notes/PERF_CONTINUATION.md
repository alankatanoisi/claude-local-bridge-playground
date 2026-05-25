# Perf continuation — PR #1 (playground)

**Audience:** Alan and agents working in the playground repo.  
**PR:** [claude-local-bridge-playground #1](https://github.com/alankatanoisi/claude-local-bridge-playground/pull/1)  
**Branch:** `claude/plan-migration-new-repo-ErpEc`  
**Prior work:** [PERF_PARITY_HANDOFF.md](./PERF_PARITY_HANDOFF.md) (first perf pack on canonical PR #17)

---

## What “infrastructure only” means

Some commits ship **modules + tests** but are **not called from** [`src/runner/run.js`](../src/runner/run.js) yet. The code exists; the main loop does not invoke it. Setting related env vars today usually has **no effect** on normal runs until a follow-up wires them in.

| Item                        | Module                            | Wired in run loop?                                      |
| --------------------------- | --------------------------------- | ------------------------------------------------------- |
| Ext-6 speculative prefetch  | `src/runner/tool-prefetch.js`     | **No** — needs post-read hook in `run.js`               |
| Ext-9 streaming write input | `src/runner/streaming-write.js`   | **No** — needs model-client delta chunks                |
| Ext-11 instruction delta    | `src/runner/instruction-delta.js` | **No** — needs per-turn delta injection                 |
| Ext-13 test watcher         | `src/runner/test-watcher.js`      | **No** — needs post-write-batch hook                    |
| Ext-7 subprocess pool       | `src/runner/subprocess-pool.js`   | **No** — bash still uses `persistent-shell.js` directly |

---

## Active in normal runs (no extra wiring)

These run automatically when you use `bin/local-bridge-runner.js` on this branch:

| ID     | Behavior                                                                                                   |
| ------ | ---------------------------------------------------------------------------------------------------------- |
| C1     | Debounced `SessionStore.save()` (`BRIDGE_RUNNER_SESSION_DEBOUNCE_MS`, default 75; `0` = sync every touch)  |
| A2     | WeakMap memo for per-block token estimates in compaction                                                   |
| A3     | Split static vs dynamic system-prompt cache (static survives compaction bumps)                             |
| E1     | Fourth Anthropic prompt-cache breakpoint (repo context: CLAUDE.md, git HEAD, fingerprint, repo map)        |
| D2     | Per-session realpath cache                                                                                 |
| Ext-8  | Full permission-decision cache (`ask` never cached)                                                        |
| C2/C3  | Ledger cursor sidecar; bounded transcript resume helper                                                    |
| B3     | Parallel write tools on disjoint paths when `--accept-edits`                                               |
| B4     | Streaming large `read_file` + sliding-window secret scrubber                                               |
| E4     | Tool-result auto-summarization after scrub (`BRIDGE_RUNNER_SUMMARIZE_THRESHOLD`, default 64000; `0` = off) |
| E3     | Search-result cache (invalidated on writes under root)                                                     |
| Ext-12 | Cost-aware compaction stage (drops stale reads superseded by writes)                                       |
| Ext-5  | Repository map in session-stable repo context                                                              |
| D1     | `phasePlan` schema + parallel phase executor in coordinator (coordinator run path still mostly serial)     |
| E2     | `--live` on turn-latency bench (opt-in; spends money)                                                      |

---

## Environment variables

| Variable                             | Default | Active?    | Meaning                                              |
| ------------------------------------ | ------- | ---------- | ---------------------------------------------------- |
| `BRIDGE_RUNNER_SESSION_DEBOUNCE_MS`  | `75`    | Yes        | Coalesce session file writes per turn                |
| `BRIDGE_RUNNER_SUMMARIZE_THRESHOLD`  | `64000` | Yes        | Summarize huge tool output after scrub; `0` disables |
| `BRIDGE_RUNNER_PERSISTENT_SHELL`     | off     | Yes if `1` | Reuse one bash process (prior perf pack)             |
| `BRIDGE_BENCH_LIVE_MAX_USD`          | `0.50`  | Bench only | Spend cap for `--live` bench                         |
| `BRIDGE_RUNNER_PREFETCH`             | off     | **Infra**  | Reserved                                             |
| `BRIDGE_RUNNER_TEST_WATCH`           | off     | **Infra**  | Reserved                                             |
| `BRIDGE_RUNNER_TEST_CMD`             | —       | **Infra**  | Override test command when watcher is wired          |
| `BRIDGE_RUNNER_TEST_WATCH_BUDGET_MS` | `30000` | **Infra**  | Timeout for future test watcher                      |

---

## Bench commands

```bash
cd "/Users/alanman/Developer/claude-local-bridge-playground"

# Stubbed (CI-safe)
node --require ./test/setup.js test/runner/bench/turn-latency.bench.js --runs 50 --steps 8 --json

# Live (costs real money — bridge must be up; do NOT run in CI)
BRIDGE_BENCH_LIVE_MAX_USD=0.50 node --require ./test/setup.js test/runner/bench/turn-latency.bench.js \
  --live --model claude-sonnet-4-6 --runs 12
```

---

## Safety envelope (unchanged)

- Shell hidden unless `--allow-shell`; B3 parallel writes only under `--accept-edits` with path-disjoint check.
- Denylist, path escape, secret scrubbing preserved; E4 runs **after** scrub.
- Bridge core (`src/credentials.js`, `src/proxy.js`, `src/server.js`, `src/interceptors/**`) not touched.

See [docs/threat-model.md](../docs/threat-model.md) for B3/B4/E4 notes.

---

## Follow-up wiring (not in PR #1 docs scope)

1. Wire Ext-6 prefetch after read tools in `run.js`.
2. Wire Ext-13 test watcher after write batches when `--allow-shell` + env set.
3. Wire Ext-11 instruction delta at session start + before each model call.
4. Expose model-client streaming deltas for Ext-9 write_file.
