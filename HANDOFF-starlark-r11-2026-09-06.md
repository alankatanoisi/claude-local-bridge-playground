# Starlark R11 — interruption and worker resume

> **Thermo-nuclear review 2026-09-06 — OPEN findings:**
> [`HANDOFF-starlark-r11-thermo-nuclear-2026-09-06.md`](HANDOFF-starlark-r11-thermo-nuclear-2026-09-06.md).
> Build/test-gate claims in this file are not contradicted. Do **not** treat
> `84dd73a` as invariant-clean: abort can drop a settled (charged) bridge
> result so `--resume` pays again; `run_aborted` is written before the worker
> pool drains; checkpoints are not fsynced; resume replays the whole pipeline
> inside `coordinator.js` (622 → 874 lines). Review is review-only until Alan
> asks for a fix.

> **START HERE — new Starlark thread entry, 2026-09-06.** This handoff supersedes
> [the 2026-08-25 status handoff](HANDOFF-starlark-status-and-recommendations-2026-08-25.md)
> as the thread entry. That dated record and the A–D implementation records remain
> unchanged. The lab is active again. R8 still keeps Starlark separate from the
> runner: no runner integration edge was added.

**Status:** Parts 1–5 implemented; deterministic and mock-HTTP acceptance green.
Part 6 skipped, actual live spend **$0**. All five required final gates pass.
**Browser companion:** [Open the standalone HTML report](HANDOFF-starlark-r11-2026-09-06.html).

## 1. Folder, starting point, and scope

- Folder and detected repository root: `/Users/alanman/Developer/claude-local-bridge-playground`.
- Branch: `main`. A branch is the named line of saved project history.
- Remote: `https://github.com/alankatanoisi/claude-local-bridge-playground.git`.
- Inherited commit: `9bb21660801d09c58977d0fe2889ac50aa8e7f7d`.
- GitHub advanced during the session to `d02e9d081eda1c16fb3ce619944b4b65578da5d7`,
  adding runner-history work `19c2a69` and a thread-pointer update `d02e9d0`.
  Those upstream changes do not overlap the Starlark patch. The tested local
  implementation was committed, then rebased onto that updated main as `84dd73a`.
  Rebase means placing our saved change after the newer GitHub history.
  `git range-diff` verified the implementation patch was identical before/after.
  All five gates were rerun on the combined checkout before push.
- Startup tree was clean; `git pull --ff-only origin main` reported `Already up to date.`
- Implementation follows `CODEX-TASK-starlark-r11-2026-09-06.md`: preflight and pull,
  inherited baselines, then Parts 1–5 in order. Part 6's confirmation condition was
  not met. The operative brief stays at the root until Alan accepts completion.
- All task-authored changes are within `starlark-host/**` and this new root handoff pair. Root
  `src/`, `test/`, `bin/`, and `docs/` were not edited by this task; the separate
  upstream runner commits remain intact. No new runner-module import
  was introduced; the bridge adapter's inherited pricing/capability imports remain.

## 2. What changed

| Part                  | Result                                                                                                                                               | Main files                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1 — missing evaluator | Shared explicit skip condition; assertions preserved. Installing the binary re-enables the original test bodies.                                     | `test/helpers/evaluator-required.js` and evaluator-dependent tests                                 |
| 2 — cancellation      | Per-run AbortController; queue checks; HTTP cancellation; durable abort event and checkpoint; SIGINT/SIGTERM handlers.                               | `src/run-abort.js`, `coordinator.js`, `bridge.js`, `ledger.js`, worker adapters, both entry points |
| 3 — worker resume     | Both entry points accept `--resume`; replay accepted plans and terminal job receipts; reuse saved inputs/artifacts; resume recovery too.             | `src/coordinator.js`, `src/workflow-runner.js`, `test/r11-recovery.test.js`, test-only helpers     |
| 4 — golden plans      | Committed expected initial/recovery descriptor lists for experiment, repository fan-out, and test-triage fixtures; full pipeline no longer needs Go. | `test/golden-plans/`, `test/golden-plans.test.js`, `test/worker-adapters.test.js`                  |
| 5 — content hashes    | Accepted program, descriptors, and inputs receive SHA-256 fingerprints in existing events/checkpoints; resume verifies saved evidence.               | `src/plan-hash.js`, `src/coordinator.js`, `test/plan-hash.test.js`                                 |
| 6 — live smoke        | Skipped. No in-session reaffirmation of the $10 ceiling. No live request or spend.                                                                   | None                                                                                               |

Paths in the table are relative to `starlark-host/`. The README explains the new
commands, expected output, stop signals, error cases, and limitations in beginner
terms. The experiment entry point also accepts the same `host_json` planning and
deterministic-worker options as workflows. The original synthesis-only resume
implementation was not edited; all seven existing synthesis tests remain green.

## 3. Cancellation and durable state

An **AbortController** is a host-owned stop switch. Its signal reaches the worker
queue, registry, deterministic adapter, bridge calls, and synthesis calls. Queue
workers check it before taking another job. The coordinator checks it again after
asynchronous calls, so a provider that ignores cancellation cannot publish a late
success or failure.

Aborting a bridge fetch destroys its request, including an unfinished response
body. The worker pool uses `Promise.allSettled` to await every active worker's
cleanup before finalizing. A received usage response can still be settled while
cancellation is occurring; the subsequent job result is suppressed. A network
abort releases its reservation. These are accounting operations, not job-success
receipts.

`run_aborted` contains the reason and interrupted phase. `state.json` records
`phase: aborted`. SIGINT (Control–C) and SIGTERM trip the switch; the entry point
waits for cleanup rather than calling `process.exit` immediately. Exit codes are
130 and 143. SIGKILL cannot execute a handler.

`RunLedger.append` now appends and synchronizes each event to disk before returning.
History is never truncated or rewritten, and sequence numbers continue on reopen.
The final completed checkpoint is written after the synthesis artifact and result
file, preventing a completed checkpoint from preceding those artifacts.

## 4. Resume rules and evidence integrity

`run-context.json` retains the host configuration and execution settings in the
existing run folder. Credentials still come from the environment, not this record.
Resume reads accepted-plan events and saved input artifacts. It does not collect
changed source files or ask the planner to recreate an accepted plan.

- `job_succeeded`: load the output artifact and reuse it; do not execute the job.
- `job_failed`: reuse the failure; the existing recovery planner owns retry policy.
- `job_started` without a terminal receipt: execute again. This is **at-least-once**
  execution; an interrupted job may already have performed work before the stop.
- No start receipt: execute normally.
- Accepted recovery plan: replay it and reuse its terminal jobs as well.
- Completed checkpoint: return without adding jobs or ledger events.
- Partial checkpoint with a synthesis failure: direct the caller to the existing
  `resume-synthesis.js` path; do not create a third resume mechanism.

Malformed event lines, non-increasing sequence numbers, missing success artifacts,
ambiguous duplicate terminal job receipts, invalid descriptors, and changed hashed
inputs/programs stop worker resume. The code does not silently drop evidence and
risk repeating a saved success. Older records without hash fields can still be
replayed through the coordinator; the command-line path requires the new saved
`run-context.json` settings record.

Accepted events retain `hashes.algorithm`, `planHash`, `programHash`, and
`inputHash`. Checkpoints retain `planHashes`, `recoveryHashes`, and the base
`inputHash`. SHA-256 means Secure Hash Algorithm with a 256-bit result. The format
is canonical JSON: object keys are sorted while array order remains meaningful.
The program hash covers accepted, lint-repaired Starlark source, or the descriptor
list for `host_json`. Input hashes cover objective, metadata, and actual saved text;
recovery also covers its initial failure records. Hashes prove consistency, not
file authorship. Descriptor validation still applies independently.

Live resume requires explicit live mode and the original positive dollar cap. It
retains the original campaign and refuses a changed cap/campaign or a missing
campaign ledger. Tests exercise these refusals using mock metadata before any
network call or ledger mutation.

## 5. Test evidence — failures retained

| Check                             | Inherited baseline                              | Final result                                    |
| --------------------------------- | ----------------------------------------------- | ----------------------------------------------- |
| `npm --prefix starlark-host test` | 90 tests: 66 pass, 15 fail, 9 skip              | 104 tests: 81 pass, 0 fail, 23 skip             |
| `npm test` at repository root     | 1,066 tests: 1,065 pass, 0 fail, 0 skip, 1 TODO | 1,084 tests: 1,083 pass, 0 fail, 0 skip, 1 TODO |
| `npm run lint`                    | Pass                                            | Pass                                            |
| `npm run format:check`            | Pass                                            | Pass                                            |
| `npm run check:docs`              | Pass                                            | Pass                                            |
| `git diff --check`                | Clean baseline                                  | Pass                                            |

The root suite passed with 1,065 tests before upstream synchronization and
1,083 after it; the 18 added passes belong to the incoming runner-history commit,
not the Starlark task. Both runs retained the same one TODO and zero failures.
The root suite used the normal home directory and passed its inherited baseline;
no scratch-home workaround was necessary. The existing TODO is the named
case-variant key-file denial gap; it was not changed by this task.

The inherited lab's 15 failures all depended on the absent `starlark-eval` binary.
Part 1 changed the result to **66 pass / 0 fail / 24 skip** without weakening test
bodies. Part 4 restored one full-pipeline test to runnable status using `host_json`,
leaving 23 evaluator skips. Go and the evaluator binary remain absent.

Required R11 predicates cover cooperative abort, genuine HTTP concurrency of at
least three calls, real-child SIGTERM/SIGKILL and resume, no re-execution of saved
successes, exactly one terminal success per job, repeated interrupted work,
strictly increasing sequence numbers, unchanged prior ledger bytes, synthesis
coverage, parseable budgets, no stranded reservations, and idempotent completed
resume through both entry points. Extra cases cover SIGINT, interrupted recovery
with the source files removed, reproducible hashes, changed-evidence refusal, and
live-resume mode/cap/campaign guards. Tests collect named predicate failures or
use independently named assertions over the final state.

**Golden-plan negative control:** the first normal snapshot run passed. A deliberate
plan-builder wording change then produced **0 pass / 3 fail**, one failure per
fixture. Restoring the builder produced **3 pass / 0 fail**. The deliberate mutation
was removed and is not part of the changes.

**Intermittent existing bridge-test failure:** the first complete post-hashing run
reported **78 pass / 1 fail / 23 skip**. The existing mock HTTP server threw
`Unexpected end of JSON input` at its request-body parser. It passed alone, then
failed once more in a bridge-plus-R11 paired run. A diagnostic assertion was added
to identify an unexpected empty request's method, path, and selected headers
without weakening the existing checks. Five subsequent paired runs passed, followed
by green full-lab runs. The cause remains unconfirmed; a passing retry does not
erase those failures. Investigate the mock request origin if this recurs, using the
new diagnostic; do not assume it is a live bridge/authentication problem.

Machine-local raw logs, outside Git, include:
`/tmp/starlark-r11-baseline.log`, `/tmp/starlark-r11-root-baseline.log`,
`/tmp/starlark-r11-part5.log`, `/tmp/starlark-r11-bridge-isolation-1.log`,
`/tmp/starlark-r11-http-diagnosis-1.log` through `-5.log`,
`/tmp/starlark-r11-golden-negative.log`, `/tmp/starlark-r11-golden-restored.log`,
and `/tmp/starlark-r11-final-{lab,root,lint,docs,format}.log`. The post-rebase
checks are `/tmp/starlark-r11-synced-{lab,root,lint,docs,format}.log`.
These temporary logs may be removed by the operating system. The test suite and
committed fixture files are the reproducible evidence, not these temporary paths.
No real run-ledger or transcript payload is quoted in this report.

## 6. Residuals and next-agent boundaries

- **R8 unchanged:** separate lab and command-line interface; no runner edge.
- **R12 still open:** evidence layouts and trace joins remain separate. Resume
  appends trace metadata for its new segment without moving artifacts.
- **D-F3 untouched:** no new worker-side truncation or splitting behavior.
- **Go still absent:** 23 evaluator tests skip; no claim of Go-path execution on
  this Mac. Starlark-source hashing is implemented, but its evaluator-dependent
  branch has not been exercised here.
- **Live interruption/resume is unverified:** actual live spend was $0. Mock-HTTP
  cancellation and durable-budget cleanup are tested, but an interrupted provider
  response cannot establish unreported provider usage or the final provider bill.
- **Single writer per run folder:** simultaneous resumes of one run are not
  supported or tested. Do not start a resume while the original process is active.
- **Corrupt/torn evidence stops resume:** no destructive ledger repair is included.
- **Historical bridge HTTP 401 window:** not investigated; out of scope.
- **Retired concepts and bridge/authentication internals:** untouched.

## 7. Handoff and recommended options

**Folder / branch:** the playground folder above, `main`.
**Files changed:** Starlark runtime, entry points, README, tests and golden fixtures,
plus this dated Markdown/HTML pair. No root runtime, root tests, or dated record
rewrites. No generated run evidence is staged.
**Checks:** real results and intermediate failures are listed in section 5.
**Skipped:** Go-dependent execution, Go build/verify, and conditional live smoke.
The browser tool blocked the local-file URL, so rendered HTML inspection was not
performed; the companion received structural, navigation, and content checks.
**Risks:** intermittent mock-server request parsing, unverified live accounting,
single-writer assumption, and fail-closed handling of damaged evidence.
**Commit/push/sync:** implementation commit `84dd73a` follows updated upstream
`d02e9d0`. The companion handoff commit follows it. Alan authorized push after
final gates; the closing session response records the actual push/ref verification.
A commit saves a local project version; push uploads it to GitHub; synchronization
is verified by comparing local `main`, `origin/main`, and GitHub's branch commit.

1. **Independent Starlark invariant review — recommended.** Ask Cursor to inspect
   the completed change, focusing on cancellation races, resume reconstruction,
   accounting cleanup, and accepted-plan integrity. Benefit: another review of the
   new persistence boundary at $0. Cost: review time before additional lab changes.
2. **Enable the skipped Go checks.** In a separate session, install Go 1.26.0 or the compatible version
   specified by the lab and run the evaluator verification. Benefit: validates the
   real Starlark path and its hashing branch. Cost: local tooling setup; no model spend.
3. **Explicitly authorize the small live smoke.** Reaffirm the $10 session ceiling;
   use one 2–3-job run with a per-run flag no higher than $2 and the same campaign
   on resume. Benefit: adds real bridge/campaign evidence. Cost: paid requests and
   possible unreported usage if interrupted. This is separate from new model rankings.
4. **Keep building offline.** Choose one residual deliberately, such as the
   intermittent mock-server request diagnosis. Benefit: stays free and bounded.
   R12 evidence unification and D-F3 behavior decisions remain separate work.

No scope-fence deviation was required. The implementation and tests are grouped
in one cohesive implementation commit, with a separate handoff commit, rather than
the brief's suggested per-part sequence: abort, resume, and hashing share the same
coordinator changes. This changes the suggested commit grouping, not task order.
