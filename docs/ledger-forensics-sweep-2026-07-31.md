# Ledger Forensics Sweep — 2026-07-31

| Field     | Value                                                          |
| --------- | -------------------------------------------------------------- |
| Type      | Read-only forensics sweep (C3)                                 |
| Workspace | `~/Developer/orchestration-prototypes/c3-ledger-forensics/`    |
| Data      | Every `*.ledger.jsonl` under `~/.bridge-runner/sessions` (141) |
| Twin      | `docs/ledger-forensics-sweep-2026-07-31.html`                  |

**Privacy rule:** real ledgers contain prompts and file paths, so this report contains
**counts only** — no event payload text, no session ids, no paths from inside any ledger.

## Method

`sweep.js` drives off ledger files (not `.state.json`, since 84 ledgers have no state
sibling), synthesises a session path per ledger, and calls the repo's own
`replayFromLedger` inside a try/catch, so a corrupt ledger is a data point rather than a
crashed sweep. It is read-only over the sessions directory: `SessionLedger` opens its
write fd only on `append()`, which the sweep never calls, and `replay-simulator.js`
contains no write calls. Raw per-ledger counts land in `results/sweep.json` next to the
script (outside git).

It also probes the **guard asymmetry** in `session-ledger.js`: `append()` opens a
pending intent only when the event has an `effectId`, but the full-scan recovery path
(`_loadLastSeq()`) opens one for _any_ `*_intent` event. The sweep reconstructs pending
intents under both rules per ledger, plus what replay actually reports.

## Headline numbers

| Measure                       | Count                         |
| ----------------------------- | ----------------------------- |
| Ledgers found                 | 141 (4,175 events)            |
| — with `.state.json` sibling  | 57                            |
| — with `.cursor.json` sidecar | 57                            |
| Replayed successfully         | 141 (0 errored)               |
| Corrupt / truncated tails     | **0**                         |
| Clean (no issues)             | 72 (51.1%)                    |
| With ≥1 issue                 | 69 (48.9%)                    |
| Issue kinds observed          | 1 (`pending_effect` only)     |
| `pending_effect` occurrences  | 187, across 69 sessions       |
| Guard-rule divergent sessions | **60** (42.6% of all ledgers) |

**Note (corrects F7 in the round-3 handoff):** the handoff said 60 ledgers have a
`.state.json` sibling; the sweep counts **57**. The 141-ledger figure is confirmed.

## The 187 pending effects are two different populations

| Population                                                           | Sessions | Occurrences | Dates                   | What it is                                                                                                                                  |
| -------------------------------------------------------------------- | -------: | ----------: | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Phantoms** (intent events with no `effectId`)                      |       60 |          84 | all 2026-05-24          | Old-format events. Under `append()`'s guarded rule these sessions have **zero** pending intents; only the unguarded scan rule reports them. |
| **Genuine unresolved intents** (have `effectId`, no matching result) |        9 |         103 | 2026-05-25 → 2026-06-12 | Real intent-opened-never-closed records, averaging ~11 per affected session.                                                                |

In every one of the 141 ledgers, replay's reported count equals the **unguarded** count
(`reported != guarded` in exactly the 60 divergent sessions; `reported != unguarded` in
zero). So the replay simulator inherits the scan-path rule, and **45% of everything it
reports as a pending effect (84 of 187) is a phantom** that the ledger's own append-time
bookkeeping would never have opened.

The divergence is not hypothetical: 57 ledgers have a `.cursor.json` and 84 do not, so
today the _same_ recovery question ("what was pending?") is answered by the cursor rule
for some sessions and the scan rule for others, and for the 2026-05-24 cohort those two
answers differ.

## Issue rate by session size

| Size bucket (events) |   n | With issues |
| -------------------- | --: | ----------- |
| 1–10                 |  82 | 48.8%       |
| 11–50                |  37 | 73.0%       |
| 51–200               |  19 | 10.5%       |
| 201+                 |   3 | 0.0%        |

Issue rate does **not** grow with session length — the opposite. This fits the cohort
explanation below: the issue-bearing sessions are old and small/medium, not long-running.

## Issues are historical, not current

Grouping the by-day cross-tab into eras:

| Era (ledger mtime)         | Sessions | With issues |
| -------------------------- | -------: | ----------- |
| 2026-05-24 (oldest cohort) |       84 | 71.4%       |
| 2026-05-25 → 2026-06-12    |       10 | 90.0%       |
| 2026-06-28 → 2026-07-29    |   **47** | **0.0%**    |

Every ledger written since 2026-06-28 replays clean. Whatever produced phantom intents
(events without `effectId`) and abandoned intents was fixed or superseded by late June;
the current ledger format shows zero unresolved intents and zero corrupt tails across
47 sessions.

## Findings

1. **C3-1 — Physical durability is perfect in this corpus.** 141/141 ledgers parse,
   0 corrupt or truncated tails, 0 replay errors. The synchronous `fs.writeSync`
   ledger write path (F8's "surviving half") is empirically holding.
2. **C3-2 — The guard asymmetry is real and widespread, not theoretical.** 60 ledgers
   (42.6%) report different pending-intent counts depending on which recovery path runs.
   All are the 2026-05-24 cohort, but the _code_ asymmetry is still present: a future
   `*_intent` event lacking `effectId` would re-create the divergence. Candidate fix
   (not made this round): give `_loadLastSeq()` the same `effectId` guard as `append()`,
   or treat guard-less intents as a validation error at append time.
3. **C3-3 — Replay inherits the unguarded rule**, so 45% of its reported pending
   effects here are phantoms. Any tooling that trusts `replayFromLedger` issue counts
   (including a future `--repair`) would over-repair old sessions.
4. **C3-4 — `applyRepair` is still a stub (F6, documented not fixed).** Detect and plan
   work; apply returns `{applied: true}` without mutating anything and is env-gated.
   Given C3-3, that stub is currently _safer_ than a real implementation would be —
   a real one fed unguarded counts would fabricate 84 repairs.
5. **C3-5 — Count correction:** 57 (not 60) ledgers have a `.state.json` sibling;
   84 of 141 ledgers have no state checkpoint at all, so ledger-only recovery is the
   majority case in the real corpus, not the edge case.

## What this means for A1 (crash-recovery bakeoff)

- The interesting durability risk is **not** ledger corruption — the corpus shows none.
  A1 should focus where F8 points: the debounced `state.json` checkpoint losing writes
  on signal death while the synchronous ledger survives, and `--resume` reading only
  the checkpoint.
- A1's phantom-vs-genuine framing now has a baseline: a healthy modern session should
  show **zero** pending intents after clean exit; any pending intent seen after a
  `kill -9` is signal, not noise.
- Any repair experiment in A1 must reconcile the two pending rules first (C3-2/C3-3),
  or its "what needs repair" input is 45% phantom.
