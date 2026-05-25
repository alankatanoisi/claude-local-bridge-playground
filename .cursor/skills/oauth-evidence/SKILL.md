---
name: oauth-evidence
description: >-
  Writes OAuth-only headless demo runbook and bench parity evidence templates for the
  playground—debug preflight, golden runner commands, artifact checklist, known cache-TTL
  blocker. Use when Alan asks how to demonstrate Pro/Max OAuth via bridge without API
  keys; do not run live calls unless Alan explicitly asks.
---

# OAuth Evidence Collector

Documents **how to collect policy-grade evidence** that the runner uses Claude Code OAuth through the bridge—**without** API keys and **without** running live calls unless Alan asks.

## When to use

- Create or update `lab-notes/parity/oauth-headless-demo-runbook.md`
- Create or update `lab-notes/parity/bench-parity-evidence.md` (stub vs `--live` tables)
- Preflight checklist: extension, bridge port, debug token, capture proxy confusion
- Document known blockers (e.g. cache_control TTL ordering)

## When not to use

- Official policy citation refresh (**anthropic-official**)
- Matrix adopt/skip without run steps (**parity-archivist**)
- Implementing bridge fixes (**default agent**; bridge files gated in CHARTER)

## Charter

Read [`lab-notes/agents/CHARTER.md`](../../lab-notes/agents/CHARTER.md). **Default: do not run** `localhost:11437` or live runner unless Alan explicitly asks.

## File ownership

| File | Scope |
| ---- | ----- |
| `lab-notes/parity/oauth-headless-demo-runbook.md` | Demo procedure |
| `lab-notes/parity/bench-parity-evidence.md` | Bench commands + metric tables |

## Read first

1. `lab-notes/OAUTH_ONLY_DIRECTION.md`
2. `README.md`, `QUICKSTART.md`, `HEADLESS_AGENT_RUNNER_BEGINNER_GUIDE.md`
3. `docs/threat-model.md` (safety flags for golden command)
4. `src/runner/model-client.js` (default `http://127.0.0.1:11437/v1/messages`)
5. `src/runner/run.js` (`applyCacheControlBudget`) + `src/credentials.js` (`prependClaudeCodeSystem`) for TTL blocker note

## Ports (do not confuse)

| Port | Role |
| ---- | ---- |
| **11437** | Bridge — runner `POST /v1/messages` target |
| **11439** | Capture proxy — Claude Code fingerprint refresh via `HTTPS_PROXY`; **not** for runner |

## Workflow

1. Write preflight section (VS Code extension running, OAuth logged in, no `ANTHROPIC_API_KEY`).
2. Document debug gate: header `x-claude-local-bridge-debug-token` for `/v1/debug` (value from extension settings; **never** paste token into lab-notes).
3. Golden read-only runner command (playground paths, `--max-steps`, no shell, no `--accept-edits` unless section says so).
4. Artifact checklist: human log, transcript JSONL, ledger, stream-json capture path.
5. **Known blocker** section: cache_control TTL order (`5m` on tools before `1h` on system from bridge) → HTTP 400; label `blocked on bridge+runner TTL alignment` until fixed.
6. Bench doc: stub command from tests + placeholder table for `--live` after Codex/cache land.
7. Hand off per CHARTER.

## Runbook template

```markdown
# OAuth headless demo runbook

Audience: Alan's policy evidence (personal harness)
Auth: OAuth-only — see ../OAUTH_ONLY_DIRECTION.md

## Preflight

- [ ] Workspace: /Users/alanman/Developer/claude-local-bridge-playground
- [ ] Branch: main
- [ ] VS Code Claude Local Bridge extension active
- [ ] No ANTHROPIC_API_KEY in environment
- [ ] Bridge listening on 127.0.0.1:11437 (not 11439)

## Debug check (optional)

curl -s http://127.0.0.1:11437/v1/debug \
  -H "x-claude-local-bridge-debug-token: <from settings>"

Expect: OAuth present, API key paths disabled (describe fields, no secrets).

## Golden command (read-only)

cd "/Users/alanman/Developer/claude-local-bridge-playground"
node bin/local-bridge-runner.js \
  --cwd "/Users/alanman/Developer/claude-local-bridge-playground" \
  --max-steps 8 \
  --verbose \
  "List top-level files, summarize the project, stop without edits."

## Artifacts to save

| Artifact | Typical path | Proves |
| -------- | ------------- | ------ |
| human log | … | Readable trace |
| transcript | … | JSONL events |
| … | … | … |

## Known blockers

| Issue | Symptom | Owner |
| ----- | ------- | ----- |
| cache_control TTL order | HTTP 400 ttl ordering | bridge + runner alignment |

## Do not

- Point runner at 11439 capture proxy
- Use API key env vars for "getting unblocked"
- Paste OAuth or debug tokens into notes
```

## Bench evidence template

```markdown
# Bench parity evidence

## Stub (offline, safe)

node --require ./test/setup.js --test test/runner/bench/turn-latency.bench.js

## Live (Alan-only)

# After TTL/cache fix and explicit approval:
# node bin/local-bridge-runner.js ... --live flags per bench doc

| Metric | Before | After | Date | Notes |
| ------ | ------ | ----- | ---- | ----- |
| turn latency p50 | TBD | TBD | | stub only until live |
```

## Handoff

- **parity-archivist** — wire matrix rows once evidence exists
- **observability-scribe** — align artifact list with contract
- **lab-integrator** — weekly entry after first successful demo (Alan-run)
