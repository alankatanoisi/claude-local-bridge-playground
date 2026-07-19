# CLAUDE.md

Claude-specific instructions for this repository. Read `AGENTS.md` first; it contains the shared beginner-first workflow and safety rules.

## Which Clone Is This?

Run `pwd` before assuming:

| Path ends with                   | This clone     | GitHub                                                                                            | Expected branch |
| -------------------------------- | -------------- | ------------------------------------------------------------------------------------------------- | --------------- |
| `claude-local-bridge-playground` | **Playground** | [claude-local-bridge-playground](https://github.com/alankatanoisi/claude-local-bridge-playground) | `main`          |
| `claude-local-bridge`            | **Canonical**  | [claude-local-bridge](https://github.com/alankatanoisi/claude-local-bridge)                       | reference-only  |

If you are in playground, commits belong to the playground repo on `main`. Do not open or continue canonical repo pull requests unless Alan explicitly asks. A pull request is a GitHub request to merge one branch into another; this repo normally works directly on playground `main`.

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

## Human Context

Alan is using agents to learn and build. He is a strong systems thinker, highly curious, and enthusiastic about learning, but a true novice at programming and terminal workflows. It is correct to treat him as if he does not understand usual programmer conventions. Default to over-explaining, not under-explaining.

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

## Project Overview

Claude Local Bridge is the transport shim: a VS Code extension that exposes Claude Code credentials through a local HTTP
API on `localhost:11437`.

The runner is an experimental local coding-agent loop on top of that bridge:

```text
prompt -> local bridge /v1/messages -> model response -> tool_use -> local tool execution -> tool_result -> repeat
```

The bridge owns OAuth, keychain, interceptor, and proxy behavior. The runner owns the part we are actively evolving:
the local agent loop, capability groups, permissions, prompts, profiles, transcripts, archives, and command-line user
experience.

## Architecture Boundary

Claude Local Bridge has two layers:

- Bridge layer: VS Code extension, local HTTP server, OAuth/keychain/interceptor/proxy behavior. Treat this as transport
  plumbing unless Alan asks for bridge work.
- Runner layer: local CLI agent loop, capability groups, prompts, templates, profiles, permissions, transcripts,
  archives, readable logs, docs, and command builder. Treat this as the active product surface.

## Current Direction

The playground is an Anthropic-native **cc bridge runner lab**. The current goal is to make the runner simpler,
smaller by default, and easier to extend through project-local primitives. The bridge keeps model transport available,
but subsequent work should not overfocus on OAuth/interceptor/proxy internals.

Design direction:

- Minimal default prompt and minimal startup context.
- Explicit opt-ins for instruction docs, repo maps, skills, shell, and advanced patch mode.
- Customization through `.bridge-runner/` files, prompt templates, profiles, hooks, and command-builder presets.
- Capability groups over large flat tool menus.

Transport invariants:

- Keep the native Anthropic Messages route: `POST /v1/messages`.
- Do not restore OpenAI-compatible routes such as `/v1/chat/completions` or `/v1/models`.
- Do not restore Anthropic Console API-key fallback paths (no upstream `ANTHROPIC_API_KEY` fallback).
- Do not add or restore `claudeLocalBridge.apiKey` as an upstream credential source.
- Upstream model calls should use Claude Code OAuth Bearer credentials only.
- Dummy API-key strings such as `local` are only local client placeholders; they must not be forwarded upstream as `x-api-key` or become upstream Anthropic auth.
- Do not capture or replay upstream `x-api-key` credentials as a success path.
- Keep debug, trace, transcript, and log surfaces redacted because OAuth tokens and fingerprints are sensitive local account state.
- Document policy risk plainly when transport/auth behavior is relevant: this is personal research, not proof of Anthropic approval.

For Anthropic API, Claude Code, billing, or policy facts, use official sources first: `docs.anthropic.com`,
`code.claude.com/docs`, `support.claude.com`, and official `github.com/anthropics/*` repositories. Make use of the
anthropic-platform-expert and/or anthropic-official skills to provide accurate and up-to-date information.

Do not modify bridge/auth/proxy internals unless explicitly requested or clearly needed to keep runner transport
working:

- `src/credentials.js`
- `src/proxy.js`
- `src/server.js`
- `src/interceptors/**`

Runner tasks should usually stay in:

- `bin/local-bridge-runner.js`
- `src/runner/**`
- `test/runner/**`
- `docs/**`
- `README.md`

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

## Safety Rules

Keep these invariants:

- Shell is hidden unless `--allow-shell` is set.
- `--dont-ask` must not enable shell by itself.
- Block `.env`, private keys, credential JSON, token files, `.ssh`, `.aws`, `.claude`, and path escapes.
- Write tools ask for confirmation unless `--accept-edits` is set.
- Tool output, transcripts, and human logs redact secrets. Target invariant: raw assistant text on stdout and
  `--json`/`--stream-json` events must also pass through one central redaction boundary — this is currently an
  open gap (P0-11); do not claim stream output is redacted until it lands. See
  `docs/runner-p0-10-12-agent-handoff-2026-07-18.md`.
- `--cwd` means the target project folder the tools operate inside.

## Checks

Run relevant targeted tests first, then the standard checks before handoff:

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

## Active P0 Work

Open runtime-concordance items P0-10 (root-change cache integrity), P0-11 (centralized redaction boundary), and
P0-12 (private-by-construction artifacts) are tracked in `docs/runner-p0-10-12-agent-handoff-2026-07-18.md`
(execution order A: P0-10, B: P0-12, C: P0-11 — one item per session). Human-readable review:
`docs/runner-p0-10-12-review-2026-07-18.html`. Annotate
`docs/runner-runtime-concordance-assessment-2026-07-17.html` when closing items.

## Docs To Keep Updated

When changing runner behavior or CLI options, update:

- `README.md`
- `docs/runner-quickstart.html`
- `docs/command-builder.html`
- `docs/threat-model.md` when safety behavior changes

## Handoff

Always end with:

- Folder and branch used.
- Files changed.
- Tests/checks run.
- Anything skipped.
- Risks or next steps.

Do not claim something is pushed unless `git push` actually succeeded.
