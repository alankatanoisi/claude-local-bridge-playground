# Starlark Control-Plane R4 Evaluation — Five Planner Models × Five Repetitions

**Date:** 2026-08-10 (Pacific)
**Status:** Completed live evaluation. This document supersedes the single-trial planner comparison in
`docs/2026-08-06-starlark-phased-hybrid-live-results.md` §"Control-model comparison", which warned it was
"not statistically meaningful rankings." These are still small samples (n=5 per model, one fixture
family, one day), but they are repeated, identically fixtured, and mechanically scored.
**Harness:** `starlark-host/bin/run-eval.js` (R4; see `HANDOFF-bundle-c-starlark-2026-08-10.md`).
**Campaign:** `campaign-2026-08-10-r4-planner`, $20 durable cap, **$6.2881 settled** across 271
upstream calls in 25 trials (5 sequential per-model batches, 5 distinct writer PIDs on one ledger;
274 reserves / 271 settles / 3 releases — the 3 releases are network-failed calls that were never
charged). Owner authorization: Alan, 2026-08-10 ($20 ceiling, all five models).

## Fixture (identical for every trial)

One trial = the canonical phased-hybrid experiment: the planner model writes a Starlark `plan` over
4 fixed repository documents (`session-ledger.js`, `budget-broker.js`, `permissions.js`,
`coordinator.js` as of commit `0726cf6`); the host validates and dispatches 4 worker jobs to **fixed
Sonnet 5 workers**; the deterministic mixed-fault profile fails ALL FOUR first-attempt jobs
(transient-before-call, timeout-after-response, malformed-output, permanent-before-call); the planner
then writes a Starlark `recover` plan; the host runs the retries; the planner synthesizes. Maximum
recoverable artifacts per trial: **3** (the permanent fault must stay failed). Planner effort:
medium. Two repair attempts allowed per planning phase. Trace level: full.

## Headline table (5 reps per model)

| Planner              | Completed | Plan 1st-pass | Recovery 1st-pass | Mean artifacts (of 3) | Retry success    | Mean cost  | Mean duration | Synthesis outcomes         |
| -------------------- | --------- | ------------- | ----------------- | --------------------- | ---------------- | ---------- | ------------- | -------------------------- |
| **claude-opus-4-8**  | **5/5**   | 5/5           | 5/5               | **2.8**               | 14/15 (93%)      | $0.269     | 105 s         | 5 completed                |
| **claude-haiku-4-5** | 4/5 ¹     | 5/5 ²         | 4/4               | 2.4                   | **12/12 (100%)** | **$0.090** | **61 s**      | 4 completed                |
| **claude-sonnet-5**  | **5/5**   | 5/5           | **1/5** ³         | 2.4                   | 12/15 (80%)      | $0.165     | 101 s         | 5 completed                |
| **claude-fable-5**   | 4/5       | 5/5           | 5/5               | 1.8                   | 9/15 (60%)       | $0.416     | 118 s         | 4 completed, **1 refusal** |
| **claude-opus-5**    | 4/5       | **3/5** ⁴     | 5/5               | 1.0                   | 5/15 (33%)       | $0.318     | 138 s         | 4 completed, 1 truncated   |

¹ Haiku's one non-completion was **infrastructure, not model**: the bridge returned HTTP 500
(`internal_error`) on a worker call during rep 1, aborting the run at $0.003. Model-attributable
completion is 4/4. (Its batch also absorbed two _transient_ bridge 500s that the recovery phase
handled correctly — those are the retryable `bridge_transient` failures in its ledger.)
² 5/5 including the aborted rep, whose plan validated first-pass before the bridge failed.
³ Sonnet's recovery programs returned a **dict instead of a list** in 4 of 5 trials
(`result_shape` rejection); all four repaired successfully on attempt 2. Its recovery logic was
fine — its return shape was not.
⁴ Opus 5's two plan rejections were `bounds_violation`: task text exceeding the 1,200-character
policy ceiling. Both repaired on attempt 2.

Boundary metrics across all 25 trials: **0 forbidden-authority attempts**, **0 permanent-fault
retries proposed**, **25/25 bridge traces complete** (events = 5 × upstream calls, exactly).

## The mechanism finding: planner verbosity taxes the worker

Retry success tracks planner task-prompt length, and the worker is the SAME model at the same
effort and ceilings in every batch:

| Planner          | Mean task length (chars) | Retry success |
| ---------------- | ------------------------ | ------------- |
| claude-haiku-4-5 | 205                      | 100%          |
| claude-sonnet-5  | 358                      | 80%           |
| claude-opus-4-8  | 521                      | 93%           |
| claude-fable-5   | 548                      | 60%           |
| claude-opus-5    | 932                      | 33%           |

Truncation is **ruled out** as the mechanism: exactly 1 `max_tokens` stop occurred in all 271
worker/planner calls (an Opus 5 synthesis), and every planner requested the same
`max_output_tokens` (2,600). The failing retries died as `invalid_worker_output` — the Sonnet
worker responding to long, elaborate task instructions drifted out of the strict four-field JSON
contract (field limits enforced by the host). In other words: **a verbose planner degrades a
compliant worker through prompt space alone.** Opus 5 shows the same signature at two boundaries —
its tasks were the longest, twice exceeding the validator's character ceiling outright, and its
retry instructions produced the worst worker compliance. Fable vs Opus 4.8 (near-identical task
lengths, 60% vs 93%) shows length is not the only variable — instruction _content_ matters too —
but the overall gradient is unmistakable.

Practical consequence for R13 (cost-tiered planner routing): on this fixture family the cheapest
planner is also the most protocol-compatible planner, and it is not close — Haiku delivered perfect
structural compliance at 1/3 the cost of Opus 4.8 and 1/4.6 the cost of Fable, in half the wall
time. Opus 4.8 is the strongest all-around finisher (best artifact yield, zero anomalies). The
premium models spent their extra tokens making the pipeline _worse_.

## What repetition corrected from the Aug 6 single trials

| Aug 6 single-trial claim                             | 5-rep verdict                                                                                                                                      |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Opus 4.8 "needed Python-to-Starlark syntax repair"   | **Did not recur**: 5/5 first-pass on both phases. Single-trial noise.                                                                              |
| Haiku "best structural pass rate, lowest cost"       | **Confirmed and strengthened** (now with 100% retry success).                                                                                      |
| Fable synthesis refusal (observed once)              | **Reproduced at 1/5** — a rate, not an anecdote. Refusal remains Fable's failure mode, not truncation.                                             |
| Opus 5 "capable but verbose", truncated synthesis    | **Reproduced**: 1/5 truncated synthesis, worst retry economics, 2/5 plans over the task-length policy. Verbosity is Opus 5's consistent signature. |
| Sonnet "only model with complete accepted synthesis" | Not distinctive under repetition (three models had 5/5 or 4/4 clean syntheses); Sonnet's actual signature is the recovery `result_shape` slip.     |

## Scorer integrity disclosure (read before trusting any metric above)

Three bugs were found **in the evaluation scorer itself** during analysis, by cross-checking
aggregates against raw run ledgers — all three silently produced plausible-but-wrong numbers:

1. Trace completeness computed expected events from the **campaign-cumulative** call list, so every
   later trial appeared more incomplete (the first pass reported 1/25 traces complete; the truth is
   25/25). Fixed: expected calls derive from each run's own durable state.
2. The scorer matched `recovery_rejected`, but the coordinator emits `recover_rejected` — every
   recovery rejection was invisible. Fixed: suffix matching.
3. `RunLedger` nests event fields under `payload`; the classifier read them flat, so every rejection
   classified as `other`. Fixed, and the tests now build events through the real ledger.

All numbers in this document come from re-scoring the 25 durable run records with the corrected
scorer (`starlark-host/eval-runs/rescored-summary-2026-08-10.json`, local evidence). The per-batch
`eval-summary.json` files written during the runs predate the fixes and carry the wrong trace/
rejection fields; per record-keeping practice they were left as written — this note is the
correction record.

## Boundaries and caveats

- n=5 per model, one fixture family (4 code documents + mixed-fault profile), one day, one worker
  model, planner effort fixed at medium. Rankings may not transfer to other task families.
- Dollar figures are the playground catalog's estimates, not billing statements.
- The fixture documents include `session-ledger.js` as modified by the HS-02 fix earlier today, so
  worker inputs differ slightly from the Aug 6 campaign's bytes. Within this evaluation all 25
  trials saw identical bytes.
- Run evidence (prompts, source payloads, full traces) stays local under `starlark-host/eval-runs/`
  and `~/.claude-local-bridge/traces/`; this document reports lengths, counts, classes, and costs
  only.
- One Haiku trial was lost to a real bridge-side HTTP 500 — recorded as infrastructure failure, not
  charged against the model, and evidence that the harness records upstream faults honestly rather
  than retrying them away.
