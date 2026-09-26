# Starlark abort-commit: two acceptance boundaries hardened

> Publication update — September 18, 2026: Alan subsequently authorized the synthesis-resume session to own both tasks, review and verify them together, and commit/push/synchronize the combined work. Implementation and preserved evidence are committed as 3bacab37924ed5739fb7663d796d8068c60a331a. Final combined checks passed: focused 43/43; full Starlark 128/128; repository 1,105 passed, zero failures or skips, one existing TODO. The original no-commit wording below describes the earlier session’s stop point, not the final combined disposition. See HANDOFF-synthesis-resume-evidence-2026-09-18.html for the combined handoff. Raw evidence whitespace warnings are preserved; source and report whitespace checks pass.

Date: September 18, 2026. Scope: the two explicitly untested acceptance rows in [the September 16 closure handoff](HANDOFF-starlark-mediums-closed-2026-09-16.md). No live provider calls were made. All response usage and dollar costs below are simulated locally.

**Result:** settled invalid worker output already obeyed the required recovery rules. New coverage proves that behavior. Four additional regressions exposed cancellation masking persistence or accounting failures. A narrow coordinator change makes those errors reach the caller without turning them into invalid model output or a successful cancellation return.

## Location, baseline, and concurrent work

- Folder and repository root: `/Users/alanman/Developer/claude-local-bridge-playground`.
- Branch: `main`. Baseline commit: `912cc6e4cc9dc63031c2c16c5b157eefeb52c9ee`.
- Remote: `https://github.com/alankatanoisi/claude-local-bridge-playground.git`.
- Startup status was clean. `git pull --ff-only origin main` succeeded with “Already up to date.” The other registered worktrees were inspected through Git metadata and were not edited.
- During this work, another session introduced changes in `starlark-host/src/resume-synthesis.js`, `starlark-host/src/worker-resume.js`, and `starlark-host/test/synthesis.test.js`. Those files were left untouched. Broader verification describes the shared working tree, including those concurrent changes, rather than an isolated patch applied to the baseline.
- This task did not commit, push, merge, reset, stash, or remove another agent's files. A commit is a saved source-history snapshot; the changes in this handoff remain local working-tree edits.

## What the tests now prove

A terminal receipt is a saved event saying that one worker job succeeded or failed. Settlement is local budget accounting for a completed response. A checkpoint is the saved snapshot of the run's state.

| Boundary                                                            | Baseline                           | Proven result after the change                                                                                                                                                                                                                                |
| ------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Settled invalid response observed after cancellation                | Passed                             | One actual loopback request, one local settlement, one charged `job_failed` with `invalid_worker_output`, no success receipt, and one final `run_aborted`. The saved checkpoint includes the failure and agrees with local budget accounting.                 |
| Resume after that invalid response                                  | Passed                             | The original failed job is not requested again. The real recovery planner creates an explicit new job linked by `retry_of`; that retry executes once. Resume completes, the original ledger prefix is unchanged, and no job gets duplicate terminal receipts. |
| Worker artifact failure while cancellation is pending               | Failed: missing expected rejection | The exact injected error reaches the caller. No success or invalid-output failure receipt is manufactured for that job.                                                                                                                                       |
| Failure writing the final aborted checkpoint                        | Passed                             | The exact checkpoint error reaches the caller. The prior successful worker receipt remains recorded; no invalid-output failure receipt is added.                                                                                                              |
| Budget settlement callback records accounting, cancels, then throws | Failed: missing expected rejection | The exact settlement error reaches the caller, with one locally recorded call and no stranded reservation. It is not converted into a clean abort or a false worker receipt.                                                                                  |
| Earlier pool slot cancels; another active worker fails persistence  | Failed: missing expected rejection | The pool waits for both workers, exposes the persistence error, and starts no queued third job. Cancellation in the first slot cannot win merely because its array position is earlier.                                                                       |
| Phase checkpoint callback cancels and throws before workers start   | Failed: missing expected rejection | The exact checkpoint error reaches the caller and no worker starts. The outer run catch cannot erase it.                                                                                                                                                      |

The invalid-response test uses the real `ClaudeBridge`, pricing calculation, `CostBudget`, `PhasedCoordinator`, worker-output validator, `RunLedger`, checkpoint files, resume reconstruction, and host JSON recovery planning. JSON (JavaScript Object Notation) is the structured text format used for responses and saved state. A temporary HTTP (Hypertext Transfer Protocol) server bound to `127.0.0.1` supplies the response; no request goes to a provider.

The persistence and accounting tests inject failures at methods on those real component instances. The additional concurrency test uses an explicit promise barrier and a small controlled worker provider so the order is deterministic. It is evidence about pool error selection and draining, not about provider networking or billing. Temporary fixtures are created per test and only those fixtures are removed.

## Source change and why it is small

Only `starlark-host/src/coordinator.js` changes runtime behavior:

1. Limit the invalid-output catch to parsing and validation. Artifact writes and success-receipt writes occur outside that catch, so storage failures cannot be mislabeled `invalid_worker_output`.
2. Preserve the actual worker-call error when cancellation is pending. Replacing it immediately with the cancellation reason was losing settlement failures.
3. After every active worker has settled, inspect non-cancellation failures before honoring cancellation. “Settled” here means each JavaScript promise finished, either successfully or with an error; it does not imply a budget charge succeeded.
4. The outer run catch recognizes cancellation by its actual reason, or Node's `AbortError` wrapping that reason as its cause. The signal being marked cancelled is insufficient by itself to classify an unrelated error as cancellation.

The queue's cancellation checks remain in place. Ordinary cancellation still drains active work and records `run_aborted`. When an unrelated infrastructure error wins, `run()` rejects with that original error instead of returning an aborted state. This change does not add a new durable error-event protocol. Previously saved receipts remain available for existing resume rules.

No runtime edits were needed for the already-correct invalid-output or final abort-checkpoint behavior. No budget implementation, bridge transport, authentication, runner integration, recovery policy, or storage-format changes were made by this task.

## Preserved red-before-green evidence

“Red” means a regression test fails before the fix; “green” means it passes afterward. The evidence directory is [docs/artifacts/starlark-abort-boundaries-2026-09-18](docs/artifacts/starlark-abort-boundaries-2026-09-18/).

- [Initial fixture error](docs/artifacts/starlark-abort-boundaries-2026-09-18/initial-fixture-error.txt): the first attempt omitted required `claims` from the supposedly valid worker response. Its 1 pass / 4 fail output is retained as a test-setup error, not valid proof of artifact failure.
- [Corrected baseline](docs/artifacts/starlark-abort-boundaries-2026-09-18/red.txt): rerun against unchanged coordinator source at the baseline above, after correcting the fixture and adding the phase-checkpoint case. **2 passed, 4 failed, 0 skipped**. All four product failures were “Missing expected rejection.”
- [First green run](docs/artifacts/starlark-abort-boundaries-2026-09-18/green.txt): same six behavioral cases after the narrow source change. **6 passed, 0 failed, 0 skipped**.
- [Focused regression suite](docs/artifacts/starlark-abort-boundaries-2026-09-18/focused.txt): new boundary tests plus existing bridge, R11 recovery, and plan-hash tests. **23 passed, 0 failed, 0 skipped**.

The new tests were formatted afterward, so historical stack line numbers refer to the pre-format file. The test names and assertions identify the preserved cases. Already-passing cases are explicitly reported as baseline passes; no artificial red result is claimed for them.

## Verification

All commands were run by the agent in the repository root above. Alan does not need to paste them anywhere.

| Check                                                                            | Result and retained output                                                                                                                                                                    |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused suite                                                                    | 23 passed, no failures or skips; [focused.txt](docs/artifacts/starlark-abort-boundaries-2026-09-18/focused.txt)                                                                               |
| `PATH=/opt/homebrew/opt/go@1.26/bin:$PATH npm --prefix starlark-host run verify` | Go 1.26.8 rebuilt the evaluator; 128 passed, no failures or skips; [starlark.txt](docs/artifacts/starlark-abort-boundaries-2026-09-18/starlark.txt)                                           |
| Root `npm test`                                                                  | 1,105 passed, 0 failed, 0 skipped, 1 existing TODO; 1,106 tests total; approximately 150 seconds; [root-tests.txt](docs/artifacts/starlark-abort-boundaries-2026-09-18/root-tests.txt)        |
| `npm run lint`                                                                   | Passed; [lint.txt](docs/artifacts/starlark-abort-boundaries-2026-09-18/lint.txt)                                                                                                              |
| Direct lint of the changed coordinator and new test                              | Passed. The root lint command does not include `starlark-host`, so these files were checked separately.                                                                                       |
| `npm run check:docs`                                                             | Passed; [docs.txt](docs/artifacts/starlark-abort-boundaries-2026-09-18/docs.txt)                                                                                                              |
| Root `npm run format:check`                                                      | Failed on three pre-existing handoffs only; [format.txt](docs/artifacts/starlark-abort-boundaries-2026-09-18/format.txt)                                                                      |
| Formatting of this task's source, test, Markdown and HTML                        | Passed for all four files.                                                                                                                                                                    |
| Whitespace and report structure                                                  | Git whitespace check passed. Both report formats have matching report-body text; all local report links resolve; HTML has no external assets or scripts. Browser rendering was not inspected. |

The three root formatting failures are `HANDOFF-golden-eval-he06-thermo-nuclear-2026-09-06.md`, `HANDOFF-permission-cache-thermo-nuclear-2026-09-07.md`, and `HANDOFF-starlark-r11-thermo-nuclear-2026-09-06.md`. They were already documented in the September 16 handoff and were not reformatted here.

## Limits and remaining work

- These tests prove host behavior with deterministic local responses and injected component-method failures. They do not simulate physical disk failure, power loss, or every operating-system write error. No claim is made about directory-flush support on every filesystem.
- The budget failure is injected after local accounting succeeds. Actual campaign-file persistence failures before or midway through settlement, a real budget cap overrun, and their reservation-repair requirements are not established by this test.
- A visible error means the caller receives the original rejection. It does not guarantee that the failure itself has been durably recorded, particularly when writing the checkpoint is what failed. A `run_aborted` event may already exist when its following checkpoint fails.
- After an artifact or settlement error, a started job can still lack a terminal receipt. Existing resume rules may execute that job again. This work does not make settlement plus artifact plus receipt one atomic transaction, and does not promise zero repeat charges after infrastructure failure.
- The concurrency test proves that one unrelated failure outranks cancellation after draining. It does not promise aggregation of every error if several active workers fail independently.
- Requests interrupted before completing retain unknown provider-side billing. Releasing a local reservation is not evidence that a provider charged nothing.
- SIGKILL (an immediate process termination) and power loss between settlement and receipt remain outside the guarantee. Existing process-interruption tests passed; that is not proof of transactional crash safety.
- Planner failures, multi-call synthesis partial-output persistence, and synthesis-resume checkpoint reconstruction are outside this task's two acceptance rows. Concurrent synthesis edits belong to the other session and are not claimed as this task's work.
- Multiple writers to the same run directory remain unsupported. No live provider checks were run, as requested. Browser rendering of this report is not claimed by structural HTML checks.
- Follow-up: the repository's normal Cursor invariant review should inspect this narrow change once Alan chooses to save it in source history. Preserve the already documented “not bugs” boundaries and do not infer closure of unrelated findings.

## Handoff inventory

Files authored or changed by this task:

- `starlark-host/src/coordinator.js` — the only runtime source edit.
- `starlark-host/test/abort-commit-boundaries.test.js` — six deterministic regression tests.
- `HANDOFF-starlark-abort-boundaries-2026-09-18.md` and its adjacent `.html` companion — this report in both formats.
- `docs/artifacts/starlark-abort-boundaries-2026-09-18/` — preserved test output and final verification evidence.

Folder and branch are recorded above. Checks, skips, and limitations are explicit. Other agents' files remain untouched; no commit or push was performed by this task.
