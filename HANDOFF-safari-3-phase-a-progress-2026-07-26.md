# HANDOFF — Safari 3 Phase A Progress (as of 2026-07-26, ~12:10 UTC)

**Audience:** Any agent continuing Safari 3 Phase A work.

> **APPENDED 2026-07-26 (later session): A6 / A7 / A10 / A11 batch — all four landed and
> verified.** See the section "What Landed in the A6/A7/A10/A11 Batch" at the bottom of this
> file. The Phase A Work Map below is updated in place. Commits `3f7536e` (A6/A10/A11) and
> `e00f98a` (A7). Full gate green: 757 tests pass, lint clean, docs clean.

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

| Task    | Status            | Work                                                                               | Depends on |
| ------- | ----------------- | ---------------------------------------------------------------------------------- | ---------- |
| **A1**  | Not started       | Fixture helper + `withSymlinkFixture()`                                            | —          |
| **A2**  | ✅ Done           | `resolveFileTarget()` choicepoint                                                  | —          |
| **A3**  | ✅ Done           | Apply to permissions.js + glob.js                                                  | A2         |
| **A4**  | ✅ Done           | Deny-matrix + write-file symlink check                                             | A2         |
| **A5**  | Deferred          | Symlink test matrix {8 tools × 3 scenarios}                                        | A2–A4      |
| **A6**  | ✅ Done, verified | Scrub denied content from edit-file/apply-patch results                            | A2         |
| **A7**  | ✅ Done, verified | Archive writers → private-fs + FD-10 assertion test                                | A2–A4      |
| **A8**  | Pending           | FD-06 denial reason codes (six runner codes + model/outer refusal)                 | A2         |
| **A9**  | Pending           | FD-07 chaos-ok audit marker in run.js                                              | A2         |
| **A10** | ✅ Done, verified | Fixed false comment at tool-pipeline.js:79–80 **and** the aliasing bug it licensed | —          |
| **A11** | ✅ Done, verified | Collapsed 3 copies of deny-list (shell-policy, permissions, safety)                | —          |
| **A12** | Pending           | S2-06 shell honesty owner (intended or needs test)                                 | —          |

**Execution priority:** A1 is a prerequisite for the test matrix (A5), but A5 is complex (20–25 min) and deferred. A8/A9 are polish and can land anytime. A5 deserves its own focused session.

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

---

## What Landed in the A6/A7/A10/A11 Batch

_Appended 2026-07-26, later session. Plan of record:
`~/.claude/plans/i-m-continuing-safari-floating-cat.md`._

### Verification status

All four items landed, verified, and committed.

| Item         | Commit    | Evidence                                                                                                                                            |
| ------------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| A6, A10, A11 | `3f7536e` | Targeted suites green, then full gate                                                                                                               |
| A7           | `e00f98a` | Red-then-green: reverting the archive fix makes `fd-10-artifact-modes.test.js` fail with `archive artifacts must be 0700/0600`; restoring it passes |

Full gate at close: **757 tests pass / 0 fail** (747 before this batch, 10 new), `npm run
lint` clean, `npm run check:docs` clean, prettier clean across `src/` and `test/`.

Reproduce with:

```bash
node --require ./test/setup.js --test test/runner/fd-10-artifact-modes.test.js
npm test && npm run lint && npm run check:docs
```

Mid-session the **outer classifier went down** (`claude-opus-5[1m] is temporarily
unavailable`), which blocks every Bash call while permission mode is `auto`. A7 was written
blind during that window and verified afterwards once Alan switched off auto mode. Recorded
because it is the same outage the Safari 3 plan anticipated in probe B6 — now field-observed
twice, and worth knowing it makes `npm test` unreachable, not just live probes.

### A6 — content-bearing result fields now cross the redaction boundary

Two defects under one theme.

- `tool-registry.js` scrubbed only `result.text`. `edit_file` returns `diff` as a **sibling
  top-level field** carrying ±2 context lines of the resolved target. Now scrubbed in
  `runAndScrub`, not inside `edit-file.js`, so one boundary covers any future tool that
  returns a diff.
- **Scope stated honestly:** `diff` reaches no persisted sink today. The model-facing
  envelope (`tool-envelope.js`) carries only `text`, and `collector.recordTool` copies a
  fixed field list. This closed a **latent** hole, not an observed disclosure. Do not cite
  it later as a fixed leak.
- `apply_patch`'s hunk-mismatch error quoted the file's real line verbatim, making the error
  a read channel that never passes the `read_file` gate. New `safety.scrubAndTruncate()`
  scrubs then caps at 120 chars, applied to `actual` only — `expected` came from the model's
  own `patch_text`, so echoing it discloses nothing new. Scrub happens **before** truncate,
  so a sliced secret cannot dodge its own pattern.
- **Known limitation, deliberately not fixed:** a single context line from a minified file
  can still be large in `result.diff`. Capping the diff was outside A6.

### A10 — the false comment _and_ the bug it licensed

`tool-pipeline.js:79-80` claimed `confinePath` returns realpath-anchored paths "so symlink
aliasing is mostly defused at the source." False — `confinePath` returns the **lexical**
path and uses the realpath only for the containment test.

`_groupDisjointWrites` relied on that claim, so `a.txt` and a symlink `alias.txt → a.txt`
produced two different strings, were judged disjoint, and were **written in parallel to the
same inode**. Fixing only the prose would have left a documented race. Grouping now
canonicalizes through `resolveFileTarget` and keys on `real || lexical` (`real` is null for
a not-yet-existing file, where lexical is the correct answer). A denied target is isolated
like a pathless tool so the permission layer still emits its own denial.

### A11 — one basename deny list instead of three

`safety.js` now owns `BLOCKED_BASENAME_PATTERNS` + `isBlockedBasename()`. `shell-policy.js`
imports it; `permissions.js` delegates to it as a compatibility surface (its copy was
**dead** — exported and unit-tested but never in the `check` path). `DENY_MATRIX_PATTERNS`
calls it for its basename tier.

The directory-segment tier stays separate **on purpose**, and now says why: `/.git/` must
match a mid-path segment, whereas `.env` must match only the final segment — so a directory
named `secrets/` must not deny everything beneath it.

**Intentional behavior change:** shell now also blocks `.netrc`, `.npmrc`, `id_rsa*`, and
`id_ed25519*` basenames. `shell-policy`'s copy had drifted to a strict subset of safety's,
so shell permitted filenames the file tools already denied. This is a strengthening; no
test asserted those were allowed.

### A7 — archive artifacts

The 0644 measurement had a cause, not just a missing assertion: **none of the four archive
writers used `private-fs.js`**, so they inherited the process umask. Transcript, session,
ledger, trust, trace, and recovery-manifest all already used it.

Changed to `ensurePrivateDir` / `privateWriteFileSync` / `privateAppendFileSync`:
`archive/indexer.js`, `archive/run-exporter.js`, `archive/session-rollup.js`,
`archive/spreadsheet.js`. `run-exporter.js` no longer needs its `fs` import at all.

One special case: `XLSX.writeFile` opens the file itself and takes no mode, so it is
followed by a best-effort `fs.chmodSync` — the only archive write that cannot be created
private.

New `test/runner/fd-10-artifact-modes.test.js` walks the archive tree asserting 0700/0600,
then covers transcript, session, ledger, trace (both `redacted` and `full` levels), trust
store, and recovery manifest. It also **asserts the P0-12 carve-out holds**: a project file
written by `write_file` must match a plain `fs.writeFileSync` control file in the same
directory, so the runner is proven _not_ to force privacy on user project files. The
control-file oracle is deliberate — hard-coding "not 0600" would fail spuriously under
`umask 077`.

**The archive fix is forward-looking only.** Files already on disk at
`~/.bridge-runner/archive` stay 0644. Nothing retroactively re-chmods them. If those matter,
that is a separate decision for Alan, not something this change did.

### Pre-existing condition found, not caused here

`npm run format:check` was **already red on `main`** before any of this work, on six
markdown files: `CLAUDE.md`, `HANDOFF-CURSOR-dot-cursor-audit-2026-07-25.md`,
`HANDOFF-permission-safari-UPDATE-round1-attempt.md`, this file,
`HANDOFF-safari-3-remediation-plan-2026-07-25.md`, and
`PROMPT-safari-3-phase-a-continuation.md`. Confirmed pre-existing: none were modified by
this session at the time of the check.

Left alone deliberately. Running `npm run format` would rewrite historical handoff records
and `CLAUDE.md` as a side effect of an unrelated batch, which conflicts with this repo's
practice of not rewriting original records. Prettier was run on the JS files touched here
only.
Worth a dedicated decision from Alan: either format the markdown once in its own commit, or
scope `format:check` to `src/`/`test/` and stop reporting a permanent red.

### Untracked files present, intentionally not committed

`docs/cursor-dot-cursor-triage-2026-07-26.html` and
`docs/compaction-context-audit-2026-07-26.html` were already in the working tree and are
unrelated to this batch. Left untracked rather than swept into a safety commit.
