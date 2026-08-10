# HANDOFF — Starlark Bundle B: policy single-sourcing, pre-lint, adversarial corpus, resumable synthesis (R5/R6/R7/R10)

**Date:** 2026-08-10 (Pacific), same session as Bundle A (`HANDOFF-bundle-a-starlark-2026-08-10.md`).
**Folder/branch:** `/Users/alanman/Developer/claude-local-bridge-playground`, `main`.
**Recommendation source:** `docs/2026-08-06-starlark-architecture-review.md` (R5, R6, R7; R10 pulled forward
on Alan's instruction after Bundle A reproduced its failure mode live).

## Outcome in one paragraph

The four quality items landed as reviewed, tested code in `starlark-host/`: descriptor policy is now
single-sourced (prompts and validator render/enforce the same numbers, with a field→enforcement
concordance test), generated Starlark is pre-linted (mechanical Python-isms auto-repaired, the rest
returned as line-numbered repair guidance), the evaluator boundary has a hostile-program corpus (which
immediately motivated a new stdout ceiling), and synthesis became independently retryable with a
map-reduce strategy. The finale was live: Bundle A's `partial` fan-out canary — truncated synthesis,
six durable worker artifacts — was **healed by a synthesis-only map-reduce resume using the same Haiku
model that had truncated, for ~$0.015, without re-running a single worker.**

## Commits

| Commit              | What                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `0ff5f80`           | fix(campaign-budget): two real lock races caught by the two-process test (see below)         |
| `2c0049f`           | R5: `src/descriptor-policy.js` single source + concordance tests                             |
| `83aadab`           | R6: `src/starlark-lint.js` pre-lint, auto-repair, coordinator wiring                         |
| `770f817`           | R7: `test/adversarial-starlark.test.js` corpus + evaluator stdout ceiling                    |
| `8b18262`           | R10: `src/synthesis.js` (single/map-reduce/auto), `resume-synthesis` tool, ledger seq-resume |
| (this doc's commit) | Handoff, subtree README sections, CWT pointer                                                |

## The lock-race story (worth reading — the test paid for itself)

The Bundle A two-process reservation test failed intermittently on its second-ever run and exposed
**two real holes**: (1) locks were created empty and got their holder JSON written a moment later, so a
competitor reading in that window hit the "unreadable = stale" branch and deleted a LIVE lock — fixed by
creating locks WITH content atomically (tmp file + `linkSync`); (2) two waiters could both judge a stale
lock breakable and the slower one would delete the faster one's fresh lock — fixed by reclaiming through
an atomic `rename` that exactly one breaker wins. It also clarified semantics worth remembering: **a
reservation is only protected while its process lives** — the stale-PID sweep frees reservations of dead
processes by design, so the test's winner must stay alive through the contention window (as a real
process does across a model call). Stress result: 15/15 after the fix (was 2/15).

## What each item delivers

**R5 — one policy source.** `descriptor-policy.js` owns allowed keys, fixed bounds, per-field enforcement
documentation, and `policyDisclosure()` which renders the prompts' policy sections. The concordance test
asserts (a) every accepted field documents its enforcement point, (b) disclosed bounds are enforced
faithfully (probes just inside/outside each bound), (c) prompts render from the live policy object (a
deliberately unusual test value would expose hardcoding), and (d) validated `timeout_ms` /
`max_output_tokens` are OBSERVED at the worker `execute()` boundary — the finding-6
"validated-but-not-enforced" class is now a failing test, not a field discovery. Smuggled fields
(`model`, `provider`, case variants, JSON `__proto__`) are rejected.

**R6 — deterministic pre-lint.** Adjacent string literals — the exact Python-ism that burned repair
rounds live on 08-06 — are auto-repaired (`+` inserted; same-line, zero-gap, and cross-line-in-brackets
shapes) and recorded as `*_lint_repaired` ledger events with a `metrics.lintFixes` count (the R4 "repair
tax" metric). f-strings, `while`, imports, `load()`, try/except/raise, `class`, and yield/async/global/
nonlocal come back as line-numbered diagnostics that go straight into the model's repair prompt without
spending a Go-evaluator round. Recursion is deliberately left to the evaluator's precise runtime
rejection. String/comment contents are masked, so keywords inside strings can never fire.

**R7 — hostile-program corpus.** Comprehension bombs (step ceiling), `while`/recursion/`load()`
(evaluator rejection), homoglyph entry points (Cyrillic `рlan` ≠ `plan`), 2000-deep nested results
(evaluator survives; validator rejects the shape), 500-job plans (phase limit), authority-shaped smuggled
fields, and tiny-wall-clock compute (cancel timer as second guard). Writing the corpus surfaced a real
gap: **the step ceiling bounds compute, not output** — a few-step program can emit a 48 MB string.
`evaluateStarlark` now caps evaluator stdout (default 4 MB), kills the child, and fails closed. Field
note: starlark-go rejects the `**` operator at parse time — another Python-ism models can emit.

**R10 — resumable synthesis.** `runSynthesis()` supports `single`, `map_reduce` (bounded chunk summaries
→ one combining reduce call), and `auto` (map-reduce when results > 4 — so the 6-file fan-out now takes
the safe path even on fresh runs). Failures carry the stage (`single|map|reduce`) and chunk. `bin/
resume-synthesis.js` retries ONLY the synthesis of a `partial` run from its durable results, appending
`synthesis_resume_*` events to the same run ledger — `RunLedger` now continues sequence numbers on
reopen instead of restarting. Live spend meters through the durable campaign budget.

## Live evidence (campaign `campaign-2026-08-10-bundle-a`)

The Bundle A fan-out canary (`partial`, `truncated_synthesis`, 6/6 workers OK) was resumed live:
`ok: true`, `phase: completed`, `strategy: map_reduce`, exactly 3 calls (2 map + 1 reduce), synthesis
text 6,346 characters where the monolithic call had truncated at its 2,500-token ceiling. Run ledger
shows `synthesis_resume_started`/`completed` at seq 17–18 after the original 16 events — appended, not
rewritten. Same planner model (Haiku 4.5) that truncated in the morning — supporting the R10 thesis that
the failure was output shape, not model capability. Campaign after resume: **$0.109403 used of $2.00**
(Bundle A $0.094151 + resume ~$0.0153); remaining $1.890597. Bridge trace:
`~/.claude-local-bridge/traces/resume-9c21fe77-….bridge.jsonl`.

## Checks run

- Subtree: `npm --prefix starlark-host run verify` → Go build OK, **72/72** (was 39 after Bundle A;
  +5 concordance, +11 lint, +10 adversarial, +7 synthesis/resume; one pre-existing metrics `deepEqual`
  updated for the new `lintFixes` key).
- Mock `workflow:repo` (now auto map-reduce), mock `workflow:triage`, offline 8-case matrix — all clean.
- Root `npm run format:check` clean.
- Live: one paid synthesis-only resume as documented (~$0.0153).

## Skipped / caveats / concurrent-work note

- Root `npm test` and `npm run lint` currently reflect **another session's in-flight, uncommitted work**
  (HS-03 `undo` fix across `src/runner/**`, a fingerprint script, SECURITY.md/threat-model edits). At my
  last clean baseline (Bundle A close) the root suite was 975 green; during Bundle B the tree showed one
  lint error in `scripts/claude-code-fingerprint.js` (not mine) and the registered HS-01 known-gap TODO
  test. My changes touch only `starlark-host/**` plus this handoff/README/CLAUDE.md — zero file overlap.
- The offline matrix runner remains offline-only; R4 (paid repeated-trial scoring) is Bundle C and needs
  a fresh dollar-ceiling decision.
- Map-reduce increases call COUNT (4 calls for 6 results vs 1) while bounding per-call output; the R4
  harness should measure the cost/completion tradeoff rather than assuming either strategy dominates.
- The pre-lint's auto-repair is deliberately limited to adjacent strings; `**`-operator rewriting and
  other mechanical fixes are candidates once R4 data shows they pay.

## Suggested next steps

1. **Bundle C (paid, needs your ceiling):** R4 repeated-trial scoring harness — extend `golden-eval.js`
   patterns per N-2; the lint metrics (`lintFixes`, `lintRules`) are already on the ledger to score the
   per-model repair tax.
2. R8 (runner integration edge) and R12 (evidence-layout unification) remain the deliberate-decision
   items; R9 (second adapter contract test) is cheap and honest to do before any "provider-neutral"
   claim hardens.
3. Small: live summaries still report campaign-cumulative `estimatedCostUsd` (noted in Bundle A);
   a per-run delta field is a 10-line follow-up.
