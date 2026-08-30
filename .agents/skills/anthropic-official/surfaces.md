# Claude integration surfaces (deep comparison)

Use with [SKILL.md](SKILL.md). Re-verify billing and policy URLs each session.

## Quick picker

| Goal | Prefer | Auth |
| ---- | ------ | ---- |
| Third-party app / your HTTP client | **Claude API** | Console API key |
| Programmatic agent on your Claude plan | **Agent SDK** or **`claude -p`** | Claude Code OAuth |
| Human pair-programming in terminal | **Interactive Claude Code** | Claude Code OAuth |
| Policy evidence for OAuth bridge (this repo) | **Playground bridge + runner** | OAuth replay only |

## Comparison table

| Dimension | Claude API | Agent SDK | `claude -p` | Interactive CC | Playground bridge+runner |
| --------- | ---------- | --------- | ----------- | -------------- | ------------------------ |
| Entrypoint | HTTP client you write | SDK spawns Claude Code CLI | `claude -p "..."` | `claude` TUI | `node bin/local-bridge-runner.js` |
| Session continuity | You store messages | SDK + CC session files | `--resume`, session ids | `/resume`, forks | Session store + ledger |
| Tools | You declare in API payload | CC tools + hooks/MCP | CC built-ins + flags | Full CC | Local tool registry |
| Auth | Console API key | CC OAuth via CLI | CC OAuth | CC OAuth | Replayed Bearer OAuth |
| Official third-party? | **Yes** | **Yes** | **Yes** | N/A (end user) | **No** (personal lab) |
| Billing (post Jun 2026 help text) | Console / API rates | Agent SDK credit pool | Same pool as SDK | Interactive limits | Unclear / policy-sensitive |

## Common confusions

| Confusion | Truth |
| --------- | ----- |
| "Agent SDK = Claude API" | SDK drives **Claude Code CLI**; API is direct REST with API keys. |
| "Pro OAuth in my app via API" | **Not documented** for third-party products; playground tests replay as **evidence**, not endorsement. |
| "Bridge is like Agent SDK" | Bridge is HTTP proxy + credential injection; runner is a **custom harness**. |

## Choosing in practice

```text
Multi-tenant SaaS with your billing?     → Claude API + API keys
CC tools/permissions in your Node app?   → Agent SDK
Shell/CI one-off automation?             → claude -p
You at the keyboard?                     → interactive Claude Code
Policy letter evidence for OAuth bridge? → playground (controlled runs only)
```
