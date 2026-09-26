# Starlark Low #5–#8 — review of Codex's proposed slice (2026-09-26)

**Author:** Fable (Claude Code), at Alan's request. **Status:** review only; no Starlark source changed.
**Live spend:** $0.

Codex reported an uncommitted slice implementing Low #5–#8 from
[`HANDOFF-starlark-r11-thermo-nuclear-2026-09-06.md`](HANDOFF-starlark-r11-thermo-nuclear-2026-09-06.md)
and recommended _not_ committing it because Low #8 conflicts with the Medium #1 abort-commit rule. This file
records what I verified and what the next agent should do. It was drafted on 2026-09-17 and re-checked
against `main` at `90f50ce` on 2026-09-26.

## Verified facts (this machine, `main` at `90f50ce`)

- **Low #5–#8 are still open.** `starlark-host/bin/run-experiment.js` still sets `process.exitCode = 1` on a
  failed run (clobbers 130/143); `evaluateStarlark` is still called without a `signal`; the torn-line refusal
  in `worker-resume.js` is still a raw `SyntaxError`. Codex's slice never reached this checkout, a branch, a
  stash, or either `~/.codex/worktrees/*` folder (both stale). **First question for Codex: which folder
  holds the edits?** If its session ended, the work is gone and must be redone.
- **Codex's Low #8 / Medium #1 conflict is real.** The planner leg pays for a model response, writes the
  source artifact, then runs the evaluator with no abort check in between (deliberate, `c7953e3`). If the
  evaluator is killed on abort, the kill lands in the `catch` that appends `plan_rejected`, so a paid plan is
  recorded as a model failure and `restoreWorkerRun` refuses the run for lack of a `plan_validated` event.
  It also corrupts retry metrics and feeds the "your previous Starlark was rejected" repair prompt.
- **What Codex did not weigh:** the evaluator is already bounded. `experiment.config.json` caps it at 2000 ms
  and 200,000 steps, and the Go binary cancels the thread when the timer fires. On current `main` the worst
  case is that Ctrl-C during planning is honored about two seconds late and the paid plan survives. The review
  itself scoped Low #8 as "only if default Starlark + SIGTERM during planning matters."
- **Since the review was drafted, `3bacab3` (2026-09-18) landed** and closed the two "no dedicated test"
  rows from `HANDOFF-starlark-mediums-closed-2026-09-16.md` plus the lost-checkpoint-after-`resume-synthesis`
  boundary. Records: `HANDOFF-starlark-abort-boundaries-2026-09-18.md`,
  `HANDOFF-synthesis-resume-evidence-2026-09-18.md`. Starlark suite is now 128/128, 0 skipped.

## Decision Alan owns: Low #8

1. **Close by decision, no code (recommended).** Keep the evaluator off the abort signal. State in the
   closure record that the 2 s / 200k-step bound is the guarantee and that forwarding the signal would
   violate Medium #1. No new resume path, nothing new for Cursor to audit.
2. **Codex's design.** Distinguish "evaluation interrupted" from "plan rejected" (new event, not
   `plan_rejected`), and let resume re-lint and re-evaluate the saved `plan-source-attempt-N` artifact with
   zero model calls. Correct, but it adds a third resume kind to `worker-resume.js` right after Medium #4
   shrank that surface, and it needs Codex's cross-invariant test run red first. Worth it only if the
   evaluator timeout is expected to grow a lot.

## Agreed with Codex (do these regardless)

- **Low #5:** add the command-level regression Codex described (first matrix entry fails, second receives
  SIGINT/SIGTERM, the real `run-experiment.js` child exits 130/143, not 1). The existing R11 process-kill
  tests already spawn real children; copy that pattern.
- **Low #6 and #7:** shared safe artifact name; named torn-line error that still refuses (never skip the line).
- **One commit** for Low #5–#8 + tests + a dated closure handoff, mirroring the 09-16 closure. Codex's list
  omitted one edit: the `CLAUDE.md` Starlark bullet says "Low #5–#8 still open" and must change in the same
  commit, as must the CLOSED banner on the 09-06 review.
- **Cursor invariant review** of that exact range afterwards, per the charter; then stop.
- **Bridge-test collision** (stray `GET /` during an alternate-reporter run): separate task. Both the root and
  Starlark bridge tests open loopback servers, so port reuse under concurrency is the first suspect.

## Handoff fields

- **Folder/branch:** `/Users/alanman/Developer/claude-local-bridge-playground`, `main`, `origin` = playground.
- **Files changed:** this file; one pointer line in `CLAUDE.md`. The unrelated dirty command-builder files
  (`docs/command-builder.html`, `test/runner/command-builder-*`, `test/runner/helpers/`,
  `docs/codex-analysis-jev.md`) belong to another session and were **not** staged.
- **Checks run:** `npm --prefix starlark-host test` (128 pass / 0 fail / 0 skipped); git inspection of
  branches, stashes, worktrees; `check:docs`; Prettier on the two touched files.
- **Skipped:** root `npm test` (no source changed); no live runs.
- **Risks / next:** Codex's slice may be lost. Next agent: get Alan's Low #8 answer, then build (or rebuild)
  the slice red-first and close per the list above.
