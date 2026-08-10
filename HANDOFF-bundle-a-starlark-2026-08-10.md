# HANDOFF — Starlark Bundle A: subtree graduation (R3) + durable campaign budget (R1/R2)

**Date:** 2026-08-10 (Pacific)
**Session:** Claude Code (Fable 5), paid work explicitly authorized by Alan for this session.
**Folder/branch:** `/Users/alanman/Developer/claude-local-bridge-playground`, `main`.
**Recommendation source:** `docs/2026-08-06-starlark-architecture-review.md` (items R1, R2, R3 of R1–R14).

## Outcome in one paragraph

The Starlark phased-hybrid prototype graduated from `~/Developer/orchestration-prototypes/` into this
repo as `starlark-host/` (R3), and live spend is now metered by a durable, cross-process, dollar-shaped
campaign budget ledger (R1/R2) instead of a per-process in-memory cap. Both were validated live under a
$2 ceiling: the repo fan-out and test-triage workflows ran their first-ever paid canaries as two separate
commands drawing from ONE shared campaign allowance, spending $0.094151 total. The manual
"reduce the allowance by hand after each command" ritual is dead.

## Commits (this session, own paths only)

| Commit              | What                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `72f32ae`           | R3 verbatim import of the prototype into `starlark-host/` (code only; run evidence and compiled binary excluded and `.gitignore`d)                                                               |
| `ba6537c`           | R3 adaptation: relative config paths via new `src/config.js`, `__dirname`-derived test paths, root `npm run test:starlark`                                                                       |
| `247f8fa`           | R1+R2: `src/campaign-budget.js` durable ledger + `test/campaign-budget.test.js` + wiring (`bridge.js` awaits budget; both live entrypoints gain `--campaign` and always meter live runs durably) |
| (this doc's commit) | Handoff + root README pointer + mirrored Learned-Workspace-Facts bullet in `AGENTS.md`/`CLAUDE.md` + CWT pointer                                                                                 |

## The durable campaign budget (R1/R2), concretely

- Ledger: `~/.bridge-runner/campaigns/<campaignId>/budget.ledger.jsonl` — append-only JSONL,
  monotonic `seq`, fsync'd appends, records never rewritten (session-ledger discipline).
- Concurrency: every reserve/settle/release runs under an exclusive-create lock file with dead-PID
  stale-lock reclaim, so separate processes serialize on the same ceiling check.
- Crash safety: reservations carry the reserving PID; replay auto-releases reservations from dead
  processes as explicit `release`/`stale_pid` correction records (evidence preserved, never erased).
- Cap immutability: set at `campaign_open`; rejoining with a different `--max-cost-usd` errors.
- Dollars, cache-aware: settlement `costUsd` comes from the runner's `estimateCostUsd`
  (input + output + cache_read + cache_write rates from the versioned model catalog).
- Live runs are ALWAYS durable now: `--campaign <id>` joins a campaign; omitted, a fresh campaign id is
  auto-created and printed in the summary. Mock runs stay in-memory and free.
- Tests (6 new, in `starlark-host/test/campaign-budget.test.js`): durability across instances; cap
  immutability; same-process overbooking; a genuine two-process reservation race (exactly one wins);
  stale-PID sweep with the correction visible on the ledger; and the R2 regression — a cache-heavy
  reconciliation must move the remaining balance.

## Live evidence (2026-08-10, campaign `campaign-2026-08-10-bundle-a`, $2 cap)

| Canary                                                   | Result                                                                         | Notes                                                                                                                                                                                                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `repo_fanout` live (planner Haiku 4.5, workers Sonnet 5) | **partial** — plan first-pass, 6/6 workers OK, synthesis `truncated_synthesis` | First-ever live run of this workflow. Synthesis hit the 2,500-token ceiling — same failure class as three Aug-6 runs; classifier correctly refused to call it `completed`. R10 (map-reduce synthesis, synthesis-only retry) is now a reproduced, evidenced need. |
| `test_triage` live (same models, same campaign)          | **completed** — plan first-pass, 2/2 triage workers OK, synthesis OK           | First-ever live run of this workflow.                                                                                                                                                                                                                            |

Cross-command budget proof: command 2 opened the ledger command 1 wrote — remaining went
$2.00 → $1.925352 → $1.905849. Ledger audit (aggregates only): 1 `campaign_open`, 12 `reserve`,
12 `settle`, 0 `release`, **2 distinct writer PIDs**, settled sum $0.094151 exactly matching the reported
spend; file mode 0600; no lock left behind. Run evidence under `starlark-host/workflow-runs/` (untracked,
sensitive); bridge traces under `~/.claude-local-bridge/traces/workflow-{1c3a60c4…,e0e86723…}.bridge.jsonl`.

## Corrections and honest caveats

- **Erratum in the 08-06 architecture review:** its R2 claim that prototype metering was "token-shaped"
  was wrong — settlement was already dollar-shaped and cache-aware via `summarizeUsage` (the review
  could not read the out-of-git code; see its §6). The real R2 gap was that the _ceiling_ was per-process
  and non-durable. That is what this session closed.
- Cache-aware metering is proven by the regression test through the real `ClaudeBridge` code path with
  synthetic cache-heavy usage. The live canaries carried **zero** cache tokens (the host does not send
  `cache_control`), so no live traffic has exercised the cache rates yet.
- `estimatedCostUsd` in a live summary now reports the **campaign-cumulative** used total, not the
  single command's spend (semantic shift caused by the shared ledger). Canary 2's own spend was the
  delta: ~$0.0195. Consider renaming the field or adding a per-run delta in a follow-up.
- Reservation estimates remain input+output pessimistic (no cache-write component); settlement is
  authoritative. Fine while the host sends no cache_control; revisit if caching is added.
- Dollar figures are local catalog estimates, not billing statements.

## Incidental find/fix outside the Starlark thread (worktree-determinism thread, FYI)

Root `npm test` failed 1/975 on arrival: `worktree-tools.test.js` → "supports parallel slots in one run".
Cause: stale `~/.bridge-runner/worktrees/slot-a` left by a prior interrupted run of that very test
(fixture README + gitdir pointing into a dead `mkdtemp` repo, dated Aug 9 02:23). Once present, the test
fails before its own cleanup, permanently. Removed the residue after verifying it was fixture debris
(contents inspected first); 16/16 now pass, full suite 975 green.
**Open hermeticity finding for that thread:** the enter-worktree tool derives paths from the slot name
under the GLOBAL `~/.bridge-runner/worktrees/`, so a crashed test (or two concurrent runs) collide.
The test should use an isolated worktree root, or the tool should namespace by repo.

## Checks run

- `npm --prefix starlark-host run verify` — Go evaluator builds; **39/39** pass (33 imported + 6 new).
- Root `npm test` — **975 tests, all green** after the stale-residue fix above (969 pass / 1 fail before it).
- `npm run lint`, `npm run check:docs`, `npm run format:check` — all clean.
- Live: two paid canaries as documented; $0.094151 of the $2 campaign cap used; ~$1.906 unspent.

## Skipped / out of scope

- R5–R7 (policy single-sourcing, Starlark pre-lint, adversarial evaluator corpus) — Bundle B.
- R4 live repeated-trial matrix — Bundle C; needs a fresh dollar ceiling decision from Alan.
- R10 synthesis map-reduce/retry — now evidenced twice; recommend pulling it into Bundle B.
- The 8-case evaluation matrix runner remains offline-only by design.
- No push performed (not requested). No bridge/auth/proxy internals touched.

## Suggested next steps

1. **Bundle B** (free): R5 + R6 + R7, plus R10's synthesis-only retry — the truncation reproduced today
   makes R10 cheap to justify and its artifacts are already durable.
2. Then **Bundle C** (paid): R4 repeated-trial scoring harness against a fresh campaign id with an
   explicit cap (today's mechanism makes multi-command campaigns safe by construction).
3. Small cleanups: per-run spend delta in live summaries; consider `cache_write`-aware reservations
   if/when the host adopts prompt caching.
