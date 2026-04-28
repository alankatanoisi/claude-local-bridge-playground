# Claude Local Bridge

A VS Code extension that reads your **Claude Code** credentials and exposes them as a local HTTP server on `http://localhost:11437`, compatible with both the **Anthropic Messages API** and **OpenAI-compatible `/v1` clients**.

Use Claude CLI with `http://localhost:11437`, and point OpenAI-style tools to `http://localhost:11437/v1` — the bridge injects your real Claude credentials so no separate Anthropic API key is needed.

---

## Defaults at a glance

Defaults below are sourced from `package.json` (`contributes.configuration.properties`).

| Setting                              | Default (from package.json) | Notes                                            |
| ------------------------------------ | --------------------------- | ------------------------------------------------ |
| `claudeLocalBridge.port`             | `11437`                     | Local bridge listens on `http://localhost:11437` |
| `claudeLocalBridge.defaultModel`     | `claude-sonnet-4-5`         | Used when requests omit `model`                  |
| `claudeLocalBridge.anthropicBaseUrl` | `https://api.anthropic.com` | Upstream Anthropic endpoint                      |
| `claudeLocalBridge.logRequests`      | `false`                     | Verbose request/response logging                 |
| `claudeLocalBridge.apiKey`           | `""`                        | Manual fallback key (lowest priority)            |
| `claudeLocalBridge.requireCallerAuth` | `true`                     | Requires `Authorization: Bearer <token>` on API routes |
| `claudeLocalBridge.callerAuthToken`   | `""`                       | Optional static caller token (otherwise auto-generated) |

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

| Setting                              | Default                     | Description                               |
| ------------------------------------ | --------------------------- | ----------------------------------------- |
| `claudeLocalBridge.port`             | `11437`                     | HTTP server port                          |
| `claudeLocalBridge.anthropicBaseUrl` | `https://api.anthropic.com` | Override for staging                      |
| `claudeLocalBridge.apiKey`           | `""`                        | Manual API key (lowest priority)          |
| `claudeLocalBridge.defaultModel`     | `claude-sonnet-4-5`         | Default model when none is specified      |
| `claudeLocalBridge.logRequests`      | `false`                     | Verbose request logging to Output channel |
| `claudeLocalBridge.requireCallerAuth` | `true`                     | Enforce Bearer token for incoming callers |
| `claudeLocalBridge.callerAuthToken`   | `""`                       | Static Bearer token override              |

### Caller auth (important)

By default, bridge endpoints require:

```http
Authorization: Bearer <your-caller-token>
```

`GET /v1/debug` is the only unauthenticated endpoint. For predictable client setup, set `claudeLocalBridge.callerAuthToken` in VS Code settings and reuse that token in your callers.

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
