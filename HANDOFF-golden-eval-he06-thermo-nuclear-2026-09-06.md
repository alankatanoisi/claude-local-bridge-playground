# Handoff — Thermo-nuclear review of `65c001a` (golden-eval checklists + HE-06)

**Written:** 2026-09-06. Review only; no runner/eval code changed (this file + a
banner on the programmatic-tooling research review).
**Scope:** already-landed playground `main` commit `65c001a`
(`feat(runner): terminal-state checklist scoring for golden evals + the seven
HE-06 cases`). No feature branch. No pull request for this commit — do not
invent one. Later commits on `main` (`19c2a69`, headline index, Starlark R11)
did **not** retouch these files; line numbers below match both `65c001a` and
current HEAD for this slice.
**Verified against:** `git show 65c001a` and the current callees
(`run.js`, `tool-registry.js`, `tool-pipeline.js`, `permissions.js`,
`session-health.js`, `plan-proposals.js`, `apply-patch.js`, `model-pricing.js`).
Not against the commit message, CLAUDE.md status, or the research-review HTML.

Thermos subagents (`thermo-nuclear-review-subagent` and
`thermo-nuclear-code-quality-review-subagent`) failed to spawn (tool timeout,
retried once). This is a parent-conducted review against both rubrics.

Eleven files in the commit. The live surface is `src/runner/golden-eval.js`
(344 → 664 lines) plus seven `test/runner/golden/he06-*.json` cases.

## Verdict

No High findings. The seven HE-06 cases, as written, do pin the terminal
states they name when scored on the default `runGoldenEval()` path (fraction
1.0, unknown checks fail closed). USD cost, resume-degraded, symlink deny,
shell-hidden, allowlist ceiling, plan invalid-proposal, and offered-set
refusal all match the current `run.js` / registry control flow.

The gaps are in the **eval harness itself**, not in those runner gates: the
documented `--update` path can report checklist cases green without scoring
them, and a few predicates overclaim what they actually prove.

## Findings (in-scope for `65c001a` only)

No High findings.

### Medium

1. **`runner eval --update` marks checklist cases passed without scoring them.**
   `src/runner/golden-eval.js` 580–593: after `executeGoldenCase`, the
   `--update` branch `continue`s before `evaluateChecklist`.
   - Checklist-only (`expect` absent, `checklist` present): pushes
     `{ ok: true, updated: false }` and never calls `evaluateChecklist`.
   - Dual-mode (`expect` **and** `checklist`): the condition
     `caseData.expect || !caseData.checklist` (584) is true, so it rewrites
     `expect`, writes the JSON, and `continue`s — also skipping checklist
     scoring.
   README (commit hunk) says `--update` never converts a checklist-only case
   into a snapshot. That part is true. It does **not** say `--update` still
   **evaluates** those cases. `bin/local-bridge-runner.js` 247–260 then prints
   `N golden case(s) passed` whenever `summary.ok` is true. On this path
   `checklistTotals` is also empty (results have no `checklist` field), so
   the new predicate tally does not appear as a warning either.
   Default `runGoldenEval()` (no `--update`) still scores at fraction 1.0;
   `npm test` still catches a broken HE-06 case. The false-green is the
   documented CLI refresh path: `node bin/local-bridge-runner.js runner eval --update`.
   Tests added in this commit never pass `{ update: true }`.

### Low

2. **File-predicate "cwd confinement" is lexical and follows `cwd_symlinks`.**
   `resolveChecklistFile` (352–359) uses `path.resolve` +
   `startsWith(cwd + path.sep)`. `file_exists` / `file_absent` / `file_content`
   then call `existsSync` / `readFileSync`, which follow symlinks.
   `setupCaseWorkspace` (80–84) plants `cwd_symlinks` with **no** target
   confinement (`fs.symlinkSync(target, linkPath)`). A case whose link
   target is `/etc/passwd` (or a home secret) has a path that is still
   inside the sandbox cwd, so the prefix check passes and the predicate
   reads the outside file. The comment at 354–355 ("a checklist must not be
   able to read outside its own sandbox cwd") is stronger than the code.
   The unit test at `test/runner/golden-eval.test.js` 165–173 only covers
   `../../etc/hosts`, which the lexical check does catch. Golden JSON in
   this repo is first-party, so this is a harness overclaim, not a
   production runner leak.

3. **Empty `checklist: []` with no `expect` is a silent pass.**
   `runGoldenEval` 596: `if (!caseData.expect && !caseData.checklist)` —
   an empty array is truthy, so this error does not fire. Scoring at 618
   requires `checklist.length > 0`, so neither mode runs and `caseOk`
   stays true. The load test (34) rejects this shape for **shipped** files
   under `DEFAULT_GOLDEN_DIR`. `runGoldenEval` itself does not. `--update`
   treats `[]` as checklist-only (584: `!caseData.checklist` is false) and
   also reports ok.

4. **`he06-offered-tools-quarantine` disk predicate is inert given the fixture.**
   The case (`test/runner/golden/he06-offered-tools-quarantine.json` 19)
   sends `input.patch` and no `path`. `apply-patch.js` 276–277 requires
   `patch_text` (and the schema requires `path`). If the offered-set pin
   dropped, `execute` would still return "Missing required patch_text…"
   and leave `notes.txt` untouched. `file_content` would still pass.
   The real pin is `tool_result_includes` `"not offered"` (34). Keep that
   string check; do not treat the disk predicate as proof of quarantine.
   (`apply_patch` is `hidden: true`, not in `QUARANTINED_TOOLS` — the
   filename says "quarantine"; the description correctly names the
   offered-set pin.)

## Not bugs (do not fix)

- **Terminal-state checklists as a second scoring mode.** That is the
  point of the commit (research review idea 2 / EnvScaler shape). Do not
  convert the seven HE-06 cases back into `expect` snapshots.
- **`--update` refusing to snapshot checklist-only cases.** Keep that.
  Medium #1 is "still score them," not "write an `expect` block over them."
- **Unknown check types fail closed** (`evaluateChecklist` 482–484). Keep.
- **`process.exitCode` save/restore** (301–311). Failure-shaped replays
  (`cost_budget_exceeded`, `resume_failed`) set `process.exitCode = 1` via
  `run.js` `setExitCode`. Without this restore, `node:test` reports the
  whole file failed. Keep.
- **`skipTrustGate: true` / `bare: true` on every replay.** Test harness
  defaults; `test/setup.js` already injects the trust bypass. The HE-06
  cases are not trying to pin the trust gate.
- **USD cost checked in `midTurnCheck` after the first read, not in
  `emitBudgetBoundary` after the model response.** `run.js` 1640–1647
  (token-budget tracker) vs 1826–1834 (USD). `he06-budget-cost-exhaustion`
  first-tools `list_files` (a read) with 2e6/1e5 tokens; default pricing
  (`model-catalog.js` `DEFAULT_PRICING` $3/$15 per MTok) is ~$7.50 against
  `maxCostUsd: 0.00001`. `list_files` runs; `read_file` does not. The case
  matches the control flow. Do not move the USD check to "before any tool"
  just to make the story tidier.
- **`he06-shell-hidden-dont-ask` uses `tool_errored`, not `tool_denied`.**
  `dontAsk` mode maps shell → `allow` (`permissions.js` 32–38), but
  `isBaseEligible` / `isToolVisible` hide `bash` unless `allowShell`
  (`tool-visibility.js` 32). The scripted `bash` hit is
  `denyNotOffered` (`tool-registry.js` 241–242, 97–106) — `ok: false`,
  **no** `permission` object. `tool_denied` would be a false red. The
  disk pin (`pwned.txt` absent) is the execution invariant. If `dontAsk`
  ever implied `allowShell`, both the offered-set and `permissions.js` 358
  (`!eff.allowShell`) would have to fail for the file to appear; the case
  would catch that.
- **`he06-authority-ceiling` uses `tool_errored` + `file_absent`, not
  `tool_denied`.** `_cliToolAllowlist` → `computeAllowedTools` omits
  `write_file`, so it is not offered. Same `denyNotOffered` path. Disk
  pin is the ceiling invariant.
- **`he06-resume-degraded` two-phase + `use_session`.** `skipTrustGate`
  skips `runBootstrap`, but `run.js` 670 still opens `SessionStore`.
  `completeRun` 985–995 writes `buildHealth` on `max_steps` (degraded).
  Phase 2 `resume: true` hits `assertResumeAllowed` 1186–1193 →
  `STOP_REASONS.RESUME_FAILED` with `formatResumeBlockedMessage`
  ("Session health is degraded", `--new-session`). `emitHint`'s
  `stopReason: 'resume_degraded'` is hint telemetry only; the golden
  correctly checks `resume_failed`. Dedicated e2e test at
  `golden-eval.test.js` 193–201. Keep.
- **`he06-symlink-deny` `tool_denied` + `tool_result_lacks`.** `read_file`
  is offered; the gate is `permissions.check` / `resolveFileTarget`
  (realpath basename `.env`). `wrapPermissionResult` attaches
  `permission.decision === 'deny'`. Paired with `tool_denied`,
  `tool_result_lacks` passing on "tool never called" (comment 440–441)
  does not apply. Extra assertion in the dedicated test that `.env` is
  intact. Keep.
- **`he06-plan-proposal-invalid-edit` looking for `"proposal invalid"`.**
  Plan mode maps writes to `plan_only` → `decision: 'ask'`
  (`permissions.js` 448–456); the pipeline records
  `buildPlanProposal` (`plan-proposals.js` 114–115:
  `'Plan mode: proposal invalid — ' + materialized.error`). Disk
  untouched. Keep.
- **Global `modelClient.post` / `confirm.ask` monkeypatch.** Pre-existing.
  `npm test` runs files in parallel workers; patches are per-worker.
  Same-file tests are sequential by default. Do not "fix" with a mutex
  unless a real cross-test race shows up.
- **`mkdtempSync` dirs never removed.** Pre-existing. More cases leave
  more `/tmp/golden-eval-*` dirs. Not a reason to block this slice.
- **`installScriptedModel` repeating the last script entry.** Pre-existing.
  Checklist cases that care about "this call never happens" already pin
  `tool_not_called` / `stop_reason`.
- **File grew 344 → 664, still under 1k.** `CHECKLIST_PREDICATES` as a
  dispatch map is the right shape, not spaghetti bolted onto `run()`.
  Do not extract `golden-checklist.js` in the same fix as Medium #1
  unless the file is growing again.
- **No feature-flag leak, no new env vars, no credential/proxy/server
  edits, no `--agent` / `--profile` restoration, no shell enabled by
  `--dont-ask`.** Bridge transport untouched.

## Recommended fix order

Stay in `src/runner/golden-eval.js` + `test/runner/golden-eval.test.js`.
Do not retouch the seven HE-06 JSON cases unless a finding forces a
fixture fix (Low #4 is optional). Do not edit `run.js`, credentials,
proxy, or the permission gate.

1. **Medium #1** — On `--update`, still run `evaluateChecklist` for any
   case that has a non-empty `checklist`. Checklist-only: do not write
   `expect`; if fraction !== 1, `ok: false` (same messages as the normal
   path). Dual-mode: may still refresh `expect`, but do not `continue`
   before the checklist score; a failing checklist must fail the case
   even when the snapshot was rewritten. Tests:
   - checklist-only case whose predicate is wrong + `{ update: true }` →
     `summary.ok === false` and the JSON file is unchanged;
   - dual-mode fixture with a stale `expect` **and** a failing checklist
     + `{ update: true }` → `expect` may update, case still `ok: false`.

2. **Low #3** (same function, cheap) — Treat empty `checklist: []` like
   missing: require `expect` or `checklist.length > 0`. Test: a temp dir
   with `{ id, prompt, model_script, checklist: [] }` fails
   `runGoldenEval` with the existing missing-expect message (or a
   clearer sibling).

3. **Low #2** (optional, same module) — After resolving the path, refuse
   to follow a symlink whose **realpath** is outside `cwd` (or refuse
   `file_content` / `file_exists` on symlinks entirely and keep
   `cwd_symlinks` as fixture-only). Add a unit test: plant
   `cwd_symlinks: { escape: '/etc/hosts' }` (or a temp file outside
   `cwd`) and assert `file_content` / `file_exists` fail with the
   escapes-cwd detail. Do **not** copy `resolveFileTarget` into the eval
   harness; a realpath prefix check is enough.

4. **Low #4** (optional) — In `he06-offered-tools-quarantine.json`, either
   drop the `file_content` predicate (it does not prove the pin) or change
   the scripted input to a well-formed `path` + `patch_text` that **would**
   mutate `notes.txt` if execute ran, so the disk check becomes live.
   Keep `includes: "not offered"`.

## Pointers for the implementing agent

- Preflight: playground folder
  `/Users/alanman/Developer/claude-local-bridge-playground`, branch
  `main`, `origin` = `alankatanoisi/claude-local-bridge-playground`.
  Pull `--ff-only` if the tree is clean. Do not start from the canonical
  repo. Unrelated dirty files in this review session
  (`.cursor/settings.json`, untracked PDFs) are not part of the slice —
  do not stage them.
- `evaluateChecklist` is already exported. Drive `--update` tests through
  `runGoldenEval({ dir: tmp, update: true })` against a copied sabotaged
  JSON, same pattern as `golden-eval.test.js` 211–220.
- Dual-mode `--update` currently lives entirely in the `if (update)`
  block (580–593). The cleanest fix is: always score a non-empty
  checklist; only the `expect = actual` write is update-specific;
  `continue` only after both sides have been applied.
- `denyNotOffered` does not set `permission`. Do not "strengthen" HE-06
  cases by switching `tool_errored` to `tool_denied` for shell / allowlist
  / offered-set — those refusals never have `permission.decision`.
- Targeted tests:
  `node --require ./test/setup.js --test test/runner/golden-eval.test.js`
  Then `npm test` / `npm run lint` before handoff.
- Thread entry after a fix: banner
  `docs/programmatic-tooling-research-review-2026-08-31.html` again and
  close the findings in **this** file (same pattern as
  `HANDOFF-acp-ask-user-question-thermo-nuclear-2026-08-31.md`).
- Commit/push only if Alan asks.

## Suggested commit shape (if asked)

One commit is enough:
`fix(runner): score golden checklists on --update; reject empty checklist`.
