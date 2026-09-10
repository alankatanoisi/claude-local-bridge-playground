# Handoff — Thermo-nuclear review of `19c2a69^..2da8066`

> **CLOSED 2026-09-10 — Medium #1, #2, #3 and Low #7, #8 fixed** (Fable, Alan-directed),
> in this file's recommended order and commit shapes. `6dec086`: hidden-ness is now
> measured on the projected request (`hiddenResultIdsIn` over the shared stub/stale
> marker prefixes; `stats.hiddenToolUseIds` deleted), and the index is estimated
> before it is kept — if it would cross `inputCeiling` it is dropped (stage
> `headline_index_dropped`, `decision.headlineIndexDropped`) instead of stopping the
> run. `2758fe2`: `search_history`'s footer names `expand_history` only when
> `isToolVisible` offers it; runner + coordinator `--help` join
> `OPTIONAL_CAPABILITIES`; `TOOL_SUMMARIES` / `GROUP_LABELS` /
> `FULL_TOOL_DESCRIPTIONS` gained `history`, and the P2-01/P2-02 fixtures now include
> it. Regression tests: early-stop checkpoint restoring stubbed ids (fails pre-fix),
> ceiling-adjacent index drop (fails pre-fix), 14×30k "no indexed id is verbatim in
> the request", split `--tools` allowlist footer. Checks: full suite 1,102 pass / 0
> fail / 1 pre-existing todo; lint, check:docs clean; format:check clean for touched
> files (four pre-existing handoff `.md` files still warn — untouched here).
> **Still open:** Low #4 (`getCanonicalMessages` returns the live array), Low #5
> (stub-only headline wording over-claims), Low #6 (`m0–m2` range label is not an
> expand id), and the § Code quality items. Session record:
> `HANDOFF-context-layer-mediums-closed-2026-09-10.md`. Findings text below preserved
> unchanged.

**Written:** 2026-09-06. Review only; no runner or Starlark source changed
(this file, plus a Current Work Thread pointer in `CLAUDE.md` and a
banner on `docs/programmatic-tooling-research-review-2026-08-31.html`).
**Scope:** already-landed playground `main` range `19c2a69^..2da8066`. No
feature branch. No pull request (a GitHub request to merge one branch into
another) — do not invent one.
**Verified against:** the diffs and the current callers, not against
`HANDOFF-starlark-r11-2026-09-06.md` or `CLAUDE.md` claims.
**Starlark overlap:** `84dd73a`/`406423b` already have a dedicated audit,
[`HANDOFF-starlark-r11-thermo-nuclear-2026-09-06.md`](HANDOFF-starlark-r11-thermo-nuclear-2026-09-06.md)
(Segment C, same day). This file does not re-litigate those findings.
Medium #1–#4 there were re-checked against current `bridge.js` /
`coordinator.js` / `ledger.js` and hold. A trailing torn JSONL line
that `restoreWorkerPhase` fail-closes on is **intentional** (dropping a
truncated `job_succeeded` would re-pay); that overlapping-range probe
is recorded there as Low #7 (name the error), not a skip-the-line fix.

A _thermo-nuclear review_ here means a deep invariant audit: bugs, safety,
and whether the landed shape will fight the next slice. It is not a request
to rewrite the work.

## What this range actually is

Five commits, 2026-09-06:

| Commit    | What it is                                                                      |
| --------- | ------------------------------------------------------------------------------- |
| `19c2a69` | Searchable lossless history + recoverable clipping (`history` capability group) |
| `d02e9d0` | `CLAUDE.md` research-thread pointer (docs only)                                 |
| `84dd73a` | Starlark R11/R14: abortable workers, `--resume <runDir>`, plan/input hashes     |
| `406423b` | Starlark R11 thread-entry handoff (docs only)                                   |
| `2da8066` | Headline index (“what you’ve forgotten”)                                        |

The screenshot that named this range “Segment B — context layer” also said
the in-between commits were “two docs-pointer commits; harmless.” That is
**wrong**: `84dd73a` is real Starlark abort/resume code. Context-layer
findings live in this file. Starlark findings live in the Segment C
handoff named above.

**Not in this range:** `65c001a` (terminal-state checklists / HE-06 goldens,
“Segment A”). That review is
`HANDOFF-golden-eval-he06-thermo-nuclear-2026-09-06.md`.

HEAD at review time: `2da8066`. Unrelated dirty files (`.cursor/*`, untracked
research PDFs) were ignored.

## Verdict

No High findings. Default runs still do not offer `search_history` /
`expand_history`. Recovery hints stay honest when the history group is off.
Stale-read markers still say re-read. Live tool output still goes through
`tool-registry`’s `runAndScrub`. Canonical history is not assigned the
projection. Starlark still has no `run_workflow` runner edge.

The landed context layer **does** change what the model sees. Three Medium
findings sit on that seam: a stale hidden-set after checkpoint (occupancy-
gated; see Medium #1), the index being able to trip
`context_ceiling_unrecoverable`, and `search_history` advertising
`expand_history` when that tool is not offered. A later correctness pass
did **not** reproduce false-hidden on the 14×30k fixture; the stale-set
logic is still wrong. Quality “High” items (tail notes, shared walker,
coordinator extract) stay in § Code quality — they are not runtime High.

Code quality: the behavior is careful; the structure treats each research
idea as another bolted stage. That is not a runtime bug. It will tax the
next context-layer slice (idea 12 counters, another index). See § Code
quality.

## Findings (in-scope for this range only)

No High.

### Medium

1. **After a checkpoint, the headline index can list still-visible
   exchanges as forgotten.**
   `src/runner/context-projection.js` 320–336 then 356–360.
   `reduceOldEvidence` (320–323) stubs/stale-drops old `tool_result`s and
   records their ids on `stats.hiddenToolUseIds` (87, 120, 144). If the
   request is still over the checkpoint threshold, `checkpointProjection`
   (331) is called with the **original** `messages`, not the reduced copy.
   The tests already document this: clip/stub rewrites are discarded
   (`test/runner/history-tools.test.js` 209–211). `projected` becomes
   digest + original tail. `stats.hiddenToolUseIds` is not recomputed.
   `selectHiddenHeadlines` (`context-headlines.js` 141–146) then treats
   any exchange that contains those ids as hidden, even when
   `entry.end > checkpoint.rawCutoff` and the full result is back in the
   tail.
   Trigger: a run that is large enough to stub old results **and** then
   advance a _partial_ checkpoint (the loop in `checkpointProjection`
   217–227 stops at the compact threshold, not at the protected cutoff).
   The stubbed span between `rawCutoff` and the protected tail is restored
   verbatim but still indexed as forgotten. The model may call
   `expand_history` for bytes it can already see, or distrust visible
   results. Decision metadata still reports `oldResultsStubbed` for
   rewrites that are no longer in the request.
   Tests: `context-headlines.test.js` “lists exchanges digested behind a
   checkpoint” only asserts `headlineIndexEntries >= 1`. Nothing asserts
   that a tool_use id present as a full `tool_result` in `projected` is
   absent from the index.
   Occupancy note: a later probe on the 14×30k history-tools fixture
   (`hasStub: false`, `checkpointRawCutoff` 13) did **not** show
   false-hidden — leftover stub ids sat behind the digest and the live
   tail (`tu6+`) was never in `hiddenToolUseIds`. That fixture’s
   checkpoint walks far enough that stub ids ⊆ digested prefix. The
   live hole is the early-stop arm (`checkpointProjection` 217–227
   breaks once occupancy is under `compact` while `rawCutoff` is still
   below the protected cutoff). Fix from `projected` anyway; lock both
   geometries (14×30k: index ids absent from tail; early-stop: restored
   id absent from index).

2. **The headline index can make a previously-fitting request
   unrecoverable.**
   `context-projection.js` 338–343 (emergency reduce), 356–364 (append
   index, up to `MAX_INDEX_CHARS` = 6_000 in `context-headlines.js` 31),
   then 367 and 374–382 (estimate; if over `inputCeiling`,
   `context_ceiling_unrecoverable` with no further reduce).
   Emergency reduction runs **before** the index. The index is bounded
   but not free: ~6k characters is on the order of 1.5k–2k tokens. A
   request that emergency-reduce brought just under the ceiling can now
   stop the run. Before `2da8066` that request would have been sent.
   `run.js` 1440–1451 maps this stop onto
   `STOP_REASONS.CONTEXT_CEILING_UNRECOVERABLE`.
   Tests: none that hold occupancy just under ceiling, enable headlines,
   and assert the run still proceeds (or that the index is dropped rather
   than killing the turn).
   Fix: estimate after the index; if it would cross the ceiling, omit the
   index (or trim it) rather than aborting a request that already
   survived emergency reduce. Do not run a second emergency clip of
   protected tail to make room for an optional note.

3. **`search_history` always tells the model to call `expand_history`,
   even when that tool is not offered.**
   `src/runner/tools/search-history.js` 118 (and the tool description at
   31–32). Clip-marker and headline recovery wording _are_ gated on
   `expand_history` visibility (`run.js` 764, `recoveryHint` in
   `context-projection.js` 72–75, `renderHeadlineIndex` in
   `context-headlines.js` 170–172). The search tool result is not.
   Command-builder (`docs/command-builder.html` 1779–1792, 2473–2491)
   can emit `--tools search_history` without `expand_history` (partial
   group → `--tools`, not `--capabilities history`). `isToolVisible`
   with an allowlist (`tool-visibility.js` 69–74) will hide
   `expand_history`. The model is then told to call a tool that this
   turn will deny — the honesty contract this slice added for markers.
   Failed `expand_history` also points at `search_history`
   (`expand-history.js` 73–81); that pairing is fine when both are
   offered.
   Fix: only append the recover line when `isToolVisible('expand_history',
ctx)` (or refuse to offer one history tool without the other). Prefer
   `--capabilities history` unless the operator really wants a split
   allowlist. Mirror the existing recovery-hint test.

### Low

4. **`getCanonicalMessages` returns the live `messages` array.**
   `run.js` 760: `ctx.getCanonicalMessages = () => messages || []`.
   Comment 759–760 says tools must not mutate it. `search_history` /
   `expand_history` do not. A future history tool, or a buggy one, would
   mutate canonical history (the projection contract’s one hard rule).
   Fix: return a shallow copy, or `Object.freeze` the array (not the
   message objects — signed thinking identity matters). A test that the
   returned array’s `.push` does not change the session array is enough.

5. **Headline copy over-claims for stub/stale-only exchanges.**
   `context-headlines.js` 167–169: “earlier exchange(s) are no longer
   shown verbatim.” For a stub, the assistant turn is still in the
   request; only the result body was replaced
   (`reduceOldEvidence` 89–91 rewrites `tool_result` blocks, not
   assistant text). Clipped head+tail results are correctly _not_ hidden
   (139–140). The stub case is the dishonest one.
   Fix: say results were stubbed/stale-dropped, not that the exchange
   vanished. Keep the stronger wording for checkpointed spans.

6. **Headline range labels look like expand ids.**
   `rangeLabel` (`context-headlines.js` 148–150) prints `m0–m2`. That is
   not an `expand_history` id; `id=m0–m2` misses. Recovery prose says
   `m<index>` or a tool_use id (171). Sharing `tool_use` id as the
   address on both use and result is **intentional** (`resolveAddress`
   prefers the result; tested) — do not “fix” that collision. Print
   `m2` / `tu0` as recover targets, not a decorative en-dash range.

7. **Runner and coordinator `--help` still omit `history`.**
   `bin/local-bridge-runner.js` 89 lists
   `edits, recovery, agents, worktrees, skills, lsp`.
   `bin/local-bridge-coordinator.js` 92 is the same list.
   ACP help is generated from `OPTIONAL_CAPABILITIES`
   (`bin/local-bridge-acp.js` 54) and already includes `history`.
   `--capabilities history` itself works (`normalizeCapabilityList`).
   Command-builder was updated. The CLI help string was not.
   Fix: join `OPTIONAL_CAPABILITIES` (same as ACP) instead of a
   hand-written list.

8. **P2 prompt/catalog plumbing was not updated for `history`.**
   `TOOL_SUMMARIES` (`context-budget.js` 89–110) has no
   `search_history` / `expand_history`. `GROUP_LABELS` (114–123) has no
   `history` (falls back to the raw group name). `FULL_TOOL_DESCRIPTIONS`
   (`context-builder.js` 49–73) omits both tools; non-progressive prompts
   still say “You may only use the tools listed above.”
   `buildToolSummarySection` walks `CAPABILITY_GROUPS`, so the group
   line will name the tools when the group is on; the summaries loop
   will not. P2-01 independent-opt-in (`p2-01-02-tool-surface.test.js`
   67–80) and P2-02 “everything” (157–166) never enable `history`, so
   this drift is unguarded. Enabling the group would fail the P2-02
   “every offered tool appears in the prompt” check if that fixture
   included it.
   Fix: add summaries, a group label, full-section lines, and a P2
   `history` shape next to `skills`.

## Code quality (not runtime bugs; do not “fix” as if they were)

These are the thermo-nuclear _quality_ bar. They overlap Medium #1.

- **Headlines are a third tail special-case.**
  `context-projection.js` 345–366: `appendAnchor` for the session
  anchor, then again for the index. `appendAnchor` now stuffs any tail
  blob onto the last user message. The next index (idea 12 counters)
  will copy this block. Prefer one `appendTailNotes(projected, [anchor,
headlineIndex, …])`; keep `context-headlines.js` as a producer.
- **Hidden-set is reconstructed from side channels, not from
  `projected`.** Same root as Medium #1. One
  `exchangesNotVerbatimIn(canonical, projected)` would delete
  `hiddenToolUseIds` and the comment-only emergency rule.
- **Three walks of the same messages array** (`toolUseById` /
  `digestRawMessages`, `buildHeadlines`, `buildHistoryIndex`). A new
  block type has to be taught three times. A shared iterator in
  `message-contract.js` is the judo move; do not rush it in the same
  slice as Medium #1 unless it falls out of the hidden-set rewrite.
- **`run.js` is already 1972 lines;** this range added ~12
  (`getCanonicalMessages` + recovery flag). Do not keep feeding that
  file. Starlark `coordinator.js` 622 → 874 is owned by
  `HANDOFF-starlark-r11-thermo-nuclear-2026-09-06.md` Medium #4.
- **Checkpoint digest already summarizes forgotten turns**
  (`digestRawMessages` 162–200, 600-char head/tail). Headlines then
  re-list the assistant’s first 120 chars for `entry.end <= rawCutoff`.
  Unique headline work is stub/stale in the _live tail_. Optional later
  narrowing: headlines only where the digest is not already the summary.
- Tests pin incidental render (`context-headlines.test.js` 112–117 full
  line with `30k chars` / `ids: tu0`). Keep invariant assertions
  (canonical untouched, recovery wording gated, roll-up cap, tail not
  prefix). Do not pin `humanChars` formatting.
- `message-contract.js` `contentBlocks()` returns `[]` for string
  content and throws otherwise, so headlines/index reimplemented a
  total flatten. Export `iterBlocks` or stop treating `contentBlocks`
  as the canonical walker.
- Roll-up tool counts parse `toolSummary` prose
  (`context-headlines.js` 175–184). Count from `tools[].name` on the
  headline object.

## Not bugs (do not fix)

- Opt-in `history` group, not core. `tool-catalog.js` 129–132, 165;
  `tool-visibility.js` 48–53; tests in `history-tools.test.js` 158–172.
  Shell still cannot be enabled via `--capabilities`.
- Recovery hints on clip/stub/emergency markers only when
  `expand_history` is visible. Stale-read markers never get the hint
  (`recoveryHint` 70–71, 122; tests 228–277).
- Clipped head+tail results are not “hidden” (bytes remain plus their
  own marker). That is the product rule.
- Live `search_history` / `expand_history` go through
  `registry.execute` → `runAndScrub` (`tool-registry.js` 114, 165).
  Direct `module.execute()` skipping redaction is the same as every
  other tool and is not the run loop. Test 175–192 covers the live
  path. Image/document blocks stringify to placeholders
  (`tool-result-content.js` 47–48), so search does not dump base64.
- Headlines of checkpointed turns re-surface at most the assistant’s
  first 120 characters. The digest already includes 600-character
  head/tail of those same turns. Not a new secret surface versus the
  digest. Projection messages are the model request (canonical is
  stored verbatim by design; P0-11 scrubs sinks, not the live request).
- Thinking / `redacted_thinking` excluded from the history index
  (`_history-index.js` 70; test 69–72).
- Canonical history is not assigned the projection (header contract;
  `context-headlines.test.js` 140–144).
- `getCanonicalMessages` closing over `let messages` so resume
  reassignment is visible: the right layer; freeze/copy is Low #4, not
  a redesign.
- ACP `CAPABILITY_TOGGLES = OPTIONAL_CAPABILITIES` (`acp/agent.js` 58)
  now includes `history`. Defaults are false unless
  `configDefaults.capabilities.history` is set (`defaultConfig` 311–315).
  That is an intended host toggle, not a leak. T3 drops these toggles
  (comment 135–137); they stay on the agent command line.
- `spawn_agent` children do not inherit capabilities
  (`child-inherit.js` 23–47). They start from core unless the child CLI
  is given flags. History does not leak into workers.
- Command-builder maps a full history pair to `--capabilities history`
  and a partial pick to `--tools` (2473–2491). That is the existing
  P2-01 pattern. The honesty bug is Medium #3, not the mapping.
- `tool_use` / `tool_result` sharing the tool-use id as `entry.address`,
  with `resolveAddress` preferring the result (`_history-index.js`
  125–140). Intentional alias. Low #6 is only the `m0–m2` range label.
- No `run_workflow` runner edge. R8 holds. Starlark abort/resume
  “not bugs” live in the Segment C thermo handoff.
- Docs-only `d02e9d0` and `406423b`.
- `input.headlines !== false` as a test kill switch. Odd, but it keeps
  production always-on for idea 7 without stubbing the module.

## Recommended fix order

Stay in the projection and history tools. Do not touch credentials,
proxy, or the runner loop’s tool dispatch unless a finding forces it.
Do not mix Starlark abort/resume into the same commit as Medium #1
unless Alan asks; that work is owned by
`HANDOFF-starlark-r11-thermo-nuclear-2026-09-06.md`.

1. **Medium #1** — Hidden-set from the actual `projected` messages.
   Regression: fixture that stubs, then checkpoints with a cutoff that
   restores a previously stubbed id; that id must not appear in the
   headline index; a digested id still must. Also lock the 14×30k
   geometry: index ids are absent from the projected tail.
2. **Medium #2** — If the index would cross `inputCeiling`, drop or
   trim it; do not abort. Test: occupancy just under ceiling, large
   hidden set, no `stopReason`.
3. **Medium #3** — Gate the search recover-line on `expand_history`
   visibility (same honesty rule as markers).
4. **Low #7 + #8** — `--help` lists `OPTIONAL_CAPABILITIES`; P2
   summaries / group label / full descriptions / P2-01+P2-02 `history`
   shape. Cheap catalog work; can land with #3.
5. **Low #4–#6** only if still in the tree after #1 (copy/freeze,
   wording, range labels). Do not invert the result-preferring alias.
6. **Quality, later:** tail-notes helper; shared canonical block
   iterator. Not blockers for the Medium fixes.

## Pointers for the implementing agent

- Preflight: folder
  `/Users/alanman/Developer/claude-local-bridge-playground`, branch
  `main`, `origin` = `alankatanoisi/claude-local-bridge-playground`.
  Pull `--ff-only` if the tree is clean. Do not start from the
  canonical repo (`claude-local-bridge`).
- `buildContextProjection` is the only owner of lossy request shaping.
  Recompute hidden-ness there (or from its output), not in a second
  guess over canonical history.
- `historyRecoveryEnabled` is computed once from
  `isToolVisible('expand_history', ctx)` (`run.js` 764) because
  visibility is fixed at startup. Keep that. Do not infer recovery
  from `enabledCapabilities` alone (`--tools` allowlist can split the
  pair).
- Do not restore `--agent` / `--profile`. Do not add a runner
  `run_workflow` / `run_block` edge (R8). Do not edit
  `src/credentials.js`, `src/proxy.js`, `src/server.js`.
- Targeted tests:
  `node --require ./test/setup.js --test test/runner/history-tools.test.js test/runner/context-headlines.test.js test/runner/context-management-rebuild.test.js test/runner/tool-catalog.test.js`.
  Then `npm test` / `npm run lint` before handoff.
- Thread entries after a fix: banner this file closed (same pattern as
  `HANDOFF-acp-ask-user-question-thermo-nuclear-2026-08-31.md`) and keep
  the banners on `HANDOFF-starlark-r11-2026-09-06.md` / `CLAUDE.md` in
  sync.
- Commit/push only if Alan asks.
- `65c001a` (eval harness / HE-06) was **not** reviewed here; see
  `HANDOFF-golden-eval-he06-thermo-nuclear-2026-09-06.md`.

## Suggested commit shape (if asked)

One commit is enough for Medium #1+#2 (same file):
`fix(runner): derive headline hidden-set from the projected request; drop the index instead of tripping the ceiling`.

Medium #3 + Low #7+#8 as a second commit (tools + prompt catalog + `--help`):
`fix(runner): gate search_history recover-line on expand_history; list history in P2 prompts and --help`.

Starlark abort/resume fixes: follow
`HANDOFF-starlark-r11-thermo-nuclear-2026-09-06.md`, not this file.
