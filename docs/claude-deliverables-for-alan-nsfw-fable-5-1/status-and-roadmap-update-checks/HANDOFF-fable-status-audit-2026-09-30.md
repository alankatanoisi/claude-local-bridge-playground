# HANDOFF — Full status audit of every project direction (Fable, 2026-09-30)

**Doc type:** agent-facing status report + handoff hybrid. **Audience:** Codex, Cursor, and the next Fable session, after Alan releases it. **Facts verified as of 2026-09-30 (evening, Pacific).**

**Author:** Fable (Claude Code, model `claude-fable-5-1`), at Alan's direction. **Deliverable set:** this file, `alan-status-report-2026-09-30.html` (Alan-facing), and `project-direction-inventory-2026-09-30.csv` (one row per direction, initiative, finding, or decision). The CSV is the source of record; the HTML's inventory table is generated from it.

**Rules this audit followed.** Read-only with respect to everything outside its own output folder. Nothing deleted, moved, renamed, or edited. No branches merged. No live model calls ($0 spent). The Codex, Cursor, and Opus-5.5 deliverables folders under `docs/*-deliverables-for-alan-nsfw*` were not opened; only their file names were listed. Alan will release all three agents' reports together.

---

## 0. Read this first: ranked findings

Severity here means "how much it matters that someone acts", not code-review severity.

| # | Severity | Finding | Where the detail is |
|---|---|---|---|
| 1 | **Security event** | A Claude Code OAuth token (`sk-ant-oat01-…`) was committed on 2026-08-09 (`2bdc167`, `docs/5-paste-block-tests/paste-block-3`), removed 2026-08-10 (`39ec363`), and remains reachable from `origin/main` of a **public** repository. The 08-10 architecture review flagged it as P0. No rotation, history-rewrite, or secret-scanning record exists in the repo. Value never printed; verified by pattern-class counts only. | §2 |
| 2 | High | The newest Starlark code (Low #5–#8 + three corrections, 18 files, +1,579/−63) sits on branch `codex/starlark-resume-2020-2026-09-26` (3 commits dated 2026-09-27, pushed as `2596b2c`), unmerged, unreviewed, and absent from `CLAUDE.md`. The 09-18 code (`3bacab3`) was requested for Cursor review three times; the 09-27 brief's range excludes it. | §4.1 |
| 3 | High | PR #26 (Codex, 2026-08-31) contains a working fix for HS-01, the one TODO in the suite, bundled with rewrites of `CLAUDE.md`, `AGENTS.md`, the charter, and the Codex template. Dry merge: code files merge clean; the four doc files conflict. 64 commits behind. No handoff mentions it. | §4.4 |
| 4 | Medium | `runner eval --update` reports checklist-only golden cases as passed without scoring them (Cursor GE Medium #1, 09-06). Confirmed in `src/runner/golden-eval.js` ~580–593 today. ~20-line fix; 24 days with no decision. | §4.6 |
| 5 | Medium | Tracking has detached from building. The "single tracker" (`docs/runner-runtime-concordance-assessment-2026-07-17.html`) is frozen at `e33580b` (07-26). `CLAUDE.md`'s pointers-only section is a ~100-line status block headed "Status as of 2026-07-31". Zero `FD-` strings in the tracker. Thirteen P2 items have no status anywhere. | §3, §4.7 |
| 6 | Medium | Owner-gated items with no re-authorization: Safari 3 Phase B (authorization expired 2026-07-25 night); research-thread next slice (open since 09-06); Low #8 decision recorded as both pending and decided in two same-day docs. | §5 |
| 7 | Low | Operational noise: GitHub Pages deploy workflows have failed on every one of 145 runs since 08-06 (site 404; nothing is published); two open PRs (#26, #21) and two test issues (#18, #20); six worktrees; three root Markdown files fail `format:check`. | §2, §6 |

---

## 1. Verification record

All on `/Users/alanman/Developer/claude-local-bridge-playground`, branch `main`. Local `main` at start of session: `e79ffdf` (= `origin/main`). During the session a commit `f8a749d` ("docs: add Cursor's private inventory of playground directions", 21:44) appeared on local `main` from a concurrent Cursor session; it adds three files under `docs/cursor-deliverables-for-alan-nsfw/` and was not read.

```
npm test               # tests 1162  pass 1161  fail 0  todo 1 (HS-01)   184.9 s
npm run test:starlark  # tests 128   pass 128   fail 0  skip 0           152.0 s  (Go 1.26.8; evaluator rebuilt 2026-09-30 18:47)
npm run check:docs     # pass — 22 tools (apply_patch hidden), 78 flags, 15 models, default claude-sonnet-5
npm run lint           # pass (eslint exit 0)
npm run format:check   # FAIL — HANDOFF-golden-eval-he06-thermo-nuclear-2026-09-06.md,
                       #        HANDOFF-permission-cache-thermo-nuclear-2026-09-07.md,
                       #        HANDOFF-starlark-r11-thermo-nuclear-2026-09-06.md  (pre-existing; untouched)
```

Spot checks that changed or confirmed a status (all read-only):

- `src/runner/golden-eval.js` ~580–593: `--update` branch pushes `ok: true` for checklist-only cases and `continue`s before `evaluateChecklist` (GE-M1 confirmed).
- `starlark-host/experiment.config.json:13` `fixedPlannerModel: "claude-fable-5"`; `starlark-host/src/workflow-runner.js:240,330` and `coordinator.js:412` report `budget.usedUsd` (S25-DEFAULTS, S25-DELTA still open).
- `starlark-host/src/worker-contract.js:26` `summaryMaxChars: 1200` (D-F2 landed).
- `docs/Bridge Runner Compaction & Context-Management PLAN -tentative.md:5` still reads `Implementation status: Not started` (landed `e33580b`).
- `wc -l src/runner/run.js` = 1978 (HE-04 regression from 1,709).
- `test/runner/effort-passthrough.test.js` "injects small CLAUDE.md delta…" passes today (07-20 "known failing, needs an owner" resolved unrecorded).
- `src/runner/worktree-utils.js:49` root under `~/.bridge-runner/worktrees`; no worktree exemption in `src/runner/safety.js` (08-10 P1-1 still implied by source; not probed live).
- `git merge-tree --write-tree main origin/codex/hs01-charter-roadmap-refresh`: conflicts in `AGENTS.md`, `CLAUDE.md`, `docs/agent-team-charter-2026-08-25.md`, `docs/templates/CODEX-TASK-template.md`; all code/test files auto-merge.
- Bridge ports: 11437 answers HTTP (404 on `/ping`; there is no such route — routes are `/v1/messages`, `/v1/messages/count_tokens`, `/v1/debug`) in ~4.1 s, held by VS Code "Code Helper (Plugin)" pid 22175; 11467 standalone answers in 0.09 s; 11447/11457 not running. Installed standalone snapshots (4 releases) carry fallback fingerprint `claudeCodeVersion 2.1.267`; checkout has `2.1.283`.
- `gh repo view`: visibility PUBLIC. `gh api …/secret-scanning/alerts` → `[]`. Dependabot open alerts: 0. Open PRs: #26, #21. Open issues: #18, #20 ("gchat test"). Pages: build_type workflow, 73 static + 72 jekyll runs, 0 successes, site 404.

Not verified: whether the historical OAuth token is still valid; whether the everyday bridge completes a model call; the other laptop's state; the 08-10 review's P1-5 (retries consume steps) and P2-4 (suite hermeticity).

---

## 2. Concrete security event (read before anything else)

- **What:** commit `2bdc167` (2026-08-09, "Add new paste block test files…") added `docs/5-paste-block-tests/paste-block-3` (no extension) containing a pasted Terminal line of the form `export CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-<redacted>`. Commit `39ec363` (2026-08-10) removed that one line while renaming the five paste-block files to `.txt`.
- **Exposure:** both commits are ancestors of `origin/main`; the repository is public. `git log -S'CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01' -- docs/5-paste-block-tests/` returns exactly those two commits.
- **Prior record:** `docs/runner-architecture-progress-review-2026-08-10.md` §6 P0 and §9 Step 0 asked for rotation, history cleanup, and a scanning gate. `SECURITY.md` (same day) does not mention it. No later commit message references rotation, revocation, history rewriting, or a scanner. `.github/workflows/` contains no secret-scanning job.
- **GitHub side:** secret-scanning alerts endpoint returns an empty list. That does not establish the token was invalid, expired, or rotated.
- **For agents:** never print the value; verify by `grep -c` on pattern classes only. Do not rewrite history; that is a destructive, owner-only decision. The right first action is Alan's: confirm a Claude Code re-login happened since 2026-08-10 (`claude logout` then `claude login`), which rotates the token.

---

## 3. Cross-thread findings (the scope-creep diagnosis)

1. **Trackers froze; status migrated into `CLAUDE.md`.** Single tracker last touched `e33580b` (07-26). HE-01, N1–N6, F6, HE-06, P1-06 residual #1, and the entire FD band are not in it. `CLAUDE.md` "Current Work Thread" is ~100 lines of status under a "pointers only" rule and a "Status as of 2026-07-31" header. `AGENTS.md` (the file Codex and Cursor auto-load) has no work-thread section at all and zero mentions of safari/FD/P0/research/ACP/hosting threads.
2. **Thread entries are stale at multiple links.** Starlark: `CLAUDE.md` → r11 (09-06) → "read lows-review first" (09-26) → but the 09-27 branch docs declare themselves the entry and are branch-only; the four Bundle handoffs still point to the 08-25 handoff. ACP: current. Hosting: no entry pointer anywhere. Orchestration: the two August memos (08-06, 08-10) are orphaned from every entry file; the 08-10 review's Step 3 was decided against by R8 and carries no banner.
3. **Identifier collisions.** "F1" means four different things (Safari 3 F1 = symlink read; round-3 F1 = fan-out unwired; permission-cache F1 = scanner raw-flag gap; D-F1 = retry feedback). A1-F4/A1-F5 and A3-F4 are mislabelled in the two false-green docs (HC-4/HC-5 describe different work). HS-04 was never assigned. `CLAUDE.md`'s namespace warning covers P0/FD/HE only.
4. **Decisions recorded inconsistently.** Low #8: "needs an Alan decision" (`HANDOFF-starlark-lows-review-2026-09-26.md`, `CLAUDE.md`) vs "Alan has already chosen option 2… do not ask him to repeat" (`HANDOFF-starlark-laptop-transfer-2026-09-26.md`, same day). DBOS arm: "top unpaid prototype" (07-30 agenda) vs "stop" (08-06 memo) vs "parked, no urgency" (08-31). A3-F4: telemetry (A3 doc) vs safety-ceiling correctness bug (08-06 N-3).
5. **Mislabelled commits hide runner work.** `2379a08` ("Add project summary documentation") changed coordinator budgeting and added ~12 coordinator CLI flags with no handoff or review. `b1fb2c8` ("Update fallback Claude Code fingerprint") carries the 08-06 roadmap-direction review. `8bfe4b6` ("feat(errors): add session health degradation error message") contains no source change.
6. **Evidence folders missing.** Six of seven orchestration prototype workspaces named in the 07-31 result docs are not under `~/Developer/orchestration-prototypes/` (only `l1-stub-harness`). Starlark R4 raw eval runs were already noted absent on 08-25. The 09-27 reconciliation counts were "observed in tool output" with no logs saved. Treat summary docs as the only record.
7. **Charter relay not applied to two landed ranges.** Hosting (`899ba4a^..fcf181d`, edits `src/proxy.js`, `src/server.js`, `src/caller-auth.js`) had a Codex read-only pass "not a Cursor review"; the 09-18 Starlark range and the 08-06 coordinator slice had none.
8. **Same-day document pairs disagree with themselves.** Safari 3 plan banner "PLANNED, NOT AUTHORIZED" while Phase A ran next day; T3 setup doc §3 says shell on (09-28 update) and §8 says shell off; `CLAUDE.md` says `effort=auto` "now survives" T3's normalizer while the 09-26 handoff says Auto's absence is accepted for the packaged app.

---

## 4. Thread status, agent-facing

Status vocabulary (same as the CSV): DONE · IN-PROGRESS · PARKED (recorded deferral) · BLOCKED-ON-ALAN (owner decision or owner-only action) · STALLED (named, no closure, no activity, nobody said stop) · SUPERSEDED · ABANDONED.

### 4.1 Starlark host (`starlark-host/`) — IN-PROGRESS; newest work off `main`

- **Entry on `main`:** `HANDOFF-starlark-r11-2026-09-06.md` per `CLAUDE.md`, with "read `HANDOFF-starlark-lows-review-2026-09-26.md` first". Both are overtaken by branch-only `HANDOFF-starlark-cursor-review-2026-09-27.md` and `HANDOFF-starlark-reconciliation-2026-09-27.md` on `codex/starlark-resume-2020-2026-09-26`.
- **State on `main`:** R1–R14 all DONE or PARKED (R6-starstar, R9-gemini, R12 parked; R8 decided 08-31: separate lab, no `run_workflow` edge). Mediums #1–#4 closed `c7953e3`/`eb12ff5`; acceptance rows + synthesis-resume evidence `3bacab3` (09-18) with preserved red/green logs under `docs/artifacts/`. Suite 128/128, 0 skips.
- **State on the branch:** Low #5 (exit-code clobber), #6 (`safeArtifactName`), #7 (`TornLedgerLineError`), #8 (evaluator child on the AbortSignal, option 2, `src/planner-response.js`, `test/planner-resume.test.js`) + three corrections; 151 Starlark tests reported on the branch; no raw logs saved. 3 ahead / 3 behind `origin/main`; none of the 3 main-only commits touch `starlark-host/`.
- **Stalls:** S25-DEFAULTS (README + `experiment.config.json` still name `claude-fable-5` as planner), S25-DELTA (`estimatedCostUsd` = campaign-cumulative), STAR-MOCKHTTP (three sightings, unassigned; did not reproduce today), STAR-HTML-TWINS, STAR-CLAUDEMD, STAR-CURSOR-2 (09-18 range never reviewed).
- **Owner items:** Low #8 record reconciliation; merge decision for the branch; R4-RERUN (~$5); D-F3 truncate-vs-reject; archive `CODEX-TASK-starlark-r11-2026-09-06.md`; R8 revisit trigger; $5 uncertainty hold stands.
- **Do not:** add a concurrent-resume lock, drop pre-hash resume fail-open, investigate the 08-10 bridge 401, or build toward `run_workflow` — all recorded "not bugs / not unbidden".
- **Recommended next (agent):** Cursor review of `1e06820..da42e7a` **plus** `912cc6e..0b104ab` in one pass → written `HANDOFF-starlark-*-thermo-nuclear-2026-10-*.md` → stop for Alan's merge decision.

### 4.2 ACP / T3 Code — DONE in code; owner-only live checks pending

- **Entry:** `HANDOFF-acp-nightly-graduation-2026-09-26.md` (current; banners on the 08-11, 08-22, 08-24, 08-25, 08-31 handoffs are correct).
- **Landed:** Slices A–D, both thermo-nuclear reviews closed same day (`12f0842`, `d0a80d8`), `ask_user_question` live, Nightly graduation (`d04af2b`, `24ed040`), shim `cliVersion` bump (`f64a1f5`), **shell enabled by hand in the shim 09-28 (`9e4ab0e`, Alan's decision)**, six-model catalog (`899ba4a`).
- **Owner-only pending:** `node scripts/acp-live-probe.js` first PASS from Alan's Terminal; four-item Nightly checklist (§4.3 of the entry); terminal QUESTION eyeball; `git worktree prune` of the T3 fork (check branch `claude/bridge-runner-mock-provider` tip `100b3890a` first).
- **Stalls / drift:** phantom-proxy outage (09-26) has no closure record and the 11437 host changed from Cursor to VS Code since; "shell is off" still stated in `docs/t3-code-nightly-setup-2026-09-26.html` §8 and `README.md` ~279–282; "four models" wording stale; `CLAUDE.md` `effort=auto` sentence stale; dangling sandbox `allowWrite` entry in `.claude/settings.local.json` (not in git).
- **Parked (Alan):** first-class driver, `session/load` replay, real fleet, question-card enrichments, Fork/Auto.

### 4.3 Bridge hosting (standalone / desktop / browser) — DONE; no thread entry; charter gap

- **Record:** `docs/bridge-hosting-verification-2026-09-26.md` (handoff role), `docs/bridge-hosting-guide.md` (Alan guide), `docs/bridge-hosting-plan-2026-09-26.html`. `CLAUDE.md` has no pointer. Builder agent unnamed; Codex did the independent read-only review ("not a Cursor review").
- **Code:** `fcf181d` (`src/host-runtime.js`, `src/standalone.js`, `src/hosting/control.js`, `bin/bridge-hosts.js`, `bin/local-bridge-standalone.js`, `scripts/hosting/*`; edits to `src/proxy.js`, `src/server.js`, `src/caller-auth.js`, handlers, `src/utils.js`). 7 tests in `test/standalone-host.test.js`.
- **Live:** standalone on 11467 since 09-29 (pid 8022), answering; snapshot fingerprint 2.1.267 vs checkout 2.1.283 (HOST-SnapshotDrift). Desktop/browser hosts not running.
- **Owner items:** install on the other Mac; decide a Cursor review of `899ba4a^..fcf181d`; decide whether a fingerprint bump triggers `Install.command`.
- **README-v2.md** (`1e06820`) documents hosting + ACP and awaits Alan's approval; its standalone debug-token path disagrees with the guide (guide is right for the installed host).

### 4.4 Permission safaris / safety boundary — IN-PROGRESS; Phase B gated; long stalled tail

- **Entries:** `HANDOFF-safari-3-remediation-plan-2026-07-25.md` (banner stale: Phase A executed 07-26; only Phase B is still gated), `docs/permission-safari-2-findings-2026-07-21.md` (authoritative findings), `docs/HANDOFF-safari-future-directions-2026-07-22.md` (FD band; carries three uncorrected errors: `search_text`/FD-01, FD-06 missing two refusal codes, FD-08 four-vs-five surfaces).
- **Closed:** S2-01 symlink read (gate `9162580`, tool layer `21acd02`, `test/runner/he01-tool-layer-symlink.test.js`); F2 backup laundering; FD-10 artifact modes (`e00f98a`); A6/A10/A11 (`3f7536e`); HE-01; N1 (`pathArgKeysFor`); HS-02/03/05/06 (`3c7071b`); worktree determinism (`de6cdc0`, PR #25); permission cache (`2abc0df`, PR #27 `1189232`); no-network ceiling F1 (`5dd1b91`).
- **Open code gaps (small, specific):** FD-02/A5 (`apply_patch` has only `confinePath`, no symlink check; hardlinks untested; `test/runner/fd-02-symlink-matrix.test.js` never created though the plan's §14 command references it); FD-06/A8 denial reason codes (`tool-pipeline.js:532` still "User denied this action."); FD-07/A9 chaos-ok durable marker; HS-01 (fix exists in PR #26); HE-08b token patterns (`github_pat_`, `ghs_`, `xox*` absent from `safety.js`).
- **BLOCKED-ON-ALAN:** Safari 3 Phase B (B0–B6) — budget authorization of 2026-07-25 expired that night; FD-16, FD-20 are Phase B halves; HS-01 fix-or-accept; retro-chmod of pre-existing 0644 archive files; banner on the 09-07 cache review ("recommended, not authorized"); PR #27 F3/F4 ("only if Alan asks"); C2 atomic `AGENTS.md` pass.
- **STALLED (16 of 22 FD items + Phase A/C leftovers):** FD-03/04/05/06/07/08/09/11/13/14/15/17/18/19/21, A1, A5, A8, A9, C3, C4, C5b, C7. Highest-value per the plan: FD-11 (shell-filter canonicalization, model-free harness).
- **Doc drift to fix:** `docs/threat-model.md` says N1 open and lacks the `.bridge-runner/` deny row; `CLAUDE.md` Path-safety section also says N1 open (its own Current Work Thread says closed); `PROMPT-safari-3-phase-a-continuation.md` at root is stale on arrival.

### 4.5 AI-orchestration study + round 3 — PARKED (08-31); August memos orphaned

- **Agenda of record:** `docs/ai-orchestration-study-review-and-next-steps-2026-07-30.html` §5 + §7 (last edit `802c824`, 07-31). Latest runner-side residual statement: `HANDOFF-f6-ledger-aware-resume-2026-07-31.md` "What is still open" = A1-F4, A1-F5, A3-F4, DBOS arm, HE-05 OTel half, Safari 3 Phase B (matches `CLAUDE.md`).
- **Done:** study; OQ-1..5; L1/H2/H1/W1 (Cursor); C3/A1/A3; F1–F8; A1-F1/F3; A3-F1/F2/F3; N1/N2/N3/N5; F6 (`802c824`); `docs/ARCHITECTURE.md` (header date stale; line 54 says N1 open).
- **Orphaned memos:** `docs/roadmap-direction-review-and-five-next-steps-2026-08-06.md` (inside `b1fb2c8`; N-1..N-5, zero executed on the runner; N-4 is free and read-only) and `docs/runner-architecture-progress-review-2026-08-10.md` (`33c0482`; P0 credential item; P1-1..P1-5; Step 3 decided against by R8, unbannered). Neither is referenced from `CLAUDE.md`/`AGENTS.md`/`README.md`.
- **Unrecorded runner change:** `2379a08` (08-06) execute-phase leasing (`broker.unleasedRemaining`), `inheritTrust`, ~12 coordinator CLI flags; no handoff, no review.
- **Classification dispute to settle:** A3-F4 (broker ignores cache tokens) — telemetry vs safety-ceiling bug.
- **Observability:** three unreconciled directions (OTel `gen_ai.*` vocabulary, rejected `--otel-export` branch, Datadog DogStatsD guide `docs/datadog-observability-setup-guide-2026-08-10.html`); nothing wired; only `OTEL_*` env scrubbing exists.

### 4.6 Programmatic-tooling research + context layer — Steps 0–3 DONE; next slice BLOCKED-ON-ALAN

- **Entry:** `docs/programmatic-tooling-research-review-2026-08-31.html` (immutable; its banner for the context-layer review still says "open" though closed 09-10 by `8e1ffe4`). Status: `CLAUDE.md` research bullet.
- **Landed:** Step 2 `5de3b3c` (09-01, not 08-31 as `CLAUDE.md` says); Step 3a `65c001a` (checklist scoring + seven HE-06 goldens; corpus 9); Step 3b `19c2a69` + fixes `2758fe2`; idea 7 `2da8066` + fixes `6dec086`; context-layer Mediums closed (`HANDOFF-context-layer-mediums-closed-2026-09-10.md`).
- **Open:** GE-M1 (`runner eval --update` false-green; `HANDOFF-golden-eval-he06-thermo-nuclear-2026-09-06.md` never closed, no banner); GE-L2/L3/L4; CL-L4/L5/L6 + CL-CQ1 (deferred by Fable 09-10, "cheap follow-ups"); CL-CQ3–CQ8 (advisory); ideas 4, 10, 11, bonus (neither chosen nor parked; idea 11's no-blending half is a one-line prompt change); HE-06 headroom (~15 cases); CI-EXT (Codex's proposed context-status tool, unauthorized); CI-CAP32 (`_history-index.js:17` overclaims a 32 MB cap).
- **Owner:** pick the next slice (idea 3 `--verify-finish` / idea 12 counters / idea 1 audit rule) — open since 09-06; fix-or-wontfix GE-M1.
- **Note:** `docs/runner-context-introspection-*` (Codex, 09-10, `9ca53f5`) are unreferenced from every entry file and describe pre-`6dec086` behaviour; the same commit edited `src/credentials.js`.

### 4.7 Runner concordance (P0/P1/P2), harness review (HE), compaction (CX) — P0/P1 DONE; P2 and HE tails STALLED

- **Tracker:** `docs/runner-runtime-concordance-assessment-2026-07-17.html`, frozen at `e33580b` (07-26). P0-01..12 DONE; P1-01..15 DONE except P1-06 "contained" (residual #1 done unannotated via `9e4ab0e`; #2 429 canary never run; #3 `src/credentials.js:223` needs Alan sign-off).
- **P2:** 01/02/15 DONE; 04–08 SUPERSEDED (profiles retired `4f303d7`, unannotated); 14 IN-PROGRESS (builder half met by `66eabb1`); 03/09/10/11/12/13/16 STALLED. P2-11 is a **locked Alan decision (07-26 triage) never executed** — `.cursor/skills` still has all 7 packages.
- **CX:** CX-01..10 DONE (`e33580b`); PLAN header still "Not started"; CX-deferred list PARKED.
- **HE:** 01 DONE, 06 DONE (not annotated in tracker/HE HTML), 05 half PARKED, 11 PARKED; 02/03/04/07/08/08b/09/10 STALLED. HE-04 regressed (1,709 → 1,978 lines). E1/E2 errata never written into the HE HTML. Val-Q3 (chaos-ok owner) and Val-Q4 (kernel option drop safety edge) unanswered.
- **WP3/WP4/WP5/WP6** remainders STALLED; WP6 vs README-v2 relationship undecided.

### 4.8 Early roadmaps, Codex fork, command builder, process docs, side projects

- **Runner expansion roadmap (`docs/runner-expansion-roadmap.md`):** content shipped 06-28/29 (PRs #9, #11–#14); document frozen at `01138eb` and still cited by `README.md:55` / `README-v2.md:489` as the live map; profiles shipped then retired `4f303d7` (README still lists "profiles"); §11 leftovers (`--add-dir`, `stop`/`post_compact` hook events, review recipe) STALLED; vendored `awesome-claude-code-subagents/` (188 files) orphaned.
- **Codex fork (Option C, `~/Developer/codex-local-bridge-playground`):** decision record DONE (`7c206c4`); fork Phase 4 live proof "pending" since 08-10; `PORTING.md` "(none yet)"; last fork activity 09-06. STALLED. `docs/codex-analysis-jev.md` (09-26) awaits Alan with no pointer.
- **Command builder:** V1 DONE/living; V2 built `66eabb1`, promotion BLOCKED-ON-ALAN; CB-09 generated mirrors STALLED (recommended 3×); V2 DOM test needs a jsdom decision.
- **Process:** docs audit + archive DONE (`ffc13db`, `23fb3c1`); recalibration proposal (`416ee6c`) BLOCKED-ON-ALAN; `check:agent-docs` STALLED; `.cursor` triage (locked 07-26) unexecuted; `AGENTS.md` has no work-thread section — Codex/Cursor sessions start without the pointers Fable gets; charter + review DONE.
- **Side projects:** Pages (145 failures, site 404, `static.yml` uploads `path: '.'`), Actions POC (2 failed runs 06-29), Docker (contradicts OAuth-only invariant), Terminal-Bench job (oracle agent, Docker absent), Apple Shortcuts (no artifacts), project summary (snapshot 08-05; `scripts/build-html-summary.js` broken paths) — all STALLED. Fingerprint automation DONE/living.
- **GitHub:** PR #26 (Codex HS-01 + doc refresh; code merges clean, 4 doc conflicts), PR #21 (superseded by #22), issues #18/#20 (test noise), Dependabot open alerts 0.
- **Tracked files to flag (no action taken):** `alans-scratch-bin/` (9 personal files in a public repo), root `claude` (0 bytes), `probe.js`, `lcov.info`, `HANDOFF-permission-safari-2026-07-20 copy.txt`, `jobs/`.

---

## 5. Decisions recorded as pending for Alan (consolidated)

85 CSV rows carry `alan_decision_needed = yes`. The ones that unblock the most, with the file that records them:

| # | Decision | Recorded in | Fable's recommendation |
|---|---|---|---|
| 1 | Confirm token rotation; history rewrite yes/no; scanning gate yes/no | `docs/runner-architecture-progress-review-2026-08-10.md` §6 | Rotate now; no rewrite; add a scanner |
| 2 | Low #8 option 1 vs 2 (record reconciliation) | lows-review vs laptop-transfer (both 09-26) | Confirm option 2 |
| 3 | Cursor review + merge of `codex/starlark-resume-2020-2026-09-26` (include `912cc6e..0b104ab`) | branch-only `HANDOFF-starlark-cursor-review-2026-09-27.md` | Review, then merge if clean |
| 4 | Safari 3 Phase B re-authorize or close | `HANDOFF-safari-3-remediation-plan-2026-07-25.md` banner | Close; do FD-02/06/11 offline |
| 5 | HS-01 fix or accept; fate of PR #26 | `SECURITY.md`; `gh pr view 26` | Re-cut code half; close #26 |
| 6 | Next research slice (idea 3 / 12 / 1) + GE-M1 fix/wontfix | `CLAUDE.md` research bullet; GE review | Idea 3; fix GE-M1 |
| 7 | Recalibration proposal step 1; `AGENTS.md` work-thread pointers | `docs/proposals/agent-docs-recalibration-2026-08-22.md` | Approve |
| 8 | Execute the locked `.cursor` triage | `docs/cursor-dot-cursor-triage-2026-07-26.html` §8 | Execute as written |
| 9 | Pages: keep/disable | `.github/workflows/{static,jekyll}.yml` | Disable |
| 10 | Personal files in `alans-scratch-bin/` | — | Move out |
| 11 | Command builder V2 promotion; jsdom dep | coherence check §6 | Promote after a week |
| 12 | README-v2 promotion (and whether it is WP6) | `1e06820` body | Approve after two stale refs fixed |
| 13 | Codex fork: continue / pause / close | fork roadmap | Pause on record |
| 14 | Dead side projects: close on record | — | One sentence each |
| 15 | A3-F4 classification (telemetry vs ceiling bug) | A3 doc vs 08-06 memo | Treat as ceiling bug; small fix |
| 16 | R4 rerun (~$5); D-F3 truncate vs reject; archive R11 brief; R12 unify | Starlark 08-25 handoff | No; reject-and-explain; yes; no |
| 17 | HE-02/03/07/08/09/10 owner or decline; P2-03/09/10/12/13/16 | HE review; P2 handoff | Assign HE-07 + P2-16 (cheap); decline the rest for now |
| 18 | Hosting: Cursor review of `899ba4a^..fcf181d`; snapshot refresh; other-Mac install | hosting verification doc | Review yes; refresh now; install when convenient |
| 19 | ACP owner-only live checks (probe, checklist, question eyeball, worktree prune) | ACP 09-26 handoff §4.2–4.3, §6 | Do them |
| 20 | `src/credentials.js:223` legacy constant (P1-06.r3) | P2 handoff 07-20 | Clean, under the bridge exception |

---

## 6. Housekeeping candidates (deliberately NOT done)

Alan's instruction for this task: no deletions, no cleanup. Listed so the next agent does not rediscover them: disable `static.yml`/`jekyll.yml`; close PR #21, issues #18/#20; re-cut or close PR #26; archive completed root briefs (`CODEX-TASK-*.md`, `PROMPT-safari-3-phase-a-continuation.md`, `HANDOFF-session-2026-08-31.md`, `HANDOFF-starlark-abort-commit-next-slice-2026-09-16.*`, `HANDOFF-bridge-runner-acp-2026-08-11.md`) once accepted; remove stray root files and `jobs/`; move `alans-scratch-bin/`; decide on `awesome-claude-code-subagents/`; prune 4 worktrees after the Starlark decision; Prettier the three root files; fix `scripts/build-html-summary.js` paths; apply the ten stale-claim banner fixes listed in the HTML report §"silent stalls".

---

## 7. Recommended order of work, per seat

**Alan (owner):** §5 rows 1–8 are the gating decisions; row 1 today.

**Fable (next session, Alan-directed):** (a) once Alan confirms row 1, add a secret-scanning workflow if he wants one; (b) the ten stale-claim banner fixes (one docs-only commit; list in the HTML report); (c) re-point `CLAUDE.md` entries (Starlark branch, hosting thread, August memos) and mirror a work-thread pointer block into `AGENTS.md` if Alan approves recalibration step 1; (d) GE-M1 fix + two tests if Alan says fix; (e) write the one-line records for closed side projects.

**Codex (brief-driven):** (a) re-cut PR #26's code half onto `main` as a fresh branch with the same tests and mutation check, no doc edits; (b) P2-16 + HE-07 as one small slice if Alan assigns; (c) N-4 `planRepair` dry run over the 141-ledger corpus (free, read-only, counts only).

**Cursor (invariant review):** (a) `1e06820..da42e7a` **and** `912cc6e..0b104ab` (Starlark branch + 09-18 range) — the brief on the branch has six questions; (b) hosting range `899ba4a^..fcf181d` if Alan asks (bridge-transport files touched); (c) the unrecorded 08-06 coordinator slice `2379a08` if Alan asks. Write `HANDOFF-*-thermo-nuclear-*.md`, then stop.

**Do not:** build toward `run_workflow`/`run_block` (R8); add a concurrent-resume lock; rewrite git history; run live probes without a fresh ceiling; open the other agents' deliverables folders before Alan releases them.

---

## 8. CSV schema (`project-direction-inventory-2026-09-30.csv`)

| column | meaning |
|---|---|
| `id` | stable short id; existing namespaces kept (R8, FD-02, HE-06, P2-16, A3-F4…); invented ids are prefixed by thread (STAR-, ACP-, HOST-, S3-, CL-, GE-, APR-, RX-, CB-, DA-, CU-, PS-…) |
| `thread` | one of 12 threads |
| `name` / `short_description` | plain-language |
| `inception_date` / `last_activity_date` | YYYY-MM-DD from docs or commits |
| `status` | DONE · IN-PROGRESS · PARKED · BLOCKED-ON-ALAN · STALLED · SUPERSEDED · ABANDONED |
| `who_last_touched` | Alan · Fable · Codex · Cursor · unknown · none (per the document's own attribution; git author is always Alan) |
| `entry_doc` | the document to open first |
| `evidence` | commit hashes, paths, test names, live checks |
| `needed_next` | one sentence |
| `alan_decision_needed` | yes/no |
| `notes` | contradictions, caveats |

Counts: 363 rows — DONE 150 · STALLED 112 · PARKED 38 · BLOCKED-ON-ALAN 23 · SUPERSEDED 19 · IN-PROGRESS 18 · ABANDONED 3. Threads: Starlark 69 · Safari 64 · Orchestration 56 · Concordance/HE/CX 40 · Research 37 · ACP 30 · Side projects 21 · Hosting 16 · Process 11 · Early roadmaps 8 · Command builder 6 · Codex fork 5.

---

## 9. Handoff fields

- **Folder / branch:** `/Users/alanman/Developer/claude-local-bridge-playground`, `main`.
- **Files changed:** only additions under `docs/claude-deliverables-for-alan-nsfw-fable-5-1/status-and-roadmap-update-checks/` (this file, the HTML report, the CSV). Nothing else touched.
- **Checks run:** `npm test`, `npm run test:starlark`, `npm run check:docs`, `npm run lint`, `npm run format:check` (results in §1); read-only `git`/`gh` queries; port probes.
- **Skipped:** live model calls; the three other deliverables folders; history inspection beyond pattern-class counts; the other laptop.
- **Risks:** the exposed token (§2); a concurrent Cursor commit on local `main` was pushed together with this one; line numbers are a 2026-09-30 snapshot.
