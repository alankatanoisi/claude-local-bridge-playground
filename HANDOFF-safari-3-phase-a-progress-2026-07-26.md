# HANDOFF — Safari 3 Phase A Progress (as of 2026-07-26, ~12:10 UTC)

**Audience:** Any agent continuing Safari 3 Phase A work.

---

## What Just Landed (A2 + A3 + A4)

**Commit:** `9162580` — "Implement FD-01: unified path resolution choicepoint for symlink denial"

**The fix:** Root-cause closure for in-root symlink denial gaps (S2-01 from Safari 2).

### What changed:

1. **`resolveFileTarget(ctx, inputPath)` — new choicepoint in `safety.js:304-354`**
   - Unified entry point for all file tools
   - Returns `{lexical, real, allowed, reason}` — checks both the user-typed path and the actual target
   - Every downstream tool now calls this instead of making independent `confinePath` + deny-matrix decisions
   - Catches symlink→denied-file chains and path-escape chains at entry

2. **`permissions.js:227-243` — updated to use `resolveFileTarget`**
   - Was: separate `confinePath` check + `isPathBlockedByDenyMatrix` check
   - Now: single `resolveFileTarget` call with unified logic
   - Blocks both lexical and realpath violations

3. **`glob.js:104-110` — updated to use `resolveFileTarget`**
   - Was: inline `confinePath` + `isPathBlockedByDenyMatrix`
   - Now: single call, same pattern as permissions.js

4. **`write-file.js:78-88` — added symlink check**
   - Added `fs.lstatSync().isSymbolicLink()` guard
   - Refuses to back up symlinks (prevents laundering denied-file contents to `.bridge-runner/backups/`)

5. **`safety.js:95` — added `.bridge-runner` to deny matrix**
   - Backup files are now unreachable via `read_file` or shell
   - Closes the laundering chain where backups could be read back

### Verification

- ✅ All 747 existing tests pass (zero regressions)
- ✅ Lint clean, docs check passed
- ✅ Pushed to origin/main

---

## Phase A Work Map (12 tasks total)

| Task | Status | Work | Depends on |
|---|---|---|---|
| **A1** | Not started | Fixture helper + `withSymlinkFixture()` | — |
| **A2** | ✅ Done | `resolveFileTarget()` choicepoint | — |
| **A3** | ✅ Done | Apply to permissions.js + glob.js | A2 |
| **A4** | ✅ Done | Deny-matrix + write-file symlink check | A2 |
| **A5** | Deferred | Symlink test matrix {8 tools × 3 scenarios} | A2–A4 |
| **A6** | Pending | Scrub denied content from edit-file/apply-patch results | A2 |
| **A7** | Ready | Archive-mode assertion test (field data gathered) | A2–A4 |
| **A8** | Pending | FD-06 denial reason codes (six runner codes + model/outer refusal) | A2 |
| **A9** | Pending | FD-07 chaos-ok audit marker in run.js | A2 |
| **A10** | Pending | Fix false comment at tool-pipeline.js:79–80 | — |
| **A11** | Pending | Collapse 3 copies of deny-list (shell-policy, permissions, safety) | — |
| **A12** | Pending | S2-06 shell honesty owner (intended or needs test) | — |

**Execution priority:** A1 is a prerequisite for the test matrix (A5), but A5 is complex (20–25 min) and deferred. Run **A6 + A7 + A10 + A11** in the next session for incremental closure (expect 20–25 min total). A8/A9 are polish and can land anytime. A5 deserves its own focused session.

---

## Field Data Collected (A7)

Archive permissions were measured on 2026-07-26:

```
Artifact               Observed    Expected   Status
────────────────────────────────────────────────────
logs/                 0600        0600       ✓
trust.json            0600        0600       ✓
archive/              0644        0600       ✗ WRONG — world-readable
```

**Action:** A7 writes an assertion that `~/.bridge-runner/archive/**/*` must be `0600` going forward. This became visible only after consolidating to unified `~/.bridge-runner` home-directory store (moved repo-local `.bridge-runner` into `~/.bridge-runner/archive/repo-local-historical/` on 2026-07-26).

---

## Phase B (Live Probes) — Not Authorized Yet

Status: **Gated on Phase A = green + user budget confirmation.**

Alan granted live `/v1/messages` authorization on 2026-07-25 with conditions:
- Fake fixtures only, sandboxed `--cwd`
- Explicit bounds on every round (`--max-steps`, `--max-tool-calls-per-turn`, `--max-cost-usd`, `--max-wall-clock-ms`)
- Time-boxed to ~11h window before weekly reset (expires at 2026-07-25 23:00 UTC, did not roll forward)

**Current budget state:** 94% remaining, ~18m wall-clock remained at session end (2026-07-26 ~12:10 UTC).

See `HANDOFF-safari-3-remediation-plan-2026-07-25.md` for the six Phase B probes (S2-01 re-verify, receipts, timeouts, injection burn, cross-model, auto-mode).

---

## Phase C (Docs Unification) — Not Started

**Status:** Deliberately blocked pending **atomic AGENTS.md pass.**

Measured divergence: `AGENTS.md` and `CLAUDE.md` are 58% duplicated, with eight substantive gaps. Edits landed in CLAUDE.md on 2026-07-25 (P0-11 correction, profiles retirement, Current Work Thread). `AGENTS.md` is intentionally untouched — changing it piecemeal while other agents hold older context would recreate the divergence being removed.

See `AGENT-DOCS-DIVERGENCE-2026-07-25.html` for the full work order (recommendations, change log, eight divergence categories).

---

## What's in Scope for Next Agent

**Expected session goal:** Land A6–A11 + verify Phase A green before gating Phase B.

**Not in scope (explicitly):**
- A5 (test matrix — defer to dedicated session)
- Phase B live probes (gated, needs Alan to re-authorize for new session)
- Phase C docs unification (gated, needs coordinated pass)

---

## References

- Full Phase A–C plan: `/Users/alanman/.claude/plans/declarative-floating-widget.md`
- Safari 2 findings: `docs/permission-safari-2-findings-2026-07-21.md`
- Root cause analysis: `HANDOFF-safari-3-remediation-plan-2026-07-25.md` (Phases A–C, landmines section)
- Divergence report: `AGENT-DOCS-DIVERGENCE-2026-07-25.html`
- Testing: `npm test` passes; targeted: `node --require ./test/setup.js --test test/runner/safety.test.js test/runner/permissions.test.js`

---

## Repo State at Close

- Branch: `main`
- Remote: origin/main at `9162580`
- Working tree: clean (except `.cursor/hooks/state/` auto-updates, which are not committed)
- All 747 tests pass

---

**Next agent:** If you are Claude Code, read this alongside `~/.claude/plans/declarative-floating-widget.md` (Phase A section) for the full task scope. If you are Cursor or Codex, note that `AGENTS.md` is your auto-loaded reference, and CLAUDE.md was amended 2026-07-25 but is not visible to you — check both if seeking shared guardrails.
