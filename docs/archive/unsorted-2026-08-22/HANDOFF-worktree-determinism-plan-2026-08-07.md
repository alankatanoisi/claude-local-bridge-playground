# HANDOFF — Worktree Determinism Slice (build plan)

**Date:** 2026-08-07. **Branch:** `fix/worktree-determinism` (create from `main` at `fd18b17` or later).
**Status when written:** plan only — if a `[x]` checklist below is unmarked, that step was NOT done.
**Audience:** any agent picking this up cold. Read CLAUDE.md first (Startup Preflight, Safety Rules).
**Rule inherited from today's incidents:** work on the branch, run every check, report real output,
do NOT push or merge to `main` — Alan reviews first.

## Why (context an agent needs)

Forensics on 2026-08-07 (see `docs/false-green-test-audit-2026-08-07.html` §9 and the session
memory `shared-checkout-multi-agent-hazard`) established:

1. Prompt-level "enter a worktree first" is advisory. Both bake-off runners called `enter_worktree`,
   then used `bash` with absolute paths to edit/branch-switch the ORIGINAL checkout anyway
   (`bash` is unsandboxed local-account authority by doctrine — see `SHELL_AUTHORITY_HONESTY`
   in `src/runner/shell-policy.js`).
2. An agent's silent `git checkout -b` in the main checkout at 12:16 PDT redirected Alan's own
   manual commit onto an unexpected branch.
3. Alan's GitHub Desktop commit-all then swept three authors' uncommitted work into one commit.

Three defenses, all deterministic (harness-enforced, never model-discretion):

- **D1 — `--worktree` startup flag:** the runner ENTERS a fresh worktree before step 1. The model
  never chooses. Alan's command builder gets a checkbox that emits this flag.
- **D2 — git consent gate:** `git commit/push/checkout/switch/merge` via the bash tool always ASK,
  in every permission mode (not bypassable by `--dont-ask`), mirroring the P0-07
  destructive-worktree-cleanup precedent in `src/runner/permissions.js`.
- **D3 — shell root-confinement (best-effort, honestly labeled):** while a worktree is active,
  bash commands that reference the original checkout's path are hard-denied. This closes the
  OBSERVED escape (absolute-path reference back into the original root). It is NOT a sandbox;
  docs must keep saying so.

## Design decisions already made (do not relitigate)

- D1 reuses the existing tool machinery: call `require('./tools/enter-worktree').execute({}, ctx)`
  from `run()` setup. `activateSlot` (in `worktree-utils.js`) already repoints `ctx.cwd`/`cwdRealpath`
  and bumps `rootEpoch` (P0-10), so caches behave. Do NOT reimplement worktree creation.
- D1 failure is FATAL: if `--worktree` is passed and the cwd is not a git repo (or `git worktree add`
  fails), the run must exit non-zero BEFORE any model call. Operator asked for isolation; silently
  continuing unisolated is a false green.
- D1 implies the `worktrees` capability group (so `exit_worktree`/`list_worktrees` work), WITHOUT
  requiring the user to also pass `--capabilities worktrees`.
- D2 severity: decision `ask` with a purpose-built description (like `describeDestructiveWorktreeCleanup`),
  placed AFTER the `shell_disabled` and `allowedTools` checks in `_checkUncached` (so no-shell runs
  still hard-deny) and BEFORE the MODES table lookup (so `dontAsk` cannot allow it). In plan mode the
  existing `plan_only` path already covers it (verify: plan+shell yields plan-only ask — keep that).
- D2 verb list (word-boundary regex, first git subcommand token): `commit`, `push`, `checkout`,
  `switch`, `merge`. Deliberately NOT `status/log/diff/show/branch(list)/stash list` — read-only git
  stays frictionless. `git pull` is already network-flagged under `--no-network`; leave it out of D2
  for now (documented residual).
- D3 mechanism: extend `scanShellCommand(command, ctx)` in `shell-policy.js`. When
  `ctx.worktreeRepoRoot` exists AND `ctx.activeWorktreeSlot` is set, any occurrence of the original
  root path string (`ctx.worktreeRepoRoot.repoRoot` and `.cwdRealpath`, compare BOTH raw and
  realpath'd forms) inside the command → issue `{ kind: 'worktree_escape_path' }` → hard deny in
  permissions (same branch that handles `hard_deny_path`).
- D2/D3 live in the GATE (permissions/shell-policy), not in the bash tool's execute — single
  chokepoint, consistent with the repo's "gate is authority" doctrine.

## File-by-file plan

### 1. `bin/local-bridge-runner.js`

- Add to `parseArgs` options: `worktree: { type: 'boolean' }`.
- Help text: under the capabilities line add
  `--worktree            Start the run inside a fresh git worktree (deterministic isolation; implies capabilities worktrees)`.
- Pass through to `run()` options as `enterWorktreeAtStart: !!args.values.worktree`.
- If `--worktree` set, ensure the capabilities set handed to run() includes `'worktrees'`
  (find where `capabilities` string is parsed/forwarded; append before normalize).

### 2. `src/runner/run.js`

- Find the setup sequence AFTER `validateCwd` + trust gate + authority ceiling creation and BEFORE
  the system prompt / first model request (grep anchors: `validateCwd`, `evaluateWorkspaceTrust`,
  `createAuthorityCeiling`).
- If `options.enterWorktreeAtStart`:
  ```js
  const enterWorktree = require('./tools/enter-worktree');
  const res = enterWorktree.execute({ description: 'started via --worktree' }, ctx);
  if (!res.ok) {  // fail closed — operator asked for isolation
    throw new Error('--worktree failed: ' + res.text);  // match run()'s existing fatal-error style
  }
  log stderr line: '[runner] --worktree: ' + first line of res.text (include branch + path);
  ```
  IMPORTANT: emit that stderr line at every log level ≥ normal — the CLI contract test greps for
  `--worktree:` to prove entry happened before transport.
- Note: `ctx.worktreeRepoRoot` is set by the tool via `saveRepoRoot` — D3 keys off it.

### 3. `src/runner/shell-policy.js`

- Add `GIT_STATE_VERBS = ['commit','push','checkout','switch','merge']` and
  `detectGitStateChange(cmd)` → returns the first matched verb or null. Regex shape:
  `/\bgit\s+(?:-[^\s]+\s+)*(commit|push|checkout|switch|merge)\b/` (tolerate `git -C x commit`).
- In `scanShellCommand`: push `{ kind: 'git_state_change', verb }` when detected (always, ctx-independent).
- Add worktree-escape check as designed above: `{ kind: 'worktree_escape_path', token: <matched root> }`.
  Guard: only when `ctx.activeWorktreeSlot && ctx.worktreeRepoRoot`. Compare against
  `repoRoot`, `cwd`, and `cwdRealpath` fields of `ctx.worktreeRepoRoot` (dedupe, skip empties).
- Export the new helpers for tests.

### 4. `src/runner/permissions.js`

- In `_checkUncached`, the existing bash scan loop: add `worktree_escape_path` to the hard-deny
  branch (same shape as `hard_deny_path`; ruleId `worktree_confinement`, severity `hard_deny`,
  explanation says the run is confined to its worktree and names the blocked root).
- After the `shell_disabled` and `allowedTools` checks (i.e., shell is genuinely enabled and exposed),
  BEFORE `MODES` lookup: if tool is bash and the scan found `git_state_change`, return
  `enrichDecision({ decision: 'ask', proposedAction: describeGitStateChange(verb, args) }, { ruleId:
'git_consent', severity: 'bypassable_ask', explanation: 'git commit/push/checkout/switch/merge always
ask — automation flags never imply repo-history consent (2026-08-07 incident).' })`.
  In plan mode, prefix `(plan mode) ` like the destructive-cleanup path does.
  NOTE: scan currently runs only inside `if (toolName === 'bash' && args && args.command)` near the
  top — capture its result in a variable there instead of re-scanning.
- `describeGitStateChange`: show the verb + first ~100 chars of the command + one honesty line.

### 5. Tests — `test/runner/worktree-determinism.test.js` (new)

Follow the FG house style (real modules, no mocks of code under test).

- WD-1: `permissions.check('bash', {command:'git push origin main'}, ctx{allowShell,dontAsk,acceptEdits,chaosOk-not-needed-at-lib-level})`
  → decision `ask`, ruleId `git_consent`. Same for `git commit -m x`, `git checkout -b y`,
  `git -C /tmp switch main`, `git merge foo`.
- WD-2: read-only git stays allowed under dontAsk: `git status`, `git log --oneline`, `git diff`.
- WD-3: non-git commands unaffected: `echo hi` → allow under allowShell+dontAsk.
- WD-4: escape hard-deny: build ctx with `activeWorktreeSlot:'default'`,
  `worktreeRepoRoot:{repoRoot:'/tmp/wd-orig', cwd:'/tmp/wd-orig', cwdRealpath:'/tmp/wd-orig'}`,
  cwd pointed at a real tmp dir; `bash {command:'cat /tmp/wd-orig/x.txt'}` → deny, severity hard_deny,
  isHardDeny true. Without an active slot the same command is NOT escape-denied.
- WD-5: git consent survives every mode combo (sweep like FG-B7): default/acceptEdits/dontAsk/both →
  all `ask` for `git push`.
- WD-6 (real CLI, FG-E style spawnSync harness — copy `runCli` from false-green-cli-contract.test.js):
  - In a tmp dir: `git init`, one commit (`git -C dir init` etc. via execFileSync in the test).
  - Spawn runner with `--worktree --trust-workspace 'hello'` + dead bridge URL env + isolated HOME.
  - Assert exit non-zero (dead bridge), combined output matches `/--worktree:/` AND
    `/bridge|connect|ECONNREFUSED|network/i` (entered worktree BEFORE transport), and does NOT match
    `/not a git repo/i`.
  - Assert a worktree dir now exists under `<tmpHOME>/.bridge-runner/worktrees/` (HOME is isolated,
    so `worktreeRoot()` lands there — verify with fs.readdirSync, length ≥ 1).
  - Second spawn in a NON-git tmp dir with `--worktree` → exit non-zero, output matches
    `/worktree failed|not a git repo/i`, and NO transport error string (fail-closed ordering).
- WD-7: register the new invariants in the mutation harness `scripts/mutation-check.js`: add a
  mutation that removes `'push'` from GIT_STATE_VERBS with `expectRedIn:
'test/runner/worktree-determinism.test.js'` (keep the FG-G9 anchor rules in mind: anchor string
  must match source byte-for-byte, exactly once, no comment between `file:` and `find:`).
  Update `test/runner/false-green-suite-integrity.test.js` KNOWN_TODOS ONLY if you add todo tests
  (you should not need any).

### 6. Docs (required by CLAUDE.md when CLI/safety behavior changes)

- `README.md`: add `--worktree` to the flag list; one sentence on the git consent gate.
- `docs/runner-quickstart.html`: same, brief.
- `docs/command-builder.html`: add a "Start in worktree" checkbox emitting `--worktree` (grey-out /
  no-reset rules per Learned Preferences). Check `test/runner/command-builder-drift.test.js` and
  `command-builder-behavior.test.js` FIRST to learn the builder's contract — they may require the
  flag in specific structures. Also `scripts/check-doc-defaults.js` / `check-runner-manifest.js`
  (`npm run check:docs`) may assert flag lists; run and satisfy them.
- `docs/threat-model.md`: new subsection "Worktree confinement (2026-08-07)": D1/D2/D3, with the
  honesty caveat: D3 blocks path-string references to the original root; it is not OS isolation;
  relative-path tricks or novel absolute paths outside both roots remain shell-authority territory.

### 7. Checks (run all; report real output)

```bash
node --require ./test/setup.js --test test/runner/worktree-determinism.test.js
node --require ./test/setup.js --test test/runner/false-green-*.test.js
npm test
npm run lint
npm run format:check   # run `npm run format` on the touched files if needed, then re-check
npm run check:docs
node scripts/mutation-check.js M8-git-consent   # or whatever id you gave the new mutation
```

Expected: full suite `fail 0`, `todo 2` (HS-01/HS-02 — pre-existing, not yours).

### 8. Commit + handoff

- Commit on `fix/worktree-determinism` only. Message:
  `Add deterministic worktree isolation: --worktree startup flag, git consent gate, shell root-confinement`.
- Do NOT push, do NOT merge, do NOT touch main. End with the standard handoff block
  (folder, branch, files, checks with real results, skipped, risks).

## Known risks / gotchas for the implementer

- `run.js` is large; the insertion point matters. Entry must be AFTER the trust gate (a worktree of
  an untrusted repo must not bypass trust; the trust fingerprint is of the ORIGINAL cwd) and AFTER
  `createAuthorityCeiling` (ceiling reflects operator flags, not the moved root), but BEFORE the
  session store snapshots cwd into metadata and before the first model request.
- `enter_worktree.execute` uses `ctx.cwdRealpath || ctx.cwd || process.cwd()` — make sure ctx has
  cwdRealpath set (validateCwd result) before calling.
- FG-E7-style CLI tests isolate HOME; `worktreeRoot()` follows HOME — good for cleanup, but means
  `git worktree add` runs with the repo in /tmp: fine.
- git in worktree tests needs `user.email`/`user.name` config for the initial commit — set with
  `git -C dir -c user.email=t@t -c user.name=t commit ...`.
- The FG-C10 sink inventory and FG-D1 registration tests will NOT fire for this slice (no new sinks,
  no new tools) — but FG-G4's file-count floor (118) is fine with one added test file.
- `git_state_change` detection must not fire on `git push` appearing inside a quoted string arg of
  a non-git command… accepted over-trigger; asking too often is safe, silently allowing is not.
- Do not modify `docs/false-green-test-audit-2026-08-07.html` (immutable dated record).

## Checklist (mark as you go — unmarked = not done)

- [ ] Branch created from current main
- [ ] bin CLI flag + help
- [ ] run.js startup entry (fail-closed) + stderr marker line
- [ ] shell-policy: git verbs + escape scan + exports
- [ ] permissions: hard-deny branch + git consent ask + description helper
- [ ] worktree-determinism.test.js (WD-1..WD-6)
- [ ] mutation-check.js new mutation (WD-7)
- [ ] README / quickstart / command-builder / threat-model
- [ ] All checks green (paste real summaries)
- [ ] Committed on branch; NOT pushed; handoff written
