# OAuth Evidence Skill

Use this skill when Alan asks for a no-API-key demo, OAuth-only runbook, evidence checklist, or policy-conversation artifact.

## Rules

- Work in `/Users/alanman/Developer/claude-local-bridge-playground`.
- Read `AGENTS.md`, `README.md`, `lab-notes/OAUTH_ONLY_DIRECTION.md`, and `lab-notes/agents/README.md` first.
- Do not use real `ANTHROPIC_API_KEY`.
- Dummy client keys like `local` are allowed only when a local client requires a placeholder.
- `/v1/debug` requires `x-claude-local-bridge-debug-token` from the VS Code Output log.
- Do not run live Anthropic calls unless Alan explicitly asks.
- Do not paste full OAuth tokens into docs.

## Output

Own:

- `lab-notes/parity/oauth-headless-demo-runbook.md`
- `lab-notes/parity/bench-parity-evidence.md`

The runbook should distinguish what is proven locally from what only Anthropic can confirm server-side.
