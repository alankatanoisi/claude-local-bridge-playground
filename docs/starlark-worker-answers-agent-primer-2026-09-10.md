# Agent primer: Starlark worker returns and synthesis

Date: 2026-09-10. Purpose: explain the existing lab to a subsequent agent; this is documentation, not an implementation brief or approval to integrate Starlark into the runner.

Source snapshot: `c45aab64b6bce38cfbddc26d89e5bb89000e743c` on `main` in `/Users/alanman/Developer/claude-local-bridge-playground`. Startup tree clean; origin was the playground; `git pull --ff-only origin main` reported already up to date. Reverify these facts before later edits.

Human report: [Worker answers and synthesis](starlark-worker-answers-and-synthesis-2026-09-10.html). Browser companion for this exact primer: [Agent primer HTML](starlark-worker-answers-agent-primer-2026-09-10.html).

## 1. Governing distinction

The Starlark program returns job descriptors, not worker answers. The JavaScript host executes those descriptors, receives provider responses, validates worker JSON (JavaScript Object Notation), saves accepted outputs, and constructs synthesis requests. Synthesis is a separate model call or sequence of calls, not a Starlark function.

Current worker implementations are bounded single-response analysts. ClaudeBridge constructs a system instruction plus one user message; this host path has no worker tool loop, recursive spawn mechanism, or inherited parent conversation. The deterministic provider implements the same result contract using textual measurements, not model reasoning.

Respect the R8 owner decision in [the status handoff banner](../HANDOFF-starlark-status-and-recommendations-2026-08-25.md): keep `starlark-host/` separate. The later [R11 implementation handoff](../HANDOFF-starlark-r11-2026-09-06.md) supersedes older claims that worker resume was unbuilt. Do not port `src/runner/coordinator.js`, add a runner `run_workflow` edge, or change bridge/auth internals based on this primer.

## 2. Call graph and ownership

```text
bin/run-workflow.js
  -> runWorkflow() in src/workflow-runner.js
     -> collect bounded input documents
     -> configure WorkerRegistry and PhasedCoordinator
     -> coordinator.run() / runPhases()
        -> planner source -> evaluateStarlark(plan) -> validateJobs()
           OR host_json descriptors -> same validateJobs()
        -> runJobs(initial jobs, attempt 1)
           -> registry.execute(symbolic worker + request)
              -> host-owned route -> provider.execute()
                 -> ClaudeBridge.call() or deterministic provider
           -> parseWorkerOutput(response.text)
           -> artifact write -> job_succeeded receipt -> result object
           OR job_failed receipt -> failure result
        -> optional validated recovery plan
        -> runJobs(recovery jobs, attempt 2, host rejection feedback)
        -> runSynthesis(objective, state.results, activePlannerModel)
        -> synthesis artifact / result.json / state checkpoint
     -> summarizeWorkflow(): status and runDir, not synthesis prose
  -> print summary JSON
```

Paths in the call graph are relative to `starlark-host/`. A descriptor is a data object describing a job. The evaluator runs as a Go child process communicating JSON over its input/output pipes; worker model responses return through awaited JavaScript calls, not through Starlark callbacks.

Planner input is metadata; worker input is the objective, assigned task, selected document bytes with identifiers and fingerprints, and rejection feedback on applicable retries. Host routing chooses provider/model. Generated programs cannot choose concrete models or providers.

## 3. Worker contract and fan-in

Provider response envelope includes `text`, `usage`, `costUsd`, and `rawStopReason`; some adapters add trace fields. The coordinator parses the text. `WORKER_OUTPUT_LIMITS` in `src/worker-contract.js` is authoritative:

- Exactly `summary`, `claims`, `evidence`, `confidence`; no extra keys.
- Summary: nonblank string, length at most 1200.
- Claims: array of at most 4 strings; each length at most 300.
- Evidence: array of at most 4 strings; each length at most 300.
- Confidence: numeric, 0 through 1.
- Empty claim/evidence arrays are valid. Length uses JavaScript string length. Fenced JSON is tolerated by parsing despite prompts requesting bare JSON.

`runJobs()` creates success records with `ok`, `job`, `attempt`, `artifact`, `output`, `usage`, and `costUsd`. Failure records contain `ok: false`, `job`, `attempt`, `error`, and `charged`. Invalid worker text is a retryable `invalid_worker_output`, not an accepted partial answer. Do not claim worker success is source verification or that the worker path applies the synthesis stop-reason validator.

`mapConcurrent()` assigns each result to its original index and waits for all pool tasks via `Promise.allSettled`. Thus completion-order receipts and descriptor-order result arrays differ. Initial results enter `state.results` first; recovery records append afterward. Synthesis waits for these phases. Current configuration: concurrency 2; repo_fanout at most 6 selected files, one input per initial job; 40,000-byte per-file and 180,000-byte collection bounds. These are snapshot configuration values, not universal runtime constants.

## 4. Exact synthesis context and strategy

`src/synthesis.js:compactResult` passes successful `{job_id, attempt, ok: true, output}` or failed `{job_id, attempt, ok: false, error}` records. The prompt also includes the objective.

It omits full source documents, full descriptors, input IDs, artifact paths, explicit `retry_of`, usage/cost, and interruption/resume history. Some details may appear incidentally in worker text, but the host does not systematically supply them. No earlier model context is automatically inherited.

Initial coordinator synthesis uses `activePlannerModel`, the tier most recently accepted during planning/recovery. This may differ from the initial planner model. Host-JSON planning avoids planner calls; synthesis still uses the selected planner-model setting on an ordinary run.

Defaults in `DEFAULT_OPTIONS`:

- `strategy: auto`; result count <= 4 selects `single`; count > 4 selects `map_reduce`.
- Single output ceiling: 2500 tokens.
- Map groups: 3 result records each, processed sequentially; each call has 900 output tokens and a prompt request for at most 200 words.
- Reduce: objective + record success/failure aggregates + map prose summaries; no raw worker objects; 2500 output tokens.
- Calls for map-reduce: ceiling(result count / 3) + 1 when all stages succeed.
- Map summaries exist in local memory; no persisted per-map resume checkpoint. Synthesis-only resume repeats synthesis, not workers.

Token ceilings are enforced through model request limits; the 200-word instruction is not separately checked. `validateSynthesisResponse()` checks refusal, max_tokens truncation, and empty text. It does not validate claims, references, contradiction handling, or confidence calibration. Transport exceptions can still throw rather than yielding a semantic failure object.

There is no implemented voting, confidence-weighted merge, deterministic claim union, source retrieval, or independent critic here. Map-reduce is layered model summarization, with the possibility of information loss at each layer.

## 5. Retry accounting and terminal meaning

The coordinator has one initial worker phase and one recovery phase. Retry eligibility is supplied by host failure records and enforced against the recovery policy. The host supplies exact rejection messages directly to retry workers. Recovery handles eligible failures; it is not a disagreement-resolution loop among successful workers.

Historical failures remain in `state.results` when retries succeed. Six initial jobs with one failed attempt and one successful recovery produce seven result records: six successes, one failure. Aggregates count records, not distinct final input outcomes. Reduce labels this aggregate as jobs. Compact synthesis records omit retry_of, weakening explicit lineage. Do not equate failure count with uncovered input count or silently remove historical failures.

Semantic synthesis failure sets phase `partial`, saves `synthesisFailure`, and preserves worker outputs. Successful synthesis sets phase `completed` even if unresolved worker failures exist. `run_completed` is also appended on semantic synthesis failure with `synthesisOk: false`. Inspect fields, not event names alone. Synthesis completion is not factual correctness.

## 6. Durable files and outer caller boundary

Under the workflow's printed runDir:

- `collection.json`: host collection receipt.
- `run-context.json`: saved host configuration/execution settings for worker resume.
- `artifacts/input-<id>.json`: saved input bytes and metadata.
- `artifacts/<job-id>-attempt-<n>.json`: accepted worker output, written before the success receipt.
- `events.jsonl`: append-only JSON Lines (one JSON object per line), ordered receipts with synchronized writes.
- `state.json`: latest coordinator checkpoint, including results and synthesis status/text when available.
- `artifacts/synthesis.json`: initial successful synthesis text and result job IDs.
- `artifacts/synthesis-resume.json`: successful synthesis-only retry text.
- `result.json`: final state including `synthesis`.

`atomicWrite()` writes a temporary JSON file then renames it; it does not fsync artifact/checkpoint files or their directory. Event fsync alone is not a universal power-loss durability guarantee. Read the recorded [R11 review limitations](../HANDOFF-starlark-r11-thermo-nuclear-2026-09-06.md) in conjunction with current code.

The coordinator returns full state internally. `runWorkflow()` exposes a summary; the command prints phase, counts, synthesisOk, runDir and related metadata, not synthesis text. A future parent-agent integration must explicitly return/read a result envelope or artifact. There is no automatic parent-chat insertion today.

## 7. Resume details that must not be flattened

Worker resume reconstructs accepted plans and terminal receipts, restores saved inputs, validates evidence and available hashes, reuses recorded successes and failures, and re-executes started jobs lacking a terminal receipt. It is at-least-once execution. Completed worker resume is a no-op. Partial semantic synthesis failure is redirected to synthesis-only resume.

An abort after provider usage settlement can suppress job success. A charged request is not necessarily an accepted output receipt. Do not assert exactly-once behavior, no repeated provider work, or that interrupted usage was free.

`resumeSynthesis()` loads `state.results` from state.json rather than performing the worker-resume event/artifact reconstruction. It defaults to map_reduce. The command wrapper supplies current `config.objective` and defaults to `state.plannerModel`; these can differ from the original workflow objective and final active planner tier. It is a live-only command wrapper with a positive cost cap. This primer authorizes no live calls. Treat objective/model restoration and synthesis retry provenance as future design questions, not repaired behavior.

## 8. Recommendations, not implemented requirements

For a future parent result, consider an explicit host-authored envelope with run ID, terminal status, synthesis text, final coverage, unresolved failures, attempt history, and artifact references. Carry original input/job identity and retry lineage through synthesis. Use source fingerprints and excerpt/line references for claims; verify reference existence deterministically and treat semantic support as a separate review question.

Preserve evidence IDs through map summaries, keep prose status separate from factual-review status, and restore the exact objective/model/options on synthesis retry unless a change is explicit. Full tool-using workers would also require side-effect/change/test reporting and retry semantics beyond the current read-only four-field answer. Do not expand scope merely because this document describes those options.

## 9. Source index and verification handoff

Primary implementation sources:

- [Coordinator](../starlark-host/src/coordinator.js): runPhases, runJobs, parseWorkerOutput, mapConcurrent, restoreWorkerPhase.
- [Synthesis](../starlark-host/src/synthesis.js): compactResult, prompt construction, defaults, response validation.
- [Registry](../starlark-host/src/worker-registry.js) and [bridge](../starlark-host/src/bridge.js): host routing and provider response envelope.
- [Worker contract](../starlark-host/src/worker-contract.js), [validator](../starlark-host/src/validator.js), and [configuration](../starlark-host/experiment.config.json).
- [Workflow runner](../starlark-host/src/workflow-runner.js), [command entry](../starlark-host/bin/run-workflow.js), and [ledger](../starlark-host/src/ledger.js).
- [Synthesis resume](../starlark-host/src/resume-synthesis.js) and [its command wrapper](../starlark-host/bin/resume-synthesis.js).
- [Historical fidelity review](../HANDOFF-starlark-analysis-fidelity-2026-09-07.md): useful evidence limitations; not a new factual audit performed today.

Executed verification: existing synthesis, worker-contract, worker-registry and worker-adapter tests: **16 pass, 0 fail, 0 skip**, first run. Includes a deterministic-provider workflow with host-JSON planning and mocked synthesis; it is not a live-model/Starlark-evaluator acceptance run.

Reproduction for an agent or human: on the Mac, open Terminal through Spotlight (Command-Space, type Terminal, press Return). Enter the following in Terminal, not Spotlight or a browser. Success is a test summary with 16 passes, zero failures and zero skips. These comments explain each command.

```bash
# Move Terminal into the actual playground repository first.
cd /Users/alanman/Developer/claude-local-bridge-playground

# Run the four existing test files relevant to answer delivery and synthesis.
# These tests use local fixtures/stubs; they do not spend on live model calls.
node --test starlark-host/test/synthesis.test.js starlark-host/test/worker-contract.test.js starlark-host/test/worker-registry.test.js starlark-host/test/worker-adapters.test.js
```

If cd says the folder is missing, stop and locate the real checkout; do not create a replacement folder. If Terminal says node is not found, Node.js (the program that runs JavaScript outside a browser) is unavailable on that command path; resolve the existing project environment before retrying. If a test fails, preserve its output and inspect the cause rather than treating this document's snapshot as current proof.

Folder/branch: the canonical local playground above, main. Files changed: only this primer, its matching HTML companion, and the human HTML report in docs/. Repository documentation checks, formatting, local links and document structure are verified during the final handoff. Full root runtime suite, a new evaluator campaign, live model calls, and a fresh factual-quality audit are skipped because this is a source-grounded documentation task. No runtime/configuration changes, commit, or push. Remaining risks: lossy synthesis, no factual validator, incomplete retry lineage in synthesis, resume provenance differences, and existing interruption/durability limits described above.

Verification addendum: repository documentation checks and targeted Prettier formatting checks passed. Both HTML files passed local-link, anchor, and element-nesting checks (71 links combined). The first custom HTML check mishandled self-closing meta elements; correcting that checker produced a pass without a document change. Browser-rendered visual inspection was not performed; responsive and print styles were checked in source only.
