# Claude Local Bridge

A VS Code extension that reads your **Claude Code** credentials and exposes them as a local HTTP server on `http://localhost:11437`, compatible with both the **Anthropic Messages API** and **OpenAI-compatible `/v1` clients**.

Use Claude CLI with `http://localhost:11437`, and point OpenAI-style tools to `http://localhost:11437/v1` — the bridge injects your real Claude credentials so no separate Anthropic API key is needed.

For the local CLI runner prototype that now ships in this repo, see [docs/runner-quickstart.html](./docs/runner-quickstart.html).
The runner can inspect this repo or any other local project by passing that project as `--cwd`.
For fresh OpenCode sessions, start with [OPENCODE.md](./OPENCODE.md).
If you are new to Terminal or this repo, start with [BEGINNER_GUIDE.md](./BEGINNER_GUIDE.md) and then
[HEADLESS_AGENT_RUNNER_BEGINNER_GUIDE.md](./HEADLESS_AGENT_RUNNER_BEGINNER_GUIDE.md).

---

## Defaults at a glance

Defaults below are sourced from `package.json` (`contributes.configuration.properties`).

| Setting                               | Default (from package.json) | Notes                                            |
| ------------------------------------- | --------------------------- | ------------------------------------------------ |
| `claudeLocalBridge.port`              | `11437`                     | Local bridge listens on `http://localhost:11437` |
| `claudeLocalBridge.defaultModel`      | `claude-sonnet-4-5`         | Used when requests omit `model`                  |
| `claudeLocalBridge.anthropicBaseUrl`  | `https://api.anthropic.com` | Upstream Anthropic endpoint                      |
| `claudeLocalBridge.logRequests`       | `false`                     | Verbose request/response logging                 |
| `claudeLocalBridge.apiKey`            | `""`                        | Manual fallback key (lowest priority)            |
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

## Credential Discovery (Priority Order)

| #   | Source                                       | Notes                                                      |
| --- | -------------------------------------------- | ---------------------------------------------------------- |
| 1   | `ANTHROPIC_API_KEY` env var                  | Standard Anthropic API key                                 |
| 2   | `CLAUDE_CODE_OAUTH_TOKEN` env var            | Long-lived token from `claude setup-token`                 |
| 3   | **macOS Keychain** `Claude Code-credentials` | Automatically set when you log in via `claude /login`      |
| 4   | `~/.claude/.credentials.json`                | Linux / Windows fallback; also macOS if keychain is locked |
| 5   | VS Code setting `claudeLocalBridge.apiKey`   | Manual fallback — set in VS Code settings                  |

On macOS with Claude Code installed, **Priority 3 is used automatically** — no configuration needed.

---

## Supported Endpoints

| Endpoint                         | Format           | Notes                                                  |
| -------------------------------- | ---------------- | ------------------------------------------------------ |
| `GET /v1/models`                 | OpenAI           | Lists available Claude models                          |
| `POST /v1/messages`              | Anthropic native | Proxied verbatim to api.anthropic.com                  |
| `POST /v1/messages/count_tokens` | Anthropic        | Mock response (returns 0) for Claude CLI preflight     |
| `POST /v1/chat/completions`      | OpenAI           | Full conversion: OpenAI ↔ Anthropic, streaming + tools |
| `GET /v1/debug`                  | JSON             | Status, credential source, authenticated flag          |

---

## Configuration

Open **VS Code Settings** and search for `Claude Local Bridge`:

| Setting                               | Default                     | Description                               |
| ------------------------------------- | --------------------------- | ----------------------------------------- |
| `claudeLocalBridge.port`              | `11437`                     | HTTP server port                          |
| `claudeLocalBridge.anthropicBaseUrl`  | `https://api.anthropic.com` | Override for staging                      |
| `claudeLocalBridge.apiKey`            | `""`                        | Manual API key (lowest priority)          |
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

When caller auth is enabled, `GET /v1/debug` is the only unauthenticated endpoint. For predictable client setup, set
`claudeLocalBridge.callerAuthToken` in VS Code settings and reuse that token in your callers.

---

## Base URL patterns by client type

- **Claude CLI (Anthropic API client):** `http://localhost:11437` (no `/v1` suffix in `ANTHROPIC_BASE_URL`)
- **OpenAI-compatible clients:** `http://localhost:11437/v1`

---

## Using with Claude Code CLI

Set `ANTHROPIC_BASE_URL` to the bridge root (no `/v1`):

```bash
export ANTHROPIC_BASE_URL=http://localhost:11437
export ANTHROPIC_API_KEY=local  # required by CLI env checks; value is ignored by bridge

claude
```

The Claude Code CLI routes requests through the bridge, which injects real credentials.

## Local Bridge Runner

The runner is an experimental local coding-agent loop that uses this bridge as its model transport. Run it from the
folder that contains `bin/local-bridge-runner.js`:

```bash
cd "/Users/alanman/.codex/worktrees/runner-clean-pr"
node bin/local-bridge-runner.js "List the files in this repo and summarize what it does."
```

To test a different local folder, keep running the runner from this repo and point the tools at the other project with
`--cwd`:

```bash
cd "/Users/alanman/.codex/worktrees/runner-clean-pr"
node bin/local-bridge-runner.js \
  --cwd "/Users/alanman/path/to/another/project" \
  --verbose \
  "List the top-level files, summarize the project, then stop. Do not edit files."
```

Useful runner options:

| Option                   | Purpose                                                                |
| ------------------------ | ---------------------------------------------------------------------- |
| `--cwd <path>`           | Target project folder the tools can inspect or edit                    |
| `--allowed-tools <list>` | Hide every tool except the comma-separated tools you name              |
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

## Using with third-party OpenAI-compatible tools

For tools like Continue.dev, Cursor, Cline/Roo, Aider, Open WebUI, Cherry Studio, or LiteLLM:

- **Base URL:** `http://localhost:11437/v1`
- **API Key:** any placeholder (for example `local`)
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
