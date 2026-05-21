# CLAUDE.md

Claude-specific instructions for this repository. For the full shared agent guide, read `AGENTS.md` first.

## Start Here

This worktree is the canonical clean runner branch:

```bash
/Users/alanman/.codex/worktrees/runner-clean-pr
```

Expected branch:

```bash
codex/runner-clean-pr
```

The old prototype repo is historical reference only:

```bash
/Users/alanman/Library/Mobile Documents/com~apple~CloudDocs/Documents/GitHub/claude-local-bridge-runner-test
```

Do not implement in the old prototype folder unless Alan explicitly asks.

## Human Context

Alan is a beginner at programming and terminal workflows. Be clear and concrete. When you give commands, say where they should be run and what success looks like. Use plain explanations for Git, Terminal, branch, commit, push, and test output.

## Architecture Boundary

Claude Local Bridge has two layers:

- Bridge layer: VS Code extension, local HTTP server, OAuth/keychain/interceptor/proxy behavior.
- Runner layer: local CLI agent loop, tools, permissions, transcripts, readable logs, docs, command builder.

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
