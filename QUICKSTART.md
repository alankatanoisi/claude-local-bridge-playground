# Claude Local Bridge — Quick Start Commands

## Step 1: Verify the bridge is running

```bash
curl -s http://localhost:11437/v1/debug | python3 -m json.tool
```

Look for: `"authenticated": true`

---

## Step 1.5: Set caller auth token (required by default)

Bridge endpoints (except `/v1/debug`) require `Authorization: Bearer <token>`.
Set a static token once in VS Code settings:

```json
"claudeLocalBridge.callerAuthToken": "local-dev-token"
```

Then export it for terminal examples:

```bash
export BRIDGE_CALLER_TOKEN=local-dev-token
```

---

## Step 2: Test the bridge (single line, copy-paste friendly)

```bash
curl -s -X POST http://localhost:11437/v1/chat/completions -H "Content-Type: application/json" -H "Authorization: Bearer $BRIDGE_CALLER_TOKEN" -d '{"model":"claude-haiku-4-5","max_tokens":30,"messages":[{"role":"user","content":"say hi"}]}'
```

If this returns a response → bridge works.

---

## Step 3: If Step 2 fails — test token directly

```bash
node probe.js
```

This tests your OAuth token against multiple Anthropic endpoints and tells you which one works.

---

## Step 4: Point a tool at the bridge (URL pattern guide)

Use this rule to avoid misconfiguration:

- **Claude CLI (`ANTHROPIC_BASE_URL`)** → `http://localhost:11437` (**no** `/v1` suffix)
- **OpenAI-compatible tools** → `http://localhost:11437/v1`

### For Claude Code CLI:

Run these in your terminal (NOT inside Claude Code):

```bash
export ANTHROPIC_BASE_URL=http://localhost:11437
export ANTHROPIC_API_KEY=local
claude "what is 2+2?"
```

This tells Claude Code to route its requests through the bridge instead of directly to Anthropic.
The bridge ignores the incoming `local` API key and uses your real OAuth token from the macOS Keychain.

> **Note:** `ANTHROPIC_API_KEY=local` is a dummy value. Your OAuth setup is not affected.

### For OpenCode (add to `~/.config/opencode/opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "claude-bridge": {
      "npm": "@ai-sdk/openai",
      "name": "Claude Bridge",
      "options": {
        "baseURL": "http://localhost:11437/v1"
      },
      "models": {
        "claude-sonnet-4-5": { "name": "Claude Sonnet 4.5" },
        "claude-opus-4-5": { "name": "Claude Opus 4.5" },
        "claude-haiku-4-5": { "name": "Claude Haiku 4.5" }
      }
    }
  }
}
```

Then run `/connect` in OpenCode, search for "Claude Bridge", enter `local` as the API key, and select your model with `/models`.

---

## Other Compatible Tools

### IDE Extensions

**Continue.dev** (VS Code / JetBrains)

- Settings → Add Model → Custom → Base URL: `http://localhost:11437/v1`, API Key: `local`

**Cursor**

- Settings → Models → Add OpenAI-compatible provider → URL: `http://localhost:11437/v1`, API Key: `local`

**Cline / Roo Code** (VS Code)

- Settings → API Provider: OpenAI Compatible → Base URL: `http://localhost:11437/v1`, API Key: `local`

**Windsurf** (Codeium IDE)

- Settings → Custom Model → OpenAI endpoint: `http://localhost:11437/v1`

### CLI Tools

**Aider**

```bash
aider --model claude-sonnet-4-5 --openai-api-base http://localhost:11437/v1 --openai-api-key local
```

If your tool supports custom headers, add:

```http
Authorization: Bearer local-dev-token
```

**llm** (Simon Willison's CLI)

```bash
llm install llm-openai
llm keys set openai --value local
llm -m claude-sonnet-4-5 -o http://localhost:11437/v1 "your prompt"
```

### Desktop Apps

**Cherry Studio**

- Settings → Providers → Add → OpenAI Compatible → URL: `http://localhost:11437/v1`

**Chatbox**

- Settings → Model Provider: OpenAI Compatible → API Host: `http://localhost:11437/v1`

**Enchanted** (macOS)

- Settings → Custom OpenAI Server → URL: `http://localhost:11437/v1`

### Web UIs

**Open WebUI**

- Admin Panel → Settings → Connections → OpenAI API → URL: `http://localhost:11437/v1`, Key: `local`

### Proxy / Gateway

**LiteLLM**

```bash
pip install litellm
litellm --model openai/claude-sonnet-4-5 --api_base http://localhost:11437/v1 --api_key local
```
