> **Final implementation published and verified 2026-11-11 — all GitHub checks passed.** Start with [Codex's completed handoff](HANDOFF-correct-mistake-classes-thermo-nuclear-2026-11-11.md) or its [browser companion](HANDOFF-correct-mistake-classes-thermo-nuclear-2026-11-11.html). Final implementation commit: [`a2a0a7e`](https://github.com/alankatanoisi/claude-local-bridge-playground/commit/a2a0a7eeea24d6a98896c7a027de847dd3bc114d). A separate agent found no actionable issues in all 12 reviewed files. [Ubuntu CI](https://github.com/alankatanoisi/claude-local-bridge-playground/actions/runs/43122934121) passed with 1,374 main tests passed, 0 failed, 3 environment/platform skips, and 128/128 Starlark tests passed; [CodeQL](https://github.com/alankatanoisi/claude-local-bridge-playground/actions/runs/43122934214) also passed. The push and local/remote main synchronization were verified. The original implementer account and pre-correction failed CI runs below are preserved unchanged.

# Handoff — `/correct` pass: six recurring mistake classes enforced mechanically (2026-11-11)

> **Status banner — NOT YET REVIEWED.** Built by Cursor (Claude Opus 5.5) on 2026-11-10/11 at Alan's request
> (`/correct` skill: "change the repo so the next agent can't make the same mistakes"). Landed on playground
> `main` as five commits, `d4c1ec4..28e07b7`. Every claim below is the implementer's own account until another
> agent reviews it. Three of the five commits touch runner code (`src/runner/**`), so per the four-seat charter
> (`docs/agent-team-charter-2026-08-25.md`) they owe at least one independent invariant review. **CI on GitHub is
> currently red** — see §5. Do not treat this file's "passed" claims as settled; re-run the checks yourself.

**Folder:** `/Users/alanman/Developer/claude-local-bridge-playground` · **Branch:** `main` · **Remote:** `origin` →
`alankatanoisi/claude-local-bridge-playground`

**Range to review:** `2fc7d92..28e07b7` (five commits). Commit `5755007` sits on top of that range but is **not part of
this work** (see §6).

## 1. What the task was, in one paragraph

Alan ran `/correct`. That skill asks an agent to read recent commits, reverts, review handoffs, and instruction files;
group repeated agent mistakes into classes (a class counts once it has happened twice); and fix each class at the
highest level that works — architecture first, then an automated check, then a behavioral test, and prose rules only
for judgment calls. Each new check had to be proved **red against the real broken state** before the fix. Finally, a
table pairing each rule with what enforces it had to be added to the agent instruction files.

## 2. The five commits

| Commit    | Class | Title                                                                                                           |
| --------- | ----- | --------------------------------------------------------------------------------------------------------------- |
| `d4c1ec4` | 2     | `fix(runner): enforce effectiveFlags(ctx) ceiling across pipeline, watcher, and visibility`                     |
| `531b48a` | 3     | `fix(runner): derive prompt-table parity and permission-cache invalidation from tool-catalog`                   |
| `0cb647f` | 4     | `fix(runner): score golden checklists on --update, confine symlink checks, and make quarantine fixture live`    |
| `0659333` | 5, 6  | `chore(gates): lint bin/ and scripts/, untrack hook state, restore format:check, cap 1k-line files, and add CI` |
| `28e07b7` | 1     | `feat(docs): add check-agent-docs gate, fix live command-builder skills, and add Enforced Rule Table`           |

## 3. Classes, evidence, level picked, and what changed

### Class 1 — Agent instruction and skill drift across surfaces (`28e07b7`)

- **Evidence:** `99b2366` + `AGENT-DOCS-DIVERGENCE-2026-07-25.html` (CLAUDE.md missing the profiles retirement and the
  VS Code auth-settings fence; it said a `check:agent-docs` script was "recommended, not yet built");
  `HANDOFF-CURSOR-dot-cursor-audit-2026-07-25.md` (live `runner-command-builder` agent and skill told agents to emit
  retired `--agent` flags, a stale default model, and deleted docs); `915ea89` reverted in `8cfef45`; `e8f9297` →
  charter review; `f85ad5f` copied the same broken primitives into `.agents/skills/` and `.codex/agents/`.
- **Level:** automated check. New `scripts/check-agent-docs.js`, appended to `npm run check:docs`. It enforces:
  bullet-identical `Learned User Preferences` / `Learned Workspace Facts` / `Enforced Rule Table` between `AGENTS.md`
  and `CLAUDE.md`; every enforcer path cited in that table exists on disk; core invariants present in both files;
  no retired or unknown runner flags, stale `DEFAULT_MODEL`, or deleted-doc pointers in live primitives under
  `.cursor/{agents,rules,skills}`, `.agents/skills`, `.codex/agents`, `.github/copilot-instructions.md`;
  `.cursor/skills` ↔ `.agents/skills` file-set and content parity (host names Cursor/Codex normalized); Cursor ↔ Codex
  `runner-command-builder` agent body parity. Historical `.cursor/plans/**` are deliberately not scanned.
- **Why not architecture:** Claude Code, Cursor, and Codex each auto-load different files, so separate copies must
  exist.
- **Content changes:** rewrote the four live `runner-command-builder` primitives to use `--plan`, `--capabilities`,
  `--accept-edits`, `--tools`, default model `claude-sonnet-5`, and existing docs; added `VS Code extension auth
settings` to CLAUDE.md's bridge fence; replaced CLAUDE.md's "not yet built" mirror note; replaced the stale
  Cursor Cloud notes in AGENTS.md (format:check and the Linux bash test were described as known failures); added the
  10-row `## Enforced Rule Table` to both files.
- **Red proof:** before the doc edits, `npm run check:docs` exited 1 with 38 issues.

### Class 2 — Raw `ctx.allowShell` / `ctx.plan` / `ctx.noNetwork` reads instead of `effectiveFlags(ctx)` (`d4c1ec4`)

- **Evidence:** `02e1503` created the authority ceiling; PR #27 review F1 + `5dd1b91` fixed raw `ctx.noNetwork` in five
  modules but only guarded `noNetwork` (`FG-I2`). On `HEAD` before this work, six modules still read raw `plan` /
  `allowShell`: `tool-pipeline.js`, `test-watcher.js`, `tool-visibility.js`, `user-question.js`,
  `context-budget.js`, `run.js`.
- **Reproduced holes (now closed):** clearing `ctx.plan` under a `--plan` ceiling made the pipeline call
  `confirm.ask` instead of recording a proposal, and let `askUserQuestion` skip its plan refusal. Flipping
  `ctx.allowShell = true` under an `allowShell: false` ceiling enabled `test-watcher` (which spawns a shell child
  directly, without `permissions.check`) and made `bash` visible.
- **Level:** static scan + behavioral tests in `test/runner/false-green-permission-matrix.test.js`: `FG-B19` bans raw
  reads of the three flags across `src/runner/**` (allowlist: `authority.js` ×9, `run.js` ×3 for the
  `run_started` trace snapshot); `FG-B20..B23` exercise each hole.
- **Why not architecture:** `SECURITY.md` allows mid-run narrowing on the live `ctx`, and tests pass plain objects.
- **Red proof:** all five new tests failed before the source edits.

### Class 3 — Secondary tables, tests, and cache invalidation drifting from `tool-catalog.js` (`531b48a`)

- **Evidence:** N1 (`args.path` only); PR #27 review F3 (still open on `HEAD`: cache invalidation matched only
  `"path":` and missed `./a.txt`); `19c2a69` → context-layer review Low #7/#8 → `2758fe2` (history group missed in
  `TOOL_SUMMARIES`, `GROUP_LABELS`, `FULL_TOOL_DESCRIPTIONS`; `context-budget.js` claimed a drift guard that did not
  exist; the fix hardcoded `'history'` into the P2 test); ACP review High #1 / Medium #4.
- **Level:** architecture + checks. `permissions.invalidateDecisionCache` now parses each cached key's args and
  matches every key from `pathArgKeysFor(tool)` ∪ `CANONICAL_PATH_ARG_KEYS`, comparing both raw and
  `cwd`-resolved paths. One shared `invalidateCachesAfterWrite` in `tool-registry.js` replaces two copies. Inline
  `require` calls hoisted. `p2-01-02-tool-surface.test.js` derives group shapes from `OPTIONAL_CAPABILITIES`.
  `FG-D14` / `FG-D15` enforce exact key parity (`GROUP_LABELS` and `FULL_TOOL_DESCRIPTIONS` are now exported).
- **Why prose tables were not merged:** summaries, full descriptions, and API descriptions are intentionally
  different lengths; key completeness is what must not drift.
- **Red proof:** `FG-D14`, `FG-D15`, and the new alias/key invalidation test failed before the fix.

### Class 4 — Tests and evals that can pass without checking (`0cb647f`)

- **Evidence:** `24d0df8` → `db9354c`; golden-eval review Medium #1 and Low #2–#4 (all still open on `HEAD`); PR #27
  F2 (cache-hit test); ACP review Medium #4 (`'A'.repeat` base64 test).
- **Level:** architecture + tests in `src/runner/golden-eval.js`: `--update` no longer `continue`s before checklist
  scoring (checklist-only cases are verified and never snapshotted; dual-mode refreshes `expect` but still fails a
  broken checklist); empty `checklist: []` without `expect` fails in both modes; file predicates check the
  `realpath` of existing targets against the case `cwd`. Fixture `he06-offered-tools-quarantine.json` now carries a
  valid `{ path, patch_text }` payload plus `acceptEdits: true`, and a test proves that payload really mutates disk
  when run directly.
- **Red proof:** all five new tests in `golden-eval.test.js` failed before the fix.

### Class 5 — Blind or permanently red gates (`0659333`)

- **Evidence:** `npm run lint` skipped `bin/` and most of `scripts/` (running it there found a real duplicate
  `exposedTools` key in `bin/local-bridge-runner.js`); `.cursor/hooks/state/continual-learning.json` was added to
  `.gitignore` three times (`8bfe4b6`, `f05f69e`, `f85ad5f`) while still tracked; `format:check` had been red since
  `1d1fb0f`, with six commits writing excuses; no CI workflow ran tests, lint, docs, or format.
- **Changes:** lint/format now cover `bin/ src/ test/ scripts/`; the five lint findings fixed; `.gitignore` duplicates
  removed and both hook-state files untracked with `git rm --cached` (files kept on disk); new `.prettierignore`
  excludes only the four historical thermo-nuclear handoffs (inline reason + expiry `2027-02-10`); new
  `.github/workflows/ci.yml` runs `lint`, `check:docs`, `format:check`, `npm test`, `test:starlark`;
  `bash.test.js` signal test now uses `exec bash -c` so Ubuntu's `dash` does not convert the signal into exit 134.
  Guards `FG-G10`, `FG-G11`, `FG-G13` in `false-green-suite-integrity.test.js`.
- **Red proof:** `FG-G10`, `FG-G11`, `FG-G13` failed before the fix; ESLint on `bin/ scripts/` reported 3 errors and
  2 warnings.

### Class 6 — Files growing past 1,000 lines (`0659333`)

- **Evidence:** context-layer review (`run.js` 1,972 lines, "do not keep feeding that file"); Starlark R11 review
  Medium #4 (`coordinator.js` 622 → 874); ACP review High #2 (`acp/agent.js` 1,032, `acp-agent.test.js` 1,043 at
  `fb6b0fd`).
- **Level:** check `FG-G12`: every `.js` in `bin/ src/ test/ starlark-host/{src,test}` ≤ 1,000 lines, except
  `src/runner/run.js` ratcheted at 1,992 (inline reason cites the "do not split `run.js`" directive; expiry
  `2027-02-10`). Verified the old `fb6b0fd` line counts would fail.
- **Why not split `run.js` now:** an owner-level review directive says not to split it unbidden.

## 4. Behavior changes reviewers should look at first

1. **`tool-visibility.js`:** `isToolVisible` and `isBaseEligible` now consult `toolAboveCeiling` and
   `effectiveFlags(ctx).allowShell`. The `ctx.allowedTools` branch now also re-runs `isBaseEligible`, so a tool in
   the allowlist can disappear if its consent flag is narrowed mid-run. Confirm no legitimate path relied on the old
   allowlist short-circuit.
2. **`test-watcher.js`:** now also refuses to run when effective `plan` is on (previously only the pipeline's
   `!ctx.plan` guarded that).
3. **`run.js` archive flags:** `allowShell` and `plan` in `RunArchiveCollector` flags are now effective values. The
   removed comment had argued raw was intentional because `narrowChildAuthority` clamps downstream. Check whether
   anything consumes those archive flags as "operator's raw choice."
4. **`permissions.invalidateDecisionCache`:** parses JSON out of each cache key (split after the third `|`). It
   over-invalidates in the safe direction; cost is bounded by the 512-entry cap.
5. **`golden-eval.js` symlink check:** a dangling symlink is not `realpath`-checked (`existsSync` is false), so
   `file_absent` passes and `file_exists` fails for it. Intended, but confirm.
6. **Untracking `.cursor/hooks/state/*.json`:** any other clone that pulls `main` (for example the 2020 laptop) will
   have those two local files **deleted** by Git on pull, because they leave the index. They are regenerated hook
   state, but the other machine's continual-learning counters reset.

## 5. CI result on GitHub (real output, run `42985886672`, head `5755007`)

- Passed: install, `npm run lint`, `npm run check:docs`, `npm run format:check`.
- **Failed: `npm test` — 1,353 tests, 1,349 pass, 1 fail, 3 skipped.** Skipped on Linux: `rg` is not installed on the
  runner, plus registered platform skips.
- `npm run test:starlark` was **skipped** because the test step failed first, so the Go build has never run in CI.
- **The one failure:** `test/runner/hs01-review-regressions.test.js:78`, "allows inline code, ordinary data and
  ordinary project globs":
  `execute: bash -c $'cat README.md': Command exited with code 127 … bash: line 1: README.md: command not found`.
  Cause: `bash.execute` uses `spawnSync(..., { shell: true })`, which is `/bin/sh`. On macOS that is Bash; on
  Ubuntu it is `dash`, which does not understand `$'…'` quoting, so `$cat` expands to nothing and Bash is asked to
  run `README.md`. This test came from the HS-01 work (`5690eec`), not from this pass, and it passes on macOS. It is
  the same family as the `bash.test.js` signal issue fixed in `0659333`.
- **Not fixed here** — Alan asked for a handoff before any further moves. Options for whoever picks it up: run the
  CI test step with `SHELL`-independent Bash (for example make the test invoke `bash` explicitly), mark the case as
  a reviewed macOS-only skip in `FG-M4`'s register, or decide the scanner should be tested under `dash` too. This is
  a judgment call for Alan; do not weaken the assertion.
- Pre-existing and unrelated: both GitHub Pages workflows failed on `f85ad5f` (2026-11-03) and did not run since.

## 6. Commit `5755007` — not part of this work

`5755007` (author Alan Man, 2026-11-11 00:17, pushed together with this range) is titled
`fix(runner): enhance case-insensitivity checks for protected paths and filenames` but only **adds**
`docs/automation-ledger/fingerprint-checks/2026-11-07T00-00-10-836Z-check.md`, the scheduled fingerprint report that
this pass deliberately left untracked. The title does not describe the change. That report says **fingerprint drift
detected** (local Claude Code 2.1.318, npm latest 2.1.319, repo fallback 2.1.301; billing block present). Pointer
for the fingerprint thread only — `docs/automation-ledger/README.md` has the review procedure.

## 7. Not bugs (do not "fix")

- `run.js` still has three raw flag reads inside the `run_started` trace `flags` block. That records the operator's
  startup selection, where raw equals effective; `FG-B19` allowlists exactly those three.
- `run.js` is over 1,000 lines. The ratchet is intentional; do not split it as part of this review.
- `.prettierignore` lists four historical handoffs. Their bytes are preserved on purpose (record authenticity). All
  living root `.md` files and all new handoffs are still formatted and checked.
- `.cursor/plans/**` is not scanned by `check-agent-docs.js`. Those are historical records and still mention retired
  flags by design.
- The Cursor/Codex host-name normalization in `check-agent-docs.js` is intentional: the mirrored copies legitimately
  differ only in the host name.
- `--update` refreshing `expect` on dual-mode cases while still failing on the checklist is the requested behavior
  from the golden-eval review, not a contradiction.

## 8. Known nits in the new code (low, optional)

- `scripts/check-agent-docs.js` `extractHeadingSection` builds an unused regex and discards it with `void re`. Dead
  code; safe to delete.
- Its retired-flag check exempts any line containing words like "never" or "do not". A line that both negates one
  thing and instructs a retired flag would slip through. Line-based heuristic; acceptable for now.
- `FG-B19`'s allowlist condition passes when a file has _fewer_ raw reads than allowed (ratchet down), which is
  intended but reads awkwardly.

## 9. Checks run locally before this handoff (macOS, Node 22, Go 1.26)

- `npm run lint` → clean. `npm run check:docs` → all three scripts passed. `npm run format:check` → clean.
- `npm test` → 1,353 tests. Inside Cursor's sandbox 22 failed, all traced to sandbox limits (loopback sockets,
  `git init` under `$TMPDIR`, writes under `~/.claude-local-bridge`); the eight affected files re-run outside the
  sandbox: 77 / 77 pass. Total: 0 failures on macOS.
- `npm run runner:eval` → 9 cases, 27 / 27 checklist predicates.
- `npm run test:starlark` → evaluator built, 128 / 128 pass, 0 skips.
- `node scripts/mutation-check.js` → 9 / 9 mutations caught.
- Linux: see §5 — one failure.

## 10. Recommended review order and pointers

1. Read this file, then `git show d4c1ec4 531b48a 0cb647f` (runner code — the part that owes a charter review).
2. Check §4 items 1–3 against callers of `isToolVisible`, `runIfEnabled`, and `RunArchiveCollector`.
3. Re-run the red proofs if you doubt them without touching the main checkout: create a scratch worktree at the
   parent of a commit (`git worktree add /tmp/review-d4c1ec4 d4c1ec4^`), copy in that commit's new test file, and
   run it; it should fail there. Remove the scratch worktree afterwards (`git worktree remove /tmp/review-d4c1ec4`).
4. Decide §5 (Linux `dash` failure) with Alan before touching it.
5. Write findings as a dated `HANDOFF-*-thermo-nuclear-*.md` per the Learned preference, then stop.

Not updated in this pass: the `CLAUDE.md` "Current Work Thread" pointer list (Alan asked for this file only). The
next agent should add a one-line pointer to this handoff there when it next edits `CLAUDE.md`.

Fences: do not edit `src/credentials.js`, `src/proxy.js`, `src/server.js`, `src/interceptors/**`, or VS Code extension
auth settings. Do not restore `--agent` / `--profile`. Commit or push only if Alan asks.
