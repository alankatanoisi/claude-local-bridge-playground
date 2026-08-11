# Starlark Control-Plane Worker-Axis Evaluation — Five Worker Models × Five Repetitions

**Date:** 2026-08-10 (Pacific)
**Companion to:** `docs/starlark-r4-planner-eval-2026-08-10.md` (planner axis). Together these two
documents complete the two-axis picture the 2026-08-06 live-results doc proposed as its
"recommended next experiment."
**Harness:** `starlark-host/bin/run-eval.js --axis worker` (Bundle D).
**Campaign:** `campaign-2026-08-10-r4-planner` (shared with the planner axis), $20 durable cap.
Worker-axis scored spend **$9.7771**; campaign total settled **$16.2642 of $20** across 553 calls,
leaving $3.7358. Owner authorization: Alan, 2026-08-10.

## Design

Identical fixture to the planner axis (4 fixed repository documents, deterministic mixed-fault
profile, two repair attempts, full traces). **The planner is held fixed at Haiku 4.5** — the
cheapest tier, chosen because the planner-axis data showed it produced the most protocol-compatible
plans — and the **worker model varies**. Exactly one axis moves.

Because the mixed-fault profile fails all four attempt-1 jobs by injection, **every accepted
artifact in this evaluation comes from a retry**. Artifact count is therefore a direct measure of
worker contract compliance: max 3 per trial (the permanent fault must stay failed).

## Results (5 reps per worker model, planner fixed)

| Worker model        | Retries accepted | Mean artifacts (of 3) | Mean cost/trial | Mean duration | Synthesis     |
| ------------------- | ---------------- | --------------------- | --------------- | ------------- | ------------- |
| **claude-sonnet-5** | **15/15 (100%)** | **3.0**               | $0.109          | 69 s          | 5/5 completed |
| claude-opus-4-8     | 8/15 (53%)       | 1.6                   | $0.353          | 104 s         | 5/5 completed |
| claude-haiku-4-5    | 6/15 (40%)       | 1.2                   | **$0.059**      | 69 s          | 5/5 completed |
| claude-fable-5      | 3/15 (20%)       | 0.6                   | $0.844          | 137 s         | 5/5 completed |
| **claude-opus-5**   | **0/15 (0%)**    | 0.0                   | $0.590          | 136 s         | 5/5 completed |

Every trial completed its pipeline (25/25 phases `completed`, 25/25 traces complete) — the
differences are entirely in whether worker output satisfied the host's strict four-field JSON
contract.

## The mechanism: one length ceiling explains almost everything

Every failed retry was `invalid_worker_output`. Bucketing by the host validator's own message:

| Worker model      | summary > 700 chars | claims shape/length | evidence shape/length | unparseable JSON |
| ----------------- | ------------------- | ------------------- | --------------------- | ---------------- |
| claude-sonnet-5   | —                   | —                   | —                     | —                |
| claude-opus-4-8   | 5                   | —                   | 1                     | 1                |
| claude-haiku-4-5  | 5                   | —                   | 4                     | —                |
| claude-fable-5    | 7                   | 4                   | 1                     | —                |
| **claude-opus-5** | **15**              | —                   | —                     | —                |

**Opus 5 failed all fifteen retries the same way: a summary longer than the 700-character
ceiling.** Not malformed JSON, not missing fields, not refusals — it answered well and answered
too long, every single time. The dominant failure across every model is the same length ceiling.

This is the planner-axis finding restated on the other axis. There, verbose planners wrote long
task text that degraded a compliant worker; here, verbose workers violate a length contract
directly. **Verbosity, not capability, is this pipeline's dominant failure mode**, and the
premium tiers are the most verbose.

Two consequences worth stating plainly:

1. **Disclosure was not the problem.** The worker system prompt states the 700-character limit
   explicitly, and the host enforces it. This is exactly the R5 "disclosed _and_ enforced" design
   working as intended — and models still exceeded it. The remedy is not more prompt text.
2. **The retry loop cannot repair what it never learns.** A planner whose program is rejected
   receives the host's rejection reason and repairs it (that is why plan first-pass failures
   recover). A worker whose output is rejected receives only "This is a bounded retry; return
   strict JSON only" — never _what_ was wrong. That asymmetry is why Opus 5 failed identically
   fifteen times instead of correcting after the first. See finding **D-F1** below.

## Two-axis conclusion

On this fixture family the best configuration is **not one model doing everything**:

- **Plan with Haiku 4.5** — terse, structurally compliant, cheapest, fastest (planner axis).
- **Work with Sonnet 5** — the only model that reliably respects the compact output contract
  (worker axis: 15/15, at 1/8 the cost of Fable and 1/5 the cost of Opus 5).

Note the roles reward opposite-looking things and neither is "use the strongest model." Sonnet 5
was unremarkable as a planner (its recovery programs returned a dict instead of a list in 4/5
trials) yet is the standout worker; Haiku was the standout planner yet only 40% compliant as a
worker. **Role fit is measurable and is not predicted by tier.**

## Findings for follow-up

- **D-F1 (recommended, cheap):** feed the host's validation error into the retry task, mirroring
  the planner repair loop. Today a rejected worker retries blind. Deliberately NOT implemented in
  this bundle: it would change retry semantics and invalidate comparability with today's dataset.
  Implement it as its own slice, then re-run this evaluation to measure the improvement.
- **D-F2:** revisit whether 700 characters is the right summary ceiling, or whether the contract
  should express a token budget the model can reason about. The ceiling is currently a cliff.
- **D-F3:** worker-side output could get the same R6 treatment as Starlark — a deterministic
  pre-check that truncates or splits over-long summaries before rejecting the whole artifact.

## Boundaries and caveats

- n=5 per model, one fixture family, one day, one planner, one worker profile (`code_analyst`,
  2,600 max output tokens, effort low). Rankings may not transfer to other contracts — in
  particular, a looser output contract would likely narrow these gaps sharply.
- **Infrastructure interruption, disclosed:** an earlier attempt at this evaluation lost 11 trials
  to a bridge-side HTTP 401 (`authentication_error`) window — 10 at $0 and one Opus 4.8 trial after
  $0.199 of partial work. Those trials are excluded from every number above and were re-run from
  scratch after the bridge was restarted (an upstream smoke call confirmed auth before re-running).
  The cause was not diagnosed beyond "cleared on bridge restart"; treat it as an open operational
  residual, not a model result.
- Dollar figures are the playground catalog's estimates, not billing statements.
- Scored with the corrected scorer described in the planner-axis doc's integrity disclosure; local
  evidence in `starlark-host/eval-runs/` (untracked, contains prompts and source payloads).
