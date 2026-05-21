# OPENCODE.md

Use this file as the startup checklist for a fresh OpenCode session.

## Paste This First

```text
Read AGENTS.md and OPENCODE.md before doing any work.

Work in:
/Users/alanman/.codex/worktrees/runner-clean-pr

Expected branch:
codex/runner-clean-pr

Do not use the old claude-local-bridge-runner-test repo except as historical reference.
Do not modify bridge auth/proxy/interceptor internals unless Alan explicitly asks.
Keep changes scoped to runner/docs/tests.
Preserve safety defaults.
Before handoff, run targeted tests, npm test, npm run lint, and Prettier check for touched files.
```

## Startup Commands

Type these in Terminal from any folder. The first command moves Terminal into the correct project folder.

```bash
cd "/Users/alanman/.codex/worktrees/runner-clean-pr"
pwd
git branch --show-current
git status --short
git pull --ff-only origin codex/runner-clean-pr
```

Success looks like:

- `pwd` prints `/Users/alanman/.codex/worktrees/runner-clean-pr`
- branch prints `codex/runner-clean-pr`
- pull either updates cleanly or says it is already up to date

If `git status --short` shows `.DS_Store`, ignore it unless Alan asks to clean it.

## Files OpenCode Should Read

Ask OpenCode to read these before editing:

- `AGENTS.md`
- `README.md`
- `docs/runner-quickstart.html`
- `docs/command-builder.html`
- `docs/threat-model.md`

For runner behavior:

- `bin/local-bridge-runner.js`
- `src/runner/run.js`
- `src/runner/model-client.js`
- `src/runner/tool-registry.js`
- `src/runner/permissions.js`
- `src/runner/safety.js`

## Good Task Boundaries

Give OpenCode one bucket at a time:

- Docs/UX: `README.md`, `docs/**`, `bin/local-bridge-runner.js` help text.
- Tests: `test/runner/**`, with minimal source fixes only if tests prove a bug.
- Safety: `src/runner/safety.js`, `src/runner/permissions.js`, `src/runner/tool-registry.js`, `src/runner/tools/**`.
- Runner loop/parity: `src/runner/run.js`, `src/runner/model-client.js`, `src/runner/transcript.js`.

Avoid assigning multiple agents to the same file at the same time.

## Do Not Touch Unless Explicitly Asked

- `src/credentials.js`
- `src/proxy.js`
- `src/server.js`
- `src/interceptors/**`
- VS Code extension auth settings

## Required Checks Before Handoff

```bash
node --require ./test/setup.js --test test/runner/*.test.js
npm test
npm run lint
npx prettier --check <touched files>
```

If OpenCode cannot run a check, it should say exactly which check was skipped and why.

## Manual Smoke Test

Use this to test the runner against itself:

```bash
cd "/Users/alanman/.codex/worktrees/runner-clean-pr"
node bin/local-bridge-runner.js \
  --cwd "/Users/alanman/.codex/worktrees/runner-clean-pr" \
  --max-steps 8 \
  --verbose \
  "List the top-level files, summarize what this project does, then stop. Do not edit files."
```

Use this to test another project:

```bash
cd "/Users/alanman/.codex/worktrees/runner-clean-pr"
node bin/local-bridge-runner.js \
  --cwd "/Users/alanman/path/to/another/project" \
  --max-steps 8 \
  --verbose \
  "List the top-level files, summarize what this project does, then stop. Do not edit files."
```

## Handoff Format

Ask OpenCode to end with:

```text
Folder:
Branch:
Files changed:
Tests/checks run:
Skipped checks:
Risks:
Suggested next step:
```
