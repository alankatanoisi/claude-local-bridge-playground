# Handoff — Thermo-nuclear review of `84dd73a^..406423b` (Starlark R11/R14)

**Written:** 2026-09-06. Review only; no Starlark or runner code changed (this
file + a banner on the thread-entry handoff).
**Scope:** already-landed playground `main` range `84dd73a^..406423b`:

- `84dd73a` `feat(starlark-host): add abortable worker resume and golden plan evidence (R11/R14)`
- `406423b` `docs: add Starlark R11 thread-entry handoff and HTML companion`

No feature branch. No pull request for this range — do not invent one.
**Prior:** `HANDOFF-starlark-r11-2026-09-06.md` remains the build and test-gate
record. This file is the audit of that range's **code**.
**Sibling:** the same day’s context-layer review of the wider range
`19c2a69^..2da8066` (this Starlark commit sat inside it) is
[`HANDOFF-context-layer-thermo-nuclear-2026-09-06.md`](HANDOFF-context-layer-thermo-nuclear-2026-09-06.md).
That file's unique Mediums are the headline index lying after a checkpoint
discards stubs, and the index being able to trip `context_ceiling_unrecoverable`.
Starlark abort/resume findings overlap; **this file is the implementing
record for Starlark.** The overlapping range review asked whether
`restoreWorkerPhase` should skip a torn last events line. That is **not
a bug** (dropping a truncated `job_succeeded` would re-pay). Low #7 is
only “name the error.” [Starlark R11 correctness audit](1e63a0ee-4fe0-4f5b-9ba7-ae933a50feb9)
independently confirmed Medium #1 (settle then abort) at the same lines;
overlap is treated as higher-confidence, not a second bug. That pass also
adds Low #8 (evaluator child not on the run signal).

R8 (recommendation 8: keep Starlark as its own lab, no runner
`run_workflow` tool) holds: the range does not touch `src/runner/**`. The
slice is still safety-adjacent because abort + resume can duplicate live
spend or skip work.

Folder: `/Users/alanman/Developer/claude-local-bridge-playground`, branch
`main`, `origin` = playground. `coordinator.js` grew 622 → 874 lines (still
under 1,000).

## Findings (in-scope for `84dd73a` only)

No High findings. The abort plumbing is real (fetch `AbortSignal`,
`Promise.allSettled` drain, no `process.exit` on SIGINT/SIGTERM), resume
replays accepted plans and terminal receipts, and the R11 tests actually
kill child processes and resume them. The gaps below are where those two
contracts fight each other, and where durability is uneven.

SIGINT is the interrupt signal from Control–C. SIGTERM is a polite “please
stop” signal. SIGKILL is an immediate kill the process cannot handle. An
AbortController is a host-owned stop switch; aborting it should cancel
in-flight HTTP and stop the worker queue from taking new jobs.

### Medium

1. **A completed, paid bridge call can be thrown away, then paid again on
   resume.**
   `starlark-host/src/bridge.js` 160–181: after `postMessage` returns,
   `ClaudeBridge.call` **settles** the budget reservation (the call is
   charged) and only then `checkAbort(signal)` before returning the text.
   `starlark-host/src/coordinator.js` 643–675: if that throw happens,
   `runJobs` never reaches `job_succeeded`. Resume treats a
   `job_started` without a terminal receipt as “execute again”
   (`coordinator.js` 627–630).
   That is a larger at-least-once window than “the HTTP request was still
   in flight.” Ctrl–C during `response.text()` / after the body is already
   in memory still spends, records no success, and `--resume` spends
   again. Mock/deterministic tests cannot catch this: they are $0 and the
   cooperative-abort test *wants* late completions suppressed
   (`test/r11-recovery.test.js` 85–110, 60–64).
   Live smoke was skipped ($0), so this path is unproven against a real
   campaign ledger.
   Fix: if `settle` ran, return the result to `runJobs` and persist
   `job_succeeded` (or a charged terminal receipt) **before** honoring
   abort. `checkAbort` belongs before *starting* a call and before taking
   the next queue item, not after a completed settle. See also Medium #2;
   they are one protocol.

2. **`run_aborted` is written before the worker pool drains, so the ledger
   invariant “no results after abort” is not mechanical.**
   `coordinator.js` 103–117: `run()` adds `onAbort → recordAbort()`
   immediately. `recordAbort` (`120–127`) sets `phase: aborted`, appends
   `run_aborted`, and checkpoints **while** `mapConcurrent`
   (`844–861`) is still awaiting in-flight `fn` bodies.
   Two outcomes, both bad:

   - A worker that already passed `checkAbort` at 675 can still
     `writeArtifact` + `job_succeeded` at 680–689 *after* `run_aborted`.
     Resume would reuse that late success (lucky), but the R11 predicate
     `no job starts or results after abort` (`r11-recovery.test.js` 60–64)
     is then a race, not a guarantee.
   - A worker that hits `checkAbort` after a completed `execute()` throws
     and hits Medium #1.

   The catch path after `runPhases()` already waits for drain, then
   `recordAbort` (idempotent). The listener’s early write is the extra
   path. SIGKILL-soon-after-SIGINT is the charitable reason for it; it is
   also what creates the race. A related symptom: `state.results` is only
   filled after `runJobs` returns (`210–212`), so a CLI abort summary can
   show zero successes while `events.jsonl` already has `job_succeeded`.
   Resume still rebuilds from the ledger.
   Fix: do not append `run_aborted` from the signal listener. Let in-flight
   work that already completed commit. Record abort once, after
   `Promise.allSettled` returns. Keep the listener only if you need a
   best-effort `state.json` hint, and treat events — not that hint — as
   truth on resume.

3. **Event appends are fsync’d; checkpoints are not.**
   `starlark-host/src/ledger.js` 31–40 (new in this slice): each
   `append` opens, writes, `fsync`s, closes. `checkpoint` / `atomicWrite`
   (`51–59`) still `writeFileSync` + `renameSync` with no fsync of the temp
   file or the directory. Resume’s first act is
   `JSON.parse(fs.readFileSync(this.ledger.statePath))`
   (`coordinator.js` 333, 344). After SIGKILL, `events.jsonl` can be ahead
   of `state.json`. If a `completed` checkpoint is the line that is lost,
   `restoreWorkerPhase` will not take the completed early-return
   (`345`) and `runPhases` will walk through to synthesis again
   (`288–303`) — another duplicate-spend shape, this time for the
   synthesis call. The SIGKILL+resume test
   (`r11-recovery.test.js` 300–302) covers job receipts from events, not
   “lost completed checkpoint.”
   Fix: fsync the temp file and the parent directory in `atomicWrite`, the
   same discipline as `append`. Optionally: treat `run_completed` in the
   event log as authoritative even when `state.json` is stale.

4. **`restoreWorkerPhase` is a second control plane inside
   `PhasedCoordinator`, and resume is “replay every phase” rather than a
   phase dispatcher.**
   `coordinator.js` 332–447 is ~116 new lines of ledger forensics, path
   confinement, hash checks, and receipt rebuild, inlined into a file that
   just jumped 622 → 874. `runPhases` (`129–330`) on resume still sets
   `phase = 'planning'` (`165`), re-walks workers and recovery, then always
   calls `runSynthesis` (`294–303`). Abort during synthesis therefore uses
   worker-resume, not `resume-synthesis.js` (the `partial` +
   `synthesisFailure` throw at 346–347 never fires because abort never
   sets `synthesisFailure`). The next abort/resume slice will cross 1,000
   lines if this stays here.
   This is a maintainability finding with a correctness consequence
   (Medium #1 and #3 are harder to see because resume has no explicit
   “already past workers → only synthesis” arm).
   Fix: extract `restoreWorkerPhase` + `acceptedHashes` verification into
   `starlark-host/src/worker-resume.js`. Then make `run({ resume })` branch
   on the restored phase instead of replaying the whole pipeline with
   caches. Do not “just add comments.”

### Low

5. **A failed matrix entry overwrites the SIGINT/SIGTERM exit code.**
   `starlark-host/src/run-abort.js` 19–22 sets `process.exitCode` to 130
   (SIGINT) or 143 (SIGTERM) and does not call `process.exit`.
   `starlark-host/bin/run-experiment.js` 137–159: a previous model in the
   loop can set `failedRuns`, and after the aborted run
   `if (failedRuns) process.exitCode = 1` replaces 130/143.
   Successful abort on `run-workflow.js` returns from `coordinator.run()`
   without throwing, so 130/143 stick there. `run-workflow.js` 69–72 still
   sets `process.exitCode = 1` if `main()` throws *after* the handler ran
   (hash mismatch mid-Ctrl-C, and so on). Operators then see a generic
   failure. The R11 child tests only spawn `run-workflow.js` for
   SIGINT/SIGTERM (`r11-recovery.test.js` 167, 193–200) on the clean abort
   path.
   Fix: if `controller.signal.aborted`, do not clobber `process.exitCode`.

6. **Resume opens input artifacts with the unsanitized `document.id`;
   writers sanitize.**
   `ledger.js` 44–48: `writeArtifact` maps names through
   `[^a-zA-Z0-9._-]` → `_`. `coordinator.js` 353–356: resume does
   `path.join(this.ledger.artifactDir, \`input-${document.id}.json\`)`
   from the `run_started` payload. Host collectors today emit safe ids
   (`repo_` + 12 hex chars in `repo-manifest.js` 88–90; fixture `docN`).
   A `..` inside an id would write `input-.._….json` and try to read a
   different path on resume (fail closed or a sibling under `runDir`).
   Not a remote issue. Fix: share one `safeArtifactName()` used by both
   write and resume.

7. **A torn last events line fails closed with a raw `SyntaxError`.**
   Overlapping-range review (`19c2a69^..2da8066`) asked to skip that
   line the way `ledger.js` 18–26 skips it when recovering `seq`. Do
   **not** skip it on resume: a truncated `job_succeeded` would look
   like “never completed” and Medium #1’s duplicate-spend window would
   get worse. The coordinator comment at 334–335 is the invariant.
   What *is* a bug is the operator experience: `JSON.parse` throws
   `SyntaxError: Unexpected end of JSON input` with no path, no seq,
   and no “last good event was job_succeeded seq=N”.
   Fix: catch a parse failure on the **last** non-empty line only;
   throw a named error (`events.jsonl` trailing line torn, last good
   seq). Still refuse resume. Still fail closed on a bad line in the
   middle.

8. **The Starlark evaluator child is not on the run `AbortSignal`.**
   This slice wrapped `evaluateStarlark` with `checkAbort`
   (`coordinator.js` 585–607) but `starlark.js` 29–30 still `spawn`s
   `starlark-eval` with no `signal`. `AbortController.abort()` and
   SIGTERM aimed at the Node PID do not kill that child; abort+flush
   waits until Go’s own `timeout_ms`. Interactive Ctrl-C often SIGINT’s
   the process group, so this is mainly SIGTERM / embedded abort during
   planning. Default CLI plan source is still `starlark`; R11 process-kill
   tests used `host_json`, so they never hit this spawn.
   Fix: pass `signal` into `evaluateStarlark` and `child.kill` on abort.
   Do not widen evaluator policy. Skip if Alan only cares about
   `host_json` lab runs.

## Not bugs (do not fix)

- **Missing `plan.hashes` fail-open** (`coordinator.js` 364–368, 434).
  Older pre-R11 evidence is still resumable by design. `validateJobs` still
  runs. Hashes are an integrity check of a user-owned run folder, not an
  auth boundary. Do not fail closed on missing hashes unless Alan wants to
  drop pre-hash resume.
- **At-least-once for `job_started` without a terminal receipt.** That is
  the documented resume rule for work that was actually interrupted
  mid-call. Medium #1 is the *completed-then-dropped* enlargement of that
  rule, not the rule itself.
- **No `process.exit()` in the SIGINT/SIGTERM handler.** Trip-and-flush so
  budget `release` can finish. Keep it.
- **R8 / no runner `run_workflow` tool.** Confirmed: this range only
  touches `starlark-host/**` plus the two root handoff files. Do not add a
  runner edge while “fixing” abort.
- **Evaluator tests skip when `starlark-eval` is missing**
  (`test/helpers/evaluator-required.js`). Skip, not weaken: the test body
  is unchanged. Installing the binary re-enables it.
- **Live smoke skipped.** Residual, not a defect in the skip.
- **SIGKILL has no handler.** True of the operating system. The SIGKILL
  test is “resume after an unclean stop,” not “flush on SIGKILL.”
- **Single writer per run directory.** Untested concurrent resume is out
  of scope; do not add a lock unless Alan asks.
- **`checkAbort` sprinkled through `generateValidatedPlan` / `runJobs`.**
  That is the abort design, not spaghetti. Do not wrap it in a magic
  proxy.
- **`run-abort.js` (33 lines) and `plan-hash.js` (27 lines).** They earn
  their keep. Do not inline them back into `coordinator.js`.
- **Golden descriptor JSON snapshots.** The right test shape for “the host
  JSON planner’s accepted jobs.” Do not regenerate them from a live run.
- **Bridge test empty-body diagnostic** (`test/bridge.test.js`). Extra
  assertion before `JSON.parse`; it does not weaken the original check.
- **Canonical JSON dropping `undefined` keys** (`plan-hash.js` 13).
  Correct for hashing; array order is preserved (tested).
- **`fetch` + `AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])`**
  (`bridge.js` 213). This is the right way to abort the socket. Keep it.
- **Docs commit `406423b`.** Pointers only; no runtime.
- **Torn JSONL fails closed on resume** (`coordinator.js` 336–340 vs
  ledger constructor 18–25). The constructor skips a bad line only to
  recover `seq`. Resume `JSON.parse`s every line so a truncated
  `job_succeeded` cannot be dropped and later re-executed. Do not skip
  the last line. Low #7 is only “name the error.”
- **Recovery `failedJobIds` on resume includes every retryable
  `job_failed`** (`coordinator.js` 372–384), not only the initial phase.
  The validator only requires `retry_of` ∈ that list, so this is looser,
  not a false reject. Integrity still goes through `acceptedHashes`.
- **`recordAbort` twice** (listener + catch). Idempotent via
  `phase === 'aborted'`. Keep it; Medium #2 is the *early ledger write*,
  not the double call.

## Recommended fix order

1. **Medium #1 + #2 together** (one abort-commit protocol). Persist
   settled work; record `run_aborted` after drain; `checkAbort` only before
   new work. Update `r11-recovery.test.js` cooperative-abort so a provider
   that *already produced a result* is allowed to land a receipt, and so
   `run_aborted` is the last worker-phase event. Add a unit test where
   `ClaudeBridge.call` settles, then the signal is aborted, then resume
   does **not** call the bridge for that job.
2. **Medium #3** — fsync in `atomicWrite`. Extend the SIGKILL test (or a
   smaller unit test of `atomicWrite`) so a completed checkpoint survives
   a kill, or so `run_completed` in events makes resume a no-op even with
   a stale `state.json`.
3. **Medium #4** — extract `worker-resume.js` and stop replaying synthesis
   after a workers-complete abort. Can land with #1–#2 if the extract makes
   the protocol obvious; otherwise immediately after.
4. **Low #5** — preserve 130/143 in `run-experiment.js`.
5. **Low #6** — shared safe artifact name. Optional same slice.
6. **Low #7** — named torn-line error on resume. Do not skip the line.
7. **Low #8** — pass `signal` into `evaluateStarlark` only if default
   Starlark + SIGTERM during planning matters.

Do not start with the extract if it delays #1. Do not “fix” hash fail-open,
skip torn events lines, or add a runner edge.

## Pointers for the implementing agent

- Preflight: playground folder
  `/Users/alanman/Developer/claude-local-bridge-playground`, branch
  `main`, `origin` = `alankatanoisi/claude-local-bridge-playground`.
  Pull `--ff-only` if the tree is clean. Do not start from the canonical
  repo. Do not start if another agent holds the working tree.
- This is lab code under `starlark-host/`. Keep R8: no `run_workflow` in
  `src/runner/**`. Do not edit `src/credentials.js`, `src/proxy.js`,
  `src/server.js`.
- `checkAbort` is `signal?.throwIfAborted()` (`run-abort.js` 9–11). Node’s
  `AbortError` is what `run()`’s `if (!this.signal.aborted) throw error`
  (`coordinator.js` 108–109) is filtering.
- Campaign budget `release` on fetch failure is already correct
  (`bridge.js` 160–162). Do not “fix” that path. The bug is settle-then-
  throw, not release-on-abort.
- `resumeWorkerRun` live guards (`workflow-runner.js` 183–212) already
  refuse mode/cap/campaign drift and a missing campaign ledger. Tests in
  `plan-hash.test.js` 103–152 cover those refusals. Leave them.
- Targeted tests after a fix:
  `npm --prefix starlark-host test -- test/r11-recovery.test.js test/plan-hash.test.js test/bridge.test.js`
  Then full `npm --prefix starlark-host test`, then repo `npm test` /
  `npm run lint`. This machine still has no Go toolchain; evaluator tests
  should stay skips, not new failures.
- Thread entry after a fix: banner
  `HANDOFF-starlark-r11-2026-09-06.md` again and close the findings in
  **this** file (same pattern as
  `HANDOFF-acp-ask-user-question-thermo-nuclear-2026-08-31.md`).
- Commit/push only if Alan asks.

## Suggested commit shape (if asked)

One commit is enough for Medium #1–#3:
`fix(starlark-host): persist settled work on abort and fsync checkpoints`.
Low #5–#8 can ride along or wait.
