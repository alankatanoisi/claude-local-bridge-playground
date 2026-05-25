# Agent Lane Index

How to split **lab-notes documentation** work across five Cursor project skills without fighting the OAuth-only harness direction.

## Shared rules

Read **[CHARTER.md](CHARTER.md)** — workspace, hard rules, handoff format, one-file-owner policy.

Quick reminders:

- Folder: `/Users/alanman/Developer/claude-local-bridge-playground`, branch `main`
- OAuth-only evidence harness — [`../OAUTH_ONLY_DIRECTION.md`](../OAUTH_ONLY_DIRECTION.md)
- No API keys, no live bridge, no tests unless Alan asks
- Prefer markdown in `lab-notes/`; bridge code gated in CHARTER

## Cursor lanes (five skills)

| Lane | Skill | Owns | Invoke when |
| ---- | ----- | ---- | ----------- |
| Anthropic official | `.cursor/skills/anthropic-official/SKILL.md` | `lab-notes/parity/anthropic-official-posture.md`; surface picker in skill `surfaces.md` | Policy citations, API vs SDK vs `claude -p`, June 15 metering |
| OAuth evidence | `.cursor/skills/oauth-evidence/SKILL.md` | `oauth-headless-demo-runbook.md`, `bench-parity-evidence.md` | Demo checklist, golden commands, artifact list (no live runs by default) |
| Parity archivist | `.cursor/skills/parity-archivist/SKILL.md` | `claude-parity-matrix.md`, `permission-modes.md`, `structured-output.md` | Adopt/skip/later matrix from HARNESS_VISION + code |
| Observability scribe | `.cursor/skills/observability-scribe/SKILL.md` | `lab-notes/observability/observability-contract.md` | stopReason + stream-json catalog |
| Lab integrator | `.cursor/skills/lab-integrator/SKILL.md` | `weekly-integration.md`, this README, cross-links | After other lanes land files |

Bundled references for official lane: `.cursor/skills/anthropic-official/sources.md`, `surfaces.md`.

## Recommended order

1. **anthropic-official** — dated policy facts + matrix seed rows  
2. **oauth-evidence** — runbook + bench template (documents blockers; Alan runs live)  
3. **parity-archivist** — matrix cites posture + code evidence  
4. **observability-scribe** — contract supports matrix/autopsy rows  
5. **permission-modes** / **structured-output** (parity-archivist)  
6. **lab-integrator** — weekly rollup  

Policy before parity before integration—so the matrix does not guess Anthropic stance.

## Deprecated

`anthropic-claude-expert` was merged into **anthropic-official**. Do not add a sixth lane unless Alan asks.
