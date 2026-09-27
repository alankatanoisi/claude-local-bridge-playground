# Starlark reconciliation on the 2020 laptop — verified for branch review

September 27, 2026. [Read the browser version](HANDOFF-starlark-reconciliation-2026-09-27.html).

## Location and evidence

- Repository: `/Users/alanman/Developer/claude-local-bridge-playground`; clean `main` at `1e06820f5bf47456c725686bd961cf60b22311c5` during preflight. `origin` is the playground GitHub repository, and GitHub `main` matched this revision.
- Dedicated worktree: `/Users/alanman/Developer/claude-local-bridge-starlark-resume-2020-2026-09-26`; branch `codex/starlark-resume-2020-2026-09-26`, based on `origin/main` at `1e06820`.
- Transfer: `/Users/alanman/Developer/starlark-transfer-2026-09-26.zip`. Its SHA-256 matched the adjacent `.sha256` file. After extraction to a temporary directory, `verify-package.cjs` verified all 40 files and found no extras. This proves consistency with the supplied checksum and manifest, not independent authorship.
- The transfer base `bf4c276` and current GitHub `main` have no differing `starlark-host/` files. Only `reconciled.patch` was applied once. `original.patch` was not applied. The existing stash and other worktrees were left untouched.
- Node.js `v22.22.3`; Go `go1.26.8 darwin/arm64`. The evaluator was built locally. No paid model call was made.

## Changes in this worktree

The 13-file transferred snapshot supplies resumable paid planner-response receipts, evaluator cancellation, safe artifact names, torn-ledger refusal, signal exit-code handling, and their initial tests. The later local work makes three focused corrections:

1. A simultaneous cancellation and unrelated evaluator error now preserves the evaluator error. Only the actual cancellation is recorded as an interrupted evaluation. A host error cannot enter the planner's paid repair or escalation path merely because cancellation occurred.
2. Writing the accepted-source artifact and accepted-plan receipt now occurs outside the model-validation catch. A storage failure remains a storage failure and cannot become a model rejection or trigger another purchase.
3. Real child-process matrix tests verify SIGINT exits 130 and SIGTERM exits 143 after an earlier matrix entry failed. Synthesis-only resume now asserts `TornLedgerLineError`, zero model calls, and unchanged event bytes on a torn final line.

Changed runtime paths are confined to `starlark-host/`: `README.md`, `bin/run-experiment.js`, `src/{artifact-name,coordinator,ledger,planner-response,run-abort,starlark,worker-resume}.js`, and `test/{planner-resume,run-abort,starlark,synthesis,worker-resume}.test.js`. No bridge/auth or `src/runner/` file changed. This is the verification record; inspect the Git branch and the separate Cursor review handoff for subsequent commit and push status.

## Checks and observed outcomes

| Check                                                          | Outcome                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Incoming `npm --prefix starlark-host run verify`, before patch | Evaluator built; 128 passed, 0 failed, 0 skipped                                                                                                                                                                                                              |
| New planner boundary tests before correction                   | 2 failed as expected; after correction, planner file 16 passed                                                                                                                                                                                                |
| Real matrix SIGINT/SIGTERM child tests                         | 4 run-abort tests passed, including both signal exits                                                                                                                                                                                                         |
| First eight-file focused combined run                          | Stopped with exit 137 after an abort-boundary assertion saw 2 requests instead of 1; no complete result. The boundary file passed alone on rerun.                                                                                                             |
| Same eight files with `--test-concurrency=1`                   | 64 passed, 0 failed, 0 skipped                                                                                                                                                                                                                                |
| Full `npm --prefix starlark-host run verify`                   | Evaluator built; 151 passed, 0 failed, 0 skipped                                                                                                                                                                                                              |
| Root `npm test`                                                | 1,161 passed, 0 failed, 0 skipped, 1 existing TODO                                                                                                                                                                                                            |
| Root `npm run lint`, `npm run check:docs`                      | Both passed                                                                                                                                                                                                                                                   |
| Root `npm run format:check`                                    | Failed on three unchanged historical Markdown handoffs: `HANDOFF-golden-eval-he06-thermo-nuclear-2026-09-06.md`, `HANDOFF-permission-cache-thermo-nuclear-2026-09-07.md`, and `HANDOFF-starlark-r11-thermo-nuclear-2026-09-06.md`. They were not reformatted. |
| Explicit ESLint and Prettier on changed Starlark files         | Passed                                                                                                                                                                                                                                                        |

## Limits and next decision

These checks used local fixtures and mock responses. They establish deterministic behavior in this worktree, not exactly-once provider billing or power-loss recovery. Durability begins after the source artifact and receipt are persisted. Older runs without receipts cannot automatically recover a paid source. Simultaneous writers to one run directory and missing or corrupt checkpoints were not generally repaired. No browser visual inspection of this HTML handoff was performed.

Alan chose a dedicated GitHub branch and an independent Cursor invariant review before deciding whether to move the work to playground `main`. Keep this verification record separate from that review. The exact staging list and staged diff must be inspected, secrets checked, and current GitHub `main` rechecked before branch publication. Preserve every unrelated local commit and file. Do not treat this verification as the independent review.
