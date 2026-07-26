# Bridge Runner Compaction & Context-Management Rebuild Plan

**Status:** Critically reviewed and revised implementation plan  
**Date:** 2026-07-26  
**Implementation status:** Not started  
**Delivery decision:** Build and validate as one integrated landing, not as separately shipped phases  
**Active repository:** `/Users/alanman/Developer/claude-local-bridge-playground` on `main`

## Executive decision

The bridge runner’s current compaction system should be rebuilt as one coordinated change.

The implementation may be worked on in the dependency order described below, and targeted tests should run continuously while it is being built. However:

- no intermediate workstream is a release boundary;
- no phase-by-phase commits are required;
- no partially migrated runtime should be treated as shippable;
- the final behavior, documentation, migration handling, telemetry, offline soak, and live comparison must be tested together;
- the completed work should land as one coherent commit unless Alan explicitly changes that instruction.

This plan keeps the useful pieces of the current runner—semantic-exchange grouping, outbound message validation, idempotent clipping, stale-read detection, ingestion-time tool summarizers, and conservative safety boundaries—while replacing the parts that cause early and permanent context loss.

Anthropic’s server-side `context_management` compaction beta remains a deferred experiment. This landing is runner-layer work and must not modify bridge authentication, proxying, interceptors, or credential behavior.

## Why the original draft needed revision

The original draft had the correct central diagnosis and identified most of the right source seams. It also contained several design choices that would have left important failure modes unresolved.

### Keep from the original draft

- Protect recent semantic exchanges from ordinary clipping.
- Stop using message count alone to trigger lossy compaction.
- Include the complete request shape in context estimates.
- Calibrate estimates with actual Anthropic usage.
- Add model context/output limits to the existing provenance-backed model catalog.
- Separate cumulative run usage from per-request context occupancy.
- Regenerate a task/session anchor from authoritative runner state.
- Keep the system prompt byte-stable during client-side compaction.
- Preserve raw canonical history and derive a bounded outbound projection.
- Remove compaction-count-only resume degradation.
- Add before/after loss telemetry and end-to-end continuity tests.

### Correct in the original draft

1. **The long soak was not a live 60-step bridge run.** The runtime evaluation used a live nine-request/eight-read scenario and an offline deterministic 80-step soak. The plan must not describe the offline soak as live evidence.

2. **The proposed threshold formula had an unsafe gap.** A firm trigger of 150k followed by a hard trigger at 85% of a 1M model’s usable window could defer the next meaningful action until roughly 730k tokens. That contradicts the evaluation’s proposed 200k–250k hard-policy experiment and would make failure behavior difficult to reason about.

3. **Preserving 2,000 characters of the first user message is not a session-anchor design.** It does not capture later operator directives, the live task checklist, changed files, unresolved errors, or acceptance criteria. It can also preserve the wrong portion of a large pasted prompt.

4. **Passing an old `[compaction:summarize]` message through unchanged is not sufficient.** It prevents one form of recursive slicing, but it still treats a lossy old summary as the authority and cannot recover facts omitted by that summary.

5. **Summary memoization by moving cutoff would not stabilize the cache.** With a “preserve the newest N exchanges” cutoff, the cutoff normally advances on every new exchange. A summary keyed directly to that cutoff would therefore be rewritten on nearly every turn.

6. **Observed usage must be paired with the exact request estimate it calibrates.** Updating an EWMA after a response without retaining the estimate and request identity for that specific request can calibrate against the wrong projection after retries or failures.

7. **`--max-spend-tokens` would still be misleading.** Cached input, cache creation, uncached input, and output have different prices. A token count is not a spend measurement. The replacement name should describe cumulative run token usage, while dollar-cost limits remain a separate future capability.

8. **“Persist the objective” and “the anchor must be absent from the store” were contradictory.** The correct design is to persist the authoritative anchor source fields, but inject only the rendered anchor into the outbound request projection.

9. **Compaction generation needs a defined meaning.** It should advance only when a durable projection checkpoint changes—not whenever a ghost notice is rendered. Health should depend on actual integrity/continuity failures, not an arbitrary generation count.

10. **The bridge’s hard-coded count-tokens behavior is outside this landing.** It should remain a tracked bridge item. The runner rebuild must not quietly expand into transport/auth work.

11. **Low-value performance work should not delay the repair.** Incremental deep-scrub/session serialization and archive memory refactors are adjacent optimizations, not prerequisites for fixing early amnesia. They are deferred unless profiling during implementation proves they block the soak.

## Evidence boundary

The plan distinguishes confirmed runtime defects from adjacent performance hypotheses.

### Confirmed context-integrity defects

| ID  | Confirmed current behavior                                                                                                                                                                 | Required resolution                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `clipToolResults` has no preserved-recent exemption. Once the ladder’s entry gate opens, a fresh result can be clipped before the model consumes it.                                       | Ordinary clipping may affect only exchanges older than the protected tail. A separate emergency rule must be explicit and head+tail preserving. |
| D2  | The compactor estimates only message characters. It omits system text, tool definitions, repository context, and some block fields; array-form result content is miscounted.               | Estimate the complete outbound request and all supported Anthropic content block shapes.                                                        |
| D3  | Anthropic response usage is available but does not calibrate later compaction decisions.                                                                                                   | Pair each request estimate with its returned occupancy and update a bounded per-model calibration factor.                                       |
| D4  | `summarizeOldTurns` is shallow prefix extraction, and later compaction can summarize the prior summary. The offline marker was lost at step 26.                                            | Always derive checkpoints from raw canonical exchanges. Never summarize a summary.                                                              |
| D5  | The runner persists tasks but does not render a non-summarizable task/session anchor into pressured requests.                                                                              | Persist structured anchor source state and inject a bounded deterministic rendering into the projection.                                        |
| D6  | `messages = compaction.messages` promotes a lossy request projection to in-memory and eventually persisted canonical history.                                                              | Keep raw history canonical; send only a derived projection.                                                                                     |
| D7  | The ghost block changes the system tail and includes changing generation/ID text. The live compaction request coincided with cache-read occupancy dropping from 77,530 to zero.            | Never mutate the system for compaction. Keep the notice in the newest cache-free user message and stable within an epoch.                       |
| D8  | `--max-context-tokens` measures cumulative usage, not current request occupancy, and does not configure the compactor.                                                                     | Split the public controls and document their exact formulas.                                                                                    |
| D9  | Ghost turns increment `compactionGeneration`; session health degrades at generation 5 regardless of actual continuity.                                                                     | Redefine epochs and base health on integrity/continuity outcomes.                                                                               |
| D10 | Compaction events omit after-size, loss volume, protected-tail status, and anchor status.                                                                                                  | Emit bounded, redacted decision and loss telemetry.                                                                                             |
| D11 | The model catalog has provenance for context/output limits in its source note but does not expose those limits per entry. Fixed 80k/160k policy ignores model capacity and output reserve. | Add sourced limits and derive policy from the selected model plus requested output.                                                             |
| D12 | Fresh tool output can be summarized at ingestion and then blindly prefix-clipped on the next request.                                                                                      | Ingestion owns fresh-result reduction; projection compaction handles old evidence.                                                              |

### Adjacent findings

| ID   | Assessment                                                                                                                                                                                            | Treatment in this landing                                                                                                         |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| D13  | Duplicate prompt construction, advisory re-stringification, repeated deep scrubbing/pretty-printing, and multiple retained copies are performance concerns. Not all have been profiled independently. | Consolidate duplicate token estimation. Defer risky persistence/archive optimization unless profiling shows it blocks validation. |
| D14a | Optional repository-context `CLAUDE.md` loading reads the full file before sending that block outside the normal system budget.                                                                       | Add a deterministic size cap in the runner context builder.                                                                       |
| D14b | The bridge count-tokens handler returns a hard-coded result.                                                                                                                                          | Defer as a bridge-layer tracker item; do not modify bridge files in this landing.                                                 |

### Important causal nuance

The code proves that the current ghost changes the cached system prefix. The live run proves that the same compaction request had zero cache-read tokens. This is strong evidence of a cache-disruptive design, but it is not proof that every ghost turn will always produce a zero cache read; server cache state and request-prefix changes elsewhere can also affect the observed result.

## Scope

### Included

- `bin/local-bridge-runner.js`
- `src/runner/context-compactor.js`
- new small runner modules for request estimation, model-aware policy, session anchoring, and request projection when that separation improves testability
- `src/runner/run.js`
- `src/runner/session-store.js`
- `src/runner/session-health.js`
- `src/runner/loop-autopsy.js`
- `src/runner/context-budget.js` only where its existing cache seam remains useful
- `src/runner/context-builder.js` for the bounded repository-context read
- `src/runner/model-catalog.js` and its consumers
- focused and integration tests under `test/runner/**`
- `README.md`, `docs/runner-quickstart.html`, and `docs/command-builder.html`
- a new `CX-*` item band in `docs/runner-runtime-concordance-assessment-2026-07-17.html`

### Explicitly deferred

- Anthropic server-side `context_management` beta
- bridge `/count_tokens` repair
- bridge/auth/proxy/interceptor changes
- transcript-based recovery of history already destroyed in old sessions
- a new raw-result blob store or archive format
- incremental session scrub/serialization
- archive-collector memory refactoring
- dollar-denominated budget controls

## Non-negotiable invariants

1. **Semantic exchanges stay atomic.** An assistant `tool_use` batch and its user `tool_result` batch must never be split.

2. **The exact outbound request is validated.** `assertValidAnthropicMessages` remains at the final boundary after projection and cache markers.

3. **Signed model blocks are never rewritten.** Retained `thinking` and `redacted_thinking` blocks must remain byte-for-byte intact and in their original assistant message. A whole old semantic exchange may be omitted from a projection; a signed block may not be edited, reordered, or detached.

4. **Raw canonical history is never replaced by a lossy projection.** Live memory and the session checkpoint keep canonical messages; projection is request-local.

5. **Fresh evidence is protected.** Ordinary clipping, snipping, stale-result removal, and checkpointing cannot change the newest protected semantic exchanges.

6. **Emergency reduction is visible and exceptional.** A single pathological fresh result may be head+tail reduced only when it independently threatens the request ceiling. Telemetry must label this separately from normal old-evidence compaction.

7. **The operator’s prompt is not silently truncated.** A too-large initial request stops locally with a clear message; it does not quietly slice the objective.

8. **The system is byte-stable across compaction.** Client-side notices and anchors never alter the system array.

9. **The anchor is projection-only.** Its structured source state is persisted, but the rendered request block is not appended to canonical history.

10. **Checkpoint summaries come only from raw exchanges.** They never take a previous summary as source input.

11. **One metric has one meaning.** Per-request input occupancy, cumulative run usage, output allowance, estimated tokens, and estimated dollar cost remain distinct.

12. **Safety does not regress.** Private file modes, secret redaction, tool visibility, workspace trust, and deterministic invalid-request fail-fast behavior remain unchanged.

13. **Unknown models are explicit.** A conservative fallback may be used, but it must emit a visible “limits are estimated” warning.

## Target architecture

```text
canonical raw messages ───────────────┐
                                     │
structured anchor source state ──────┼─> request projection builder
                                     │        │
model-aware policy + calibration ────┘        ├─> protected recent exchanges
                                              ├─> stable old-evidence checkpoint
                                              └─> projection-only session anchor
                                                       │
                                                       v
                                             cache-control markers
                                                       │
                                                       v
                                         final message-contract validator
                                                       │
                                                       v
                                              Anthropic request
                                                       │
                                                       v
                                          observed usage calibration
```

The session store owns canonical messages and structured runner state. The projection builder owns all lossy request shaping. Cache-control decoration and final validation operate on the projection only.

## Runtime state contract

Add an additive, versioned `runner.contextState` object rather than immediately changing the whole session-file schema.

It should contain enough state to resume deterministically:

| Field                | Purpose                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| `version`            | Allows future additive migration of context-management state.                                        |
| `historyQuality`     | `raw_complete`, `legacy_compacted`, or `unknown`. Never claim old loss was recovered.                |
| `objective`          | Bounded head+tail excerpt of the original task prompt, its full-content hash, and a truncation flag. |
| `currentDirective`   | Most recent explicit operator instruction for the task, bounded and hashed.                          |
| `checkpoint`         | Current epoch, raw semantic-exchange cutoff, deterministic digest, and source fingerprint.           |
| `calibrationByModel` | Bounded estimate calibration state keyed by model ID/catalog version.                                |
| `lastDecision`       | Latest pressure tier and reason, without raw prompt/tool content.                                    |

The source fields are persisted. The rendered anchor is rebuilt from them plus current `ctx.tasks`, changed-file state, and unresolved run errors.

### Existing-session migration

- Sessions without `runner.contextState` load normally.
- If stored messages or metadata show prior compaction markers/generations, set `historyQuality: legacy_compacted`.
- Otherwise use `unknown` until the next cleanly observed new session; do not overclaim completeness.
- A legacy-compacted session remains resumable if its message contract is valid, but the runner emits one concise warning that already-discarded detail cannot be reconstructed.
- Forking copies `contextState` and its history-quality label.
- New clean sessions begin with `raw_complete`.

## Context measurement

### Complete request estimate

Replace the two divergent message-only estimators with one shared request estimator. It must account for:

- system blocks;
- optional repository context;
- tool definitions and input schemas;
- user and assistant message text;
- `tool_use.input`;
- string and array-form `tool_result.content`;
- `thinking` text;
- `redacted_thinking` payload size;
- small per-message/per-block structural overhead.

System and tool-definition measurements may be memoized by stable content hash. Message history must be traversed once per decision; do not `JSON.stringify` the full history again for the old advisory warning.

The estimator remains a heuristic. It must report both the uncalibrated and calibrated estimate so telemetry never presents it as an exact tokenizer result.

### Calibration

For each outbound request, retain:

- request/run/step identity;
- model and catalog version;
- the exact pre-send estimated input occupancy;
- the projection fingerprint.

After the corresponding successful response:

```text
observed input occupancy
  = usage.input_tokens
  + usage.cache_read_input_tokens
  + usage.cache_creation_input_tokens
```

Update only that model’s calibration using a bounded EWMA. Initial implementation constants may start at:

- initial factor: `1.3`, based on the live undercount;
- alpha: `0.3`;
- clamp: `[0.75, 3.0]`;
- ignore absent, zero, malformed, retry-mismatched, or model-mismatched samples.

These are evaluation constants, not universal tokenization facts. Keep them centralized and test them. A failed request must not update calibration.

## Model-aware policy

Add `contextWindow` and `maxOutputTokens` to every known catalog entry with the same provenance/version discipline as existing capability and pricing fields.

For an unknown model:

- use a visible conservative 200k context-window fallback;
- mark the limits as estimated;
- retain existing permissive API pass-through behavior;
- never silently claim an official output limit.

### Derived input ceiling

```text
safety margin = max(10,000 tokens, 1% of context window)

usable input ceiling
  = context window
  - requested max_tokens
  - safety margin
```

`requested max_tokens` is the response output allowance for this request. Validate it against a known model’s `maxOutputTokens`, and reject impossible or non-positive usable ceilings before the first model call.

### Initial pressure tiers

The following are centrally defined evaluation starting points:

| Tier                 |        Initial derived threshold | Default action                                                                          |
| -------------------- | -------------------------------: | --------------------------------------------------------------------------------------- |
| Observe              | `min(100k, 50% of usable input)` | Measure and emit no lossy mutation.                                                     |
| Compact old evidence | `min(150k, 75% of usable input)` | Reduce only old tool evidence; preserve narrative and recent exchanges; inject anchor.  |
| Durable checkpoint   | `min(250k, 90% of usable input)` | Advance one stable checkpoint epoch from raw history and return below the compact tier. |
| Ceiling              |             Usable input ceiling | Stop locally if no valid bounded projection fits.                                       |

Normalize the thresholds so `observe < compact < checkpoint < ceiling`, including small-window/high-output-reserve cases.

For a typical 1M model, this produces approximately 100k / 150k / 250k. For a 200k model, the thresholds scale down with its actual requested output reserve instead of copying the 1M constants.

These values must be evaluated against continuity quality; “fill more of the window” is not itself a success criterion.

### Oversized initial prompt

A one-exchange prompt has nothing old to summarize.

- If it is below the usable ceiling, send it without pretending compaction occurred; warn when it begins above a pressure tier.
- If it exceeds the usable ceiling, stop before the HTTP request with `initial_prompt_too_large` and explain that the operator should reference files or split pasted material.
- Do not emit repeated `summarize_pending` events.
- Do not slice the operator’s prompt automatically.

## Request projection behavior

### Protected recent tail

- Default to at least eight semantic exchanges for current 1M models.
- Make the count a policy value and keep the existing semantic-exchange helper as the sole cutoff authority.
- Ordinary `clip`, `snip`, and stale-result stages must skip everything at or after that cutoff.
- A low-token 25-message conversation must remain byte-identical.

### Old tool evidence

At compact pressure:

1. Drop only provably stale read results that were superseded by later writes to the same path.
2. Head+tail reduce oversized old tool results with a visible marker, original length, and stable source hash.
3. Replace sufficiently old low-value result bodies with typed re-fetch markers only when necessary to return below the compact tier.
4. Preserve tool-use/result structure and IDs even when result content becomes a marker.

The builder should stop applying lossy stages once the projection is below its target. It should not mechanically run every stage.

### Exceptional fresh-result ceiling

Ingestion-time summarizers remain the authority for normal fresh output limits. A second fresh-result reduction is permitted only when all of the following are true:

- the request would otherwise cross the usable ceiling or checkpoint limit;
- one recent result is independently pathological;
- its retained form uses head+tail, not prefix-only clipping;
- the result is still represented as the matching `tool_result`;
- telemetry records `emergency_recent_result_reduction`;
- the continuity tests prove the newest ordinary read remains byte-intact.

Keep the emergency size as a centralized policy value, initially no more than 200,000 characters and additionally bounded by remaining model headroom.

## Stable durable checkpoints

The current shallow `summarizeOldTurns` implementation should not remain the hard-pressure authority.

At checkpoint pressure:

1. Select a semantic-exchange boundary that preserves at least the protected recent tail and is expected to return the projection below the compact tier.
2. Generate a deterministic continuity digest directly from canonical raw exchanges from the beginning through that boundary.
3. Persist the digest, raw cutoff, source fingerprint, and epoch in `runner.contextState.checkpoint`.
4. Reuse that exact checkpoint text on later requests.
5. Advance the checkpoint only when projected occupancy again crosses the checkpoint tier—not merely because one new turn arrived.
6. When advancing, regenerate from raw exchanges through the new boundary. Never use the old digest as source material.

This hysteresis is what makes the summary/cache prefix stable across ordinary turns.

### Minimum digest contents

The deterministic digest must preserve, within a fixed budget:

- explicit operator decisions and corrections;
- user-stated acceptance criteria;
- completed and active task-checklist entries;
- files read, written, or patched;
- successful/failed tool outcomes;
- unresolved errors and their latest status;
- bounded head+tail evidence excerpts where a path/outcome marker is insufficient;
- the checkpoint’s raw exchange range and source fingerprint.

It must not:

- invent conclusions;
- expose secrets in telemetry or logs;
- copy signed thinking payloads;
- claim that omitted evidence is still present;
- recursively include a prior checkpoint digest.

If deterministic checkpoint quality cannot pass the continuity fixtures, stop the landing and revise the digest design. Do not compensate by raising thresholds until the tests happen not to trigger.

## Session anchor

Create a small, deterministic projection-only anchor. Its source data comes from authoritative runner state, not from old conversational prose.

### Anchor source

- original task objective, captured before environment/repository prefixes are added;
- most recent explicit operator directive;
- current `ctx.tasks` checklist;
- user-stated acceptance criteria when explicitly available;
- changed files from the current run/session recovery state;
- unresolved runner/tool errors;
- relevant safety/permission constraints;
- a short notice that older evidence was compacted and can be re-fetched.

### Rendering rules

- Bound the rendered anchor, initially to roughly 4,000 characters.
- Use deterministic ordering and stable wording.
- Include hashes/counts where content is truncated.
- Do not include changing timestamps, random IDs, tool-use ID samples, or per-turn generation prose.
- Render it whenever a lossy projection or durable checkpoint is active.
- Append it as the final text block of the newest safe user message in the request projection.
- Never append it to the system.
- Never append the rendered block to canonical history or persist it as a message.
- Validate that adding text after a tool-result batch remains Anthropic-contract valid.

Because the newest message is deliberately outside the stable transcript cache breakpoint, task-list changes do not invalidate the older cached prefix.

## Raw canonical history versus request projection

The main-loop integration must remove:

```text
messages = compaction.messages
```

The replacement contract is:

- `messages` remains the canonical in-memory history;
- session persistence receives canonical messages;
- the projection builder receives canonical messages and returns a request-local projection plus metadata;
- cache-control decoration receives the projection;
- the model client sends the decorated projection;
- assistant/tool results are appended only to canonical messages;
- the next request derives a fresh projection from canonical messages plus the stable checkpoint.

If the model request fails after projection, canonical history remains unchanged. A successful response never causes the projection to be persisted as canonical messages.

### Storage trade-off

Preserving raw messages increases long-session checkpoint size. This is an intentional correctness trade-off for this landing.

Add redacted telemetry for canonical message count and serialized byte size, plus a warning at a centralized high-water threshold. Do not silently delete raw history. A later blob-store/retention design can address very large sessions without conflating storage management with model context projection.

## Cache-stability contract

- Delete system-side ghost injection from the default path.
- Preserve the exact system bytes passed into the projection builder.
- Keep tool definitions stable.
- Keep the durable checkpoint text stable within an epoch.
- Put the rendered anchor only in the newest cache-free user message.
- Treat a cache rewrite when a checkpoint advances as expected and observable.
- Do not promise that the server must return a cache hit; assert the request-prefix invariants locally and compare observed cache usage live.

Tests must compare hashes/bytes of system, tool definitions, checkpoint prefix, cache-control breakpoint count, and the marked transcript prefix across consecutive pressured turns.

## CLI and documentation contract

### `--max-tokens`

Keep the existing flag, but document it everywhere as the **maximum response output tokens per model request**. It is not a context budget and it does not grant more steps. It also reduces available input headroom.

### New `--compact-at-tokens <n>`

- Overrides the derived “compact old evidence” threshold.
- Does not override the model input ceiling.
- Must be positive and lower than the derived checkpoint/ceiling thresholds.
- Invalid combinations fail at startup with a beginner-readable explanation.
- The command builder labels it as an advanced context-pressure override.

### New `--max-run-tokens <n>`

- Controls cumulative run token usage.
- Its documented new-form formula is cumulative input occupancy across calls plus output tokens.
- It is a run/cost guardrail, not a request-context threshold.
- Cached input remains tokens even though it may cost less; do not call this “spend.”

### Deprecated `--max-context-tokens`

- Keep it for one migration window as a deprecated alias for the old cumulative guard.
- Preserve its legacy calculation during that window so existing scripts do not silently change behavior.
- Emit one stderr deprecation note directing users to `--max-run-tokens` and `--compact-at-tokens`.
- Do not let the command builder generate the deprecated flag.
- Add tests for conflicts when old and new flags are passed together.

Update CLI help, README, quickstart, command builder labels/tooltips, and docs drift tests in the same landing.

## Health and repetition semantics

- Replace “ghost count” with `compactionEpoch`, which advances only when the durable checkpoint changes.
- Retain the old `compactionGeneration` field only for backward-compatible session reads during the migration.
- Do not block resume merely because an otherwise valid session has five epochs.
- Degrade health for concrete reasons: invalid message history, failed continuity validation, unrecoverable ceiling pressure, repeated checkpoint attempts that cannot return below target, or existing stop reasons.
- The repeat-tool detector may include the current epoch in its warning key, but ordinary anchor rendering must not reset it.
- A legacy-compacted session receives a warning, not an automatic block, if its retained message contract is valid.

## Telemetry

Every projection decision should emit bounded, redacted fields:

- policy source and catalog version;
- context window, requested output reserve, and usable input ceiling;
- uncalibrated/calibrated estimated occupancy before and after;
- previous observed occupancy and calibration sample count;
- pressure tier and decision reason;
- stages actually applied;
- semantic exchanges protected;
- old results dropped, clipped, or stubbed;
- characters/bytes removed by stage;
- emergency-reduction count;
- anchor present and rendered size;
- checkpoint epoch, raw cutoff, stable/rebuilt status, and digest size;
- canonical message count/bytes;
- system/checkpoint prefix hashes for cache diagnostics;
- observed input/cache/output usage after the response.

Do not emit raw prompt text, tool-result content, objective text, credentials, signed thinking, or private file contents.

Surface the same core facts in:

- stream/JSON `compaction` or `context_projection` events;
- `compaction_applied` ledger entries;
- human-log lines;
- redacted traces;
- final run/autopsy summary where relevant.

## Integrated implementation workstreams

These workstreams define build order, not separate landings or commits.

### Workstream A — Freeze reproducible baselines

- Preserve the existing runtime-evaluation aggregates as the “before” record.
- Convert the offline 80-step pressure scenario into a deterministic regression fixture.
- Add a request-capture mock that returns controlled usage/cache fields.
- Do not repeat a costly 60-step live run; no such live baseline exists.
- Use `/tmp/compaction-audit-*` for raw, redacted live artifacts and keep them out of Git.

### Workstream B — Build the new context primitives

- Complete request estimator and paired calibration state.
- Model-aware policy derivation and validation.
- Protected semantic-tail selection.
- Structured session-anchor source and renderer.
- Raw-history request projector.
- Stable checkpoint/digest builder with epoch hysteresis.
- Rich projection-decision metadata.

Expected new module boundaries may include:

- `src/runner/context-estimator.js`
- `src/runner/context-runtime-policy.js`
- `src/runner/session-anchor.js`
- `src/runner/context-projection.js`

Exact filenames may change if existing boundaries make a smaller design clearer, but avoid rebuilding another monolithic `context-compactor.js`.

### Workstream C — Integrate the main loop and persistence

- Derive projection without reassigning canonical `messages`.
- Pair the exact estimate with the exact response usage.
- Persist additive `runner.contextState`.
- Hydrate and migrate legacy sessions.
- Ensure resume, fork, bridge retry, instruction-delta, finalization, and no-session-persistence paths use the same contract.
- Apply cache markers and message validation after projection.
- Preserve scrub-before-fan-out and private-file guarantees.

### Workstream D — Wire catalog, CLI, health, and telemetry

- Add model limits and catalog drift tests.
- Validate output reserve and pressure overrides at startup.
- Split public flags and retain the deprecated alias behavior.
- Redefine compaction epoch and health.
- Emit before/after projection telemetry at every sink.
- Consolidate/remove the duplicate advisory estimator.

### Workstream E — Bound adjacent startup context

- Cap optional repository-context `CLAUDE.md` content with a deterministic marker and source length/hash.
- Reuse/export an existing budget helper only if doing so keeps ownership clear.
- Do not undertake incremental scrub/session/archive optimization in this landing unless profiling proves it is required for the integrated soak.

### Workstream F — Update operator surfaces and tracker

- Update README, quickstart, command builder, CLI help, and drift tests.
- Register and close `CX-01` through `CX-10` in the existing concordance tracker:
  - `CX-01` protected fresh context;
  - `CX-02` complete occupancy measurement;
  - `CX-03` model-aware policy/output reserve;
  - `CX-04` session anchor;
  - `CX-05` raw canonical history/request projection;
  - `CX-06` stable durable checkpoints;
  - `CX-07` honest CLI controls;
  - `CX-08` health/migration semantics;
  - `CX-09` telemetry and live validation;
  - `CX-10` bounded repository context.
- Register server-side compaction, bridge token counting, legacy transcript rehydration, raw blob retention, and persistence/archive optimization as explicitly deferred follow-ups.

## Test plan

### Focused unit tests

- Complete estimator counts all supported request surfaces and array-form result content.
- Thinking/redacted-thinking sizes are counted, and retained signed blocks are byte-identical.
- Calibration pairs the correct request/response and handles clamp, missing usage, retries, and model changes.
- Policy math covers current 1M models, 200k models, large output reserves, unknown models, invalid overrides, and impossible ceilings.
- Low-token/high-message history is unchanged.
- Recent ordinary tool results remain byte-intact.
- Emergency recent-result reduction is head+tail, bounded, visible, and rare.
- Semantic cutoffs preserve parallel multi-tool exchanges.
- Checkpoints are derived from raw input, stable within an epoch, and non-recursive across multiple epochs.
- The anchor is deterministic, bounded, current, and absent from canonical messages.
- System and tools are byte-identical across consecutive pressured requests.
- Cache-control marker count remains within the runner/bridge budget.

### Session/integration tests

- New session stores raw canonical results after lossy projections.
- Resume and fork reproduce raw history plus context state.
- Legacy compacted sessions are labeled honestly and remain valid when structurally sound.
- A bridge failure after projection does not persist the projection.
- Instruction-delta messages cannot split a semantic exchange.
- Forty- and 80-step mock runs retain the original acceptance marker through every projection.
- Multiple checkpoint epochs never contain summary-of-summary text.
- The final store contains the original tool evidence while the outbound projection remains bounded.
- Long healthy runs remain `resume_ok`.
- A too-large one-message prompt stops locally without truncation or repeated `summarize_pending`.
- `--no-session-persistence` still leaves required recovery artifacts but no resume checkpoint.

### CLI/docs tests

- New flag parsing, validation, conflicts, and deprecated-alias warning.
- `--max-tokens` wording is consistently “response output.”
- Command builder generates new flags and never generates the deprecated one.
- Shared docs drift checks cover flag names, formulas, and catalog limits.

## Holistic offline and live validation

### Offline deterministic soak

Run the 80-step large-read fixture against the actual integrated loop and mock Anthropic Messages endpoint.

Pass conditions:

- no fresh ordinary result is altered before model consumption;
- the original objective/acceptance marker is present at every step through the anchor/checkpoint;
- no checkpoint consumes an earlier checkpoint as source;
- system bytes remain stable;
- checkpoints change only at explicit epochs;
- all outbound messages validate;
- projection occupancy returns below target after each lossy decision;
- canonical session history retains the original tool evidence;
- resume/fork continue from canonical history;
- no count-only health degradation.

### Live bridge comparison

Alan has authorized bounded live model tests. Run these only after the full integrated implementation is ready:

1. A small control request.
2. The same eight-read pressure scenario used in the runtime evaluation.
3. A bounded forced-compact scenario using an explicitly lower test threshold so the new pressure path is exercised without a 60-step live burn.
4. Repeat the large-initial-prompt probe only if estimator/policy changes cannot be validated from the existing baseline plus the mock.

Use read-only runner tools, explicit `--max-steps` and output caps, no archive, redacted traces, and `/tmp` artifacts.

Live pass conditions:

- `MULTIREAD_CONTINUITY_OK` or its replacement marker survives;
- the newest ordinary read reaches the model byte-intact;
- the rendered anchor contains the objective and task state after pressure;
- calibrated estimation is within ±20% of observed input occupancy after sufficient samples;
- system/checkpoint prefix hashes remain stable within an epoch;
- cache-read tokens do not collapse because the runner mutated the system; any cache discontinuity is explained with request-prefix evidence rather than assumed;
- session persistence remains raw and resume is allowed;
- output quality is not visibly worse than the baseline control.

Live usage is evidence, not a substitute for deterministic tests. A cache miss alone is not a failure unless the runner changed a prefix that the design says must be stable.

## Whole-landing acceptance gate

The work is ready to land only when all coupled behavior is present and the integrated suite is green.

Run, from the repository root in Terminal:

```bash
# Run every runner-focused Node test.
node --require ./test/setup.js --test test/runner/*.test.js

# Run the full repository suite.
npm test

# Check JavaScript and repository lint rules.
npm run lint

# Check generated/documented runtime facts.
npm run check:docs

# Check repository formatting without rewriting unrelated files.
npm run format:check

# Catch whitespace/conflict-marker mistakes in the final diff.
git diff --check
```

Also require:

- the offline 80-step soak passes;
- the bounded live comparison passes or any provider-side limitation is explicitly evidenced;
- no bridge/auth/proxy/interceptor file changed;
- unrelated working-tree changes remain untouched;
- the concordance tracker and operator docs match the implemented runtime;
- the final diff is reviewed specifically for secret-bearing telemetry and signed-thinking mutation;
- one final Git status identifies every changed/untracked file before commit.

Targeted tests may run throughout implementation, but there is only one final release/commit decision.

## Rollback

The intended rollback is one Git revert of the integrated landing.

The additive `runner.contextState` object is designed so older runner code ignores it. Canonical raw `messages` remain in the existing session field. After rollback, old code could begin destructively compacting those messages again on a future run, so operators should start a fresh session or avoid resuming a pressured session until the failure is repaired.

Do not retain a public “legacy compaction” flag: the old behavior is known to destroy context and is not a safe fallback mode.

## Risks that remain after this landing

- Deterministic checkpoints may still omit semantic nuance even though they are reversible and anchored. The continuity suite is the release gate.
- Raw session files grow for very long runs; this landing measures and warns but does not introduce a blob store.
- Unknown future models use conservative estimated limits until the catalog is refreshed.
- Anthropic cache behavior is server-controlled; the runner can guarantee prefix stability, not a cache hit.
- Already-compacted legacy sessions cannot be perfectly reconstructed without a separate transcript-rehydration tool.
- Server-side compaction may ultimately outperform the client digest, but its bridge compatibility and persistence semantics remain untested and deliberately deferred.

## Sources

- [`docs/compaction-context-runtime-evaluation-2026-07-26.html`](./compaction-context-runtime-evaluation-2026-07-26.html) — live pressure results, offline soak, corrected prior-audit claims, current model limits, and recommended policy experiments.
- [`docs/compaction-context-audit-2026-07-26.html`](./compaction-context-audit-2026-07-26.html) — earlier static audit, retained as supporting evidence where corrected by the runtime evaluation.
- [`docs/postmortems/2026-07-11-compaction-tool-pairing-postmortem.html`](./postmortems/2026-07-11-compaction-tool-pairing-postmortem.html) — semantic tool-use/result pairing failure and regression requirements.
- [`src/runner/context-compactor.js`](../src/runner/context-compactor.js) — current lossy ladder.
- [`src/runner/run.js`](../src/runner/run.js) — current projection promotion, cache decoration, usage, persistence, and budget paths.
- [`src/runner/context-budget.js`](../src/runner/context-budget.js) — existing prompt-cache seams.
- [`src/runner/session-store.js`](../src/runner/session-store.js) — canonical resume checkpoint format.
- [`src/runner/model-catalog.js`](../src/runner/model-catalog.js) — provenance-backed model capability/catalog source of truth.
- [Anthropic model overview](https://platform.claude.com/docs/en/about-claude/models/overview) — current context windows and output limits.
- [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) — cache breakpoints and usage fields.
- [Anthropic context windows](https://platform.claude.com/docs/en/build-with-claude/context-windows) — what contributes to context occupancy.
- [Anthropic server-side compaction](https://platform.claude.com/docs/en/build-with-claude/compaction) — deferred native comparison and its current default trigger.

## Final handoff expectation for the future build

The implementation handoff must state:

- folder and branch;
- the single integrated commit;
- every changed file;
- targeted, full-suite, offline-soak, and live checks;
- checks skipped and why;
- before/after occupancy, continuity, cache-prefix, session-size, and resume results;
- deferred tracker items;
- remaining risks;
- whether the commit was pushed, with no claim of a push unless it actually succeeded.
