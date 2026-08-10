# HANDOFF — Starlark Bundle C: R4 repeated-trial planner evaluation (built, run live, scored)

**Date:** 2026-08-10 (Pacific), same session as Bundles A and B.
**Folder/branch:** `/Users/alanman/Developer/claude-local-bridge-playground`, `main`.
**Authorization:** Alan — $20 ceiling, all five planner models, 5 repetitions ("breathing room" per
the Teams-Premium upgrade).
**Results document (authoritative):** `docs/starlark-r4-planner-eval-2026-08-10.md`.

## Outcome in one paragraph

R4 is closed: a thin repeated-trial harness (`starlark-host/bin/run-eval.js` +
`src/evaluation-harness.js`) ran the canonical mixed-fault fixture 5× for each of the five planner
models — 25 live trials, 271 upstream calls, **$6.2881 of the $20 cap** — and scored every run
mechanically from its durable ledger. The rankings replace the Aug-6 single-trial table: **Opus 4.8
is the strongest all-around planner** (5/5 completed, all first-pass, best artifact yield),
**Haiku 4.5 is the efficiency-and-compliance outlier** (perfect structural compliance and 100% retry
success at $0.09 and 61 s per trial), and the standout mechanism finding is that **planner verbosity
degrades the fixed worker through prompt space alone** — retry success falls from 100% (205-char
tasks) to 33% (932-char tasks) with truncation explicitly ruled out.

## Commits

| Commit              | What                                                                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e197c2e`           | R4 harness: repeat loop + deterministic rubric scorer over durable run records; config ceiling 10→20 (owner-authorized); `eval-runs/` gitignored; 75/75 subtree tests |
| (this doc's commit) | Three scorer-bug fixes found during analysis (see below), hardened tests, results doc, this handoff, README/CWT pointers                                              |

## What the harness is (and deliberately is not)

One trial = one ordinary `PhasedCoordinator` run on the canonical fixture (4 fixed documents,
deterministic 4-fault profile, Sonnet 5 workers) — the harness adds only the repeat loop, per-run
cost deltas against the shared durable campaign, and a scorer that reads `state.json` +
`events.jsonl`. No third orchestration harness (N-2). Trials run sequentially so each cost delta has
a single campaign writer. Rubric: plan/recovery first-pass validity and attempts, R6 lint metrics,
rejection classes (`unknown_field` with authority-field flag, `bounds_violation`,
`count_violation`, `result_shape`, `starlark_error`, `lint_reject`), retry correctness vs the
injected profile, accepted artifacts, synthesis outcome/strategy, latency, per-run cost, and
trace completeness (5 bridge events per upstream call).

## Key results (full detail in the results doc)

- **Opus 4.8**: 5/5 completed, 10/10 first-pass phases, 2.8/3 artifacts, $0.269 — the Aug-6
  "needed syntax repair" verdict did not recur; it was single-trial noise. Best finisher.
- **Haiku 4.5**: cheapest ($0.090), fastest (61 s), 100% first-pass and 12/12 retries; its one lost
  run was a genuine bridge HTTP 500 (infrastructure, $0.003, recorded honestly).
- **Sonnet 5**: 5/5 completed but a repeatable quirk — 4/5 recovery programs returned a dict rather
  than a list (`result_shape`), always self-repaired on attempt 2.
- **Fable 5**: all first-pass, weak retry yield (60%), most expensive ($0.416), and the Aug-6
  synthesis refusal reproduced at 1/5 — refusal is Fable's failure mode.
- **Opus 5**: verbosity signature at every boundary — 2/5 plans over the 1,200-char task ceiling,
  worst retry economics (33%), 1/5 truncated synthesis, slowest and second-most-expensive.
- **Verbosity mechanism**: worker contract violations (`invalid_worker_output`), not `max_tokens`
  (1 occurrence in 271 calls), drive retry failure; task length gradient 205→932 chars maps to
  100%→33% retry success against the SAME worker. Directly informs R13 (route planning to the
  cheapest tier first) — on this fixture the data says Haiku plans, Opus 4.8 closes, premium
  planners pay a verbosity tax.
- **Boundary integrity**: 0 authority-field attempts and 0 permanent-fault retries in 25 trials;
  campaign ledger balanced (274/271/3) with 5 writer PIDs on one ledger.

## The scorer-bug story (this bundle's version of the lock-race story)

Three bugs were found in the scorer during analysis — every one produced plausible wrong numbers
rather than crashing: (1) trace expectations computed from the campaign-cumulative call list
(reported 1/25 traces complete; truth: 25/25); (2) `recovery_rejected` vs the coordinator's actual
`recover_rejected` label (all recovery rejections invisible); (3) `RunLedger` nests fields under
`payload` and the classifier read them flat (every rejection classed `other`). All three were
caught by cross-checking aggregates against raw ledgers, fixed, and the tests now build events
through the real `RunLedger` instead of hand-written shapes. Lesson recorded in the results doc:
**a metrics pipeline can be false-green too — validate scored numbers against ground truth before
quoting them.** The stale per-batch `eval-summary.json` files were left as written (record-keeping
practice); `eval-runs/rescored-summary-2026-08-10.json` is the corrected local evidence.

## Checks run

- Subtree `npm --prefix starlark-host test`: 75/75 after scorer fixes.
- Mock eval across all five model labels (mixed profile) at $0 before any live spend.
- 25 live trials; per-batch stderr progress lines observed; final numbers from corrected re-score.
- `npm run format:check` clean at commit time.

## Skipped / residual

- Worker-axis matrix (fixed planner, varied workers) — the natural next experiment; the harness
  supports it with a `--models`/axis extension and the verbosity finding predicts the interesting
  contrast.
- Statistical rigor: n=5 is directional, not inferential; no confidence intervals computed.
- R13 implementation (cost-tiered routing) now has its evidence base but remains unbuilt.
- Remaining review items: R8 (runner integration edge), R9 (second adapter contract test),
  R12 (evidence-layout unification), R14 (golden plans / program hashing / JSON cheap path).
- Campaign `campaign-2026-08-10-r4-planner` retains ~$13.71 unspent authorization if follow-up
  trials are wanted.

## Suggested next steps

1. **R9 + R14(c)** (free): deterministic second adapter + JSON cheap path — both cheap, both
   close honesty gaps in current claims.
2. **Worker-axis eval** (paid, ~$3–5 under the existing campaign): fixes the planner (Haiku, per
   data) and varies workers — completes the two-axis picture the Aug-6 docs planned.
3. **R13** (free): implement cheapest-tier-first planner routing with escalation on validation
   failure; today's dataset is the policy justification.
