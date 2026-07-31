# CodeAct-on-the-bridge Experiment — 2026-07-31

| Field      | Value                                                              |
| ---------- | ------------------------------------------------------------------ |
| Type       | Authorized live prototype (H1)                                     |
| Model      | `claude-sonnet-5` via local bridge `localhost:11437`               |
| Fixture    | `~/Developer/orchestration-prototypes/h1-codeact/fixture-project/` |
| Answer key | 7 TODO + 3 FIXME = **10** total (see `ANSWER_KEY.md`)              |
| Twin       | `docs/codeact-bridge-experiment-2026-07-31.html`                   |

## Task (identical both legs)

Count case-sensitive `TODO`/`FIXME` substrings per file; write `summary.md` table.

## Method

- **Leg A (classic loop):** `local-bridge-runner` with `--accept-edits --capabilities edits --max-steps 12 --output-format json`. 3 runs; delete `summary.md` between runs.
- **Leg B (CodeAct):** one `POST /v1/messages` asking for a single Node script (fs/path only). Scripts saved under `results/legB-runN-script.js`, shown in the run log, executed under **srt** (H2 succeeded; empty/minimal env; fixture cwd). 3 runs.

This is a **probe, not a benchmark** (N=3, one tiny task).

## Metrics

| Run | Leg       | Round-trips                |             Wall (ms) | input | output | cache_read | Correct vs key?             |
| --- | --------- | -------------------------- | --------------------: | ----: | -----: | ---------: | --------------------------- |
| 1   | A classic | 4 turns                    |                 14473 |   474 |    804 |       9617 | yes (6 files, totals match) |
| 2   | A classic | 4 turns                    |                 12273 |   911 |   1044 |      12802 | yes                         |
| 3   | A classic | 3 turns                    |                  9678 |   422 |    787 |       9150 | yes                         |
| 1   | B CodeAct | **1** request + local exec | 15424 req + 1470 exec |   255 |   1412 |          0 | yes (total 10)              |
| 2   | B CodeAct | 1 + exec                   |           11541 + 490 |   255 |   1205 |          0 | yes                         |
| 3   | B CodeAct | 1 + exec                   |           14480 + 475 |   255 |   1553 |          0 | yes                         |

Notes on usage columns: leg A usage is runner-aggregated across tool turns (cache reads dominate). Leg B usage is a single Messages call; exec wall clock is local Node under srt (near-zero tokens).

## Correctness

All six runs produced the same per-file non-zero table matching the answer key (README.md has zero matches and was omitted from tables — acceptable).

## Honest limitations

- Single micro-task; does not generalize to multi-step coding agents.
- Tiny N=3; variance exists but both legs were 100% correct here.
- Leg B output tokens can exceed leg A's non-cache output because the model emits a full program (plus thinking tokens in details).
- Leg B safety depended on **srt wrap + fs/path-only prompt**, not the runner permission gate.
- Eyes-on: scripts are on disk under `results/`; execution used srt per handoff "or run under srt if H2 succeeded."

## Takeaway

For this bounded count-and-write task, **one CodeAct round-trip matched classic multi-turn correctness** with far fewer bridge round-trips. Classic loop still owns permissions, transcripts, and tool policy — CodeAct trades that for a generated program you must confine.
