# Starlark Phased-Hybrid Live Results

**Date:** 2026-08-06 (Pacific time)  
**Status:** Preliminary field report  
**Prototype:** `/Users/alanman/Developer/orchestration-prototypes/s1-starlark-phased-hybrid`  
**Target examined:** `/Users/alanman/Developer/claude-local-bridge-playground`  
**Live-call ceiling approved:** $10 estimated  
**Estimated campaign use:** $1.812512  
**Estimated remaining allowance:** $8.187488

## Executive result

The phased hybrid is viable as a narrow control-plane pattern:

1. A Claude model generated Starlark job descriptors.
2. A local Go evaluator executed the restricted Starlark.
3. A Node host validated every descriptor and retained model selection, source access, concurrency, budgets, timeouts, failure policy, and artifacts.
4. Real Sonnet 5 workers analyzed four bounded source files.
5. The host injected four different first-attempt failures.
6. A Claude recovery planner generated bounded retries only for retryable failures.
7. Full bridge traces and durable local ledgers preserved the evidence.

Every tested control-plane model eventually produced a valid initial plan and recovery plan within the two-attempt limit. Haiku 4.5, the smallest active Claude API tier, passed both on its first attempt and recovered all three retryable jobs. This is evidence that descriptor generation does not automatically require the strongest model.

The experiment also found important failure modes: underspecified planner policy, worker output truncation, synthesis refusal, synthesis truncation, unsupported per-model controls, a disconnected job-timeout field, and per-process rather than durable campaign budgeting. All except durable cross-process campaign budgeting were corrected in the prototype.

## Architecture tested

```text
Claude control model
        |
        v
generated Starlark
        |
        v
restricted Go evaluator
        |
        v
host validation and scheduling
        |
        v
bounded Sonnet 5 workers
        |
        v
durable results and failures
        |
        v
Claude recovery Starlark
        |
        v
validated retries and synthesis
```

Starlark never received filesystem, network, shell, model, or module-loading capabilities. It could propose job descriptors, but the host remained the authority boundary.

## Deliberate failure profile

The same four first-attempt faults were used for every live comparison:

| Position | Injected fault | Charged? | Retryable? | Purpose |
|---|---|---:|---:|---|
| 1 | Transient failure before model call | No | Yes | Test retry without sunk model cost |
| 2 | Timeout after a completed response | Yes | Yes | Test a charged result that the scheduler must discard |
| 3 | Malformed output after response | Yes | Yes | Test strict parsing and recovery |
| 4 | Permanent failure before model call | No | No | Prove recovery does not retry forbidden work |

The intended successful shape is therefore three recovered jobs plus one permanent gap.

## Control-model comparison

Sonnet 5 remained the worker model. The model in the first column owned planning, recovery planning, and final synthesis, but not policy enforcement.

| Control model | Initial plan | Recovery plan | Accepted retries | Final synthesis | Incremental estimated cost | Preliminary interpretation |
|---|---|---|---:|---|---:|---|
| Fable 5 | First pass | First pass | 3 of 3 | Refused | $0.219818 | Strong descriptor compliance; synthesis safety refusal remained a separate failure domain |
| Opus 5 | First pass | Valid after one repair | 2 of 3 | Truncated at 2,500 tokens | $0.328373 | Capable but verbose; one worker artifact violated the host summary-size limit |
| Sonnet 5 | First pass | Valid after one repair | 2 of 3 | Complete `end_turn` | $0.139426 | Only matrix model with a complete accepted synthesis under the tested ceiling |
| Opus 4.8 | Valid after one repair | First pass | 2 of 3 | Truncated at 2,500 tokens | $0.261704 | Needed Python-to-Starlark syntax repair and produced an overlong synthesis |
| Haiku 4.5 | First pass | First pass | 3 of 3 | Truncated at 2,500 tokens | $0.099662 | Best structural pass rate in this small sample and lowest total trial cost |

These are single trials, not statistically meaningful rankings. Worker response variation also affects accepted-retry counts. The result supports running repeated evaluations rather than choosing a control model from reputation alone.

Anthropic currently lists `claude-haiku-4-5-20251001` as active. The bridge alias `claude-haiku-4-5` resolved to that dated model during the trace-backed call. See [Anthropic model lifecycle documentation](https://platform.claude.com/docs/en/about-claude/model-deprecations).

## Trace verification

### Direct prototype calls

Every direct live call sent the conventional correlation headers:

- `x-local-bridge-trace-level: full`
- `x-local-bridge-trace-id`
- `x-local-bridge-run-id`
- `x-local-bridge-trace-turn`

The bridge wrote five events per completed upstream call: request received, request transformed, upstream request started, response headers, and response finished. All inspected events reported `capture_level: full` and the expected trace ID.

Example Haiku trial trace:

`/Users/alanman/.claude-local-bridge/traces/prototype-e5a8e096-521a-4376-b2b5-786f4e1b3e91.bridge.jsonl`

### Conventional runner smoke test

A separate Haiku call used the actual runner with `--trace-level full`. It returned exactly `TRACE_OK` in one turn for approximately $0.002127.

- Runner trace: `/Users/alanman/.bridge-runner/traces/starlark-prototype-haiku-smoke.runner.jsonl`
- Bridge trace: `/Users/alanman/.claude-local-bridge/traces/9bb612d4-eaa7-4178-984c-8bd1779205c2.bridge.jsonl`
- Shared trace ID: `9bb612d4-eaa7-4178-984c-8bd1779205c2`
- Runner events: 7, all `full`
- Bridge events: 5, all `full`

Full traces contain prompts, responses, and source-code payloads. Authentication-looking fields remain redacted, but the files must still be treated as sensitive local evidence.

## Findings from field failures

### 1. Policy must be both disclosed and enforced

The first Fable attempt proposed timeouts and output limits outside host policy because the prompt named the fields without stating their bounds. The validator correctly rejected both attempts. The prompt now discloses exact limits while the validator remains authoritative.

### 2. Starlark is Python-shaped, not Python-identical

Fable and Opus 4.8 generated adjacent Python string literals, which Starlark does not implicitly concatenate. One repair turn corrected the issue. The system prompt now states that combined strings require `+`.

### 3. Worker output is its own bounded protocol

At 1,200 output tokens, every early Sonnet worker reached the ceiling and no recovery artifact survived JSON parsing. Increasing the envelope to 2,600 tokens, lowering worker effort, and imposing compact field limits produced usable artifacts. Those size limits are enforced by the host, not only requested in the prompt.

### 4. HTTP 200 does not mean semantic success

Fable returned HTTP 200 with `stop_reason: refusal` and no content. The original coordinator marked the run complete. It now records a partial run with `model_refusal`. The same validation now marks `max_tokens` synthesis as `truncated_synthesis`.

Historical Opus 5 and Opus 4.8 matrix state files predate the `max_tokens` correction and say `completed`; their full bridge traces prove their synthesis responses were truncated. The report uses the trace-backed classification.

### 5. Model controls must be capability-aware

Haiku 4.5 does not accept the newer `effort` or adaptive-thinking fields. The adapter now consults the local capability catalogue and omits unsupported controls before dispatch.

### 6. Validated descriptors must connect to real enforcement

The job `timeout_ms` field was originally validated but not connected to the network abort signal. It is now passed to the direct bridge call. A field that is only validated but not executed creates false confidence.

### 7. The $10 gate is not yet a durable campaign budget

The budget object prevents concurrent reservations from overbooking one process. Separate commands start separate budget objects. During this campaign, the next allowance was manually reduced after each command to preserve the approved $10 total. Before unattended multi-process use, this must become a durable, atomic campaign ledger.

## Maturity assessment

| Layer | Preliminary maturity | Evidence |
|---|---|---|
| Restricted Starlark evaluation | Promising prototype | No ambient I/O, module loads rejected, execution-step and wall-time ceilings tested |
| Descriptor validation | Strong prototype | Unknown authority fields, model selection, invalid inputs, dependencies, timeouts, and retry targets fail closed |
| Concurrent worker dispatch | Working prototype | Real concurrent Sonnet calls completed with deterministic injected faults |
| Recovery planning | Promising | All control models produced valid recovery descriptors within two attempts |
| Artifact and event persistence | Working prototype | Append-only JSONL events, atomic state, model artifacts, and full bridge traces survived failures |
| Per-process budgeting | Working but incomplete | Pessimistic reservations prevented local overbooking; cross-process authority is absent |
| Cancellation and resume | Early | Per-call abort is now connected; restart/resume and cancellation propagation need dedicated tests |
| Synthesis | Fragile | One refusal and three ceiling hits across the broader live sequence; must remain independently fallible |
| Evaluation quality | Preliminary only | Single runs, one task family, fixed workers, and no independent scoring rubric |

## Recommended next experiment

Do not increase model count yet. First add a durable campaign budget and a deterministic scoring harness, then repeat each control model at least five times with identical fixtures and seeds where possible. Score:

- first-pass Starlark validity;
- repair success;
- forbidden-authority attempts;
- retry correctness;
- accepted worker artifact count;
- synthesis completion state;
- latency;
- estimated cost;
- trace completeness.

After that baseline, run the worker-axis matrix with a fixed control model. This will separate planner quality from worker protocol compliance.

## Validation performed

- Prototype test suite: 19 of 19 passing.
- Offline mixed-failure workflow: completed with the intended three recoveries and one permanent gap.
- Live Fable canaries: three runs, including deliberately preserved failed/partial evidence.
- Live four-model planner matrix: completed.
- Live Haiku planner trial: completed as partial due only to truncated synthesis.
- Conventional full runner trace smoke test: passed with correlated runner and bridge files.
- Full-trace event levels and IDs: inspected without quoting payload contents into this report.

## Boundaries and caveats

- Estimated costs use the playground's local pricing catalogue and are not proof of actual promotional-credit allocation.
- The prototype is outside Git at `/Users/alanman/Developer/orchestration-prototypes/`.
- No bridge authentication, proxy, or credential internals were modified.
- No commits or pushes were performed.
- Existing unrelated playground changes were preserved.
- Full trace files are local sensitive artifacts and are not included in this repository report.
