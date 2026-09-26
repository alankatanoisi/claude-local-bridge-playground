# Starlark: resume on the 2020 laptop

Prepared September 26, 2026 on Alan's 2024 laptop. **Transfer handoff, not a completion claim.** Runtime changes remain unfinished and uncommitted in the preserved integration folder. Only this handoff pair is intended for publication. [Browser companion](HANDOFF-starlark-laptop-transfer-2026-09-26.html).

## 1. Read this first

Alan asked to move reconciliation and testing to his 2020 laptop. Yes, that laptop can perform the local comparisons and deterministic tests once Node.js 22 or later and the Go toolchain required by the repository are available. Do not assume its CPU architecture, Homebrew prefix, repository folder, current branch, or dependencies match the 2024 laptop. Build the evaluator there; do not copy the 2024 laptop's executable.

The receiving agent must inspect first, preserve all local work, and use a fresh dedicated worktree. A worktree is another working folder connected to the same Git repository. The branch shown in Alan's GitHub Desktop screenshot was codex/synthesis-resume-evidence-2026-0..., not main. Do not switch or publish that branch merely to resume this task.

Alan has already chosen Low #8 option 2: connect evaluator cancellation to the run and make the paid saved planner response resumable. The September 26 review recommends option 1, but that recommendation does not supersede Alan's explicit implementation approval. Do not ask him to repeat that decision. No live provider calls are needed or authorized for this reconciliation.

## 2. Evidence and locations

2024 laptop source checkout: /Users/alanman/Developer/claude-local-bridge-playground. At initial capture it was main at 56b3678150fd6c589b9f4a3ea571ca1604042923 with eight modified and five untracked Starlark files. During the later transfer preflight another session had changed it to a clean main at 7eac6d64498bf01f9370307f48ea02fb238e76df. Its Starlark files then matched the landed incoming baseline, not the unfinished patch. This session did not clear those edits and did not investigate the other session's actions. **Do not use that original folder as the patch source.**

Preserved integration folder: /Users/alanman/Developer/claude-local-bridge-starlark-reconcile-2026-09-26, branch codex/starlark-reconcile-2026-09-26, HEAD bf4c276a48413e77cab7e299a982a572cf349b4c. It holds the combined, uncommitted snapshot. Its original Starlark patch was captured with equal before/after fingerprints, then merged against the incoming baseline with git merge-file using the original parent. Both overlapping files merged without textual conflicts. That does not establish behavioral correctness.

Earlier capture: /tmp/starlark-reconcile-capture.ZRt71T. It contains the original patch, full copies of the 13 files, and manifest. The transfer package preserves those useful contents independently of temporary-folder lifetime.

Documentation publication folder: /Users/alanman/Developer/claude-local-bridge-transfer-publish-2026-09-26, branch codex/starlark-transfer-handoff-2026-09-26. It starts at remote main 66eabb1b4852af752e7b4c097534989f6581badc. That newer command-builder commit does not modify Starlark. Publishing from this isolated folder avoids including five unrelated commits then present only on the original local main. The final chat provides publication success and commit identity; this document does not predict them.

## 3. Transfer package: what to use

On the 2024 laptop the package lives at /Users/alanman/Developer/starlark-transfer-2026-09-26. Transfer the adjacent ZIP file with the same basename. Extract it on the 2020 laptop as evidence, not over any repository folder.

- HANDOFF-starlark-laptop-transfer-2026-09-26.md and .html: these instructions, available without GitHub.
- reconciled.patch: **the preferred application route**, relative to bf4c276. Includes all eight tracked modifications and all five new files. It already includes the original local patch. Apply once only.
- reconciled-files/: full resulting versions of the 13 files, for read-back verification and manual comparison; not an instruction to overwrite newer source.
- original.patch and original-files/: alternate historical recovery route relative to 56b3678. Do not apply these after reconciled.patch.
- base-files/: the bf4c276 versions of the eight tracked files, for a three-way comparison if newer upstream code overlaps.
- capture-manifest.json: original capture metadata and fingerprints.
- manifest.json: package file sizes and SHA-256 content fingerprints, exact source revisions, tool versions, and test-result provenance.
- verify-package.cjs: read-only package verification; reports missing, changed, or unexpected files. It does not install or apply anything.

The ZIP excludes credentials, account state, environment files, run artifacts, campaign ledgers, dependencies, binaries, unrelated changes, and Git metadata. The checksum proves consistency with the supplied manifest, not independent authenticity. The separately supplied ZIP checksum checks transfer integrity.

## 4. Receiving-agent procedure

These are instructions for the agent to execute, not commands Alan must paste into Terminal.

1. Confirm all other Starlark implementation sessions are stopped. Read the user's current instruction and the actual local AGENTS.md. Report current directory, detected repository root, branch, remotes, status, and worktree list. Expected remote is https://github.com/alankatanoisi/claude-local-bridge-playground.git; canonical claude-local-bridge is reference-only. Never assume a matching folder name means matching contents.
2. Locate the extracted transfer package and run `node verify-package.cjs` from its root. Success means every listed file matches and no extra payload files exist. Compare the ZIP checksum with the 2024 laptop handoff when available. Stop on any mismatch; do not apply a partial or damaged package.
3. Fetch origin/main without changing the current checkout. Record the new remote revision. Read the September 16 closure and September 18 recovery handoffs plus the September 26 review. Compare bf4c276..origin/main, especially Starlark source/tests and instructions. Do not reimplement the landed 3bacab3 recovery fixes.
4. Create /Users/alanman/Developer/claude-local-bridge-starlark-resume-2020-2026-09-26 on a new codex/starlark-resume-2020-2026-09-26 branch based on current origin/main. This dedicated worktree is owner-approved for isolation. Stop if either target already exists; inspect and ask rather than overwrite. Never clean, stash, reset, change branches in, or merge into an existing dirty checkout.
5. Confirm Node.js version and inspect starlark-host/go.mod for Go requirements (currently Go 1.26.0). The 2024 tool versions were Node v22.22.3 and Go 1.26.0 darwin/arm64. Do not hard-code /opt/homebrew on the 2020 laptop. Install locked project dependencies in the new worktree if absent, without changing the lockfile. Stop and explain if tooling cannot be obtained safely.
6. Run the fresh incoming Starlark baseline before applying changes. From the new repository root run `npm --prefix starlark-host run verify`; it builds the evaluator and runs tests. Record actual failures before fixing anything. Zero unexpected skips are required.
7. Compare the 13 manifest-listed paths with the transferred base. If upstream Starlark is unchanged, run `git apply --check` with the absolute reconciled.patch path, then apply the reviewed changes using the agent's required patch-editing mechanism. If upstream differs, compare base-files, reconciled-files, and current upstream; merge behaviorally instead of copying entire old files. Preserve the five additions. Do not apply both original.patch and reconciled.patch. Leave the index unstaged until publication is appropriate.
8. Read back all changes. Require the initial delta to be limited to Starlark. Preserve incoming isRunCancellation classification, worker draining, storage-error propagation, restoreSynthesisResume export, and synthesis-success reconstruction precedence. Keep bridge/auth and src/runner untouched. Do not include unrelated command-builder, launcher, or other agent work.
9. Finish the regressions and implementation described below, one failing behavioral case at a time. Then run the broader checks, write the closure handoff pair, and present the exact diff and residual risks. Do not describe the transferred snapshot as complete.

## 5. Remaining implementation and tests

The transferred code preserves signal exit codes, shares safeArtifactName, refuses torn final JSONL ledger lines with TornLedgerLineError, forwards the run signal to the evaluator child, and saves/verifies planner-response receipts for no-repurchase local evaluation. The optional evaluatePlan dependency supports deterministic tests. Pending receipts retain source/input/policy hashes, attempt numbering and model-tier identity; no public flags are added.

**First cross-boundary test:** exercise an unrelated evaluator failure at the same time as cancellation. In the transferred coordinator, generateValidatedPlan still calls checkAbort(this.signal) inside its catch; generateValidatedPlanOnModel labels any error during an aborted signal as evaluation_interrupted. These are inspected risk locations, not newly reproduced failures. Prove whether they mask the original error or mislabel it, then minimally fix the behavior. True cancellation must remain cancellation, unrelated host errors must reach the caller, and neither should be treated as model rejection or trigger an extra purchase. Test source-artifact/receipt/accepted-result storage failures at the same boundary as appropriate. Do not broaden into a speculative planner redesign.

Preserve the incoming worker persistence/accounting tests and completed-synthesis restoration. Add a specific assertion that synthesis-only resume refuses a torn trailing ledger line with the named actionable error, makes no model call, and leaves event bytes unchanged. Retain source/input/policy/path/symlink/model corruption refusal before retries, escalation, or ledger mutation; repeated interruption; repair after genuine validation rejection; and recovery-plan reuse without repeating workers.

Low #5 currently has helper-level regression tests, not the real command-line matrix signal test recommended by the September 26 review. Do not imply that stronger coverage exists. Add the deterministic real-child case (earlier matrix entry fails, later entry receives SIGINT/SIGTERM, exits 130/143 rather than 1) before claiming that acceptance row closed, or explicitly obtain a scope decision to defer it. Use readiness/IPC signals, not sleep-based race guesses.

Focused starting command, run by the agent from the new repository root:

```sh
# Exercise the restored source and the already-landed boundary fixes together.
node --test starlark-host/test/planner-resume.test.js starlark-host/test/abort-commit-boundaries.test.js starlark-host/test/synthesis.test.js starlark-host/test/worker-resume.test.js starlark-host/test/run-abort.test.js starlark-host/test/starlark.test.js
```

Also include ledger, R11 recovery, and new regression files. Run full `npm --prefix starlark-host run verify`, repository `npm test`, `npm run lint`, `npm run check:docs`, and `npm run format:check`. Explicitly lint and format-check changed Starlark files: root scripts do not cover all of them. Do not use --fix on unrelated files. Preserve actual pass/fail/skip counts and output. Investigate unexpected failures; do not silently attribute them to a historical environment note.

Historical root formatting warnings involved three unchanged handoffs: HANDOFF-golden-eval-he06-thermo-nuclear-2026-09-06.md, HANDOFF-permission-cache-thermo-nuclear-2026-09-07.md, and HANDOFF-starlark-r11-thermo-nuclear-2026-09-06.md. Recheck rather than assuming the list is current. The old repository count of 1,105 passes is not an acceptance target after other branches advance.

## 6. What was actually tested

- Earlier September 17 local implementation: 130 Starlark passes and 1,105 repository passes with one existing TODO. Historical memory only; not fresh combined verification.
- September 26 incoming bf4c276 baseline, before patch application: evaluator rebuild succeeded; 128 passed, zero failures/skips. Executed from the 2024 integration worktree.
- September 26 combined snapshot: the six-file focused command above passed 47 tests, zero failures/skips. This was after three-way reconciliation, before any new cross-boundary fixes.
- Full combined verification, new cross-boundary cases, command-level signal coverage, broad checks, and closure documentation were not completed before the laptop transfer. No raw logs for those two September 26 runs were saved as files; the counts were observed in tool output. Do not invent raw evidence or a red-before-green result.
- Packaging/publication checks belong to the final transfer chat and manifest. They are not runtime completion evidence.

## 7. Closure, publication, and limits

Alan's latest instruction authorizes this transfer package and commit/push/sync where sensible. The sending session deliberately publishes only the handoff pair, not incomplete runtime code. On the receiving laptop, finish verification before proposing runtime publication; confirm the intended runtime commit/push scope rather than treating the transfer publication as proof of runtime acceptance. Never publish unrelated local commits, force-push, or automatically synchronize an existing dirty main. Prefer an ordinary fast-forward publication to playground main once explicitly authorized and verified.

Write a dated closure Markdown plus polished standalone HTML. Include folders/branches, files, exact source bases, comparisons, checks run/skipped, and limitations. Add concise status pointers to the September 16/18 handoffs, September 26 review, CLAUDE.md and original review banner as needed; preserve their historical evidence. Do not label items CLOSED merely because the patch applies.

After approved runtime publication, request the normal independent Cursor invariant review of the exact change range. Require a dated findings handoff with HTML, ranked findings, and a "not bugs—do not fix" list. Do not start another reviewer during this transfer or silently implement subsequent findings.

Keep these limits explicit: durability begins only after artifact plus receipt persistence; older runs without receipts cannot automatically recover paid source; provider billing is not exactly-once; power loss, multiple simultaneous run-directory writers, and missing/corrupt checkpoints are not generally repaired. Do not spend money to verify local cancellation logic. No bridge/auth changes and no src/runner edits.

## 8. File inventory

Modified in the transferred snapshot: starlark-host/README.md; starlark-host/bin/run-experiment.js; starlark-host/src/coordinator.js; starlark-host/src/ledger.js; starlark-host/src/run-abort.js; starlark-host/src/starlark.js; starlark-host/src/worker-resume.js; starlark-host/test/starlark.test.js.

New: starlark-host/src/artifact-name.js; starlark-host/src/planner-response.js; starlark-host/test/planner-resume.test.js; starlark-host/test/run-abort.test.js; starlark-host/test/worker-resume.test.js. Incoming resume-synthesis.js and synthesis/abort-boundary tests stay present from the base, not as copied old local files.

## 9. References and suggested skills

- [September 16 Medium closure](https://github.com/alankatanoisi/claude-local-bridge-playground/blob/bf4c276a48413e77cab7e299a982a572cf349b4c/HANDOFF-starlark-mediums-closed-2026-09-16.md)
- [September 18 abort boundaries](https://github.com/alankatanoisi/claude-local-bridge-playground/blob/bf4c276a48413e77cab7e299a982a572cf349b4c/HANDOFF-starlark-abort-boundaries-2026-09-18.md)
- [September 18 synthesis evidence](https://github.com/alankatanoisi/claude-local-bridge-playground/blob/bf4c276a48413e77cab7e299a982a572cf349b4c/HANDOFF-synthesis-resume-evidence-2026-09-18.md)
- [September 26 review](https://github.com/alankatanoisi/claude-local-bridge-playground/blob/bf4c276a48413e77cab7e299a982a572cf349b4c/HANDOFF-starlark-lows-review-2026-09-26.md)

Suggested skills: tdd for deterministic red-before-green regressions; handoff for the eventual next-agent record. Read their actual local instructions if available. No subagents are needed. Use beginner-friendly explanatory comments and distinguish observed results from inference.

## 10. Alan's first steps on the 2020 laptop

1. On the 2024 laptop, open Finder and use Go → Go to Folder to visit /Users/alanman/Developer. Locate starlark-transfer-2026-09-26.zip. Right-click it, choose Share → AirDrop, and select the 2020 laptop. If it is not listed, open Finder → AirDrop on the receiving laptop and enable appropriate discovery temporarily.
2. Accept the transfer on the 2020 laptop. Find the ZIP in Downloads and double-click it. This extracts an evidence folder; it does not apply code. Do not drag its contents over an existing repository.
3. Open HANDOFF-starlark-laptop-transfer-2026-09-26.html in Safari for readable instructions. Start a fresh agent session on that laptop, attach the Markdown handoff, and give it the extracted folder's location.
4. Paste: "Resume the Starlark reconciliation from this handoff and transfer package on the 2020 laptop. First verify the package, actual repository and current GitHub state. Preserve every existing local change and use the dedicated 2020 worktree. Do not apply both patches or start paid model calls. Report preflight before editing; then complete the remaining tests and reconciliation. Confirm runtime publication scope with me after verification."

Leave the 2024 copies in place as recovery evidence. The 2024 implementation session remains paused; do not run two Starlark implementation sessions simultaneously.
