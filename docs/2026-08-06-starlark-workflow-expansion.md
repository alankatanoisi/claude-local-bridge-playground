# Starlark Workflow Expansion: Implementation Handoff

**Date:** August 6, 2026  
**Prototype:** `/Users/alanman/Developer/orchestration-prototypes/s1-starlark-phased-hybrid`  
**Playground:** `/Users/alanman/Developer/claude-local-bridge-playground` on `main`

## Outcome

This slice implemented three related capabilities without modifying the bridge
runner itself:

1. A bounded repository fan-out workflow.
2. A real test-failure collection and triage workflow.
3. A host-validated, Starlark-generated evaluation matrix.

Repository fan-out and provider-neutral workers were implemented together. That
is the cleaner boundary: workflows request symbolic workers, while a host-owned
registry decides which provider adapter and concrete model serve each worker.
Generated Starlark never receives provider credentials, model routes, arbitrary
filesystem access, or arbitrary command execution.

```text
Host collector -> bounded input documents -> planner metadata
                                      |
                                      v
                         generated Starlark descriptors
                                      |
                                      v
                             strict host validation
                                      |
                                      v
symbolic worker -> host route -> provider adapter -> concrete worker model
                                      |
                                      v
                         artifacts, ledger, synthesis
```

## Implemented Workflows

### Repository fan-out

The host scans only configured repository roots and file extensions. The current
workflow selects at most six JavaScript files from `src/runner`, with per-file
and total-byte ceilings. Paths are sorted deterministically. Symlinks, root
escapes, common secret locations, private-key files, `.env` files, dependencies,
coverage output, and build output are excluded.

Every selected file becomes exactly one independent `repo_file_analyst` job.
The host validator rejects extra jobs, missing files, duplicate coverage,
dependencies, unknown workers, provider/model fields, and excessive limits.

### Test-failure triage

The host runs one named suite from an allowlist using an argument array and
`shell: false`. The current fixture produces two genuine Node test failures.
The collector enforces a confined working directory, executable allowlist,
timeout, output ceiling, and a subprocess environment with likely credential
variables removed.

TAP failure blocks become bounded virtual documents. Every failure becomes one
independent `test_failure_triager` job. The worker may classify the failure and
suggest a diagnostic step; it cannot claim a fix was executed.

### Provider-neutral worker registry

Worker profiles now contain behavior and bounds, not provider or model choices.
The registry resolves a symbolic worker through a host-owned route. The only
implemented live adapter in this slice is the local Claude bridge. The contract
can accept Gemini, a local model, a deterministic service, or another runner
later without changing generated job descriptors.

This is provider-neutral structure, not proof of multi-provider interoperability.

## Evaluation Matrix

The preliminary matrix deliberately contains only eight cases:

| Axis | Values |
|---|---|
| Workflow | `repo_fanout`, `test_triage` |
| Control-model label | `claude-haiku-4-5`, `claude-sonnet-5` |
| Failure profile | `none`, `mixed` |
| Repetitions | 1 |

Bounded Starlark expands the Cartesian product. The host then rejects unknown
fields, unapproved values, duplicates, invalid repetitions, and more than eight
cases. The matrix runner is offline-only in this slice so one convenient command
cannot silently launch eight paid multi-call runs.

The completed dry run produced:

| Metric | Result |
|---|---:|
| Cases completed | 8 / 8 |
| Inputs exercised | 32 |
| Successful worker attempts | 30 |
| Deliberately failed attempts | 16 |
| Successful syntheses | 8 / 8 |
| Estimated cost | $0 |

One permanent injected repository failure in each applicable mixed case remained
failed, as intended. Retryable failures were eligible for one bounded recovery
phase. The dry run validates orchestration behavior only; mock workers mean it
does not compare real Haiku and Sonnet reasoning quality.

## Evidence And Checks

- All 33 Node tests pass after the final environment-hardening test.
- The Go Starlark evaluator builds successfully.
- Repository workflow dry run: 6 inputs, 6 successful outputs, no failures.
- Triage workflow dry run: 2 inputs, 2 initial deliberate failures, 2 successful
  bounded retries.
- Evaluation matrix dry run: 8 of 8 cases completed at zero cost.
- Each run writes an append-only JSONL ledger, atomic state, input artifacts,
  worker artifacts, a collection receipt, and a final result.
- No live model calls were made for this implementation slice.

## Boundaries And Remaining Work

- No runner or bridge/auth source was changed.
- The provider-neutral registry has one real adapter today: the local Claude
  bridge. A second adapter still needs contract testing.
- Test parsing currently targets TAP output. Other test formats need explicit,
  structured parsers rather than guessed text parsing.
- The current test suite is an intentional prototype fixture, not the playground's
  complete test command.
- Real-model evaluation needs a separately approved, cost-bounded canary. The
  eight-case live matrix should not be enabled before inspecting one case from
  each workflow.
- Cost accounting is process-local. Durable campaign budgeting across separate
  commands remains future control-plane work.
- Full live traces can contain prompts and source, so they remain sensitive local
  artifacts even when credentials are scrubbed.

## Handoff

**Folders and branch**

- Scratch implementation: `/Users/alanman/Developer/orchestration-prototypes/s1-starlark-phased-hybrid` (outside Git).
- Dated documentation: `/Users/alanman/Developer/claude-local-bridge-playground`, branch `main`.

**Files changed**

- Prototype control plane, worker registry, repository collector, test collector,
  workflow CLI, matrix CLI, Starlark matrix, configuration, fixtures, tests, and README.
- This Markdown handoff and its standalone HTML companion in playground `docs/`.

**Checks run**

- `npm run verify`
- `npm run workflow:repo`
- `npm run workflow:triage`
- `npm run matrix:offline`

**Checks skipped**

- Live model calls and multi-provider calls were skipped to keep this slice free
  and to avoid treating mock model labels as behavioral evidence.

**Risk summary**

The architecture is ready for small live canaries, but not yet for unattended
paid matrices. The main uncertainty has moved from basic orchestration mechanics
to real model compliance, second-provider adapter behavior, parser coverage, and
durable cross-process budgeting.
