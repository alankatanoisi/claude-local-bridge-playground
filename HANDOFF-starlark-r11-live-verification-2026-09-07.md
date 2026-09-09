# Starlark R11 — Go verification and live interruption evidence

**Follow-up:** Alan subsequently authorized the permission-cache correction. See the [fix and Cursor handoff](HANDOFF-permission-cache-fix-2026-09-07.md). This report preserves the earlier review state; its no-fix/no-publication statements and source-line references are historical.

> **START HERE for Go and Part 6 evidence — September 7, 2026 UTC (September 6 in Los Angeles).** This report extends [the R11 implementation handoff](HANDOFF-starlark-r11-2026-09-06.md). That older report remains the implementation record; its “Go absent” and “live unverified” statements are now historical. No runtime fixes were needed or made in this session. R8 keeps Starlark a separate laboratory; R12 evidence unification remains deferred.

**Result:** Go verification passed **104/104 with zero skips**. Three deliberately interrupted real `repo_fanout` runs resumed to completion. **$0.179656** is the local, usage-based cost estimate, independently reconciled against completed bridge responses. **Six interrupted requests have unknown provider billing.** A separate **$5 uncertainty hold** remains reserved in the session budget record.

**Browser companion:** [Open the standalone HTML report](HANDOFF-starlark-r11-live-verification-2026-09-07.html).

## 1. Location, authority, and disposition

- Current directory, repository root, and intended target: `/Users/alanman/.codex/worktrees/df82/claude-local-bridge-playground`.
- This intentionally isolated **worktree** is a separate working folder sharing the playground’s Git history. Common Git directory: `/Users/alanman/Developer/claude-local-bridge-playground/.git`.
- It began clean, directly at commit `406423b4d6ea1ead837b3bedb6f09f618a2a5d8a` without a named branch. A **commit** is a saved project version. Both local `origin/main` and a fresh GitHub `refs/heads/main` lookup matched that exact baseline.
- Session branch: `codex/starlark-r11-live-verification`. A **branch** names a line of saved project history.
- Origin: `https://github.com/alankatanoisi/claude-local-bridge-playground.git`. The owner’s main working folder and the canonical bridge repository were not edited. No pull or checkout was performed in the owner’s main folder.
- Alan explicitly authorized Go installation, evaluator verification, live calls, and interruption/resume experiments, with **$25 total across this task**, superseding the old $10 total/$2 per-run restriction. The existing $20 configuration ceiling remained unchanged.
- Final tracked-file differences are this new Markdown/HTML handoff pair only. Experiment settings were temporarily narrowed in this worktree and restored byte-for-byte. No runtime, test, bridge, authentication, proxy, or older dated-document edits remain.
- Nothing was committed or pushed in this task. The new documents remain local and uncommitted; raw evidence and the compiled evaluator are ignored by Git. Preserve this worktree to retain them.

## 2. Tooling and first-result evidence

Go was absent from the command search path. Homebrew installed its versioned `go@1.26` package. The executable reports **`go version go1.26.8 darwin/arm64`**, at `/opt/homebrew/opt/go@1.26/bin/go`. The lab declares Go 1.26.0; its real build succeeded with this compatible patch release. Binary inspection independently reports Go 1.26.8 and the locked `go.starlark.net` dependency. The official [Go installation guide](https://go.dev/doc/install) also documents verifying the installed toolchain with `go version`.

The command-specific search path included `/opt/homebrew/opt/go@1.26/bin`. No shell-startup file was edited. The resulting evaluator is `starlark-host/bin/starlark-eval` **inside this worktree**; the owner’s main checkout does not automatically receive that binary.

| Check                                                                   | First observed result                                 | Final applicable result                            |
| ----------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------- |
| Inherited Starlark tests before build                                   | 104 tests: **81 pass, 0 fail, 23 skip**               | Preserved as baseline                              |
| First `npm --prefix starlark-host run verify`                           | Build succeeded; **104 pass, 0 fail, 0 skip**         | All formerly skipped bodies ran                    |
| Final `npm --prefix starlark-host run verify`, original config restored | **104 pass, 0 fail, 0 skip**                          | Pass                                               |
| Root `npm test`                                                         | 1,084 tests: **1,083 pass, 0 fail, 0 skip, 1 TODO**   | Same measured baseline; no root runtime/test edits |
| Go `go test ./...`                                                      | Exit 0; evaluator package reports **[no test files]** | Package compilation, not a separate Go test suite  |
| `npm run lint`                                                          | Exit 127: **`sh: eslint: command not found`**         | Pass after `npm ci`                                |
| `npm run format:check`                                                  | Pass after dependency installation                    | Pass again with final handoff                      |
| `npm run check:docs`                                                    | Pass after dependency installation                    | Pass again with final handoff                      |
| Git whitespace/scope checks                                             | Clean baseline                                        | Final diff checked; handoff pair only              |

The root suite took about 123 seconds and used the normal home directory. Its one inherited TODO remains unfinished, not passed. The worktree lacked development dependencies; `npm ci` installed the lockfile’s packages without changing the lockfile. Its output reported one high-severity dependency advisory; this task did not investigate or modify dependencies to address it.

No evaluator or runtime assertion was weakened. The historical intermittent mock HTTP empty-body failure did **not** recur in either full evaluator verification here; its prior failures and unknown cause remain valid history. It must not be relabeled as a live bridge failure.

The final HTML companion was inspected in a browser at 1280 × 720 pixels; the title, metrics, uncertainty notice, navigation, and report text rendered clearly. Smaller-screen and print layouts are provided in the stylesheet but were not separately rendered during this task.

Other harmless setup diagnostics were retained: two optional Python Markdown-library import probes found missing packages, after which the already-bundled Node `marked` library rendered the companion. Read-only discovery commands also encountered unmatched optional-path globs. These are tooling/discovery outcomes, not test or model failures.

## 3. Experiment design and all attempts

The bridge’s actual Messages route returned HTTP (Hypertext Transfer Protocol) **400** with structured `invalid_request_error` for an empty request. That was an expected local validation check, not model acceptance. Subsequent real workflow responses established live behavior; no health endpoint was used as acceptance.

Every fresh run used the **actual** `starlark-host/bin/run-workflow.js` command with explicit live mode, `--max-cost-usd 5`, the same campaign, Haiku 4.5 for control/synthesis and Sonnet 5 for workers, full traces, and no injected fault profile. No substitute coordinator, planner, worker, or bridge was used. Private observer scripts launched children and sent signals only to the exact process identifiers they created.

Supported host configuration narrowed repository discovery to three real source files, totaling **33,378 bytes**: `src/runner/budget-broker.js`, `src/runner/permissions.js`, and `src/runner/session-ledger.js`. Each became exactly one worker job. The files cover token leases, permission decisions, and durable session records. Planner-generated Starlark saw metadata; workers received their assigned saved input.

| Trial | What it adds                                                                           | Stop and resume                                                                         | Observed peak upstream overlap | Recorded cost for this trial |
| ----- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------- |
| A     | Host-built JSON (JavaScript Object Notation) plan isolates live worker/resume behavior | SIGTERM; exit 143; same directory/campaign resumed, exit 0                              | 2 calls                        | **$0.058297**                |
| B     | Real model-generated Starlark plus three concurrent calls                              | SIGTERM; exit 143; same directory/campaign resumed, exit 0                              | 3 calls                        | **$0.059546**                |
| C     | Hard process death without cooperative cleanup                                         | SIGKILL; operating system reported that signal; same directory/campaign resumed, exit 0 | 3 calls                        | **$0.061813**                |

**SIGTERM** asks the process to stop and permits its cleanup handler to run. **SIGKILL** terminates it immediately and cannot run that handler. Every interruption occurred after one job had saved a success while two jobs remained unfinished. All three original interrupted segments remain preserved; the successful resumes do not erase them.

Trial B’s Starlark planner passed validation on **one attempt with zero repairs**. This is one successful planning sample, not a reliability estimate. Trial C used the host-built plan to isolate hard-crash recovery without another planning call.

Across all trials: **19 upstream requests**, comprising **13 completed responses** and **six deliberately interrupted requests**. Completed responses returned status 200 and usable usage records. There were **nine final job successes, zero recorded worker failures, and three completed synthesis stages**. Original/resume standard-error files were empty. No live attempt was excluded; no extra model-ranking campaign or unrelated workflow ran.

## 4. Independent terminal-state verification

Each run received independently named checks against its final saved state rather than a required whole-event sequence. The complete event ledger is JSONL: one JSON event per line.

- **Exactly one success per planned job:** three jobs and three terminal successes per run; nine across all trials.
- **Completed work reused:** the job finished before the stop has one start receipt across both segments. Its saved artifact feeds the completed result.
- **Unfinished work repeated:** each interrupted job has two start receipts, one before and one after resume, ending with one success. This is **at-least-once execution**: interrupted work may run more than once, even though only one success is recorded.
- **Historical bytes preserved:** every combined ledger retains the exact saved original prefix. Sequence numbers strictly increase across resume.
- **Cancellation behavior:** A/B have an abort receipt and no late job starts/results between that receipt and resume. C correctly lacks a cooperative abort receipt; its operating-system signal and preserved worker-phase record provide hard-stop evidence instead. This distinction was explicit in the observer checks, not an assertion removed to hide a failure.
- **Artifact integrity and coverage:** every input maps to one job; every success points to a parseable worker artifact with the expected fields; source-content hashes match saved input bytes. Independently recomputed plan/program fingerprints match accepted hashes, including B’s actual Starlark source.
- **Synthesis content:** all three synthesis artifacts link all intended job identifiers. Their text contains distinct budget reservation/release, permission-boundary, durable-history, and concrete-risk content, plus source-specific identifiers such as budget `acquire`/`release` and ledger cursor/recovery operations. Synthesis lengths were **6,644 / 5,076 / 6,965 characters** for A/B/C. These checks establish substantive source-specific coverage beyond file existence; they do **not** establish that every generated claim is correct. Generated maintenance-risk claims remain model analysis, not confirmed repository bugs.
- **Actual concurrency:** independent upstream start/end timestamps show peak overlaps of 2/3/3 for A/B/C. This cross-check uses bridge evidence rather than merely trusting configuration or `job_started` events.
- **Completed resume is a no-op:** both workflow and experiment entry points were invoked on every completed run: **six checks, all exit 0**, no ledger mutations, no new calls, and unchanged campaign bytes.

A further independent bridge-request cross-check joins each prompt’s document identifier to the accepted one-input-per-job plan. Across all three runs, saved successes each have one bridge request, and unfinished jobs each have two. The first observer incorrectly searched those prompts for job identifiers and therefore reported zero matched requests and false predicates for all three trials. That invalid observer result is preserved as `upstream-job-crosscheck-first-invalid-observer.json`; the corrected document-ID join matched all 15 worker requests. No runtime or saved evidence was changed to make this check pass.

All **13 applicable terminal-state/accounting predicates per run** passed. The hard-stop-specific predicate replaces the inapplicable cooperative-abort check only for C. The observer records and their private scripts are retained with the evidence.

## 5. Accounting and uncertainty

One durable campaign served every paid segment: **`starlark-r11-df82-20260907-a`**, with one fixed **$5 cap**. Resume never reset that allowance. A separate private aggregate record tracks the session’s $25 authorization: **$5 campaign allocation + $5 uncertainty hold + $15 unallocated**. No second campaign was needed. No more live spending is planned in this task.

The campaign has **13 unique settlements** totaling **$0.179656**. Independent cost calculation from the bridge’s complete received-response usage gives the same total within ordinary floating-point precision. All 13 usage fingerprints match the settlement records as a multiset, so neither segment loss nor duplicated known usage is hidden by the headline total.

There are **six released reservations**: four cooperative releases and two explicit `stale_pid` corrections on reopening after SIGKILL. No reservations remain open. Release records remain in the append-only history. Their original estimated amounts total **$0.166806**.

**The provider’s final bill remains unknown for those six interrupted requests.** The released estimates are not billing receipts or guaranteed upper bounds. The local $0.179656 is a catalog-based estimate from reported usage, not proof of a particular subscription or credit-bucket debit. Keep the larger $5 hold; do not convert canceled reservations into new spending capacity. The unused campaign balance is $4.820344, but this report does not authorize additional spending.

## 6. Evidence inventory and preservation

All relative paths below are inside the verified worktree unless stated otherwise.

| Evidence                    | Location                                                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Private verification bundle | `starlark-host/workflow-runs/verification-2026-09-07/`                                                                        |
| Trial A run                 | `starlark-host/workflow-runs/2026-09-07T01-10-34-504Z__repo_fanout__live__claude-haiku-4-5__claude-sonnet-5__none__208a5ec9/` |
| Trial B run                 | `starlark-host/workflow-runs/2026-09-07T01-13-09-629Z__repo_fanout__live__claude-haiku-4-5__claude-sonnet-5__none__2ea9af7a/` |
| Trial C run                 | `starlark-host/workflow-runs/2026-09-07T01-15-02-791Z__repo_fanout__live__claude-haiku-4-5__claude-sonnet-5__none__f57dd0bd/` |
| Original durable campaign   | `/Users/alanman/.bridge-runner/campaigns/starlark-r11-df82-20260907-a/budget.ledger.jsonl`                                    |
| Bridge traces               | Six exact paths in the private trial assessment records; originals under `/Users/alanman/.claude-local-bridge/traces/`        |

The verification bundle contains initial/final test logs, Go installation evidence, original/live configuration snapshots, exact child command/process receipts, before-resume ledger copies, private stdout/stderr, per-trial assessments, a final campaign snapshot, aggregate budget, independent final audit, and observer scripts. Each run retains its existing `collection.json`, `run-context.json`, `state.json`, `events.jsonl`, `result.json`, input artifacts, worker artifacts, and synthesis. No new evidence-layout subsystem was implemented.

Raw prompts, source payloads, provider responses, and ledger payload text are intentionally absent from this report. The verification directory is private (owner-only access); the existing run directories and files use the laboratory’s restricted permissions. Raw evidence remains Git-ignored. Removing this worktree would discard its ignored run evidence and compiled evaluator; the separate campaign and trace originals would remain in the home directory.

## 7. Handoff, limits, and next options

**Folder/branch:** verified worktree above; `codex/starlark-r11-live-verification`. **Files changed:** this new handoff pair only; no remaining runtime/configuration differences. **Checks:** first/final counts and tooling failures in section 2; 39 applicable per-run predicates, six no-op checks, and cross-source usage reconciliation. **Skipped:** no broader model comparison, no new workflow, no provider-bill reconciliation unavailable from interrupted responses, and no root-suite rerun after documentation-only edits. Go-native package tests do not exist; real evaluator behavior was exercised by the 104-test host suite. **Publishing:** no commit, push, merge, or changes to the owner’s main checkout.

R8 separation, R12 deferral, D-F3 behavior, retired flags, and bridge/authentication internals remain unchanged. One writer per run directory remains the supported assumption. Successful samples do not prove general model reliability, every possible cancellation race, or factual accuracy of all generated analyses. The historical mock-test intermittency and root TODO remain unresolved.

1. **Independent invariant review — recommended.** Review saved R11 implementation and this evidence without live spending. Benefit: another check of cancellation, replay, and accounting boundaries. Cost: review time; no additional runtime evidence unless requested.
2. **Focused synthesis-fidelity evaluation.** Define a small human-reviewed claim/evidence rubric for these saved artifacts. Benefit: tests factual grounding beyond the source-specific coverage checks used here. Cost: careful reading; it can begin at $0 using existing outputs.
3. **Use the evaluator in the owner’s main checkout later.** Build it there with the installed Go toolchain when that working folder is available. Benefit: enables the same checks outside this worktree. Cost: another local build and verification; the current task deliberately did not modify that checkout.

No substantive fix was discovered that required expanding this verification/experiment task. The additional Starlark/concurrency and SIGKILL trials were bounded owner-authorized experiments, not runtime redesigns. The original R11 task brief and older handoffs were preserved.
