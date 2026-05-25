---
name: anthropic-official
description: Collects and updates dated Anthropic official policy citations for the playground parity matrix (June 15 Agent SDK billing, OAuth vs API keys, claude -p). Use when Alan asks to refresh anthropic-official-posture.md or seed parity policy rows—not for general API how-to (use anthropic-claude-expert).
disable-model-invocation: true
---

# Anthropic Official Posture Collector

Use this skill when Alan asks to **refresh policy citations** or maintain `lab-notes/parity/anthropic-official-posture.md`.

For **which surface to use**, SDK/API nuances, or bridge/runner architecture, read and follow [anthropic-claude-expert](../anthropic-claude-expert/SKILL.md) first.

## Rules

- Work in `/Users/alanman/Developer/claude-local-bridge-playground`.
- Read `AGENTS.md`, `README.md`, `lab-notes/OAUTH_ONLY_DIRECTION.md`, and `lab-notes/agents/README.md` first.
- Use primary sources only: official Anthropic docs, support pages, legal pages, official GitHub repos, and verified public posts.
- Every policy claim needs URL and date checked.
- Label claims as `documented`, `unclear`, `private correspondence`, or `inference`.
- Do not recommend evasion, stealth, or fingerprint hiding.

## Output

Write or update `lab-notes/parity/anthropic-official-posture.md`.

End with a `Matrix seed rows` section:

- Capability or policy area.
- Official stance.
- Citation.
- Open question, if any.
