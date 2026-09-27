# Cursor review entry: Starlark reconciliation

Prepared September 27, 2026. **Review requested; findings are not yet verified.** [Browser companion](HANDOFF-starlark-cursor-review-2026-09-27.html).

## Start here

Alan chose to publish the completed reconciliation to a **dedicated playground branch for independent Cursor review before any move to `main`**. This is a review-only assignment. Do not restore or discard the stash visible on the other laptop. Do not make paid model calls. Do not edit code, commit, push, merge, or publish findings as settled implementation work.

- GitHub repository: `https://github.com/alankatanoisi/claude-local-bridge-playground.git` (the canonical `claude-local-bridge` repository is reference-only).
- Branch: `codex/starlark-resume-2020-2026-09-26`.
- Review range: `1e06820f5bf47456c725686bd961cf60b22311c5..da42e7a4a6823956eedc909ffd7cbb98cd12ec9c`. The left commit is the unpatched GitHub `main` base; the right commit contains the 14 Starlark paths and the reconciliation handoff pair. Review the **code diff and its interactions with unchanged recovery code**, not just the handoff's claims.
- Prepared worktree: `/Users/alanman/Developer/claude-local-bridge-starlark-resume-2020-2026-09-26`. On another machine, locate the actual repository and verify the branch/ref first; do not assume this path exists there.

Alan also cited commit `381984c421c239884ce3c12a8f579eb6ba2e37737f02435f` as a review reference. It was not present in this local Git repository, the accessible local sibling repositories, or the playground GitHub commit endpoint when this brief was prepared. **Its contents are unknown.** If Alan supplies its repository or link, read it and add any applicable review requirements. Until then, use the verified instructions in `AGENTS.md`, `SECURITY.md`, and `docs/agent-team-charter-2026-08-25.md`; never invent what the missing commit says.

## Read before judging

1. Perform the repository preflight: current folder, Git root, branch, remote, worktree/status, and current GitHub `main`. Do not switch a dirty checkout or alter another agent's work.
2. Read `AGENTS.md`, `SECURITY.md`, `docs/agent-team-charter-2026-08-25.md`, and this brief. Cursor may also load `.cursor/rules/**`; check it for drift against current repository instructions.
3. Read the [reconciliation record](HANDOFF-starlark-reconciliation-2026-09-27.md), [transfer handoff](HANDOFF-starlark-laptop-transfer-2026-09-26.md), [September 26 Low review](HANDOFF-starlark-lows-review-2026-09-26.md), and the September 18 abort/synthesis records. Treat every prior claim as a lead to verify in source and tests.
4. Compare the exact range above and trace the neighboring unchanged `starlark-host/` behavior. Do not silently broaden into bridge/auth or `src/runner/` work.

## Review questions

- **Paid planner response:** Is a source artifact plus `*_response_received` receipt saved before cancellation can discard a settled response? Can interruption, local evaluation failure, or accepted-source persistence failure cause a duplicate purchase, false `*_rejected` event, changed attempt numbering, or improper escalation? What is provable only after both artifact and receipt are durable?
- **Error classification:** When cancellation and an unrelated evaluator, artifact, receipt, checkpoint, or accounting error coincide, does the original failure remain visible? Does true cancellation still stop new model calls and use the saved response on resume? Inspect `generateValidatedPlan`, `generateValidatedPlanOnModel`, and `isRunCancellation` alongside worker abort-commit behavior.
- **Resume integrity:** Do source/input/policy hashes, model tier, attempt index, path confinement, and symlink checks fail closed before mutation or another model call? Does genuine validation rejection still permit one appropriate repair? Can an already accepted recovery plan or completed synthesis be reused without replaying worker or synthesis calls?
- **Ledger and names:** Does every reopening path, especially synthesis-only resume, refuse a torn final JSONL line with a named actionable error and unchanged event bytes? Does the shared safe artifact-name helper preserve writer/reader agreement without collisions or path escape?
- **Signals and child lifetime:** Does the evaluator child receive the run abort signal without hiding unrelated failure? Does the real matrix command preserve 130/143 after an earlier failure? Assess the readiness-controlled child test itself, including process lifetime and cleanup.
- **Scope and evidence:** Confirm the branch diff stays in the 14 Starlark files plus two handoffs. Verify test claims and investigate the first combined focused run's unexpected second request and exit 137 separately; later passing reruns do not explain it. Consider whether it indicates a reachable concurrency fault or a test-environment interaction. Do not label it either way without evidence.

## Recorded tests and limits

The incoming baseline built the evaluator and passed 128 Starlark tests. Two new planner boundary tests failed before correction, then the planner file passed 16. The first eight-file combined focused run stopped with exit 137 after one assertion saw two requests rather than one. The boundary file passed alone; the same eight files later passed 64 tests with `--test-concurrency=1`. Full Starlark verification then built the evaluator and passed 151 tests with zero failures/skips. Root `npm test` passed 1,161 tests, zero failures/skips, one existing TODO. Root lint and documentation checks passed. Explicit ESLint and Prettier checks for changed Starlark files passed. Root `format:check` failed on three unchanged historical Markdown handoffs listed in the reconciliation record. No live provider calls or browser visual inspection occurred.

The code does **not** promise exactly-once provider execution or billing, recovery of older runs without receipts, general power-loss recovery, or safe simultaneous writers in one run directory. Keep these limits visible. Report a newly demonstrated breach of an actual boundary; do not treat an accepted limitation alone as a new bug.

## Cursor deliverable and stop point

Write a dated `HANDOFF-starlark-thermo-nuclear-*.md` at the repository root and a self-contained HTML companion. Include severity-ranked findings with exact file/line evidence and a reproduction or concrete reasoning path; a **“not bugs (do not fix)”** section; recommended fix order; tests run and skipped; unresolved observations; and pointers for the next implementing agent. Banner this thread-entry handoff with the review status so later agents do not mistake unverified claims for settled facts. Report no findings explicitly if none are supported.

Stop after the review handoff. Alan will decide what to fix and whether to move the branch to playground `main`. The other laptop's stash remains a separate preserved artifact; compare it read-only later rather than using Restore or Discard during this review.

## This handoff's own scope

This pair is documentation-only, prepared after runtime commit `da42e7a4a6823956eedc909ffd7cbb98cd12ec9c`. It adds no runtime code or test result. The exact branch publication status must be verified from GitHub; do not infer it from this document.
