# Bridge-Runner Architecture

**Doc type:** durable reference. **Facts verified as of 2026-07-31** by direct code reading,
the A1 crash bake-off, and the A3 coordinator field test (whose four live read-only research
workers each surveyed one layer of this document — see
`docs/coordinator-fanout-field-test-2026-07-31.md`). Perishable status does not belong here;
dated experiment docs under `docs/` carry the current state of any open gap.

## The two products in this repo

| Layer      | What it is                                                                                                                                  | Where it lives                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Bridge** | VS Code extension exposing Claude Code OAuth credentials as a local Anthropic Messages endpoint (`POST http://localhost:11437/v1/messages`) | `src/server.js`, `src/proxy.js`, `src/credentials.js`, `src/interceptors/**` |
| **Runner** | Experimental local coding-agent loop on top of that endpoint                                                                                | `src/runner/**`, `bin/local-bridge-runner.js`                                |

The bridge is treated as transport plumbing: native Messages route only, OAuth Bearer only,
no OpenAI-compatible routes, no API-key fallbacks. The runner is the active product surface.
Everything below is the runner.

## The core loop

```text
prompt → POST /v1/messages → model response
       → tool_use blocks → permission gate → local tool execution → tool_result
       → repeat until end_turn / a stop reason fires
```

- `src/runner/run.js` — the loop itself, ~1,700 lines. Owns option resolution, context
  projection/compaction, the tool pipeline, every stop reason, and a **single idempotent
  terminal finalizer** (`finalizeRun`) that all exits funnel through: terminal output event,
  trace event, transcript flush, `run_stopped` ledger event, autopsy, session persistence,
  exit code. SIGINT and (since 2026-07-31) SIGTERM route through the same finalizer.
- `src/runner/model-client.js` — buffered and SSE-streaming clients for the bridge endpoint.
- `src/runner/tool-pipeline.js` — executes tool batches; brackets every tool call with
  ledger events (`tool_effect_intent` before, `tool_effect_result` after, same `effectId`,
  including on throw/deny) and tracks the consecutive-failure streak.
- `src/runner/kernel/agent-kernel.js` — a thin wrapper normalizing one `run()` invocation
  into a stable `KernelResult` contract. No orchestration logic of its own.

## Tools, permissions, safety

- `src/runner/tool-registry.js` dispatches tools. The **default surface is the core
  read/session tools only**; write tools arrive via `--capabilities edits` (or explicit
  `--tools`/`--allowed-tools`), shell only via `--allow-shell`, advanced patch mode is
  hidden unless enabled. Capability groups, not a flat menu. Agent/capability _profiles_
  are retired; do not reintroduce them.
- `src/runner/permissions.js` — allow/ask/deny/plan-only decision engine layering authority
  ceiling, path checks, shell policy, and per-tool policy. For any tool argument named
  `path` it consults safety's `resolveFileTarget` first and hard-denies before mode rules
  apply. (Known residual N1: the gate inspects an argument _literally named_ `path`.)
- `src/runner/safety.js` — the chokepoint: path confinement (`confinePath`), the two-tier
  deny matrix (directory segments like `.ssh`/`.aws`/`.claude` plus sensitive basenames
  like `.env`, keys, tokens), `resolveFileTarget` (lexical + realpath + containment, so an
  innocently-named symlink to a denied target is caught), environment scrubbing, and secret
  redaction. File tools re-check in `execute` (HE-01 defense-in-depth).
- `src/runner/redaction-boundary.js` — every sink (tool results, transcripts, stream/JSON
  output, human logs, ledger payloads, session checkpoints) passes through one central
  redaction boundary. OAuth tokens and fingerprints are sensitive local account state.

## Durability quartet

Measured end-to-end by the A1 crash bake-off (`docs/durability-crash-bakeoff-2026-07-31.md`):

| Piece                                  | Role                                                                                                                                                                     | Crash behaviour (measured)                                                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session-store.js` (`*.state.json`)    | Debounced (75 ms default) atomic-write JSON checkpoint of API messages + runner metadata; the thing `--resume-session` actually loads                                    | Whatever entered the debounce window before signal death is lost; flushed synchronously on `process.exit` and, via the finalizer, on SIGINT/SIGTERM |
| `session-ledger.js` (`*.ledger.jsonl`) | Append-only, sequence-numbered event log written synchronously (10 event types incl. the intent/result effect pairing); cursor sidecar (`*.cursor.json`) for fast resume | Survived byte-perfect in all 74 A1 kill trials and showed zero corrupt tails across the 141-ledger C3 corpus                                        |
| `replay-simulator.js`                  | Read-only consistency check: sequence gaps, pending (unresolved) effect intents, orphaned tool uses                                                                      | Correctly classified every induced crash; note the orphaned-tool-use branch keys on event types the runner never emits (A1-F4)                      |
| `ledger-repair.js`                     | `planRepair` proposes actions; `applyRepair` mutates when approved; `reconcileForResume` auto-applies the safe subset on `--resume-session` (F6 closed 2026-07-31) | Closes A1 stale-checkpoint double-execution and dangling-tool_use strands; `report_gap` stays manual-only |

The structural gap that A1 measured is **closed for resume**: the checkpoint is reconciled against
the ledger before the run continues. SIGKILL can still interrupt an in-flight effect (at-least-once
for the interrupted step); completed effects are reconstructed so they are not silently re-run.

## Budget broker and child leasing

- `src/runner/budget-broker.js` — holds per-run input/output token caps and issues
  **leases**. Invariant (field-verified 2026-07-31): on every capped dimension,
  `sum(active leases) + totalUsage ≤ cap`, and every child's usage is either reconciled
  into `totalUsage` or recorded as `incomplete[]` — never silently lost or double-counted.
  Null caps make leasing a no-op.
- `src/runner/tools/spawn-agent.js` — in-run delegation to one read-only child, using the
  acquire → spawn → release/reconcile pattern.
- The coordinator splits the unleased remainder across each concurrent batch
  (`computeLeaseRequest`, remainder ÷ batch size), so fan-out siblings cannot each claim
  the whole ceiling.
- Known telemetry limits: the broker meters uncached tokens only (cache reads/creation are
  reported by workers but not folded in — A3-F4), and the in-process execute phase is not
  leased (its usage sits outside the broker snapshot).

## Orchestration stack

```text
bin/local-bridge-coordinator.js          (CLI: objective, phases, ceilings, --research-plan)
  └─ src/runner/coordinator.js           research → synthesize → execute → verify
       ├─ research/verify: WorkerRuntime.spawnWorker — out-of-process child runners,
       │    read-only tool set, leased budgets, results parsed from stdout JSON
       ├─ synthesize: coordinator-spec-compiler.compileSpec — local, no tokens
       └─ execute: runKernel — in-process, full loop, edits allowed
```

- `--research-plan` takes a JSON array of `{ id, deps[], prompt, allowedTools?, maxSteps? }`
  nodes; `groupPhasePlanByDeps` topologically batches them and dependency-free nodes run
  concurrently (`Promise.all`). Field-measured: 4-way fan-out gave a 4.13× wall-clock
  speedup at identical token cost versus the dep-chained sequential baseline.
- `src/runner/worker-runtime.js` spawns each worker as a separate `local-bridge-runner.js`
  process, **narrowing** authority against the parent ceiling (children may only narrow,
  never widen: flags AND-ed, tools intersected), passing lease + inherit values via
  argv/env, and never passing `--trust-workspace` (only `--inherit-workspace-trust`).
- Workers are pinned to the runner CLI's default of 2,000 output tokens per request; no
  plan or inherit knob raises it today (A3-F2).

## Session artifacts on disk

Under `~/.bridge-runner/sessions/`: `*.state.json` (checkpoint), `*.ledger.jsonl` (event
log), `*.cursor.json` (resume cursor), autopsy files; per-project recovery manifests under
`<cwd>/.bridge-runner/runs/` power `undo last-run`. All artifact writers go through the
private-dir/0600 + redaction path. Transcript JSONL is an audit log, not a resume source —
transcript resume is rejected at the CLI.

## Where the experiment record lives

Dated docs under `docs/` are the memory of this repo. For the layers above, start with:
`runner-claims-validation-2026-07-31.md` (62 verified claims),
`ledger-forensics-sweep-2026-07-31.md` (C3), `durability-crash-bakeoff-2026-07-31.md` (A1),
`coordinator-fanout-field-test-2026-07-31.md` (A3), and the annotated agenda in
`ai-orchestration-study-review-and-next-steps-2026-07-30.html` §7. The runtime-concordance
tracker (`runner-runtime-concordance-assessment-2026-07-17.html`) is the single tracker for
closing items.
