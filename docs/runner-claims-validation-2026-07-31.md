# Runner-Claim Validation — Agent Brief (2026-07-31)

| Field | Value |
| --- | --- |
| Type | Verification record + working instructions for agents |
| Date | 2026-07-31 |
| Repo | `claude-local-bridge-playground`, branch `main` |
| Human twin | `docs/runner-claims-validation-2026-07-31.html` (same findings, prose framing) |
| Mode | Read-only. No source, config, or pre-existing doc modified. |
| Scope | **Only** claims the four source reports make about *this repo's runner*. Third-party framework claims were not assessed. |

---

## 0. How to use this file

This is a **fact-check record**, not a tracker and not a plan. Its job is to stop the next
agent from (a) re-verifying claims that are already verified, (b) acting on the two claims that
are wrong, and (c) implementing fixes that would be no-ops.

- If you are about to act on the 2026-07-28 harness review: read §3 first for the two errata.
- If you are about to implement HE-01: read §5 (N1–N3) — the review's framing is incomplete.
- If you are about to implement HE-08b redaction: read §5 (N4, N6) — one half is a no-op.
- Do **not** register anything here as a new tracker. Per `CLAUDE.md`, runner work goes into
  `docs/runner-runtime-concordance-assessment-2026-07-17.html` with `FD-*` IDs.

---

## 1. Source documents and their runner-claim density

| Document | Runner claims | Verified |
| --- | --- | --- |
| `docs/harness-engineering-runner-runtime-review-2026-07-28.html` | ~55 (this is a review *of* the runner) | Yes — bulk of this record |
| `docs/ai-orchestration-study-review-and-next-steps-2026-07-30.html` | 8 (the §3 mapping table + 2 sentences) | Yes |
| `docs/ai-orchestration-preliminary-study-2026-07-29.md` | 2 (thesis illustration + handoff line) | Yes |
| `docs/ai-orchestration-preliminary-study-2026-07-29.html` | Same 2 (HTML twin of the `.md`) | Yes |

**Path correction:** the fourth item was cited as `ai-orchestration-preliminary-study-2026-07-29.html`
at repo root. It does not exist there; it lives at `docs/`. There are **three** distinct documents,
not four.

**Headline:** 62 runner claims checked → **54 TRUE, 6 imprecise, 2 wrong, 0 materially misleading.**
The one report written with full local access is accurate, including on its own uncomfortable findings.

---

## 2. Verified-true facts — treat as established, do not re-derive

Cite these rather than re-measuring. All measured 2026-07-31 against the working tree.

### 2.1 Inventory

```
bin/local-bridge-runner.js        825 lines
src/runner/run.js                1709 lines
src/runner/tool-pipeline.js       601 lines
src/runner/safety.js              741 lines
src/runner/permissions.js         485 lines
src/runner/*.js (top level)        64 files / 13,141 lines
src/runner/tools/*.js              24 files /  3,554 lines
src/runner/**/*.js (recursive)    111 files / 19,705 lines
test/runner/*.test.js             105 files
docs/                            ~2.32 MB at 2026-07-28; 2.72 MB today
STOP_REASONS                       25 keys (kernel/contract.js:11-45)
core capability group               7 tools
golden eval corpus                  2 cases
MAX_SPAWNS_PER_RUN                  8 (tools/spawn-agent.js:17)
```

### 2.2 Safety / permissions — all TRUE

| Claim | Anchor |
| --- | --- |
| `resolveFileTarget` checks lexical path, lexical basename, **realpath basename**, and realpath containment | `safety.js:366-399` |
| `permissions.check` calls it, so registry dispatch is target-aware | `permissions.js:214-215` |
| `write-file.js` = `confinePath` + `lstat` symlink refuse | `tools/write-file.js:50`, `:83-86` |
| `apply-patch.js`, `undo.js`, `undo-edit.js` use `confinePath` only | `:269`, `:100`, `:90,137` |
| `read-file.js` / `edit-file.js` use bare `path.resolve`, gate-only | `read-file.js:205`, `edit-file.js:151` |
| `edit_file` follows symlinks (no lstat refuse) | absence in `edit-file.js` |
| `list_files` leaks deny-matrix basenames | `tools/list-files.js:39` skips only `BLOCKED_DIRS` |
| Redaction misses `github_pat_`, `ghs_`, Slack `xox*` | `safety.js:197-224` |
| Multimodal `contentBlocks` bypass the text scrub | `tool-registry.js:155-177` vs `media-read.js:61,94` |
| No durable chaos-ok marker in run artifacts | `chaosOk` only in `bootstrap.js:54`, `run.js:463,541`, `shell-policy.js:142` |
| `threat-model.md` still narrates the pre-`resolveFileTarget` state | `threat-model.md:135-140`; no mention of `resolveFileTarget` in that file |
| Authority ceiling frozen at run start, monotonic | `run.js:531`; `permissions.js:195-213` |
| Shell needs `--allow-shell`; excluded from `--capabilities`; `--dont-ask` does not grant it | `tool-visibility.js:32`; `tool-catalog.js:159` |
| Central redaction boundary with 3 consumers | `redaction-boundary.js`; `tool-pipeline.js:73`, `session-store.js:13`, `run.js:49` |
| `private-fs.js` backs ledger writes | `session-ledger.js:15` |
| Hooks: workspace trust **and** strict `trusted === true` for exec | `hooks/hook-dispatcher.js:10-15,60-61,102-105` |
| Shell honestly documented as unsandboxed local-account authority | `threat-model.md:297`; `README.md:315,433`; `tools/bash.js:4` |

### 2.3 Architecture — all TRUE

| Claim | Anchor |
| --- | --- |
| HE-03 kernel inversion: `runKernel` is an option-map over `run()`; CLI calls `run()` directly; only coordinator uses the kernel | `kernel/agent-kernel.js:10,25-73`; `bin/local-bridge-runner.js:16,616`; `coordinator.js:7,173` |
| Contract normalization pattern-matches legacy `finalText` | `kernel/contract.js:146-154` |
| HE-08: `context-compactor.js` is off the hot path | zero `require` in `src/`/`bin/`; 6 test files import it |
| HE-09: `runPhasePlan` implemented + tested, not wired into `Coordinator.run` | `coordinator.js:63,281`; only consumer is `test/runner/coordinator-parallel.test.js`; `Coordinator.run` at `:81` calls `spawnWorker` directly |
| Effect pairing: `tool_effect_intent` → exactly one `tool_effect_result`, shared `effectId` | `tool-pipeline.js:33-34,223,276` |
| Capability groups exactly as listed | `tool-catalog.js:112-129` |
| `apply_patch` needs exact `--tools` | `tools/apply-patch.js:382` (`hidden: true`) → `tool-visibility.js:77` |
| Transcript resume deprecated and rejected | `bin/local-bridge-runner.js:57,533` |
| Retired-profile rejection in `run.js` | `run.js:415-419` |
| Trace levels off/summary/redacted/full | `bin/local-bridge-runner.js:411` |
| Artifact paths (`~/.bridge-runner/logs/`, `.bridge-runner/runs/<id>/manifest.json`) | `bin/local-bridge-runner.js:47,546`; `recovery/run-manifest.js:14` |
| Budget tracker (in/out tokens, wall clock, USD), broker leases, child-inherit | `budget-tracker.js:90-131`; `budget-broker.js:4-15`; `child-inherit.js` |

### 2.4 Packaging — all TRUE

`PLANS.md`, `docs/ARCHITECTURE.md`, `docs/OBSERVABILITY.md`, `Makefile`, `Makefile.harness`
are all **absent**. Workflows are exactly `codeql.yml` and `bridge-runner-readonly-poc.yml`
(`workflow_dispatch` only) — no PR gate. npm scripts and the no-typechecker claim match exactly
(devDeps: `@eslint/js`, `eslint`, `globals`, `jest`, `prettier`).

### 2.5 Orchestration-study §3 mapping — TRUE

Every module named in the "study concept → existing runner module" table exists and does
approximately what is claimed: `permissions.js`/`authority.js`, `budget-tracker.js`/`budget-broker.js`,
`session-store.js`/`session-ledger.js`, archive/transcript/`context-projection.js`,
`redaction-boundary.js`, `plan-proposals.js`/`confirmation.js`/`user-question.js`.
The claim that our threat model documents a shell-sandboxing weakness is also true
(`threat-model.md:297-310`, which even names Seatbelt/Landlock as the missing work).

---

## 3. ERRATA — do not propagate these two

**E1 — line-count caption.** The harness review's summary card reads
`~13.1k LOC top-level + tools`. Wrong: 13,141 is **top-level only**. Top-level + tools = 16,695;
whole tree = 19,705. The review's own §11 appendix is correct. If you quote a runner size figure,
quote §11, not the card.

**E2 — HE-03 example list.** The finding lists five CLI options as droppable on the
coordinator→kernel path. Four are genuinely absent from the kernel option map
(`capabilities`, `budgetInputTokens`, `enableLsp`, `testWatch`) — and so is `budgetOutputTokens`.
But **`sessionExtract` IS threaded through** (`agent-kernel.js`, present in the options object).
The finding stands; the example does not. Use `budgetOutputTokens` as the fifth example.

---

## 4. Lower-severity imprecisions

| ID | Issue | Impact |
| --- | --- | --- |
| I1 | Orchestration review §3 attributes **effect pairing** to `session-ledger.js`. It is implemented in `tool-pipeline.js:223,276`; the ledger is the sink. | An agent looking for the logic in the ledger will not find it. |
| I2 | HE-08b's redaction phrasing does not say what *is* covered. Already handled: private-key blocks, `sk-ant-`, generic `sk-`, `ghp_`, `gho_`, `AKIA`, `aws_secret_access_key=`, `Bearer`, JWT, `SECRET\|TOKEN\|PASSWORD\|API_KEY=` lines. | Risk of "fixing" `ghp_`, which is already covered. |
| I3 | The 2026-07-30 review header records branch `claude/user-owned-ai-orchestration-qaxol8`; the study handoff and harness review say `main`. The files are on `main`. | Branch archaeology. Build on `main`. |
| I4 | The three orchestration documents' runner claims are true but thin; their substance is third-party landscape research that this validation did **not** check. | Do not cite them as evidence about the runner beyond the §3 mapping. |

---

## 5. New findings (not in any source report)

Observations only. **None of these is an authorization to change code.**

**N1 — the permission gate has a single-argument shape assumption.**
`permissions.js:194` extracts `const requestedPath = args && args.path`. The entire target-aware
defence keys off that one argument name. A tool whose filesystem target arrives under a different
key, or a tool with a *second* path argument, gets no `resolveFileTarget` check at all.
This generalises HE-01: the problem is not only thin `execute` paths, it is that the gate itself
cannot see targets it does not know how to name. **Recommended: a catalog-driven contract test
asserting every write-capable tool's path argument(s) are reachable by the gate.**

**N2 — `list_files` has no confinement in `execute`.**
`tools/list-files.js:34` is a bare `path.resolve(cwd, args.path)` with no `confinePath` call at all.
HE-01 flagged the basename existence leak but not the missing confinement. Same defence-in-depth
class, one tool further out than the review's list.

**N3 — `glob.js` has already migrated; use it as the reference pattern.**
`tools/glob.js:105` calls `safety.resolveFileTarget` (and `:131` still calls `confinePath`).
HE-01's narrative implies only `permissions.check` adopted the new choicepoint. Before writing
HE-01 code, diff `glob.js`'s usage against `permissions.js`'s and adopt one shape — do not invent
a third.

**N4 — `tool-catalog.js:132-152` throws at load if any tool is in two capability groups or none.**
Stronger invariant than the review credits, and the structural reason the capability surface cannot
silently drift. Belongs in the future `ARCHITECTURE.md`.

**N5 — `CLAUDE.md` "Known live gaps (as of 2026-07-25)" is stale, in an auto-loaded file.**
It still describes the symlink deny-matrix gap as observed and unremediated. `resolveFileTarget`
substantially closed that at the gate. This is the same staleness class HE-08b flagged in
`threat-model.md`, but it sits in the file Claude Code auto-loads — so **every Claude session
currently starts misinformed**. Arguably higher-impact than the threat-model drift.
Do not silently edit it; it is guardrail text and needs an explicit decision (see §6 Q2).

**N6 — scrubbing base64 `contentBlocks` would be close to a no-op.**
A regex secret-scrub cannot match a secret rendered inside an image, and will not match text inside
a PDF's compressed streams either. The effective control for HE-08b's multimodal half is the
**path gate** (may this file be read at all) plus a size/type policy — not the redactor.
Record this before someone spends a turn on an expensive no-op.

---

## 6. Open questions for the next agent

1. **Is HE-01 still the right shape given N3?** One tool already calls `resolveFileTarget` in
   `execute`. The remaining work may be smaller than the review implies, or the two call sites may
   have diverged. Do a call-site diff before writing code.
2. **Who owns the symlink-gap narrative?** `CLAUDE.md` (open), `docs/threat-model.md` (open), and
   the harness review (closed at the gate, residual at the tool layer) disagree. The single-tracker
   rule points at the concordance assessment, which was not consulted for this question.
   Needs Alan or a designated agent to pick one and annotate the others.
3. **Who owns the chaos-ok marker gap?** Confirmed true; carries two IDs (HE-08b and Safari
   S2-05/F6) and neither namespace currently owns it. Register once as `FD-*` in the concordance
   tracker, not a third place.
4. **Does the coordinator→kernel option drop have a safety edge, not just feature drift?**
   `capabilities` is one of the dropped options and it determines which tools exist. Whether a
   coordinator-launched run gets a *wider* or *narrower* surface than intended was **not**
   determined here. This is the one part of HE-03 that could be a safety issue rather than a
   convenience issue. **Verify before promoting the coordinator (HE-09).**
5. **Sequencing.** The 2026-07-30 review recommends HE-07 → HE-05 → HE-01. Nothing found here
   contradicts that, but note HE-05 (`ARCHITECTURE.md` / `OBSERVABILITY.md`) is the natural home
   for N1, N4, and the §2 anchor tables, so writing HE-05 *after* resolving Q1/Q2 avoids
   documenting a state that is about to change.

---

## 7. Standing boundaries reaffirmed

- No runner / bridge / auth / proxy source edits from a research or verification turn.
- Safari 3 Phase B live probes remain gated on Alan's explicit budget/window confirmation.
- Do not restore profiles, OpenAI-compatible routes, or API-key fallback.
- Register graduated items in `docs/runner-runtime-concordance-assessment-2026-07-17.html` with
  `FD-*` IDs. Do not open a third `P0` namespace.

---

## 8. Handoff

| Field | Value |
| --- | --- |
| Folder | `/Users/alanman/Developer/claude-local-bridge-playground` |
| Branch | `main` |
| Files changed | None modified. Added: `docs/runner-claims-validation-2026-07-31.md` (this file), `docs/runner-claims-validation-2026-07-31.html` (human twin). |
| Checks run | Read-only source inspection and line counting only. |
| Skipped | `npm test`, `npm run lint`, `npm run check:docs`, `npm run format:check` — no source touched, verification-only turn. Also skipped: all third-party claims (smolagents, LangGraph, OpenAI Agents SDK, ADK, AutoGen, Anthropic PTC/CET, CodeAct, `@anthropic-ai/sandbox-runtime`, OTel GenAI semconv) — these need web access and are out of scope. |
| Risks | Counts and file:line anchors are a 2026-07-31 snapshot and will drift. N1–N6 are observations, not authorizations. |
| Next step | Resolve Q1 and Q2 before implementing HE-01; annotate E1/E2 into the harness review as errata. |
