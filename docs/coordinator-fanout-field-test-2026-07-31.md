# Coordinator Fan-out Field Test — 2026-07-31

| Field     | Value                                                                  |
| --------- | ---------------------------------------------------------------------- |
| Type      | Live field test (A3 step 2) — real bridge, real tokens                 |
| Workspace | `~/Developer/orchestration-prototypes/a3-fanout-live/`                 |
| Runs      | 3 coordinator runs (1 ceiling-misconfigured, 1 parallel, 1 sequential) |
| Twin      | `docs/coordinator-fanout-field-test-2026-07-31.html`                   |

First live exercise of the round-3 coordinator work: budget **leasing**
(`_spawnLeasedWorker`) and dependency-batched research **fan-out** (`--research-plan`),
both of which had only ever run under unit tests
(`test/runner/coordinator-lease.test.js`) before this.

## Setup

Four read-only research lanes over this repo (durability, budget, safety,
orchestration — one prompt each, naming the exact files to read), run twice with
identical prompts and budgets against the live bridge on `localhost:11437`
(model `claude-sonnet-5` via Claude Code OAuth):

- **Parallel plan:** all four nodes dependency-free → one batch of 4.
- **Sequential baseline:** same nodes with a `deps` chain → four batches of 1.

Phases `research,synthesize` only — `synthesize` is a local spec compile (no tokens)
and `execute` would edit the repo, which a field test should not. Ceilings:
`--budget-input-tokens 400000 --budget-output-tokens 20000`, leased across workers.

## Headline numbers

| Measure               | Parallel (batch [4]) | Sequential (batches [1,1,1,1]) |
| --------------------- | -------------------- | ------------------------------ |
| Wall clock            | **12.4 s**           | 51.2 s                         |
| Workers succeeded     | 4/4                  | 4/4                            |
| Summed worker time    | 48.5 s               | 51.2 s                         |
| Child input tokens    | 58,568               | **58,568 (identical)**         |
| Child output tokens   | 3,492                | 3,474                          |
| Active leases at exit | 0                    | 0                              |
| Incomplete children   | 0                    | 0                              |

**Speedup 4.13× at token parity.** The input-token counts are byte-identical across
arms because the read-only research paths are deterministic — fan-out buys wall
clock, not token savings. Per-worker wall time was ~12–14 s in both arms, so the
parallel arm ran at essentially the ideal 4-way overlap.

**Budget invariant held in the field:** every spawn got its own lease (8 distinct
lease ids across the two runs), each concurrent sibling received the unleased
remainder divided by its batch size (100k input / 5k output each in the parallel
run), every lease was released and reconciled, and `budget.used` matched summed
child usage exactly. This is the invariant `budget-broker.js` was written to hold,
now observed under real concurrency rather than mocked spawns.

## The failed first attempt is data too

The first parallel attempt ran with library defaults (`maxSteps: 6` per node, and
the worker-child hard default of 2,000 output tokens per request). **All four
workers hit a ceiling before producing a final answer** — three `max_steps`, one
`model_max_tokens` (truncated mid-summary) — burning 91,702 input / 6,765 output
tokens for zero usable summaries. That is _more_ than the successful run cost
(58,568), because workers that die at a ceiling have already spent their
exploration. Re-run with per-node `maxSteps: 10` and prompts that demand a ≤250-word
answer: 4/4 success.

Lesson: with fan-out, a ceiling misconfiguration multiplies by the number of nodes.
Size the ceilings before the fan-out, not after the first failure.

## Findings

| ID    | Finding (short)                                                                    | Status after evening follow-through          |
| ----- | ---------------------------------------------------------------------------------- | -------------------------------------------- |
| A3-F1 | Research-only runs exited 1 because CLI keyed on missing `kernelResult.stopReason` | **Closed** — `exitCodeForCoordinatorResult`  |
| A3-F2 | Workers pinned to 2,000 output tokens; `--max-tokens` / plan never reached inherit | **Closed** — inherit + plan-node `maxTokens` |
| A3-F3 | Default `maxSteps: 6` too small for broad research on this repo                    | Unchanged — per-node `maxSteps` is the knob  |
| A3-F4 | Broker meters uncached tokens only; cache_read diverges from metered cost          | Still open                                   |

## Provenance

Plans, raw result JSON (`result-parallel.json`, `result-parallel2.json`,
`result-sequential.json`), and `/usr/bin/time` logs live in the A3 workspace
(outside git). Coordinator sessions: `a3-fanout-live-20260731`,
`a3-fanout-live2-20260731`, `a3-seq-live-20260731` under `~/.bridge-runner/sessions/`.
The synthesized worker summaries fed `docs/ARCHITECTURE.md`, written the same day.
