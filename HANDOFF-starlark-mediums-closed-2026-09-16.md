# Starlark thermo-nuclear Mediums closed — 2026-09-16

**Author:** Fable (Claude Code), executing Alan's decision "Medium #1 to #3 as one commit and then #4
thereafter", then "commit and push when you are done" from the 2026-09-16 session. Implements the fix
order written in
[`HANDOFF-starlark-r11-thermo-nuclear-2026-09-06.md`](HANDOFF-starlark-r11-thermo-nuclear-2026-09-06.md)
(Cursor review of `84dd73a^..406423b`). That file now carries a CLOSED banner; its findings text is
unchanged. Codex's same-day evidence handoff
[`HANDOFF-starlark-abort-commit-next-slice-2026-09-16.md`](HANDOFF-starlark-abort-commit-next-slice-2026-09-16.md)
(pushed as `da253bf` while this work was in flight) recommended splitting the work into slices A/B/C. Alan's
two-commit shape was kept; each Medium still has its own regression test, which is the condition that handoff
set for combining them. Its §9 acceptance matrix is answered row by row below.

**Live spend:** $0. Every change is local code and local tests. The bridge was not called; the fake bridges
are local HTTP servers and the `MockBridge`.

## What changed and why (plain language)

The Starlark host runs a pipeline: plan → workers → recovery → synthesis. Each model call is **reserved**
against a budget before it starts and **settled** (charged) when the response arrives. Every step writes a
line to `events.jsonl` (the ledger) and a snapshot to `state.json` (the checkpoint). Pressing Ctrl-C trips
an `AbortController`; `--resume <runDir>` later rebuilds the run from the ledger and reuses whatever has a
terminal receipt (`job_succeeded` / `job_failed`). The review found four ways that story broke.

### Medium #1 — a paid response could be thrown away, then paid for again (`c7953e3`)

`ClaudeBridge.call` settled the budget and _then_ checked the abort signal. If Ctrl-C landed in that gap the
call threw, the coordinator wrote no receipt, and `--resume` bought the same job again. The same
settle-then-check pattern sat in `postMessage` (after the body was read), in `MockBridge`, and in the
coordinator after every worker/planner response.

Fix: `checkAbort` now runs only **before new work starts** (before a reservation, before a queued job
begins). Once a response has settled it is always returned and always persisted as a receipt, even while the
run is aborting. In the coordinator the abort check inside the worker loop remains only in the
bridge-_error_ catch (a request that never produced a response). Comments in `bridge.js` and `coordinator.js`
say why a check is absent at each spot.

### Medium #2 — `run_aborted` was written before the worker pool drained (`c7953e3`)

An abort listener appended `run_aborted` and checkpointed the instant the signal tripped, while in-flight
workers were still finishing. Results landing after that line contradicted the ledger's "final" event, and
the aborted checkpoint could omit successes that did land.

Fix: the listener is gone. `run()` awaits the phase pipeline; on abort, `runJobsConcurrently` finishes its
`Promise.allSettled` drain, pushes every landed result into `state.results`, and only then does
`recordAbort()` append one `run_aborted {reason, interruptedPhase}` and checkpoint. `run_aborted` is
therefore mechanically the last ledger line of that segment, and the shared `abortChecks` helper now asserts
exactly that plus "abort checkpoint carries every landed success".

### Medium #3 — checkpoints were not fsync'd, and a stale checkpoint could replay synthesis (`c7953e3`, `eb12ff5`)

`atomicWrite` (checkpoints, artifacts, run context) wrote a temp file and renamed it with no `fsync`, so a
crash could leave a `run_completed` line in the fsync'd ledger next to a `state.json` still saying
`synthesis`, and resume would buy synthesis again.

Fix: `atomicWrite` opens the temp file with mode `0o600`, fsyncs it, renames, then fsyncs the parent
directory (`fsyncDirectory`, best-effort on filesystems that refuse directory handles). On resume,
`run_completed` in the event log is authoritative: the completed state is rebuilt from `result.json` (written
just before the final checkpoint) and the stale checkpoint is repaired, with no model call.

Correction made during closure (`eb12ff5`): the Codex handoff's §6 pointed out that `run_completed` is
**also** written with `synthesisOk: false` when synthesis failed after every worker was paid for. My first
version treated any `run_completed` as "completed". The extracted `worker-resume.js` now reads
`synthesisOk`; when it is false the run is rebuilt as **partial** (with its `synthesisFailure`), the partial
checkpoint is repaired, and the coordinator points at `resume-synthesis.js` instead of declaring success. The
regression for this failed on the first version ("Missing expected rejection") before it passed.

### Medium #4 — resume was a second control plane inside a 936-line coordinator (`eb12ff5`)

`restoreWorkerPhase` rebuilt state, re-verified hashes, and then always re-entered the worker phase, so a run
aborted during synthesis replayed planning and recovery bookkeeping first.

Fix: restoration moved to `src/worker-resume.js` (`restoreWorkerRun` → `completed` / `partial` / `workers`,
every fingerprint, receipt, and artifact-confinement check ported unchanged). Document loading moved to
`src/documents.js`; `acceptedPlanHashes` to `plan-hash.js`; `parseWorkerOutput` to `worker-contract.js`.
`coordinator.js` (now 806 lines) is a phase dispatcher: `runPhases()` / `resumePhases()` call `planPhase`,
`workerPhase`, `recoveryPhase`, `synthesisPhase`, each of which skips its checkpoint and its work when the
ledger shows nothing pending. An abort during synthesis therefore resumes into synthesis only, and the
`worker_resume_started` event records `remaining: {plan: 0, recovery: null, synthesis: true}`.

## Tests added

All new tests were first run against the pre-fix source (`git stash push -- src/`) and failed, then passed
after the fix.

- `starlark-host/test/bridge.test.js` — "Claude adapter returns a settled response even when the signal
  aborts inside settle" (also: the next call on the aborted signal rejects with no new reservation).
- `starlark-host/test/ledger.test.js` (new file) — `atomicWrite` fsyncs `['file', 'directory']` in that order,
  mode `0o600`, no `.tmp` leftover; `RunLedger.checkpoint` and `writeArtifact` both go through it.
- `starlark-host/test/r11-recovery.test.js`:
  - `abortChecks` gained "run_aborted is the final ledger event (recorded after the pool drained)" and
    "abort checkpoint carries every landed success".
  - rewritten "cooperative abort: in-flight completions land receipts, run_aborted follows the drain, resume
    reuses them" (the old version expected late deterministic results to be **suppressed**).
  - "settled-then-aborted bridge call persists its receipt and is not re-bought on resume" — real
    `ClaudeBridge` against a local HTTP fake, `CostBudget` subclass that aborts inside `settle`.
  - "resume treats run_completed in the event log as authoritative over a stale checkpoint".
  - "abort during synthesis resumes into synthesis only, without replaying earlier phases".
  - "resume keeps a run partial when run_completed says synthesisOk:false behind a stale checkpoint".

## Codex §9 acceptance matrix — what is and is not covered

| Scenario (Codex handoff §9)                      | Status                                                                                                                                                         |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Abort immediately after successful settlement    | **Covered** — settled-then-aborted test: one receipt, resume makes no worker call for that job                                                                 |
| Completed but invalid worker output              | **Code path changed, no dedicated test** — `checkAbort` was removed from the failure-recording path, so a charged `job_failed` lands; not separately exercised |
| Mixed concurrency: completed call + pending      | **Covered** — cooperative-abort test (in-flight completions land, pending requests cancel) and "cancel under concurrency" (sockets destroyed, budgets drain)   |
| Final abort ordering                             | **Covered** — `abortChecks`: `run_aborted` is the last event; no `job_started`/`job_succeeded`/`job_failed` after it                                           |
| Aborted summary agrees with evidence             | **Covered for results** (checkpoint successes = `job_succeeded` count) and reservations (none stranded); `state.cost` equality with the ledger is not asserted |
| Repeated cancellation observation                | **Covered** — one `run_aborted` per segment, `recordAbort` idempotent, "no duplicate terminal job receipt"                                                     |
| Injected persistence/accounting failure          | **Not tested** — `atomicWrite` and settle errors propagate uncaught (not misclassified), but no test injects them                                              |
| Existing process/socket/resume tests still pass  | **Covered** — SIGTERM/SIGINT/SIGKILL + resume, both CLI entry points, recovery-phase interruption all green with original assertions                           |
| Nearby edge: `postMessage` check after body read | **Removed** (a body that arrived was paid for); not separately tested                                                                                          |
| Nearby edge: cap overrun settles before throwing | **Untouched** — remains a boundary; see below                                                                                                                  |

## Evidence (real output, this machine)

| Check                                                          | Result                                                                                        |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| New tests vs **unfixed** source (git stash probes, per commit) | each new test red; the synthesisOk test failed with "Missing expected rejection"              |
| `npm --prefix starlark-host test` after `c7953e3`              | 110 pass / 0 fail / **0 skipped** (evaluator built)                                           |
| `npm --prefix starlark-host test` after `eb12ff5`              | **111 pass / 0 fail / 0 skipped**                                                             |
| Full root `npm test`                                           | **1,105 pass / 0 fail / 1 pre-existing todo** (1,106 total)                                   |
| `npm run lint`                                                 | clean (three pre-existing `no-unused-vars` warnings in untouched Starlark files)              |
| `npm run check:docs`, `npm run format:check`                   | `check:docs` exit 0; `format:check` warns only on the three pre-existing handoffs named below |
| Go toolchain / evaluator                                       | `go1.26.8 darwin/arm64` on PATH; `starlark-host/bin/starlark-eval` built 2026-09-16 by Alan   |

`format:check` still warns on three pre-existing handoff `.md` files from other threads
(`HANDOFF-golden-eval-he06-thermo-nuclear-2026-09-06.md`, `HANDOFF-permission-cache-thermo-nuclear-2026-09-07.md`)
plus `HANDOFF-starlark-r11-thermo-nuclear-2026-09-06.md`, which was bannered here but deliberately not
reformatted so its findings text stays byte-identical below the banner.

## Boundaries that remain (do not read this closure as more than it is)

- A request that was **in flight** when the abort landed still has unknown upstream billing and is
  deliberately eligible to run again on resume (at-least-once, per the review's "not bugs").
- **SIGKILL or power loss** between settle and receipt cannot be handled; fsync narrows the window for
  checkpoints, it does not make several writes one transaction.
- A campaign **cap overrun** records accounting before it throws (`CostBudget.settle`); not changed here.
- **Planner and map-reduce synthesis** partial-output persistence is not proven by these worker-level tests.
  Synthesis-only resume is proven for the single-call strategy.
- A lost checkpoint **after a successful `resume-synthesis`** is not reconstructed from
  `synthesis_resume_completed`; the run would look partial and `resume-synthesis` would run again.
- Multiple writers to one run directory remain unsupported.

## Deliberately not done

- **Low #5–#8** from the review (preserve SIGINT/SIGTERM exit codes in `run-experiment.js`, shared safe
  artifact name, named torn-line error, evaluator child on the run signal). Ranked below the Mediums;
  cheap follow-ups, not blockers. Do not skip torn ledger lines when doing Low #7.
- `HANDOFF-starlark-r11-2026-09-06.html` — it never carried the OPEN banner, so it was not edited; the
  `.md` is the entry.
- The "may double-spend" sentence in `HANDOFF-context-layer-mediums-closed-2026-09-10.md` — historical
  record of that date, left as written.
- `CODEX-TASK-starlark-r11-2026-09-06.md` stays at the root until Alan accepts, then archive it.
- No live smoke run. The deterministic boundary tests are the evidence; a live trial would not add proof
  of the settle-then-abort window and would spend money.
- No runner edge (R8 holds), no edits under `src/runner/**`, `src/credentials.js`, `src/proxy.js`,
  `src/server.js`, or `src/interceptors/**`.

## Handoff fields

- **Folder/branch:** `/Users/alanman/Developer/claude-local-bridge-playground`, `main`, `origin` = playground.
  Local commits were rebased onto Codex's `da253bf` before pushing; no force push.
- **Commits:** `c7953e3` (Medium #1–#3 + tests + `starlark-host/README.md`), `eb12ff5` (Medium #4 +
  synthesisOk correction + tests), plus the closure commit carrying this file, the banners, the `CLAUDE.md`
  pointer, and the primer addendum.
- **Files changed (code):** `starlark-host/src/{bridge,coordinator,ledger,plan-hash,worker-contract}.js`,
  new `starlark-host/src/{documents,worker-resume}.js`, `starlark-host/test/{bridge,r11-recovery}.test.js`,
  new `starlark-host/test/ledger.test.js`, `starlark-host/README.md`.
- **Files changed (docs):** this file; banners on `HANDOFF-starlark-r11-thermo-nuclear-2026-09-06.md`,
  `HANDOFF-starlark-r11-2026-09-06.md`, `HANDOFF-starlark-abort-commit-next-slice-2026-09-16.{md,html}`;
  `CLAUDE.md` (Starlark bullet, machine facts); `docs/starlark-worker-answers-agent-primer-2026-09-10.{md,html}`
  (dated fsync addendum).
- **Checks run / skipped:** see Evidence. Skipped: live model runs (not needed), browser rendering of the
  edited `.html` files (structural edit only).
- **Risks / next:** Low #5–#8 open; the two "no dedicated test" rows in the acceptance matrix are the
  cheapest hardening. Per the team charter, landed Starlark code should get one Cursor invariant review of
  `da253bf..HEAD`.
