# AGENTS.md

Shared instructions for any coding agent working in this repository.

## Human Context

Alan is using agents to learn and build. He is a strong systems thinker, but a beginner at programming and terminal workflows. When handing work back, be explicit:

- Say which folder you worked in.
- Say which branch you used.
- Say which files changed.
- Say exactly which checks passed or failed.
- Explain risky terms in one sentence.
- Do not assume Alan knows whether something belongs in Terminal, VS Code, GitHub, or a browser.

When adding new JavaScript in the runner, short beginner-friendly `//` comments are welcome where they explain non-obvious control flow. Do not add noisy comments that merely repeat obvious code.

## Canonical Workspace

The current canonical runner branch/worktree is:

```bash
/Users/alanman/.codex/worktrees/runner-clean-pr
```

Expected branch:

```bash
codex/runner-clean-pr
```

The older prototype repo is historical reference only:

```bash
/Users/alanman/Library/Mobile Documents/com~apple~CloudDocs/Documents/GitHub/claude-local-bridge-runner-test
```

Do not implement there unless Alan explicitly asks. If you discover you are in that folder by accident, stop and tell Alan.

## Startup Checklist

At the start of a fresh session, run or confirm:

```bash
pwd
git branch --show-current
git status --short
git pull --ff-only origin codex/runner-clean-pr
```

If `git status --short` shows only `.DS_Store` files, treat them as unrelated local noise unless Alan asks to clean them.

Read these before substantial edits:

- `README.md`
- `OPENCODE.md`
- `docs/runner-quickstart.html`
- `docs/command-builder.html`
- `docs/threat-model.md`

## Project Overview

Claude Local Bridge is a VS Code extension that exposes Claude Code credentials through a local HTTP API on `localhost:11437`.

The runner is an experimental local coding-agent loop on top of that bridge:

```text
prompt -> local bridge /v1/messages -> model response -> tool_use -> local tool execution -> tool_result -> repeat
```

The bridge owns OAuth/keychain/interceptor/proxy behavior. The runner owns the local agent loop, tools, permissions, transcripts, and CLI UX.

## Hard Boundaries

Do not modify bridge/auth/proxy internals unless Alan explicitly asks:

- `src/credentials.js`
- `src/proxy.js`
- `src/server.js`
- `src/interceptors/**`
- VS Code extension auth settings

Runner work should usually stay in:

- `bin/local-bridge-runner.js`
- `src/runner/**`
- `test/runner/**`
- `docs/runner-quickstart.html`
- `docs/command-builder.html`
- `docs/threat-model.md`
- `README.md`

## Runner Safety Rules

Preserve conservative safety defaults:

- Shell is hidden unless `--allow-shell` is set.
- `--dont-ask` must not enable shell by itself.
- `.env`, private keys, credential JSON, token files, `.ssh`, `.aws`, `.claude`, and path escapes must stay blocked.
- Write tools must remain guarded by confirmation unless `--accept-edits` is set.
- Tool results, transcripts, stream output, JSON output, and human logs must scrub secrets.
- `--cwd` is the target project folder; it is not necessarily the folder containing the runner.

## Key Runner Files

- `src/runner/run.js`: main agent loop.
- `src/runner/model-client.js`: calls local `/v1/messages`, including streaming response reconstruction.
- `src/runner/tool-registry.js`: exposes and dispatches tools.
- `src/runner/permissions.js`: allow/ask/deny policy.
- `src/runner/safety.js`: path confinement, deny matrix, environment scrubbing, secret redaction.
- `src/runner/tools/**`: individual local tools.
- `src/runner/transcript.js`: JSONL event transcript.
- `src/runner/human-log.js`: readable plain text log.
- `bin/local-bridge-runner.js`: CLI entrypoint.
- `docs/command-builder.html`: browser form that builds runner commands.

## Development Commands

Install dependencies:

```bash
npm install
```

Run all checks:

```bash
npm test
npm run lint
npm run format:check
```

Run runner tests only:

```bash
node --require ./test/setup.js --test test/runner/*.test.js
```

Run a specific test file:

```bash
node --require ./test/setup.js --test test/runner/model-client.test.js
```

Format touched files:

```bash
npx prettier --write <files>
```

## Manual Smoke Tests

Read-only test against this repo:

```bash
cd "/Users/alanman/.codex/worktrees/runner-clean-pr"
node bin/local-bridge-runner.js \
  --cwd "/Users/alanman/.codex/worktrees/runner-clean-pr" \
  --max-steps 8 \
  --verbose \
  "List the top-level files, summarize what this project does, then stop. Do not edit files."
```

Read-only test against another local folder:

```bash
cd "/Users/alanman/.codex/worktrees/runner-clean-pr"
node bin/local-bridge-runner.js \
  --cwd "/Users/alanman/path/to/another/project" \
  --max-steps 8 \
  --verbose \
  "List the top-level files, summarize what this project does, then stop. Do not edit files."
```

Attach files from the target folder:

```bash
cd "/Users/alanman/.codex/worktrees/runner-clean-pr"
node bin/local-bridge-runner.js \
  --cwd "/Users/alanman/path/to/another/project" \
  --include-file README.md \
  --include-file package.json \
  "Review the attached files and explain the project setup. Do not edit files."
```

## Required Handoff

End every task with:

- Branch and folder used.
- Files changed.
- Tests/checks run.
- Any checks skipped and why.
- Risks or follow-up work.

Do not claim something is pushed unless `git push` actually succeeded.
