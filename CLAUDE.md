# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

**Claude Local Bridge** is a VS Code extension that reads Claude Code credentials and exposes them as a local HTTP API server (on `localhost:11437` by default). It proxies requests to the Anthropic API, supporting both **Anthropic Messages API** and **OpenAI Chat Completions API** formats.

The extension allows any LLM tool (Claude CLI, Cursor, Continue.dev, etc.) to use your Claude Pro/Max subscription without needing a separate API key.

## Development Commands

```bash
# Install dependencies
npm install

# Formatting
npm run format       # Format with Prettier
npm run format:check # Check formatting without applying

# Linting
npm run lint         # Run ESLint
npm run lint:fix     # Fix linting issues

# Testing
npm test            # Run tests in test/ directory (using node:test)
```

**Test Development**: Tests use the built-in `node:test` module (no external test runner). The test setup file (`test/setup.js`) provides test utilities. Run individual test files with:

```bash
node --require ./test/setup.js --test test/specific.test.js
```

**Extension Development**: Press `F5` in VS Code to launch an Extension Development Host that loads the extension from the current codebase.

## Architecture

### Request Flow

```
Client Request
    ↓
HTTP Server (src/server.js) — listens on localhost:PORT
    ↓
Request Router — dispatches to handlers based on path/method
    ↓
Handler (OpenAI format, Anthropic format, models, debug)
    ↓
Credential Discovery (src/credentials.js)
    ↓
Proxy (src/proxy.js) — forwards to api.anthropic.com with auth headers
    ↓
Response Streaming — pipes response back to client
```

### Key Components

**Extension Lifecycle** (`src/extension.js`)

- Activates on VS Code startup (`onStartupFinished`)
- Registers VS Code commands and status bar item
- Installs HTTPS interceptor (must happen before Claude Code makes requests)
- Starts/stops the HTTP server

**HTTP Server** (`src/server.js`)

- Creates and manages the Node.js HTTP server
- Handles CORS for localhost origins only
- Routes requests to appropriate handlers
- Supported endpoints:
  - `GET /v1/models` → list available Claude models
  - `POST /v1/messages` → Anthropic Messages API (pass-through)
  - `POST /v1/messages/count_tokens` → mock response for CLI preflight
  - `POST /v1/chat/completions` → OpenAI Chat Completions (converted to Anthropic format)
  - `GET /v1/debug` → server status and credential source

**Credential Discovery** (`src/credentials.js`)

- Five-tier priority system (see README.md for full order)
- **Priority 0** (highest): Intercepted tokens from HTTPS requests (captured by interceptor)
- **Priority 1**: `ANTHROPIC_API_KEY` env var
- **Priority 2**: `CLAUDE_CODE_OAUTH_TOKEN` env var
- **Priority 3**: macOS Keychain (`Claude Code-credentials`)
- **Priority 4**: `~/.claude/.credentials.json` (Linux/Windows fallback)
- **Priority 5** (lowest): VS Code setting `claudeLocalBridge.apiKey`
- Includes caching (TTL configurable via context) and automatic invalidation on 401 responses

**HTTPS Interceptor** (`src/interceptors/https.js`)

- Patches `https.request()` globally to capture live tokens from Claude Code's outgoing requests
- Records intercepted host, port, token, and header type
- Highest priority credential source — always up-to-date, auto-refreshes on token rotation
- Installed/uninstalled during extension lifecycle

**Request Handlers** (`src/handlers/`)

- `anthropic.js`: Handles `/v1/messages` and `/v1/messages/count_tokens`
- `openai.js`: Converts OpenAI Chat Completions format to Anthropic format, handles streaming/tools
- `models.js`: Returns list of available Claude models
- `debug.js`: Returns server status and credential source

**Proxy Core** (`src/proxy.js`)

- `proxyToAnthropic()`: Forwards request to api.anthropic.com with auth headers
- Streaming support: pipes response directly without buffering
- Retry logic: on 401, clears credential cache and retries once with freshly discovered credentials
- Forwards rate-limit headers and other relevant response headers

**Context Object** (`src/context.js`)

- Shared state object passed to all handlers
- Contains: VS Code context, HTTP server, status bar, output channel, intercepted token data, credential cache

### Configuration

VS Code settings (`claudeLocalBridge.*`):

- `port` (default: `11437`) — HTTP server port
- `anthropicBaseUrl` (default: `https://api.anthropic.com`) — Anthropic API base URL
- `apiKey` (default: `""`) — Manual API key fallback (lowest priority)
- `defaultModel` (default: `claude-sonnet-4-5`) — Default model for requests
- `logRequests` (default: `false`) — Verbose request/response logging

## Common Development Tasks

**Testing API Endpoints**: Use the `/v1/debug` endpoint to check server status and credential source. The response includes whether credentials were successfully discovered and what source they came from.

**Debugging Credentials**:

- Run `Claude Local Bridge: Show Credential Source` command in VS Code to see which credential source is active
- Check the extension Output channel for logs (verbosity controlled by `logRequests` setting)
- The status bar shows server port and credential source (click to see full status)

**OpenAI → Anthropic Conversion**: The OpenAI handler converts request format, model names, and tool definitions. See `src/handlers/openai.js` for transformation logic. Key conversions:

- Tool definitions: OpenAI's `function` format → Anthropic's `tool` format
- Tool results: OpenAI's `tool` role messages → Anthropic's `tool_result` content block
- Model names: optional remapping (e.g., `gpt-4` → `claude-opus-4-7`)

**Streaming**: Both Anthropic and OpenAI endpoints support streaming. Responses are piped directly from upstream without buffering, preserving true streaming semantics.

**Port Binding**: If the configured port is in use, the server tries up to 10 sequential ports (offset by +1 each attempt) before failing. Check status bar or logs to see which port was actually bound.

## Testing Notes

Tests are in `test/` using Node's built-in `test` module. Test utilities are provided by `test/setup.js`. When adding tests:

- Test files should end in `.test.js`
- Use the test runner: `npm test` (runs all) or `node --require ./test/setup.js --test test/file.test.js` (single file)
- Mock external dependencies (https requests, file system, etc.) — do not make real network calls
- Test handlers in isolation; focus on request/response transformation logic
