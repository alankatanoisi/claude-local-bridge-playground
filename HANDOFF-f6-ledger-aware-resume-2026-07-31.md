# HANDOFF — F6 ledger-aware resume / applyRepair, 2026-07-31 (evening)

**Audience:** the next agent (any surface). **Predecessor:** `HANDOFF-n1-a3-followthrough-2026-07-31.md`.
**This chunk:** Alan authorized F6. Implement real `applyRepair` + resume-time ledger reconciliation
for the two A1 failure shapes. **Not in scope:** Safari 3 Phase B, live model calls, A1-F4/A1-F5
cleanup, DBOS, HE-05 OTel.

## Where you are

- Folder: `/Users/alanman/Developer/claude-local-bridge-playground`
- Branch: `main`
- Remote: `origin` → `alankatanoisi/claude-local-bridge-playground`
- Expectation: this handoff's commit is on `main` after Alan's "COMMIT PUSH SYNC" (confirm with
  `git log -1 --oneline` and `git status`).

## What F6 does

### Design (small, testable)

1. **`planRepair`** still describes actions, but now also inspects the **checkpoint messages**
   (not only ledger replay). New issue kinds:
   - `dangling_tool_use` — trailing assistant `tool_use` batch with no `tool_result` (A1-F3)
   - `missing_completed_effect` — ledger has a completed effect whose `toolUseId` is absent
     from checkpoint tool_results (A1-F2 stale debounce)
2. **`applyRepair(sessionPath, plan, approved)`** mutates when `approved=true`:
   - `mark_pending_aborted` → append `tool_effect_result { ok:false, aborted:true }`
   - `inject_synthetic_tool_result` → insert a contract-valid user tool_result batch
   - `inject_recovered_exchange` → append synthetic assistant+user pair for completed-but-missing effects
   - `report_gap` → never auto-applied (manual review)
3. **`reconcileForResume`** = plan + auto-approve the safe subset. Called from `run.js`
   **before** `session_started` so repair ledger events sort correctly; the run's
   `SessionLedger` is re-opened afterward so its seq cursor matches the file.

### Files

| File | Change |
| ---- | ------ |
| `src/runner/ledger-repair.js` | Real apply + reconcile + checkpoint inspection |
| `src/runner/run.js` | Early F6 reconcile on `--resume-session` |
| `bin/local-bridge-runner.js` | `--approve-repair` (with experimental `--repair`) |
| `test/runner/ledger-repair.test.js` | **new** — unit coverage for both A1 shapes |
| `test/runner/ledger-crash-recovery.test.js` | Extended: stale-checkpoint + dangling SIGKILL paths |
| `docs/durability-crash-bakeoff-2026-07-31.{md,html}` | F6 closed annotations |
| `docs/ARCHITECTURE.md` | Durability quartet row updated |
| `docs/ai-orchestration-study-review-and-next-steps-2026-07-30.html` | §7.5 F6 + next steps |
| `docs/command-builder.html` | Repair tooltip / note |
| `CLAUDE.md` | Current Work Thread pointer |

## Checks

Run at handoff time (see chat for final numbers):

```bash
cd ~/Developer/claude-local-bridge-playground
node --require ./test/setup.js --test test/runner/ledger-repair.test.js test/runner/ledger-crash-recovery.test.js
npm test
npm run lint
npm run check:docs
```

## What is still open

1. **A1-F4** — dead `orphaned_tool_use` ledger vocabulary in `replay-simulator.js` (F6 bypasses it via checkpoint inspection; cleanup is still worth doing).
2. **A1-F5** — failed resume can still write a misleading `resume_ok` health record.
3. **A3-F4** — broker should meter `cache_read_input_tokens`.
4. **DBOS arm** — still gated on Postgres.
5. **HE-05 observability half** — OTel vocabulary unpaid.
6. Safari 3 Phase B — still gated on Alan's explicit authorization.

## Hard constraints (unchanged)

- Do not touch `src/credentials.js`, `src/proxy.js`, `src/server.js`, `src/interceptors/**`.
- Prototype scratch stays in `~/Developer/orchestration-prototypes/`.
- Ledger analysis: **counts only**, never quote payload text.

## Suggested first command for the next agent

```bash
cd ~/Developer/claude-local-bridge-playground
pwd && git branch --show-current && git status --short && git log -3 --oneline
```

Then read this file + study §7.5–§7.6. Prefer A1-F4/A1-F5 or A3-F4 unless Alan names something else.
