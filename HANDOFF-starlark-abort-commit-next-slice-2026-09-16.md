# Starlark abort-commit protocol: evidence and next-agent handoff

> **UPDATE 2026-09-16 (later the same day) — slices A, B, and C landed.** Medium #1–#4
> were fixed by Fable at Alan's direction as two commits: `c7953e3` (Medium #1–#3) and
> `eb12ff5` (Medium #4). Closure record, including a row-by-row answer to the §9
> acceptance matrix and the §10 boundaries:
> [`HANDOFF-starlark-mediums-closed-2026-09-16.md`](HANDOFF-starlark-mediums-closed-2026-09-16.md).
> The evidence below is still valid history. Do **not** re-implement slice A from this
> file. Low #5–#8 remain open.

> **OPEN FINDINGS — DOCUMENTATION ONLY.** R11 is landed; its completed-worker cancellation gap remains open at the source baseline below. This report does not close the September 6 review or authorize runtime changes. Alan requested this handoff and its publication while other agents were working. Recheck current source and coordinate ownership before implementation.

**Prepared:** September 16, 2026 (America/Los_Angeles). **Author:** Codex. **Audience:** next implementing agent and subsequent invariant reviewer. **Provider spend for this investigation:** $0.

[Browser companion](HANDOFF-starlark-abort-commit-next-slice-2026-09-16.html)

## 1. Decision in one paragraph

Implement review Medium #1 and #2 together as the smallest credible next slice: cooperative cancellation must stop new work, let already-completed and successfully settled worker outcomes reach a terminal receipt, drain active workers, and only then record final abort. A terminal receipt is the event saying a job succeeded or failed. Preserve charged failures as well as successes. Add a deterministic regression at the settlement boundary before changing runtime code. Follow with separately tested storage durability work (Medium #3); defer the larger resume extraction/phase dispatcher (Medium #4) unless a small structural change is essential to make the first protocol correct. Do not claim exactly-once provider execution or universal protection against repeated spending.

## 2. Location, concurrency, authority, and version identity

- Shared owner checkout: `/Users/alanman/Developer/claude-local-bridge-playground`, branch `main`, remote `https://github.com/alankatanoisi/claude-local-bridge-playground.git`.
- Initial investigation baseline: `7d8d4f68088b6d64567077a958a053d3893f78c3`. Local `HEAD`, local `origin/main`, remote `refs/heads/main`, and GitHub's commit lookup matched.
- Handoff preparation baseline: `8bac1d4f5817f251fec53b1d758dd6e190980edf`. The shared checkout was clean and matched GitHub. The only intervening change was `package-lock.json`; the Starlark files examined in this report were unchanged.
- Intentional documentation worktree: `/Users/alanman/.codex/worktrees/starlark-abort-handoff-2026-09-16/claude-local-bridge-playground`, branch `codex/starlark-abort-handoff-2026-09-16`. A worktree is a separate working folder sharing repository history. It was created from freshly fetched `origin/main`; an explicit fast-forward-only pull there reported already up to date.
- Alan authorized drafting, committing, and pushing this handoff. This author has not implemented the recommended runtime changes. Other agents were active; their files, index, and checkout were not used for report edits or staging.
- Publication scope is this new Markdown report and its standalone HTML companion only. Do not add unrelated dirty files, update old handoff banners, or close findings as part of this documentation commit.
- The canonical `claude-local-bridge` repository is reference-only. This work belongs to the playground.

The shared checkout should be synchronized only when its active agent can safely do so. A documentation push does not mean that another agent's local `main` has been advanced. Inspect fresh refs before any later publication; never force-push around concurrent work.

## 3. Read these records in this order

1. [September 6 Starlark review](HANDOFF-starlark-r11-thermo-nuclear-2026-09-06.md): detailed findings, original fix order, and the “not bugs” boundaries. This remains the review record to close after a verified implementation.
2. [Original R11 implementation handoff](HANDOFF-starlark-r11-2026-09-06.md): implementation and original test evidence for `84dd73a` plus handoff `406423b`.
3. [September 7 live verification](HANDOFF-starlark-r11-live-verification-2026-09-07.md): later real interruption/resume and Go evaluator evidence. Its historical no-publication wording describes that session, not current Git ancestry.
4. [September 10 context-layer closure](HANDOFF-context-layer-mediums-closed-2026-09-10.md): closes a different set of findings and explicitly leaves Starlark Item 2 open with the “may double-spend” warning.
5. [SECURITY.md](SECURITY.md) and [AGENTS.md](AGENTS.md): current scope and working rules before implementation.

This handoff supplements those records. It does not replace their historical results or silently revise earlier failures and limitations.

## 4. What GitHub and history established

At the initial inspection, both `84dd73a` (abortable worker resume and golden-plan evidence) and `406423b` (implementation handoff) were ancestors of `main`. No subsequent commit under `starlark-host/` appeared after `84dd73a`. The September 16 baseline comparison confirmed no intervening Starlark source changes.

R11 landed in repository history directly; no R11 pull request is missing. A pull request is a GitHub proposal to merge changes. The initially observed open requests were #28 (dependencies), #26 (case-variant path safety and records), and #21 (orchestration study), with no abort-commit fix among them. The latest merged request in that initial listing was #27, the permission-cache fix, which is unrelated to this Starlark protocol. Open issues in that snapshot were unrelated test issues.

These pull-request/issue listings are point-in-time evidence from the initial investigation, not a promise about their state at implementation time. The handoff-preparation refresh checked branch identity and intervening source changes, not a new full pull-request inventory.

## 5. Already landed: preserve these capabilities

| Capability                 | What exists                                                                  | Boundary of the evidence                                                        |
| -------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Cooperative cancellation   | Per-run stop signal, request cancellation, orderly interrupt handling        | Does not guarantee a completed response is saved before cancellation is honored |
| Worker-pool cleanup        | `Promise.allSettled` waits for active worker promises                        | An early abort event currently precedes that drain                              |
| Worker resume              | Reuses saved terminal receipts, runs unfinished jobs, replays accepted plans | A started job without a terminal receipt is deliberately eligible to run again  |
| Saved inputs and integrity | Saved inputs, accepted-plan validation, content hashes                       | Missing historical hashes remain compatible by design                           |
| Completed-run no-op        | A saved completed checkpoint allows resume to return without calls           | Stale completion checkpoints are a separate gap                                 |
| Event persistence          | Event appends explicitly flush the file with `fsync`                         | Artifact/checkpoint atomic writes do not have the same flush discipline         |
| R14 evidence               | Content hashing and golden-plan tests                                        | These do not test the settlement-to-receipt cancellation boundary               |

The later live report records a real Go evaluator run with 104/104 tests and no skips, superseding older statements that Go/live verification were absent. Three real `repo_fanout` trials resumed after SIGTERM or SIGKILL. SIGTERM requests orderly termination; SIGKILL stops the process immediately and cannot be handled. Each trial was interrupted after one success had already been saved while two jobs remained unfinished.

Those trials showed reuse of recorded successes. They did not deliberately inject cancellation between cost settlement and saving a worker outcome. Six interrupted requests had unknown provider billing. Their uncertainty must not be erased or treated as free capacity. Historical results were read from the report; private raw live artifacts were not re-audited during this investigation.

## 6. Current findings and evidence strength

### Medium #1: completed and settled output can be discarded

Source anchors at the inspected baseline:

- `starlark-host/src/bridge.js`, `ClaudeBridge.call`, approximately lines 168–181: await budget settlement, then `checkAbort(signal)`, then return the response.
- `starlark-host/src/coordinator.js`, `runJobs`, approximately lines 643–704: await provider execution, check abort before processing output, then write artifact and `job_succeeded`; failure recording also checks abort.
- The same file, `runJobs`, approximately lines 627–630: reuse an existing terminal receipt; otherwise execute the job.

Observed sequence: response completes → campaign records usage-based cost → cancellation throws → no terminal job receipt → resume executes the same job again. “Settlement” here means local accounting based on response usage, not independently confirmed provider billing.

**Evidence strength:** source-confirmed and reproduced with simulated network responses, the actual `ClaudeBridge`, actual `PhasedCoordinator`, and actual durable campaign budget. This is not a live provider double-charge observation.

### Medium #2: final abort is recorded before worker drain

`coordinator.js`, approximately lines 103–127, registers an abort listener that immediately calls `recordAbort()`, appends `run_aborted`, and checkpoints. The catch path also calls it after the worker-pool drain; idempotence prevents a second final event. The early write conflicts with allowing settled work to commit before final abort.

The old review describes a possible result-after-abort ordering race. This investigation verified the premature finalization path but did not independently reproduce every interleaving claimed there. JavaScript synchronous stretches cannot be interrupted arbitrarily; write adversarial tests around real asynchronous boundaries rather than assuming an operating-system signal can land between any two synchronous statements.

There is also a summary mismatch risk: `state.results` is populated only after `runJobs` returns (approximately lines 210–212 and 283–285), while the pool's abort check can prevent that return. Saved receipts must remain authoritative, and the final aborted summary should agree with them.

### Medium #3: uneven durability and stale completion state

`starlark-host/src/ledger.js`, `atomicWrite`, approximately lines 56–60, writes a temporary file then renames it, without explicitly flushing the temporary file or parent directory. This helper also writes artifacts and run context, not only checkpoints.

`restoreWorkerPhase` in `coordinator.js`, approximately lines 332–347, uses the checkpoint's phase for completed-run early return. It does not independently reconcile completion events with output artifacts to establish a completed run. A stale checkpoint can therefore lead back to synthesis.

**Evidence strength:** current source inspection; no new power-loss or stale-checkpoint reproduction was run. Process death is different from loss of storage durability. A SIGKILL test does not by itself prove power-loss safety, and file flushing does not make several separate writes one indivisible transaction. The existing `run_completed` event is written before `result.json` and the final checkpoint, and is also emitted with `synthesisOk: false` for partial synthesis. Do not treat the event name alone as proof of reusable completion.

### Medium #4 and Low #5–#8: retain as follow-ups

The review's larger worker-resume extraction and explicit phase dispatch remain separate work. The lows concern preserving interrupt exit codes, consistent artifact-name sanitization, a named error for a torn last event line, and forwarding cancellation to the evaluator child. This inspection did not add independent reproductions for those findings. Preserve their review status; do not close or expand them opportunistically in the worker-commit slice.

## 7. Investigation results, including the failed first probe

| Check                                                           | Observed result                                                                                                                                        |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Focused bridge, R11 recovery, and plan-hash suites at `7d8d4f6` | 12 passed, 0 failed, 0 skipped; approximately 1.69 seconds                                                                                             |
| First ad hoc boundary probe                                     | Failed before settlement: simulated response omitted the headers interface used by the bridge; assertion saw 0 settlements instead of 1                |
| Corrected boundary probe                                        | Same job started twice across interruption/resume; 2 local campaign settlements; 0 success receipts; simulated recorded cost $0.0008; 0 provider calls |
| Working tree after investigation                                | Clean; no source/test/report edits                                                                                                                     |
| September 16 source comparison                                  | Only dependency lockfile changed since inspection; relevant Starlark source unchanged                                                                  |

The first probe failure was a probe defect, not a runtime regression and not evidence that settlement was safe. The corrected probe used Node's complete `Response` object. Neither result should be rewritten as an initially passing investigation.

The existing cooperative-abort test expects late deterministic results to be suppressed. All 12 passing tests therefore coexist with the reproduced gap; a green suite does not close it. The corrected experiment interrupted both the original execution and its resume at the same boundary. It proves repeated local settlement of the same job, not a successful final resume.

The temporary fixtures were removed, so there is no retained raw run directory to cite. The result above is the recorded tool output from this conversation. The next agent should promote this setup into a repository regression test and preserve its first failing output before applying the fix.

## 8. Reproduction recipe for the implementing agent

Use a new automated test in the Starlark suite, based on `test/helpers/r11-fixture.js`; do not modify real run directories or call the live bridge.

1. Create the existing six-document temporary fixture, use `host_json` planning, set maximum concurrency to one, and open a temporary durable campaign budget with a $1 simulated cap.
2. Replace network fetch within the isolated test with a complete successful `Response`: one text block, usage of 100 input tokens and 20 output tokens, `end_turn`, and ordinary response headers. Return contract-valid worker text such as summary `test`, empty evidence, confidence 0.5.
3. Construct the real `ClaudeBridge` with that budget and the real `PhasedCoordinator` with the fixture. Use the baseline's `claude-sonnet-5` model identifier so pricing follows the same catalog.
4. Wrap budget settlement: await the original settlement, then abort the run controller before the bridge returns its answer. This injects the exact boundary reliably instead of hoping a timer hits it.
5. Run once. Confirm one campaign settlement and no terminal success on unfixed source. Resume from the same run directory and budget with a fresh controller. The original probe injected the same abort again and observed two starts for the same job and two settlements.
6. For the permanent regression, inject only on the first execution and allow resume to complete. Assert the fixed code records the original outcome and does not request that worker again. Count by worker job label; resume may legitimately call synthesis or process other jobs.
7. Restore the fetch stub and remove only the fixture created by the test. Keep the test isolated from other tests that might use global fetch.

This reproduces a completed local response and usage accounting. It makes no claim about provider-side cancellation, billing, or idempotency.

## 9. Smallest credible implementation contract

**Recommended slice A: cooperative worker abort-commit, Medium #1 plus #2.** “Commit” in this protocol means saving the worker outcome and receipt, distinct from a Git commit that saves source history.

Required behavior:

- Cancellation immediately prevents new queue items and new calls from starting; pending network operations still receive cancellation.
- An already-completed response whose settlement succeeded can reach outcome validation and persistence despite a subsequently observed cancellation.
- Valid output produces its artifact and one `job_succeeded` receipt. Invalid completed output produces one charged `job_failed` receipt under existing recovery rules. A charged failure does not promise zero future calls: a deliberate recovery retry can still be appropriate.
- Wait for all active workers to finish cleanup and outcome recording. Only then append one final `run_aborted` event for that interrupted segment. Across multiple resumes there can be multiple abort events, one per segment.
- Final summary/checkpoint includes the outcomes actually saved. Preserve the accurate interrupted phase and final accounting.
- Storage errors and settlement errors remain visible. Do not misclassify a failed artifact write as merely invalid model output or suppress an unrelated failure just because cancellation also occurred.

Likely files: `starlark-host/src/bridge.js`, `starlark-host/src/coordinator.js`, `starlark-host/test/bridge.test.js`, and `starlark-host/test/r11-recovery.test.js`. Add another narrow test file only if it improves separation. No runner integration or bridge/authentication/proxy changes are needed.

Deleting the bridge's post-settlement check alone is insufficient: the coordinator's success and failure paths also check cancellation. Conversely, removing every cancellation check is wrong. Keep checks guarding new work; distinguish outcome recording from permission to start more work. If a charged/settled marker is introduced, keep it host-owned and out of model authority.

Review two nearby edges while implementing: `postMessage` checks cancellation after receiving the body, before returning it; and campaign settlement can record accounting before throwing on a cap overrun. These were not reproduced in this investigation. Do not silently claim them covered by a test that only injects after successful settlement. Either handle them explicitly with bounded tests or document them as remaining boundaries.

### Acceptance matrix for slice A

| Scenario                                                | Required assertion                                                                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Abort immediately after successful settlement           | Completed worker outcome is saved once and reused on resume                                                         |
| Completed but invalid worker output                     | One charged failure receipt; no replay of original job due merely to missing receipt; recovery remains explicit     |
| Mixed concurrency: completed call plus pending requests | Completed outcome persists; unfinished requests cancel and clean up; queued work does not start                     |
| Final abort ordering                                    | Terminal receipts and cleanup precede final abort; no new worker start/result after final abort within that segment |
| Aborted summary                                         | Saved outcomes, cost, and interrupted phase agree with evidence                                                     |
| Repeated cancellation observation                       | One final abort record per segment, no duplicate terminal receipts                                                  |
| Injected persistence/accounting failure                 | Failure remains observable; no false success or silently clean abort                                                |
| Existing process/socket/resume tests                    | Continue to pass with original integrity and accounting assertions preserved                                        |

Use explicit promises/barriers to control the boundary. Do not replace the existing tests with a weaker “run did not crash” assertion. Update the late-deterministic-completion test to distinguish a genuinely unfinished cancelled operation from a completed outcome awaiting persistence.

## 10. Follow-on slices and closure limits

**Slice B — Medium #3, storage durability.** Flush the temporary file before rename and the containing directory afterward, with cleanup on errors. Test the actual ordering and error propagation. Consider authoritative completion reconstruction from validated events and artifacts when a checkpoint is stale. Test successful completion separately from `synthesisOk: false` and absent/corrupt final artifacts. Do not blindly reuse an event named `run_completed`.

**Slice C — Medium #4, resume structure.** Extract restoration/hash verification into `worker-resume.js` and consider explicit phase dispatch, including synthesis-only continuation. Keep this separate if it would delay the proven worker fix. A phase dispatcher does not by itself prevent a completed synthesis call from being dropped; map-reduce synthesis has multiple calls and needs its own evidence model.

The original review suggested Medium #1–#3 could fit one commit. This handoff recommends separating worker cancellation semantics from storage durability because their acceptance criteria differ. Combining them is reasonable only if both receive independent regression evidence and the change stays small. Do not mark all of Item 2 closed after slice A.

Still outside slice A's guarantee:

- Unfinished requests may have unknown upstream billing and may run again on resume.
- SIGKILL can terminate between settlement and receipt; there is no handler that can guarantee a flush afterward.
- Planner, synthesis, and map-reduce partial-output persistence are not proven by a worker-only regression.
- Multiple writers to one run directory remain unsupported.
- Releasing a local reservation is not proof a provider did not charge the request.

## 11. Not bugs and scope exclusions

Preserve the September 6 review's boundaries:

- Started work without a terminal receipt is deliberately at-least-once: it may execute again. Fix the completed-then-discarded enlargement of that window, not the entire documented retry model.
- Do not skip torn event lines. A truncated success receipt could otherwise be mistaken for unfinished work. A clearer diagnostic is a separate improvement.
- Do not reject older saved plans solely because historical hashes are absent; existing plan validation still applies.
- Keep orderly signal handling rather than immediate `process.exit()`; active cleanup must drain.
- Preserve live resume guards against mode, cap, campaign, or missing-campaign drift.
- Preserve fetch-failure reservation release. Do not equate release with confirmed zero provider spend.
- Keep Starlark as a separate lab. No `run_workflow` tool or other new edge in `src/runner/**`.
- Do not edit `src/credentials.js`, `src/proxy.js`, `src/server.js`, authentication settings, or unrelated agents' work.
- Do not weaken evaluator assertions because a compiled evaluator is missing. Report skips or build with the supported toolchain when appropriate.

## 12. Next-agent execution and verification sequence

These are instructions for the implementing agent, not commands Alan needs to paste. Use a shell in the confirmed playground checkout or an intentionally isolated worktree. Before implementation, reread local instructions, inspect folder/root/branch/remotes/status/worktrees, coordinate ownership, and update safely from the intended baseline. Other agents are active: do not assume an apparently clean tree grants exclusive ownership.

1. Recheck this report against current `bridge.js`, `coordinator.js`, and `ledger.js`; another agent may already have changed them. Read the latest review banners and history.
2. Add the controlled settlement-boundary regression and record its failure on unfixed source. Preserve setup failures separately from product failures.
3. Implement only slice A and its direct tests. Add beginner-friendly comments explaining why completed-outcome recording is allowed during shutdown.
4. In the repository root, run the focused suite directly:

```bash
# Run in the confirmed playground repository root or the approved worktree root.
# These tests cover the adapter, worker cancellation/resume, and saved-plan integrity.
node --test starlark-host/test/r11-recovery.test.js starlark-host/test/plan-hash.test.js starlark-host/test/bridge.test.js
```

Success means zero failures and the newly added boundary assertions actually executed. The earlier 12-test count is historical; expect more after adding regression cases. A direct Node invocation avoids relying on extra arguments appended to the package's existing wildcard test command.

5. Run the full Starlark suite, then relevant repository gates from that same root:

```bash
# Check the entire separate Starlark lab, including resume and synthesis interactions.
npm --prefix starlark-host test
# Check for regressions elsewhere and for source/document consistency.
npm test
npm run lint
npm run check:docs
npm run format:check
```

If the evaluator is absent, report the exact skips. The September 7 report records Homebrew Go 1.26 at `/opt/homebrew/opt/go@1.26/bin/go`; verify availability rather than assuming it remains installed. A build in another worktree does not supply a binary here. Missing test tools are environment failures; do not weaken assertions or silently repair unrelated files to obtain a green result.

6. Compare changed files and final refs, update the original review's closure status only for findings actually fixed, and write a dated implementation handoff with its HTML companion. Report first-run failures, skips, residual risks, and exact validation scope.
7. Arrange the repository's subsequent Cursor invariant review after runtime work lands. Commit/push authority for this documentation task is not blanket authority for a later implementation session; follow that session's owner request.

No paid calls are needed to prove the deterministic worker boundary. Any later live trial must preserve uncertainty for interrupted requests and must not substitute for the regression test.

## 13. Handoff fields and documentation-only disposition

- **Folder/branch:** isolated documentation worktree and branch in section 2; shared `main` was inspected but not edited for this report.
- **Files changed:** `HANDOFF-starlark-abort-commit-next-slice-2026-09-16.md` and `.html` only.
- **Investigation checks:** exact prior results and limits in section 7; current baseline/source comparison in section 2.
- **Document validation:** `npm run check:docs` passed both documentation-default and runner-manifest checks. Prettier passed for both new files. Structural HTML validation confirmed identical report-body text to rendered Markdown, 20 valid links including 13 section anchors, and no external assets or scripts. Git whitespace checks passed. Browser rendering was not inspected; these are structural checks, not visual acceptance.
- **Skipped:** no new live experiment, full runtime suite, evaluator build, or power-loss test in this documentation turn; no runtime edits require those here. Browser rendering is separate from structural HTML checks.
- **Risks/follow-up:** concurrent work may supersede these anchors; runtime findings remain open; implement and verify slice A before claiming any closure, then address durability and broader phase-resume gaps.
- **Publication:** owner authorized commit and push of this report pair. The final response supplies the actual commit and verified remote state; this file cannot embed its own final commit identifier without changing it.
