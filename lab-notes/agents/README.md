# Agent Lane Index

This file tells Cursor, Codex, and any other agent how to split documentation work without fighting the current OAuth-only direction.

## Shared Rules

- Work only in `/Users/alanman/Developer/claude-local-bridge-playground` on branch `main`.
- Current direction: OAuth-only evidence harness for Alan's Anthropic policy conversation.
- Do not restore `ANTHROPIC_API_KEY`, `claudeLocalBridge.apiKey`, or upstream `x-api-key` auth.
- Do not edit bridge/auth/proxy files unless Alan explicitly asks.
- If bridge work is explicitly requested, preserve OAuth-only auth, debug-token gating, and token redaction.
- Do not run `localhost:11437`, live Anthropic calls, or `npm test` unless Alan explicitly asks.
- Prefer lab-notes markdown changes. Keep summaries short and list paths changed.
- Read first: `AGENTS.md`, `README.md`, and `lab-notes/OAUTH_ONLY_DIRECTION.md`.

## Cursor Lanes

| Lane                 | Skill                                          | Owns                                                                                      | Do Next                                                                              |
| -------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Anthropic expert     | `.cursor/skills/anthropic-claude-expert/SKILL.md` | Answers: API vs Agent SDK vs `claude -p` vs CC; see `sources.md` in that skill folder | Use for integration/policy Q&A; fetch help center when billing wording matters.      |
| Anthropic official   | `.cursor/skills/anthropic-official/SKILL.md`   | `lab-notes/parity/anthropic-official-posture.md`                                          | Collect dated official citations for June 15, OAuth/API, Agent SDK, and `claude -p`. |
| Parity archivist     | `.cursor/skills/parity-archivist/SKILL.md`     | `lab-notes/parity/claude-parity-matrix.md`, `permission-modes.md`, `structured-output.md` | Build the matrix after official posture has seed rows.                               |
| Observability scribe | `.cursor/skills/observability-scribe/SKILL.md` | `lab-notes/observability/observability-contract.md`                                       | Inventory runner JSON/stream events from tests and docs.                             |
| OAuth evidence       | `.cursor/skills/oauth-evidence/SKILL.md`       | `lab-notes/parity/oauth-headless-demo-runbook.md`, `bench-parity-evidence.md`             | Write the no-API-key demo checklist, but do not run live calls.                      |
| Lab integrator       | `.cursor/skills/lab-integrator/SKILL.md`       | `lab-notes/weekly-integration.md`, cross-links, indexes                                   | Keep docs aligned and note what changed each week.                                   |

## Recommended Order

1. Anthropic official posture.
2. OAuth headless demo runbook.
3. Parity matrix.
4. Observability contract.
5. Permission modes and structured output.
6. Weekly integration note.

The reason for this order is simple: the official posture sets the policy facts, the OAuth runbook sets clean evidence collection, and the parity matrix should cite both instead of guessing.
