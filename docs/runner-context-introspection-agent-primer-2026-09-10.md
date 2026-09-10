# Agent primer: runner context introspection, traces and history

Date: 2026-09-10. Documentation and capability analysis only; no authority to implement new tools, weaken path controls, enable live calls, or edit stored session records.

Folder: `/Users/alanman/Developer/claude-local-bridge-playground`. Branch: `main`. Source revision: `f0f8549ca697acf26a3608cc9cdab18b40c10905`. Startup tree was clean; origin matched the playground; initial fast-forward-only pull was already up to date. Reverify before future edits.

[Human HTML report](runner-context-introspection-2026-09-10.html) · [HTML companion for this primer](runner-context-introspection-agent-primer-2026-09-10.html).

## 1. Main conclusion and vocabulary

Host access, model access, and operator access differ. The host owns live messages, system/tools, projection decisions, request bodies and response usage. The model receives the selected request and can optionally query canonical history through two tools. An authorized external operator can inspect diagnostic files. Ordinary runner file tools do not expose ~/.bridge-runner.

Canonical history means retained messages. Projection means the per-request, potentially shortened view. Request body means the structured object sent to the bridge. A trace is a diagnostic record at a boundary. None of these is the model's internal attention, activations, or full hidden computation.

Do not conflate this runner with starlark-host, or this external Codex session's filesystem permissions with the runtime being analyzed. Child spawn_agent runs explicitly begin without the parent conversation; the parent recall tools do not automatically index every child history.

## 2. Active construction path

```text
canonical messages array (live closure exposed to history tools)
  + separately built system instructions and tool definitions
  -> buildContextProjection(messages, system, tools, policy, calibration)
     -> optional stale removal / clip / stub / raw checkpoint digest
     -> session anchor and hidden-history index when applicable
  -> applyCacheControlBudget()
  -> assertValidAnthropicMessages(cachedMessages)
  -> requestBody {model, max_tokens, system, messages, tools, ...controls}
  -> trace runner_model_request_built BEFORE transport
  -> modelClient.post / postStream -> local bridge
     -> bridge_request_received
     -> model resolution / max_tokens fallback / system reshaping
     -> bridge_request_transformed
     -> upstream transport lifecycle
  -> assembled response, budget and calibration handling
  -> assistant message, tools, tool-result messages
  -> next request uses a fresh projection
```

Source: [run.js](../src/runner/run.js), [context-projection.js](../src/runner/context-projection.js), [bridge handler](../src/handlers/anthropic.js), [bridge trace](../src/bridge-trace.js).

Projection must not replace canonical history. Canonical retention is relative to received tool outputs: it cannot recover bytes never read, tool-level truncation, or content previously lost in legacy-compacted sessions. SessionStore labels older history quality where applicable. The 32 MiB CANONICAL_HIGH_WATER_BYTES value currently produces a diagnostic flag; it is not an enforced cap in the projector despite the shorthand in history-index comments.

The active raw-checkpoint digest is deterministic code over raw messages, not an extra summarizing model call. Presence of legacy context-compactor.js does not establish it is the live path. Inspect current run.js wiring.

## 3. Existing model-facing recall tools

[Tool catalog](../src/runner/tool-catalog.js): history is opt-in. `--capabilities history` ordinarily enables search_history and expand_history. Exact `--tools` allowlists take precedence; inspect actual visibility. No generic request-context inspector exists in the current tool catalog.

[search_history](../src/runner/tools/search-history.js): calls ctx.getCanonicalMessages(), flattens entries, does deterministic literal matching, sorts by score then recency. Default 8/max 25 hits; 240-character snippets; up to 12 terms, each 2+ characters. Kind filtering supports tool_result, tool_use and text. No disk scan, embedding model, or inference call.

[expand_history](../src/runner/tools/expand-history.js): retrieves entry text by tool_use ID or canonical mN / mN.bB address. A tool ID prefers results over input. Default 20,000/max 50,000 character page; minimum 200; offset pages subsequent spans. A range label such as m0–m2 is not an accepted range-query syntax.

[Index helper](../src/runner/tools/_history-index.js): indexes user/assistant text, tool inputs, tool results. Excludes thinking and redacted_thinking. Tool result image/document blocks become placeholders via [tool-result-content](../src/runner/tool-result-content.js); recall does not reproduce binary content. System instructions and tool definitions are not part of the indexed message array.

run.js exposes a closure over `messages`, so in-memory recall works without session persistence or trace capture; resume supplies whatever canonical messages were restored. Returned tool results pass through central redaction. Verbatim means retained text subject to scrubbing and bounds. Recall is not proof the entry appears in the current request projection. Search can miss paraphrases. Recovered text consumes subsequent request context and usage.

Projection markers advertise expansion only when expansion is visible. Stale-read markers direct re-reading current source rather than trusting old bytes. Existing review notes identify narrower capability-advertisement and headline-index edge cases; this documentation task does not repair them.

## 4. File access boundary

[safety.js](../src/runner/safety.js): confinePath rejects absolute paths and out-of-root traversal; resolveFileTarget checks lexical and resolved deny rules; DENY_MATRIX_PATTERNS explicitly includes .bridge-runner directory segments. Host diagnostics use direct filesystem writers, not model file tools.

Three pure resolver probes in this task returned denial: absolute home trace path (working-directory escape), project-local .bridge-runner path (deny rule), and .bridge-runner under a home-directory cwd (deny rule). No trace payload was read by those probes.

Do not suggest enabling shell, changing cwd, symlinking records into the workspace, or removing the deny rule as a context-inspection implementation. A future host-owned, session-scoped view is the natural extension of existing recall. SECURITY.md was consulted to keep this capability explanation aligned with repository boundaries; this is not an exhaustive security audit.

## 5. Record surfaces and timing

[trace-utils.js](../src/trace-utils.js): default runner traces under ~/.bridge-runner/traces/<timestamp>-<runId>.runner.jsonl. Off by default. JsonlTrace.append synchronously appends an event; no token-stream guarantee. Request-built event captures the built body before sending. Response-received captures assembled response if control flow reaches the event; intervening budget stops can omit it.

Levels: summary omits captured payload; redacted and full capture payload. Full is still redacted at append: captureForLevel(full) and JsonlTrace.append have distinct passes, and append calls redactValue with default secret scrubbing. Do not call persisted full payload a byte-exact wire copy. bodySummary's hash comes from the original serialized body and may not match a saved scrubbed payload.

[bridge-trace.js](../src/bridge-trace.js): separate ~/.claude-local-bridge/traces/<traceId>.bridge.jsonl. Incoming and transformed body events; latter is closer to the upstream-bound request. [proxy.js](../src/proxy.js) records lifecycle events and a bounded response preview, not a full stream transcript. Match run/trace ID, turn, boundary and event order; retries can reuse a turn.

[transcript.js](../src/runner/transcript.js): append buffer flushes at 10 events, plus explicit final/usage flushes. Request event is only step/model at the call site; transcript is not the full request. CLI defaults to a logs path; run() only instantiates it when given a path.

[session-store.js](../src/runner/session-store.js): canonical state messages plus runner metadata. saveSoon default debounce 75 ms, configurable; save/flush paths also exist. Saved copy scrubbed without mutating live messages. Requires a resolved path; --new-session creates an ID, but do not assume every invocation has persistence. Transcript resume is deprecated/rejected by current CLI.

[session-ledger.js](../src/runner/session-ledger.js): ordered event records and a sequence/offset/pending-intent cursor. Records operational events, not all request content. appendLedger in run.js scrubs payloads. Event writeSync does not fsync per event in this runner; distinguish the separate Starlark ledger.

[human-log.js](../src/runner/human-log.js): readable sections, optional; omits multimodal bodies and uses assembled responses. [archive collector](../src/runner/archive/collector.js): in-memory during run, exported on finalization. Project-local .bridge-runner recovery manifests are separate from home-level records. [private-fs.js](../src/runner/private-fs.js) uses private file modes and writes/renames; do not infer full power-loss guarantees from synchronous writes.

## 6. Size and pressure visibility

[context-estimator.js](../src/runner/context-estimator.js) estimates serialized system/tools/messages length divided by 4, initially multiplied by 1.5. It is not an exact tokenizer. Matched response usage updates per-model calibration, bounded 0.75..3, with smoothing alpha 0.3. Observed input occupancy sums input_tokens + cache_read_input_tokens + cache_creation_input_tokens. Cached input remains context input; total run token spend is not one-request occupancy.

[context-runtime-policy.js](../src/runner/context-runtime-policy.js) uses local model catalog limits, output reserve, and max(10,000 tokens, 1% of window) margin. Unknown-model fallback is estimated. Do not turn local catalog values into externally verified provider claims. The bridge's count-tokens handler returns a compatibility stub of zero, not an actual measurement.

context_projection events include before/after estimates, thresholds, calibration factor/samples, prior observed occupancy, stages, canonical size, checkpoint epoch, clipping/stubbing/reminder/index metadata. They are emitted to output and trace, not automatically supplied as a model-readable status table. Models see supplied projection markers and reminders; that is narrower than the host's diagnostics.

System/tools are built separately; startup context defaults minimal and richer instruction/repository/skill input is opt-in in [context-policy.js](../src/runner/context-policy.js). Inspect the captured request instead of assuming every local instruction file was injected.

## 7. Time and observer effects

The model requests a tool after generating a response. Tool output can affect the next request, not the already-sent request that caused the tool call. A future inspector should label last-built request ID/time/boundary and never imply it knows the final next-request shape before that shape is constructed.

Reading full request dumps into the conversation can recursively grow context, since future dumps include earlier inspection results. Prefer metadata and paged sections. During streaming, partial text visible to a caller is not necessarily a committed canonical assistant message available for same-run tool recall. Log-file existence or recent modification time does not prove a process is active.

## 8. Aggregate artifact observations

Snapshot approximately 2026-09-10 14:23 UTC / 07:23 PDT. Inspected aggregate metadata/schema only; do not copy raw prompts, ledger text, individual session IDs or source payloads into reports.

- traces: 39 files, 28,668,723 bytes.
- logs: 181 files, 3,291,148 bytes.
- sessions: 221 files, 3,963,755 bytes.
- archive: 924 files, 3,616,051 bytes.
- campaigns: 1 file, 10,928 bytes; worktrees: 0 regular files. Two regular root files not inspected for content.
- Runner traces: 1,649 parsed events, all full capture; zero malformed lines.
- 206 request-built events; all 206 had payload objects with system/messages/tools. 173 response-received, 33 bridge-error, 136 context-projection, 263 tool-request and 263 tool-finished events.
- 23 run-completed and 7 run-failed events. Do not infer causes for other traces or pair requests/responses by aggregate arithmetic.
- 38 matching bridge files for 39 runner run IDs; 203 transformed-request events, all with payloads. This is file/event presence, not exhaustive per-request reconciliation.
- 145 session state files: 26 with nonempty messages, 20 with contextState, zero with populated checkpoint. This does not prove compaction never happened.

Latest directory-file modification in the main diagnostic categories was approximately 14:15:58 UTC. Historical records can come from earlier code or invocation modes. Counts can change while other sessions run.

## 9. Proposed extension, not implemented work

Consider a session-scoped context-status tool first: last built request identity and timestamp, boundary, model, estimate/reserve, catalog provenance, message/tool counts, canonical-vs-projected sizes, shaping stages, checkpoint, prior observed usage. Next, a canonical-to-projection map for verbatim/clipped/stale/digested evidence. Finally, optional bounded section retrieval for system/tool/message snapshots.

Take snapshots at the final request boundary, rather than reconstructing from arbitrary logs. Keep bridge-transformed state distinct. Do not accept arbitrary filesystem paths. Preserve redaction/truncation markers and historical provenance; avoid re-promoting retrieved text into instruction authority. Budget and page retrieval; avoid recursive full-request echo. Current history excludes thinking; broadening that is not necessary for request diagnostics.

Mechanical acceptance should use a local synthetic loop with captured requests to verify identity, ordering, clipping vs canonical retention, system/tool separation, redaction and bounds. Model usefulness and factual self-diagnosis require separate evaluation. A trace cannot establish why a model ignored information that was present.

## 10. Checks and handoff

First targeted run passed: **50 tests, 0 failed, 0 skipped**, across trace-utils, history-tools, context-management-rebuild, context-headlines, session-store-debounce and transcript. Includes the synthetic 80-step large-read projection test; no live model calls. The three resolver checks denied the expected paths. Aggregate private-folder inventory and schema/event counts completed without quoting payload text.

Reproduction for a human: open Terminal using Command-Space, type Terminal and press Return. Enter the following in Terminal, not Spotlight or a browser. Success is the test summary above. The command can take roughly 30 seconds on this machine because of a timer-based test.

```bash
# Put Terminal in the actual playground before using project files.
cd /Users/alanman/Developer/claude-local-bridge-playground

# Exercise the existing local tests for history, projection, traces and saving.
# These use synthetic data and local files, not paid model requests.
node --require ./test/setup.js --test test/trace-utils.test.js test/runner/history-tools.test.js test/runner/context-management-rebuild.test.js test/runner/context-headlines.test.js test/runner/session-store-debounce.test.js test/runner/transcript.test.js
```

If the folder is missing, stop and locate the actual checkout rather than creating a replacement. If node is not found, restore the project's existing Node.js environment; Node.js is the program executing these JavaScript tests. Preserve any failing test output before changing code.

Files changed: this Markdown primer, matching HTML companion and human HTML report in docs/. No source, runtime settings, stored logs or memory edits. No commit/push. Full root suite, live model campaign, exhaustive wire-pair reconstruction and browser-rendered visual inspection skipped: this task documents current mechanics and inspects aggregate existing evidence. Remaining limits are described above; do not call this a completed context-inspector implementation.

Final document checks passed: repository documentation defaults/manifest checks, targeted Prettier checks, HTML nesting and unique anchors, and 91 local links across the two HTML files. Browser visual inspection was not performed. At final status, unrelated working-tree changes appeared in src/credentials.js, src/claude-code-fingerprint-fallback.json and a fingerprint-check automation report. This task did not create or modify those changes; they were left untouched. The three context-introspection documents are the only task-authored files.
