# Promotion Ritual — Playground to Canonical

This document defines the maturity gate for moving harness hardening work from
`claude-local-bridge-playground` (`playground/local-runner-chaos`) into the
canonical repo at `claude-local-bridge` (`codex/runner-clean-pr`).

## When to Promote

Promote only after **all** checklist items pass in the playground. Do not open a
canonical PR from half-finished experiments.

## Pre-Flight

1. Confirm folder: `/Users/alanman/Developer/claude-local-bridge-playground`
2. Confirm branch: `playground/local-runner-chaos`
3. Run targeted runner tests:

```bash
node --require ./test/setup.js --test test/runner/*.test.js
```

4. Run repo checks:

```bash
npm run lint
npx prettier --check <touched files>
```

## Six-Layer Contract Test Checklist

Each layer must have **at least one passing contract test** before promotion.

| Layer | What must work | Example tests |
| ----- | -------------- | --------------- |
| **Memory** | Instruction hierarchy, four-type auto-memory, review queue | `instruction-hierarchy.test.js`, `memory-taxonomy.test.js` |
| **Skills** | Lazy index, budget-capped listing | `context-budget.test.js`, `harness-architecture.test.js` |
| **Tools / Safety** | Trust gate, permission severity, shell policy, envelopes | `workspace-trust.test.js`, `permission-explainer.test.js`, `bash.test.js` |
| **Context** | Progressive disclosure, reactive compaction | `context-budget.test.js`, `reactive-compaction.test.js` |
| **Coordination** | Spec compiler, agent profiles, fork boundary | `coordinator-spec.test.js`, `agent-profiles.test.js` |
| **Lifecycle** | Ledger, replay, autopsy, hooks, bootstrap | `session-ledger.test.js`, `replay-simulator.test.js`, `hook-ledger-ordering.test.js`, `bootstrap-stages.test.js` |

Cross-cutting: **beginner hints** on every new error path (`beginner-hints.test.js`).

## Safety and Docs Gate

- [ ] `docs/threat-model.md` updated if permission or trust behavior changed
- [ ] `docs/runner-quickstart.html` documents new CLI flags (`--trust-workspace`, `--chaos-ok`, `--agent`, `--review-memory`, `--replay`, `--repair`, budgets)
- [ ] `docs/command-builder.html` includes new flags
- [ ] Bridge boundary respected (no edits to `src/server.js`, `src/proxy.js`, credentials, interceptors)
- [ ] `lab-notes/AGENT_OS_ARCHITECTURE.md` reflects current design

## Port Plan (Manual)

1. Write a short port note: files to copy, files to **not** copy, known playground-only stubs.
2. Cherry-pick or replay commits into `/Users/alanman/Developer/claude-local-bridge` on `codex/runner-clean-pr`.
3. Re-run the same test checklist in canonical.
4. Open PR only after Alan reviews the port plan.

## Playground-Specific Rules

## Playground push policy

Playground **push is intentionally re-enabled** for Alan's personal backup on branch `playground/local-runner-chaos`. It is not for production and must not overwrite canonical branches. See `lab-notes/PLAYGROUND_GIT_REMOTE.md` for the full rationale and safe push steps.

Promotion to canonical remains **manual** — optional port after review, not an automatic merge.

## Post-Promotion

- Archive or reset playground experiment branch if no longer needed.
- Update `OPENCODE.md` / `README.md` in canonical with new runner capabilities.
