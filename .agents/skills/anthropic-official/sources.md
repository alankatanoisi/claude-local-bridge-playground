# Official and public sources checklist

Refresh access dates when citing. **WebFetch official URLs in-session** — do not quote from memory.

## Default lookup order

1. **WebFetch** Tier-1 (and Tier-2 when engineering detail is needed) URLs below.
2. **WebSearch** only to discover the right official URL, changelog, or public status (@Anthropic, @claudeai) — then WebFetch the permalink.
3. **Context7 (ctx7 CLI or MCP)** as **optional fallback** when fetch fails, is incomplete, or Alan explicitly asks for indexed API snippets (max ~3 calls per task unless deep dive).

Context7 is **not** the default for anthropic-official or anthropic-platform-expert.

## Tier 1 — contractual / product policy

| Source | URL | Use for |
| ------ | --- | ------- |
| Claude Code legal & compliance | https://code.claude.com/docs/en/legal-and-compliance | OAuth scope, third-party prohibitions |
| Consumer Terms | https://www.anthropic.com/legal/consumer-terms | Subscription use |
| Commercial Terms | https://www.anthropic.com/legal/commercial-terms | API customers |
| Claude Help — Agent SDK + plan | https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan | June 15 credits, eligible surfaces |
| Claude API docs (platform) | https://docs.anthropic.com/ | Messages API, auth, rate limits |
| Claude Code docs | https://code.claude.com/docs/en/overview | CLI, headless, permissions |

## Tier 2 — engineering primary

| Source | URL | Use for |
| ------ | --- | ------- |
| anthropic-sdk-typescript | https://github.com/anthropics/anthropic-sdk-typescript | REST client behavior |
| anthropic-sdk-python | https://github.com/anthropics/anthropic-sdk-python | Python API |
| claude-agent-sdk-python | https://github.com/anthropics/claude-agent-sdk-python | SDK spawn, env, streaming |
| claude-agent-sdk (TS) | https://github.com/anthropics/claude-agent-sdk-typescript | TS SDK (verify repo name at fetch time) |
| claude-code | https://github.com/anthropics/claude-code | CLI issues, `-p`, OTel, sessions |

## Tier 3 — public posture (secondary; link permalinks)

| Source | Notes |
| ------ | ----- |
| Anthropic news | https://www.anthropic.com/news |
| Anthropic blog / policy posts | Search for OAuth, third-party, Agent SDK |
| X `@trq212` | Executive statements on third-party OAuth — label **public statement**, not legal text |
| X `@Anthropic` | Product announcements |
| Reputable tech press | Label **press**; cross-check Tier 1 |

## Playground lab notes (this repo)

| File | Use for |
| ---- | ------- |
| `lab-notes/OAUTH_ONLY_DIRECTION.md` | Harness auth rules |
| `lab-notes/anthropic-detection-risk-awareness.md` | Enforcement timeline |
| `lab-notes/HARNESS_VISION.md` | Runner vs `claude -p` vs SDK gap table |
| `lab-notes/parity/anthropic-official-posture.md` | Curated citation matrix (this lane owns) |
| `letter-to-anthropic-v2.md` | Policy framing (do not paste private mail) |

## Context7 fallback (syntax only — not default)

Use only after WebFetch fails or is incomplete, or when Alan explicitly requests ctx7:

```bash
npx ctx7@latest library "Anthropic" "<your question>"
npx ctx7@latest docs /anthropics/anthropic-sdk-typescript "<API question>"
npx ctx7@latest docs /anthropics/claude-agent-sdk-python "<Agent SDK question>"
```

Max **three** ctx7 calls per user turn unless Alan asks for a deep doc sweep.

## Claim labeling (required)

| Label | Meaning |
| ----- | ------- |
| `documented` | Tier 1–2 source quoted with date |
| `unclear` | Official text ambiguous or silent |
| `private correspondence` | Email/DM — summarize topic only, no paste |
| `inference` | Logical glue between documented facts |
| `community report` | GitHub issues, forums — not policy |

## June 15 metering (re-check each session)

When answering billing questions, re-fetch the help article for:

- Credit amounts per plan tier (Pro / Max)
- Whether third-party apps via Agent SDK share the same pool
- Overage behavior (API rates vs usage credits)
- Whether bridge/runner OAuth replay is in scope (**usually unclear** — do not infer approval)
