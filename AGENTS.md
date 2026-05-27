# AGENTS.md

Shared instructions for any coding agent working in this repository.

**Read this entire Human Context section before doing anything else.**

## Human Context

Alan is using agents to learn and build. He is a strong systems thinker, but a **true novice at programming and terminal workflows**. Default to **over-explaining**, not under-explaining. When in doubt, treat him as if he does **not** know the usual programmer conventions — that is the safe and correct assumption.

### Novice-first rules (required)

1. **Never assume** Alan knows whether something belongs in Terminal, VS Code, Cursor chat, GitHub in a browser, or a local folder path.
2. **Define jargon once** when you use it (branch, commit, push, PR, merge, cwd, lint, JSONL, etc.) in plain English.
3. **Every command** you give must say:
   - **Where** to run it (Terminal vs inside VS Code vs browser)
   - **What folder** to `cd` into first, if any
   - **What success looks like** (one concrete sign it worked)
4. **Prefer one step at a time** for Git and Terminal unless Alan asks for a batch.
5. **Warn before risky actions** (push, force push, delete files, `--accept-edits`, `--allow-shell`, editing outside the repo).
6. **Do not skip handoff fields** (folder, branch, files, checks) even for small tasks.
7. **Better safe than sorry** — a slightly longer explanation beats a mysterious failure.

Alan explicitly wants agents to treat him like a beginner. Do not optimize for brevity at the cost of clarity.

**Before substantial work, also read [`lab-notes/ALAN_OPERATOR_PROFILE.md`](lab-notes/ALAN_OPERATOR_PROFILE.md)** (agent ground truth from Claude Code Insights). Optional deep dive: HTML in `lab-notes/claude-code-insights/`.

## Active Playground Lane

Use this repo as the active harness lab unless Alan explicitly asks for canonical promotion work.

- GitHub: [claude-local-bridge-playground](https://github.com/alankatanoisi/claude-local-bridge-playground), push to **`main`**.
- Local folder: `/Users/alanman/Developer/claude-local-bridge-playground`.
- Expected branch: `main`.
- Expected `origin`: `https://github.com/alankatanoisi/claude-local-bridge-playground.git`.
- **MUST NOT** open PRs on canonical repo `alankatanoisi/claude-local-bridge` for playground experiments.
- See [`lab-notes/PLAYGROUND_PR_POLICY.md`](lab-notes/PLAYGROUND_PR_POLICY.md) and [`lab-notes/PLAYGROUND_GIT_REMOTE.md`](lab-notes/PLAYGROUND_GIT_REMOTE.md).

## Active Research Direction: OAuth-Only Bridge Evidence

The current project direction is to keep the playground as an **OAuth-only evidence harness** for Alan's Anthropic policy
discussion. The goal is to test and document whether local bridge/runner traffic can be carried solely by Alan's own
Claude Code OAuth session, without Anthropic Console API keys or other billing-path noise.

Required implications:

- Do not add or restore upstream `ANTHROPIC_API_KEY` fallback behavior.
- Do not add or restore `claudeLocalBridge.apiKey` as an upstream credential source.
- Do not capture or replay upstream `x-api-key` credentials as a success path.
- Treat dummy client keys such as `local` as local placeholders only; they must not become upstream Anthropic auth.
- Keep debug/trace/log surfaces redacted because OAuth tokens and fingerprints are sensitive local account state.
- Document policy risk plainly: this is personal research / disclosure context, not proof of Anthropic approval.

**Anthropic documentation for agents:** Any question about Anthropic APIs, Agents SDK, Claude Code, billing/help, or policy must be grounded in **official pages** (use **WebFetch** on `docs.anthropic.com`, `code.claude.com/docs`, `support.claude.com`, and official `github.com/anthropics/*`). Do not use Context7, generic web search, or model memory as the default for those facts. Full plain-language rules: [`.cursor/rules/anthropic-primary-sources.mdc`](.cursor/rules/anthropic-primary-sources.mdc) — same order as the **anthropic-official** and **anthropic-platform-expert** project skills (`lab-notes/agents/README.md`).

When handing work back, be explicit:

- Say which folder you worked in.
- Say which branch you used.
- Say which files changed.
- Say exactly which checks passed or failed.
- Explain risky terms in one sentence.
- Do not assume Alan knows whether something belongs in Terminal, VS Code, GitHub, or a browser.

When adding new JavaScript in the runner, short beginner-friendly `//` comments are welcome where they explain non-obvious control flow. Do not add noisy comments that merely repeat obvious code.

## Repository Lanes

The active experiment lane is:

```bash
/Users/alanman/Developer/claude-local-bridge-playground
```

Expected branch:

```bash
main
```

The canonical runner branch/worktree is frozen unless Alan explicitly asks for promotion work:

```bash
/Users/alanman/Developer/claude-local-bridge
```

Expected canonical branch:

```bash
codex/runner-clean-pr
```

Separate GitHub repo: [claude-local-bridge-playground](https://github.com/alankatanoisi/claude-local-bridge-playground), default branch **`main`**. See `lab-notes/PLAYGROUND_GIT_REMOTE.md` and `lab-notes/PLAYGROUND_PR_POLICY.md`. Do not PR playground work to canonical `main`.

The older prototype repo is historical reference only:

```bash
/Users/alanman/Library/Mobile Documents/com~apple~CloudDocs/Documents/GitHub/claude-local-bridge-runner-test
```

The iCloud checkout is also reference-only for active runner work:

```bash
/Users/alanman/Library/Mobile Documents/com~apple~CloudDocs/Documents/GitHub/claude-local-bridge
```

Do not implement in either iCloud folder unless Alan explicitly asks. If you discover you are in one of those folders by
accident, stop and tell Alan.

## Startup Checklist

**Read [`lab-notes/ACTIVE_WORKTREE.md`](lab-notes/ACTIVE_WORKTREE.md) first.** Do not commit to canonical `claude-local-bridge` or PR #17 unless Alan explicitly asks for promotion.

At the start of a fresh session, run this **before edits**:

```bash
pwd
git branch --show-current
git remote -v
git status --short
```

Success in the playground looks like:

- `pwd` ends with `/Users/alanman/Developer/claude-local-bridge-playground`
- `git branch --show-current` prints `main`
- `git remote -v` shows `origin` pointing to `alankatanoisi/claude-local-bridge-playground`
- `git status --short` has no unexpected source files; `.DS_Store` noise is okay to ignore

Then pull the branch that matches **this folder**:

```bash
# If pwd ends with claude-local-bridge-playground:
git pull --ff-only origin main

# If pwd ends with claude-local-bridge (canonical, no -playground):
git pull --ff-only origin codex/runner-clean-pr
```

If `git status --short` shows only `.DS_Store` files, treat them as unrelated local noise unless Alan asks to clean them.

Read these before substantial edits:

- `lab-notes/ALAN_OPERATOR_PROFILE.md` (required for agents)
- `README.md`
- `BEGINNER_GUIDE.md` (folder cheat sheet at the top)
- `HEADLESS_AGENT_RUNNER_BEGINNER_GUIDE.md`
- `lab-notes/PLAYGROUND_GIT_REMOTE.md` (when in playground)
- `lab-notes/PLAYGROUND_PR_POLICY.md` (when in playground)
- `lab-notes/OAUTH_ONLY_DIRECTION.md` (current bridge/runner research direction)

## Project Overview

Claude Local Bridge is a VS Code extension that exposes Claude Code credentials through a local HTTP API on `localhost:11437`.

The runner is an experimental local coding-agent loop on top of that bridge:

```text
prompt -> local bridge /v1/messages -> model response -> tool_use -> local tool execution -> tool_result -> repeat
```

The bridge owns OAuth/keychain/interceptor/proxy behavior. The runner owns the local agent loop, tools, permissions, transcripts, and CLI UX.

## Hard Boundaries

Do not modify bridge/auth/proxy internals unless Alan explicitly asks. Alan has explicitly asked for the OAuth-only
directional change, so bridge/auth/proxy changes are in scope when they preserve the rules above:

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
- `bin/local-bridge-archive.js`: list/search/import runner archives under `~/.bridge-runner/archive/`.
- `src/runner/archive/**`: per-turn export, catalog index, legacy JSONL ingest, CSV/XLSX rebuild.
- `docs/command-builder.html`: browser form that builds runner commands.

Auto-archive runs unless `BRIDGE_RUNNER_ARCHIVE=0` (tests) or `--no-archive`. Shared sessions live in `~/.bridge-runner/sessions/`; archive rollups mirror session ids under `archive/sessions/`.

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
cd "/Users/alanman/Developer/claude-local-bridge-playground"
node bin/local-bridge-runner.js \
  --cwd "/Users/alanman/Developer/claude-local-bridge-playground" \
  --max-steps 8 \
  --verbose \
  "List the top-level files, summarize what this project does, then stop. Do not edit files."
```

Read-only test against another local folder:

```bash
cd "/Users/alanman/Developer/claude-local-bridge-playground"
node bin/local-bridge-runner.js \
  --cwd "/Users/alanman/path/to/another/project" \
  --max-steps 8 \
  --verbose \
  "List the top-level files, summarize what this project does, then stop. Do not edit files."
```

Attach files from the target folder:

```bash
cd "/Users/alanman/Developer/claude-local-bridge-playground"
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
