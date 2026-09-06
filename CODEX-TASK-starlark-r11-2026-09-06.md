# Codex task brief — Starlark lab R11: kill / resume / cancel-under-concurrency (2026-09-06)

**Repo:** `/Users/alanman/Developer/claude-local-bridge-playground` only.
**Commissioned by:** Alan, 2026-09-06. Drafted by Fable (Claude Code) at Alan's request.
**Disposition of this file:** operative instructions. When the task is done and Alan
has accepted it, archive this brief (it should not outlive its task at the repo root).
**Budget:** the build itself is **$0** (deterministic adapter + mock mode + process-kill
tests). Alan authorized up to **$10** of live spend for the optional live smoke in
Part 6 — that part only, and only under its stated conditions.

---

## Before anything else

1. Read `docs/working-with-alan.md` and `docs/agent-user-autonomy-boundary-2026-08-11.md`.
2. Run the startup preflight from `AGENTS.md`, then `git pull --ff-only origin main`.
   **The tree must be clean and up to date before you start.** If it is dirty, stop
   and ask Alan — another agent may be mid-flight (charter ground rule 2).
   (`.cursor/settings.json` / `.cursor/hooks/state/*` dirty is Cursor's own local
   state — ignore it, per Alan's standing instruction 2026-08-31.)
3. Current thread state you must not re-derive:
   - `HANDOFF-starlark-status-and-recommendations-2026-08-25.md` — the thread entry.
     Its §5 R2 is the original R11 scope this brief expands. Its §2 scorecard and §4
     drift notes are current.
   - The four bundle handoffs it lists (A–D, 2026-08-10) — implementation record only;
     read on demand, do not re-verify them.
   - `docs/programmatic-tooling-research-review-2026-08-31.html` §4 idea 2 and §6
     fold 2 — the terminal-state test shape this brief bakes in (see "Test shape
     contract" below).

## Status change this brief carries (owner decision, Alan, 2026-09-06)

**The Starlark lab is un-idled: in-lab work resumes with R11.** This does NOT reverse
the R8 architectural decision (2026-08-31): `starlark-host/` stays a separate lab with
its own CLI — **no `run_workflow` runner edge, no Starlark code under `src/runner/`**.
"Un-freeze" means the lab builds again, not that it grows into the runner.

## Context you need (verified 2026-09-06)

The lab is a phased-hybrid control plane: a planner model writes capability-free
Starlark (or the host builds JSON descriptors deterministically — `--plan-source
host_json`, R14c), `validateJobs()` gates every descriptor, bounded workers execute
via a bridge adapter or the $0 byte-reproducible `deterministic-analyst.js` (R9), and
results land in a per-run `RunLedger`.

Key files:

- `starlark-host/src/coordinator.js` — `PhasedCoordinator`; the worker phase runs jobs
  through `mapConcurrent(items, limit, fn)` (bottom of the file). **There is no abort
  surface anywhere in it today.**
- `starlark-host/src/ledger.js` — `RunLedger`: append-only `events.jsonl` (monotone
  `seq`, continued across reopen — the R10 property you will build on), `state.json`
  checkpoints via `atomicWrite`, `artifacts/`. Existing event types: `run_started`,
  `plan_validated`, `job_started`, `job_succeeded`, `job_failed`,
  `recovery_plan_validated`, `synthesis_failed`, `run_completed`, `run_failed`.
- `starlark-host/src/resume-synthesis.js` + `bin/resume-synthesis.js` — the ONLY
  resume today, and it is synthesis-only: a killed **worker phase** cannot resume
  without re-running completed jobs. That gap is R11.
- `starlark-host/src/campaign-budget.js` — durable cross-process dollar ledger (R1).
- `starlark-host/src/bridge.js` — direct bridge calls (live mode); traces under
  `~/.claude-local-bridge/traces/`.
- `starlark-host/src/worker-registry.js`, `deterministic-analyst.js` — the $0 worker.
- Entry points: `starlark-host/bin/run-experiment.js`, `run-workflow.js`, `run-eval.js`,
  `run-matrix.js` (offline-only by design), `resume-synthesis.js`.

Environment facts (this machine):

- **Go is NOT installed.** `npm --prefix starlark-host run verify` cannot build
  `bin/starlark-eval` (gitignored). Baseline on 2026-08-25: **90 tests: 66 pass /
  15 fail / 9 skip**, where all 15 failures are `spawn ENOENT` on the missing binary
  (environmental, not regressions) and the 9 skips are the R7 corpus, which already
  guards correctly. Re-measure your own baseline first and record it.
- **Nothing you build may hard-require the Go evaluator.** Use `--plan-source
host_json` and the deterministic worker for every new test.
- `~/.bridge-runner/campaigns/` may or may not exist here; treat any 08-10 dollar
  figures in old handoffs as history, never as a live balance.
- Reference implementation for kill-shaped tests in this repo:
  `test/runner/ledger-crash-recovery.test.js` (the runner's A1 work) — spawns a real
  child process, kills it with SIGTERM/SIGKILL mid-flight, then asserts terminal
  state. Steal the _pattern_, not the code.
- Reference implementation for the test shape: `src/runner/golden-eval.js`
  (`evaluateChecklist`) and `test/runner/golden/he06-*.json`, landed 2026-09-06 —
  the runner's terminal-state checklist evals. Same philosophy, different harness;
  do not import runner code into the lab.

## Test shape contract (research review fold 2 — bake this in everywhere)

Every R11 test asserts **terminal-state predicates, not trajectories**:

- A test is: arrange → interrupt (abort or kill) → optionally resume → then a list of
  small, independently-asserted, **named** predicates over the FINAL state: the run
  ledger (`events.jsonl` + `state.json`), artifacts on disk, and the campaign budget
  file. Each predicate must be assertable on its own (one failing predicate should
  not mask the others — prefer collecting failures and reporting all of them, or at
  minimum one `assert` per predicate with a message naming the invariant).
- Do NOT assert full event orderings, exact event counts of incidental types, or
  intermediate states — those re-create the brittle snapshot style the research
  review argues against. Order may be asserted only where it IS the invariant
  (e.g. "`seq` is strictly increasing across the resume boundary").
- Tolerate alternative solution paths: if the coordinator legally reorders jobs, the
  predicates must still pass.

## The task

Execute the parts **in order**. Parts 1–3 are the core; 4–5 are the stretch Alan
asked for; 6 is optional-conditional.

### Part 1 — Test hygiene: missing-evaluator suites skip, never ENOENT

Today, suites that spawn `bin/starlark-eval` fail with `spawn ENOENT` when the binary
is absent (15 failures on 2026-08-25). The R7 adversarial corpus already guards on a
missing binary and skips. Apply the same guard to every remaining suite/test that
needs the binary (per the 08-25 handoff §5 R5 bullet 1).

Done looks like: `npm --prefix starlark-host test` on a Go-less machine reports
**0 fail**, with the binary-dependent tests counted as skipped, and still runs them
(not skipped) when the binary exists. Do not weaken any assertion to achieve this.

### Part 2 — R11 core: abort token + kill-safe worker phase

Build a **run-level abort surface** in `starlark-host/src/`:

1. An abort token/controller created per run and threaded into `PhasedCoordinator`'s
   worker phase and the bridge adapter. Semantics (reuse the runner's Slice D cancel
   _lessons_ — `shouldCancel` checks at loop boundaries, destroy-then-ignore for
   late callbacks — without copying any ACP code):
   - `mapConcurrent` workers check the token before **starting** each job; a tripped
     token means no new job starts.
   - An in-flight bridge HTTP call is destroyed on abort; its late
     completion/failure callbacks are ignored (never recorded as job results after
     abort).
   - The deterministic adapter honors the same token (checked between jobs is
     enough — it has no long in-flight calls).
2. Ledger truth: on abort, append a new `run_aborted` event (with a reason field) and
   checkpoint `state.json` with a status that resume can recognize. Append-only,
   `seq` continues — never rewrite or truncate `events.jsonl`.
3. Wire the token to reality: SIGINT/SIGTERM handlers on the workflow/experiment
   entry points trip the token, then flush the ledger before exit (mirror the intent
   of the runner's SIGTERM finalizer from the A1 work). A hard SIGKILL obviously
   cannot flush — resume (Part 3) must cope with that case from the ledger alone.

### Part 3 — R11 core: worker-phase resume + the test suite

1. **Worker-phase resume.** A `--resume <runDir>` mode (on `bin/run-workflow.js`, and
   `run-experiment.js` if the plumbing is shared) that reopens the `RunLedger`,
   reconstructs job state from `events.jsonl` + `state.json`, and continues the
   worker phase:
   - Jobs with a recorded `job_succeeded`: **never re-run** (their results are
     reused for synthesis).
   - Jobs with `job_started` but no terminal event (the SIGKILL case, or an aborted
     in-flight job): **at-least-once** — they re-run, and the terminal ledger ends
     with exactly one `job_succeeded` per such job id after a successful resume.
   - Jobs never started: run normally.
   - Synthesis runs at the end exactly as if the run had never been interrupted;
     `resume-synthesis.js` stays valid for its own (synthesis-only) case — do not
     break it, and do not build a third resume path.
   - Respect R12's deferral: stay inside the existing per-run `runDir` layout. Do
     **not** invent a new evidence layout or move artifacts under `~/.bridge-runner`.
2. **The tests** (all $0: deterministic worker + `--plan-source host_json` + mock
   bridge; every test follows the Test shape contract above):
   - **Cooperative abort:** trip the token mid worker phase (fault-injection or a
     slow deterministic job); terminal predicates: `run_aborted` present, no
     `job_succeeded` recorded after the abort event's `seq`, `state.json` status
     recognizable, campaign/budget file parseable and consistent.
   - **Process kill (SIGTERM) + resume:** spawn a real child running a workflow,
     kill it mid worker phase, resume; predicates: every job id has exactly one
     `job_succeeded` across original+resume ledger, previously-completed jobs were
     not re-executed (the deterministic adapter makes re-execution observable —
     e.g. count per-job execution artifacts), `seq` strictly increasing across the
     resume boundary, synthesis artifact exists and references all jobs.
   - **Process kill (SIGKILL) + resume:** same predicates; additionally the
     interrupted job (started, no terminal event) re-runs (at-least-once) and ends
     with exactly one success.
   - **Cancel under concurrency:** worker pool with limit ≥ 3 and staggered job
     durations; abort while several jobs are genuinely in flight; predicates: no
     job result recorded after abort, no unhandled rejection, ledger not torn
     (every line parseable JSON), no duplicate terminal event per job id.
   - **Resume is idempotent:** resuming an already-completed run re-runs nothing
     and exits cleanly (predicate: zero new `job_started` events).

### Part 4 — Stretch: R14a golden plans

Per the 08-25 handoff §5 R3: snapshot the expected descriptor list per fixture on the
`host_json` path, so planner-prompt/plan-builder edits show up as reviewable diffs.
Store snapshots under `starlark-host/test/` (committed — they are test fixtures, not
run evidence). Include the natural companion: make the "$0 full pipeline" adapter
test use `--plan-source host_json` so it no longer requires Go.

### Part 5 — Stretch: R14b program + input hashing

Only after Part 4 exists to hash against: record a content hash of the accepted
plan/program and its inputs in the run ledger, so two runs claiming the same plan are
verifiable. Keep it small — a hash field on existing events/state, not a new
subsystem. If time or complexity runs out, skip this part and say so.

### Part 6 — OPTIONAL live smoke (conditions, all required)

Only if: Parts 1–3 are green, the bridge on `127.0.0.1:11437` answers, and Alan has
confirmed in your kickoff message (or in-session) that the $10 ceiling stands. Then:
one small live kill/resume smoke — a 2–3 job `repo_fanout` in `--mode live` with
`--max-cost-usd` set to **at most 2** — SIGTERM it mid-phase, resume, and verify the
same predicates plus: the campaign ledger's settled dollars reflect both segments
with no double-count. Record actual spend in your handoff. If any condition is
unmet, skip this part and say so — that is the expected outcome, not a failure.

## Hard constraints

- **Scope fence:** `starlark-host/**` plus a new dated handoff at the repo root and
  (only if behavior/CLI changed) `starlark-host/README.md`. Everything else is OUT:
  no `src/**`, no `test/**` (repo root), no `bin/**` (repo root), no `docs/**`
  content rewrites.
- **R8 stands:** no `run_workflow` tool, no runner edge, no Starlark code outside
  `starlark-host/**`. Do not port the runner coordinator into the host; do not
  import `src/runner/**` modules into the lab.
- Doctrine (do not renegotiate): Starlark is code-as-plan, not code-as-action. The
  generated program has zero capabilities; the host owns validation, models,
  dollars, workers, artifacts.
- Dated records are immutable: superseded handoffs and dated `docs/` notes get dated
  banners pointing forward — never content rewrites. (You will banner the 08-25
  Starlark handoff's R8/R11 status ONLY via your new handoff pointing back; do not
  edit the 08-25 file.)
- No unsolicited policy/Terms-of-Service commentary (final owner boundary — see the
  autonomy record above).
- Do not restore retired concepts (`--agent`, `--profile`, `--list-agents`,
  `--list-profiles`). Never edit `src/credentials.js`. The rest of the bridge fence —
  `src/proxy.js`, `src/server.js`, `src/interceptors/**`, VS Code extension auth
  settings — is untouchable in this task.
- Never quote `~/.bridge-runner` or `starlark-host/{runs,workflow-runs,matrix-runs,eval-runs}`
  ledger/transcript payload text; aggregates only. Run evidence dirs stay untracked.
- Mock mode is the default. Live mode needs `--mode live` **and** `--max-cost-usd`.
  The config ceiling is $20 (`maxExperimentCostUsd`) — do not raise it. Part 6's own
  ceiling is $10 total, per-run flag at most $2.
- Alan's live T3 app is port 3773 — never touch it; never kill processes by pattern
  match (your kill tests target ONLY child PIDs you spawned).
- Known non-bug you must not "fix": the 08-25 handoff §4 notes a never-root-caused
  bridge HTTP 401 window from the 08-10 evals. Investigating the bridge is a
  boundary exception — out of scope.

## Gates — all must pass before handoff

```bash
npm --prefix starlark-host test   # expect 0 fail; binary-dependent tests skip on this machine
                                  # (record the pass/skip counts you inherited FIRST, then yours)
npm test                          # repo root — must stay at its inherited baseline; your scope
                                  # fence means any change here is a red flag
npm run lint                      # covers src/ test/ — should be untouched by you; run anyway
npm run format:check              # covers root *.md — your brief-adjacent files must be clean
npm run check:docs
```

Note (from the 2026-08-31 session record): the root suite is only fully green with a
writable scratch HOME — `HOME="$TMPDIR/testhome" npm test`. ~18 residual failures
under the real sandboxed HOME are environmental, not regressions. Measure the
baseline before your first change so you can tell your damage from the weather.
If a gate breaks, fix the cause or revert the change that broke it — never the gate.

## Definition of done

- [ ] Part 1: `npm --prefix starlark-host test` → 0 fail on this Go-less machine;
      binary-dependent tests skip with a reason naming the missing binary; no
      assertion weakened.
- [ ] Part 2: abort token exists, threaded through the worker phase and both
      adapters; `run_aborted` event + recognizable checkpoint status; SIGINT/SIGTERM
      trip-and-flush on the entry points; `events.jsonl` remains append-only with
      continued `seq`.
- [ ] Part 3: `--resume <runDir>` continues a killed worker phase; the five named
      tests exist and pass; every test asserts terminal-state predicates per the
      Test shape contract (spot-checkable: no test asserts a full event-type
      sequence); completed jobs are provably not re-executed; SIGKILL-interrupted
      jobs are at-least-once with exactly one terminal success after resume;
      `resume-synthesis.js` behavior unchanged and its tests still pass.
- [ ] Part 4 (stretch): descriptor-list snapshots per fixture committed; snapshot
      test fails on a deliberate plan-builder change (prove it once, then revert
      the deliberate change); the $0 full-pipeline test no longer needs Go.
- [ ] Part 5 (stretch): plan/input hash recorded in ledger/state; or an explicit
      "skipped because …" in the handoff.
- [ ] Part 6: executed only under its conditions, with actual spend reported; or an
      explicit "skipped because …".
- [ ] New thread-entry handoff at repo root: `HANDOFF-starlark-r11-2026-09-<DD>.md` —
      what landed, test counts before/after, design decisions (abort semantics,
      resume reconstruction rules), residuals (R12 still open, D-F3 untouched, Go
      still absent), and a pointer stating it supersedes the 08-25 handoff as thread
      entry (do not edit the 08-25 file itself).
- [ ] End with the standard handoff block: folder, branch, files changed, checks run
      (real output), anything skipped, risks/next steps.
- [ ] Report verification raw: real pass/fail first; never quietly fix and report as
      if it passed on the first try (charter ground rule 4).
- [ ] If you deviated from this brief anywhere, say exactly where and why (charter
      ground rule 5) — deviation with disclosure is fine; silent deviation is not.

## Commit shape

Suggested sequence (conventional commits; one commit per part keeps review sane):

1. `test(starlark-host): skip evaluator-dependent tests when starlark-eval is absent (R5 residual)`
2. `feat(starlark-host): run-level abort token + signal trip-and-flush (R11 part 1)`
3. `feat(starlark-host): worker-phase resume from run ledger + kill/resume/cancel test suite (R11 part 2)`
4. `test(starlark-host): golden descriptor-list snapshots on the host_json path (R14a)`
5. `feat(starlark-host): plan/input content hashing in the run ledger (R14b)` — if built
6. `docs: HANDOFF-starlark-r11-… (thread entry; R11 closed, lab un-idled, R8 unchanged)`

Commit but **do not push until Alan says so** (unless Alan's kickoff message already
authorized push).
