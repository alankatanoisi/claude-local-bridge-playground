# F1 no-network ceiling fix + PR #27 landing — 2026-09-09

**Author:** Cursor (review seat, executing Alan's explicit "fix F1 and land everything on main" instruction).
**Status:** complete and merged. PR [#27](https://github.com/alankatanoisi/claude-local-bridge-playground/pull/27) is
**MERGED** (2026-09-09 09:57 UTC); everything below lives on `origin/main`.

## What changed and why

**Background (plain language).** A run that starts with `--no-network` makes a promise: nothing later in the
run may switch network protection back off. That promise is the _authority ceiling_ (`src/runner/authority.js`),
frozen once at startup. The runner keeps two copies of the flag: the mutable `ctx.noNetwork` (which hooks or
future features could flip mid-run) and the ceiling-clamped `effectiveFlags(ctx).noNetwork` (which can only ever
turn protection _on_, never off).

**The bug (F1, found by the thermo-nuclear review of PR #27).** The permission _gate_ read the effective flag,
but the shell-command _scanner_ — the component that first notices "this command talks to the network" — read the
raw mutable flag (`shell-policy.js`, formerly line 177). Clearing `ctx.noNetwork` mid-run therefore made the
scanner go silent, the gate's deny had nothing to act on, and any _new_ network command fell through to `allow`.
The ceiling promise ("the network guard can never be dropped", `authority.js`) was false at that layer. No in-repo
code path performs such a mutation today — this is defense-in-depth, in the same spirit as the PR it reviewed.

**The fix (commit `5dd1b91`).** Every enforcement and propagation site now reads the effective flag:

- `src/runner/shell-policy.js:184` — the scanner (the load-bearing one).
- `src/runner/tools/bash.js`, `src/runner/background-shell.js`, `src/runner/hooks/hook-runner.js` — the three
  proxy-blackhole `buildEnv` sites (they set dead `http_proxy=127.0.0.1:1` variables as a backstop).
- `src/runner/child-inherit.js:35` and the spawn flags block in `src/runner/run.js` — children now inherit the
  ceiling even if the parent's mutable flag was cleared. (`allowShell`/`acceptEdits`/`dontAsk` there stay raw on
  purpose: `narrowChildAuthority` already clamps them against the parent ceiling downstream; `noNetwork` had no
  such downstream clamp.)

**Deliberately left raw:** the run-manifest flag record in `src/runner/run.js:1326`. It is telemetry — a record of
the flags the operator chose at startup (when raw == effective anyway), not an enforcement point.

**Test 3 amendment (same commit).** The PR's own test "keeps the startup network restriction when its mutable flag
is cleared" re-checked the _identical_ command after clearing the flag — a decision-cache hit that never re-ran
the gate, so it passed even while the hole existed. It now also checks _new_ command strings
(`curl`/`wget https://other.example`) after the clear: the cold-cache case that returns `allow` without the fix.

**FG-I2 register re-pointed and extended (same commit).** `test/runner/false-green-egress-surface.test.js`
contains a _source audit_ guard: it greps `src/runner/` and pins the exact list of files allowed to branch on the
network flag, so silently deleting a guard is loud and adding a network surface without one is a reviewed decision.
My change tripped it by design ("update this register on purpose"). The register now pins the four enforcement
points branching on the **effective** flag — and additionally **bans any raw `if (ctx.noNetwork)` branch anywhere
in `src/runner/`**, so this exact regression can never come back quietly. (Related: the same file's FG-I3 test
passed all along while only exercising the `effectiveFlags` helper, never an enforcement path — the reason the
hole hid behind green tests.)

## Evidence (real output, this machine)

| Check                                                        | Result                                                                  |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Targeted file, amended test vs **unfixed** code              | **7 pass / 1 fail** — cold-cache case returned `allow`, expected `deny` |
| Targeted file after the fix                                  | **8 pass / 0 fail** (`test/runner/permission-decision-cache.test.js`)   |
| Egress + cache + bash files after FG-I2 update               | 42 pass / 0 fail                                                        |
| Full suite `npm test`, **unsandboxed**                       | **1,086 pass / 0 fail / 1 pre-existing todo** (1,087 total)             |
| `npm run lint`, `npm run check:docs`, `npm run format:check` | all clean (handoff docs Prettier-formatted to pass the format gate)     |

Commits: `5dd1b91` (fix + tests) and `434ed87` (the two review handoffs) on `codex/starlark-r11-live-verification`;
merge commit `1189232` on `origin/main` (parents `8bfe4b6` + `434ed87`) contains both plus the original `2abc0df`.

## Current status

- This folder (`/Users/alanman/Developer/claude-local-bridge-playground`) sits on
  `codex/starlark-r11-live-verification` — kept, merged, **not deleted**.
- `main` is currently checked out in Codex's worktree at `~/.codex/worktrees/df82/claude-local-bridge-playground`
  (clean @ `8bfe4b6`, deliberately untouched — Cursor's safety layer blocked mutating another agent's checkout,
  and that was the right call). Git refuses to check out the same branch in two folders at once, because both
  would fight over the branch pointer; that's the only reason this folder can't switch to `main` today.
- **To get this folder back on main later:** once the Codex worktree is released (that session ends or runs
  `git worktree remove`), run here: `git checkout main && git pull`. Until then, this branch's tip and `main`
  contain identical code.
- FYI, pre-existing and unrelated to this work: GitHub reports **1 high Dependabot alert**
  ([#12](https://github.com/alankatanoisi/claude-local-bridge-playground/security/dependabot/12)) on the default
  branch.
- `.cursor/hooks/state/continual-learning.json` is intentionally left dirty — it is Cursor's own session-state
  file, not project work, and was never staged.

## Pointers and open items

- The review that found F1: `HANDOFF-pr27-permission-cache-thermo-nuclear-2026-09-09.md` (full verification log,
  not-bugs list, fix order). A parallel pass of the same review lives in
  `HANDOFF-permission-cache-thermo-nuclear-2026-09-09.md`; findings are consistent.
- The original PR #27 handoff (the cache-key fix F1 was found on top of):
  `HANDOFF-permission-cache-fix-2026-09-07.md`.
- **Deferred (not bugs in this change):** F3 — `invalidateDecisionCache`'s `"path":"..."` substring matching is
  narrower than the N1 path-arg catalog (optional follow-up; harmless today because permission decisions don't
  depend on file contents). F4 — process note: prefer standalone commits for future safety fixes over bundling
  with large doc payloads.
- **Threat-model note for the next agent:** no in-repo code path mutates `ctx.plan` / `ctx.noNetwork` mid-run
  today (grep-verified). Both the PR's cache fix and F1 are defensive against a route that does not yet exist;
  the difference is that both are now pinned by tests that would fail loudly if the enforcement layers regress.

## Handoff fields

- **Folder/branch:** `/Users/alanman/Developer/claude-local-bridge-playground`, branch
  `codex/starlark-r11-live-verification` (tip after this doc's commit; see `git log`).
- **Files changed this session:** 6 src + 2 test files (`5dd1b91`); 3 handoff docs (`434ed87` + this doc's commit).
- **Checks run:** see Evidence table. **Skipped:** Starlark Go suite (no Go toolchain on this machine); live model
  runs (not needed); banner edit on the 09-07 handoff (recommended only, not authorized).
- **Risks/next:** none known for the fix. Housekeeping: sync Codex's worktree when convenient; this folder back to
  `main` once released; optional Dependabot alert triage.
