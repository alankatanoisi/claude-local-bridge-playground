# Context-layer thermo-nuclear findings closed — 2026-09-10

**Author:** Fable (Claude Code), executing Alan's "go ahead with Item 1" decision from the
2026-09-10 morning planning session. Implements the fix order written in
[`HANDOFF-context-layer-thermo-nuclear-2026-09-06.md`](HANDOFF-context-layer-thermo-nuclear-2026-09-06.md)
(Cursor review of `19c2a69^..2da8066`). That file now carries a CLOSED banner; its findings text is unchanged.

**Live spend:** $0. Every change is local code and local tests; the bridge was not called.

## What changed and why (plain language)

The **headline index** is a short note the runner appends to the end of a model request when it has hidden
old exchanges to save context space. It lists what was hidden so the model knows those turns exist. The
review found three ways the note could mislead or harm the run.

### Medium #1 — the note could list things the model could still see (`6dec086`)

The projection works in passes. An early pass replaces ("stubs") old tool results with short markers. A
later pass, the **checkpoint**, digests the oldest turns into a summary — but it rebuilds the rest of the
request from the _original_ messages, silently undoing the earlier stubs for anything after the cutoff.
The index was fed from a list of ids written down during the stubbing pass, so it could name results that
were back in full. The model might then re-fetch bytes it already had, or distrust visible results.

Fix: hidden-ness is now measured on the request that is actually sent. `hiddenResultIdsIn` in
`src/runner/context-projection.js` scans the projected messages for tool results whose bytes were replaced
outright (the stub and stale-read marker prefixes, now shared constants). The reduction-time id list was
deleted. Clipped results (which keep real head+tail bytes) are still not counted as hidden — that product
rule is unchanged.

### Medium #2 — the note could kill a run that would otherwise have worked (`6dec086`)

Emergency reduction runs before the index is added. The index is bounded at 6,000 characters but not
free. A request that emergency reduction had just squeezed under the ceiling could be pushed back over by
the index, and the run would stop with `context_ceiling_unrecoverable`.

Fix: the index is estimated before it is kept. If appending it would reach the input ceiling, it is
dropped and the run proceeds. Decision metadata records this as stage `headline_index_dropped` and
`headlineIndexDropped: true`, so a reader of the ledger can tell the index was withheld rather than absent.

### Medium #3 — `search_history` promised a tool the run might not offer (`2758fe2`)

The `search_history` result always ended with "Recover any entry verbatim with `expand_history`". A
`--tools` allowlist can offer `search_history` without `expand_history`, and the model would then be told
to call a tool the turn will deny. The projection's own markers already avoid this; the tool did not.

Fix: the footer consults `isToolVisible('expand_history', ctx)` and otherwise says to re-run the source
tool. The require is lazy inside `execute` because `tool-catalog` loads this module at startup and
`tool-visibility` requires `tool-catalog` back (a load-order cycle if done at the top). The tool
description no longer presents the pairing as unconditional.

### Low #7 and #8 — `history` missing from `--help` and the prompt catalog (`2758fe2`)

Runner and coordinator `--help` listed capability groups by hand and omitted `history`; both now join
`OPTIONAL_CAPABILITIES` from `tool-catalog.js`, the way the ACP entrypoint already did. The progressive
prompt (`TOOL_SUMMARIES`, `GROUP_LABELS` in `context-budget.js`) and the full prompt
(`FULL_TOOL_DESCRIPTIONS` in `context-builder.js`) gained entries for both history tools. The P2-01
independent opt-in test, the P2-02 prompt/offer concordance shapes, and the "everything" shape now include
`history`, so this drift is guarded from now on.

## Tests added

- `test/runner/context-headlines.test.js` — new suite "hidden-set honesty and ceiling safety":
  - early-stop checkpoint geometry (300k first result, four 8k stubbables, two 30k protected) that restores
    stubbed ids verbatim; those ids must be absent from the index while digested ids remain. **Fails on
    pre-fix code.**
  - 14×30k geometry: no id listed in the index may have a verbatim result anywhere in the projected request.
  - ceiling-adjacent: input ceiling set 60 tokens above the no-index occupancy; the run must proceed with
    `headline_index_dropped`, no `stopReason`. **Fails on pre-fix code.**
- `test/runner/history-tools.test.js` — footer names `expand_history` only when offered; the live route
  (a `--tools search_history` allowlist through `computeAllowedTools`) must not advertise it.
- `test/runner/p2-01-02-tool-surface.test.js` — `history` added to the independent opt-in table, the
  concordance shapes, the "everything" shape, and the full-section visibility check.

## Evidence (real output, this machine)

| Check                                                                   | Result                                                          |
| ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| `context-headlines.test.js` vs **unfixed** projection (git stash probe) | 12 pass / 2 fail (both new Medium tests red, as intended)       |
| `context-headlines.test.js` after fix                                   | 14 pass / 0 fail                                                |
| Four targeted context/history files (review's suggested set)            | 52 pass / 0 fail                                                |
| `history-tools` + `p2-01-02-tool-surface` after slice 2                 | 44 pass / 0 fail                                                |
| Full `npm test`                                                         | **1,102 pass / 0 fail / 1 pre-existing todo** (1,103 total)     |
| `npm run lint`, `npm run check:docs`                                    | clean                                                           |
| `npm run format:check`                                                  | clean for every touched file; 4 pre-existing handoff `.md` warn |
| `--help` on runner and coordinator                                      | both list `history` in the capability groups                    |

The four pre-existing Prettier warnings are on `HANDOFF-golden-eval-he06-thermo-nuclear-2026-09-06.md`,
`HANDOFF-permission-cache-thermo-nuclear-2026-09-07.md`, `HANDOFF-starlark-r11-thermo-nuclear-2026-09-06.md`
and (before this session) `HANDOFF-context-layer-thermo-nuclear-2026-09-06.md`; the last one was formatted
here when its banner was added. The other three were not touched — they belong to other threads.

## Deliberately not done

- **Low #4–#6** from the review (freeze/copy `getCanonicalMessages`, stub-only headline wording, `m0–m2`
  range labels) and the **§ Code quality** items (tail-notes helper, shared block iterator). The review
  ranked them below the Mediums; they are cheap follow-ups, not blockers.
- **Starlark abort/resume Mediums** (`HANDOFF-starlark-r11-thermo-nuclear-2026-09-06.md`) — Item 2 of the
  2026-09-10 plan, next in line, still open. Until they land, treat Starlark `--resume` after an interrupt as
  "may double-spend."
- `docs/command-builder.html` and `docs/runner-quickstart.html` — no flag or capability changed; the
  command-builder already knew `history`. README's headline-index paragraph was updated.
- The untracked `docs/automation-ledger/fingerprint-checks/2026-09-10T14-27-45-109Z-check.md` (Claude Code
  fingerprint drift report, 2.1.223 → 2.1.267) was left as found for the hygiene batch (Item 3).

## Handoff fields

- **Folder/branch:** `/Users/alanman/Developer/claude-local-bridge-playground`, `main`, `origin` = playground.
- **Commits:** `6dec086` (Medium #1+#2 + tests), `2758fe2` (Medium #3 + Low #7/#8 + README), plus the
  closure commit carrying this file, the banner, and the `CLAUDE.md` pointer.
- **Files changed:** `src/runner/context-projection.js`, `src/runner/tools/search-history.js`,
  `src/runner/context-budget.js`, `src/runner/context-builder.js`, `src/runner/run.js` (comment only),
  `bin/local-bridge-runner.js`, `bin/local-bridge-coordinator.js`, `README.md`, three test files, the
  review handoff (banner), `CLAUDE.md`, this file.
- **Checks run / skipped:** see Evidence. Skipped: live model runs (not needed), Starlark suite (untouched).
- **Risks / next:** none known for these fixes. Next: Item 2 (Starlark abort-commit protocol), then the
  Item 3 hygiene batch. Not pushed unless Alan asks.
