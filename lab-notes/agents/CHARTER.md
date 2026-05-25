# Shared Agent Charter (all Cursor lab lanes)

Read this once per session. Skill-specific `SKILL.md` files add lane duties on top.

## Workspace

- Folder: `/Users/alanman/Developer/claude-local-bridge-playground`
- Branch: `main` unless Alan names another
- Direction: **OAuth-only evidence harness** for Alan's Anthropic policy conversation — see [`../OAUTH_ONLY_DIRECTION.md`](../OAUTH_ONLY_DIRECTION.md)

## Hard rules

- Do **not** restore `ANTHROPIC_API_KEY`, `claudeLocalBridge.apiKey`, or upstream `x-api-key` in this repo.
- Do **not** edit bridge/auth/proxy files (`src/credentials.js`, `src/proxy.js`, `src/server.js`, `src/interceptors/**`) unless Alan explicitly asks.
- Do **not** run `localhost:11437`, live Anthropic calls, or `npm test` unless Alan explicitly asks.
- Do **not** paste full OAuth tokens, debug tokens, or prompt bodies into lab-notes.
- Do **not** recommend evasion, fingerprint spoofing, or stealth bypass.
- Prefer **lab-notes markdown** unless Alan asks for code.

## Read first (any lane)

1. [`AGENTS.md`](../../AGENTS.md)
2. [`README.md`](../../README.md)
3. [`../OAUTH_ONLY_DIRECTION.md`](../OAUTH_ONLY_DIRECTION.md)
4. [`README.md`](README.md) (lane index)

## Handoff (every lane)

End every task with **≤200 words**:

- What changed (file paths)
- What is blocked and why
- What lane should run next (name the skill)
- Do **not** paste full artifacts — link paths only

## One file owner

Only one lane edits a given file per session. See [`README.md`](README.md) for ownership.

## Recommended lane order

1. `anthropic-official` → posture doc + matrix seed rows
2. `oauth-evidence` → demo runbook + bench evidence template
3. `parity-archivist` → matrix, permission modes, structured output
4. `observability-scribe` → observability contract
5. `lab-integrator` → weekly rollup + cross-links
