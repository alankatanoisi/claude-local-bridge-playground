# HANDOFF — Subscription meter experiment (2026-11-04)

**Author:** Fable (Claude Code), Alan-directed. **Branch:** playground `main`. **Status:** experiment executed, results recorded, instruments landed. Not yet Cursor-reviewed.

**Full record:** `docs/entrypoint-metering-experiment-2026-11-04.html` (read that first; this file is the pointer and the agent-facing summary). Raw per-request JSONL and logs: `~/.bridge-runner/experiments/entrypoint-metering-2026-11-04/` (outside git; synthetic prompts only).

## What landed

| File                                             | Change                                                                                                                                                                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/proxy.js`                                   | Forwards every `anthropic-ratelimit-unified-*` upstream header to the local caller; new `upstream_subscription_meter` trace event with the values. Org/workspace ids stay unforwarded. New `subscriptionMeterHeaders()` export. |
| `src/runner/model-client.js`                     | Runner response metadata now carries 5h/7d utilization and status.                                                                                                                                                              |
| `test/anthropic.integration.test.js`             | New test: meter headers forwarded, identity headers not.                                                                                                                                                                        |
| `scripts/meter-probe.js`                         | The tick-counting probe (`--arm bridge` / `--arm print`), with ledger budget cap.                                                                                                                                               |
| `README.md`, `docs/threat-model.md`, `CLAUDE.md` | One-line notes on the forwarded meter and a Current Work Thread pointer.                                                                                                                                                        |

## Method in one paragraph

The 5-hour meter header has two decimals, so the probe sends equal-sized, cache-busting requests and counts the prompt tokens between two consecutive one-percent steps. That interval is the cost of 1% of the window for that arm and model. Partial intervals are discarded; refusals and HTTP errors are excluded; a window reset (value going down) is detected (none happened). Both arms carried the print-mode label on purpose: the comparison is our bridge versus real headless Claude Code, not label versus label.

## Results (complete intervals; prompt tokens and list $ per 1% of the 5-hour window)

| Path      | Model      | Shape          | Tokens / 1% | List $ / 1% |
| --------- | ---------- | -------------- | ----------: | ----------: |
| Bridge    | Haiku 5.5  | plain input    |   9,432,802 |       0.944 |
| Bridge    | Haiku 5.5  | plain input    |   9,437,460 |       0.944 |
| Bridge    | Sonnet 5.5 | plain input    |     639,374 |       1.280 |
| Bridge    | Sonnet 5.5 | plain input    |     619,313 |       1.240 |
| Bridge    | Opus 5.5   | plain input    |     391,803 |       1.570 |
| claude -p | Haiku 5.5  | 1h cache write |   7,563,985 |       1.507 |
| claude -p | Sonnet 5.5 | 1h cache write |     500,105 |       1.966 |
| claude -p | Opus 5.5   | 1h cache write |     343,425 |       2.656 |

Incomplete: bridge + cache-user on Opus saw one tick, then 291,808 cache-write tokens ($2.34) without the next (lower bound only).

## Observations (see the HTML for the full wording)

1. The meter is neither pure tokens nor pure list price: 1.7x spread in list $ across models, 24x in tokens.
2. Bridge and `claude -p` draw the window at similar token rates per model (0.79x–0.88x tokens per 1% for `-p`, whose tokens are cache writes). Consistent with same path cost plus a modest cache-write weighting; the cache-user bridge arm that would prove it did not complete.
3. 7-day meter moved 3 steps while the 5-hour meter moved 22.
4. Random-word filler was refused by Haiku's classifier (`bio`); inventory-style filler never was.

## Not measured

Interactive / VS Code label rates; output-heavy requests; a complete cache-user bridge interval. Spend: $32.98 of the $40 cap.

## Next (Alan's decision)

- Complete the cache-user Opus arm (~$6).
- One output-heavy shape.
- Surface the forwarded meter in the runner's human log.
- Cursor invariant review of this range (bridge file touched: `src/proxy.js`).
