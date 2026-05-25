# Bench parity evidence

Last updated: 2026-05-24  
Harness: stub (offline) baseline on playground `main`

## Commands

### Stub (CI-safe, no network)

```bash
cd "/Users/alanman/Developer/claude-local-bridge-playground"

node --require ./test/setup.js test/runner/bench/turn-latency.bench.js \
  --runs 50 --steps 8 --json
```

### Live (Alan-only, costs money)

```bash
BRIDGE_BENCH_LIVE_MAX_USD=0.50 node --require ./test/setup.js \
  test/runner/bench/turn-latency.bench.js \
  --live --model claude-sonnet-4-6 --runs 12
```

Requires bridge up, OAuth path, TTL alignment (see [oauth-headless-demo-runbook.md](./oauth-headless-demo-runbook.md)).

---

## Stub baseline — 2026-05-24 (`main`)

Command: `--runs 50 --steps 8 --json`

```json
{
  "runs": 50,
  "steps_cap_per_run": 8,
  "total_requests": 100,
  "run_wall_ms": {
    "mean": 40.96,
    "p50": 28,
    "p95": 94,
    "p99": 105
  },
  "req_overhead_ms": {
    "samples": 50,
    "mean": 0.36,
    "p50": 0,
    "p95": 2,
    "p99": 6
  },
  "cache_control": {
    "total_system_breakpoints": 200,
    "total_tool_breakpoints": 100,
    "total_message_breakpoints": 50,
    "mean_breakpoints_per_request": 3.5
  }
}
```

### Interpretation

| Metric                                       | Value | Target / note                                                      |
| -------------------------------------------- | ----- | ------------------------------------------------------------------ |
| `req_overhead_ms.p95`                        | 2 ms  | Request assembly hot path (C1–C3, A2–A3)                           |
| `cache_control.mean_breakpoints_per_request` | 3.5   | Target 3.5–4 after A1/E1; live OAuth may add bridge system markers |
| `run_wall_ms.p95`                            | 94 ms | Includes stub tool execution in temp cwd                           |

---

## Before / after table (fill on future perf commits)

| Metric                                       | Before (2026-05-24) | After               | Date       | Notes                    |
| -------------------------------------------- | ------------------- | ------------------- | ---------- | ------------------------ |
| `req_overhead_ms.p95`                        | 2                   | TBD                 |            |                          |
| `req_overhead_ms.mean`                       | 0.36                | TBD                 |            |                          |
| `cache_control.mean_breakpoints_per_request` | 3.5                 | TBD                 |            |                          |
| `cache_read_input_tokens_ratio` (live)       | TBD                 | 8673 cache hit/turn | 2026-05-24 | read-only smoke, 2 turns |
| Ledger sync writes per turn                  | coalesced (C2)      | TBD                 |            | See session-ledger tests |

---

## Roadmap reconciliation

Playground `main` **supersedes** `claude/magical-edison-7Qou6`. See [PERF_ROADMAP_RECONCILIATION.md](../PERF_ROADMAP_RECONCILIATION.md).

## Related

- [PERF_CONTINUATION.md](../PERF_CONTINUATION.md)
- [oauth-headless-demo-runbook.md](./oauth-headless-demo-runbook.md)
