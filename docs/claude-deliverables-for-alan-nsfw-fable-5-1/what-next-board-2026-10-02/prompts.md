# What-Next Board prompts (2026-10-02)

Thirty paste-ready prompts: ten for Codex, ten for Fable, ten for Claude Opus 5.5. Each block is complete on its own; copy one block into the app named in its heading and send it. The browser version with copy buttons and status tracking is `index.html` in this folder.

Before anything else, Alan: merge pull request #30 and close pull request #21 in GitHub, then in Terminal from the playground folder run `git pull --ff-only origin main`.

## Codex

Paste into: Codex app (ChatGPT desktop). Executes written briefs to the letter, exhaustive test matrices, mechanical sweeps. Always on its own branch and pull request.

### C1. Golden-eval scoring fixes (GE-M1, GE-L2, GE-L3, GE-L4)

- Why: Best-specified open item in the repo. `runner eval --update` currently reports checklist-only cases as passed without scoring them, which is a false green.
- Files: src/runner/golden-eval.js, test/runner/golden-eval.test.js, test/runner/golden/he06-offered-tools-quarantine.json
- Depends on: Nothing.
- Lane: Codex branch. Disjoint from C2 and C3.
- Wave: 1

```text
Work only in /Users/alanman/Developer/claude-local-bridge-playground. Read AGENTS.md, docs/working-with-alan.md, and docs/agent-user-autonomy-boundary-2026-08-11.md first. Run the AGENTS.md startup preflight, then `git pull --ff-only origin main`, and confirm the tree is clean; if it is dirty, stop and ask me. Create branch `codex/<slug>-2026-10-02` in a fresh git worktree and do all work there.

Hard constraints: never edit src/credentials.js, src/proxy.js, src/server.js, src/interceptors/**, or any *.plist. Never restore --agent, --profile, --list-agents, or --list-profiles. Never quote text from ~/.bridge-runner or any run ledger; aggregates only. No live model calls. No policy or Terms-of-Service commentary. Never kill processes by pattern; port 3773 is my live T3 app.

Before handoff run `npm test`, `npm run lint`, `npm run check:docs`, and `npm run format:check`, and record the baseline you inherited (format:check is already red on three root HANDOFF-*thermo-nuclear*.md files; leave them alone). Fix causes, never gates. Commit in conventional-commit shape, one commit per part, push only your branch, and open a pull request against main with the raw check output in the body. Write HANDOFF-<slug>-2026-10-02.md at the repo root with: folder, branch, files changed, checks run, checks skipped, risks and next steps. Do not merge. If anything is ambiguous, ask me instead of guessing.

Slug: golden-eval-fixes.

Source of truth: HANDOFF-golden-eval-he06-thermo-nuclear-2026-09-06.md (all four findings are still open; I checked on 2026-10-02).

Part 1 (GE-M1): in src/runner/golden-eval.js around lines 579-593, make `--update` always score a non-empty `checklist`, including dual-mode cases that carry both `expect` and `checklist`. Add the two tests the handoff specifies.

Part 2 (GE-L3): reject a case whose `checklist` is `[]` and that has no `expect`, with a clear error naming the case file. Test it.

Part 3 (GE-L2): the file predicates (around lines 352-359 and 80-84) check paths lexically and follow cwd symlinks outside the sandbox. Realpath the target and refuse anything resolving outside the sandbox root. Add a symlink test that would have passed before and fails now.

Part 4 (GE-L4): the disk predicate in test/runner/golden/he06-offered-tools-quarantine.json can never fail. Either make the input well-formed so the predicate is meaningful or drop the predicate; say which you chose and why in the commit message.

Acceptance: `npm run runner:eval` still reports 9 of 9 cases passing, and the new tests fail if you revert each part.
```

### C2. Context-layer Lows and the tail-notes helper (CL-L4, CL-L5, CL-L6, CI-CAP32, CL-CQ1)

- Why: Five small, fully specified fixes left from the 09-06 context-layer review. The CQ1 helper unblocks Fable card F5 (idea 12 counters).
- Files: src/runner/run.js (one function near line 761), src/runner/context-headlines.js, src/runner/context-projection.js, src/runner/tools/\_history-index.js, and their tests
- Depends on: Nothing.
- Lane: Codex branch. Disjoint from C1 and C3.
- Wave: 1

```text
Work only in /Users/alanman/Developer/claude-local-bridge-playground. Read AGENTS.md, docs/working-with-alan.md, and docs/agent-user-autonomy-boundary-2026-08-11.md first. Run the AGENTS.md startup preflight, then `git pull --ff-only origin main`, and confirm the tree is clean; if it is dirty, stop and ask me. Create branch `codex/<slug>-2026-10-02` in a fresh git worktree and do all work there.

Hard constraints: never edit src/credentials.js, src/proxy.js, src/server.js, src/interceptors/**, or any *.plist. Never restore --agent, --profile, --list-agents, or --list-profiles. Never quote text from ~/.bridge-runner or any run ledger; aggregates only. No live model calls. No policy or Terms-of-Service commentary. Never kill processes by pattern; port 3773 is my live T3 app.

Before handoff run `npm test`, `npm run lint`, `npm run check:docs`, and `npm run format:check`, and record the baseline you inherited (format:check is already red on three root HANDOFF-*thermo-nuclear*.md files; leave them alone). Fix causes, never gates. Commit in conventional-commit shape, one commit per part, push only your branch, and open a pull request against main with the raw check output in the body. Write HANDOFF-<slug>-2026-10-02.md at the repo root with: folder, branch, files changed, checks run, checks skipped, risks and next steps. Do not merge. If anything is ambiguous, ask me instead of guessing.

Slug: context-layer-lows.

Source of truth: HANDOFF-context-layer-thermo-nuclear-2026-09-06.md, sections Low #4-#6 and Code quality #1. Read HANDOFF-context-layer-mediums-closed-2026-09-10.md too so you do not redo what is already closed (Mediums #1-#3, Lows #7-#8).

Part 1 (Low #4): `getCanonicalMessages` in src/runner/run.js returns the live array. Return a shallow copy (do not freeze the message objects). Test that pushing onto the returned array does not change the session.

Part 2 (Low #5): in src/runner/context-headlines.js (around line 169) the phrase "no longer shown verbatim" overclaims for exchanges that are only stubbed or stale-dropped. Reword for stubs; keep the wording for checkpointed spans. Update the tests.

Part 3 (Low #6): `rangeLabel` (around lines 148-150 and 200) prints ranges like `m0–m2`, which `expand_history` cannot consume. Print real recover targets (`m2`, `tu0`). Do not change the use/result id alias.

Part 4 (CI-CAP32): the comment at src/runner/tools/_history-index.js:17 claims a 32 MB cap that is only a diagnostic flag. Correct the comment to describe what the code does.

Part 5 (CQ1): replace the two `appendAnchor` calls in src/runner/context-projection.js (around lines 251, 373, 389) with one `appendTailNotes(projected, [anchor, index, ...])` helper that appends every tail note in one place. The existing tests are the guard; no behavior change.

Run test/runner/context-*.test.js and test/runner/command-builder-*.test.js before the full suite.
```

### C3. Ledger and resume residuals (A1-F5, C3-2, A1-F4)

- Why: Three durability leftovers from round 3. One is a one-line health-record bug that makes a failed resume look healthy.
- Files: src/runner/session-health.js, src/runner/session-ledger.js, src/runner/replay-simulator.js, src/runner/ledger-repair.js, tests
- Depends on: Nothing.
- Lane: Codex branch. Disjoint from C1 and C2.
- Wave: 1

```text
Work only in /Users/alanman/Developer/claude-local-bridge-playground. Read AGENTS.md, docs/working-with-alan.md, and docs/agent-user-autonomy-boundary-2026-08-11.md first. Run the AGENTS.md startup preflight, then `git pull --ff-only origin main`, and confirm the tree is clean; if it is dirty, stop and ask me. Create branch `codex/<slug>-2026-10-02` in a fresh git worktree and do all work there.

Hard constraints: never edit src/credentials.js, src/proxy.js, src/server.js, src/interceptors/**, or any *.plist. Never restore --agent, --profile, --list-agents, or --list-profiles. Never quote text from ~/.bridge-runner or any run ledger; aggregates only. No live model calls. No policy or Terms-of-Service commentary. Never kill processes by pattern; port 3773 is my live T3 app.

Before handoff run `npm test`, `npm run lint`, `npm run check:docs`, and `npm run format:check`, and record the baseline you inherited (format:check is already red on three root HANDOFF-*thermo-nuclear*.md files; leave them alone). Fix causes, never gates. Commit in conventional-commit shape, one commit per part, push only your branch, and open a pull request against main with the raw check output in the body. Write HANDOFF-<slug>-2026-10-02.md at the repo root with: folder, branch, files changed, checks run, checks skipped, risks and next steps. Do not merge. If anything is ambiguous, ask me instead of guessing.

Slug: ledger-residuals.

Sources: HANDOFF-f6-ledger-aware-resume-2026-07-31.md lines 61-68, docs/ledger-forensics-sweep-2026-07-31.md, HANDOFF-round3-results-2026-07-31.md.

Part 1 (A1-F5): a failed resume currently writes a `resume_ok` health record. Add `MESSAGE_CONTRACT_ERROR` to the degraded set in src/runner/session-health.js (lines 9-15) and add a test that a resume failing with that error is recorded as degraded.

Part 2 (C3-2): the load path in src/runner/session-ledger.js (around line 134) opens a pending intent for any `*_intent` event even when it has no `effectId`, while `append()` refuses such events. Make load match append. Test both directions: append rejects, load ignores or rejects consistently.

Part 3 (A1-F4): src/runner/replay-simulator.js lines 28-40 detect `orphaned_tool_use` using ledger vocabulary the runner never emits, so the branch is dead. Grep src/runner/session-ledger.js for the event names the runner actually writes. Either map the detector onto that real vocabulary or remove the dead branch, and update src/runner/ledger-repair.js:171 to match. Add a test that exercises the real vocabulary.

Build fixtures in temp directories. Do not open any real ledger under ~/.bridge-runner.
```

### C4. Repo hygiene scripts: check:agent-docs and one-command check (PROC-MIRROR, HE-07)

- Why: CLAUDE.md has recommended an automatic mirror check for the two Learned blocks since 2026-07-25 and nobody built it. HE-07 asks for a single `npm run check`.
- Files: new scripts/check-agent-docs.js, package.json scripts, README.md checks section, one sentence each in AGENTS.md and CLAUDE.md, a test under test/
- Depends on: Nothing.
- Lane: Codex branch.
- Wave: 2

```text
Work only in /Users/alanman/Developer/claude-local-bridge-playground. Read AGENTS.md, docs/working-with-alan.md, and docs/agent-user-autonomy-boundary-2026-08-11.md first. Run the AGENTS.md startup preflight, then `git pull --ff-only origin main`, and confirm the tree is clean; if it is dirty, stop and ask me. Create branch `codex/<slug>-2026-10-02` in a fresh git worktree and do all work there.

Hard constraints: never edit src/credentials.js, src/proxy.js, src/server.js, src/interceptors/**, or any *.plist. Never restore --agent, --profile, --list-agents, or --list-profiles. Never quote text from ~/.bridge-runner or any run ledger; aggregates only. No live model calls. No policy or Terms-of-Service commentary. Never kill processes by pattern; port 3773 is my live T3 app.

Before handoff run `npm test`, `npm run lint`, `npm run check:docs`, and `npm run format:check`, and record the baseline you inherited (format:check is already red on three root HANDOFF-*thermo-nuclear*.md files; leave them alone). Fix causes, never gates. Commit in conventional-commit shape, one commit per part, push only your branch, and open a pull request against main with the raw check output in the body. Write HANDOFF-<slug>-2026-10-02.md at the repo root with: folder, branch, files changed, checks run, checks skipped, risks and next steps. Do not merge. If anything is ambiguous, ask me instead of guessing.

Slug: hygiene-scripts.

Part 1: write scripts/check-agent-docs.js. It reads CLAUDE.md and AGENTS.md, extracts the bullet lists under the headings "Learned User Preferences" and "Learned Workspace Facts" (ignore the blockquote note under the first heading), normalizes whitespace, and exits 1 with a unified diff when the two files differ. Add `"check:agent-docs": "node scripts/check-agent-docs.js"` to package.json. Add a test under test/ that copies both files into a temp dir, mutates one bullet, and asserts the script exits 1, then asserts exit 0 on the untouched pair.

Part 2 (HE-07): add `"check": "npm test && npm run lint && npm run check:docs && npm run check:agent-docs && npm run format:check"` to package.json and document it in README.md under the checks section, with one sentence on what each sub-check proves. Do not fix the three Prettier-red handoffs.

Part 3: add one identical sentence to the Learned-blocks note in both CLAUDE.md and AGENTS.md saying the mirror check now exists and how to run it. Touch nothing else in those files.

Run `npm run check:agent-docs` and paste its output in the pull request body.
```

### C5. CLI parsing defects and --help completeness (P2-16, stale help)

- Why: Stray positionals become the prompt, negative numbers are accepted, and --help omits --replay/--repair and lists 3 of 6 templates.
- Files: bin/local-bridge-runner.js, test/runner/cli-_.test.js, src/runner/tool-registry.js (one comment), docs/command-builder_.html only if the drift tests demand it
- Depends on: Nothing.
- Lane: Codex branch.
- Wave: 2

```text
Work only in /Users/alanman/Developer/claude-local-bridge-playground. Read AGENTS.md, docs/working-with-alan.md, and docs/agent-user-autonomy-boundary-2026-08-11.md first. Run the AGENTS.md startup preflight, then `git pull --ff-only origin main`, and confirm the tree is clean; if it is dirty, stop and ask me. Create branch `codex/<slug>-2026-10-02` in a fresh git worktree and do all work there.

Hard constraints: never edit src/credentials.js, src/proxy.js, src/server.js, src/interceptors/**, or any *.plist. Never restore --agent, --profile, --list-agents, or --list-profiles. Never quote text from ~/.bridge-runner or any run ledger; aggregates only. No live model calls. No policy or Terms-of-Service commentary. Never kill processes by pattern; port 3773 is my live T3 app.

Before handoff run `npm test`, `npm run lint`, `npm run check:docs`, and `npm run format:check`, and record the baseline you inherited (format:check is already red on three root HANDOFF-*thermo-nuclear*.md files; leave them alone). Fix causes, never gates. Commit in conventional-commit shape, one commit per part, push only your branch, and open a pull request against main with the raw check output in the body. Write HANDOFF-<slug>-2026-10-02.md at the repo root with: folder, branch, files changed, checks run, checks skipped, risks and next steps. Do not merge. If anything is ambiguous, ask me instead of guessing.

Slug: cli-parsing-p2-16.

Spec: docs/runner-p2-next-session-handoff-2026-07-20.md, item P2-16.

Part 1: in bin/local-bridge-runner.js (argument parser around line 289) reject unknown positional arguments with a clear error instead of folding them into the prompt; reject negative or non-numeric values for every numeric flag; make the `canonicalTool=unknown` fallbacks explicit errors. Write a table-driven test that covers every numeric flag in the runner manifest (use scripts/check-runner-manifest.js or the manifest module it reads to enumerate them, so the test cannot drift).

Part 2: make `--help` list every live subcommand including `--replay` and `--repair`, and all six built-in prompt templates (cleanup, explore, grill, review, simplify, verify), generated from the prompt registry rather than typed by hand. Add a test that the help text contains every template name from the registry.

Part 3: fix the stale comment at src/runner/tool-registry.js:112 ("sliding-window scrubber") to describe the current central redaction boundary.

Run test/runner/command-builder-*.test.js and `npm run check:docs`. If the command-builder pages need a matching change, make it and say so in the handoff.
```

### C6. Test-coverage sweep for untested modules

- Why: Ten modules have no test that requires them directly. Exhausting a matrix of branches is exactly what Codex is for.
- Files: new tests only under test/runner/ and starlark-host/test/
- Depends on: Nothing.
- Lane: Codex branch. Tests only; a source edit is allowed only as a separate commit if a test exposes a real bug.
- Wave: 2

```text
Work only in /Users/alanman/Developer/claude-local-bridge-playground. Read AGENTS.md, docs/working-with-alan.md, and docs/agent-user-autonomy-boundary-2026-08-11.md first. Run the AGENTS.md startup preflight, then `git pull --ff-only origin main`, and confirm the tree is clean; if it is dirty, stop and ask me. Create branch `codex/<slug>-2026-10-02` in a fresh git worktree and do all work there.

Hard constraints: never edit src/credentials.js, src/proxy.js, src/server.js, src/interceptors/**, or any *.plist. Never restore --agent, --profile, --list-agents, or --list-profiles. Never quote text from ~/.bridge-runner or any run ledger; aggregates only. No live model calls. No policy or Terms-of-Service commentary. Never kill processes by pattern; port 3773 is my live T3 app.

Before handoff run `npm test`, `npm run lint`, `npm run check:docs`, and `npm run format:check`, and record the baseline you inherited (format:check is already red on three root HANDOFF-*thermo-nuclear*.md files; leave them alone). Fix causes, never gates. Commit in conventional-commit shape, one commit per part, push only your branch, and open a pull request against main with the raw check output in the body. Write HANDOFF-<slug>-2026-10-02.md at the repo root with: folder, branch, files changed, checks run, checks skipped, risks and next steps. Do not merge. If anything is ambiguous, ask me instead of guessing.

Slug: coverage-sweep.

Write focused unit tests (node:test, run with `node --require ./test/setup.js --test`) for these modules, which currently have no direct test:
- src/runner/background-shell.js
- src/runner/event-bus.js
- src/runner/archive/index.js
- src/runner/archive/session-rollup.js
- src/runner/tools/git-status.js
- src/runner/tools/list-worktrees.js
- src/runner/acp/ndjson.js
- src/runner/acp/connection.js
- starlark-host/src/documents.js
- starlark-host/src/run-abort.js

For each module: read it, list its exported functions and the branches inside them, and write one test per branch including error paths. Use temp directories for anything touching disk. Never spawn a real shell unless the module's purpose is spawning; then use `echo`. For git-based tools, build a throwaway git repo in a temp dir.

If a test reveals a real bug, do not fix it inline. Write the test to assert current behavior with a comment that names the suspected bug, keep the suite skip-free, and list the bug in the handoff under risks. Tests only; no source changes unless I say so.
```

### C7. Secret-scrub pattern expansion (SEC-02 / HE-08b(a))

- Why: `scrubSecrets` misses GitHub fine-grained tokens, OpenAI project keys, Slack tokens, and several PRIVATE KEY header variants, including when a PEM block is split across streamed chunks.
- Files: src/runner/safety.js (patterns around lines 197-210, streaming parser around line 502), a new or extended redaction test, docs/threat-model.md (one dated line)
- Depends on: Nothing. Safety boundary: needs an independent review (Opus card O5) before merge.
- Lane: Codex branch. Run before C8 (same file).
- Wave: 3

```text
Work only in /Users/alanman/Developer/claude-local-bridge-playground. Read AGENTS.md, docs/working-with-alan.md, and docs/agent-user-autonomy-boundary-2026-08-11.md first. Run the AGENTS.md startup preflight, then `git pull --ff-only origin main`, and confirm the tree is clean; if it is dirty, stop and ask me. Create branch `codex/<slug>-2026-10-02` in a fresh git worktree and do all work there.

Hard constraints: never edit src/credentials.js, src/proxy.js, src/server.js, src/interceptors/**, or any *.plist. Never restore --agent, --profile, --list-agents, or --list-profiles. Never quote text from ~/.bridge-runner or any run ledger; aggregates only. No live model calls. No policy or Terms-of-Service commentary. Never kill processes by pattern; port 3773 is my live T3 app.

Before handoff run `npm test`, `npm run lint`, `npm run check:docs`, and `npm run format:check`, and record the baseline you inherited (format:check is already red on three root HANDOFF-*thermo-nuclear*.md files; leave them alone). Fix causes, never gates. Commit in conventional-commit shape, one commit per part, push only your branch, and open a pull request against main with the raw check output in the body. Write HANDOFF-<slug>-2026-10-02.md at the repo root with: folder, branch, files changed, checks run, checks skipped, risks and next steps. Do not merge. If anything is ambiguous, ask me instead of guessing.

Slug: secret-scrub-sec-02.

Read SECURITY.md and docs/threat-model.md first; this is a safety-boundary change and will get an independent review before merge.

In src/runner/safety.js extend the secret patterns so `scrubSecrets` and the streaming scrubber cover:
- GitHub fine-grained tokens: `github_pat_`
- GitHub app and server tokens: `ghs_`, `ghu_`, `ghr_`
- OpenAI project keys: `sk-proj-`
- Slack tokens: `xoxb-`, `xoxp-`, `xoxa-`, `xoxr-`
- PEM blocks matching `-----BEGIN (ENCRYPTED |EC |RSA |OPENSSH |DSA )?PRIVATE KEY-----`, including when the header or body is split across streamed chunks (see the streaming parser near line 502).

Add a table-driven test with at least three positive and three negative examples per pattern, using obviously fake values (for example `github_pat_FAKE000...`). Add a chunk-split test for the PEM case that feeds the block in three pieces. Confirm test/runner/p0-11-redaction-boundary.test.js and the rest of the suite still pass.

Add one dated line to the pattern list in docs/threat-model.md. Do not change deny-list or path-confinement logic.
```

### C8. Rescue the code half of PR #26 (HS-01 case-variant key filenames)

- Why: PR #26 has a still-valid safety fix buried under doc rewrites that main has since superseded. SECURITY.md and the one `todo` left in the test suite still list HS-01 as open.
- Files: src/runner/safety.js (around lines 114-115), src/runner/shell-policy.js, test/runner/false-green-deny-matrix.test.js, scripts/mutation-check.js, one dated line each in SECURITY.md and docs/threat-model.md
- Depends on: C7 merged first (same file). Safety boundary: needs an O5-style review before merge.
- Lane: Codex branch.
- Wave: 3

```text
Work only in /Users/alanman/Developer/claude-local-bridge-playground. Read AGENTS.md, docs/working-with-alan.md, and docs/agent-user-autonomy-boundary-2026-08-11.md first. Run the AGENTS.md startup preflight, then `git pull --ff-only origin main`, and confirm the tree is clean; if it is dirty, stop and ask me. Create branch `codex/<slug>-2026-10-02` in a fresh git worktree and do all work there.

Hard constraints: never edit src/credentials.js, src/proxy.js, src/server.js, src/interceptors/**, or any *.plist. Never restore --agent, --profile, --list-agents, or --list-profiles. Never quote text from ~/.bridge-runner or any run ledger; aggregates only. No live model calls. No policy or Terms-of-Service commentary. Never kill processes by pattern; port 3773 is my live T3 app.

Before handoff run `npm test`, `npm run lint`, `npm run check:docs`, and `npm run format:check`, and record the baseline you inherited (format:check is already red on three root HANDOFF-*thermo-nuclear*.md files; leave them alone). Fix causes, never gates. Commit in conventional-commit shape, one commit per part, push only your branch, and open a pull request against main with the raw check output in the body. Write HANDOFF-<slug>-2026-10-02.md at the repo root with: folder, branch, files changed, checks run, checks skipped, risks and next steps. Do not merge. If anything is ambiguous, ask me instead of guessing.

Slug: hs01-rescue.

Pull request #26 (branch codex/hs01-charter-roadmap-refresh, single commit 2f1cc67, 2026-08-30) mixes a valid HS-01 fix with rewrites of AGENTS.md, CLAUDE.md, SECURITY.md, the charter, the template, and the roadmap that main has since superseded.

Cherry-pick only the code and test files from 2f1cc67 onto your new branch: src/runner/safety.js, src/runner/shell-policy.js, test/runner/false-green-deny-matrix.test.js, scripts/mutation-check.js. Resolve conflicts against current main (shell-policy.js has changed since the fork point 915ea89). Drop every documentation file from that commit.

Turn the suite's remaining `todo` into a passing test. Remove the `t.skip` at test/runner/false-green-deny-matrix.test.js:176 if the case-insensitive path is now reachable on this macOS filesystem; if it is not, explain why in the handoff.

Add one dated line to SECURITY.md and to docs/threat-model.md saying HS-01 is fixed by this pull request; do not rewrite surrounding text. In the pull request body state that #26 can be closed once this merges. Do not close #26 yourself.
```

### C9. Stage the unmerged Starlark resume branch for review

- Why: Branch codex/starlark-resume-2020-2026-09-26 is three commits ahead of main with Low #5-#8 done, but it has no pull request, so nobody can review or merge it.
- Files: starlark-host/\*\* only (the 14 files already on the branch), plus the handoff
- Depends on: Nothing.
- Lane: Codex, existing branch and worktree, rebased.
- Wave: 3

```text
Work only in /Users/alanman/Developer/claude-local-bridge-playground. Read AGENTS.md, docs/working-with-alan.md, and docs/agent-user-autonomy-boundary-2026-08-11.md first. Run the AGENTS.md startup preflight, then `git pull --ff-only origin main`, and confirm the tree is clean; if it is dirty, stop and ask me. Create branch `codex/<slug>-2026-10-02` in a fresh git worktree and do all work there.

Hard constraints: never edit src/credentials.js, src/proxy.js, src/server.js, src/interceptors/**, or any *.plist. Never restore --agent, --profile, --list-agents, or --list-profiles. Never quote text from ~/.bridge-runner or any run ledger; aggregates only. No live model calls. No policy or Terms-of-Service commentary. Never kill processes by pattern; port 3773 is my live T3 app.

Before handoff run `npm test`, `npm run lint`, `npm run check:docs`, and `npm run format:check`, and record the baseline you inherited (format:check is already red on three root HANDOFF-*thermo-nuclear*.md files; leave them alone). Fix causes, never gates. Commit in conventional-commit shape, one commit per part, push only your branch, and open a pull request against main with the raw check output in the body. Write HANDOFF-<slug>-2026-10-02.md at the repo root with: folder, branch, files changed, checks run, checks skipped, risks and next steps. Do not merge. If anything is ambiguous, ask me instead of guessing.

Slug: starlark-resume-pr.

Exception to the preamble: do not create a new branch. Use the existing worktree at /Users/alanman/Developer/claude-local-bridge-starlark-resume-2020-2026-09-26 on branch codex/starlark-resume-2020-2026-09-26.

Rebase the branch onto current origin/main. Resolve conflicts and keep the three commits (da42e7a, cb5f6d0, 2596b2c) separate. Build the evaluator with `npm --prefix starlark-host run build:evaluator` (Go 1.26 is on PATH via Homebrew) and run `npm run test:starlark` so the suite runs with zero skips. Run the suite three times in a row and report any flake with the failing test name; the 09-26 handoff saw 4-of-9 flaky runs under load and port reuse is the first suspect.

Open a pull request titled "starlark: close Low #5-#8 (resume, abort boundaries)". The body lists each Low with the file and commit that closes it and links HANDOFF-starlark-lows-review-2026-09-26.md and HANDOFF-starlark-laptop-transfer-2026-09-26.md (Low #8 = option 2, already chosen).

Mock mode only; `--mode live` is forbidden and no campaign ledger may be created. Write the handoff.
```

### C10. Coordinator verdict and claim filtering (APR-P1-3, APR-P1-4)

- Why: The coordinator always emits "completed" after the verify phase and lets failed workers’ claims feed the spec. Both are prerequisites for Fable card F8 (the audit rule).
- Files: src/runner/coordinator.js (around line 447), src/runner/coordinator-spec-compiler.js (around lines 32-33), tests
- Depends on: Nothing.
- Lane: Codex branch.
- Wave: 3

```text
Work only in /Users/alanman/Developer/claude-local-bridge-playground. Read AGENTS.md, docs/working-with-alan.md, and docs/agent-user-autonomy-boundary-2026-08-11.md first. Run the AGENTS.md startup preflight, then `git pull --ff-only origin main`, and confirm the tree is clean; if it is dirty, stop and ask me. Create branch `codex/<slug>-2026-10-02` in a fresh git worktree and do all work there.

Hard constraints: never edit src/credentials.js, src/proxy.js, src/server.js, src/interceptors/**, or any *.plist. Never restore --agent, --profile, --list-agents, or --list-profiles. Never quote text from ~/.bridge-runner or any run ledger; aggregates only. No live model calls. No policy or Terms-of-Service commentary. Never kill processes by pattern; port 3773 is my live T3 app.

Before handoff run `npm test`, `npm run lint`, `npm run check:docs`, and `npm run format:check`, and record the baseline you inherited (format:check is already red on three root HANDOFF-*thermo-nuclear*.md files; leave them alone). Fix causes, never gates. Commit in conventional-commit shape, one commit per part, push only your branch, and open a pull request against main with the raw check output in the body. Write HANDOFF-<slug>-2026-10-02.md at the repo root with: folder, branch, files changed, checks run, checks skipped, risks and next steps. Do not merge. If anything is ambiguous, ask me instead of guessing.

Slug: coordinator-verdict.

Sources: review items APR-P1-3 and APR-P1-4 as summarized in docs/claude-deliverables-for-alan-nsfw-fable-5-1/status-and-roadmap-update-checks/HANDOFF-fable-status-audit-2026-09-30.md, plus docs/ARCHITECTURE.md for the phase model.

Part 1 (APR-P1-3): in src/runner/coordinator.js replace the unconditional "completed" after the verify phase with a typed verdict, one of `completed`, `completed_with_findings`, `failed_verification`, derived from the verify worker's structured result. Emit the verdict in the ledger and in the final summary. Test all three outcomes with scripted workers.

Part 2 (APR-P1-4): in src/runner/coordinator-spec-compiler.js filter worker claims to accepted terminal states only, so a failed or aborted worker's claims never enter the compiled spec. Test with a fixture mixing accepted, failed, and aborted workers.

Keep `--chaos` behavior unchanged. Run test/runner/coordinator*.test.js first, then the full gates.
```

## Fable (Claude Code in T3 Code)

Paste into: T3 Code, model Fable 5.1. Explores, builds first slices, writes execution briefs, frames decisions. Holds the code baton while a card runs.

### F1. First slice of --verify-finish (programmatic-tooling idea 3)

- Why: The §6 sequence is complete and this is the recommended next slice: one structured model turn that asks whether the final answer is complete and consistent before the runner accepts it.
- Files: src/runner/run.js (finish path), new src/runner/verify-finish.js, bin/local-bridge-runner.js (flag), test/runner/verify-finish.test.js, command-builder pages, README, quickstart, manifest
- Depends on: Nothing.
- Lane: Fable, code baton.
- Wave: 1

```text
Fable, we are in /Users/alanman/Developer/claude-local-bridge-playground on main. Run the CLAUDE.md startup preflight first and pull; if the tree is dirty, stop and tell me who you think is mid-flight. You hold the code baton for this card: no other Claude thread is editing src/, bin/, or test/ while it runs. Stay out of src/credentials.js, src/proxy.js, src/server.js, and src/interceptors/**. No live model calls. Run the four checks before handoff and report their real output. Commit on local main; do not push unless I say so in the same turn.

Build the first slice of idea 3 from docs/programmatic-tooling-research-review-2026-08-31.html: an opt-in `--verify-finish` flag.

When the flag is set and the model returns a final text answer, make exactly one extra model turn with a fixed structured prompt (no tools offered) asking for `{complete: boolean, inconsistent: boolean, reason: string}`. If `complete && !inconsistent`, stop as normal. Otherwise inject one CONTINUE user turn containing the reason and let the loop run again, at most once per run, then accept whatever comes next. When the flag is off, nothing changes, including the default prompt.

Tests: deterministic scripted-model tests only, following the monkey-patch pattern in src/runner/golden-eval.js (replace modelClient.post / postStream). Cover: accepted first try, one continue then accepted, continue budget exhausted, flag off.

Docs: update docs/command-builder.html, docs/command-builder-v2.html, README.md, docs/runner-quickstart.html, and the runner manifest so `npm run check:docs` and test/runner/command-builder-*.test.js pass. Explain each design choice in beginner-friendly comments.

Commit on local main and write HANDOFF-verify-finish-2026-10-02.md at the repo root. Do not push.
```

### F2. Name and write the missing HE-06 golden cases (9 to 15)

- Why: The corpus target is about 15 cases, but no document names the missing six, so Codex cannot be briefed. Designing them is Fable work; writing most of them is Codex work.
- Files: test/runner/golden/\*.json (two new), a case-list note under docs/claude-deliverables-for-alan-nsfw-fable-5-1/, CODEX-TASK-he06-cases-2026-10-02.md
- Depends on: C1 merged, so new cases are scored honestly.
- Lane: Fable.
- Wave: 2

```text
Fable, we are in /Users/alanman/Developer/claude-local-bridge-playground on main. Run the CLAUDE.md startup preflight first and pull; if the tree is dirty, stop and tell me who you think is mid-flight. You hold the code baton for this card: no other Claude thread is editing src/, bin/, or test/ while it runs. Stay out of src/credentials.js, src/proxy.js, src/server.js, and src/interceptors/**. No live model calls. Run the four checks before handoff and report their real output. Commit on local main; do not push unless I say so in the same turn.

Read the HE-06 section of docs/harness-engineering-runner-runtime-review-2026-07-28.html and the nine cases in test/runner/golden/ (seven he06-*.json plus plan-mode-write-blocked.json and read-list-then-answer.json).

Propose six new terminal-state checklist cases covering failure classes the nine do not. Candidates: shell denied under `--dont-ask` without `--allow-shell`; write refused through a symlink; budget stop in the middle of a tool loop; resume after the SIGTERM finalizer; history group not offered, so no recover marker appears; plan-mode proposal accepted path. Replace any candidate that the existing nine already cover.

Write a one-page case list at docs/claude-deliverables-for-alan-nsfw-fable-5-1/he06-case-list-2026-10-02.md with, for each case, the scenario, the terminal-state predicate it asserts, and why the current nine miss it. Then implement the two you judge most valuable as golden JSON cases and run `npm run runner:eval` (expect 11 of 11). Leave the other four as a ready-to-paste Codex brief at CODEX-TASK-he06-cases-2026-10-02.md built from docs/templates/CODEX-TASK-template.md.

Commit, write HANDOFF-he06-cases-2026-10-02.md, no push.
```

### F3. Budget broker: cache tokens and dollar metering (A3-F4 / N-3)

- Why: The budget cap ignores cache tokens, so real spend can exceed the ceiling. Alan needs the telemetry-versus-safety classification argued before anyone edits it.
- Files: src/runner/budget-broker.js, src/runner/model-pricing.js, tests, docs/threat-model.md only if classified as a safety bug
- Depends on: Nothing.
- Lane: Fable, code baton.
- Wave: 3

```text
Fable, we are in /Users/alanman/Developer/claude-local-bridge-playground on main. Run the CLAUDE.md startup preflight first and pull; if the tree is dirty, stop and tell me who you think is mid-flight. You hold the code baton for this card: no other Claude thread is editing src/, bin/, or test/ while it runs. Stay out of src/credentials.js, src/proxy.js, src/server.js, and src/interceptors/**. No live model calls. Run the four checks before handoff and report their real output. Commit on local main; do not push unless I say so in the same turn.

Investigate A3-F4 (also called N-3): src/runner/budget-broker.js meters tokens without counting cache reads and cache writes, while src/runner/model-pricing.js already knows per-model prices for every token class.

First write a half-page classification for me in plain language: is this a telemetry inaccuracy or a safety-ceiling bug? Include one concrete worked example of a run that exceeds `--max-cost-usd` today, with the numbers. Put it at docs/claude-deliverables-for-alan-nsfw-fable-5-1/a3-f4-budget-classification-2026-10-02.md.

Then implement the fix you recommend behind no new flag: meter dollars using model-pricing.js including cache token classes, keep the existing token counters for display, and add tests showing the cap now trips where it used to leak. Update docs/threat-model.md only if you classified it as a safety bug.

Commit, write HANDOFF-budget-broker-2026-10-02.md, no push.
```

### F4. Decision memo: kernel direction (HE-03) and coordinator status (HE-09)

- Why: Both block other work and both are Alan’s call. Fable frames the options with pros and cons; nobody codes until Alan decides.
- Files: docs/claude-deliverables-for-alan-nsfw-fable-5-1/decision-memo-kernel-and-coordinator-2026-10-02.html only
- Depends on: Nothing.
- Lane: Fable, docs only. Can overlap any Codex card.
- Wave: 1

```text
Fable, we are in /Users/alanman/Developer/claude-local-bridge-playground on main. Run the CLAUDE.md startup preflight first and pull; if the tree is dirty, stop and tell me who you think is mid-flight. You hold the code baton for this card: no other Claude thread is editing src/, bin/, or test/ while it runs. Stay out of src/credentials.js, src/proxy.js, src/server.js, and src/interceptors/**. No live model calls. Run the four checks before handoff and report their real output. Commit on local main; do not push unless I say so in the same turn.

Write docs/claude-deliverables-for-alan-nsfw-fable-5-1/decision-memo-kernel-and-coordinator-2026-10-02.html for a non-programmer. No code changes.

Part 1 (HE-03): read src/runner/agent-kernel.js, src/runner/kernel/contract.js (around line 164), bin/local-bridge-runner.js, and the 07-28 review's claim that the kernel abstraction is inverted. Explain in plain words what a "kernel" is here and why the review says it is inside out. Show the Val-Q4 problem (options dropped on the coordinator path) with a two-line code trace. Give me three options: keep and document, invert properly, remove. For each: cost in rough hours, risk, and what it unblocks.

Part 2 (HE-09): promote the coordinator to a supported surface or mark it experimental. Same format: what it is, three options, cost, risk, unblocks.

End with your recommendation for each and the exact one-line decision I need to type back to you. Commit only that file, no push.
```

### F5. Idea 12 counters (after C2’s helper lands)

- Why: Three cheap observability counters the research review named: primitive versus model-visible tool counts, model calls per task, stated sub-goal per tool call.
- Files: src/runner/context-projection.js (uses appendTailNotes), src/runner/run.js summary, transcript writer, tests
- Depends on: C2 merged.
- Lane: Fable, code baton.
- Wave: 3

```text
Fable, we are in /Users/alanman/Developer/claude-local-bridge-playground on main. Run the CLAUDE.md startup preflight first and pull; if the tree is dirty, stop and tell me who you think is mid-flight. You hold the code baton for this card: no other Claude thread is editing src/, bin/, or test/ while it runs. Stay out of src/credentials.js, src/proxy.js, src/server.js, and src/interceptors/**. No live model calls. Run the four checks before handoff and report their real output. Commit on local main; do not push unless I say so in the same turn.

Implement idea 12 from docs/programmatic-tooling-research-review-2026-08-31.html now that `appendTailNotes` exists in src/runner/context-projection.js (landed by Codex card C2).

Counters: (a) primitive tool executions versus model-visible tool_use blocks, (b) model calls per task, (c) the model's stated sub-goal per tool call when a `goal` field or a first sentence is present. Surface all three in the end-of-run summary and the JSON output, passed through the central redaction boundary like everything else. No new flag.

Tests for each counter with scripted models, following the pattern in src/runner/golden-eval.js. Commit, write HANDOFF-idea12-counters-2026-10-02.md, no push.
```

### F6. Probe APR-P1-1: runner-made worktrees blocked by the deny list

- Why: Two safety features conflict: worktree-utils creates worktrees under ~/.bridge-runner and the deny matrix blocks that path. It needs a careful probe, not a blind deny-list edit.
- Files: read src/runner/worktree-utils.js and src/runner/safety.js; a probe test; a finding memo; code change only if the fix is confined
- Depends on: C7 and C8 merged (both edit safety.js).
- Lane: Fable.
- Wave: 3

```text
Fable, we are in /Users/alanman/Developer/claude-local-bridge-playground on main. Run the CLAUDE.md startup preflight first and pull; if the tree is dirty, stop and tell me who you think is mid-flight. You hold the code baton for this card: no other Claude thread is editing src/, bin/, or test/ while it runs. Stay out of src/credentials.js, src/proxy.js, src/server.js, and src/interceptors/**. No live model calls. Run the four checks before handoff and report their real output. Commit on local main; do not push unless I say so in the same turn.

Reproduce APR-P1-1 with a model-free test: create a runner worktree via src/runner/worktree-utils.js under a temporary HOME and show which gate in src/runner/safety.js denies a `read_file` inside it.

Write the finding at docs/claude-deliverables-for-alan-nsfw-fable-5-1/apr-p1-1-worktree-deny-probe-2026-10-02.md with the exact deny rule and three options: allow-list the runner's own worktree root, move worktrees outside ~/.bridge-runner, or document the block as intended. Pros and cons for each, in plain words.

If the first option is a confined, target-aware change to `resolveFileTarget`, implement it with tests and update docs/threat-model.md with a dated line. Otherwise stop at the memo and ask me. Commit, write HANDOFF-apr-p1-1-2026-10-02.md, no push.
```

### F7. Shell-filter canonicalization with a model-free harness (FD-11)

- Why: The shell policy uses substring matching. The backlog calls for canonicalizing the filter and testing it without a model. Fable builds the harness and first rules; Codex later exhausts the matrix.
- Files: src/runner/shell-policy.js, new test/runner/shell-policy-harness.test.js, CODEX-TASK-shell-policy-matrix-2026-10-02.md
- Depends on: C8 merged (touches shell-policy.js).
- Lane: Fable, code baton.
- Wave: 3

```text
Fable, we are in /Users/alanman/Developer/claude-local-bridge-playground on main. Run the CLAUDE.md startup preflight first and pull; if the tree is dirty, stop and tell me who you think is mid-flight. You hold the code baton for this card: no other Claude thread is editing src/, bin/, or test/ while it runs. Stay out of src/credentials.js, src/proxy.js, src/server.js, and src/interceptors/**. No live model calls. Run the four checks before handoff and report their real output. Commit on local main; do not push unless I say so in the same turn.

FD-11 from docs/HANDOFF-safari-future-directions-2026-07-22.md.

Build a model-free harness at test/runner/shell-policy-harness.test.js that feeds candidate shell commands through src/runner/shell-policy.js and asserts allow, ask, or deny. Then canonicalize the filter: tokenize with a small shell-word splitter, resolve the first word, and match on tokens rather than substrings, keeping every currently denied example denied (prove it by running the old denied list through the new filter).

Add 30 table-driven cases including quoting, `;`, `&&`, `|`, environment prefixes like `FOO=1 cmd`, and `$(...)`. Shell stays hidden unless `--allow-shell`; `--dont-ask` must still not enable it.

Write a Codex brief for the exhaustive matrix at CODEX-TASK-shell-policy-matrix-2026-10-02.md from docs/templates/CODEX-TASK-template.md. Commit, write HANDOFF-shell-policy-2026-10-02.md, no push.
```

### F8. First slice of the audit rule (idea 1) on top of C10’s typed verdict

- Why: The coordinator’s verify phase becomes a read-only auditor that never sees the worker transcript; any mutation voids the audit; claims never flip task state.
- Files: src/runner/coordinator.js, src/runner/coordinator-spec-compiler.js, tests, docs/ARCHITECTURE.md (dated section)
- Depends on: C10 merged.
- Lane: Fable, code baton.
- Wave: 3

```text
Fable, we are in /Users/alanman/Developer/claude-local-bridge-playground on main. Run the CLAUDE.md startup preflight first and pull; if the tree is dirty, stop and tell me who you think is mid-flight. You hold the code baton for this card: no other Claude thread is editing src/, bin/, or test/ while it runs. Stay out of src/credentials.js, src/proxy.js, src/server.js, and src/interceptors/**. No live model calls. Run the four checks before handoff and report their real output. Commit on local main; do not push unless I say so in the same turn.

Implement idea 1 from docs/programmatic-tooling-research-review-2026-08-31.html as a first slice, on top of the typed verdict Codex landed in card C10.

The coordinator's verify worker receives only the task spec, the diff, and the file tree, never the worker transcript. It runs with write and shell tools hidden. If it attempts any write or shell tool anyway, the verdict becomes `audit_voided`. Auditor claims are recorded but never change a task's state; only the typed verdict does.

Scripted-model tests for the three outcomes: clean audit, audit with findings, audit voided. Add a dated section to docs/ARCHITECTURE.md describing the auditor boundary. Commit, write HANDOFF-audit-rule-2026-10-02.md, no push.
```

### F9. Write the run.js extraction brief (HE-04); do not execute it

- Why: src/runner/run.js is about 1,978 lines. Extraction is risky and needs a careful, ordered brief before anyone touches it.
- Files: CODEX-TASK-run-js-extraction-2026-10-02.md only
- Depends on: C2 and F1 merged (both touch run.js).
- Lane: Fable, docs only.
- Wave: 3

```text
Fable, we are in /Users/alanman/Developer/claude-local-bridge-playground on main. Run the CLAUDE.md startup preflight first and pull; if the tree is dirty, stop and tell me who you think is mid-flight. You hold the code baton for this card: no other Claude thread is editing src/, bin/, or test/ while it runs. Stay out of src/credentials.js, src/proxy.js, src/server.js, and src/interceptors/**. No live model calls. Run the four checks before handoff and report their real output. Commit on local main; do not push unless I say so in the same turn.

Read src/runner/run.js end to end. Write a Codex brief at CODEX-TASK-run-js-extraction-2026-10-02.md from docs/templates/CODEX-TASK-template.md that extracts it into at most four modules. Candidates: finish and termination handling, tool-loop dispatch, resume and finalizers, summary and output.

The brief must have strictly ordered parts. For each part: the exact functions to move, the tests that must stay green after that part, the command to prove it (`node --require ./test/setup.js --test test/runner/*.test.js` plus scripts/mutation-check.js), and a "stop if" condition. Name what must not change: the SIGTERM finalizer, the central redaction boundary, the permission gate order.

No code changes; brief only. Commit, write HANDOFF-run-js-brief-2026-10-02.md, no push.
```

### F10. Keep this board current (recurring)

- Why: The board rots like every status document. A five-minute refresh after each wave keeps it honest.
- Files: docs/claude-deliverables-for-alan-nsfw-fable-5-1/what-next-board-2026-10-02/index.html and prompts.md only
- Depends on: At least one wave merged.
- Lane: Fable, docs only.
- Wave: 2

```text
Fable, we are in /Users/alanman/Developer/claude-local-bridge-playground on main. Run the CLAUDE.md startup preflight first and pull; if the tree is dirty, stop and tell me who you think is mid-flight. You hold the code baton for this card: no other Claude thread is editing src/, bin/, or test/ while it runs. Stay out of src/credentials.js, src/proxy.js, src/server.js, and src/interceptors/**. No live model calls. Run the four checks before handoff and report their real output. Commit on local main; do not push unless I say so in the same turn.

Refresh docs/claude-deliverables-for-alan-nsfw-fable-5-1/what-next-board-2026-10-02/index.html and prompts.md.

Run `gh pr list --state all --limit 30`, `git log --oneline -30`, and the four checks. For every card, set the printed status to merged, open (with the pull request number), blocked (with what it waits on), or not started, and add the date. Add any new residual that the merged pull requests' handoffs name as a new card at the bottom of the right column. Remove nothing. Keep the HTML self-contained.

Commit with `docs: what-next board refresh <date>`. No push.
```

## Claude Opus 5.5 (T3 Code)

Paste into: T3 Code, model Claude Opus 5.5. Independent reviews of Codex work, Alan-facing learning docs, prototypes, isolated builds. Writes into its own folder unless a card says otherwise.

### O1. Independent review: PR #30 and the Starlark resume branch

- Why: The charter wants landed runner code reviewed by a seat other than its author. Cursor is not in today’s rotation; Opus is a different model from Codex, so it counts.
- Files: docs/claude-deliverables-for-alan-nsfw-opus-5-5/review-pr30-and-starlark-resume-2026-10-02.md only
- Depends on: Nothing; both review targets already exist.
- Lane: Opus, docs only.
- Wave: 1

```text
Opus, we are in /Users/alanman/Developer/claude-local-bridge-playground on main. Run the CLAUDE.md startup preflight first and pull; if the tree is dirty, stop and tell me. Unless this card says otherwise, write only inside docs/claude-deliverables-for-alan-nsfw-opus-5-5/ and commit only that path (`git add` the folder, never `-A`), because another Claude thread may hold the code baton. Stay out of src/credentials.js, src/proxy.js, src/server.js, and src/interceptors/**. No live model calls. Explain terms on first use; I am a beginner. Do not push unless I say so in the same turn.

Review two things read-only.

(1) Pull request #30 (`gh pr view 30`, `gh pr diff 30`): does the fingerprint refresh change only the user-agent and x-stainless-package-version values, keep `billingBlock` null, and leave the two unreviewed betas out? Does test/fingerprint-automation.test.js assert exactly that? Is the ledger entry under docs/automation-ledger/fingerprint-checks/ consistent with the diff?

(2) The range 1e06820..da42e7a on branch codex/starlark-resume-2020-2026-09-26 (worktree at /Users/alanman/Developer/claude-local-bridge-starlark-resume-2020-2026-09-26), checked against HANDOFF-starlark-lows-review-2026-09-26.md: is each of Low #5, #6, #7, #8 actually closed by the diff, and does Low #8 follow option 2 as HANDOFF-starlark-laptop-transfer-2026-09-26.md records?

Write docs/claude-deliverables-for-alan-nsfw-opus-5-5/review-pr30-and-starlark-resume-2026-10-02.md with severity-ranked findings, a "not bugs (do not fix)" list, and a merge recommendation for each target. No code edits, no GitHub comments, commit only that folder, no push.
```

### O2. Documentation drift pass on the shared agent docs (PROC-AGENTSMD)

- Why: The 09-30 audits list stale lines in CLAUDE.md, AGENTS.md, and docs/threat-model.md. Agents arriving today read them as true.
- Files: CLAUDE.md, AGENTS.md, docs/threat-model.md, README.md lines 281-282
- Depends on: Nothing, but these are shared files: run only when no Fable code card is live.
- Lane: Opus, shared docs. Alan approves the doc edits by sending this prompt.
- Wave: 2

```text
Opus, we are in /Users/alanman/Developer/claude-local-bridge-playground on main. Run the CLAUDE.md startup preflight first and pull; if the tree is dirty, stop and tell me. Unless this card says otherwise, write only inside docs/claude-deliverables-for-alan-nsfw-opus-5-5/ and commit only that path (`git add` the folder, never `-A`), because another Claude thread may hold the code baton. Stay out of src/credentials.js, src/proxy.js, src/server.js, and src/interceptors/**. No live model calls. Explain terms on first use; I am a beginner. Do not push unless I say so in the same turn.

Exception to the preamble: Alan authorizes edits to CLAUDE.md, AGENTS.md, docs/threat-model.md, and README.md for this task only, and commits on local main.

Read the stale-line lists in docs/claude-deliverables-for-alan-nsfw-opus-5-5/status-and-roadmap-update-checks/AGENT-HANDOFF-status-audit-2026-09-30.md (section 5) and in the Fable audit at docs/claude-deliverables-for-alan-nsfw-fable-5-1/status-and-roadmap-update-checks/HANDOFF-fable-status-audit-2026-09-30.md. For each stale claim, verify it against current code or git history, then correct it with a dated parenthetical such as "(corrected 2026-10-02)" rather than silently rewriting. Keep the two Learned blocks byte-identical across CLAUDE.md and AGENTS.md. Fix the "shell is off" drift at README.md lines 281-282 to match bin/t3-cursor-shim.sh, which passes `--allow-shell`, and state that the shim choice is Alan's.

Run `npm run check:docs` and `npm run format:check` (three root handoffs are already red; leave them). Commit with `docs: correct stale agent-doc claims (2026-10-02)`. No push.
```

### O3. Interactive "how my agent works" learning lab (HTML)

- Why: Alan learns by doing. A stepper that walks one request through runner, bridge, model, tool, permission prompt, and error, using the real file names, is the teaching artifact this repo lacks.
- Files: docs/claude-deliverables-for-alan-nsfw-opus-5-5/agent-learning-lab-2026-10-02/index.html
- Depends on: Nothing.
- Lane: Opus, docs only.
- Wave: 3

```text
Opus, we are in /Users/alanman/Developer/claude-local-bridge-playground on main. Run the CLAUDE.md startup preflight first and pull; if the tree is dirty, stop and tell me. Unless this card says otherwise, write only inside docs/claude-deliverables-for-alan-nsfw-opus-5-5/ and commit only that path (`git add` the folder, never `-A`), because another Claude thread may hold the code baton. Stay out of src/credentials.js, src/proxy.js, src/server.js, and src/interceptors/**. No live model calls. Explain terms on first use; I am a beginner. Do not push unless I say so in the same turn.

Build a single self-contained HTML page (no build step, no external scripts or fonts) at docs/claude-deliverables-for-alan-nsfw-opus-5-5/agent-learning-lab-2026-10-02/index.html.

It lets a non-programmer step through one runner request: the prompt, the `POST /v1/messages` call to the local bridge, the model response containing a `tool_use` block, the permission gate (src/runner/permissions.js and `resolveFileTarget` in src/runner/safety.js), the local tool execution, the `tool_result`, the next model turn, and the finish.

Each step shows a plain-language card and the real file and function names from the code; read them, do not guess. Add a "what if" toggle per step for: permission denied, path escape attempt, budget stop, SIGTERM during a tool. Use the real tool list from src/runner/tool-catalog.js and the real capability groups. Define every term on first use. Commit only that folder, no push.
```

### O4. Visual "which folder and branch am I in?" map

- Why: Seven worktrees and eight codex/\* branches exist on this machine. A current map explains many of Alan’s collisions.
- Files: docs/claude-deliverables-for-alan-nsfw-opus-5-5/folder-and-branch-map-2026-10-02/index.html
- Depends on: Nothing.
- Lane: Opus, docs only.
- Wave: 3

```text
Opus, we are in /Users/alanman/Developer/claude-local-bridge-playground on main. Run the CLAUDE.md startup preflight first and pull; if the tree is dirty, stop and tell me. Unless this card says otherwise, write only inside docs/claude-deliverables-for-alan-nsfw-opus-5-5/ and commit only that path (`git add` the folder, never `-A`), because another Claude thread may hold the code baton. Stay out of src/credentials.js, src/proxy.js, src/server.js, and src/interceptors/**. No live model calls. Explain terms on first use; I am a beginner. Do not push unless I say so in the same turn.

Run read-only: `git worktree list`, `git branch -a --format='%(refname:short) %(upstream:track) %(committerdate:short)'`, `gh pr list --state all --limit 40`, and `ls ~/Developer`.

Build one self-contained HTML page at docs/claude-deliverables-for-alan-nsfw-opus-5-5/folder-and-branch-map-2026-10-02/index.html for a beginner. Explain what a clone, a worktree, a branch, and a pull request each are, one sentence each, with a small inline SVG drawing. Then list every worktree on this machine with its path, branch, last commit date, and whether the branch is merged, has an open pull request, or has unmerged commits and no pull request. Say which app usually touches each one (Terminal, T3 Code, the Codex app, Cursor, or GitHub in the browser). Add a "safe to delete?" column that says "ask Alan" for anything with unmerged commits.

Do not delete, prune, or check out anything. Commit only that folder, no push.
```

### O5. Review each Codex pull request as it lands (fill in the number)

- Why: The charter’s rule: landed runner code gets at least one invariant review. Use this once per Codex pull request, starting with C1, C2, C3.
- Files: docs/claude-deliverables-for-alan-nsfw-opus-5-5/review-pr-NN-2026-10-02.md, one per pull request
- Depends on: The pull request exists.
- Lane: Opus, docs only.
- Wave: 2

```text
Opus, we are in /Users/alanman/Developer/claude-local-bridge-playground on main. Run the CLAUDE.md startup preflight first and pull; if the tree is dirty, stop and tell me. Unless this card says otherwise, write only inside docs/claude-deliverables-for-alan-nsfw-opus-5-5/ and commit only that path (`git add` the folder, never `-A`), because another Claude thread may hold the code baton. Stay out of src/credentials.js, src/proxy.js, src/server.js, and src/interceptors/**. No live model calls. Explain terms on first use; I am a beginner. Do not push unless I say so in the same turn.

Review pull request #NN read-only (`gh pr view NN`, `gh pr diff NN`, `gh pr checks NN`). Replace NN with the number I give you.

Check it against the source handoff the pull request cites; the safety invariants in CLAUDE.md and SECURITY.md (no bridge-file edits, redaction intact, deny matrix untouched unless the pull request says so, no retired flags); test honesty (do the tests assert the behavior the pull request claims, or merely current behavior, and would they fail if the change were reverted); and scope creep beyond the card.

Write docs/claude-deliverables-for-alan-nsfw-opus-5-5/review-pr-NN-2026-10-02.md with severity-ranked findings, a "not bugs (do not fix)" list, and one of: merge, fix first, reject. Do not comment on GitHub, do not edit code, commit only that folder, no push.
```

### O6. Refresh docs/ARCHITECTURE.md (HE-05 docs half)

- Why: ARCHITECTURE.md has been stale since round 3. The OpenTelemetry half stays parked, but the module map should match the code agents read today.
- Files: docs/ARCHITECTURE.md (shared doc; Alan approves by sending)
- Depends on: Nothing; shared file, so run between Fable code cards.
- Lane: Opus, shared doc.
- Wave: 3

```text
Opus, we are in /Users/alanman/Developer/claude-local-bridge-playground on main. Run the CLAUDE.md startup preflight first and pull; if the tree is dirty, stop and tell me. Unless this card says otherwise, write only inside docs/claude-deliverables-for-alan-nsfw-opus-5-5/ and commit only that path (`git add` the folder, never `-A`), because another Claude thread may hold the code baton. Stay out of src/credentials.js, src/proxy.js, src/server.js, and src/interceptors/**. No live model calls. Explain terms on first use; I am a beginner. Do not push unless I say so in the same turn.

Exception to the preamble: Alan authorizes editing docs/ARCHITECTURE.md for this task and committing on local main.

Read docs/ARCHITECTURE.md, then read every module under src/runner/ (file names and top-of-file comments) and bin/local-bridge-runner.js. Rewrite the module map so every listed file exists, every existing runtime module appears with a one-line purpose, and retired concepts (agent profiles, capability profiles) are absent. Add a dated "last verified" line. Add a "built but unwired" subsection naming src/runner/tool-prefetch.js, subprocess-pool.js, streaming-write.js, and workspace-fingerprint.js if grep confirms nothing in src/ or bin/ requires them. Leave the observability section marked parked, with the date.

`npm run check:docs` must pass. Commit with `docs: refresh ARCHITECTURE module map (2026-10-02)`. No push.
```

### O7. Alan’s decision board (all open decisions in one place)

- Why: At least ten open items are blocked on an Alan decision and scattered across handoffs. One page with options, a recommendation, and a type-this-line answer per item turns them into clicks.
- Files: docs/claude-deliverables-for-alan-nsfw-opus-5-5/decision-board-2026-10-02/index.html
- Depends on: Nothing.
- Lane: Opus, docs only.
- Wave: 1

```text
Opus, we are in /Users/alanman/Developer/claude-local-bridge-playground on main. Run the CLAUDE.md startup preflight first and pull; if the tree is dirty, stop and tell me. Unless this card says otherwise, write only inside docs/claude-deliverables-for-alan-nsfw-opus-5-5/ and commit only that path (`git add` the folder, never `-A`), because another Claude thread may hold the code baton. Stay out of src/credentials.js, src/proxy.js, src/server.js, and src/interceptors/**. No live model calls. Explain terms on first use; I am a beginner. Do not push unless I say so in the same turn.

Build a beginner-readable self-contained HTML decision board at docs/claude-deliverables-for-alan-nsfw-opus-5-5/decision-board-2026-10-02/index.html.

Cover these open decisions. For each: what it is in plain words, the options with pros and cons, your recommendation, what deciding unblocks, the file that raises it (cite the path), and the exact one-line reply Alan can type.
- D-F3: Starlark summary truncate-versus-reject
- R12: unify the Starlark evidence layout
- DBOS arm: formally retire it
- HE-02: add a GitHub Actions CI workflow
- HE-08: legacy src/runner/context-compactor.js (mark deprecated, migrate, or keep)
- S25-DEFAULTS: planner model in starlark-host/experiment.config.json versus the "plan with Haiku, work with Sonnet" conclusion
- PROC-FMT: the three Prettier-red root handoffs
- SEC-05: `--allow-shell` passed by bin/t3-cursor-shim.sh
- HE-10: adopting `@ts-check`
- Closing pull request #26 after the HS-01 rescue lands
- Closing pull request #21 (superseded by #22)

Include a checkbox per decision saved in localStorage and a "copy my decisions" button that produces the chosen one-liners as text. Commit only that folder, no push.
```

### O8. GitHub Actions CI running the four checks (HE-02), only if Alan says yes on O7

- Why: No workflow runs the tests today. Pull-request checks would catch what the three agents miss.
- Files: new .github/workflows/checks.yml, one README paragraph
- Depends on: Alan’s HE-02 decision (card O7).
- Lane: Opus, shared file area; run when the code baton is free.
- Wave: 3

```text
Opus, we are in /Users/alanman/Developer/claude-local-bridge-playground on main. Run the CLAUDE.md startup preflight first and pull; if the tree is dirty, stop and tell me. Unless this card says otherwise, write only inside docs/claude-deliverables-for-alan-nsfw-opus-5-5/ and commit only that path (`git add` the folder, never `-A`), because another Claude thread may hold the code baton. Stay out of src/credentials.js, src/proxy.js, src/server.js, and src/interceptors/**. No live model calls. Explain terms on first use; I am a beginner. Do not push unless I say so in the same turn.

Exception to the preamble: Alan has decided yes on HE-02 and authorizes adding .github/workflows/checks.yml and one README.md paragraph, committed on local main.

Write .github/workflows/checks.yml that runs on pull_request and on push to main, on ubuntu-latest and macos-latest, with the Node version from .nvmrc or the engines field in package.json. Steps: `npm ci`, `npm test` with `HOME=$RUNNER_TEMP/testhome` (the Codex briefs explain why), `npm run lint`, `npm run check:docs`, and `npm run format:check` marked `continue-on-error: true` with a comment naming PROC-FMT until that decision lands. No secrets, no caching of ~/.bridge-runner, no network beyond npm.

Add a README.md paragraph explaining what CI (continuous integration) is, what the workflow checks, and where to see results on GitHub. Commit with `ci: add checks workflow (HE-02)`. Tell Alan the workflow only runs after he pushes. No push.
```

### O9. Beginner-friendly command-builder prototype

- Why: The command builder is Alan’s primary runner UX. He has asked for hover explanations and conflict warnings that grey out instead of resetting other toggles.
- Files: docs/claude-deliverables-for-alan-nsfw-opus-5-5/command-builder-beginner-2026-10-02/index.html
- Depends on: Nothing.
- Lane: Opus, docs only. The live builder pages are untouched, so the drift tests are unaffected.
- Wave: 3

```text
Opus, we are in /Users/alanman/Developer/claude-local-bridge-playground on main. Run the CLAUDE.md startup preflight first and pull; if the tree is dirty, stop and tell me. Unless this card says otherwise, write only inside docs/claude-deliverables-for-alan-nsfw-opus-5-5/ and commit only that path (`git add` the folder, never `-A`), because another Claude thread may hold the code baton. Stay out of src/credentials.js, src/proxy.js, src/server.js, and src/interceptors/**. No live model calls. Explain terms on first use; I am a beginner. Do not push unless I say so in the same turn.

Read docs/command-builder.html and docs/command-builder-v2.html and the runtime tables they mirror: src/runner/tool-catalog.js, the MODES in src/runner/permissions.js, src/runner/prompts/registry.js, and the CLI flag list in bin/local-bridge-runner.js.

Build a separate self-contained prototype at docs/claude-deliverables-for-alan-nsfw-opus-5-5/command-builder-beginner-2026-10-02/index.html offering the same flags with: a one-sentence plain-language hover for every flag, a glossary drawer, greyed-out (never reset) conflicting choices with the reason shown (for example `--dont-ask` never enables shell; shell needs `--allow-shell`), and a "what will happen" preview paragraph that updates live.

Generate the command string identically to the live builder for the same inputs, and include a self-check table comparing ten sample inputs against the live builder's output. Do not edit the live builder pages. Commit only that folder, no push.
```

### O10. Repeatable local agent demo with a fake bridge (no live model)

- Why: The golden eval fakes the model in-process by monkey-patching model-client.js. Nothing exercises the real HTTP path end to end. A tiny fake /v1/messages server plus --bridge-url gives Alan a demo he can rerun whenever the account is rate-limited.
- Files: new scripts/demo-fake-bridge.js, new test/fake-bridge-demo.test.js, docs/claude-deliverables-for-alan-nsfw-opus-5-5/fake-bridge-demo-2026-10-02.html
- Depends on: Nothing.
- Lane: Opus. scripts/ and this test file are touched by no other card.
- Wave: 3

```text
Opus, we are in /Users/alanman/Developer/claude-local-bridge-playground on main. Run the CLAUDE.md startup preflight first and pull; if the tree is dirty, stop and tell me. Unless this card says otherwise, write only inside docs/claude-deliverables-for-alan-nsfw-opus-5-5/ and commit only that path (`git add` the folder, never `-A`), because another Claude thread may hold the code baton. Stay out of src/credentials.js, src/proxy.js, src/server.js, and src/interceptors/**. No live model calls. Explain terms on first use; I am a beginner. Do not push unless I say so in the same turn.

Exception to the preamble: you may add scripts/demo-fake-bridge.js and test/fake-bridge-demo.test.js and commit them on local main together with the walkthrough.

Write scripts/demo-fake-bridge.js: a Node HTTP server on an ephemeral 127.0.0.1 port that answers `POST /v1/messages` in the Anthropic Messages shape with a scripted sequence (turn 1: a `tool_use` block calling `list_files` on `.`; turn 2: a short text answer summarizing the result). Honor `stream: true` with the server-sent events the runner already parses; read src/runner/model-client.js for the exact event names. On start, print the exact runner command to run against it using `--bridge-url` and a temporary `--cwd` (use scripts/create-runner-throwaway-lab.js if it fits).

Add test/fake-bridge-demo.test.js that starts the server, runs the real runner CLI as a child process against it, and asserts the transcript contains exactly one list_files call and a final answer. Never forward anything upstream; never read credentials or the keychain.

Write a beginner walkthrough at docs/claude-deliverables-for-alan-nsfw-opus-5-5/fake-bridge-demo-2026-10-02.html. Commit, no push.
```
