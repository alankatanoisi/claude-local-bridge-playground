# OAuth-Only Direction

**Date:** 2026-05-25  
**Folder:** `/Users/alanman/Developer/claude-local-bridge-playground`  
**Branch:** `main`

## Plain-English Purpose

This playground is now an OAuth-only evidence harness.

That means bridge and runner tests should prove whether Alan's own Claude Code OAuth session can carry the request. They
should not silently fall back to Anthropic Console API keys, because that would answer a different billing question.

## What Counts As Valid Upstream Auth

Allowed upstream credential sources:

- Live intercepted Claude Code `Authorization: Bearer ...` token.
- `CLAUDE_CODE_OAUTH_TOKEN`.
- macOS Keychain item `Claude Code-credentials`.
- `~/.claude/.credentials.json`.

Disabled upstream credential sources:

- `ANTHROPIC_API_KEY`.
- `claudeLocalBridge.apiKey`.
- Captured or manually supplied `x-api-key`.

## Local Placeholder Keys

Some Anthropic clients may expect an API-key-shaped environment variable before they will send a local request. Use
`local` only as a local placeholder for that client-side check.

That placeholder value must not be forwarded to Anthropic as `x-api-key`.

## Debug Safety

`/v1/debug` requires:

```http
x-claude-local-bridge-debug-token: <token printed in VS Code Output>
```

The debug token is a local door code. It is not a Claude OAuth token.

## Policy Framing

Anthropic's current public help text says that starting June 15, 2026, Agent SDK and `claude -p` usage draw from a
separate monthly Agent SDK credit instead of interactive plan limits. This repo tests a local bridge/runner edge case for
Alan's policy conversation. A successful request is not the same thing as Anthropic approval.
