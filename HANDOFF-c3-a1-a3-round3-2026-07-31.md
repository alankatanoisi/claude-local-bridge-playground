# HANDOFF — Prototyping round 3 (C3 → A1 → A3), 2026-07-31

**Status: PARTIALLY EXECUTED. Code written but NEVER RUN.**
**Written by:** Claude Code (VS Code), 2026-07-31.
**Blocked by:** the auto-mode Bash safety classifier became unavailable
(`claude-opus-5[1m] is temporarily unavailable, so auto mode cannot determine the safety of Bash`).
Every `Bash` call was refused for the second half of the session while `Read` kept working. So all
source edits below are **unverified**: not syntax-checked, not linted, not tested, never executed.

**First action for whoever picks this up: run the verification block in §6 before trusting anything.**

---

## 1. Why this work exists

The 2026-07-31 slice (L1/H2/H1/W1) tested _external_ substrates — a stub bridge, `srt`, CodeAct,
a worker contract. It never tested the runner's **own** orchestration and durability claims, which
`docs/ai-orchestration-study-review-and-next-steps-2026-07-30.html` §3 presents as already-mapped
(`budget-broker` = scheduler/budget layer, `session-ledger` = durability layer).

Alan chose three experiments for this round, in this order, with runner source edits in scope and a
generous token budget:

| ID     | Experiment                                                    | State                                                   |
| ------ | ------------------------------------------------------------- | ------------------------------------------------------- |
| **C3** | Read-only forensics sweep of every real session ledger        | script written, **never run**                           |
| **A1** | `kill -9` crash-recovery durability on our own substrate      | **not started** (design in §5)                          |
| **A3** | Coordinator fan-out: fix budget leasing, then live field test | **step 1 code written, unverified**; step 2 not started |

## 2. Verified findings (read-only, source-confirmed)

These were confirmed by reading source, not by running anything, so they are safe to rely on.

| #      | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Evidence                                                                                                                                                                   |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F1** | `runPhasePlan` / `groupPhasePlanByDeps` were called **only from tests**. `Coordinator.run` spawned exactly one research worker, sequentially. Concurrency was built, exported, unit-tested, and never wired into the run path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `src/runner/coordinator.js` (pre-edit lines 63, 101-136); sole caller `test/runner/coordinator-parallel.test.js`                                                           |
| **F2** | The compiled `phasePlan` is a **serial** chain (`inspect → apply → verify`) by its own comment, so there was zero fan-out even if the executor had been wired.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `src/runner/coordinator-spec-compiler.js:76-84`                                                                                                                            |
| **F3** | **The coordinator copied the ceiling instead of leasing it.** `createBudgetBroker` is called in exactly one place (`run.js:684`, inside the runner loop). The coordinator's `spawnWorker` spec omitted `budgetRemaining` and `leaseId` — the only two fields `worker-runtime` actually enforces. Masked today because it spawns one worker at a time; a 4-way fan-out would have let each child spend up to the full ceiling.                                                                                                                                                                                                                                                                                                                                                                                          | `src/runner/run.js:684`; `src/runner/coordinator.js` (pre-edit 104-131, 194-222); `src/runner/worker-runtime.js:105-140`                                                   |
| **F4** | The coordinator CLI exposed **no** cost/token ceiling flag, so `input.maxCostUsd` was always `undefined` there.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `bin/local-bridge-coordinator.js` (pre-edit 19-32, 68-77)                                                                                                                  |
| **F5** | Crash recovery has **never been tested against process death**: no test under `test/runner/` uses `SIGKILL`/`process.kill`, and no test references `ledger-repair`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `test/runner/` sweep; `ledger-repair.js` required only by `bin/local-bridge-runner.js`                                                                                     |
| **F6** | `applyRepair` is a **stub** — returns `{applied: true}` without mutating anything — and `--repair` is env-gated (`BRIDGE_RUNNER_EXPERIMENTAL=1`) and calls it with `approved=false`. Detect ✅ plan ✅ apply ❌.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `src/runner/ledger-repair.js:50-55`; `bin/local-bridge-runner.js:305-326`                                                                                                  |
| **F7** | `~/.bridge-runner/sessions` holds **141 `.ledger.jsonl` files** (60 with a `.state.json` sibling, 57 with a `.cursor.json`), not 306 sessions — 306 was the raw _file_ count including cursors and autopsies. Corrects the figure in the approved plan.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `ls ~/.bridge-runner/sessions`                                                                                                                                             |
| **F8** | **The two durability surfaces disagree under signal death.** The ledger is written **synchronously** (`fs.writeSync` on a kept-open fd + atomic cursor sidecar) so it survives. But `--resume` never reads the ledger — it hydrates from `sessionStore.messages`, i.e. the `state.json` checkpoint, written by a **75 ms debounced `setTimeout`** whose timer is `unref`'d. The flush net is `process.on('exit')` + `uncaughtException`, **neither of which fires on signal death**, and there is a `SIGINT` handler but **no `SIGTERM` handler anywhere**. Separately, `buildHealth` derives `degraded` from a _completed_ run's `stopReason`, so a killed run writes no health record and `assertResumeAllowed` sees stale-or-absent health — resume proceeds from a possibly-stale checkpoint with no crash signal. | `src/runner/session-ledger.js:126-149`; `src/runner/run.js:1044`, `run.js:933`; `src/runner/session-store.js:17,34-38,173-204`; `src/runner/session-health.js:29-33,41-77` |

**F8 is the sharpest lead in this handoff.** SIGKILL is unfixable by definition, but **SIGTERM is
catchable**, so a `process.on('SIGTERM', flushAll)` would close a real durability hole and is
deterministically testable. That is a candidate fix A1 should either justify or refute with data.

Also worth recording: three of these (F1, F2, F5) are the same shape — machinery built, exported,
unit-tested, given a tracker ID, and never connected to the run path. That failure mode is invisible
to a suite that only tests units.

## 3. Source changes made (UNVERIFIED — never run)

### 3.1 `src/runner/coordinator.js` — leases + fan-out (F1/F3)

- Added `require('./budget-broker')` and a frozen `RESEARCH_TOOLS` constant (the 6-tool read-only set
  that was duplicated inline at the research and verify spawn sites).
- **`computeLeaseRequest(broker, totalUsage, divisor)`** — new. This is the crux. `broker.acquire(usage)`
  with **no** `request` argument claims the **entire** unleased remainder (`budget-broker.js:75-82`),
  which is correct for `tools/spawn-agent.js` (one child at a time) but wrong for a fan-out: the first
  child would take everything and its siblings would be refused. Returns `{}` when uncapped or
  `divisor <= 1`, so the old behaviour is preserved exactly.
- **`batchSizeById(phasePlan)`** — new; maps each node id to the size of its dependency-free batch so a
  concurrent sibling knows how many ways to split.
- **`refusedWorkerResult(phase, reason)`** — new; the shape returned when the budget refuses a spawn.
- **`Coordinator._spawnLeasedWorker(spec, options, budget)`** — new method implementing
  acquire → spawn → release/reconcile, deliberately mirroring `tools/spawn-agent.js:92-195`
  (including its refusal path) rather than inventing a second scheme. Releases with `null` usage on a
  thrown spawn so the child is marked incomplete instead of holding a reservation.
- In `run()`: creates the broker from new inputs `budgetInputTokens` / `budgetOutputTokens`, tracks a
  `totalUsage` accumulator, and hoists the previously-duplicated `inherit` object into `inheritFor()`
  and the worker options into `workerOptions`.
- **Research phase**: when `input.researchPlan` is a non-empty array, runs it through the existing
  `runPhasePlan` — one worker per node, remainder split per batch — and emits a `research_fanout`
  system event. With no `researchPlan`, spawns exactly one worker as before (now leased). **This is the
  first time anything in the run path calls `runPhasePlan`.**
- **Verify phase**: switched to `_spawnLeasedWorker`.
- Result object gains `budget: broker.snapshot(totalUsage)` and `childUsage`, on both the success path
  and the spec-rejected early return, so a field test can check the invariant afterwards.
- Exports added: `RESEARCH_TOOLS`, `computeLeaseRequest`, `batchSizeById`.

### 3.2 `bin/local-bridge-coordinator.js` — ceilings + plan input (F4)

- Added `fs` require.
- New flags: `--max-cost-usd`, `--budget-input-tokens`, `--budget-output-tokens`,
  `--max-wall-clock-ms`, `--no-network`, `--trace-level`, `--research-plan <file>`. `Coordinator.run`
  already read every one of these input keys; only the CLI surface was missing.
- `num()` helper validates numeric flags and keeps "absent" distinct from `0` (a `0` cap would refuse
  every worker).
- `--research-plan` is read, JSON-parsed, and validated (non-empty array, every node has a non-empty
  string `id`) **before any worker spawns or any token is spent**.
- Help text documents all of it.

### 3.3 `test/runner/coordinator-lease.test.js` — new, 6 tests

Injects a stub `workerRuntime` (the `Coordinator` constructor already accepts `options.workerRuntime`),
so **no child process is spawned and no model is called**. Uses a temp `sessionBaseDir` and
`noArchive: true` so it never touches `~/.bridge-runner`. Asserts:

1. four concurrent nodes each get a **distinct** `leaseId`, peak concurrency is 4, the summed leases
   stay within the caps, no child receives the whole cap (the pre-lease bug), child usage is
   reconciled, and no lease is left held;
2. an exhausted remainder **refuses** rather than spawning unbudgeted (0 spawns, 4 refusals);
3. the no-`researchPlan` path still spawns exactly one worker which may hold the full remainder;
4. an uncapped run is unconstrained (`leaseId: null`, `budgetRemaining: null`) and still fans out;
5. dependent nodes land in later batches and split per batch (root alone gets the full remainder;
   its two children split what's left);
6. a throwing spawn rejects without leaking the lease.

### 3.4 C3 sweep script — staged in the scratchpad, not in the prototypes dir

Currently at
`/private/tmp/claude-501/-Users-alanman-Developer-claude-local-bridge-playground/2187235e-5635-453c-96d2-0efad876aaa0/scratchpad/sweep.js`
because writes to `~/Developer/orchestration-prototypes/` also needed the dead classifier.
**Move it to `~/Developer/orchestration-prototypes/c3-ledger-forensics/sweep.js`** (it writes results
next to itself, into `./c3-results/` — rename that to `./results/` after moving if you want to match
the plan).

What it does: drives off `*.ledger.jsonl` files (not `.state.json`, since 81 ledgers have no state
sibling), reverses the `ledgerPathForSession` transform to synthesise a session path, calls
`replayFromLedger` per ledger inside a try/catch, and aggregates **counts only** — no event payload
text, because real ledgers contain prompts and paths. Cross-tabs by session size and by day.

It also measures a **guard asymmetry** worth knowing about: `session-ledger.js` reconstructs
`pendingIntents` two different ways. `append()` (line ~141) opens an intent **only if
`payload.effectId` exists**; `_loadLastSeq()` (line ~94) has **no such guard**, and the clear at
line ~98 requires `ev.effectId`. So a `*_intent` event lacking an `effectId` becomes a permanently
pending intent on the scan path but not on the cursor path — meaning the same ledger can report
different `pending_effect` counts depending on whether a `.cursor.json` sidecar happens to exist. The
sweep reports reported/guarded/unguarded counts per ledger so any divergence is visible.

## 4. Not done

- **C3 run + report.** Script ready; `docs/ledger-forensics-sweep-2026-07-31.{md,html}` unwritten.
- **A1 entirely.** See §5.
- **A3 step 2** (live 4-way fan-out + sequential baseline + `docs/ARCHITECTURE.md`).
- **Study annotation.** `docs/ai-orchestration-study-review-and-next-steps-2026-07-30.html` §7 should
  record F1–F8. Note F7 corrects "306 sessions" to "141 ledgers" in the approved plan.
- **No checks run at all** — not `npm test`, not `lint`, not `check:docs`, not `format:check`.
  Prettier will very likely want to reformat the new code.

## 5. A1 design (ready to build)

Scratch at `~/Developer/orchestration-prototypes/a1-durability/`. Near-zero tokens — stub model only.

1. Extend L1's `mock-bridge.js` (`~/Developer/orchestration-prototypes/l1-stub-harness/mock-bridge.js`)
   into a scripted multi-turn server issuing several **side-effecting** tool calls (`write_file` /
   `edit_file`) so there is something to double-count. Keep `requests.log` — it is the re-spent-token meter.
2. Fixture project plus a counter file each effect appends to, so executions are countable by content
   hash rather than mtime.
3. Crash driver: spawn the runner with `--bridge-url` at the mock, `--accept-edits`, and a
   **throwaway `--session-path`** (never the real 141), then `kill -9` at three points found by tailing
   the ledger: (a) intent recorded, effect not yet; (b) mid `tool_result`; (c) between turns.
4. Per crash point measure: what `replayFromLedger` reports; what `planRepair` proposes (remembering
   **F6**: apply is a stub); **whether `--resume` re-executes the side effect** (the core P2 question);
   and re-spent tokens from `requests.log`.
5. **Test F8 explicitly:** compare `kill -9` against `kill` (SIGTERM), and try
   `BRIDGE_RUNNER_SESSION_DEBOUNCE_MS=0` as a control. Hypothesis: SIGTERM loses checkpoint writes
   inside the 75 ms debounce window that the ledger retained, and adding a `SIGTERM` flush handler
   fixes it. Confirm or refute with numbers.
6. **Deliverable test:** `test/runner/ledger-crash-recovery.test.js` — the repo's first test using
   `process.kill`. Keep it deterministic and fast (ephemeral port, tiny fixture, temp session path).
   SIGTERM is the deterministic half; treat SIGKILL timing as best-effort.
7. Doc: `docs/durability-crash-bakeoff-2026-07-31.{md,html}` — arm × crash point × re-executed effects
   × re-spent tokens × recovery outcome. Comparison arms: runner (core, always); LangGraph re-run with
   **`SqliteSaver`** (the 07-30 figure of 2×/N+1 used `InMemorySaver`, which cannot survive process
   death); DBOS **only if Postgres is available** — if not, say so explicitly rather than dropping it.

## 6. Verification block — RUN THIS FIRST

```bash
cd ~/Developer/claude-local-bridge-playground
git status --short                     # expect: modified coordinator.js, local-bridge-coordinator.js; new test + this file

# 1. does it even parse?
node --check src/runner/coordinator.js
node --check bin/local-bridge-coordinator.js
node --check test/runner/coordinator-lease.test.js

# 2. the new tests, then the ones most likely to regress
node --require ./test/setup.js --test test/runner/coordinator-lease.test.js
node --require ./test/setup.js --test test/runner/coordinator-parallel.test.js
node --require ./test/setup.js --test test/runner/coordinator-spec.test.js
node --require ./test/setup.js --test test/runner/budget-broker.test.js
node --require ./test/setup.js --test test/runner/p0-08-worker-confinement.test.js
node --require ./test/setup.js --test test/runner/harness-architecture.test.js

# 3. CLI surface smoke (no model, no spend)
node bin/local-bridge-coordinator.js --help

# 4. full gate
npm test && npm run lint && npm run check:docs && npm run format:check
# npm run format   # if format:check complains about the new code
```

Then C3:

```bash
mkdir -p ~/Developer/orchestration-prototypes/c3-ledger-forensics
# move sweep.js there from the scratchpad path in §3.4, then:
node ~/Developer/orchestration-prototypes/c3-ledger-forensics/sweep.js
```

### Known risks in the unverified code

1. `harness-architecture.test.js` imports `synthesizeSpec` from `coordinator.js` — I did not touch that
   function, but the module changed, so run that test.
2. Refused workers are pushed into `artifacts.workerResults` with empty `claims`. `compileSpec` may
   judge the resulting digest vague and reject the spec. Acceptable (fail-loud), but expect it in a
   budget-starved fan-out.
3. `totalUsage` is a shared mutable object closed over by concurrent spawns. Safe in single-threaded
   Node because mutation happens after `await`, but it is the thing to look at first if lease
   accounting looks wrong.
4. Formatting almost certainly not prettier-clean.

## 7. Boundaries (unchanged, still binding)

- No edits to `src/credentials.js`, `src/proxy.js`, `src/server.js`, `src/interceptors/**`. None made.
- `src/runner/safety.js` and `src/runner/permissions.js` untouched. Keep it that way in this round —
  N1 (gate keys only on `args.path`) is a separate slice.
- **Do not implement `applyRepair`** in this round. F6 gets documented, not fixed; mutating ledger
  repair needs its own approval.
- Safari 3 Phase B live probes remain gated on Alan's explicit authorization.
- Prototypes stay in `~/Developer/orchestration-prototypes/` (not in git); only result docs land in the repo.
- No unbounded swarms: the fan-out is a fixed, explicitly-passed plan with leases.
- Claude and Codex playgrounds stay separate.

## 8. Handoff fields

| Field            | Value                                                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Folder           | `~/Developer/claude-local-bridge-playground` (playground clone)                                                                                                                            |
| Branch           | `main`, clean at session start (`21acd02`)                                                                                                                                                 |
| Files changed    | `src/runner/coordinator.js`, `bin/local-bridge-coordinator.js` (both **unverified**); new `test/runner/coordinator-lease.test.js`; new `HANDOFF-c3-a1-a3-round3-2026-07-31.md` (this file) |
| Outside the repo | C3 sweep script staged in the session scratchpad (§3.4)                                                                                                                                    |
| Checks run       | **NONE.** Bash was unavailable for the whole implementation phase.                                                                                                                         |
| Token spend      | Zero live model calls. No bridge requests.                                                                                                                                                 |
| Skipped          | C3 run, A1 entirely, A3 step 2, study annotation, all checks                                                                                                                               |
| Not committed    | Nothing committed, nothing pushed                                                                                                                                                          |
| Risks            | §6 "Known risks"; the headline risk is that none of this code has ever been executed                                                                                                       |
