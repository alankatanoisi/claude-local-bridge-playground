# Synthesis resume: durable success evidence

Prepared September 18, 2026. Local offline implementation; both tasks combined and verified for owner-authorized publication.

[Open browser companion](HANDOFF-synthesis-resume-evidence-2026-09-18.html)

## 1. Outcome and precise guarantee

A successful synthesis retry can now be recovered from its durable synthesis_resume_completed receipt and the synthesis artifact it names, even if the later state.json checkpoint and result.json writes are lost. A checkpoint is a saved summary of progress; an artifact is a saved output file. Recovery reuses the text and makes zero new model calls.

The fix shares one reconstruction helper between synthesis-only resume and ordinary worker-run restoration. It consults successful retry evidence before the older run_completed receipt. An original run_completed with synthesisOk: false still means partial unless a later synthesis retry succeeded. Existing worker results remain unchanged.

This is deterministic local evidence, not a live-provider reliability claim. No live model calls were made and no runner, bridge, or authentication source was changed.

## 2. Folder, branch, commits, and concurrent work

Initial read-only preflight confirmed the requested folder and repository root were /Users/alanman/Developer/claude-local-bridge-playground, branch main, with a clean working tree and the expected playground remote. Local main, origin/main, and GitHub refs/heads/main all matched 912cc6e4cc9dc63031c2c16c5b157eefeb52c9ee. The required git pull --ff-only origin main reported Already up to date.

Another Codex conversation subsequently changed coordinator.js and added abort-commit-boundaries.test.js. Both files had modification times of September 18, 2026 at 11:13:10 a.m. Pacific; this task did not edit them. Alan confirmed that separate conversation. The original focused tests had finished at 11:13:07 a.m.

Isolated verification folder: /Users/alanman/Developer/claude-local-bridge-synthesis-resume-2026-09-18. Branch: codex/synthesis-resume-evidence-2026-09-18. This is an intentionally created Git worktree, meaning a separate working folder with its own branch and shared repository history. Its verification base was 912cc6e4cc9dc63031c2c16c5b157eefeb52c9ee. Alan subsequently authorized this session to own both tasks, check them together, and commit, push, and synchronize the finished work.

Only this task’s three source/test files were copied into the isolated worktree. The earlier copies were deliberately not removed while another writer was active. After Alan confirmed the other session had finished, the shared three-file patch was checked byte-for-byte against the saved patch. It matched. Only these three files were then updated to the final formatted version. The other task’s source, test, and report hashes were unchanged. This report and evidence were also copied back to the original folder. Both folders now contain the same synthesis fix; do not apply it a second time.

## 3. What changed

starlark-host/src/worker-resume.js: adds restoreSynthesisResume, reusing strict event parsing and reading the receipt’s saved text. It validates receipt fields and artifact text, rejects artifact paths outside the artifact folder (including escaping symbolic links), restores completed phase/strategy/time, clears the old failure, and uses lastSeq to avoid adding retry calls twice. Ordinary restoration checks this evidence before the original run_completed event.

starlark-host/src/resume-synthesis.js: consults the shared helper before attempting synthesis. When recovery succeeds, it rewrites state.json and result.json and returns success with calls: 0. Completed runs without a synthesis-resume success receipt retain the existing rejection behavior.

starlark-host/test/synthesis.test.js: adds 11 deterministic cases covering both restoration entry points, absent/stale result files, repeated recovery, missing result after a completed checkpoint, and six damaged-evidence cases. Small formatting changes in existing lines accompany formatting of these files.

This Markdown handoff, its standalone HTML companion, and docs/artifacts/synthesis-resume-evidence-2026-09-18/ preserve the evidence. manifest.json records SHA-256 hashes (content fingerprints) for the three final source/test files.

## 4. Red-before-green evidence

Before runtime edits: node --test starlark-host/test/synthesis.test.js ran 11 tests: 7 passed and all 4 new lost-write cases failed, with zero skips. Synthesis-only recovery attempted the forbidden model substitute; ordinary restoration returned partial instead of completed. The original failure log is preserved as docs/artifacts/synthesis-resume-evidence-2026-09-18/red.txt.

The regression first completes a retry through the real local synthesis/ledger code with a deterministic model substitute. It then restores the older partial checkpoint and removes or replaces result.json while preserving the real success receipt and artifact. This recreates the persisted crash-window state without timing races or paid calls.

After the runtime fix, the same initial 11 tests passed. After additional integrity and repeat-recovery cases, the isolated focused suite passed all 31 tests with zero failures and zero skips (7.793 seconds). Assertions verify completed state, exact text, preserved worker results, correct strategy and cumulative calls, no extra model invocation, and byte-identical event history.

The worker entry-point cases directly exercise restoreWorkerRun. Existing coordinator integration tests also run in the focused suite, including successful original completion and the synthesisOk:false partial-run distinction. The new cases are not command-line process or power-loss tests.

## 5. Verification and known formatting failure

Isolated full Starlark verification: PATH=/opt/homebrew/opt/go@1.26/bin:$PATH npm --prefix starlark-host run verify rebuilt the evaluator and passed 122/122 tests, zero failures, zero skips (test phase 15.761 seconds). The earlier shared-checkout run passed 128 tests but included six tests from the other task; it is not used as isolated acceptance evidence.

Isolated focused command: node --test starlark-host/test/synthesis.test.js starlark-host/test/r11-recovery.test.js starlark-host/test/ledger.test.js. Isolated repository npm run lint and npm run check:docs passed. An explicit ESLint check of all three changed Starlark JavaScript files also passed, because the repository lint command does not include starlark-host.

Isolated repository npm test passed with 1,106 tests: 1,105 passed, zero failures, zero skips, and one existing TODO (176.369 seconds). The TODO records the known case-variant key-file limitation; it is not a newly fixed or silently skipped assertion. The earlier shared-checkout repository run also had 1,105 passes and one TODO (149.314 seconds).

npm run format:check failed on three unchanged baseline documents: HANDOFF-golden-eval-he06-thermo-nuclear-2026-09-06.md, HANDOFF-permission-cache-thermo-nuclear-2026-09-07.md, and HANDOFF-starlark-r11-thermo-nuclear-2026-09-06.md. Their warnings are preserved in format.txt; they were not reformatted to make this task appear green.

Changed-file formatting, source/document Git whitespace validation, and structural HTML checks passed. The all-files staged whitespace check reported trailing spaces and an extra final blank line in raw saved test output and the historical patch file. These evidence files are preserved byte-for-byte; the warning is retained rather than rewriting the historical output. Both report bodies match and the HTML has no external assets. Browser rendering was not inspected; structural validation is not visual verification.

Final delivery folder: /Users/alanman/Developer/claude-local-bridge-playground, branch main. Implementation/evidence commit: 3bacab37924ed5739fb7663d796d8068c60a331a. A following documentation commit contains this report and the other task’s handoff; the final chat reports that documentation commit and verified remote identity. Final combined Starlark verification passed 128/128 tests, zero failures or skips, in 8.445 seconds. The combined focused suite passed 43/43 tests, zero failures or skips, in 8.341 seconds. Combined source lint also passed.

## 6. Limitations and deliberately unchanged behavior

The guarantee starts after both the synthesis artifact and synthesis_resume_completed receipt are durable. A completed provider call without a saved success receipt can still be repeated; unfinished requests can have unknown billing. This does not promise exactly-once provider execution.

An existing readable state.json is still required for prior context and worker results. Missing or malformed completion evidence stops recovery rather than silently buying synthesis again. This is not general repair of missing checkpoints, arbitrary corrupted ledgers, or cryptographic authentication of synthesis text.

Cumulative call recovery adds this successful retry to the saved checkpoint total. It does not reconstruct accounting for older failed attempts whose own checkpoint was lost. Intermediate map/reduce outputs and incomplete retries are unchanged.

Original completed/partial classification, worker execution and recovery rules, budgets, live command-line guards, signal handling, authentication, and bridge transport remain unchanged. Multiple simultaneous writers to the same run directory remain unsupported.

No real power-loss or forced-process-kill trial, live model call, or browser visual review was performed. The separate worktree deliberately excludes the other task’s coordinator changes. Final combined Starlark verification in the original folder is recorded below.

## 7. Next handoff and how to read it

Open the HTML companion in a browser for the readable report. You do not need to run any commands. In Finder, choose Go → Go to Folder, paste /Users/alanman/Developer/claude-local-bridge-playground, and open HANDOFF-synthesis-resume-evidence-2026-09-18.html. If macOS opens a code editor instead, use Open With → Safari.

For the next agent: both fixes are together in the original playground folder on main. Do not reapply the isolated patch. Arrange the subsequent Cursor invariant review of the combined changes. The owner explicitly authorized combined commit/push/synchronization after the two implementations finished. Publication uses an ordinary push, not a force push. Final remote verification belongs to the final chat because a report cannot contain its own commit hash without changing that hash.

Commands labeled isolated were run by the agent in the separate folder. The final combined verification ran in the original playground folder. Successful test execution means the summary has zero failures; the repository suite’s expected TODO and formatting warnings must remain visible rather than being described as a completely green suite.

## 8. Review of the other task before combining

This session read the final coordinator diff, all six abort-boundary regression cases, the other task’s handoff, and its preserved initial-fixture, red, and green logs. The source change limits invalid-output handling to parsing, preserves actual errors during cancellation, drains worker promises, and selects unrelated failures before cancellation. No additional defect was identified in this bounded review; no further coordinator change was made. This does not replace the repository’s subsequent Cursor invariant review.

Both original evidence sets remain intact. The other task’s corrected baseline was 2 passes / 4 failures, followed by 6 passes; its earlier incorrect fixture is explicitly retained as a setup error. Final combined focused and full Starlark results verify both changes together. Final combined repository test result: 1,106 total; 1,105 passed, zero failures, zero skips, one existing TODO; 135.355 seconds.
