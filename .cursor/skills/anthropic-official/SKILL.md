---
name: anthropic-official
description: >-
  Anthropic policy and product posture for the playground harness—official citations
  (June 15 Agent SDK credits, OAuth vs API keys, claude -p vs API), surface picker
  (API vs Agent SDK vs Claude Code), and matrix seed rows. Use when Alan asks what
  Anthropic documents, which integration surface to use, or to refresh
  lab-notes/parity/anthropic-official-posture.md.
---

# Anthropic Official + Surface Expert

Single lane for **dated official citations** and **which Claude surface fits a goal**. Replaces the old split between thin `anthropic-official` and `anthropic-claude-expert`.

## When to use

- Refresh `lab-notes/parity/anthropic-official-posture.md`
- Answer: Claude API vs Agent SDK vs `claude -p` vs interactive Claude Code vs playground bridge
- Seed policy rows for `lab-notes/parity/claude-parity-matrix.md`
- June 15, 2026 metering / Agent SDK credit pool wording (re-fetch help center each time)
- OAuth vs API-key routing questions for Alan's policy dialogue

## When not to use

- Implementing runner or bridge code (other agents / default coding)
- Live OAuth runs or `localhost:11437` (use **oauth-evidence** after posture is current)
- Parity matrix code-audit without policy context (use **parity-archivist**)
- Stream-json field inventory (use **observability-scribe**)

## Charter

Read [`lab-notes/agents/CHARTER.md`](../../lab-notes/agents/CHARTER.md) before editing.

## Bundled references

| File | Purpose |
| ---- | ------- |
| [sources.md](sources.md) | URL tiers, ctx7 commands, claim labels |
| [surfaces.md](surfaces.md) | Surface comparison table and picker |

## Workflow

1. Read `AGENTS.md`, `README.md`, `lab-notes/OAUTH_ONLY_DIRECTION.md`, `lab-notes/agents/README.md`.
2. If the task is **policy citations**: open Tier 1 URLs in [sources.md](sources.md); record **access date** on every quote.
3. If the task is **surface choice**: answer from [surfaces.md](surfaces.md); add one playground sentence (OAuth replay = evidence harness, not product endorsement).
4. Update or create `lab-notes/parity/anthropic-official-posture.md` using the template below.
5. Append **Matrix seed rows** (parity-archivist consumes these).
6. Hand off per CHARTER (≤200 words, paths only).

## Primary deliverable template

`lab-notes/parity/anthropic-official-posture.md`:

```markdown
# Anthropic official posture (playground evidence)

Last reviewed: YYYY-MM-DD
Harness: OAuth-only — see ../OAUTH_ONLY_DIRECTION.md

## Summary

(3–6 sentences, plain language)

## Documented facts

| Topic | Stance | Source | Checked |
| ----- | ------ | ------ | ------- |
| … | documented / unclear | URL | YYYY-MM-DD |

## Playground-specific (labeled inference)

| Claim | Label | Notes |
| ----- | ----- | ----- |
| Bridge+runner OAuth replay | inference / unclear | Personal lab; not third-party product guidance |

## Matrix seed rows

| Capability / policy | Official stance | Citation | Open question |
| ------------------- | --------------- | -------- | ------------- |
| … | … | … | … |
```

## Claim rules

- Every policy sentence: URL + date + label (`documented`, `unclear`, `private correspondence`, `inference`, `community report`).
- Never paste OAuth tokens, debug tokens, or full letter bodies.
- Never recommend evasion, fingerprint hiding, or API-key bypass for policy demos.
- Press and X posts are **secondary**; legal/help center wins on conflict.

## ctx7 (optional, max 3 calls)

```bash
npx ctx7@latest library "Anthropic" "<question>"
npx ctx7@latest docs /anthropics/anthropic-sdk-typescript "<API detail>"
```

## Code anchors (read-only)

Playground is **not** an official Anthropic product; cite these only when comparing harness behavior:

| Area | Path |
| ---- | ---- |
| OAuth-only direction | `lab-notes/OAUTH_ONLY_DIRECTION.md` |
| Detection timeline | `lab-notes/anthropic-detection-risk-awareness.md` |
| Harness vision gaps | `lab-notes/HARNESS_VISION.md` |
| Policy letter framing | `letter-to-anthropic-v2.md` (summarize; do not paste) |

## Handoff targets

| Next lane | When |
| --------- | ---- |
| `oauth-evidence` | Runbook or bench evidence after posture is dated |
| `parity-archivist` | Matrix / permission modes / structured output |
| `lab-integrator` | Weekly rollup once multiple parity files exist |
