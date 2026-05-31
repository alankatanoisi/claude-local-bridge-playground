# CLAUDE.md

Claude-specific instructions for this repository. Read `AGENTS.md` first; it contains the shared beginner-first workflow and safety rules.

## Which Clone Is This?

Run `pwd` before assuming:

| Path ends with                   | This clone     | GitHub                                                                                            | Expected branch |
| -------------------------------- | -------------- | ------------------------------------------------------------------------------------------------- | --------------- |
| `claude-local-bridge-playground` | **Playground** | [claude-local-bridge-playground](https://github.com/alankatanoisi/claude-local-bridge-playground) | `main`          |
| `claude-local-bridge`            | **Canonical**  | [claude-local-bridge](https://github.com/alankatanoisi/claude-local-bridge)                       | reference-only  |

If you are in playground, commits belong to the playground repo on `main`. Do not open or continue canonical repo pull requests unless Alan explicitly asks.

## Human Context

Alan is a beginner at programming and terminal workflows. It is correct to treat him as if he does not understand usual programmer conventions.

- Say where each command runs: Terminal, VS Code, browser, or another app.
- Say what success looks like in plain language.
- Explain Git words such as commit, push, branch, and merge when you use them.
- Never assume he knows which app or folder a step belongs in.

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
- Do not restore Anthropic Console API-key fallback paths.
- Upstream model calls should use Claude Code OAuth Bearer credentials only.
- Dummy API-key strings such as `local` are only local client placeholders and must not be forwarded upstream as `x-api-key`.

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

## Safety Rules

Keep these invariants:

- Shell is hidden unless `--allow-shell` is set.
- `--dont-ask` must not enable shell by itself.
- Block `.env`, private keys, credential JSON, token files, `.ssh`, `.aws`, `.claude`, and path escapes.
- Write tools ask for confirmation unless `--accept-edits` is set.
- Tool output, transcripts, JSON/stream-json output, and human logs redact secrets.
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
