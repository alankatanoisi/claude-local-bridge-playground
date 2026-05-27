---
description: Anthropic platform expert — Agents SDK, Claude API, official docs, changelogs, and public status (X) for bridge/runner parity.
---

# Anthropic Platform Expert Skill

Use this skill when Alan asks about the Agents SDK, Claude API / Messages API, `docs.anthropic.com`, Claude Code headless (`claude -p`), SDK sessions/subagents/stream events, structured output, telemetry, official changelogs, or public status updates (@Anthropic / @claudeai) as they affect bridge/runner parity or OAuth-only evidence.

**Do not use this skill** when Alan says `runner-command-builder`, `commands only`, or wants paste-ready `node bin/local-bridge-runner.js` lines — that is **runner-command-builder** (Terminal commands only; no lab-notes edits in Cursor).

For policy, Terms, subscription vs API, or June 15 billing posture, use **anthropic-official** instead.

## When NOT to use (mandatory)

- Alan said **runner-command-builder**, **commands only**, or wants **paste-ready Terminal CLI** — use `.cursor/skills/runner-command-builder/` instead (that skill does **not** edit files; it only prints `node bin/local-bridge-runner.js` blocks).
- The message is only about how to invoke the runner, not researching Anthropic docs.

## How lookups work (plain language)

When Alan asks a technical Anthropic question, **fetch the official page first** (WebFetch on a Tier-1 URL). Use WebSearch only to **find** the right official URL or a changelog/status post. **Context7 (ctx7) is not the default** — use it only if the fetch failed, the page was incomplete, or Alan explicitly wants indexed API snippets.

## Rules

Playground only: `/Users/alanman/Developer/claude-local-bridge-playground`
Current direction: OAuth-only evidence harness for Alan's Anthropic policy conversation.
Do not restore ANTHROPIC_API_KEY, claudeLocalBridge.apiKey, or upstream x-api-key auth.
Do not edit bridge/auth/proxy files unless Alan explicitly asks; if asked, preserve OAuth-only auth, debug-token gating, and token redaction.
Do not run localhost:11437, live Anthropic calls, or npm test unless Alan explicitly asks.
Output: lab-notes markdown only unless Alan asks for code.
Return ≤200 word summary + paths changed; link full artifact, do not paste it.
North star: parity lab-notes for Claude Code / Agent SDK — not canonical promotion.
Read first: lab-notes/OAUTH_ONLY_DIRECTION.md, AGENTS.md, README.md.

Lane-specific:

- Work in `/Users/alanman/Developer/claude-local-bridge-playground` on branch `main`.
- Read `AGENTS.md`, `README.md`, `lab-notes/OAUTH_ONLY_DIRECTION.md`, and `lab-notes/agents/README.md` first.
- **Default lookup order** (cap ~3 live lookups per task unless Alan asks for a deep dive):
  1. **WebFetch** Tier-1 official URLs: `docs.anthropic.com`, `code.claude.com/docs`, `support.claude.com`, official `github.com/anthropics/*` READMEs (match repo to topic).
  2. **WebSearch** only to discover the right official URL, changelog, or public status (@Anthropic, @claudeai, executives when policy-relevant) — then WebFetch the permalink.
  3. **Context7 (ctx7 CLI or MCP)** as **optional fallback** when primary fetch fails, is incomplete, or Alan explicitly asks for indexed API snippets.
- Every technical claim needs date + URL; label `documented`, `unclear`, `inference`, or `rumor`.
- Cross-read `lab-notes/parity/anthropic-official-posture.md` when it exists — link policy facts; do not duplicate official posture matrix seeds.
- Do not recommend evasion, fingerprint spoofing, or hiding usage; do not restore API-key fallback narratives.

## Workflow

1. Read charter files (`AGENTS.md`, `OAUTH_ONLY_DIRECTION.md`, `lab-notes/agents/README.md`).
2. Pick Tier-1 URLs for the topic; **WebFetch** them in-session (do not quote from memory).
3. If the exact page is unknown, **WebSearch** for an official permalink, then **WebFetch** it.
4. For X / public status: WebSearch or WebFetch verified accounts only; label secondary sources.
5. Update `lab-notes/parity/anthropic-platform-watch.md`; append **Matrix seed rows (technical)**.
6. Hand off per CHARTER (≤200 words, paths only).

## Context7 fallback (optional, max 3 calls)

Use **only** when WebFetch did not answer the question or Alan asks for ctx7-indexed snippets:

```bash
npx ctx7@latest library "Anthropic" "<question>"
npx ctx7@latest docs /anthropics/anthropic-sdk-typescript "<API detail>"
npx ctx7@latest docs /anthropics/claude-agent-sdk-python "<Agent SDK detail>"
```

Do **not** start with ctx7 for these skills — official pages are the source of truth.

## Output

Write or update `lab-notes/parity/anthropic-platform-watch.md`.

End with a **Matrix seed rows (technical)** section:

- Capability.
- Official doc stance.
- Doc anchor (URL + section).
- Open question, if any.
