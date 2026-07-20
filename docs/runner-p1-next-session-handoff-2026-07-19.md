# Agent handoff — post-P0 P1 package (2026-07-19 evening)

**Audience:** any coding agent starting a fresh session on this playground.  
**Primary (human-readable) twin:** [`docs/runner-p1-next-session-handoff-2026-07-19.html`](./runner-p1-next-session-handoff-2026-07-19.html)  
**Source assessment:** [`docs/runner-runtime-concordance-assessment-2026-07-17.html`](./runner-runtime-concordance-assessment-2026-07-17.html) (status annotation at top)

## Which clone / branch

| Check | Expected |
| --- | --- |
| Folder | `/Users/alanman/Developer/claude-local-bridge-playground` |
| Branch | `main` |
| Remote `origin` | `https://github.com/alankatanoisi/claude-local-bridge-playground.git` |
| Canonical repo | reference-only — do **not** open PRs there |

```bash
pwd
git rev-parse --show-toplevel
git branch --show-current
git remote -v
git status --short
git pull --ff-only origin main
```

## State snapshot (verified 2026-07-19)

### Closed P0 (all twelve)

P0-01…P0-12 are closed, including full P0-06 `apply_patch` repair. See assessment annotation.

### Closed post-P0 / P1 in this arc

| ID | Title | Landing commit / notes |
| --- | --- | --- |
| P1-01 | Plan-mode real reads + proposed diffs | `02e1503` — `plan-proposals.js`; reads allow; writes record apply_patch-compatible diffs |
| P1-02 | Upstream `stop_reason` / usage preservation | `02e1503` — stream `message_delta`; map `max_tokens`/`refusal` |
| P1-03 | Typed bridge HTTP retries | earlier — fail-fast 4xx; retry 429/5xx |
| P1-04 | Single terminal finalizer | `02e1503` — `finalizeRun` for all exits incl. SIGINT |
| WP2 | Monotonic authority ceiling | `02e1503` — `authority.js` |
| Docs gate | Generated tool/CLI manifest check | `02e1503` — `scripts/check-runner-manifest.js` |
| P1-05 | Child budget leases | `df679cc` — `budget-broker.js` |
| P1-08 | Unified recovery / undo | `df679cc` — fail-closed backups; create-delete; timestamped undo |
| P1-09 | Resume / replay / repair honesty | `df679cc` — session `--continue`; experimental gate |
| **P1-10** | **Worker inherit + child manifests** | **this session** — `child-inherit.js` |

### Still open (recommended next)

Pick **one slice** per session unless Alan asks for a batch:

1. **P1-11** — Streaming redaction boundary window / stable identifiers  
2. **P1-12** — HTTPS bridge URL vs HTTP-only model client  
3. **P1-14** — Hook execution trust: docs vs runtime  
4. **P1-07** — Model/effort/thinking catalog lag (official Anthropic sources first)  
5. Later: compatibility doctor, recovery/session completion polish, built-ins/templates/skills, then a **docs rewrite** of day-to-day surfaces only

Do **not** start a full docs rewrite yet — day-to-day docs were updated with the code, and `check:docs` now guards drift.

## What P1-10 changed (this session)

**Problem:** `spawn_agent` children ran quiet with almost no parent settings (model, bridge, `--no-network`, wall/cost ceilings, trace, correlation). Parent could not account for child requests.

**Fix:**

- New `src/runner/child-inherit.js` — build inherit bag, apply CLI flags, env correlation, child manifest shape  
- `worker-runtime.js` — applies inherit to argv; `BRIDGE_CALLER_TOKEN` / parent run id / worker id via **env only**  
- `spawn-agent.js` — remaining wall-clock at spawn; records `ctx.childManifests` + ledger `child_spawn_completed`  
- `run.js` — `ctx.childInherit`, `finalizeRun.childManifests`  
- `coordinator.js` — research/verify workers also inherit  

**Acceptance met:** parent can account for child usage, stop reason, inherited ceilings, and a compact tool-effect summary without widening authority.

## Non-obvious traps

- Do **not** restore agent/capability profiles.  
- Do **not** widen child authority above parent ceiling (`authority.js`).  
- Do **not** put caller tokens on child argv — env only.  
- Do **not** treat `--dont-ask` as enabling shell.  
- Do **not** advertise `--replay`/`--repair` as working without `BRIDGE_RUNNER_EXPERIMENTAL=1`.  
- Do **not** claim stream redaction is complete until P1-11 lands.  
- For Anthropic facts: official docs first (`docs.anthropic.com`, `code.claude.com/docs`, `support.claude.com`) — see `.cursor/skills/anthropic-official/SKILL.md`.  
- Prefer HTML for complex plans/handoffs; keep `docs/command-builder.html` as day-to-day UX.

## Verification before handoff

```bash
node --require ./test/setup.js --test test/runner/child-inherit.test.js test/runner/spawn-agent.test.js test/runner/budget-broker.test.js
npm test
npm run lint
npm run check:docs
npm run format:check
```

## Fresh-session starter prompt (copy/paste)

```text
You are in /Users/alanman/Developer/claude-local-bridge-playground on main
(origin = claude-local-bridge-playground). Read AGENTS.md + CLAUDE.md, run the
startup preflight, pull --ff-only origin main, then read
docs/runner-p1-next-session-handoff-2026-07-19.md (and the HTML twin).

All P0s and P1-01..05,08,09,10 (+ WP2, docs gate) are closed. Implement the
next open P1 Alan names (default suggestion: P1-11). Do not rewrite all docs;
do not touch bridge auth internals unless required for runner transport.
End with folder/branch, files, checks, skipped, risks. Commit/push only if asked.
```

## Handoff fields

- **Folder / branch:** playground `main`  
- **This session files:** `src/runner/child-inherit.js`, `worker-runtime.js`, `tools/spawn-agent.js`, `run.js`, `coordinator.js`, `test/runner/child-inherit.test.js`, assessment annotation, this handoff pair  
- **Checks:** run the verification block above before claiming done  
- **Skipped:** full docs rewrite; P1-11+  
- **Risks:** child cost ceiling still uses parent's full `--max-cost-usd` (not remaining estimated spend); wall-clock remainder is correct. P1-10 overlaps future “unified run bundle” work but does not block it.
