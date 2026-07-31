# HANDOFF — Round 3 results (C3 ✓ A1 ✓ A3 ✓), 2026-07-31

**Audience:** the next agent (any surface). **Predecessor:** `HANDOFF-c3-a1-a3-round3-2026-07-31.md`
(the brief this round executed; keep it for the F1–F8 definitions and evidence pointers).
**Everything in that brief's "Not done" list is now done.**

## What happened, in order

1. **Verification** — the unverified A3-step-1 code (coordinator leasing + fan-out + CLI ceilings)
   passed syntax, its 6 new unit tests, and the full suite after one pre-existing failure was
   root-caused and fixed (`p0-11-redaction-boundary.test.js` used a fixture named `secretish.js`,
   which the HE-01 deny-matrix hardening now rightly blocks; renamed to `config-values.js`).
2. **C3** ran: 141 ledgers, 4,175 events, zero corrupt tails, 187 `pending_effect` in 69 sessions,
   all pre-2026-07-19. → `docs/ledger-forensics-sweep-2026-07-31.{md,html}`.
3. **A1** ran: 74 kill trials (pre/post fix) + a real LangGraph `SqliteSaver` arm.
   **F8 confirmed** (SIGTERM ≡ SIGKILL: 18/18 stale checkpoint + silent double-execution of
   completed side effects) and **fixed**: `run.js` now has a SIGTERM handler mirroring SIGINT
   through the terminal finalizer; post-fix 18/18 SIGTERM trials are clean (consistent ledger,
   flushed checkpoint, health record, exit 143, zero re-execution on resume). SIGKILL residual
   remains and is documented, not hidden. → `docs/durability-crash-bakeoff-2026-07-31.{md,html}`,
   findings **A1-F1…A1-F5**.
4. **A3 step 2** ran live against the real bridge: 4-node read-only research fan-out vs a
   dep-chained sequential baseline, same prompts, `--budget-input-tokens 400000
--budget-output-tokens 20000`. **4.13× wall-clock speedup (12.4 s vs 51.2 s) at byte-identical
   input tokens (58,568)**; broker invariant held under real concurrency (8 leases, all
   reconciled, 0 active at exit). The first attempt with default ceilings burned 91.7k input
   tokens for zero usable output — recorded as the "ceilings before fan-out" lesson.
   → `docs/coordinator-fanout-field-test-2026-07-31.{md,html}`, findings **A3-F1…A3-F4**.
5. **`docs/ARCHITECTURE.md`** written (durable layer map; partial HE-05 payment). Study doc
   annotated: §7.5 records F1–F8 dispositions + round-3 results; §7.4 items 4–5 annotated.
   `CLAUDE.md` Current Work Thread pointers updated.

## Repo changes this round

| File                                                                | Change                                                                                                 |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/runner/run.js`                                                 | SIGTERM handler through `finalizeRun` (F8 fix), + listener cleanup                                     |
| `src/runner/coordinator.js`                                         | (previous session, now verified) leasing + fan-out wiring                                              |
| `bin/local-bridge-coordinator.js`                                   | (previous session, now verified) ceiling + `--research-plan` flags                                     |
| `test/runner/coordinator-lease.test.js`                             | (previous session, now verified) 6 lease/fan-out tests                                                 |
| `test/runner/ledger-crash-recovery.test.js`                         | **new** — repo's first process-kill integration tests (SIGTERM deterministic, SIGKILL invariant-based) |
| `test/runner/p0-11-redaction-boundary.test.js`                      | fixture rename to dodge deny-matrix basename (pre-existing failure)                                    |
| `docs/…2026-07-31.{md,html}` ×3 pairs, `docs/ARCHITECTURE.md`       | result docs                                                                                            |
| `docs/ai-orchestration-study-review-and-next-steps-2026-07-30.html` | §7.4 annotations + new §7.5                                                                            |
| `CLAUDE.md`                                                         | pointer update only                                                                                    |

Prototype harnesses (outside git): `~/Developer/orchestration-prototypes/a1-durability/`
(mock bridge, crash drivers, LangGraph venv, raw per-trial JSON) and
`~/Developer/orchestration-prototypes/a3-fanout-live/` (plans, raw coordinator result JSON).

## Open threads, sharpest first

1. **F6 — `applyRepair` stub** (still open **by instruction**). A1 measured both failure shapes it
   would fix: stale-checkpoint silent replay, and dangling-`tool_use` checkpoints that strand
   resume on the message-contract check. The structural version is **ledger-aware resume**:
   reconcile checkpoint against ledger at resume time.
2. **N1 — path-arg contract test** (unchanged from §7.4; still the cheapest high-leverage item).
3. **A1-F4/A1-F5** — replay's `orphaned_tool_use` branch is dead code against the runner's real
   ledger vocabulary; a failed resume writes a `resume_ok` health record. Both small and testable.
4. **A3-F1/A3-F2** — coordinator CLI exit code misleads on research-only runs; worker children
   are pinned to 2,000 output tokens with no plan/inherit knob.
5. **DBOS arm** — still gated on Postgres (not installed); LangGraph half of the durability
   bake-off is paid.

## Checks

`npm test` 799/799 (includes the 2 new crash tests) · `npm run lint` clean ·
`npm run check:docs` and `npm run format:check` run at handoff time (see chat handoff for the
final word) · nothing committed or pushed — working tree left dirty for Alan's review.
