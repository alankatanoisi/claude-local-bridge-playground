# PROMPT — Safari 3 Phase A Continuation

**For:** Any agent starting a new session to continue Safari 3 Phase A work.

**How to use:** Paste this entire prompt into your next session after opening the repo. It contains full context for understanding where we are and what to do next.

---

## Context: Permission Safari 3 — Phase A Work

This repo (`claude-local-bridge-playground`) is a **laboratory for studying agent harness behavior**, specifically permission machinery and path-safety controls. We are executing **Safari 3**, an adversarial field test divided into three phases.

**Current status:** Phase A, tasks 1–12, focused on **closing symlink denial gaps** discovered in Safari 2.

---

## What Happened in Safari 2 (Brief)

Codex ran an adversarial test against the runner's permission system and found:
- **S2-01:** An in-root symlink with an innocent basename (e.g., `link-to-config`) could reach a deny-listed file (e.g., `.env`) because `confinePath` only checked the lexical path, not the realpath target.
- **S2-02 (laundering):** `write_file` would back up a symlink without checking its target, writing the denied file's contents to `.bridge-runner/backups/` — a path that wasn't deny-listed.

Root cause: **file tools made independent decisions** about whether to check the lexical path (what the user typed) or the realpath (where the file actually lives). No unified entry point existed.

---

## What We Just Fixed (A2 + A3 + A4)

**Commit:** `9162580` on main, pushed to origin.

Three changes, one logical fix:

1. **`resolveFileTarget(ctx, inputPath)`** — new unified choicepoint in `src/runner/safety.js:304–354`
   - Replaces independent `confinePath` + `deny-matrix` checks across file tools
   - Returns `{lexical, real, allowed, reason}` so callers know what happened
   - Checks **both** paths before allowing access
   - Example: a symlink named `link-to-config` pointing to `.env` is now **hard-denied at entry**

2. **Applied to `permissions.js`** (line 227–243) — read-side policy
3. **Applied to `glob.js`** (line 104–110) — glob expansion
4. **Added to `write-file.js`** (line 78–88) — symlink explicit refusal
5. **Added `.bridge-runner` to deny matrix** — backups now unreachable

**Verification:** All 747 tests pass, zero regressions. Lint and docs checks clean.

---

## What Remains in Phase A (9 tasks)

Ordered by readiness + impact:

| Task | Work | Time | Reason to do it |
|---|---|---|---|
| **A6** | Scrub denied-file content from `edit-file.js` + `apply-patch.js` result fields | 8 min | Found by Codex: hunk-mismatch errors embed the real file line, exposing content |
| **A7** | Assert archive permissions — transcript/session/trust/trace must be `0600` | 5 min | Field-measured; P0-12 claimed it, nobody verified. Field data ready |
| **A10** | Fix false comment at `tool-pipeline.js:79–80` | 2 min | Claims `confinePath` returns realpath; it doesn't. We just changed it to call `resolveFileTarget` |
| **A11** | Collapse 3 copies of deny-list (appears in `shell-policy`, `permissions`, `safety`) | 5 min | DRY violation; makes future updates error-prone |
| **A9** | FD-07: add chaos-ok audit marker to run.js | 5 min | Closes S2-05 (acknowledgement tracking) |
| **A8** | FD-06: add denial reason codes (runner vs model vs outer classifier) | 5 min | Safari 2 rounds were inconclusive because the code didn't distinguish layers |
| **A1** | Fixture helper `makeFixtureCtx()` + `withSymlinkFixture()` | 8 min | Prerequisite for A5 |
| **A5** | **DEFERRED** — Symlink test matrix (8 tools × 3 scenarios) | 20 min | Complex; skip this session, dedicated focus later |
| **A12** | S2-06 owner (shell containment) | 5 min | Documented as false; needs an owner to verify or document as intentional |

**Recommended batch for this session:** A6 + A7 + A10 + A11 (expect ~20 min). They complete the symlink story without the test-matrix complexity.

---

## How to Verify Your Work

```bash
# Unit tests (quick)
node --require ./test/setup.js --test test/runner/safety.test.js

# Full gate (5 min, must all pass)
npm test && npm run lint && npm run check:docs && npm run format:check
```

All tests currently pass. Your changes must not regress any of them.

---

## How to Read the Full Plan

**File:** `/Users/alanman/.claude/plans/declarative-floating-widget.md`

This is the complete Safari 3 spec, including:
- Phase A tasks 1–12 (full descriptions, code locations, blast radius)
- Phase B (6 live probes, gated on Phase A green)
- Phase C (docs unification)
- Known landmines and constraints

Read the **Phase A section** before starting; reference it as you work.

---

## Permission & Budget Notes

**Live probe authorization:** Phase B is gated on user approval. The prior authorization (2026-07-25) is time-boxed and does not roll forward. If you finish Phase A green, ask Alan before starting Phase B whether he wants to authorize another run.

**Model budget:** You have plenty. Phase A is offline code work; it doesn't spend model budget.

---

## What Not to Do

- **Do not attempt A5 (test matrix)** in this session — it's large (20–25 min), complex (nine edge cases), and the fixture helper (A1) is a prerequisite. Defer to a dedicated session.
- **Do not edit AGENTS.md** without Alan. It's under a planned atomic pass (Phase C). Changes landed in CLAUDE.md on 2026-07-25; AGENTS.md is intentionally untouched to avoid cross-agent divergence.
- **Do not commit `.cursor/hooks/state/` files** — they auto-update and are not version-controlled.

---

## Key Files to Know

- `src/runner/safety.js` — path confinement, deny matrix, `resolveFileTarget` (just added)
- `src/runner/permissions.js` — permission policy; calls `resolveFileTarget` (A3)
- `src/runner/tools/glob.js` — glob expansion; calls `resolveFileTarget` (A3)
- `src/runner/tools/write-file.js` — file write with symlink guard (A4)
- `src/runner/tools/edit-file.js` — needs content scrubbing (A6)
- `src/runner/tools/apply-patch.js` — needs content scrubbing (A6)
- `src/runner/tool-pipeline.js` — has a false comment at line 79–80 (A10)

Test files (read to understand what you're testing):
- `test/runner/safety.test.js` — confinement, symlinks, realpath
- `test/runner/permissions.test.js` — policy decisions
- `test/runner/write-file.test.js` — backup behavior

---

## Example: What a Commit Should Look Like

```
Implement FD-06: denial reason codes for permission layers

Add six runner-internal denial codes to distinguish between:
- path_escape (confinement violation)
- deny_matrix (blocked pattern)
- model_refusal (model said no)
- outer_classifier_refusal (Claude Code outer gate)
- tool_not_available (capability not enabled)
- user_denied (interactive denial)

Update permissions.js, tool-pipeline.js, transcript.js to record reason
codes in every denial event. Safari 2 rounds were inconclusive because
the code couldn't distinguish model refusal from runner policy; this
closes that gap.

Verified: all existing tests pass, new denial reason appears in transcript.
```

---

## When You're Done

1. Commit the batch (multiple tasks if related; one commit per logical change)
2. Run the full gate: `npm test && npm run lint && npm run check:docs && npm run format:check`
3. Push to origin/main
4. Update `HANDOFF-safari-3-phase-a-progress-2026-07-26.md` with what you finished
5. Tell Alan: "A6/A7/A10/A11 complete, Phase A is [X% done], all tests pass"

---

## Questions or Blockers?

- **Understanding the symlink issue?** Start with `docs/permission-safari-2-findings-2026-07-21.md` (Safari 2's written findings) and `HANDOFF-safari-3-remediation-plan-2026-07-25.md` (root cause breakdown).
- **Unsure what a task means?** Read the task description in `~/.claude/plans/declarative-floating-widget.md`.
- **Git/repo questions?** Check `CLAUDE.md` (this repo's conventions) and `AGENTS.md` (shared guardrails).

---

**You have all the context you need. The tests are passing. Go build.** 🚀
