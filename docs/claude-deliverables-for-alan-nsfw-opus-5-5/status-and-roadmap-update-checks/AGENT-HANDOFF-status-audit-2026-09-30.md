# AGENT HANDOFF + REPORT — Full status audit of every direction (2026-09-30)

**Author:** Claude (Opus 5.5, Claude Code seat), at Alan's request. **Audience:** Codex and Cursor (Alan relays this file; Fable/Claude sessions may read it too).
**Companions (same folder):** `inventory.csv` (219 rows, one per item: the data) and `alan-status-report-2026-09-30.html` (the owner-facing narrative).

> **STATUS OF CLAIMS — read first.**
>
> - Verified against `main` on 2026-09-30 between ~18:30 and ~22:50 PDT. At start, `main` = `e79ffdf`. During the session two other audits landed: Cursor's `f8a749d` (21:44) and a Fable/Claude session's `a7d2221` (22:33, pushed together with `f8a749d`). This audit's commit sits on top of `a7d2221`.
> - **Re-check anything you act on.** Line numbers drift.
> - Claims marked **[self-verified]** I re-ran or re-inspected myself. All other claims come from five read-only research helpers that checked docs against code/tests/git. I spot-checked their most surprising claims; none failed the spot-check.
> - **Recommendations are proposals, not decisions.** Alan owns every decision listed here. Do not implement from this file without an explicit assignment.
> - Per Alan's instruction, I **did not open** any other agent's deliverable folder (`docs/codex-deliverables-for-alan-nsfw/`, `docs/cursor-deliverables-for-alan-nsfw/`, `docs/claude-deliverables-for-alan-nsfw-fable-5-1/`) or `git show` their commits. Please extend the same courtesy to this folder until Alan opens the comparison.

---

## 0. How to use the CSV

**Columns:**

| Column | Meaning |
|---|---|
| `id` | Thread-prefixed, stable within this audit |
| `name` | Short name |
| `thread` | One of 15 families |
| `kind` | Feature, Safety fix, Experiment, Research, Review finding, Process, Docs, … |
| `plain_description` | What the item is, in plain words |
| `started` | ISO date |
| `started_via` | Doc or commit where it started |
| `last_activity` | ISO date |
| `status` | Code from the vocabulary below |
| `status_plain` | Short human phrase |
| `evidence` | What was checked |
| `open_residuals` | What's left |
| `waiting_on` | Alan (decision / action / authorization), Cursor review, Fable or Codex, Nobody |
| `alan_decision_needed` | The decision, if any |
| `original_ids` | IDs used in older docs: P0-xx, FD-xx, HE-xx, R-xx, … |
| `key_docs` | Where to read more |
| `doc_drift` | Docs that disagree or are stale |
| `attention` | High / Medium / Low / None (my judgement) |
| `claude_recommendation` | My recommendation |

**Status vocabulary:**

| Code | Meaning |
|---|---|
| `DONE` | Done and in use by default |
| `DONE-OPTIN` | Done, but off unless a flag turns it on |
| `DONE-RECORD` | Research or experiment finished; its record exists; nothing to wire |
| `PARTIAL` | Partly done |
| `BRANCH-UNMERGED` | Real work exists only on a branch |
| `AWAITING-REVIEW` | Waiting on a review |
| `AWAITING-DECISION` | Waiting on Alan |
| `GATED` | Needs Alan's authorization (for example, live spend) |
| `NOT-STARTED` | Planned, never started |
| `PARKED` | Deliberately deferred, with a reason |
| `DRIFTED` | Stopped with **no recorded decision** |
| `BUILT-UNWIRED` | Code and tests exist, but nothing in `src/`, `bin/` or `scripts/` calls it |
| `RETIRED` | Explicitly stopped or decided against |
| `SUPERSEDED` | Replaced by later work |
| `BROKEN` | Exists and fails |
| `OPEN-RISK` | Security or safety exposure |
| `UNKNOWN` | Evidence ran out |

**Totals:** 219 rows.

| Status | Count |
|---|---|
| DONE | 67 |
| PARTIAL | 32 |
| NOT-STARTED | 36 |
| DRIFTED | 21 |
| DONE-RECORD | 13 |
| AWAITING-DECISION | 10 |
| DONE-OPTIN | 10 |
| RETIRED | 8 |
| SUPERSEDED | 5 |
| PARKED | 5 |
| BRANCH-UNMERGED | 3 |
| OPEN-RISK | 2 |
| AWAITING-REVIEW | 2 |
| BROKEN | 2 |
| GATED | 1 |
| UNKNOWN | 1 |
| BUILT-UNWIRED | 1 |

**Waiting on Alan:** 66 items.

**Items started per month (open vs total):**

| Month | Started | Still open |
|---|---|---|
| Apr | 7 | 2 |
| May | 24 | 6 |
| Jun | 20 | 7 |
| **Jul** | **81** | **60** |
| Aug | 61 | 23 |
| Sep | 26 | 13 |

July's review burst is where the backlog came from.

---

## 1. Preflight facts you will encounter

- **Repo:** `/Users/alanman/Developer/claude-local-bridge-playground`
  - Branch `main`
  - `origin` = `alankatanoisi/claude-local-bridge-playground`
  - **This repository is PUBLIC** on GitHub (`gh repo view` → `"visibility":"PUBLIC"`) [self-verified]. Treat every committed byte as published.
- **Concurrency:** four seats worked in this tree today. Cursor's `f8a749d` and a Fable/Claude session's `a7d2221` were both on `origin/main` before this commit, so pushing this audit adds only this folder. ("The tree is the baton" was effectively suspended for this parallel audit by Alan's design.)
- **Unmerged branches with real work** [self-verified via `git rev-list --count main..<b>`]:
  - `codex/starlark-resume-2020-2026-09-26`: 3 commits (`da42e7a`, `cb5f6d0`, `2596b2c`), pushed. 14 `starlark-host/` files (+966/−63), plus `HANDOFF-starlark-reconciliation-2026-09-27.{md,html}` and `HANDOFF-starlark-cursor-review-2026-09-27.{md,html}` (branch-only).
  - `codex/hs01-charter-roadmap-refresh`: 1 commit (`2f1cc67`, 2026-08-30), pushed. 13 files.
    - Merge-base is `915ea89`, the accidental commit reverted 08-31 by `8cfef45`.
    - `git merge-tree --write-tree main codex/hs01-charter-roadmap-refresh`: `src/runner/safety.js`, `src/runner/shell-policy.js` and the tests auto-merge.
    - **Conflicts** in `AGENTS.md`, `CLAUDE.md`, `docs/agent-team-charter-2026-08-25.md`, `docs/templates/CODEX-TASK-template.md`.
  - Minor, superseded or orphaned: `origin/claude/user-owned-ai-orchestration-ypiplp` (`655e07f`, an orchestration-study "R2" revision), `origin/copilot/analyze-test-coverage{,-again}` (7 bridge test files), `origin/copilot/research-protocol-parity-clause-p`, `origin/claude/runner-lane-impl-a73rlr`, `origin/claude/modest-archimedes-4J6GK` (docs memo). About 30 already-merged remote branches remain.
- **Worktrees:** `~/.codex/worktrees/df82/...`, `~/.codex/worktrees/starlark-abort-handoff-2026-09-16/...`, `~/Developer/claude-local-bridge-handoff-2026-09-26`, `~/Developer/claude-local-bridge-starlark-resume-2020-2026-09-26`, `~/Developer/claude-local-bridge-synthesis-resume-2026-09-18`. All five had 0 dirty entries on 2026-09-30 [self-verified].
- **Stash:** `stash@{0}` = "cursor session state (continual-learning) - restore after merge" (on `codex/starlark-r11-live-verification`).
- **Canonical repo:** `alankatanoisi/claude-local-bridge` is archived, but still shows 5 open PRs (#13–#17) [self-verified]. The root symlink `claude-local-bridge` → `/Users/alanman/Documents/GitHub/claude-local-bridge` is **dangling** [self-verified].
- **Running services** (per the ACP helper): the bridge on `127.0.0.1:11437` (VS Code helper process) and the standalone bridge on `11467` (launchd `org.alan.claude-bridge-lab.standalone`). The fingerprint LaunchAgent `com.alanman.claude-fingerprint-check` is loaded.

## 2. Health check (exact commands, `main`, repo root)

| Command | Result |
|---|---|
| `npm test` | **exit 0** — tests 1162, pass 1161, fail 0, todo 1 (HS-01, `test/runner/false-green-deny-matrix.test.js:168`), ~197 s [self-verified] |
| `npm run lint` | exit 0 [self-verified] |
| `npm run check:docs` | exit 0 — 22 tools (hidden: apply_patch), 78 CLI flags, 15 models (default `claude-sonnet-5`), 6 templates [self-verified] |
| `npm run format:check` | **exit 1** — `HANDOFF-golden-eval-he06-thermo-nuclear-2026-09-06.md`, `HANDOFF-permission-cache-thermo-nuclear-2026-09-07.md`, `HANDOFF-starlark-r11-thermo-nuclear-2026-09-06.md`. Pre-existing since 09-06; I did not reformat them [self-verified] |
| `npm run runner:eval` | 9 golden cases, 27/27 checklist predicates (helper) |
| Starlark offline suite on `main` | 128/128, 0 skips, 4 of 4 runs (helper; Go 1.26.8, evaluator built) |
| Starlark suite on `codex/starlark-resume-2020-…` | Codex recorded 151/151. Helper re-runs under heavy machine load (load average 13–19): **4 of 9 default-concurrency runs failed or timed out**; 2 of 2 serial runs were clean. Implicated: "R11 process interrupt SIGINT + resume", "R11 resume is idempotent…", "run abort signal terminates the evaluator child" |
| GitHub Actions | CodeQL succeeds. `jekyll.yml` **72/72 failures**; `static.yml` **73/73 failures** (`gh run list`) [self-verified]. No workflow runs `npm test` |

## 3. Critical findings (security), in priority order

1. **SEC-01: Claude OAuth access token in public Git history** [self-verified, value never printed].
   - Commit `2bdc167` (2026-08-09), file `docs/5-paste-block-tests/paste-block-3`: exactly 1 match of type `sk-ant-oat01-`. Removed from the tree in `39ec363`; HEAD has 0 matches.
   - `2bdc167` is an ancestor of `origin/main`.
   - GitHub secret scanning: enabled, **0 alerts**; push protection disabled.
   - The 08-10 paste-block audit (now under `docs/archive/unsorted-2026-08-22/five-paste-block-runtime-audit-2026-08-10.md`) rated it P0 and recorded it was "not printed, tested, revoked, or rewritten". No later revocation record exists.
   - **Action owner: Alan** (revoke/re-login; optional history rewrite = force push). **Agents: do not print, test, or "clean" this yourselves.** A history rewrite is outward-facing and needs Alan's explicit go-ahead.
2. **SEC-02: `scrubSecrets()` misses modern formats** [self-verified with fake values].
   - **Unredacted:** `github_pat_…`, `sk-proj-…`, `xoxb-…`, `-----BEGIN PRIVATE KEY-----` (PKCS#8; `BEGIN ENCRYPTED PRIVATE KEY` per helper).
   - **Redacted:** `ghp_`, `sk-ant-oat01-`, `BEGIN RSA PRIVATE KEY`.
   - Locations: `src/runner/safety.js` (pattern list around `:201`; streaming PEM parser around `:503`).
   - Mitigation in place: `*.pem` and `*.key` files are on the deny list.
3. **SEC-03 / BRANCH-02: HS-01** — the case-variant key filename bypass on macOS.
   - On `main`: `safety.js:114-115` uses `/^id_rsa/` and `/^id_ed25519/` without `/i`; the todo test is at `false-green-deny-matrix.test.js:159-169`.
   - Fix stranded on `2f1cc67`: case-insensitive patterns plus `hasProtectedDirectorySegment()`.
4. **SAFE-FD02: execute-time path re-check missing in `apply_patch` and undo tools.**
   - `apply-patch.js:269`, `undo.js:145`, `undo-edit.js:90,137` use `confinePath` only; `apply_patch` has no symlink refusal.
   - No hardlink tests anywhere.
   - The gate still covers these via `pathArgKeysFor`. CLAUDE.md's "HE-01 tool-layer residual closed" (line ~280) is overstated for these tools.
5. **SEC-05: shell on for every T3 thread.**
   - `9e4ab0e` added `--allow-shell` to `bin/t3-cursor-shim.sh:155,157`.
   - Per the 08-22 contract notes, T3 "full access" mode auto-approves on the client side. With shell always on, a full-access thread can run commands with no card.
   - No Cursor review of this safety-boundary change.

## 4. Thread state (current entry → verified status → open IDs → proposed owner seat)

| Thread | Real current entry | Verified state | Open items (CSV ids) | Seat |
|---|---|---|---|---|
| Security | this file | 2 OPEN-RISK | SEC-01..05 | Alan (SEC-01), Codex brief (SEC-02/03 + SAFE-FD02) |
| Starlark | **branch-only** `HANDOFF-starlark-reconciliation-2026-09-27.md` + `HANDOFF-starlark-cursor-review-2026-09-27.md`; on main `HANDOFF-starlark-laptop-transfer-2026-09-26.md` | R1–R7, R9–R11, R13, R14 done (lab); R8 decided against (`a69c2d0`); R12 deferred; Mediums #1–#4 closed (`c7953e3`, `eb12ff5`, `3bacab3`); **Lows #5–#8 only on branch** | BRANCH-01, STAR-LOW, STAR-REV2, STAR-HOLD, STAR-R11 | **Cursor**: review `1e06820..da42e7a` (brief on branch) + owed review `912cc6e..0b104ab` |
| ACP / T3 | `HANDOFF-acp-nightly-graduation-2026-09-26.md` | Slices A–D, question card, Nightly shim all DONE | ACP-R1 (probe never PASS), ACP-R2, ACP-PARK, SEC-05 | Alan (eyeballs), Cursor (review `9e4ab0e`) |
| Programmatic-tooling ideas | `docs/programmatic-tooling-research-review-2026-08-31.html` | Ideas 2, 5, 6, 7, 8 landed; 9 parked; 1/3/12 candidates; 4/10/11 drifted | IDEA-00/01/03/12/0411 | Alan picks or pauses |
| Context layer | `HANDOFF-context-layer-mediums-closed-2026-09-10.md` | M1–M3, L7–L8 closed; **L4–L6 + 8 code-quality notes open** (`run.js:761`, `context-headlines.js:169`, `rangeLabel`) | CTX-TN, CTX-TOOL | Codex (small) |
| Golden eval / HE-06 | `HANDOFF-golden-eval-he06-thermo-nuclear-2026-09-06.md` | **All 4 findings open**; `golden-eval.js` unchanged since `65c001a` [self-verified] | TEST-GOLD-TN | Codex (one small commit) |
| Permission cache | `HANDOFF-f1-no-network-ceiling-and-pr27-landing-2026-09-09.md` | PR #27 + F1 DONE; F2/F3/L2 deferred; F1 fix authored by the reviewer seat (unreviewed) | SAFE-PERMCACHE | Codex/Cursor (optional) |
| July concordance | `docs/runner-runtime-concordance-assessment-2026-07-17.html` (**frozen 07-26**) | P0 12/12, P1 14/15 done; **P2-03/09/10/11/12/13/16 never started**; P2-04/05/07/08 superseded; P2-06/14 partial; P1-06 live 429 test never run | SAFE-* | Alan: retire or keep |
| Safari FD band | `docs/HANDOFF-safari-future-directions-2026-07-22.md` (never edited after 07-22) | FD-01, FD-10 done; FD-02/04/08/11/13/14/15/17 partial; FD-03/05/06/07/09/18/21 not started; FD-12 accepted risk; FD-16/20/22 gated | SAFE-FD* | Alan: retire most |
| Safari 3 | `HANDOFF-safari-3-remediation-plan-2026-07-25.md` (banner stale) | Phase A 7/12; **Phase B never run** (authorization expired 07-25); Phase C 1/7 | SAFE-S3A/B/C | Alan |
| Harness review | `docs/harness-engineering-runner-runtime-review-2026-07-28.html` (never annotated) | HE-01 partial, HE-06 9/~15; **HE-02 (CI), HE-04 (`run.js` now 1,978 lines), HE-07, HE-10 never started**; HE-03/05/09 partial; HE-08 drifted; HE-11 deliberately not done | HARN-HE* | Alan (HE-02, HE-09), Codex |
| Round 3 + 08-06/08-10 reviews | round-3 docs; `docs/roadmap-direction-review-and-five-next-steps-2026-08-06.md`; `docs/runner-architecture-progress-review-2026-08-10.md` | Fixes landed (SIGTERM finalizer, leases, F6, N1). **Never started:** A1-F4, A1-F5, A3-F4 (budget ignores cache tokens), C3-2, roadmap N-1..N-5, 08-10 P1s (worktrees under `~/.bridge-runner` blocked by the deny list; resume worktree identity; verify always "completed" `coordinator.js:447`; failed-worker claims feed the spec `coordinator-spec-compiler.js:32-33`; retries consume steps) | HARN-R3-RES, HARN-N, HARN-AR-* | Codex briefs |
| Runner foundations | `README.md` (+ stale `docs/runner-expansion-roadmap.md`) | Mostly DONE / DONE-OPTIN. **BUILT-UNWIRED:** `tool-prefetch.js`, `subprocess-pool.js`, `streaming-write.js`, `workspace-fingerprint.js` (0 requirers outside tests [self-verified]). C3 transcript-resume and XLSX export are dead paths | RUN-* | Alan: retire unwired |
| Bridge | `README.md`, `docs/bridge-hosting-guide.md` | DONE; three hosting modes live; bridge-internal edits in `fcf181d` unreviewed | BRG-*, ACP-LOG | Cursor review |
| Fingerprint | `docs/automation-ledger/README.md` | DONE (LaunchAgent loaded, 6 reports; latest could not reach npm) | FP-* | none |
| Command builder | `docs/command-builder.html`, `docs/command-builder-v2.html` | V1 hardened (F1–F18) + V2 built; primary page not chosen | CMD-V2, DOC-README2, DOC-PAGES | Alan |
| Process | `docs/agent-team-charter-2026-08-25.md`, CLAUDE.md "Current Work Thread" | Charter works for runner slices; **tracker abandoned 07-26**; CLAUDE.md 437 lines; AGENTS.md has no thread pointers; 43 root `HANDOFF-*.md` | PROC-* | Alan, then Fable/Cursor |
| Side quests | various | Mostly DRIFTED (GHA POC, Docker, Shortcuts, Datadog, harbor, Jev, Codex fork dormant since 07-11) | SIDE-* | Alan: retire |

## 5. "Do not trust these lines" (verified stale or contradicted)

- `CLAUDE.md`:
  - **:228** lists N1 as an open residual, but N1 closed 07-31 (`740894c`; `pathArgKeysFor` + `test/runner/path-arg-contract.test.js`). **:288** says so.
  - **:274** points to `~/Developer/orchestration-prototypes/l1-stub-harness/notes.md`, which **does not exist**. The folder holds only `mock-bridge.js` and `fixture-target/`.
  - **:280** "HE-01 tool-layer residual closed" — not for `apply_patch` or the undo tools.
  - **:318** "Low #8 needs an Alan decision" — **stale**. `HANDOFF-starlark-laptop-transfer-2026-09-26.md:11` records that Alan chose **option 2** and says "Do not ask him to repeat that decision." The 09-27 branch implements option 2.
  - **:366** "fork commit `100b3890a`, needs a T3 app rebuild" — the object is not found in `~/Developer/t3code` (`git cat-file`) and cannot apply to packaged Nightly.
  - **:155** tells Claude Code to use `anthropic-platform-expert` / `anthropic-official` skills, which exist only under `.cursor/` and are not loadable by Claude Code.
  - Starlark pointer names `HANDOFF-starlark-r11-2026-09-06.md` as entry and never mentions the transfer handoff or the branch.
  - No mention of SEC-01 or of shell-on in T3.
- `AGENTS.md`:
  - **:215** "All other 478 tests pass" (now 1,162).
  - **:217** says the bridge cannot be started standalone (false since 09-26, `src/standalone.js`).
  - No Current Work Thread or pointers at all; Codex and Cursor don't auto-load CLAUDE.md.
- `README.md`:
  - **:55** and **:509** send readers to `docs/runner-expansion-roadmap.md` (frozen 06-29; never bannered historical).
  - **:281-282** "read-only tool set … shell stays a hand edit" (stale since `9e4ab0e`).
- `docs/t3-code-nightly-setup-2026-09-26.html` §8 (~:443): "Shell is off". `bin/t3-cursor-shim.sh:37,124` comments: "Unset = core read-only tool set".
- `docs/threat-model.md`:
  - **:162** "path-arg contract test still open" (closed).
  - No deny rows for `.bridge-runner/` and `actions-runner/`.
  - Shell list omits `.netrc` and `.npmrc`.
- `docs/Bridge Runner Compaction & Context-Management PLAN -tentative.md:5` says "Not started", but it is implemented (`e33580b`).
- `HANDOFF-safari-3-remediation-plan-2026-07-25.md`: banner "PLANNED, NOT AUTHORIZED TO EXECUTE"; §7 calls F1/F2 "Unremediated" (both fixed 07-26).
- `HANDOFF-orchestration-prototypes-2026-07-31.md` still reads "zero runs executed".
- `CONTEXT.md` says the tool pipeline is "not yet implemented" (landed `9dbdad7`, 06-18).
- `docs/codex-bridge-runner-roadmap.html` lists profiles, tool prefetch and the subprocess pool as runner features (retired or unwired).
- `src/runner/tool-registry.js:112` comment says "sliding-window scrubber" (replaced by the line-aligned scrubber in `4087303`).
- `src/runner/tools/_history-index.js` comment says "capped at 32 MB" (a diagnostic flag, not an enforced cap).
- Runner `--help` omits `--replay` and `--repair` (they need `BRIDGE_RUNNER_EXPERIMENTAL=1`) and lists 3 of the 6 templates.
- `docs/programmatic-tooling-research-review-2026-08-31.html`: banner says the context-layer review is "open" (closed 09-10). It cites `docs/Programmatic Tooling Research/` PDFs that never existed in git.
- `starlark-host/experiment.config.json` `fixedPlannerModel: claude-fable-5` contradicts the R4 finding that Haiku plans well and cheaply (flagged 08-25).
- `scripts/build-html-summary.js` reads pre-move paths (`docs/project-summary.md`).
- Live Cursor files still teach the retired `--agent` flag: `.cursor/agents/runner-command-builder.md` (≈:66, :84, :153) and `.cursor/skills/runner-command-builder/SKILL.md:24`.
- Concordance tracker P1-06 card still says "Contained". The tracker has 0 entries for HE, FD, HS, FG, A1-F, A3-F.
- **Commit titles that hide their content:**

  | Commit | Title says | Actually contains |
  |---|---|---|
  | `ab9c36f` | default model update | four P1 closures |
  | `2379a08` | "project summary" | kernel and coordinator fixes, plus Starlark results |
  | `b1fb2c8` | "fingerprint" | adds the 08-06 roadmap review |
  | `e822aec` | "Implement code changes…" | the harness review |
  | `8bfe4b6` | "session health error message" | only continual-learning state plus `.gitignore` |
  | `66eabb1` | (unrelated) | bundles `docs/codex-analysis-jev.md` |
  | `9ca53f5` | (introspection docs) | also a `credentials.js` edit |
  | `2abc0df` | 12-line safety fix | bundles about 1,930 lines of Starlark handoffs |
  | `21acd02` | "docs:" | includes code and tests |
  | `57a1c47` | LSP | command-builder assessments only |
  | `6bdcff6`, `2d18751`, `672707a` | (April commits) | content swapped between the three |

## 6. ID collision map (use CSV ids in new docs)

| Label | Meanings |
|---|---|
| **F1** | Safari 3 F1 (symlink deny) · compaction audit F1 · round-3 F1 (coordinator unwired) · 09-09 thermo-nuclear F1 (no-network ceiling) · command-builder coherence F1 |
| **F6** | Safari 3 F6 = `--chaos-ok` record (= FD-07 = S2-05 = HE-08b(e)) · round-3 F6 = `applyRepair` / ledger-aware resume |
| **N1–N6** | runner-claims validation findings (N1 = path-arg gate, closed) |
| **N-1…N-5** | 08-06 roadmap next steps (N-3 = A3-F4) |
| **A1–A12** | Safari 3 Phase A tasks — vs **A1 / A3** = round-3 crash bake-off / fan-out test |
| **C1–C7** | Safari 3 Phase C — vs **C3** = round-3 ledger sweep |
| **R1–R14** | Starlark architecture review — vs **R1–R6** = ACP status recommendations (08-25) |
| **P0** | concordance P0-01..12 (all closed) — vs the FD "P0 band" (FD-01..05) |
| **HS-01…06** | false-green hidden bugs (**no HS-04 exists**); only HS-01 open |
| **HC-1…5** | false-green round-2 prompts; HC-4/HC-5 mislabel A3-F4 and A1-F4/F5 |

## 7. Not bugs / do not "fix" or restore

- **Retired by decision, do not restore:** `--agent`, `--profile`, `--list-agents`, `--list-profiles` (P0-02/03); OpenAI-compatible routes; API-key upstream auth; `claudeLocalBridge.apiKey`.
- **Starlark R8 is decided:** no `run_workflow` runner edge, no Starlark in `src/runner/**`. Idea 9 (`run_block`) stays parked behind it.
- **Accepted risks** (SECURITY.md, 08-10): open local endpoint; shell not confined to the project folder (S2-06/F3); no hard network isolation (FD-12). HE-11 was deliberately not done.
- **Safari 3 Phase B and live probes need Alan's explicit authorization;** the 07-25 budget window expired. Do not run them.
- **Prototypes are disposable by design:** the absent `~/Developer/orchestration-prototypes/{h1,h2,w1,c3,a1,a3,s1}*` folders are not a loss to "recover".
- **`.DS_Store` "committed" claims** in the Safari 3 plan and the `.cursor` triage are wrong: those files were never tracked (`.gitignore:10`).
- **This audit is not a cleanup authorization.** Alan said: no deletions, no cleanup "at least not yet". The CSV's "retire" recommendations mean *mark as not pursued*, never delete.

## 8. Proposed work queue by seat (for Alan to approve or reject)

**Alan (decisions/actions):**
- SEC-01: revoke the token.
- Approve one status board (PROC-TRACKER) and the 08-22 recalibration (PROC-RECAL / PROC-AGENTSMD).
- Commission the Cursor Starlark review.
- HS-01: rescue vs redo.
- T3 shell posture (SEC-05).
- CI gate (HARN-HE02).
- Pages workflows (DOC-PAGES).
- V1 vs V2 (CMD-V2).
- Next research slice or pause (IDEA-00).
- Coordinator label (HARN-HE09).
- The Tier 3 bulk-retire list (27 ids in the HTML report §5).

**Cursor (reviews — no implementation):**
1. Starlark branch `1e06820..da42e7a`, using the brief on the branch. Include the flaky child-process tests from §2.
2. The owed `912cc6e..0b104ab`.
3. A batch review of unreviewed safety, bridge and credentials commits: `9e4ab0e`, `fcf181d`, `9ca53f5`, `7d8d4f6`, `5dd1b91` (authored by the reviewer seat), plus runner `5de3b3c`, `d04af2b`, `24ed040`, `899ba4a`.
4. Execute the already-decided `.cursor/` triage (`docs/cursor-dot-cursor-triage-2026-07-26.html` §8) **only if Alan approves**.

**Codex (briefs, once Alan approves):**
- (a) Safety mini-bundle:
  - SEC-02 patterns plus tests, including the streaming PEM parser.
  - HS-01: cherry-pick code and tests only from `2f1cc67`.
  - SAFE-FD02: `apply_patch`/undo execute-time `resolveFileTarget`, symlink refusal, and hardlink tests.
  - This is a safety boundary, so it goes through the full relay.
- (b) Golden-eval four findings (TEST-GOLD-TN).
- (c) Round-3 residuals A1-F5 (one line plus a test), A3-F4 (meter dollars incl. cache, reuse `model-pricing.js`), C3-2, A1-F4 cleanup.
- (d) 08-10 coordinator P1s and the worktree deny-list conflict.
- (e) CI workflow (HE-02) plus a `check` wrapper (HE-07) plus `check:agent-docs` (PROC-MIRROR).

**Fable (Claude Code):** keep the status board current; write the one-page "Starlark lab: what we learned" after the review and merge decision; the doc-drift pass in §5, *only* when Alan approves doc edits.

## 9. Questions I want Codex and Cursor to challenge (for the three-way comparison)

1. Did you find any direction or item **missing** from my 219 rows? I'm least confident about early-June Cursor PR slices (#11–#14) and the T3-fork-side work outside this repo.
2. Do you agree with **SEC-02**'s list, and is `BEGIN ENCRYPTED PRIVATE KEY` also unredacted in the *streaming* path, or only the batch path?
3. Is the Starlark branch flakiness (§2) a **real concurrency fault** in `run-abort` / evaluator-child handling, or a test-environment artifact? Neither of us should label it without evidence.
4. Do you agree that `HARN-AR-WT` (runner-created worktrees under `~/.bridge-runner/worktrees` blocked by the deny matrix) is reachable today with `--worktree`, or is it masked somewhere?
5. Are any of my **DRIFTED** labels wrong, i.e. was there a recorded decision I missed?
6. Cursor: does your `.cursor/` view agree that `runner-command-builder` assets still teach `--agent`?

## 10. Method, side effects, limits

- **Sources:** 371 commits, all local and remote branches, ~58 root handoff-type files, 243 tracked `docs/` files, `src/`, `bin/`, `scripts/`, `test/`, `starlark-host/`, GitHub Actions history, and read-only `gh` queries. Five read-only helpers each covered one era; I then re-verified the high-impact claims (marked [self-verified]).
- **No live model calls. No edits outside this folder. No deletions.** The token was counted and typed, never printed or tested. `~/.bridge-runner` contents were counted, never quoted.
- **Side effects:**
  - The Starlark helper's test runs added 48 mock run folders to the **ignored** `starlark-host/runs/` of worktree `~/Developer/claude-local-bridge-starlark-resume-2020-2026-09-26` (32 became 80).
  - Scratch files in `/tmp/opus55-audit/` (generator scripts) and `/tmp/opus55-*.txt` (test logs).
  - A local `python3 -m http.server 8765` was used to preview the HTML (stopped after use).
- **Limits:**
  - `attention` and `claude_recommendation` are judgement.
  - A few items are `UNKNOWN` (the phantom-proxy root cause, whether ACP-R2 was ever eyeballed).
  - Helper-only claims are not individually re-run.

## 11. Handoff fields

- **Folder / branch:** `/Users/alanman/Developer/claude-local-bridge-playground`, `main`.
- **Files added:** `docs/claude-deliverables-for-alan-nsfw-opus-5-5/status-and-roadmap-update-checks/{inventory.csv, alan-status-report-2026-09-30.html, AGENT-HANDOFF-status-audit-2026-09-30.md}`. Nothing else changed.
- **Checks run:** `npm test` (pass, 1 todo), `npm run lint` (pass), `npm run check:docs` (pass), `npm run format:check` (fail, pre-existing, three root files; my files are outside its `*.md` root glob).
- **Skipped:**
  - live probes and anything paid;
  - Safari 3 Phase B;
  - the mutation checker (it temporarily edits source);
  - the Harbor Python test (Harbor not installed);
  - reformatting the three red files (Alan said no cleanup).
- **Risks:**
  - The repo is public, so this report is public too (it contains no secrets, only commit hashes and counts). The literal string `BEGIN PRIVATE KEY-----` appears only as a label describing SEC-02, never with key material.

## 12. Push result

See the commit that added this file. The final chat summary to Alan states whether `git push` succeeded; do not assume it did from this file alone.
