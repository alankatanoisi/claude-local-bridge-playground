# Roadmap Direction Review — and Five Non-Obvious Next Steps

| Field | Value |
| --- | --- |
| Prepared | 2026-08-06 |
| Status | Assessment memo. No source changes proposed inline; each item is scoped for a separate authorized chunk. |
| Inputs | `docs/session-report-round3-followthrough-2026-07-31.html`, `docs/ai-orchestration-study-review-and-next-steps-2026-07-30.html`, `docs/ai-orchestration-preliminary-study-2026-07-29.{md,html}` |
| Corroborating reads | `src/runner/budget-broker.js`, `src/runner/ledger-repair.js`, `src/runner/coordinator.js`, `docs/durability-crash-bakeoff-2026-07-31.md`, `docs/coordinator-fanout-field-test-2026-07-31.md`, `docs/ledger-forensics-sweep-2026-07-31.md`, `docs/codeact-bridge-experiment-2026-07-31.md`, `docs/srt-sandbox-evaluation-2026-07-31.md` |

---

## 1. Verdict on the current direction

**The thesis is sound and is already validated.** The review doc's sharpest line is
also the correct one: the "user-owned reference architecture" the study describes
"is a description of what the runner already is." Loop ownership, monotonic
authority ceilings, budget leases, effect-paired ledgers, evidence outside model
context — these are built, not aspirational. The landscape research has finished
paying for itself.

**Execution quality in round 3 was high.** C3 → A1 → A3 was a well-formed
sequence: a free read-only sweep first (141 ledgers, 4,175 events, 0 corrupt
tails), then an unpaid crash matrix (74 kill trials), then the only genuinely
expensive experiment last (live 4-way fan-out). The SIGTERM finding — pre-fix
`SIGTERM ≡ SIGKILL`, 18/18 stale checkpoint plus silent double-execution — was a
real bug found by a real experiment, and it was fixed and re-measured the same
day. That is the right shape.

**But three structural drifts are now visible, and none is on the backlog.**

1. **The roadmap is organized around findings, not around finding-classes.**
   Round 3 filed F1, F2, and F5 as three separate items, then noted in passing
   that they "shared one shape — machinery built, exported, unit-tested, never
   wired into the run path." That shape got fixed three times and diagnosed zero
   times. Nothing on the backlog prevents the fourth instance.

2. **Every measurement axis is an operational one.** Wall-clock, tokens, leases,
   exit codes, corrupt tails, kill survival. The roadmap has no instrument that
   measures whether the orchestrated output is *good*. Fan-out was declared a
   win at 4.13× and token parity without anyone checking whether the parallel
   answers matched the sequential ones.

3. **The backlog's own priorities have gone stale.** The P2 DBOS-vs-LangGraph
   prototype is still listed as "the top unpaid durability prototype," but A1
   already answered its question by accident (LangGraph `SqliteSaver` showed the
   "same 'replay by design' shape"), and its DBOS arm is blocked on a Postgres
   install that does not exist. Meanwhile the residual it does *not* address —
   SIGKILL — is the one durability gap that survived round 3.

---

## 2. Five non-obvious next steps

Ordered by leverage per unit of risk. Items 1–4 are unpaid.

### N-1. Make "wired into the run path" a testable property, not a review finding

**Why non-obvious:** F1, F2, and F5 were closed, so the ledger reads green. The
*class* is open. `runPhasePlan` existed, was exported, and was unit-tested while
the actual run path spawned exactly one worker — a green suite proved a feature
that users could not reach. The runner now has a large exported orchestration
surface (`coordinator.js`, `coordinator-spec-compiler.js`, `budget-broker.js`,
`ledger-repair.js`, `replay-simulator.js`, `worker-runtime.js`) and no mechanism
that distinguishes "tested" from "reachable."

**Do:** a reachability contract test in the spirit of `path-arg-contract.test.js`
— walk from the `bin/` entry points and assert that each declared orchestration
capability has at least one call edge from a real CLI path, not only from
`test/**`. Ship it with an explicit allowlist for deliberately-dormant exports so
that dormancy becomes a declared decision instead of an accident.

**Cost:** unpaid, one chunk. **Proves:** that the next F1-shaped defect fails CI
instead of waiting for a forensic sweep.

---

### N-2. Give the coordinator a quality arm before scaling fan-out further

**Why non-obvious:** the fan-out field test is the most persuasive artifact in the
round-3 set, and its headline — 4.13× speedup at byte-identical 58,568 input
tokens — is precisely the kind of number that stops further questions. But
parallel workers do not see each other's findings; sequential ones can. Speedup at
token parity is only a win if answer quality is at parity too, and that was never
measured. A 4.13× speedup that quietly costs 20% answer quality is a regression
sold as a feature.

**Do:** re-run the same four research tasks in both modes and score the outputs
blind against a fixed rubric (or against the four-way cross-check the live
workers already performed on `ARCHITECTURE.md`). The infrastructure is mostly
present: `golden-eval.js` exists and `evals/harbor/` exists, but neither reaches
the coordinator layer. Extend one of them rather than building a third harness.

**Cost:** one authorized paid run, ceilinged. Reuse the existing captures where
possible, as W1 did. **Proves:** whether fan-out is a genuine win, a wash, or a
quality tax — and it is the single largest unmeasured axis on the roadmap.

---

### N-3. Reclassify A3-F4 from "telemetry" to "safety-ceiling correctness bug"

**Why non-obvious:** it is filed as a nice-to-have. It is not. In
`budget-broker.js`, `unleasedRemaining()` and `snapshot().used` meter only
`input_tokens` and `output_tokens`. `release()` faithfully returns
`cache_read_input_tokens` and `cache_creation_input_tokens` — and nothing ever
counts them against a cap. The fan-out doc already observed that workers pull
large `cache_read_input_tokens` "so real upstream cost diverges from metered
cost." Meanwhile the roadmap's own hard-won operational lesson was "set ceilings
before fanning out," after a first attempt burned ~92k input tokens for zero
usable output. So the ceiling is the load-bearing safety control, and the
ceiling systematically under-counts what is actually billed — and the error grows
with exactly the concurrency the roadmap is pushing toward.

**Do:** meter *cost*, not tokens. `model-pricing.js` already exposes
`estimateCostUsd` and already handles cache-read and cache-write rates. Bind the
broker's caps to that, keeping token caps as a secondary dimension. Add a
regression test asserting that a lease reconciled with cache-heavy usage moves
the remaining-budget figure.

**Cost:** unpaid. **Proves:** that a `--max-cost` flag means what a user thinks
it means before fan-out width increases.

---

### N-4. Use the 187 stale pending effects as a free validation corpus for F6

**Why non-obvious:** C3 reported 187 `pending_effect` records across 69 sessions,
all pre-2026-07-19, and the natural reading is "old data, harmless, ignore." But
F6 (`applyRepair` + `reconcileForResume`) shipped the same evening and was
validated against synthetic dangling batches, not against real ones. There are
141 real ledgers on disk containing exactly the failure shapes the repair planner
claims to handle, and they are sitting unused.

**Do:** run `planRepair` in dry-run across the whole 141-ledger corpus and report
counts only — how many of the 187 pending effects the planner classifies
correctly, how many it declines, how many it would mis-repair. This is read-only
and inherits C3's stated privacy rule verbatim ("report counts only — never quote
prompts or file paths from the payload"). It converts F6 from "unit-tested" to
"field-validated" at zero token cost, and it directly retires A1-F4, whose
complaint was that replay's `orphaned_tool_use` detection is dead code because
the real ledger vocabulary never emits the events it looks for. You cannot know
that without running the planner over real ledgers.

**Cost:** unpaid, read-only. **Proves:** whether the durability repair path can
be trusted on a live `--resume-session` before someone relies on it.

---

### N-5. Treat CodeAct and path safety as one track — because CodeAct inherits none of it

**Why non-obvious:** these are currently two separate, healthy-looking backlog
lines. H1 was a clean success (6/6 correct, one round-trip instead of many) and
reads as the promising direction. HE-01, N1, N2, and N3 were all closed, and path
safety reads as solved. Both readings are locally true and jointly wrong.

Every path-safety control the project has built enforces at the **tool-argument
layer**: `resolveFileTarget` inside `read_file` / `edit_file` / `list_files` /
`write_file`, and `pathArgKeysFor` driving the deny-matrix gate over catalogued
path keys. CodeAct's whole value proposition is that the model emits a script
that does its own filesystem work — which never passes through a tool argument.
So the deny matrix, the path-arg contract, and the symlink refusals are *all
bypassed by construction* on the CodeAct path. Its only remaining boundary is
srt, and the H2 evaluation found srt's boundary leaky in precisely the relevant
direction: it blocks the in-root `.env` alias but, under narrow settings, still
permits out-of-root escape to an outside `.env`.

Round 3 also demonstrated that this project's default assumption — that a
capability is safe because a sibling capability was audited — is the exact
assumption N1 falsified at the tool layer.

**Do:** before CodeAct is promoted past experiment, (a) adopt the broader srt
deny template already recommended (workspace-only `denyRead` plus
`allowRead: ["."]`, not just `**/.env`), and (b) re-run the Safari-2 fixture set
*through the CodeAct path* rather than the tool path, so that the escape matrix
is measured where the escapes would actually occur. Do not promote CodeAct on the
strength of a correctness result alone.

**Cost:** mostly unpaid; one small gated experiment. **Proves:** whether the
runner's strongest safety property survives its most promising performance
direction. Today, on the evidence, it does not.

---

## 3. What to stop or reframe

- **Stop the DBOS-vs-LangGraph durability prototype.** A1 already established
  that LangGraph's `SqliteSaver` exhibits "the same 'replay by design' shape,"
  and the DBOS arm is blocked on an uninstalled Postgres. Its residual question
  is answered.
- **Reframe the remaining durability goal.** Round 3 spent its effort narrowing
  the crash window (debounce, SIGTERM handler). SIGKILL is "uncatchable by
  design" and no checkpointer library on the market closes it. The productive
  move is not a smaller window but a harmless replay: idempotent effects keyed by
  intent hash, i.e. the *idempotency + audit store* item already sitting in the
  gateway design memo. That memo is currently filed at P2 as documentation; it is
  actually the successor to the durability track.
- **Keep the rename-workflow worker contract at P1.** W1 proved the
  same-contract / three-worker shape on a synthetic TODO/FIXME task. The real
  Shortcut → Python → Gemini pipeline is still the study's existence proof and is
  still unwritten. It is cheap and it is the only item that closes the loop back
  to the thesis.
- **A1-F5 is smaller than it looks and worth doing with N-4.**
  `message_contract_error` is absent from the degraded-stop-reason set, so health
  reports `resume_ok` immediately after a resume has failed. A health record that
  lies about a failed resume undermines every downstream durability claim.

---

## 4. Suggested sequence

| Order | Item | Paid? | Rationale |
| --- | --- | --- | --- |
| 1 | N-4 (ledger corpus dry-run) + A1-F5 | No | Free, read-only, validates the most recently shipped durability code |
| 2 | N-3 (broker meters cost) | No | Makes ceilings trustworthy *before* the next paid fan-out |
| 3 | N-1 (reachability contract test) | No | Cheap, prevents recurrence of the round-3 defect class |
| 4 | N-2 (coordinator quality arm) | Yes, ceilinged | Runs after N-3 so the ceiling is honest |
| 5 | N-5 (CodeAct × path safety) | Mostly no | Gates promotion of the most promising direction |

N-1 through N-4 are independent and could be parallelized across sessions. N-5
should follow N-3, since it may involve gated execution.
