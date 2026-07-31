# HANDOFF — N1 + A3-F1/F2 follow-through, 2026-07-31 (evening)

**Audience:** the next agent (any surface). **Predecessor:** `HANDOFF-round3-results-2026-07-31.md`
(morning round 3: C3 / A1 / A3). **This chunk:** the cheap independent slice that round 3 deferred —
N1 path-arg contract + A3 exit-code / maxTokens. **Not in scope:** F6 / ledger-aware resume
(still needs Alan's explicit authorization).

## Where you are

- Folder: `/Users/alanman/Developer/claude-local-bridge-playground`
- Branch: `main`
- Remote: `origin` → `alankatanoisi/claude-local-bridge-playground`
- Expectation: working tree should be clean after the push that closed this handoff. Confirm with
  `git status` and `git log -1 --oneline`.

## What this chunk did

### N1 — path-arg contract (closed)

- `src/runner/tool-catalog.js`: `CANONICAL_PATH_ARG_KEYS` + `pathArgKeysFor(toolName)` (honors
  `meta.pathArgs` when present; otherwise infers from schema).
- `src/runner/permissions.js`: gate loops **every** catalogued path key through
  `resolveFileTarget` (no longer `args.path` only). Unknown tools still fall back to
  `path` / `file_path`.
- New test: `test/runner/path-arg-contract.test.js`.

### A3-F1 — coordinator exit code (closed)

- `bin/local-bridge-coordinator.js`: `exitCodeForCoordinatorResult(result)`.
  Research-only / no-execute runs exit **0** when `error` is null. Execute phase still keys on
  `kernelResult.stopReason === 'success'`.
- New test: `test/runner/coordinator-exit-code.test.js`.

### A3-F2 — worker maxTokens (closed)

- `src/runner/child-inherit.js`: `maxTokens` in bag → `--max-tokens` on child argv + manifest.
- `src/runner/coordinator.js`: `inheritFor({ maxTokens })`; plan nodes may set `maxTokens`.
- Tests extended in `coordinator-lease.test.js` and `child-inherit.test.js`.
- CLI help updated.

## Docs updated

- Study: `docs/ai-orchestration-study-review-and-next-steps-2026-07-30.html` §7.2 (N1 closed),
  §7.4 item 1 annotated, **new §7.6**, §8 next-steps pointed at F6.
- A3 field-test findings table: `docs/coordinator-fanout-field-test-2026-07-31.md`.
- `CLAUDE.md` Current Work Thread pointers.
- Session report for Alan: `docs/session-report-round3-followthrough-2026-07-31.html`.

## Checks (this chunk)

- `npm test` → **810/810 pass** (was 799 after morning; +N1/A3 tests and related).
- `npm run lint` clean.
- Prettier / `check:docs` run at handoff time (see chat if anything drifted).

## What is still open (do not invent work)

1. **F6 — ledger-aware resume / `applyRepair`** (sharpest). Needs Alan saying yes. Design
   notes live in `docs/durability-crash-bakeoff-2026-07-31.md` (A1-F2/F3) and
   `docs/ARCHITECTURE.md` durability section. Do **not** implement without authorization.
2. **A3-F4** — broker should eventually meter `cache_read_input_tokens` (telemetry first).
3. **A1-F4 / A1-F5** — small: dead `orphaned_tool_use` vocabulary; misleading `resume_ok` health.
4. **DBOS arm** of the durability bake-off — gated on Postgres.
5. **HE-05 observability half** — ARCHITECTURE.md exists; OTel vocabulary still unpaid.
6. Safari 3 Phase B live probes — still gated on Alan's explicit authorization
   (`HANDOFF-safari-3-remediation-plan-2026-07-25.md`).

## Hard constraints (unchanged)

- Do not touch `src/credentials.js`, `src/proxy.js`, `src/server.js`,
  or `src/interceptors/**` unless Alan asks.
- Prefer not to reopen `safety.js` / `permissions.js` for unrelated work; N1 already touched
  permissions for the path-arg loop — leave it unless a real regression appears.
- Prototype scratch stays in `~/Developer/orchestration-prototypes/` (outside git).
- Ledger analysis: **counts only**, never quote payload text.

## Suggested first command for the next agent

```bash
cd ~/Developer/claude-local-bridge-playground
pwd && git branch --show-current && git status --short && git log -3 --oneline
```

Then read this file + `HANDOFF-round3-results-2026-07-31.md` + study §7.5–§7.6 before choosing work.
If Alan wants the big durability chunk, start from A1 bake-off + `ledger-repair.js` + resume path
in `run.js` / `session-health.js`.
