# Handoff — Cursor invariant review of the Starlark resume branch (2026-10-20)

> **Status: review only.** No Starlark code was changed. This file and its
> [browser companion](HANDOFF-starlark-thermo-nuclear-2026-10-20.html) are the review of record for the
> range below. They are **not** an implementation record. Alan decides what to fix and whether the branch
> moves to playground `main`. Live spend: **$0** (no model calls of any kind).

**Range reviewed:** branch `codex/starlark-resume-2020-2026-09-26`, `1e06820..2596b2c`.
That is runtime commit `da42e7a` (`starlark: reconcile planner resume and cancellation evidence`) plus the
two documentation commits `cb5f6d0` and `2596b2c`. Base `1e06820` is the `main` commit the branch was cut
from on 2026-09-26.

**Thread entry being answered:** [`HANDOFF-starlark-cursor-review-2026-09-27.md`](HANDOFF-starlark-cursor-review-2026-09-27.md).
Build/verification record: [`HANDOFF-starlark-reconciliation-2026-09-27.md`](HANDOFF-starlark-reconciliation-2026-09-27.md).
Original findings: [`HANDOFF-starlark-r11-thermo-nuclear-2026-09-06.md`](HANDOFF-starlark-r11-thermo-nuclear-2026-09-06.md)
(Low #5–#8). Owner decision on Low #8: option 2 (Codex's design), recorded in
[`HANDOFF-starlark-laptop-transfer-2026-09-26.md`](HANDOFF-starlark-laptop-transfer-2026-09-26.md) §1.

## 1. Plain-language summary (for Alan)

The branch does what it set out to do on its main path. When a stop (Ctrl-C or SIGTERM, the "please stop"
signal another program sends) lands while the host is checking the planner's paid answer, the answer is
kept, and `--resume` re-checks that same answer without paying the planner again. Every way of tampering
with the saved evidence that I tried is refused before anything is written. The three small fixes (Low #5
exit codes, Low #6 shared file names, Low #7 named "torn last line" error) are correct, with one gap in
Low #5.

It is **not ready to move to `main` as-is**. Two real problems share one cause. The code decides "was this
the model's fault or the computer's fault?" by asking "is a stop pending?" and "which `catch` block am I
in?". Those are the wrong questions:

- With a **planner ladder** (cheap model first, stronger model if the cheap one fails twice), a disk write
  failure makes the host pay for a fresh answer from the **more expensive** model (Medium #1).
- A program the host would normally reject, arriving at the same moment as a stop, now **crashes the
  run** instead of being recorded as a rejection followed by a clean stop. `main` handles this correctly
  today (Medium #2).

One small fix (label the model's mistakes explicitly; treat everything else as a computer problem) closes
both. Three Low items are cheap to fix in the same slice.

What the branch buys you in practice, measured here: for a **valid** plan, `main` already keeps the paid
answer when you stop during the check (the check finishes within its 2-second cap, the plan is accepted,
and resume works with zero new planner calls). The branch stops sooner instead of up to 2 s later, and it
also makes "stopped while checking a plan that would have been rejected" resumable. `main` refuses that
resume.

## 2. Was there Starlark work after 2026-09-26?

Checked on GitHub (`origin`) on 2026-10-20:

- `main` has **no** commit touching `starlark-host/` since the branch was cut (18 newer `main` commits,
  all outside `starlark-host/`).
- No other branch touches `starlark-host/` after 2026-09-20 except this branch's `da42e7a`.
- Later `main` commits that mention Starlark are status audits and docs only (2026-09-30 audits,
  2026-10-02 T3 docs).
- The branch merges into current `main` without conflicts (`git merge-tree`), and the Starlark suite
  passes 151/151 on that merged tree.
- **Not checked (cannot see from here):** the stash on the 2020 laptop that the 09-27 brief says to keep,
  and any uncommitted work on either laptop.

## 3. Findings

### Medium

**1. With a planner ladder, a storage failure still buys a new planner response, now from the pricier tier.**

Claim (4) of the reconciliation was "a storage failure remains a storage failure and cannot become a model
rejection or trigger another purchase". The accepted-artifact and acceptance-event writes did move out of
the inner validation `catch` (`starlark-host/src/coordinator.js` 635–647). But they now throw into the
**ladder** `catch` in `generateValidatedPlan` (`coordinator.js` 498–512), which treats any non-abort error
as "this tier failed": it adds 2 to `totalAttempts`, appends `plan_escalated`, and calls the next tier.

Reproduced (scratch script, ladder `['cheap','strong']`, first write of `plan-source-accepted` fails):

| Tree             | Planner calls         | Events                                                                                 | Final plan model |
| ---------------- | --------------------- | -------------------------------------------------------------------------------------- | ---------------- |
| `main` `1e06820` | `cheap:1`, `cheap:2`  | `plan_rejected`, `plan_validated`                                                      | `cheap`          |
| branch `2596b2c` | `cheap:1`, `strong:1` | `plan_response_received`, `plan_escalated`, `plan_response_received`, `plan_validated` | `strong`         |

So both trees pay twice. `main` pays for a same-tier repair; the branch pays the stronger tier, and recovery
and synthesis then also run on that tier. The same happens if the new `_response_received` artifact or
append fails (`coordinator.js` 558–570) or the `_lint_repaired` append fails (578).

The test meant to pin this, `accepted-source storage failure is not reported as model rejection or retried`
(`starlark-host/test/planner-resume.test.js` 84), passes with a **single-tier** ladder, where escalation has
nowhere to go. It is a false green for ladders.

Reach: ladders are opt-in (`bin/run-workflow.js --planner-ladder`). `run-experiment.js` never passes one.

**2. A genuine rejection that coincides with a stop now crashes the run (regression from `main`).**

`coordinator.js` 610–619: in the validation `catch`, `if (this.signal.aborted)` rethrows **any** error that
is not the cancellation itself, raw. That includes the model's own failures: pre-lint diagnostics,
`validateJobs` errors, and evaluator-reported program failures. The comment directly below (620–622,
"record it even when an abort is pending") now describes code that cannot run in that case.

Reproduced (scratch probe): the stop lands while the planner response settles (the Medium #1 window from
2026-09-06), and the returned program fails pre-lint (`while True:`).

| Tree   | Outcome                                             | Events                                        |
| ------ | --------------------------------------------------- | --------------------------------------------- |
| `main` | returns `aborted`                                   | `run_started`, `plan_rejected`, `run_aborted` |
| branch | **throws** `Starlark pre-lint rejected the program` | `run_started`, `plan_response_received`       |

No money is lost: the receipt stays pending, and resume re-rejects it before one legitimate repair. What
goes wrong is the record and the operator experience. There is no `plan_rejected` and no `run_aborted`,
the run is reported as failed with a model error, and in `run-workflow.js` and `--resume` the exit code
becomes 1 instead of 130/143 (see Low #3).

Other ways to reach the same crash (from the second reviewer, reasoning checked): the evaluator child exits
just before the stop, so Node's `child.kill()` returns false and no `AbortError` is emitted, and its result
then fails `validateJobs` while the signal is aborted.

The test `an unrelated evaluator failure during cancellation stays visible and is not a model rejection`
(`planner-resume.test.js` 65) pins half of the intended contract. It injects a generic `Error` from the
evaluator, which the current code has no way to tell apart from a program failure.

**Shared root cause and the one fix for #1 and #2.** "Is a stop pending?" and "which `catch` am I in?" are
standing in for the real question: _is this error a verdict on the model's program, or a host failure?_
Make that explicit:

- Mark verdict errors at their source: pre-lint diagnostics, `validateJobs` failures, and evaluator
  responses with `ok: false` (runtime error, step limit, time limit) plus the output-size ceiling. A small
  `PlanRejection` class or an `error.verdict = true` flag both work.
- Only verdicts may append `<phase>_rejected`, feed `repairSuffix`, or count toward escalation, whether or
  not a stop is pending. So a verdict is still recorded during a stop, as on `main`.
- Cancellation (`isRunCancellation`) appends `<phase>_evaluation_interrupted` and rethrows.
- Everything else (spawn errors, non-zero evaluator exit with no JSON, storage, accounting) rethrows
  untouched from **both** catches. Never escalate, never repair.

Tests to add: a two-tier version of the storage test (expect a throw, one `cheap` call, no
`plan_escalated`); the "stop at settlement + pre-lint failure" case above (expect `plan_rejected` then
`run_aborted`, phase `aborted`); and an `ok: false` evaluator result while aborted (expect a rejection to be
recorded). Update the `unrelated evaluator failure` test so its injected error is clearly a host error (for
example `code: 'EIO'`), not an anonymous `Error`.

Side benefit (currently a pre-existing behavior, see §5): a missing or crashing evaluator binary would stop
being recorded as a model rejection that buys repairs.

### Low

**3. Low #5 is closed only for the matrix loop.** The original fix rule was "if `controller.signal.aborted`,
do not clobber `process.exitCode`". `applyFailedRunExitCode` (`starlark-host/src/run-abort.js` 37–39) applies
it in `run-experiment.js`'s matrix loop and is correct there. `bin/run-workflow.js` 69–72 and the `--resume`
path of `run-experiment.js` (23–41, then 229–232) still set `exitCode = 1` whenever `main()` throws after a
signal. The original review named the `run-workflow.js` case explicitly. This branch also makes that path
**more** reachable: claim (3) deliberately turns "host error plus stop" into a thrown error, and Medium #2
and Low #4 throw too. Fix: in both `main().catch` handlers, keep 130/143 when the controller's signal
aborted (export the controller or check `process.exitCode` already being 130/143), plus one child-process
test on `run-workflow.js`.

**4. An unhandled `EPIPE` crashes the process when a stop kills the evaluator before it reads its input.**
`starlark-host/src/starlark.js` 35 now passes `signal` to `spawn`. If the signal is already aborted, Node
kills the child on the next tick, but `child.stdin.end(payload)` (76–84) has no `'error'` listener. When the
payload is bigger than the pipe buffer, the write fails and Node throws.

Reproduced (scratch probe, 300 KB objective, stop at settlement): branch writes `run_aborted`, then dies
with `Error: write EPIPE … Unhandled 'error' event` and exit code 1. The command-line summary is lost.
`main` exits cleanly. Today's real payloads (document metadata and roughly 3,000 tokens of source) are
probably under 64 KB, so this is latent. Fix: `child.stdin.on('error', () => {})` (the `close`/`error`
handlers already settle the promise), plus one test with a large payload and a pre-aborted signal.

**5. The new real-child matrix tests write into the real `starlark-host/runs/` folder and can hang.**
`starlark-host/test/run-abort.test.js` 47–103 spawns the real `run-experiment.js --mode mock --matrix`. Its
first, failing matrix entry goes through `makeRunDir` (`bin/run-experiment.js` 191–198) and writes
`run_failed` into `starlark-host/runs/`. That folder is gitignored and holds Alan's real, sensitive run
evidence. Measured: `main`'s Starlark suite adds 0 folders there; the branch's adds **4 per run** (the
reviewer's loops here produced 339, since deleted).

Separately, `ready` (lines 90–96) only rejects on `'error'`. If the child exits early, the test ends with
`Promise resolution is still pending but the event loop has already resolved` instead of a clear failure.
Reproduced: 2 of 48 runs failed when six copies of the eight-file focused set ran at once. The cause is a
same-millisecond run-folder name collision: `mkdirSync(..., { recursive: false })` gives `EEXIST`, confirmed
by launching 12 copies of the preload at once. The test also silently needs at least 2 planner models in
`experiment.config.json`.

Fix: give the child a temporary run root (an environment variable or flag read by `makeRunDir`, defaulting
to today's folder), make `ready` reject on `close`, and assert the planner-model count up front.

**6. Structure: one rule, three copies.**

- The planner evaluation fingerprint is computed at `coordinator.js` 475, 538, and `worker-resume.js`
  225–248.
- The recovery policy is built at `coordinator.js` 313–318 and `worker-resume.js` 231–237.
- Artifact confinement is a second copy in `planner-response.js` 33–43 (the first is
  `worker-resume.js` 64–72).

Today the copies agree (checked: failures order, canonical JSON drops `undefined` alike). Drift fails
closed, so the cost is a resume that refuses for no good reason, not lost money. Move
`plannerEvaluationHash({ phase, context, policy })`, `recoveryPolicy(policy, failures)` and
`readConfinedArtifact(ledger, relativePath)` into one module (`planner-response.js` fits) and call it from
both sides.

Two smaller cleanups for the same pass:

- The receipt's `rejection` field (`coordinator.js` 531, 569) copies the full rejected source into
  `events.jsonl`, but it is never used. A replayed attempt never calls the model, so `repairSuffix` is
  discarded. Drop it.
- The coordinator's own integrity check (472–478) runs after `worker_resume_started` (214) and the planning
  checkpoint (237). Today it cannot fire, because `restoreWorkerRun` checks first. Keep the
  `worker-resume.js` check, which is the one that honors "refuse before appending", and delete or demote the
  coordinator copy once both sides use the shared helper.

**7. Docs owed at merge time.** The branch does not update the `CLAUDE.md` Starlark bullet (still "Low #5–#8
still open"), the banner on `HANDOFF-starlark-r11-thermo-nuclear-2026-09-06.md`, or
`HANDOFF-starlark-lows-review-2026-09-26.md`. Fable's 2026-09-26 review asked for these in the same change.
Do them in the commit that lands on `main`, not on this branch (`main`'s `CLAUDE.md` has moved since the
branch was cut).

## 4. Not bugs (do not fix)

- **At-least-once for in-flight calls.** A stop during the planner's own network call leaves no receipt, so
  that response is not resumable. Same as `main`, and stated in the README ("durability begins after the
  artifact and receipt are persisted").
- **Resume refuses when the newest receipt already has a verdict and no plan was accepted** (for example a
  stop during the attempt-2 repair call). Same as `main`. Changing it means a new "continue planning" resume
  arm, which is out of scope.
- **`RunLedger`'s constructor now refuses a torn line** (`ledger.js` 25–53, 68). This is correct and
  protective: appending after a torn fragment would glue new JSON onto it and corrupt a middle line. Fresh
  runs never hit it. `evaluation-harness.js`'s lenient reader is scoring-only and predates the branch.
- **A bad middle line stays a raw `SyntaxError`.** That is exactly what Low #7 specified.
- **`safeArtifactName` collisions** (`"a b"` and `"a_b"`) fail closed through the input fingerprint. Host
  collectors emit `repo_` + hex ids.
- **Forwarding the run signal to the evaluator child.** Checked on Node 22: the `AbortError`'s `cause` is
  the signal's reason, it fires before `close`, and the second `reject` on `close` is harmless. Keep it;
  only add the `stdin` listener (Low #4).
- **The `evaluatePlan` constructor seam.** Test-only, defaults to the real evaluator. Fine.
- **Receipts in `events.jsonl` contain model output.** `runs/` is already gitignored and treated as
  sensitive. (Dropping the unused `rejection` field still halves the duplication.)
- **Scope.** The diff stays inside `starlark-host/` plus four root handoff files. No `src/runner/**`, bridge,
  or auth edits. R8 (recommendation 8: Starlark stays a separate lab with no runner tool) holds.
- **The receipt's `artifact` path is not pinned to `<phase>-source-attempt-<n>.json`.** The source hash
  still guards the bytes, and changing the field needs write access to the run folder, which is inside the
  trust boundary. Metrics-only.

## 5. Unresolved observations

- **The exit-137 run with "2 requests instead of 1" (2026-09-27) was not reproduced.** Here: 25 serial plus
  48 parallel runs of the eight-file focused set, and several full suites. `abort-commit-boundaries.test.js`,
  where that assertion lives, is **unchanged** by this branch and passes on `main`. Its fake servers listen
  on port 0 (a fresh random port each time), and the bridge client has no retry. The one flake that did
  reproduce is a different one (Low #5). Best current lead, unproven: the stray-loopback-request hazard
  noted in `HANDOFF-starlark-lows-review-2026-09-26.md` ("stray `GET /` during an alternate-reporter run"),
  where a leftover client from another process reaches a recycled port. Exit 137 means "killed by SIGKILL"
  and may have come from the tool sandbox that ran the command. To make the next occurrence diagnosable,
  have the fake servers count only `POST /v1/messages` and print every request's method and path in the
  assertion message.
- **Pre-existing, not introduced here (`main` behaves the same):**
  - A missing or crashing evaluator binary is recorded as a model rejection and buys repairs. The Medium
    #1/#2 fix closes this as a side effect.
  - `extractStarlark` throws on an empty planner reply before any receipt is written
    (`coordinator.js` 554). The paid response is lost and the run crashes.
  - Worker-job artifacts on resume are confined by path text only (`worker-resume.js` 189–191). Planner
    and synthesis artifacts also resolve symbolic links (realpath).
  - Restarting recovery after a stop during its repair call overwrites `recover-source-attempt-1.json`.

## 6. Recommended fix order

One follow-up commit on this branch (or a child branch), then a short re-review, then land on `main`:

1. **Medium #1 + #2 together.** Add explicit verdict classification and the four tests named above.
2. **Low #3.** Keep 130/143 in `run-workflow.js` and the `--resume` path.
3. **Low #4.** Add the `stdin` error listener and its test.
4. **Low #5.** Temporary run root for the child tests, a `ready` that rejects on early exit, and the model
   count check.
5. **Low #6** (optional in the same pass). Add the shared helpers and drop `rejection`.
6. At landing time, **Low #7**: update `CLAUDE.md`, the 09-06 banner, the 09-26 review, and this file's
   banner.

Alan's alternatives, for completeness:

- **Merge now and fix on `main`.** Pros: the Low #5–#7 wins land immediately. Cons: Medium #1 can cost
  money on ladder runs until fixed, and Medium #2 regresses a clean-stop path that works on `main` today.
- **Keep Low #5–#7 and drop the Low #8 resume machinery** (Fable's 09-26 option 1). Pros: roughly half the
  code and no new resume kind. Cons: undoes Alan's recorded option-2 decision. A stop during planning goes
  back to being honored up to 2 s late, and "stopped while checking a plan that would have been rejected"
  is again not resumable.

## 7. Checks run (real output, this VM)

| Check                                                                         | Result                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Go toolchain                                                                  | `go1.26.0 linux/amd64` (downloaded via `GOTOOLCHAIN`); evaluator built                                                                                                                                                                  |
| Starlark suite, `main` `1e06820`                                              | 128 pass / 0 fail / 0 skipped                                                                                                                                                                                                           |
| Starlark suite, branch `2596b2c`                                              | **151 pass / 0 fail / 0 skipped** (matches the 09-27 record)                                                                                                                                                                            |
| Starlark suite, branch merged onto current `main` (scratch merge, not pushed) | 151 pass / 0 fail / 0 skipped                                                                                                                                                                                                           |
| Eight-file focused set, 25 serial runs                                        | 25/25 pass                                                                                                                                                                                                                              |
| Same set, 6 parallel loops × 8                                                | 46/48 pass; 2 failures = Low #5 hang                                                                                                                                                                                                    |
| Root `npm test` on branch                                                     | 1,160 pass / 1 fail / 1 skipped. The failure is the known Linux-only `bash.test.js` "reports signal when process is killed"; the skip is platform-gated                                                                                 |
| `npm run lint`, `npm run check:docs`                                          | pass                                                                                                                                                                                                                                    |
| `npm run format:check`                                                        | fails only on the three historical root handoffs named in the 09-27 record                                                                                                                                                              |
| ESLint on `starlark-host/`                                                    | 0 errors, 4 pre-existing `no-unused-vars` warnings in untouched files                                                                                                                                                                   |
| Prettier on the branch's changed files                                        | clean                                                                                                                                                                                                                                   |
| **Fix-reversal checks** (undo one fix, rerun suite)                           | Each reversal turned at least one test red: evaluator signal (1 test), exit-code rule (3), torn-line refusal (2), pending replay (7), resume fingerprint check (1), realpath check (1), interruption labeling (15), safe input name (1) |
| Probes (scratch, not committed)                                               | Medium #1 ladder, Medium #2 settle + pre-lint, Low #4 `EPIPE`, "stop during a valid plan's check" on `main` vs branch                                                                                                                   |

Second opinion: an independent review subagent audited the same range. It confirmed Medium #2, Low #3,
Low #5 and Low #6, and found Medium #1 and Low #4. The reviewer re-ran both of its repro scripts against
`main` and the branch before including them here.

**Skipped:** the full matrix on Alan's Mac (the VM is Linux), the 2020-laptop stash comparison (not
visible from here), browser rendering of the HTML companion, and any live or paid run (not needed).

## 8. Pointers for the next agent

- Folder: `/Users/alanman/Developer/claude-local-bridge-playground` on Alan's Mac. Remote `origin` is
  `alankatanoisi/claude-local-bridge-playground`. The code under review is on
  `codex/starlark-resume-2020-2026-09-26`. This review sits one commit above it on
  `cursor/starlark-branch-review-e507`. Do not edit a dirty checkout; use a fresh worktree from that branch.
- Build the evaluator first: `npm --prefix starlark-host run build:evaluator` (Go 1.26). Without it, the
  planner tests skip instead of running.
- Read §3 Medium #1/#2 before touching `generateValidatedPlan` / `generateValidatedPlanOnModel`. Do not
  "fix" it by adding more `signal.aborted` checks; classify errors instead.
- Stay inside `starlark-host/`. Do not edit `src/runner/**`, `src/credentials.js`, `src/proxy.js`,
  `src/server.js`, or `src/interceptors/**`. No runner edge.
- No paid calls are needed. Every case above is deterministic with local fakes.
- When done, write a dated closure handoff, banner this file, and ask Cursor for a short re-review of the
  fix commit only.
