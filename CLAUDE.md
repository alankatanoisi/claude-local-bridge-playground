# CLAUDE.md

Claude-specific instructions for this repository. For the full shared agent guide, read `AGENTS.md` first — especially **Human Context** and [`lab-notes/ALAN_OPERATOR_PROFILE.md`](lab-notes/ALAN_OPERATOR_PROFILE.md) (Alan is a novice; over-explain by default).

## Which clone is this?

Run `pwd` before assuming:

| Path ends with                   | This clone     | GitHub                                                                                            | Expected branch         |
| -------------------------------- | -------------- | ------------------------------------------------------------------------------------------------- | ----------------------- |
| `claude-local-bridge-playground` | **Playground** | [claude-local-bridge-playground](https://github.com/alankatanoisi/claude-local-bridge-playground) | `main`                  |
| `claude-local-bridge`            | **Canonical**  | [claude-local-bridge](https://github.com/alankatanoisi/claude-local-bridge)                       | `codex/runner-clean-pr` |

If you are in **playground**, PRs go to the playground repo only — see `lab-notes/PLAYGROUND_PR_POLICY.md`.

## Human Context

Alan is a beginner at programming and terminal workflows. **It is correct to treat him as if he does not understand usual programmer stuff.** Better safe than sorry:

- Say where each command runs (Terminal vs VS Code vs browser).
- Say what success looks like in plain language.
- Explain Git words (commit, push, branch, merge) when you use them.
- Never assume he knows which app or folder a step belongs in.

## Architecture Boundary

Claude Local Bridge has two layers:

- Bridge layer: VS Code extension, local HTTP server, OAuth/keychain/interceptor/proxy behavior.
- Runner layer: local CLI agent loop, tools, permissions, transcripts, readable logs, docs, command builder.

## Current Research Direction

The playground is currently an **OAuth-only evidence harness**. Do not restore Anthropic Console API-key fallback paths.
Upstream model calls should use Claude Code OAuth Bearer credentials only: live intercepted Bearer token,
`CLAUDE_CODE_OAUTH_TOKEN`, macOS Keychain, or `~/.claude/.credentials.json`.

Dummy API-key strings such as `local` are only local client placeholders for tools that require a field. They must not be
forwarded upstream as `x-api-key`.

Do not modify bridge/auth/proxy internals unless explicitly requested:

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
npx prettier --check <touched files>
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
- `OPENCODE.md` when startup or multi-agent workflow changes

## Handoff

Always end with:

- Folder and branch used.
- Files changed.
- Tests/checks run.
- Anything skipped.
- Risks or next steps.
