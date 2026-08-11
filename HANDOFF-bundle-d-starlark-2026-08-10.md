# HANDOFF — Starlark Bundle D: R13 routing, R9 second adapter, R14c cheap path, worker-axis evaluation

**Date:** 2026-08-10 (Pacific), same session as Bundles A, B, and C.
**Folder/branch:** `/Users/alanman/Developer/claude-local-bridge-playground`, `main`.
**Authorization:** Alan — the three free items, plus the worker-axis evaluation run under the
existing `campaign-2026-08-10-r4-planner` allowance (no new money authorized).
**Results document:** `docs/starlark-r4-worker-eval-2026-08-10.md`.

## Outcome in one paragraph

Three review items landed as tested code and the two-axis model picture is now complete. R13 gives
planning a cost-tiered ladder with measured escalation; R9 makes "provider-neutral" an observed
property rather than a structural claim, via a deterministic zero-cost second worker adapter; R14c
adds a plain-JSON plan path that skips the planner _and_ the Starlark layer for fully-determined
fan-outs while keeping the same validator. The worker-axis evaluation (20 trials after re-running
11 lost to a bridge auth outage) found that **Sonnet 5 is the only model that reliably satisfies
the compact worker output contract (15/15), while Opus 5 failed all 15 retries in exactly one way:
summaries over the 700-character ceiling.** Combined with Bundle C, the pipeline's best
configuration is Haiku planning and Sonnet working — and neither role is won by the strongest tier.

## Commits

| Commit              | What                                                                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `86b909e`           | R13: cost-tiered planner ladder with `<phase>_escalated` ledger events, per-tier artifact numbering, recovery/synthesis pinned to the accepted tier |
| `032f6fc`           | R9: `src/deterministic-analyst.js` second provider + 4 contract tests (both adapters, same envelope; full pipeline at $0)                           |
| `81f233f`           | R14c: `src/json-plan.js` host-built descriptor lists through the same `validateJobs` gate; `--plan-source host_json`                                |
| `5e4651e`           | eval: `--axis worker` with attribution fields (exactly one axis moves per trial)                                                                    |
| (this doc's commit) | Worker-axis results doc, this handoff, CWT pointer                                                                                                  |

## What each item delivers

**R13 — planner ladder.** `plannerLadder` is ordered cheapest-first; each tier gets the existing
two-attempt repair budget and escalation happens only on exhaustion, recorded as
`<phase>_escalated`. Recovery resumes at the tier planning ended on; synthesis runs on the tier
that produced the last accepted program. A single-entry ladder reproduces pre-R13 behavior exactly,
so Bundle C's fixed-model comparisons remain valid. CLI: `run-workflow --planner-ladder a,b,c`
(deliberately not added to `run-experiment`/`run-eval`, where silent routing would corrupt a
controlled comparison).

**R9 — second provider.** A deterministic static profiler serving the registry's exact `execute()`
contract at zero cost, with byte-for-byte reproducible output. Contract tests assert both adapters
produce envelopes that survive the coordinator's strict parser, that the full `repo_fanout`
pipeline completes on the deterministic provider at $0, and that a route naming an unregistered
provider fails closed at construction.

**R14c — JSON cheap path.** For fan-outs whose plan is fully determined by policy, the host builds
the descriptor list directly: zero planner calls, zero evaluator rounds, **same validator**. Tests
prove a tampered host plan is still rejected (`unknown field`) and that a host bug retrying a
permanent failure is caught by the recovery validator. Combined with R9, there is now a full
pipeline run — plan, workers, recovery, synthesis — with zero model calls of any kind.

## Worker-axis results (full detail in the results doc)

| Worker (planner fixed = Haiku 4.5) | Retries accepted | Artifacts | Cost/trial |
| ---------------------------------- | ---------------- | --------- | ---------- |
| Sonnet 5                           | 15/15 (100%)     | 3.0       | $0.109     |
| Opus 4.8                           | 8/15 (53%)       | 1.6       | $0.353     |
| Haiku 4.5                          | 6/15 (40%)       | 1.2       | $0.059     |
| Fable 5                            | 3/15 (20%)       | 0.6       | $0.844     |
| Opus 5                             | 0/15 (0%)        | 0.0       | $0.590     |

Every failure was `invalid_worker_output`, and the dominant cause across every model was one
constraint: **the 700-character summary ceiling** (Opus 5: 15/15 failures, all that one reason).
This is the planner-axis verbosity finding restated on the other axis — verbosity, not capability,
is the pipeline's dominant failure mode, and the premium tiers are the most verbose.

**D-F1, the actionable asymmetry:** a rejected _planner_ receives the host's rejection reason and
repairs; a rejected _worker_ receives only "return strict JSON" and never learns what was wrong —
which is why Opus 5 failed identically fifteen times. Feeding the validation error into the retry
task is a small change with likely large effect. **Deliberately not implemented here**: it changes
retry semantics and would invalidate comparability with today's dataset. It should be its own
slice, followed by a re-run of this evaluation to measure the delta.

## Checks run

- Subtree `npm --prefix starlark-host test`: **84/84** (77 after R13, 81 after R9, 84 after R14c).
- Mock `workflow:repo`, `workflow:triage`, offline matrix, and `eval:mock` — all clean at $0.
- Live: 20 scored worker-axis trials; upstream auth verified with a ~$0.001 smoke call before
  re-running the 401 casualties.
- `npm run format:check` clean at commit time.

## Skipped / residual

- **Open operational residual:** the bridge HTTP 401 (`authentication_error`) window that killed 11
  trials mid-evaluation. It cleared after a bridge restart and was not root-caused. If it recurs,
  the shape (sudden onset, every subsequent call, $0 cost) suggests a credential refresh gap worth
  investigating in the bridge layer.
- D-F1/D-F2/D-F3 (worker retry feedback, summary-ceiling design, worker-side pre-check) — written
  up, not built.
- R8 (runner integration edge) and R12 (evidence-layout unification) remain the deliberate-decision
  items; R14 (a) golden plans and (b) program hashing are unbuilt (only the (c) cheap path landed).
- Campaign `campaign-2026-08-10-r4-planner`: **$16.2642 settled of $20; $3.7358 remains.** Any
  substantial further live work should start a fresh campaign with a fresh ceiling decision.

## Suggested next steps

1. **D-F1** (free): give worker retries the host's validation reason, then re-run the worker axis
   under a fresh campaign to measure the improvement — the cleanest available before/after.
2. **R8 / R12** (free, decision-shaped): the two remaining architecture questions, best done
   interactively rather than as autonomous slices.
3. **R14 (a)/(b)** (free): golden-plan snapshots and program hashing now that determinism is
   proven and a JSON cheap path exists to compare against.
