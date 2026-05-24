# Agent OS Architecture (Playground)

Implementation of the **Runner As Top-Level Agent** plan and **Harness Hardening Roadmap**.

## Layers

| Layer | Module | Role |
|-------|--------|------|
| Kernel | `src/runner/kernel/` | Deterministic turn engine; stable `stopReason` contract |
| Bootstrap | `src/runner/bootstrap.js` | Memoized startup: cwd → trust → instructions → context → resume |
| Trust | `src/runner/workspace-trust.js` | P0 consent gate before any tool runs |
| Session | `src/runner/session-store.js` | Checkpoint `*.state.json` (messages + runner metadata) |
| Ledger | `src/runner/session-ledger.js` | Append-only `*.ledger.jsonl` with monotonic `seq` |
| Replay | `src/runner/replay-simulator.js` | Read-only ledger verification |
| Context | `src/runner/context-compactor.js` | clip → snip → ghost → **summarize** ladder |
| Context budget | `src/runner/context-budget.js` | Progressive tool summaries + memoized system prompt |
| Coordinator | `src/runner/coordinator.js` | research → synthesize → execute → verify |
| Spec compiler | `src/runner/coordinator-spec-compiler.js` | Structured spec + `synthesisNotes` |
| Workers | `src/runner/worker-runtime.js` | Isolated subprocess workers with agent profiles |
| Agents | `src/runner/agents/registry.js` | explore, plan, implement, verify, test, replay, extractor |
| Events | `src/runner/event-bus.js` | Typed automation events |
| Memory | `src/runner/memory/` | Instruction hierarchy + four-type auto-memory |
| Memory review | `src/runner/memory-review.js` | Promotion queue + `--review-memory` |
| Skills | `src/runner/skills/skills-index.js` | Lazy skill metadata (budget-capped listing) |
| Hooks | `src/runner/hooks/hook-dispatcher.js` | Trust-gated hooks; ledger-relative timing |
| Tools | `src/runner/tool-envelope.js` | Normalized envelopes + aliases |
| Permissions | `src/runner/permissions.js` | Severity levels (`hard_deny`, bypassable) |
| Shell policy | `src/runner/shell-policy.js` | Command scanner; `--chaos-ok` combo guard |
| Autopsy | `src/runner/loop-autopsy.js` | Read-only run analysis (`*.autopsy.json`) |
| Hints | `src/runner/beginner-hints.js` | Plain-language error catalog (cross-cutting) |

## Instruction hierarchy

Discovery order (later overrides earlier):

1. **Org** — `$BRIDGE_RUNNER_ORG_INSTRUCTIONS/`
2. **User** — `~/.bridge-runner/instructions/`
3. **Project** — `AGENTS.md`, `CLAUDE.md`, `OPENCODE.md` in `--cwd`
4. **Local** — `.bridge-runner/instructions/`, `AGENTS.local.md`

## Continuity model

- **Primary**: append-only ledger (`*.ledger.jsonl`)
- **Checkpoint**: session state JSON
- **Audit only**: transcript JSONL (no resume fallback)
- **Repair**: separate mutating pass (`--repair`, approval-gated)

## CLIs

```bash
# Kernel with session + trust
node bin/local-bridge-runner.js --trust-workspace --session-id my-run "prompt"

# Agent profile
node bin/local-bridge-runner.js --agent explore --session-id scan-1 "Map src/runner"

# Memory review
node bin/local-bridge-runner.js --review-memory --cwd .

# Ledger replay
node bin/local-bridge-runner.js --replay --session-id my-run

# Top-level coordinator
node bin/local-bridge-coordinator.js --cwd . "Summarize src/runner and stop"
```

## Promotion

See `lab-notes/PROMOTION_RITUAL.md` for the six-layer contract checklist before porting to canonical.
