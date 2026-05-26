---
description: Anthropic platform expert — Agents SDK, Claude API, official docs, changelogs, and public status (X) for bridge/runner parity.
---

# Anthropic Platform Expert Skill

Use this skill when Alan asks about the Agents SDK, Claude API / Messages API, `docs.anthropic.com`, Claude Code headless (`claude -p`), SDK sessions/subagents/stream events, structured output, telemetry, official changelogs, or public status updates (@Anthropic / @claudeai) as they affect bridge/runner parity or OAuth-only evidence.

For policy, Terms, subscription vs API, or June 15 billing posture, use **anthropic-official** instead.

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
- Prefer primary sources: `docs.anthropic.com`, `code.claude.com/docs`, `support.claude.com`, official `github.com/anthropics/*` READMEs.
- For X / public status: use WebSearch or WebFetch; only verified accounts (@Anthropic, @claudeai, or executives when policy-relevant).
- Every technical claim needs date + URL; label `documented`, `unclear`, `inference`, or `rumor`.
- Cross-read `lab-notes/parity/anthropic-official-posture.md` when it exists — link policy facts; do not duplicate official posture matrix seeds.
- Cap live lookups (~3 commands per task unless Alan asks for a deep dive).
- Do not recommend evasion, fingerprint spoofing, or hiding usage; do not restore API-key fallback narratives.

## Output

Write or update `lab-notes/parity/anthropic-platform-watch.md`.

End with a **Matrix seed rows (technical)** section:

- Capability.
- Official doc stance.
- Doc anchor (URL + section).
- Open question, if any.
