# OAuth headless demo runbook

Audience: Alan's policy evidence (personal harness)  
Auth: OAuth-only — see [../OAUTH_ONLY_DIRECTION.md](../OAUTH_ONLY_DIRECTION.md)  
Last updated: 2026-05-24

## Preflight

- [ ] Workspace: `/Users/alanman/Developer/claude-local-bridge-playground`
- [ ] Branch: `main`
- [ ] VS Code **Claude Local Bridge** extension running (F5 dev host or installed)
- [ ] Claude Code OAuth logged in on this machine
- [ ] **No** `ANTHROPIC_API_KEY` in environment
- [ ] Bridge listening on **127.0.0.1:11437** (not 11439)
- [ ] Optional: debug token configured in extension settings for `/v1/debug`

## Port reference

| Port      | Role                                                                                            |
| --------- | ----------------------------------------------------------------------------------------------- |
| **11437** | Bridge — runner `POST /v1/messages` target (`src/runner/model-client.js`)                       |
| **11439** | Capture proxy — Claude Code fingerprint refresh via `HTTPS_PROXY`; **do not** point runner here |

## Debug check (optional)

```bash
curl -s http://127.0.0.1:11437/v1/debug \
  -H "x-claude-local-bridge-debug-token: <from extension settings>"
```

Expect: OAuth/Bearer path active, API-key fallback disabled. **Do not** paste token values into lab-notes or commits.

## Golden command (read-only)

Run from Terminal:

```bash
cd "/Users/alanman/Developer/claude-local-bridge-playground"

node bin/local-bridge-runner.js \
  --cwd "/Users/alanman/Developer/claude-local-bridge-playground" \
  --max-steps 8 \
  --verbose \
  "List top-level files, summarize what this project does, then stop. Do not edit files."
```

Success looks like: model turns complete, tools stay read-only, human log shows bridge URL `11437`, exit 0.

## Artifacts to save

| Artifact              | Typical location                                | Proves               |
| --------------------- | ----------------------------------------------- | -------------------- |
| Human log             | `.bridge-runner/logs/` or path printed at start | Readable trace       |
| Transcript JSONL      | session output path from runner                 | Event-level replay   |
| Session ledger        | alongside session store                         | Canonical turn state |
| Stream-json (if used) | `--output-format stream-json`                   | Machine contract     |

Redact secrets before sharing externally.

## Known blockers

| Issue                     | Symptom                                           | Status                                                                                                                                                  |
| ------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mixed `cache_control` TTL | HTTP 400: `ttl='1h' must not come after ttl='5m'` | **Fixed 2026-05-24** — runner uses `ttl: '1h'` on all markers (`RUNNER_CACHE_CONTROL` in `src/runner/run.js`) to match bridge `prependClaudeCodeSystem` |
| >4 cache breakpoints      | HTTP 400: max 4 blocks with cache_control         | **Fixed 2026-05-24** — E1 repo is sole runner system marker (`BRIDGE_OAUTH_CACHE_RESERVE`)                                                              |

If live run still fails after these fixes, capture **redacted** error body and bridge log line only.

## Live verification (2026-05-24)

Golden read-only command succeeded on bridge `11437`:

- Exit code 0, 2 model turns, read-only `list_files` only
- Prompt cache: `cache hit 8673 tokens` on turns 1–2
- No API key env vars

## Do not

- Point runner at port **11439** capture proxy
- Set `ANTHROPIC_API_KEY` or extension API key to "unblock" runs
- Paste OAuth tokens, debug tokens, or full prompts into lab-notes
- Present successful runs as Anthropic approval of the bridge pattern

## Related

- [bench-parity-evidence.md](./bench-parity-evidence.md)
- [anthropic-official-posture.md](./anthropic-official-posture.md)
- [PERF_ROADMAP_RECONCILIATION.md](../PERF_ROADMAP_RECONCILIATION.md)
