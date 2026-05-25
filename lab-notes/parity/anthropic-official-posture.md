# Anthropic official posture (playground evidence)

Last reviewed: 2026-05-24  
Harness: OAuth-only — see [../OAUTH_ONLY_DIRECTION.md](../OAUTH_ONLY_DIRECTION.md)

This document is **personal policy evidence** for Alan's Anthropic dialogue, not production guidance for third-party products.

## Summary

Anthropic distinguishes **Claude Platform API keys** (intended for third-party apps with pay-as-you-go billing) from **Claude Code OAuth** (subscription login for Claude Code, Agent SDK, and `claude -p`). Starting **June 15, 2026**, Agent SDK and `claude -p` usage moves to a **separate monthly credit pool** on Pro/Max/Team/Enterprise plans; interactive Claude Code stays on existing subscription usage limits. The help center explicitly lists **third-party apps that authenticate with your Claude subscription through the Agent SDK** as credit-eligible — but does **not** document HTTP bridges that replay OAuth Bearer tokens to arbitrary clients. The playground harness falls in that **unclear** gap: it is evidence tooling, not an endorsed integration pattern.

## Documented facts

| Topic                                                | Stance                                                                              | Source                                                                                                                                           | Checked    |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| Agent SDK + `claude -p` billing split (Jun 15, 2026) | **documented** — separate monthly credit; interactive CC unchanged                  | [Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) | 2026-05-24 |
| Pro monthly Agent SDK credit                         | **documented** — $20/month                                                          | Same help article                                                                                                                                | 2026-05-24 |
| Max 5x / 20x credits                                 | **documented** — $100 / $200                                                        | Same help article                                                                                                                                | 2026-05-24 |
| Credit covers third-party Agent SDK apps             | **documented** — "authenticate with your Claude subscription through the Agent SDK" | Same help article                                                                                                                                | 2026-05-24 |
| API key users                                        | **documented** — no Agent SDK credit; pay-as-you-go unchanged                       | Same help article                                                                                                                                | 2026-05-24 |
| OAuth vs API key auth                                | **documented** — different products and billing paths                               | Help article + [Claude API docs](https://docs.anthropic.com/)                                                                                    | 2026-05-24 |
| Claude Code legal / third-party use                  | **documented** — consult compliance docs for restrictions                           | [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)                                                                     | 2026-05-24 |
| Local HTTP bridge replaying OAuth to custom runner   | **unclear** — not named in Tier 1 sources                                           | —                                                                                                                                                | 2026-05-24 |

## Playground-specific (labeled inference)

| Claim                                                     | Label                   | Notes                                                                  |
| --------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------- |
| Playground runner + bridge is "third-party Agent SDK app" | **inference / unclear** | Uses OAuth replay, not official Agent SDK spawn path                   |
| OAuth-only harness strengthens policy conversation        | **inference**           | Removes API-key confound; see OAUTH_ONLY_DIRECTION                     |
| June 15 credit applies to playground runs                 | **unclear**             | Credit text targets Agent SDK auth pattern, not arbitrary HTTP clients |

## Matrix seed rows

| Capability / policy                             | Official stance                       | Citation              | Open question                    |
| ----------------------------------------------- | ------------------------------------- | --------------------- | -------------------------------- |
| Third-party SaaS via Claude API + API key       | Allowed product path                  | docs.anthropic.com    | n/a                              |
| Personal automation via Agent SDK / `claude -p` | Allowed; credit from Jun 15           | Help article 15036540 | Credit claim process             |
| Interactive Claude Code                         | Subscription usage limits (unchanged) | Help article 15036540 | n/a                              |
| Custom HTTP client + subscription OAuth Bearer  | Not documented                        | —                     | Anthropic policy response        |
| Prompt caching (`cache_control`)                | Supported API feature                 | Anthropic API docs    | TTL ordering with bridge prepend |
| Headless runner without Claude Code CLI         | Not same as Agent SDK                 | surfaces.md in skills | Parity vs `claude -p` engine     |

## Related lab notes

- [anthropic-detection-risk-awareness.md](../anthropic-detection-risk-awareness.md)
- [HARNESS_VISION.md](../HARNESS_VISION.md) §B
- [OAUTH_ONLY_DIRECTION.md](../OAUTH_ONLY_DIRECTION.md)
- [claude-parity-matrix.md](./claude-parity-matrix.md)
