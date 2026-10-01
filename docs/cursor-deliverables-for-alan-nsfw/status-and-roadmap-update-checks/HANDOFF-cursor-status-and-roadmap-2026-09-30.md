# Handoff — Cursor status and roadmap inventory (2026-09-30)

**Author:** Cursor. **Audience:** Alan, then Codex and Claude after Alan delivers this folder.
**Kind:** status audit and handoff. No runner, bridge, Starlark, or test code was changed.
**Do not treat this as the team consensus.** Alan is collecting three independent audits. This file is only Cursor’s.

Alan-facing page: [alan-status-and-roadmap-report.html](alan-status-and-roadmap-report.html).
Row-level inventory: [project-direction-inventory.csv](project-direction-inventory.csv) (51 data rows).

## 1. What Alan asked for

A full inventory of directions he once approved or wanted, with status, without deleting documents and without cleaning the codebase. Three deliverables, all in this directory. Then commit, push, and sync.

He named the parent folder `cursor-deliverables-for-alan-nsfw` so the other agents would not peek before finishing the same task. Codex had already published `docs/codex-deliverables-for-alan-nsfw/` as commit `e79ffdf` before this audit started. **This session did not open that folder.** If Claude’s folder appears, do not open it until Alan says the comparison phase has started.

## 2. How to read the CSV

Header:

`id,name,area,short_description,approval,status,inception,last_update,where_it_lives,evidence,remaining_work,needs_your_decision,notes,confidence`

Controlled values:

| Column | Values |
| --- | --- |
| `approval` | `explicit_yes`, `standing_keep`, `experiment_ran`, `recommendation_only`, `explicit_stop`, `unclear` |
| `status` | `built_and_current`, `built_then_frozen`, `experiment_done`, `partly_built`, `paused_off_main`, `proposal_only`, `retired_on_purpose`, `planned_not_built`, `known_gap`, `review_backlog`, `not_a_project` |
| `needs_your_decision` | `yes`, `no`, `optional` |
| `confidence` | `high`, `medium`, `low` |

`explicit_yes` means a dated record shows Alan asked for that work. `recommendation_only` means an agent wrote a good idea. Mixing those two is how this repo feels like scope creep.

Counts from the 51 rows:

| status | rows |
| --- | --- |
| built_and_current | 22 |
| experiment_done | 6 |
| partly_built | 8 |
| proposal_only | 3 |
| retired_on_purpose | 3 |
| planned_not_built | 3 |
| review_backlog | 2 |
| built_then_frozen | 1 (`ST-01`) |
| paused_off_main | 1 (`ST-04`) |
| known_gap | 1 (`OR-05`) |
| not_a_project | 1 (`PR-11`) |

## 3. Shared page Cursor wants the four of us to hold

1. The playground is a local Messages bridge plus a runner loop. Starlark is a separate lab. T3 is a client. Hosting is three extra ways to start the bridge.
2. P0-01…P0-12 are closed. Do not say “P0” without the full id. The FD list was also nicknamed P0.
3. Profiles (`--agent`, `--profile`) are retired. `bin/local-bridge-runner.js` has no `--agent`.
4. Starlark R8 stands: no `run_workflow` under `src/runner`. R11 has been used. The freeze has not been lifted. Lifting it is a new decision.
5. Two approved items are actually unfinished:
   - `ST-04` — Starlark lows 5–8. Alan already chose option 2 (forward evaluator cancel, keep the paid plan resumable). The runtime patch is **not** on `main`. `TornLedgerLineError` and `evaluation_interrupted` are absent under `starlark-host/` as of this audit. Transfer instructions are `HANDOFF-starlark-laptop-transfer-2026-09-26.md` (commit `0f99e22`, docs only).
   - `RN-13` — T3 Nightly launcher exists (`bin/t3-cursor-shim.sh`, probe `scripts/acp-live-probe.js`). The 2026-09-26 probe did not complete the cancel-and-second-prompt half because the live bridge failed through `PROXY 127.0.0.1:9090`. Alan’s manual checklist was still open in that handoff.
6. `RN-15` updates `RN-13`: on 2026-09-28 Alan had `--allow-shell` added to both `exec` lines in `bin/t3-cursor-shim.sh` (commit `9e4ab0e`). The 09-26 ACP handoff’s “shim refuses shell” sentence is stale. The script still rejects a capability string containing `shell`.
7. `OR-05` is a real code gap, not a vibe. `unleasedRemaining` in `src/runner/budget-broker.js` still caps only `input_tokens` and `output_tokens`. Cache tokens are stored on release and ignored by the cap. The 2026-08-06 memo (N-3) called this a safety-ceiling bug. It was not separately approved and not fixed. Do not “quietly fix” it inside a status comparison.
8. DBOS-vs-LangGraph (`OR-06`) was explicitly stopped on 2026-08-06. Do not install Postgres for it.
9. Safari 3 Phase B live probes stay unauthorized. Phase A code (FD-01 and the 2026-07-26 A6/A7/A10/A11 batch) did land. Both facts are true.
10. The approved programmatic-tooling sequence (steps 0–3 plus idea 7) is complete. Ideas 1, 3, 4, 10, 11, 12 and parked idea 9 are not a build queue. Idea 9 stays parked on the R8 freeze.

## 4. Stale documents (do not implement from these sentences)

| Document | Stale claim | Use instead |
| --- | --- | --- |
| `CLAUDE.md` Current Work Thread, Starlark bullet | “Low #8 needs an Alan decision.” | Laptop transfer handoff: option 2 already chosen; do not re-ask. Code on `main` does not contain the patch. |
| `HANDOFF-acp-nightly-graduation-2026-09-26.md` §6 | Shim refuses shell. | `bin/t3-cursor-shim.sh` lines around the 2026-09-28 comment. |
| `HANDOFF-round3-results-2026-07-31.md` open list | F6, N1, A3-F1, A3-F2 still open. | Evening handoffs the same day: `HANDOFF-f6-ledger-aware-resume-2026-07-31.md`, `HANDOFF-n1-a3-followthrough-2026-07-31.md`. |
| `HANDOFF-starlark-status-and-recommendations-2026-08-25.md` scorecard | R11 unbuilt; R8 undecided. | R8 decision `a69c2d0` (2026-08-31). R11 `84dd73a` plus mediums through `3bacab3` (2026-09-18). The 08-25 file’s banner is the R8 decision; its body is pre-R11. |
| `docs/Bridge Runner Compaction & Context-Management PLAN -tentative.md` | “Implementation status: Not started.” | History (`19c2a69`) and headlines (`2da8066`) landed later. The one-shot rebuild in that plan did not. |
| `docs/runner-expansion-roadmap.md` | “11 tools today”; `--agent` live; `ask_user_question` unshipped. | `src/runner/tool-catalog.js` (22 modules). Profiles retired 2026-07-25. `ask_user_question` is `c39ca6d`. |
| August 10 Starlark two-axis tables | Current model ranking. | Ceiling 700→1200 and D-F1 landed after those trials. Tables describe the old contract. |
| `HANDOFF-safari-3-remediation-plan-2026-07-25.md` banner alone | No Phase A code exists. | `HANDOFF-safari-3-phase-a-progress-2026-07-26.md`. Live Phase B is still gated. |

`CLAUDE.md` is also missing, as a status narrative, the 2026-09-26 hosting verification, `README-v2.md`, command builder v2 (`66eabb1`), and the T3 shell edit. The 2026-08-22 recalibration proposal (`PR-02`) predicted this. Cursor did not edit `CLAUDE.md` or `AGENTS.md`.

## 5. Source checks performed (not a test run)

- `src/runner/budget-broker.js` `unleasedRemaining`: input and output token caps only.
- `starlark-host/**/*.js`: no `TornLedgerLineError`, no `evaluation_interrupted`.
- `bin/t3-cursor-shim.sh`: both `exec` lines pass `--allow-shell`; comment dated 2026-09-28.
- `src/runner/run.js`: 1978 lines. `src/runner/coordinator.js`: 513. `starlark-host/src/coordinator.js`: 824.
- `docs/ARCHITECTURE.md` exists. `docs/OBSERVABILITY.md` does not.
- `package.json` scripts: no `smoke` / `check` / `ci` wrappers of the HE-07 shape. `test`, `lint`, `check:docs`, `fingerprint:check` exist.
- `bin/local-bridge-runner.js`: no `--agent` / `--profile`.

Not done: `npm test`, Starlark `verify`, live bridge, T3 click-through, reading `~/.bridge-runner` payloads, reading the other agents’ nsfw folders. Published ledger counts in the HTML are copied from the 2026-07-31 writeups, not re-swept.

## 6. Residuals Cursor is deliberately not promoting into work

Still listed somewhere, and not a reason to open a coding session from this handoff:

- A1-F4 dead `orphaned_tool_use` vocabulary; A1-F5 misleading `resume_ok` (`OR-04` notes, last stated 2026-07-31 evening, no later closure found).
- Golden-eval `--update` skips checklist scoring (HE-06 thermo-nuclear Medium 1, `HANDOFF-golden-eval-he06-thermo-nuclear-2026-09-06.md`).
- Context-layer Lows 4–6 (`HANDOFF-context-layer-thermo-nuclear-2026-09-06.md` banner).
- Permission-cache F3 substring invalidation (deferred in the F1 handoff).
- Safari A5 symlink matrix, A8/FD-06 denial reason codes, A9/FD-07 chaos-ok marker: pending in the 2026-07-26 Phase A note; not re-verified line by line.
- HE-04 `run.js` size, HE-05 observability half, HE-07 one-command wrappers, HE-09 coordinator-as-UX.
- R12 evidence-layout split. D-F3 worker-side truncate. August fan-out quality was never scored (N-2).
- Hosting: second Mac not installed; no overnight test; default runner URL remains port 11437.
- README v2 is a draft (`1e06820`). Do not promote it unless Alan says so.
- `PR-06` Harbor and `PR-10` the 2026-07-25 `.cursor` audit are low-confidence rows.

## 7. What the next agent should do with this

Alan will hand you this folder after your own audit exists. Compare inventories. Where you disagree, name the row id and the file you trust. Do not merge the three CSVs by hand into the repo unless Alan asks.

Do not:

- implement `ST-04` from the transfer handoff during the comparison
- edit `CLAUDE.md` to “fix the status” as a drive-by
- delete or archive handoffs
- reopen R8, DBOS, profiles, or Safari 3 Phase B
- read another agent’s `*-deliverables-for-alan-nsfw` tree until Alan starts the comparison

If Alan later asks for one unpaid fix, Cursor’s ranked suggestion is `OR-05` (meter cache tokens in the broker, with a regression test), after the two unfinished yeses are either resumed or explicitly dropped. That suggestion is not authorization.

## 8. Handoff fields

- **Folder / branch:** `/Users/alanman/Developer/claude-local-bridge-playground`, `main`, origin `alankatanoisi/claude-local-bridge-playground`.
- **Files changed:** the three files in `docs/cursor-deliverables-for-alan-nsfw/status-and-roadmap-update-checks/`.
- **Checks run:** documentary. Git preflight and `git pull --ff-only` (already up to date) before writing. Source greps listed in §5.
- **Skipped:** test suite, live bridge, T3, Starlark evaluator, other agents’ deliverables, ledger payload reads.
- **Risk:** `CLAUDE.md` and this handoff now disagree on Low 8’s decision state. Trust the laptop-transfer handoff for the decision, and trust the absence of the patch on `main` for the code. A future agent that “helps” by editing `CLAUDE.md` without Alan’s ask will start a docs fight.
- **Publication:** Alan asked Cursor to commit, push, and sync this folder. The chat that accompanies the commit states whether the push succeeded. Do not infer push success from this file alone if you are reading it before that push.
