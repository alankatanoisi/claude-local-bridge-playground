# Anthropic Platform Watch

**Owner lane:** `.cursor/skills/anthropic-platform-expert/`  
**Policy companion:** [`anthropic-official-posture.md`](anthropic-official-posture.md) (anthropic-official skill)  
**Last updated:** 2026-05-25  
**Folder:** `/Users/alanman/Developer/claude-local-bridge-playground`

Technical source of truth for Agents SDK, Claude API, official docs, changelogs, and **project-scoped** public status (@Anthropic / @claudeai) as they affect this bridge/runner harness. Policy and Terms live in the official posture doc — link, do not duplicate.

---

## Doc index (technical)

| Topic | URL | Last checked | Notes |
| ----- | --- | ------------ | ----- |
| Anthropic API (Messages) | https://docs.anthropic.com | _pending_ | Messages API, prompt caching, streaming |
| Claude Code legal & compliance | https://code.claude.com/docs/en/legal-and-compliance | 2026-05-25 | OAuth scope; third-party use — cross-ref official posture |
| Agent SDK with Claude plan | https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan | _pending_ | June 15 Agent SDK credit |
| Claude Code (GitHub) | https://github.com/anthropics/claude-code | _pending_ | Releases, headless (`claude -p`) |
| Agent SDK docs | _discover on docs.anthropic.com / anthropics repos_ | _pending_ | Sessions, subagents, stream events, structured output, telemetry |

---

## API vs SDK vs Claude Code map

| Capability | Messages API | Agent SDK | Claude Code (`claude -p`) | Playground runner (today) |
| ---------- | ------------ | --------- | ------------------------- | ------------------------- |
| Session resume | _pending_ | _pending_ | _pending_ | See `session-store.js` — fill after doc pass |
| Stream events | _pending_ | _pending_ | _pending_ | See `observability-contract.md` |
| Permission modes | _pending_ | _pending_ | _pending_ | See `permission-modes.md` |
| Structured output | _pending_ | _pending_ | _pending_ | See `structured-output.md` |
| Subagents / fork | _pending_ | _pending_ | _pending_ | See `coordinator.js`, `agents/registry.js` |

---

## Bridge / runner relevance

| Doc topic | Relevance to this project | Status |
| --------- | ------------------------- | ------ |
| OAuth via Claude Code session | Bridge carries Bearer from Claude Code credentials only; no Console API key path | Documented in [`OAUTH_ONLY_DIRECTION.md`](../OAUTH_ONLY_DIRECTION.md) |
| OpenAI-compatible local API | `localhost:11437` transport; runner uses bridge as model client | See `README.md` |
| Agent SDK monthly credit (June 15) | Affects `claude -p` / SDK parity rows; cite official support article only | _pending official wording_ |
| Third-party harness detection | Risk context for OAuth-only evidence runs | [`anthropic-detection-risk-awareness.md`](../anthropic-detection-risk-awareness.md) |
| Runner parity targets | Gap table seed | [`HARNESS_VISION.md`](../HARNESS_VISION.md) §B |

---

## Changelog / release watch

| Date | Source | Summary | Relevance |
| ---- | ------ | ------- | --------- |
| _none yet_ | — | Populate from official changelogs and `anthropics/*` GitHub releases | — |

---

## Public status log (X + official posts)

Project-scoped only: posts that change how we read bridge/runner parity, OAuth evidence, or Agent SDK billing.

| Date | URL | Account | One-line summary | Still current? | Relevance |
| ---- | --- | ------- | ---------------- | -------------- | --------- |
| _none yet_ | — | — | — | — | — |

---

## Open technical gaps

| Gap | Blocks matrix row? | Next step |
| --- | ------------------ | --------- |
| Full Agent SDK doc index not populated | Yes | anthropic-platform-expert lane: live doc pass |
| API vs SDK capability map empty | Yes | Fill rows after doc index |
| Public status log empty | No (until event) | Watch @Anthropic / @claudeai on policy/SDK changes |

---

## Cross-refs

- Policy / Terms / subscription: [`anthropic-official-posture.md`](anthropic-official-posture.md)
- Detection and enforcement context: [`../anthropic-detection-risk-awareness.md`](../anthropic-detection-risk-awareness.md)
- Policy letter context: [`../../letter-to-anthropic-v2.md`](../../letter-to-anthropic-v2.md)
- Parity matrix (merge target): [`claude-parity-matrix.md`](claude-parity-matrix.md) — _not created yet_

---

## Matrix seed rows (technical)

_Seed rows appear here after the first anthropic-platform-expert research pass. Format: capability → official doc stance → doc anchor → open question._
