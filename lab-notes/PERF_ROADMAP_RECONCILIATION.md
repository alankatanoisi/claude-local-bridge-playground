# Performance Parity Roadmap — reconciliation (playground main vs magical-edison)

**Checked:** 2026-05-24  
**Playground branch:** `main` @ `9f17068`  
**Codex perf branch:** `remotes/canonical-archive/claude/magical-edison-7Qou6` @ `4efbc2b`  
**Merge base:** `a71c4cf`

## Verdict

**Playground `main` supersedes `claude/magical-edison-7Qou6`.** Do not re-implement Tier 1 (C1–C3, A2–A3) on magical-edison and merge back — main already contains those commits plus a larger perf pack (Ext-5–14, E1–E4, D1, B3–B4). magical-edison has **zero runner commits** that are not already represented on main.

**Action for Claude Code:** treat magical-edison as **historical**; continue work on playground `main` only. Remaining gaps are **wiring + merge hygiene**, not Tier 1 re-landing.

---

## Roadmap item status (on playground `main`)

| ID         | Item                                                        | Status              | Evidence                                                                                                                      |
| ---------- | ----------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **A1**     | Prompt caching (`cache_control` on system/tools/transcript) | **landed**          | `src/runner/run.js` — `applyCacheControlBudget`; `test/runner/cache-control.test.js`                                          |
| **A2**     | Memoize per-block token estimates                           | **landed**          | `src/runner/context-compactor.js` — `_blockCharCache` WeakMap; `test/runner/context-compactor-memo.test.js`                   |
| **A3**     | Static system prompt cache survives compaction              | **landed**          | `src/runner/context-budget.js`, `context-builder.js`; `test/runner/context-budget.test.js`                                    |
| **B1**     | File-content cache (path + mtime)                           | **landed**          | `src/runner/tools/_file-cache.js`, `read-file.js`; `test/runner/read-file.test.js`                                            |
| **B2**     | Persistent bash session                                     | **landed** (opt-in) | `src/runner/tools/persistent-shell.js`, `bash.js`; `BRIDGE_RUNNER_PERSISTENT_SHELL=1`; `test/runner/persistent-shell.test.js` |
| **B3**     | Parallel disjoint write tools                               | **landed**          | `src/runner/run.js`; `test/runner/parallel-writes.test.js`                                                                    |
| **B4**     | Stream large tool outputs                                   | **landed**          | `src/runner/tool-registry.js`; `test/runner/streaming-tool-result.test.js`                                                    |
| **C1**     | Debounced session store                                     | **landed**          | `src/runner/session-store.js`; `BRIDGE_RUNNER_SESSION_DEBOUNCE_MS`; `test/runner/session-store-debounce.test.js`              |
| **C2**     | Ledger cursor sidecar + async append stream                 | **landed**          | `src/runner/session-ledger.js` — `.cursor.json`; `test/runner/session-ledger-cursor.test.js`                                  |
| **C3**     | Incremental transcript load on resume                       | **landed**          | `src/runner/run.js` — `loadMessagesFromTranscript(..., { ledgerCursor })`; `test/runner/resume.test.js`                       |
| **D1**     | Parallel coordinator phases                                 | **partial**         | `coordinator.js` — `runPhasePlan` batches; coordinator CLI path still mostly serial                                           |
| **D2**     | realpath cache in permissions                               | **landed**          | `src/runner/safety.js`, `permissions.js`; `test/runner/realpath-cache.test.js`                                                |
| **D3**     | Turn-latency bench                                          | **landed**          | `test/runner/bench/turn-latency.bench.js`; stub + `--live`                                                                    |
| **E1**     | Fourth cache breakpoint (repo context)                      | **landed**          | `applyCacheControlBudget(..., repoContextBlock)`                                                                              |
| **E3**     | Search-result cache                                         | **landed**          | `test/runner/search-cache.test.js`                                                                                            |
| **E4**     | Tool-result auto-summarization                              | **landed**          | `test/runner/tool-result-summarizers.test.js`                                                                                 |
| **Ext-5**  | Repository map                                              | **landed**          | `test/runner/repo-map.test.js`                                                                                                |
| **Ext-6**  | Speculative prefetch                                        | **infra only**      | `src/runner/tool-prefetch.js` — **not wired** in `run.js`                                                                     |
| **Ext-7**  | Subprocess pool                                             | **infra only**      | `src/runner/subprocess-pool.js`                                                                                               |
| **Ext-8**  | Permission decision cache                                   | **landed**          | `test/runner/permission-decision-cache.test.js`                                                                               |
| **Ext-9**  | Streaming write input                                       | **infra only**      | `src/runner/streaming-write.js` — **not wired**                                                                               |
| **Ext-11** | Instruction delta (CLAUDE.md)                               | **infra only**      | `src/runner/instruction-delta.js` — **not wired**                                                                             |
| **Ext-12** | Cost-aware compaction                                       | **landed**          | `test/runner/cost-aware-compaction.test.js`                                                                                   |
| **Ext-13** | Test watcher                                                | **infra only**      | `src/runner/test-watcher.js` — **not wired**                                                                                  |

See also [PERF_CONTINUATION.md](./PERF_CONTINUATION.md) for env vars and “infrastructure only” table.

---

## magical-edison-only commits (all superseded)

| Commit    | Summary                                | On main?       |
| --------- | -------------------------------------- | -------------- |
| `72891f1` | Cache tools + bench                    | Yes (superset) |
| `544c0c8` | File cache + persistent shell module   | Yes            |
| `02482e8` | Wire persistent shell + async registry | Yes            |
| `4efbc2b` | Debounce session + ledger cursor       | Yes            |

---

## Remaining work (main, not magical-edison)

1. **Wire infra modules** into `run.js`: Ext-6 prefetch, Ext-11 instruction delta, Ext-13 test watcher, Ext-9 streaming write.
2. **D1** — enable parallel phase execution on default coordinator path when spec declares independent phases.
3. **TTL alignment** — runner `cache_control` must use `ttl: '1h'` to match bridge OAuth system blocks (see [oauth-headless-demo-runbook.md](./parity/oauth-headless-demo-runbook.md)).
4. **Bench evidence** — archive stub JSON in [bench-parity-evidence.md](./parity/bench-parity-evidence.md); live after TTL fix.

---

## Stub bench baseline (2026-05-24)

Recorded on `main` with:

```bash
node --require ./test/setup.js test/runner/bench/turn-latency.bench.js --runs 50 --steps 8 --json
```

| Metric                                       | Value |
| -------------------------------------------- | ----- |
| `run_wall_ms.mean`                           | 40.96 |
| `run_wall_ms.p95`                            | 94    |
| `req_overhead_ms.mean`                       | 0.36  |
| `req_overhead_ms.p95`                        | 2     |
| `cache_control.mean_breakpoints_per_request` | 3.5   |

Full JSON archived in `lab-notes/parity/bench-parity-evidence.md`.
