# Durability Crash Bake-off — 2026-07-31

| Field     | Value                                                                             |
| --------- | --------------------------------------------------------------------------------- |
| Type      | Crash-recovery experiment (A1) with a landed fix                                  |
| Workspace | `~/Developer/orchestration-prototypes/a1-durability/`                             |
| Data      | 74 runner kill trials + 3 LangGraph trials, all against mocks                     |
| Fix       | SIGTERM finalizer in `src/runner/run.js` (F8); ledger-aware resume / `applyRepair` (F6, evening) |
| Test      | `test/runner/ledger-crash-recovery.test.js` + `test/runner/ledger-repair.test.js` |
| Twin      | `docs/durability-crash-bakeoff-2026-07-31.html`                                   |

**Token cost:** zero real tokens. Every trial ran against a local mock Messages server;
"tokens" below are the mock's deterministic fake usage figures, useful only as a
relative re-spend meter.

## The question

When a runner process dies mid-task, what does each durability layer actually retain,
and does `--resume-session` re-execute side effects that already happened? C3's corpus
sweep (same date) showed crashes leave `pending_effect` residue in real ledgers; this
experiment reproduces the crash on purpose and measures the consequences end to end —
including the first live test of hypothesis **F8** (SIGTERM is treated identically to
SIGKILL because nothing handles it).

## Method

One trial = fresh throwaway workspace + session under `/tmp`, one scripted mock bridge,
one runner process, one kill, one resume, full forensics. The mock issues **three
side-effecting `write_file` calls** whose filenames carry the server request number
(`effect-2-r5.txt` = "effect 2, issued by request 5"), so a re-executed effect leaves a
second file with the same effect number — double-execution is counted from files on
disk, never from timing.

Matrix: {SIGKILL, SIGTERM} × {debounce 75 ms (default), 0 ms (control)} × three kill
triggers watched on a 2 ms ledger poll (on 2nd `tool_effect_intent`; on 2nd effect file
appearing; on 2nd `tool_effect_result`) × 3 repeats, plus a no-kill baseline. The whole
matrix ran twice: before and after the fix. Clean baseline: 4 requests, 3 effects;
resume after clean completion adds exactly 1 request and re-executes nothing.

**Honesty caveat:** the mock answers instantly, so an entire run fits inside one 75 ms
debounce window — the "checkpoint stuck at 1 message" results below are the worst case.
With real model latencies the debounced checkpoint would usually be current up to the
previous turn. The exact invariant is: _whatever entered the checkpoint during the last
debounce window before signal death is lost_; the mock just makes that window cover
everything.

## Pre-fix results (36 kill trials)

| Arm (9 trials each)  | Stale checkpoint | Double-executed effects | Resume failed | Mean excess requests |
| -------------------- | ---------------- | ----------------------- | ------------- | -------------------- |
| SIGKILL, debounce 75 | 9/9              | **9/9**                 | 0/9           | +2.1                 |
| SIGTERM, debounce 75 | 9/9              | **9/9**                 | 0/9           | +2.1                 |
| SIGKILL, debounce 0  | 0/9              | 0/9                     | **8/9**       | −1.8                 |
| SIGTERM, debounce 0  | 0/9              | 0/9                     | **7/9**       | −1.6                 |

Reading the two failure shapes:

- **Default debounce → silent double-execution.** The checkpoint died inside its 75 ms
  window holding only the opening prompt. Resume "succeeded" (exit 0), but the model
  re-issued and the runner re-executed side effects that had already happened —
  every single time, 18/18. Re-spent input tokens per trial: 2,000 fake units vs 900
  for a clean-completion resume.
- **Debounce 0 → loud unresumable session.** The synchronous checkpoint faithfully
  saved a conversation ending in a dangling assistant `tool_use`. Resume then failed
  the message-contract check ("Assistant tool_use batch is not immediately followed by
  a user tool_result batch") and exited 1 after zero requests (that is what the
  negative excess-request numbers are). No double-execution — but only because resume
  was broken. The few debounce-0 `between` trials whose kill landed after the
  `tool_result` was appended resumed cleanly.

In both shapes the ledger knew the truth the whole time: `replayFromLedger` reported
`pending_effect` and `planRepair` proposed the right actions (`mark_pending_aborted`,
and the dangling-tool_use case is exactly what `inject_synthetic_tool_result` exists
for). Nothing on the resume path consulted either one during the bake-off — and
`applyRepair` was still a stub then (finding F6). **F6 closed the same evening:**
resume now calls `reconcileForResume` before continuing.

**F8 confirmed:** SIGTERM rows are statistically identical to SIGKILL rows. The polite,
catchable signal was wasted.

## The fix

`src/runner/run.js` now installs a SIGTERM handler mirroring the existing SIGINT one:
it funnels through the run's single idempotent finalizer (`finalizeRun`), which
persists the session (synchronously flushed by the store's process-exit hook), appends
the `run_stopped` ledger event, writes the health record and autopsy, and exits 143
(128 + SIGTERM). Node delivers signals on the event loop, so the handler runs _after_
the current synchronous tool batch — the flushed checkpoint is always contract-valid.

## Post-fix results (36 kill trials)

| Arm (9 trials each)  | Stale checkpoint | Double-executed effects | Resume failed | Ledger tail   |
| -------------------- | ---------------- | ----------------------- | ------------- | ------------- |
| SIGKILL, debounce 75 | 9/9              | 9/9                     | 0/9           | mid-run       |
| SIGKILL, debounce 0  | 0/9              | 0/9                     | 7/9           | mid-run       |
| SIGTERM, debounce 75 | **0/9**          | **0/9**                 | **0/9**       | `run_stopped` |
| SIGTERM, debounce 0  | **0/9**          | **0/9**                 | **0/9**       | `run_stopped` |

All 18 SIGTERM trials, at every kill point and both debounce settings: consistent
ledger closed by `run_stopped`, checkpoint containing the completed tool exchange,
health record written (`lastStopReason: cancelled`), resume exits 0 with **zero**
double-executions, and total cost exactly one extra request (1,400 vs 1,400 fake input
tokens — identical to resuming a cleanly finished session). SIGKILL rows are unchanged
pre/post, as expected: an uncatchable signal cannot be handled, only survived by
better recovery.

Regression check: full suite passes, 799/799 (797 pre-existing + the 2 new crash
tests).

## Comparison arms

**LangGraph 1.0.x + `SqliteSaver`** (throwaway `uv` venv in the workspace; 3 trials):
same protocol — three side-effecting graph nodes, SIGKILL while node 2 is mid-flight
(its file written, its checkpoint not), resume on the same thread. Result 3/3:
completed node preserved exactly-once, **interrupted node re-executed** (two files for
node 2), remaining node ran once, resume exits 0. So the industry checkpointer is
_at-least-once for the interrupted step, exactly-once for completed steps, with a
resume that works by design_. That equals our debounce-0 checkpoint currency plus a
functioning resume — better than our pre-fix default on both axes, and it still
double-executes the step it was killed inside. Our post-fix SIGTERM path beats it for
catchable signals (zero re-execution); for SIGKILL our runner is currently worse
(default: replays everything; debounce 0: refuses).

**DBOS:** not run — requires Postgres and no Postgres binaries exist on this machine.
Its claim (exactly-once steps via transactional workflow state) remains a literature
citation, not a measured result.

## Findings

| ID    | Finding                                                                                                                                                                                                                                                                                                         |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1-F1 | **F8 confirmed and fixed for SIGTERM.** Pre-fix, SIGTERM ≡ SIGKILL (18/18 stale checkpoint + double-execution). Post-fix, 18/18 clean. SIGKILL unchanged, by definition.                                                                                                                                        |
| A1-F2 | **Default debounce turns crash-resume into silent at-least-twice execution.** 18/18 pre-fix default-debounce trials re-executed a completed side effect. Real-latency runs shrink but do not close the window.                                                                                                  |
| A1-F3 | **A contract-valid checkpoint is not the same as a resumable one.** Synchronous checkpoints saved mid-tool die on the message-contract check; resume never consults the ledger or `planRepair`, so the session is stranded (15/18 pre-fix debounce-0 resumes failed). `applyRepair` (F6) is the missing bridge. **Closed 2026-07-31 evening:** `reconcileForResume` injects synthetic `tool_result`s for dangling batches and marks matching pending ledger intents aborted. |
| A1-F4 | **Replay's `orphaned_tool_use` detection is dead code on real ledgers.** The runner's ledger vocabulary (10 event types) never includes `assistant_message` / `tool_result_message`, so that branch and `messagesEstimate` cannot reflect reality. *(F6 now detects dangling tool_use from the checkpoint itself; A1-F4's dead ledger vocabulary is still a small cleanup.)* |
| A1-F5 | **A failed resume leaves a misleading health record**: `message_contract_error` is not in the degraded-stop-reason set, so health says `resume_ok` right after resume just failed. |

## What this feeds

- **F6 (`applyRepair` / ledger-aware resume) — closed 2026-07-31 evening.**
  `applyRepair` mutates when approved; `--resume-session` calls `reconcileForResume`
  before `session_started` so the two A1 shapes are fixed automatically:
  (1) stale checkpoint → `inject_recovered_exchange` for ledger-completed effects;
  (2) dangling tool_use → `inject_synthetic_tool_result` + `mark_pending_aborted`.
  Tests: `test/runner/ledger-repair.test.js`, extended
  `test/runner/ledger-crash-recovery.test.js`. CLI: experimental `--repair` plus
  `--approve-repair` to mutate explicitly.
- A1-F4/A1-F5 remain small, testable follow-ups for the concordance backlog.

## Provenance

Harness (outside git): `mock-bridge.js`, `run-trial.js`, `run-matrix.js`,
`lg-graph.py`, `lg-crash.js` under `~/Developer/orchestration-prototypes/a1-durability/`;
raw per-trial JSON under `results/` (`pre-fix-*`, `post-fix-*`, `langgraph-crash.json`).
Repo changes: SIGTERM handler in `src/runner/run.js`;
`test/runner/ledger-crash-recovery.test.js`.
