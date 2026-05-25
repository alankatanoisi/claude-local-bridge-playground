# OPENCODE.md

Use this file as the startup checklist for a fresh OpenCode session.

## Paste This First

```text
Read AGENTS.md, lab-notes/ALAN_OPERATOR_PROFILE.md, and OPENCODE.md before doing any work.

Work in:
/Users/alanman/Developer/claude-local-bridge-playground

Expected branch:
main

Expected remote:
origin = https://github.com/alankatanoisi/claude-local-bridge-playground.git

Use the playground repo as the active harness lab.
Treat /Users/alanman/Developer/claude-local-bridge as frozen canonical reference unless Alan explicitly asks for promotion work.
Do not use the old claude-local-bridge-runner-test repo except as historical reference.
Do not use the iCloud claude-local-bridge checkout for active runner work unless Alan explicitly asks.
Do not modify bridge auth/proxy/interceptor internals unless Alan explicitly asks.
Keep changes scoped to runner/docs/tests.
Preserve safety defaults.
Before handoff, run targeted tests, npm test, npm run lint, and Prettier check for touched files.
```

## Startup Commands

**Playground lane** — type in Terminal:

```bash
cd "/Users/alanman/Developer/claude-local-bridge-playground"
pwd
git branch --show-current
git remote -v
git status --short
git pull --ff-only origin main
```

Success looks like:

- `pwd` prints `/Users/alanman/Developer/claude-local-bridge-playground`
- `git branch --show-current` prints `main`
- `git remote -v` shows `origin` pointing to `alankatanoisi/claude-local-bridge-playground`
- pull either updates cleanly or says already up to date

**Canonical lane** — use only if Alan explicitly asks for promotion/canonical work:

```bash
cd "/Users/alanman/Developer/claude-local-bridge"
pwd
git branch --show-current
git status --short
git pull --ff-only origin codex/runner-clean-pr
```

If `git status --short` shows `.DS_Store`, ignore it unless Alan asks to clean it.

Playground uses GitHub repo [claude-local-bridge-playground](https://github.com/alankatanoisi/claude-local-bridge-playground). PRs belong there, not on canonical `main`. See `lab-notes/PLAYGROUND_PR_POLICY.md`.

## Files OpenCode Should Read

Ask OpenCode to read these before editing:

- `lab-notes/ALAN_OPERATOR_PROFILE.md`
- `AGENTS.md`
- `README.md`
- `QUICKSTART.md`
- `BEGINNER_GUIDE.md`
- `HEADLESS_AGENT_RUNNER_BEGINNER_GUIDE.md`
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
cd "/Users/alanman/Developer/claude-local-bridge-playground"
node bin/local-bridge-runner.js \
  --cwd "/Users/alanman/Developer/claude-local-bridge-playground" \
  --max-steps 8 \
  --verbose \
  "List the top-level files, summarize what this project does, then stop. Do not edit files."
```

Use this to test another project:

```bash
cd "/Users/alanman/Developer/claude-local-bridge-playground"
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
