# AGENTS.md

Shared instructions for any coding agent working in this repository.

## Human Context

Alan is using agents to learn and build. He is a strong systems thinker, highly curious, enthusiastic about learning, but a true novice at programming and terminal workflows. Default to over-explaining, not under-explaining.

### Novice-First Rules

1. Never assume Alan knows whether something belongs in Terminal, VS Code, Cursor chat, GitHub in a browser, or a local folder path.
2. Define jargon once when you use it. Examples: branch, commit, push, pull request, merge, current working directory, lint, JSONL.
3. Every command you give must say where to run it, what folder to use first, and what success looks like.
4. Prefer one step at a time for Git and Terminal unless Alan asks for a batch.
5. Warn before risky actions such as pushing, force pushing, deleting files, enabling shell access, accepting edits automatically, or editing outside the repo.
6. Do not skip handoff fields: folder, branch, files, checks, skipped checks, and risks.
7. Prefer HTML docs over Markdown for complex documentation.
8. Prefer liberal and generous amounts of inline comments in code to explain the "why" behind the "what".
9. When adding new JavaScript in the runner, short beginner-friendly `//` comments are welcome where they explain non-obvious control flow. Do not add comments that only repeat what the code already says.
10. When in doubt, provide more context and explanation rather than less.
11. When providing multiple options, explain the pros and cons of each to help Alan make an informed decision.

## Active Repository

Use this repo as the active runner lab unless Alan explicitly asks for canonical promotion work.

- Local folder: `/Users/alanman/Developer/claude-local-bridge-playground`
- Expected branch: `main`
- Expected GitHub repo: `https://github.com/alankatanoisi/claude-local-bridge-playground.git`
- Canonical repo `alankatanoisi/claude-local-bridge` is reference-only for this playground.

Do not open pull requests against the canonical repo for playground experiments. A pull request is a GitHub request to merge one branch into another; this repo normally works directly on playground `main`.

## Startup Preflight

At the start of file, repo, docs, testing, syncing, or command-line work, verify the location before editing:

```bash
pwd
git rev-parse --show-toplevel
git branch --show-current
git remote -v
git status --short
```

Success in this playground looks like:

- `pwd` and the repo root end with `/Users/alanman/Developer/claude-local-bridge-playground`
- the branch is `main`
- `origin` points to `alankatanoisi/claude-local-bridge-playground`
- the working tree has no unexpected dirty source files

Then pull this branch before new edits when it is safe to do so:

```bash
git pull --ff-only origin main
```

If the folder is home, Downloads, an iCloud checkout, a scratch folder, or the canonical repo, pause and tell Alan before editing.

## Current Direction

This playground is now primarily an exploratory laboratory for testing and experimenting with a small, Anthropic-native local coding-agent loop that we
can simplify, test, customize, and extend. The bridge/OAuth layer is important plumbing, but it is no longer the main
product surface for day-to-day work.

Inspired by minimalist agent designs such as pi, prefer a small core with explicit opt-ins:

- Keep the default system prompt short and generic.
- Keep startup context minimal unless a template or explicit flag asks for more.
- Treat tools as capability groups instead of an ever-growing flat feature list.
- Prefer prompt templates, `.bridge-runner/` project files, hooks, and explicit flags for customization.
- Agent profiles and capability profiles are retired runtime concepts. Do not restore `--agent`, `--profile`,
  `--list-agents`, or `--list-profiles`; historical code lives under `docs/archive/runner-profiles/`.
- Keep shell and advanced patch mode hidden unless explicitly enabled.

Transport/auth invariants still matter because they keep the runner lane clean:

- Keep `/v1/messages` as the native Anthropic Messages surface.
- Do not add or restore OpenAI-compatible endpoints such as `/v1/chat/completions` or `/v1/models`.
- Do not add or restore upstream `ANTHROPIC_API_KEY` fallback behavior.
- Do not add or restore `claudeLocalBridge.apiKey` as an upstream credential source.
- Do not capture or replay upstream `x-api-key` credentials as a success path.
- Treat dummy client keys such as `local` as local placeholders only; they must not become upstream Anthropic auth.
- Keep debug, trace, transcript, and log surfaces redacted because OAuth tokens and fingerprints are sensitive local account state.
- Document policy risk plainly when transport/auth behavior is relevant: this is personal research, not proof of
  Anthropic approval.

For Anthropic API, Claude Code, billing, or policy facts, use official sources first: `docs.anthropic.com`, `code.claude.com/docs`, `support.claude.com`, and official `github.com/anthropics/*` repositories. Make use of the anthropic-platform-expert and/or anthropic-official skills to provide accurate and up-to-date information.

## Project Overview

Claude Local Bridge is the transport shim: a VS Code extension that exposes Claude Code credentials through a local HTTP
API on `localhost:11437`.

The runner is an experimental local coding-agent loop on top of that bridge:

```text
prompt -> local bridge /v1/messages -> model response -> tool_use -> local tool execution -> tool_result -> repeat
```

The bridge owns OAuth, keychain, interceptor, and proxy behavior. The runner owns the part we are actively evolving:
the local agent loop, capability groups, permissions, prompts, transcripts, archives, and command-line user
experience.

## Boundaries

Do not modify bridge/auth/proxy internals unless Alan explicitly asks or the change is required to keep the runner
transport working. Most new work should land in the runner/docs lane.

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

## Key Files

- `README.md`: main project and runner guide.
- `CLAUDE.md`: Claude-specific working notes.
- `package.json`: VS Code extension metadata, scripts, and defaults.
- `src/server.js`: local bridge HTTP server.
- `src/proxy.js`: Anthropic request forwarding.
- `src/runner/run.js`: main runner loop.
- `src/runner/model-client.js`: local `/v1/messages` client.
- `src/runner/tool-registry.js`: runner tool dispatch.
- `src/runner/permissions.js`: allow/ask/deny policy.
- `src/runner/safety.js`: path confinement, deny matrix, environment scrubbing, and secret redaction.
- `bin/local-bridge-runner.js`: runner command-line entrypoint.
- `bin/local-bridge-archive.js`: local runner archive browser/importer.

## Checks

Use targeted checks while working, then run the broader checks before handoff when practical:

```bash
npm test
npm run lint
npm run check:docs
npm run format:check
```

For runner-only work:

```bash
node --require ./test/setup.js --test test/runner/*.test.js
```

## Handoff

End every task with:

- Folder and branch used.
- Files changed.
- Tests/checks run.
- Any checks skipped and why.
- Risks or follow-up work.

Do not claim something is pushed unless `git push` actually succeeded.

## Cursor Cloud specific instructions

This section is for Cloud Agents running in a headless Linux VM (not Alan's Mac). Dependencies
(`npm install`) are already refreshed on startup, so do not repeat install steps here.

- This is a pure Node.js project (Node 22 in the VM). Standard checks already documented above work
  as-is: `npm run lint`, `npm run check:docs`, and `npm test`.
- `npm run format:check` reports pre-existing Prettier style warnings on `package.json` and
  `package-lock.json`. That failure is unrelated to your changes; do not reformat those files just to
  make it pass unless the task is about formatting.
- `npm test` has one environment-dependent failure on Linux: the bash-tool test
  `reports signal when process is killed` (`test/runner/bash.test.js`). On this VM a `bash -c` wrapper
  reports SIGABRT as exit code 134 instead of surfacing `killed by signal`, so the assertion fails.
  All other 478 tests pass. Treat this single failure as a known platform difference, not a regression.
- The **bridge** (`src/server.js`) is a VS Code extension (`require('vscode')`) and cannot be started
  standalone outside VS Code. Live model calls also need real Claude Code OAuth credentials, which are
  not present in the cloud VM, so a true end-to-end run against `api.anthropic.com` is not possible here.
- To exercise the **runner** agent loop end-to-end without OAuth, point it at a local mock that speaks
  the Anthropic Messages format via `--bridge-url http://127.0.0.1:<port>/v1/messages`. The runner
  buffers full JSON responses by default (`modelClient.post`), expecting `content`, `stop_reason`, and
  `usage`; return a `tool_use` block (e.g. `list_files`) on the first turn and a final `text` block on
  the next. This runs the real loop and real local tool execution against `--cwd`.
- In non-interactive/headless mode the runner requires `--trust-workspace` (otherwise it stops with
  `workspace_not_trusted`). Add `--allow-shell` / `--accept-edits` / `--dont-ask` only when the task
  needs them, consistent with the runner safety rules above.

## Learned User Preferences

- Treat `docs/command-builder.html` as the primary day-to-day runner UX; keep it lean, and update it when runner CLI flags or capabilities change.
- Prefer compact in-UI explanations for runner flags (hover/"what does this do"/glossary) over relying on long docs alone; Alan learns mainly by doing.
- When drafting multi-step plans for this repo, write them as HTML rather than Markdown.
- When resolving mutually exclusive or risky command-builder choices, grey out or warn without resetting unrelated toggles the user already set.
- Prefer strengthening runner plan-mode so plans are usable without Alan manually spelling out every proposed step; skip a separate HTML plan doc on an implementation turn when he says to.
- Creative expansion beyond a written slice is welcome when it stays inside minimalism and deterministic-control invariants.
- After a runtime slice lands, prefer keep-building over a broad docs refresh unless Alan asks for docs or CLI/behavior changed enough to require it.
- At P0/P1 chunk stop points, prefer annotated concordance/roadmap updates plus a dedicated agent-facing handoff (not only chat summary); commit/push/sync when he asks in the same turn.

## Learned Workspace Facts

- A sibling Codex lab lives at `/Users/alanman/Developer/codex-local-bridge-playground`; keep that work separate from this Claude playground unless Alan explicitly asks to cross-apply.
- Local runner session artifacts often live under `~/.bridge-runner`; prefer a unified transcript/index layout when changing logging rather than inventing a second parallel scheme.
- Runtime concordance / P0–P1 remediation status is tracked in dated docs under `docs/` (assessment HTML plus agent-facing handoffs); annotate those when closing items rather than inventing a parallel tracker.
