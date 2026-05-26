# Claude Local Bridge

> **This is the active repository** ([claude-local-bridge-playground](https://github.com/alankatanoisi/claude-local-bridge-playground), branch **`main`**). Canonical [claude-local-bridge](https://github.com/alankatanoisi/claude-local-bridge) is archived (tags `archive-2026-05-main` and `archive-2026-05-runner-clean-pr`); do not open new PRs there.

A VS Code extension that reads your **Claude Code OAuth credentials** and exposes them as a local HTTP server on `http://localhost:11437`, compatible with both the **Anthropic Messages API** and **OpenAI-compatible `/v1` clients**.

Use Claude CLI with `http://localhost:11437`, and point OpenAI-style tools to `http://localhost:11437/v1` — the bridge injects your Claude Code OAuth token so no Anthropic Console API key is used upstream.

## Current Direction: OAuth-Only Policy Evidence Harness

This playground is now intentionally **OAuth-only**. The project goal is to test and document whether a user’s own Claude Code OAuth session can still carry local bridge/runner traffic in light of Anthropic’s June 15, 2026 Agent SDK / `claude -p` metering change. Anthropic’s current help page says Agent SDK and `claude -p` usage will move to a separate monthly Agent SDK credit, while interactive Claude Code remains on subscription limits.

To keep the evidence clean:

- The bridge ignores `ANTHROPIC_API_KEY`.
- The bridge ignores the old `claudeLocalBridge.apiKey` setting.
- The bridge ignores intercepted `x-api-key` credentials.
- Upstream auth must be `authorization: Bearer <Claude Code OAuth token>`.
- Dummy client keys such as `local` are allowed only because some OpenAI-compatible clients require a local placeholder; they are not forwarded to Anthropic.

This does **not** mean Anthropic has approved this usage. Treat runs as policy-sensitive personal research, not production guidance or a commercial integration pattern.

For the local CLI runner prototype that now ships in this repo, see [docs/runner-quickstart.html](./docs/runner-quickstart.html).
The runner can inspect this repo or any other local project by passing that project as `--cwd`.
For fresh OpenCode sessions, start with [OPENCODE.md](./OPENCODE.md).
If you are new to Terminal or this repo, start with [BEGINNER_GUIDE.md](./BEGINNER_GUIDE.md) and then
[HEADLESS_AGENT_RUNNER_BEGINNER_GUIDE.md](./HEADLESS_AGENT_RUNNER_BEGINNER_GUIDE.md).

## Repository lanes (read this first)

| Lane                       | Local folder                                 | GitHub                                                                                            | Branch                  | Use for                                     |
| -------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------- |
| **Playground (this repo — active)** | `~/Developer/claude-local-bridge-playground` | [claude-local-bridge-playground](https://github.com/alankatanoisi/claude-local-bridge-playground) | `main` | All harness and runner work |
| **Canonical (archived)**            | `~/Developer/claude-local-bridge`            | [claude-local-bridge](https://github.com/alankatanoisi/claude-local-bridge)                       | frozen at `archive-2026-05-*` tags | Codex reference only; local folder kept for Codex |

- Playground PRs and commits belong in **this** GitHub repo only — see [lab-notes/ACTIVE_WORKTREE.md](./lab-notes/ACTIVE_WORKTREE.md) and [lab-notes/PLAYGROUND_PR_POLICY.md](./lab-notes/PLAYGROUND_PR_POLICY.md).
- Canonical repo is **archived on GitHub** after you confirm; `codex/runner-clean-pr` promotion is paused until you deliberately unarchive.
- Historical promotion ritual (if ever needed again): [lab-notes/PROMOTION_RITUAL.md](./lab-notes/PROMOTION_RITUAL.md).

Before edits, agents should sanity-check the lane:

```bash
pwd
git branch --show-current
git remote -v
git status --short
```

Success in this playground repo means the folder ends with `claude-local-bridge-playground`, the branch is `main`,
`origin` points at `alankatanoisi/claude-local-bridge-playground`, and there are no unexpected dirty source files.

iCloud checkout: reference-only, not for active runner work.

---

## Defaults at a glance

Defaults below are sourced from `package.json` (`contributes.configuration.properties`).

| Setting                               | Default (from package.json) | Notes                                            |
| ------------------------------------- | --------------------------- | ------------------------------------------------ |
| `claudeLocalBridge.port`              | `11437`                     | Local bridge listens on `http://localhost:11437` |
| `claudeLocalBridge.defaultModel`      | `claude-sonnet-4-5`         | Used when requests omit `model`                  |
| `claudeLocalBridge.anthropicBaseUrl`  | `https://api.anthropic.com` | Upstream Anthropic endpoint                      |
| `claudeLocalBridge.logRequests`       | `false`                     | Verbose request/response logging                 |
| `claudeLocalBridge.requireCallerAuth` | `false`                     | Optional local Bearer-token gate for API routes  |
| `claudeLocalBridge.callerAuthToken`   | `""`                        | Optional static caller token                     |

---

## How it works

### Architecture flow

```
Claude CLI (Anthropic format) ─┐
OpenAI-compatible tools (/v1) ─┼─> Claude Local Bridge (http://localhost:11437)
                               │      ↓ credential discovery
                               │      ↓ request normalization / passthrough
                               └──> api.anthropic.com
```

The extension discovers credentials automatically (see priority order below), injects the auth header, and streams upstream responses back to callers.

---

## Credential Discovery (OAuth-Only Priority Order)

| #   | Source                                       | Notes                                                                          |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------ |
| 1   | Live intercepted Claude Code Bearer token    | Captured from Claude Code traffic inside this VS Code process or capture proxy |
| 2   | `CLAUDE_CODE_OAUTH_TOKEN` env var            | Long-lived OAuth token from `claude setup-token`                               |
| 3   | **macOS Keychain** `Claude Code-credentials` | Automatically set when you log in via `claude /login`                          |
| 4   | `~/.claude/.credentials.json`                | Linux / Windows fallback; also macOS if keychain is locked                     |

On macOS with Claude Code installed, **Priority 3 is used automatically** if no fresher live intercepted Bearer token exists.

---

## Supported Endpoints

| Endpoint                         | Format           | Notes                                                  |
| -------------------------------- | ---------------- | ------------------------------------------------------ |
| `GET /v1/models`                 | OpenAI           | Lists available Claude models                          |
| `POST /v1/messages`              | Anthropic native | Proxied verbatim to api.anthropic.com                  |
| `POST /v1/messages/count_tokens` | Anthropic        | Mock response (returns 0) for Claude CLI preflight     |
| `POST /v1/chat/completions`      | OpenAI           | Full conversion: OpenAI ↔ Anthropic, streaming + tools |
| `GET /v1/debug`                  | JSON             | Locked diagnostic endpoint; requires local debug token |

---

## Configuration

Open **VS Code Settings** and search for `Claude Local Bridge`:

| Setting                               | Default                     | Description                               |
| ------------------------------------- | --------------------------- | ----------------------------------------- |
| `claudeLocalBridge.port`              | `11437`                     | HTTP server port                          |
| `claudeLocalBridge.anthropicBaseUrl`  | `https://api.anthropic.com` | Override for staging                      |
| `claudeLocalBridge.defaultModel`      | `claude-sonnet-4-5`         | Default model when none is specified      |
| `claudeLocalBridge.logRequests`       | `false`                     | Verbose request logging to Output channel |
| `claudeLocalBridge.requireCallerAuth` | `false`                     | Enforce Bearer token for incoming callers |
| `claudeLocalBridge.callerAuthToken`   | `""`                        | Static Bearer token override              |

### Caller auth (optional)

By default, bridge endpoints do not require a second local caller token. This keeps local curl and runner usage simple.

If you enable `claudeLocalBridge.requireCallerAuth`, bridge endpoints require:

```http
Authorization: Bearer <your-caller-token>
```

When caller auth is enabled, normal API endpoints require the caller token. Debug endpoints still use the separate
debug-token header described below.

### Debug endpoint token

`/v1/debug` and any future `/v1/debug/*` endpoints require a separate local debug token printed in the **Claude Local Bridge** VS Code Output log:

```http
x-claude-local-bridge-debug-token: <token from Output log>
```

That token is only a local diagnostic door code. It is not your Claude OAuth token.

---

## Base URL patterns by client type

- **Claude CLI (Anthropic API client):** `http://localhost:11437` (no `/v1` suffix in `ANTHROPIC_BASE_URL`)
- **OpenAI-compatible clients:** `http://localhost:11437/v1`

---

## Using with Claude Code CLI

Set `ANTHROPIC_BASE_URL` to the bridge root (no `/v1`):

```bash
export ANTHROPIC_BASE_URL=http://localhost:11437
export ANTHROPIC_API_KEY=local  # dummy value for local client env checks; not forwarded upstream

claude
```

The Claude Code CLI routes requests through the bridge, which injects the resolved OAuth Bearer token.

## Local Bridge Runner

The runner is an experimental local coding-agent loop that uses this bridge as its model transport. Run it from the
folder that contains `bin/local-bridge-runner.js`:

```bash
cd "/Users/alanman/Developer/claude-local-bridge-playground"
node bin/local-bridge-runner.js "List the files in this repo and summarize what it does."
```

To test a different local folder, keep running the runner from this repo and point the tools at the other project with
`--cwd`:

```bash
cd "/Users/alanman/Developer/claude-local-bridge-playground"
node bin/local-bridge-runner.js \
  --cwd "/Users/alanman/path/to/another/project" \
  --verbose \
  "List the top-level files, summarize the project, then stop. Do not edit files."
```

**Startup context (default: minimal).** By default the runner does **not** inject `AGENTS.md`, `CLAUDE.md`,
`OPENCODE.md`, repo maps, or skills into the system prompt. Use `--include-instruction-docs`, `--include-repo-context`,
`--include-repo-map`, `--include-skills`, or `--agent project` when you want richer project context. `--bare` forces the
smallest prompt. The bridge may still prepend Claude Code OAuth identity blocks upstream (unchanged in this pass).

Useful runner options:

| Option                   | Purpose                                                                |
| ------------------------ | ---------------------------------------------------------------------- |
| `--cwd <path>`           | Target project folder the tools can inspect or edit                    |
| `--bare`                 | Minimal context: no instruction docs, repo block, or skills          |
| `--include-instruction-docs` | Opt in to AGENTS.md / CLAUDE.md / OPENCODE.md hierarchy            |
| `--include-repo-context` | Opt in to session repo-context block (cwd/git fingerprint)           |
| `--include-claude-md`    | Include CLAUDE.md in repo-context (needs `--include-repo-context`)     |
| `--include-repo-map`     | Opt in to repo map inside repo-context                                 |
| `--include-skills`       | Opt in to skills listing in the system prompt                          |
| `--agent <profile>`      | Runner personality: explore, plan, implement, project, …               |
| `--list-agents`          | List built-in personalities and exit                                   |
| `--permission-mode <m>`  | default, plan, accept-edits, dont-ask, accept-edits-dont-ask, auto     |
| `--tools <list>`         | Expose only these tools (alias: `--allowed-tools`)                     |
| `--append-system-prompt` / `--append-system-prompt-file` | Add text after the default system prompt |
| `--system-prompt-file`   | Replace default system prompt with a file                              |
| `--exclude-dynamic-system-prompt-sections` | Put cwd/git fingerprint in the first user message instead |
| `--no-session-persistence` | Skip writing session checkpoints under ~/.bridge-runner/sessions/    |
| `--allowed-tools <list>` | Same as `--tools` (legacy name)                                        |
| `--include-file <path>`  | Attach a bounded file from `--cwd` before the model call               |
| `--human-log <path>`     | Write a plain text log of the prompt, tool results, and final answer   |
| `--trace-level <level>`  | Write correlated flight-recorder traces: summary, redacted, or full    |
| `--trace-path <path>`    | Choose the runner trace JSONL path; bridge trace path is correlated    |
| `--caller-token <token>` | Local bridge caller-auth token; can also use `BRIDGE_CALLER_TOKEN` env |
| `--plan`                 | Plan mode: describe actions instead of executing them                  |
| `--no-network`           | Best-effort HTTP/HTTPS proxy guard for shell, not a network sandbox    |
| `--system-prompt <s>`    | Override the default system prompt                                     |
| `--continue`             | Resume from the latest transcript in ~/.bridge-runner/logs/            |
| `--stream`               | Stream assistant text live while still preserving streamed tool inputs |
| `--accept-edits`         | Auto-approve edit/write tools                                          |
| `--allow-shell`          | Expose the bash tool; hidden by default                                |
| `--no-archive`           | Skip per-turn archive export to `~/.bridge-runner/archive/`            |

Open [docs/command-builder.html](./docs/command-builder.html) in your browser if you prefer a form that builds these
commands for you. A conservative first run is read-only or `--plan`; use `--accept-edits` only when file changes are
intended, and add `--allow-shell` only when the runner needs commands such as tests.

### Runner flight recorder

Pass `--trace-level summary` when you need a local audit trail of one runner call without writing prompt bodies. It
records runner turns, local tool decisions, Anthropic usage and cache counters returned to the runner, bridge request
boundaries, forwarded header names, and upstream status metadata. The correlated files default to
`~/.bridge-runner/traces/*.runner.jsonl` and `~/.claude-local-bridge/traces/*.bridge.jsonl`.

`redacted` adds scrubbed request, response, tool-input, and tool-result payloads. `full` keeps the broadest local payload
evidence while still redacting authorization and key-looking fields. Neither mode reveals Anthropic's internal
classification logic or server-side telemetry; it records what this local runner and bridge can observe at their own
boundaries. Treat redacted and full traces as sensitive source-code logs.

The runner sends correlation headers to the bridge automatically. For a direct Anthropic `/v1/messages` bridge client,
either set the VS Code setting `claudeLocalBridge.traceLevel` or send `x-local-bridge-trace-level: summary` with an
authenticated local request.

### Runner archive (per-turn JSON)

After each run, the runner writes a searchable archive under `~/.bridge-runner/archive/` (one folder per `runId`, per-turn JSON files, and a catalog index). This is in addition to the JSONL transcript in `~/.bridge-runner/logs/`.

- **Browse:** `node bin/local-bridge-archive.js list`
- **Import old logs:** `node bin/local-bridge-archive.js ingest-legacy`
- **Disable:** `--no-archive` or `BRIDGE_RUNNER_ARCHIVE=0`

See [lab-notes/RUNNER_ARCHIVE.md](./lab-notes/RUNNER_ARCHIVE.md) for the full layout. Complementary perf observability: [lab-notes/PERF_PARITY_HANDOFF.md](./lab-notes/PERF_PARITY_HANDOFF.md).

### Runner perf parity (prompt cache, file cache, shell)

- **Prompt cache:** Automatic on every model request (system + tools + stable message prefix breakpoints).
- **File cache:** In-memory LRU for `read_file` (invalidates on file change).
- **Persistent shell:** Opt-in only — `BRIDGE_RUNNER_PERSISTENT_SHELL=1` (default stays spawn-per-command).
- **Bench:** `node --require ./test/setup.js test/runner/bench/turn-latency.bench.js`

## Using with third-party OpenAI-compatible tools

For tools like Continue.dev, Cursor, Cline/Roo, Aider, Open WebUI, Cherry Studio, or LiteLLM:

- **Base URL:** `http://localhost:11437/v1`
- **API Key:** any placeholder required by the local client (for example `local`); never put an Anthropic Console key here for this experiment
- **Model:** any supported Claude model (for example `claude-sonnet-4-5`)

Example (Aider):

```bash
aider --model claude-sonnet-4-5 --openai-api-base http://localhost:11437/v1 --openai-api-key local
```

Example (OpenCode provider config):

```json
{
  "provider": {
    "claude-bridge": {
      "npm": "@ai-sdk/openai",
      "options": {
        "baseURL": "http://localhost:11437/v1"
      }
    }
  }
}
```

---

## OAuth Token Expiry

Claude Code OAuth tokens expire periodically. The bridge will:

1. Return a `401` to the caller if the token has expired
2. Clear its credential cache automatically
3. Retry once with freshly discovered credentials

If the retry also fails, run `claude /login` (or open Claude Code) so the token refreshes.

---

## Status Bar

The extension shows a status bar item: `📡 Claude Bridge :11437 [keychain]`

Click it to see the current credential source and server status.

---

## Commands

- `Claude Local Bridge: Start Server`
- `Claude Local Bridge: Stop Server`
- `Claude Local Bridge: Show Status`
- `Claude Local Bridge: Show Credential Source`

---

## Development

```bash
npm install
npm run format   # Prettier
npm run lint     # ESLint
npm test         # node:test suite
npm run check:docs
```

Press `F5` in VS Code to launch an Extension Development Host.
