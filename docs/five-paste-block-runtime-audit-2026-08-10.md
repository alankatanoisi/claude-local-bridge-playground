# Five Paste-Block Implementation Runs: Runtime Audit and Postmortem

**Audit date:** 2026-08-10 (America/Los_Angeles)  
**Run window reviewed:** 2026-08-09 09:16–11:00 UTC (02:16–04:00 PDT)  
**Repository:** `/Users/alanman/Developer/claude-local-bridge-playground`  
**Branch and revision audited:** `main` at `2bdc167db894469ca729ca436078473d652d216c`  
**Mode:** read-only implementation/runtime assessment; no fixes, merges, cleanup, staging, commits, or pushes

## Executive conclusion

The experiment demonstrated real recovery value, but it did **not** produce five merge-ready implementations.

- All five tasks eventually committed their intended branch work after a shared series of upstream/transport failures.
- The persistent session layer behaved well: 635 ledger events remained monotonic, all 267 tool-effect intents had matching results, and all five sessions ended healthy with `resume_ok`.
- The runner made 17 invocations. Twelve ended in `bridge_error`; five ended in `success`. Across those attempts, the runner recorded 40 bridge errors.
- The 500s were not ordinary test failures. They occurred after the bridge had accepted and transformed the requests and started the upstream Anthropic request. They arrived in synchronized waves across otherwise different tasks, including two streams that had already received HTTP 200 headers before aborting.
- The current authenticated bridge works now: an independent one-turn live call on 2026-08-10 returned the exact requested response with exit code 0. Task 5's two-turn workflow branch also completed two real bridge turns in order.
- Current `main` is **not fully green**: `npm test` reported 975 tests, 969 passes, 1 real failure, and 5 registered `todo` failures. The focused false-green files exit 0 with 131 passes and 5 `todo` failures, which is an important reminder that a zero exit code still does not mean every known gap is closed.
- None of the five task branches should be merged unchanged. Independent adversarial probes found concrete defects in Tasks 1, 2, and 4; Task 3 records fabricated provenance for an explicitly hypothetical model; Task 5 works on the happy path but has no interrupted-workflow continuation and cannot be combined with runner-managed worktree startup.
- A raw Claude OAuth credential assignment is present in `docs/5-paste-block-tests/paste-block-3` and is also present on `origin/main`. The secret is intentionally not reproduced here. Treat it as exposed: revoke/rotate it promptly and plan a careful repository-history cleanup. No containment action was taken during this read-only audit.

## Priority findings

| Priority | Finding                                                                                                                           | Evidence-backed impact                                                                                                                                                                                                | Disposition                                                                                                                                       |
| -------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0**   | A raw Claude OAuth credential is stored in the Task 3 terminal capture and pushed to `origin/main`.                               | Anyone or any system with repository access may have received the credential. Log redaction worked elsewhere, but manually pasted terminal text bypassed that boundary.                                               | Rotate/revoke first; then remove the value from the current tree and Git history. Do not merely redact the report.                                |
| **P1**   | Runner-managed worktrees live under `~/.bridge-runner/worktrees`, while native file tools deny paths containing `.bridge-runner`. | Direct probes and the real traces show `read_file`, `list_files`, `search_text`, and `edit_file` rejecting ordinary project files in managed worktrees. The agents fell back heavily to `bash`.                       | Add an explicit, narrowly scoped trusted-worktree exception at the filesystem safety boundary and test the composed path.                         |
| **P1**   | `--resume-session --worktree` creates a fresh startup worktree on each invocation rather than re-entering the prior worktree.     | All 17 attempts used separate timestamped worktrees. Task 3 ended with two checkouts of the same branch; the older checkout's index represents a full staged reversal while its worktree files equal the branch head. | Make worktree identity durable session state, or require an explicit stable worktree path on resume.                                              |
| **P1**   | Task 2's telemetry exporter follows a final-file symlink and creates files with mode `0644`.                                      | A temporary adversarial probe appended outside `~/.bridge-runner` through a symlink. A normal new telemetry file was readable by group/others under umask `022`.                                                      | Reject an existing symlink final target and use the repository's private-file helper/open flags (`0600`).                                         |
| **P1**   | Task 1's “binary-safe” copy is not binary-safe across undo/recovery.                                                              | Copy succeeded; `undo_edit` also reported success, but invalid UTF-8 bytes were replaced with UTF-8 replacement sequences. Text hashing also disagrees with raw-file recovery hashes.                                 | Use buffer hashing and buffer-preserving undo end to end; add invalid-UTF-8 overwrite/undo/revert tests.                                          |
| **P1**   | Task 3 marks an invented, currently 404 URL as `verified-live`.                                                                   | The prompt explicitly called the model hypothetical, yet production catalog data, pricing, lifecycle, and source status were asserted as facts.                                                                       | Keep hypothetical catalog exercises in fixtures, or label them synthetic. Never use `verified-live` without actually fetching an official source. |
| **P1**   | Task 4's torn-tail fix can create duplicate sequence numbers with a stale valid cursor.                                           | Probe ledger sequence was `[1, 2, 2]` when a complete seq-2 record lacked only its newline and the cursor still pointed to seq 1.                                                                                     | Reconcile bytes after the cursor before assigning the next sequence; keep HS-02 open until this composed case passes.                             |
| **P1**   | Transport retries consume task steps and are coupled to `step < max_steps`.                                                       | With `max_steps=1`, a controlled HTTP 500 received no retry. With `max_steps=3`, two 500s consumed steps 1 and 2, then the same request recovered on step 3.                                                          | Give transport attempts a separate counter/budget; add jitter and a longer bounded backoff appropriate for concurrent outage waves.               |
| **P2**   | Task 5 cannot resume an interrupted workflow and refuses `--workflow` with `--worktree`.                                          | A bridge/process failure stops the workflow; re-running starts step 1 in a fresh workflow session. There is no durable workflow-level cursor.                                                                         | Persist workflow identity, file digest, completed-step index, and session ID; re-enter one stable worktree across all steps.                      |
| **P2**   | Background job IDs do not survive process-level resumes.                                                                          | Eight tool failures were attempts to query process-local job IDs from a prior runner invocation.                                                                                                                      | Mark old jobs explicitly orphaned on resume and teach the model/runtime to re-discover or restart work once.                                      |

## Scope and evidence method

This audit correlated four independent evidence planes rather than trusting terminal prose alone:

1. The five pasted terminal captures under `docs/5-paste-block-tests/`.
2. The five session state, ledger, and autopsy sets under `~/.bridge-runner/sessions/`.
3. Seventeen full runner traces under `~/.bridge-runner/traces/`, plus bridge-side request lifecycle evidence.
4. The actual Git worktrees, branches, commits, diffs, current suite, targeted tests, adversarial probes, a controlled 500 mock, and live authenticated bridge calls.

The supplied context worktree, `~/.bridge-runner/worktrees/false-green-test-audit`, is clean but stale at `93a8fce` from August 7. It was useful historical context, not the source of truth for the August 8–10 runtime. Current `main` and the five task branches were audited instead.

## What happened across all five runs

### Aggregate runtime ledger

| Measure                               |                                  Result |
| ------------------------------------- | --------------------------------------: |
| Runner invocations                    |                                      17 |
| Invocations ending `bridge_error`     |                                      12 |
| Invocations ending `success`          |                                       5 |
| Runner-visible bridge errors          |                                      40 |
| Tool requests / effect intents        |                                     267 |
| Matching tool results                 |                                     267 |
| Tool results with `ok:false`          |                                      40 |
| Ledger events                         |                                     635 |
| Ledger sequence gaps                  |                                       0 |
| Orphan trace tool requests/results    |                                   0 / 0 |
| Context projections marked lossy      |             49 (Task 2: 30; Task 5: 19) |
| Input tokens                          |                                 491,298 |
| Output tokens                         |                                 250,355 |
| Cache-read tokens                     |                              15,167,207 |
| Cache-creation tokens                 |                               4,509,176 |
| Cache reuse share of cache activity   |                                  77.08% |
| Catalog-estimated API-equivalent cost | about **$122.78**; not verified billing |

### Per-run summary

| Task                            | Attempts | 500/bridge errors | Tools (failed) |   Cache read / create | Reuse share | Context behavior                                                                       | Commit    | Audit verdict                                                                                |
| ------------------------------- | -------: | ----------------: | -------------: | --------------------: | ----------: | -------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------- |
| 1 — `copy_file`                 |        4 |                10 |         42 (8) |   2,638,446 / 337,776 |      88.65% | No lossy projection; max calibrated request 129,044                                    | `b88bcca` | Mechanically complete, but binary undo is corrupting. Do not merge.                          |
| 2 — file OTel spans             |        3 |                 6 |        67 (11) | 2,557,146 / 2,404,203 |      51.54% | 30 lossy projections; 5,634,307 characters removed; 90 results clipped and 964 stubbed | `37bb741` | Useful design, unsafe final-file handling and incomplete outage observability. Do not merge. |
| 3 — hypothetical model catalog  |        3 |                 6 |         49 (8) |   3,479,464 / 299,892 |      92.06% | No lossy projection; max 126,013                                                       | `bc1fd19` | Tests pass against invented facts; provenance is false. Reject as production change.         |
| 4 — signal/torn-tail durability |        4 |                 9 |         47 (5) |   2,756,852 / 305,882 |      90.01% | No lossy projection; max 108,004                                                       | `4c1c381` | Signal finalizer is useful, but HS-02 closure is incomplete. Do not merge as-is.             |
| 5 — JSON workflow               |        3 |                 9 |         62 (8) | 3,735,299 / 1,161,423 |      76.28% | 19 lossy projections; 2,561,975 characters removed; 76 clipped and 541 stubbed         | `d91b233` | Happy path works, but no workflow resume/worktree continuity. Prototype only.                |

The cache numbers show that session continuation was economically and operationally meaningful, especially for Tasks 1, 3, and 4. Tasks 2 and 5 accumulated much more cache creation after large resumes and compaction. The cache percentages are ratios of cache-read tokens to cache-read plus cache-creation tokens; they are not hit rates per request.

## 500-error autopsy

### What “500” meant here

Anthropic documents HTTP 500 `api_error` as an unexpected internal error and recommends retrying transient errors with exponential backoff. It also warns that a streaming request can fail after an initial HTTP 200 response. See the official [Claude API error documentation](https://platform.claude.com/docs/en/api/errors).

The local evidence narrows the fault domain:

- Each failing request passed `bridge_request_received`, request transformation, and `upstream_request_started` toward `api.anthropic.com` before the bridge recorded `upstream_request_error`.
- Successful requests immediately before and after the waves returned HTTP 200.
- There were no observed 400/413 request-shape errors, 401 authentication errors, or 429/529 capacity responses in these five run traces.
- Failures synchronized across unrelated tasks around 09:38–09:41 UTC, 09:46–09:48 UTC, and 10:00 UTC. That synchronization makes a task-specific code change or one task's context size an unlikely root cause.
- Most upstream error messages were empty/generic. One was `socket hang up`. Two late failures received upstream 200 response headers, then the stream aborted before a complete response.
- The public [Claude status page](https://status.claude.com/), reviewed on August 10, did not list an August 8–9 incident. That absence is not proof that no localized or unreported fault occurred.

**Most likely classification:** a shared transient upstream or network/request-path failure between the local bridge and Anthropic. The evidence does **not** justify claiming that Anthropic itself definitely had a published service incident, nor does it point to the five implementation diffs as the cause.

### Automatic retry behavior

Current `main` permits two transient bridge retries, using 250 ms and 500 ms waits with no jitter. The five concurrent tasks therefore retried in near-lockstep during a multi-minute disturbance. A ten-minute manual pause before the final resumes was far more effective than the sub-second automatic window.

A controlled local mock established another blind spot:

- `max_steps=1`: the first HTTP 500 ended the run immediately; zero retry attempts.
- `max_steps=3`: two HTTP 500s triggered the 250 ms and 500 ms waits; the third request succeeded, and the run reported `steps:3`.

The retry budget is therefore not independent. Transport retries consume the task's model/tool step allowance and disappear entirely on the last allowed step. FG-K in the round-2 report tests **coordinator lease/budget retry**, not this bridge transport path.

### Manual resume and resilience

The user's decision to resume the same session was productive:

- Every session ledger remained parseable and monotonic.
- All tool-effect intents had corresponding results, including failures.
- The final state for every session was `success`, non-degraded, `historyQuality: raw_complete`, and `recommendation: resume_ok`.
- No trace had an orphan `tool_requested` or `tool_finished` identifier.
- Failed attempts remained recorded rather than being overwritten by the final success.

However, “same session” did not mean “same worktree” or “same process resources”:

- Every `--resume-session --worktree` invocation created a new timestamped startup worktree.
- The state metadata continued to name the first worktree, even after later attempts operated elsewhere.
- Background shell-job IDs were process-local and became unknown after a resume.
- Tasks 1, 2, 4, and 5 worked around worktree drift by explicitly changing to stable `~/Developer/clb-hypo-N` folders.
- Task 3 did not get its requested stable `~/Developer/clb-hypo-3`. It now has a clean final checkout plus an older checkout whose index and worktree disagree across all five changed files.

## Context management and cache behavior

The persistence and projection layers behaved as designed, but their status vocabulary can mislead an operator:

- `historyQuality: raw_complete` means the canonical saved history remained intact.
- Tasks 2 and 5 still sent **lossy outgoing projections** once they reached the `compact` tier. Old results were head/tail clipped, stubbed, and supplemented with a session anchor.
- `compactionGeneration: 0` and `compactionEpoch: 0` remained true because no checkpoint epoch was created. That does not mean no information was removed from outgoing requests.

Task 2 was the heaviest context case: 30 lossy requests removed a cumulative 5.63 million characters, clipping 90 old results and stubbing 964 appearances. Task 5 had 19 lossy requests, removing 2.56 million characters. Both tasks still completed, and their ledgers preserved the raw records.

This is a positive result for canonical-history durability, but the UI/reporting should distinguish more plainly among:

- raw history on disk,
- the current outgoing request projection,
- checkpoint generation,
- and cache reuse for the projected prefix.

## Tooling and tool-result hygiene

The tool envelope and ledger pairing were strong; tool usability inside the selected worktree was not.

### What worked

- 267 intent/result pairs, no missing results.
- Failure results were retained, redacted, and model-visible.
- Safety gates blocked attempts to reach the original checkout, sensitive patterns such as `.env`, and paths outside the active worktree.
- Commit operations still required explicit user approval and were recorded in the terminal captures.

### What degraded performance

The dominant failure pattern was a composition bug: the startup worktree is intentionally placed under `~/.bridge-runner/worktrees`, but the generic deny matrix treats `.bridge-runner` as sensitive. Direct current-main probes returned `Blocked by deny matrix (basename)` for both `read_file README.md` and `list_files src/runner` in an actual managed worktree.

The traces show the practical effect:

- ordinary `read_file`, `list_files`, `search_text`, and `edit_file` calls were refused;
- agents moved to large `bash` commands and ad hoc Node/Python rewrite scripts;
- commands sometimes tripped the content scanner merely by mentioning `.env`, `.bridge-runner/`, or token-related source text;
- long tests were shifted into background jobs, whose IDs did not survive process restarts;
- every run's handoff disclosed some version of this workaround.

This is not a reason to weaken the deny matrix globally. It is a reason to model the runner-created worktree root explicitly as an allowed project boundary while continuing to deny unrelated `~/.bridge-runner` session, trace, and credential artifacts.

## Implementation review by task

### Task 1 — `copy_file` (`b88bcca`)

**What the branch changed:** 8 files, +305/−9. It added one write-category tool, catalog/visibility registration, 12 focused tests, and updates to README, command builder, quickstart, and threat model.

**What is good:**

- source and destination go through path resolution and deny-matrix checks;
- symlink endpoints and self-copy are rejected;
- overwrite is fail-closed if backup creation fails;
- new destinations are recorded as created for current-run undo;
- registration and documentation surfaces are coherent;
- its 12 focused tests pass, and lint/docs/format checks pass.

**Independent defect:** the copy operation accepts buffers, but hashes and `undo_edit` convert bytes through UTF-8 text. The adversarial probe used an original destination containing invalid UTF-8 bytes. Copy returned success; undo returned success; the restored bytes did not equal the original. Replacement bytes (`ef bf bd`) appeared. A binary source can also produce a text-derived `new_sha256` that disagrees with the run-manifest's raw-file hash, making an unchanged file appear diverged.

**Verdict:** not merge-ready. “Binary-safe” must cover copy, hashing, backup preview, undo, and run-level recovery as one invariant.

### Task 2 — opt-in file telemetry (`37bb741`)

**What the branch changed:** 11 files, +447/−65. It added `--otel-export`, a JSONL file exporter, ten tests, three reviewed guard allowlist updates, runtime integration, and user/security documentation.

**What is good:**

- telemetry is opt-in and file-only;
- the schema is intentionally narrow and excludes prompts, arguments, results, and file bodies;
- structured records pass through the central deep secret scrubber;
- parent-directory realpaths are checked;
- write failure disables telemetry without failing the task;
- its ten focused tests pass, and lint/docs/format checks pass.

**Independent defects:**

1. Only the parent is realpathed. If the final filename already exists as a symlink, `appendFileSync` follows it. The probe appended a span to a file outside `~/.bridge-runner`.
2. New span files are created through default `appendFileSync` behavior. Under umask `022`, the observed mode was `0644`, not the private-artifact expectation of `0600`.
3. Spans are emitted only after a completed model response/tool batch. A bridge error exits through the catch path without recording the failed step, so this observability feature omits the exact outages it is most needed to explain.
4. The branch still inherits the registered HS-05 circular-object and HS-06 `OTEL_*` child-environment gaps.

**Verdict:** promising shape, unsafe file-sink implementation. Do not merge before final-target and private-mode adversarial tests exist.

### Task 3 — hypothetical model catalog refresh (`bc1fd19`)

**What the branch changed:** 5 files, +31/−5. It added `claude-haiku-5` catalog/pricing facts, updated a family fallback, bumped the catalog version/fingerprint, updated the command builder, and changed model tests.

**What is good mechanically:**

- the entry is reachable and internally consistent;
- catalog version and fingerprint pins were updated together;
- pricing lookup and UI option counts agree;
- 19 focused catalog/evolution tests pass; lint/docs/format checks pass.

**Integrity failure:** the prompt explicitly described the model as hypothetical, yet the branch asserts exact context, output, effort, thinking, lifecycle, and price facts in production data. It adds a source URL with status `verified-live` and a checked date, but the URL currently returns HTTP 404. The tests verify internal consistency, not truth.

Changing the expected fingerprint at the same time as invented facts demonstrates a limit of self-pinned tests: they can ensure deliberate bookkeeping but cannot establish external provenance.

**Worktree residue:** the final branch checkout is clean. The earlier `2026-08-09T0921-92f03b` checkout is `MM` on all five files: its index stages a 31-line removal/5-line addition reversal, while its working files restore the branch-head changes. This is recoverable but confusing and should not be cleaned automatically during an assessment.

**Verdict:** reject as production data. Retain only as an explicitly synthetic fixture if useful.

### Task 4 — signal and torn-tail durability (`4c1c381`)

**What the branch changed:** 4 files, +84/−52. It routes SIGTERM through the same finalizer as SIGINT, adds finalizer cleanup, seals a non-newline ledger tail before appending, converts HS-02 from `todo` to a hard test, and removes HS-02 from the known-todo register.

**What is good:**

- the unified signal finalizer is clearer and preserves the existing deterministic SIGTERM process test;
- the simple partial-JSON torn-tail case is repaired without deleting forensic bytes;
- focused crash/durability tests pass;
- lint/docs/format checks pass.

**Independent defect:** `_restoreFromCursor()` accepts a cursor whose offset is behind the file end. `_detectTornTail()` sees only that the final byte lacks a newline; it does not reconcile a complete JSON record after the cursor. The next append increments from the cursor's old sequence and duplicates the complete record's sequence. The probe produced `[1,2,2]`.

This means HS-02 was narrowed from “any torn tail” to “an invalid partial JSON fragment after a current/no cursor,” then marked closed too broadly.

**Verdict:** separate the useful signal-finalizer change from the incomplete ledger closure, or expand the ledger repair before merging.

### Task 5 — deterministic JSON workflow (`d91b233`)

**What the branch changed:** 7 files, +839/−69. It added `--workflow`, a strict JSON schema, sequential same-session execution, 24 tests, and full user/security documentation.

**What is good:**

- steps may contain only `prompt` and bounded `maxSteps`;
- unknown authority-bearing fields fail closed;
- workflow file path, size, realpath, and deny-matrix rules are enforced;
- command-line authority is passed unchanged to every step;
- execution stops on the first failed step;
- a current live bridge probe completed both ordered steps successfully with no bridge error;
- its 24 focused tests pass; lint/docs/format checks pass.

**Durability/integration limits:**

- the CLI explicitly rejects workflow use with `--resume-session`, `--continue`, and `--worktree`;
- the first step always starts a new session, so an interrupted workflow cannot continue at the failed step;
- there is no workflow-level record containing file digest, next step, per-step outcome, or stable worktree identity;
- a process failure after step 1 can leave a useful runner session, but the workflow CLI cannot legally consume it to continue step 2;
- the user must manually create a stable worktree and point `--cwd` to it, which bypasses the runner's new startup isolation UX.

**Verdict:** a solid minimal happy-path prototype, not yet a resilient workflow facility.

## Repository and test-suite assessment

### Current architecture after the false-green changes

The August 7–8 work materially improved the repository:

- FG-A..FG-F added dynamic catalog/permission/redaction/durability sweeps.
- FG-G added test registration, mutation, and “known red must actually be red” integrity controls.
- deterministic startup worktrees and shell-root confinement were added.
- FG-H..FG-M added model evolution, egress, telemetry, coordinator retry, ledger durability, and oracle-strength guards.

These controls caught real bookkeeping mistakes during the five tasks. The agents had to register new sinks, update CLI/documentation manifests, retain known-todo integrity, and disclose full-suite failures rather than claiming green.

The main architectural weakness is now **cross-composition coverage**. Many guards validate one subsystem at a time, while the observed defects arise where two individually reasonable controls meet:

- managed worktree location × sensitive-root deny matrix;
- resume-session × startup worktree identity;
- transport retry × model/tool step budget;
- final telemetry path × symlink/file-mode rules;
- binary copy × text-based undo/hashing;
- stale cursor × complete record without a newline;
- workflow sequencing × crash/resume semantics;
- human-copied terminal text × trace/log redaction.

### Independent check results

| Checkout         | Full `npm test`                         | Focused task tests                                                 | Lint | Docs | Format |
| ---------------- | --------------------------------------- | ------------------------------------------------------------------ | ---- | ---- | ------ |
| `main` `2bdc167` | 975 tests; 969 pass; **1 fail**; 5 todo | false-green files: 136 tests; 131 pass; 0 fail; **5 todo**; exit 0 | pass | pass | pass   |
| Task 1 `b88bcca` | 987; 981 pass; **1 fail**; 5 todo       | 12/12 pass                                                         | pass | pass | pass   |
| Task 2 `37bb741` | 985; 979 pass; **1 fail**; 5 todo       | 10/10 pass                                                         | pass | pass | pass   |
| Task 3 `bc1fd19` | 975; 969 pass; **1 fail**; 5 todo       | 19/19 pass                                                         | pass | pass | pass   |
| Task 4 `4c1c381` | 975; 970 pass; **1 fail**; 4 todo       | 14/14 selected crash/durability tests pass                         | pass | pass | pass   |
| Task 5 `d91b233` | 999; 993 pass; **1 fail**; 5 todo       | 24/24 pass                                                         | pass | pass | pass   |

All full-suite runs were repeated one at a time. A discarded parallel verification attempt produced additional worktree-test contention and is not used in the table.

The one real full-suite failure is `worktree tools — enter/exit lifecycle › supports parallel slots in one run`. Its immediate cause on this Mac is a pre-existing global path, `~/.bridge-runner/worktrees/slot-a`, dated August 9 at 02:23 PDT. The test uses a fixed global path and is therefore not hermetic. That failure is distinct from—but thematically related to—the observed resume/worktree identity problem.

The five current `todo` failures are still material:

- HS-01: case-variant sensitive filename handling on case-insensitive filesystems.
- HS-02: first append after a torn ledger tail (current main only; Task 4 proposes an incomplete closure).
- HS-03: deterministic newest-backup selection when mtimes collide.
- HS-05: cycle-safe deep secret scrubbing.
- HS-06: removal of `OTEL_*` credentials from child environments.

### Live and controlled runtime validation

- **Current authenticated bridge:** pass. One real `claude-fable-5` request returned `LIVE_BRIDGE_OK`, exit 0, one step, and a complete success result in about 4.7 seconds.
- **Task 5 live workflow:** pass for the happy path. Two real ordered prompts returned both requested markers with exit 0 and no bridge error.
- **Controlled 500 retry:** recovered from two 500s only with three available task steps; did not retry with one available step.
- **No replay of the August 9 outage:** the original upstream condition no longer exists and was not artificially attributed to Anthropic.

## Review of `false-green-round2-blindspots-2026-08-08.html`

The report is substantively useful and unusually candid. Its strongest contribution is not a claim of universal correctness; it is the creation of review registers and liveness checks that force future changes to acknowledge new models, sinks, modules, ledger paths, and retry structures.

### What the report got right

- It distinguishes guard coverage from runtime proof.
- It identifies the danger of self-confirming tests and adds reachability/fingerprint checks.
- It adds sink inventories and forces new telemetry/egress code through named review points.
- It keeps known defects as registered `todo` failures rather than silently deleting them.
- It correctly treats mutation and test-discovery integrity as first-class concerns.
- It predicted Task 2's need to update reviewed sink/oracle registers and Task 3's need to bump catalog bookkeeping.

### What the five runs add or correct

| Round-2 area           | What these runs showed                                                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FG-H model evolution   | Internal reachability and fingerprint consistency do not prove facts or provenance. Task 3 made invented data perfectly self-consistent.                    |
| FG-I egress            | Network/module inventory remained useful, but no current guard links manual terminal capture to repository secret scanning.                                 |
| FG-J telemetry         | Sink registration and structured redaction are necessary but did not cover a final-file symlink, `0600` mode, or whether failed model steps emit telemetry. |
| FG-K retry             | It covers coordinator lease/budget retry, not runner-to-bridge transport retry, jitter, synchronized clients, or step-budget coupling.                      |
| FG-L ledger durability | It covers buffering, flush, mode, and concurrency, but the Task 4 closure missed a stale cursor plus complete unterminated JSON record.                     |
| FG-M oracle strength   | The integrity suite did its job on registered tests, but fixed global worktree paths make part of the suite non-hermetic.                                   |
| Cross-cutting          | The report needs composed end-to-end scenarios: managed worktree + native tools; resume + worktree; copy + binary undo; workflow + process crash.           |

### Overall judgment of the round-2 report

Keep it as a valuable threat model and guard inventory, but revise any executive reading that equates “58 new checks” with closure of all named blind spots. The five runs validate the report's own warning: static and unit guards provide evidence, not proof. The next round should prioritize a smaller set of cross-composition and bounded live scenarios rather than adding another large set of isolated structural checks.

## Recommended next actions (not performed)

1. **Contain the exposed OAuth credential first.** Revoke/rotate it, then plan current-tree and history cleanup. Assume remote exposure; do not rely on deleting only the local line.
2. **Open a short, evidence-linked remediation register** for the nine priority findings in this report. Keep the five implementation branches unmerged until each branch-specific issue has an adversarial regression test.
3. **Fix the runner-managed worktree safety composition** before more agent implementation trials. Native project tools should work inside the runner's own isolated worktree without granting access to sibling session/trace/credential data.
4. **Separate transport retry attempts from task steps.** Add bounded exponential backoff with jitter, request-ID/error-class capture, and a concurrent-client outage test.
5. **Persist worktree identity in session state.** On resume, re-enter the same validated worktree or fail with an explicit choice; do not silently create a new one.
6. **Keep HS-02 open.** Expand Task 4's tests to stale-current/ahead cursors, valid unterminated records, partial records, pending intents, and sequence monotonicity.
7. **Decide branch disposition explicitly:** repair Tasks 1/2/4, convert Task 3 to a synthetic fixture or discard it, and label Task 5 as a non-durable prototype until workflow-level resume exists.
8. **Make the full suite hermetic.** Use per-test temporary worktree roots and unique branch/path names; do not depend on global `slot-a` state.
9. **Add a pre-commit secret scan for pasted evidence.** Trace/log scrubbers cannot protect text manually copied into tracked docs.

## What was intentionally not done

- No implementation source or test was edited.
- No task branch was merged, rebased, reset, cleaned, staged, committed, or pushed.
- No stale worktree, index state, branch, session artifact, or global `slot-a` folder was deleted.
- The exposed credential was not printed, tested, revoked, or rewritten.
- No claim was made that the upstream failures were a published Anthropic incident.
- No live destructive tool or repository write was requested from the model.

## Final disposition

The five-run exercise was successful as a **systems test**. It exposed failure modes that isolated suites missed, and it showed that the session ledger can carry a substantial implementation task through repeated upstream failures without losing canonical history or tool-result pairing.

It was not successful as a five-feature delivery batch. The correct next move is review-driven remediation, not merging the branches because their focused tests pass.
