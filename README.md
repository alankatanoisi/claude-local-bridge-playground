# Claude Local Bridge

A VS Code extension that reads your **Claude Code** credentials and exposes them as a local HTTP server on `localhost:11436`, compatible with both the **Anthropic Messages API** and the **OpenAI Chat Completions API**.

Point any LLM tool at `http://localhost:11436` and it will transparently use your Claude Pro/Max subscription — no separate API key required.

---

## How it works

```
Your tool  →  localhost:11436  →  reads Claude Code credentials  →  api.anthropic.com
```

The extension discovers your credentials automatically (see priority order below), injects the auth header, and pipes the response straight back — with true streaming support and no extra buffering.

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

| Setting                              | Default                     | Description                               |
| ------------------------------------ | --------------------------- | ----------------------------------------- |
| `claudeLocalBridge.port`             | `11436`                     | HTTP server port                          |
| `claudeLocalBridge.anthropicBaseUrl` | `https://api.anthropic.com` | Override for staging                      |
| `claudeLocalBridge.apiKey`           | `""`                        | Manual API key (lowest priority)          |
| `claudeLocalBridge.defaultModel`     | `claude-sonnet-4-5`         | Default model when none is specified      |
| `claudeLocalBridge.logRequests`      | `false`                     | Verbose request logging to Output channel |

---

## Using with Claude Code CLI

Set `ANTHROPIC_BASE_URL` to point Claude Code at your local bridge:

```bash
export ANTHROPIC_BASE_URL=http://localhost:11436
export ANTHROPIC_API_KEY=local  # required by the CLI, value is ignored

claude
```

The Claude Code CLI will route its requests through the bridge, which injects your real credentials.

## Using with Continue.dev / Cursor / other tools

Point the provider at:

- **Base URL**: `http://localhost:11436`
- **API Key**: anything (e.g. `local`) — the bridge ignores the incoming key and uses its own credentials
- **Model**: any Claude model name (e.g. `claude-sonnet-4-5`)

---

## OAuth Token Expiry

Claude Code OAuth tokens expire periodically. The bridge will:

1. Return a `401` to the caller if the token has expired
2. Clear its credential cache automatically
3. Retry once with freshly discovered credentials

If the retry also fails, run `claude /login` (or simply open Claude Code) — the CLI will refresh the token, which the bridge will pick up on the next request.

---

## Status Bar

The extension shows a status bar item: `📡 Claude Bridge :11436 [keychain]`

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
```

Press `F5` in VS Code to launch an Extension Development Host.
