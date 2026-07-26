# HANDOFF — Safari 3: remediation plan (2026-07-25)

> **STATUS: PLANNED, NOT AUTHORIZED TO EXECUTE.**
> Alan reviewed this plan on 2026-07-25 and **deliberately tabled execution** in order to work
> through the underlying concepts first. Do **not** begin implementing Phase A, B, or C because you
> found this file. Confirm with Alan that execution is live before changing any source file.
> Everything below is analysis, plan, and context — not an in-flight work order.

**Audience:** any agent (Claude Code, Codex, Cursor) or human picking up the permission-safari
thread. Written to be self-contained: you should not need to reconstruct context by guessing, and
you should not need to re-derive findings that are already verified below.

**Stage:** Safari 1 complete → Safari 2 complete (findings recorded, no fix) → **Safari 3 =
remediation + live re-verification, planned only.**

---

## 1. Preflight — do this before touching anything

This repository has a near-identical sibling. Confirm which one you are in.

```bash
pwd
git rev-parse --show-toplevel
git branch --show-current
git remote -v
git status --short
```

Success in the playground looks like:

- `pwd` and repo root both end with `/Users/alanman/Developer/claude-local-bridge-playground`
- branch is `main`
- `origin` points at `alankatanoisi/claude-local-bridge-playground`
- working tree has no unexpected dirty source files

Verified at the time of writing (2026-07-25): branch `main`, working tree clean.

If the folder is home, Downloads, an iCloud checkout, a scratch folder, or the **canonical**
`claude-local-bridge` repo, stop and tell Alan before editing. Commits belong to the *playground*
repo on `main`. Do not open or continue canonical-repo pull requests unless Alan explicitly asks.

Then, when safe:

```bash
git pull --ff-only origin main
```

---

## 2. What a "permission safari" is

A safari is a bounded, adversarial field test of the bridge runner's permission machinery. Rather
than reading the code and reasoning about what *should* happen, you launch the real runner against
a **disposable sandbox** full of **fake** secrets and try to make its safety controls fail. Whatever
the runner actually does — tool call emitted or not, file present or not, hash changed or not — is
the evidence.

It serves two purposes at once, and both matter:

- **Hardening.** Find and close real gaps.
- **Exploration.** Learn how a local coding-agent harness behaves under adversarial pressure. This
  is the durable output; the individual bugs are cheap by comparison.

**Standing ground rules** (inherited from Safari 1 and 2, all still binding):

1. **Fake fixtures only.** Never real credentials, real `.env` values, or real keys as probes.
2. **Disposable sandbox.** `--cwd` points at a throwaway directory, *never* the repo source tree.
3. **Bounds on every live round.** `--max-steps`, `--max-tool-calls-per-turn`,
   `--max-wall-clock-ms`, `--max-cost-usd` (all verified to exist in
   `bin/local-bridge-runner.js:173-210`).
4. **Fixes and probes are separate phases**, gated by a green test run between them. Do not
   interleave "change the code" with "test the code" in one pass.
5. **Attribute every denial to a layer before drawing a conclusion.** See §6.

---

## 3. Timeline and cast — who did what

Reading the existing documents is confusing without this, because three different actors produced
them and they do not all speak with the same authority.

| When | Actor | What happened |
|------|-------|---------------|
| ~2026-07-21 | Claude + Alan | **Safari 1.** Flag-composition ladder (`--accept-edits`, `--dont-ask`, `--allow-shell` combinations). Everything passed. Established workspace trust behavior. |
| 2026-07-21 | **Codex** + Alan | **Safari 2.** Rounds A–P against the live runner. Found the headline symlink gap. Produced the findings report and hash-manifested evidence archive. **Made no source fix.** |
| 2026-07-20 → 07-24 | Claude + Alan | Several sessions **lost to infrastructure**, not to the work. See §9 — an outer classifier outage and a wedged bridge. Rounds were planned and never ran. |
| 2026-07-22 | Codex (runner session) | A **documentation-only** runner session that read the safari reports and produced the "future directions" backlog (FD-01…FD-22). Important: this is *not* an independent second opinion — see §5. |
| **2026-07-25** | **Claude Code** + Alan | Reviewed all of Codex's deliverables, verified its central claim in source, **found a second gap Codex's method could not detect**, and wrote this plan. Alan then tabled execution to study the concepts. |

**Why the cast matters:** Codex's findings report makes **zero source-code claims**. Not one file
path, function name, or line number appears in it. Every assertion is behavioural, made at the
CLI/tool/artifact boundary. That is methodologically clean, but it means the report cannot tell you
*where* anything lives. All file:line references in this document come from the 2026-07-25 Claude
review and were read directly out of source.

---

## 4. The five-level evidence standard (use this vocabulary)

Codex invented this for Safari 2 and it is genuinely good. Keep using it — it is what makes results
comparable across safaris, and it forces a distinction most summaries blur.

| Class | Meaning |
|-------|---------|
| **Confirmed control** | A real user-reachable CLI path produced a tool event *and* an independently visible outcome. This is the only class that proves a runner control works. |
| **Model refusal** | The model declined before a runner tool call. Reassuring behaviour, but **not** proof the runner would have enforced anything. |
| **Compensating control** | An earlier control was bypassed or inapplicable, but a later one prevented harm. |
| **Suppressed claim** | A plausible concern was tested and counterevidence showed the feared effect did not occur. |
| **Proof gap** | The evidence was not exercised enough to support a general claim. |

The two failure modes this vocabulary exists to prevent:

- Counting a **model refusal** as a working control. Three of Safari 2's sixteen rounds are
  inconclusive for exactly this reason — the model politely declined before the runner was reached,
  so nobody learned whether the guard fires.
- Confusing **suppressed claim** with **proof gap**. "We tested it and the bad thing didn't happen"
  and "we never actually tested it" both read as good news in a summary. Only one is.

---

## 5. Document map — what to read, and what to distrust

| Document | Status |
|---|---|
`docs/permission-safari-findings-2026-07-21.md` / `.html` | Safari 1 findings. Flag ladder; all passed. |
`docs/permission-safari-2-findings-2026-07-21.md` | **Authoritative Safari 2 report.** Rounds A–P, finding register, limitations, 20 flat future directions. |
`docs/permission-safari-2-findings-2026-07-21.html` | Faithful mirror of the above. No content differences. |
`docs/HANDOFF-safari-future-directions-2026-07-22.md` | **Authoritative** version of the FD-01…FD-22 backlog. Has the ground rules, reading chain, and acceptance criteria. Work from this one. |
`docs/safari-future-directions-2026-07-22.html` | **Derived, and partly derived from the Markdown above.** It truncated mid-write; its tail was back-translated from the finished Markdown during archival. It also collapses FD-04 and FD-05 into one card, so a reader can lose FD-05 as a distinct deliverable. Do not treat differences between it and the `.md` as two independent opinions. |
`docs/artifacts/permission-safari-2026-07-21/README.md` | Evidence archive guide. |
`docs/safari2-handoff-2026-07-21.html` | Historical pre-run plan for Safari 2. Superseded. Note it says findings docs "remain uncommitted" — **stale**, everything is committed. |
`docs/threat-model.md` | Living security doc. Lines 129-139 already carry the symlink caveat. Must be updated when the fix lands. |
`docs/runner-runtime-concordance-assessment-2026-07-17.html` | The repo's **designated single tracker**. Has never been annotated with either safari. See §11. |
`docs/runner-p0-10-12-agent-handoff-2026-07-18.md` | P0-10/11/12 record. **All three are CLOSED** (07-18, 07-19). |

**Three known errors in the existing docs — do not act on them:**

1. Both future-directions docs claim `search_text` needs the FD-01 target-aware fix. **It already
   has it** — `safety.js:583-595`, and `docs/threat-model.md:351` already says so. A session that
   trusts this will chase a closed gap and miss `glob.js`, which genuinely does have the hole.
2. FD-06's proposed denial-reason codes omit `model_refusal` and `outer_classifier_refusal`. Safari 2
   explicitly asked for those two. Dropping them removes the taxonomy's entire purpose (see §4).
3. FD-08's surface list omits `archive`. Safari 2 asked for consistency across five surfaces
   (transcript, trace, ledger, archive, `--json`); FD-08 lists four.

---

## 6. The three layers that can say "denied"

Safari 2's most transferable contribution. **"Permission denied" is not one event.** At least five
actors can produce something that looks identical from the outside:

1. **Claude Code's outer command classifier** refuses a host command — *before the runner process
   even starts.*
2. **The model** declines to request a tool at all.
3. **The runner's own policy** hard-denies the tool call. ← *the only layer this repo owns*
4. **A human** denies, or a confirmation times out.
5. **A display/UI layer** hides the evidence *after* the thing already executed.

All five were observed across these sessions. Attributing everything to "the runner" produces false
conclusions in both directions — crediting the runner for denials it never made, and missing gaps
that a well-behaved model happened to paper over.

**Method requirement:** correlate what the operator saw against transcript events, output files,
filesystem effects, and *which process actually started*, before concluding anything.

---

## 7. Verified findings

Everything in this table was read out of source on 2026-07-25. "Verified" means the code path was
traced by reading it; it does **not** mean a live probe was re-run against the fixed code (that is
Phase B).

| ID | Finding | Where | Status |
|---|---|---|---|
| **F1** | **In-root symlink alias defeats the deny matrix on read.** A symlink inside `--cwd` whose own basename is innocent but whose *target* basename is deny-listed (`.env`) is opened by `read_file`. | `permissions.js:228-242`, root cause `safety.js:302` | Codex-observed (Round G), source-verified. **Unremediated.** Compensating control: content redaction. |
| **F2** | **Deny-matrix laundering via the backup mechanism.** NEW — not in either safari. `write_file` on such a symlink is permitted (innocent basename), then `write-file.js:82` `readFileSync` **follows the link** and reads the denied file, and `file-write-utils.js:54-62` writes that plaintext to `<cwd>/.bridge-runner/backups/<innocent>.bak`. `.bridge-runner` is **absent from `DENY_MATRIX_PATTERNS`** (`safety.js:95-122`) although shell-policy *does* block it (`shell-policy.js:64`). | see left | Source-verified 2026-07-25. **Unremediated.** See §8 for accurate harm scoping. |
| **F3** | **Shell is NOT confined to `--cwd`.** Registered by Safari 2 as a **confirmed-FALSE** assumption: ordinary parent-directory and absolute-path reads succeed through the shell. The runner's warning copy is correct ("unsandboxed"), so this is arguably intended — but it is the only *confirmed-false containment assumption* in either safari and the FD backlog gives it **no owner**. | Round A; `shell-policy.js` | Confirmed false. Needs an explicit decision, not silence. |
| **F4** | **Receipt gaps at wall-clock and cost boundaries.** Rounds L and M passed by *operator observation*, but no terminal stop event appears in the transcript, so the intended stop boundary is not independently proven. | Rounds L, M | Proof gap. Live-run territory (Phase B2). |
| **F5** | **Post-timeout CLI does not exit.** After a confirmation timeout the permission outcome was correct (edit absent) but the process stayed alive until `Ctrl-C`. | Round C | Observed, unresolved. |
| **F6** | **No durable `chaos-ok` audit marker.** The maximal-authority combination emits startup warnings and preserves hard path guards, but no transcript event names the acknowledgement. | Round F | Audit gap, not an authority gap. |

### Root cause shared by F1 and F2 — one line

`confinePath` ([safety.js:267-302](src/runner/safety.js#L267-L302)) calls `realpathSync` at line 294
to answer *"is the target inside `--cwd`?"* — then **returns the lexical path** at line 302,
discarding what it learned.

- `path.resolve(cwd, 'notes.txt')` → `/proj/notes.txt`. Pure string arithmetic; never touches disk.
- `fs.realpathSync('/proj/notes.txt')` → `/proj/.env`. Asks the OS to walk it, following links.

Containment asked *where does this go* and followed the link. Classification
(`isPathBlockedByDenyMatrix`, `safety.js:546`, whose patterns are all `path.basename` tests at
`safety.js:105-121`) asked *what is this called* and did not. **Two guards, two different notions of
"the file."** Neither check is wrong in isolation; the bug lives in the seam.

### The fix already exists in this repo

[`isFileCandidateAllowed`](src/runner/safety.js#L568-L601) (`safety.js:568-601`) does exactly the
right thing — it re-runs the deny matrix **against the realpath** at line 595, with a comment
explaining why.

**It is called by exactly one tool: `search_text`.** Current state across the file tools:

| Tool | Confines? | Deny-matrix on resolved target? |
|---|---|---|
| `search_text` | yes | **yes** — correct reference implementation |
| `glob` | yes (per-result, `glob.js:105`) | **no** — uses `confinePath` + `isPathBlockedByDenyMatrix`, the wrong pair (`glob.js:109`) |
| `write_file` | yes (`write-file.js:50`) | no |
| `apply_patch` | yes (`apply-patch.js:265`) | no |
| `read_file` | **no** — `read-file.js:205` plain `path.resolve` against `ctx.cwd` | no |
| `edit_file` | **no** — `edit-file.js:151` plain `path.resolve` against `ctx.cwd` | no |
| `list_files` | **no** — `list-files.js:35`, only a `BLOCKED_DIRS` name filter | no |

Nobody decided this; it is entropy. **An invariant enforced in six places is six invariants that
drift at different rates.** That is why the plan builds one chokepoint rather than patching six
sites — both future-directions docs propose per-site patches, which is how this state arose.

Also relevant: a grep for `O_NOFOLLOW`, `lstatSync`, `isSymbolicLink`, `realpathSync.native` across
all of `src/` and `bin/` returns **zero hits**. There is currently no symlink awareness anywhere in
the codebase.

---

## 8. Accurate harm scoping for F2 (corrected)

An earlier draft of this analysis overstated F2. The corrected version, because precision here
determines priority:

**What is true:**

- A plaintext copy of a deny-listed file's contents is written to disk at a path the deny matrix
  does not cover, and it **persists after the run ends**.
- `read_file` can reach `.bridge-runner/backups/*.bak` (a `.bak` basename matches no deny pattern);
  the shell cannot (`shell-policy.js:64` blocks the segment). One door locked, one not.
- Codex tested this exact area and correctly concluded "suppressed" — it hashed the *target* before
  and after, and the hash was unchanged, because `file-write-utils.js:33` uses `renameSync`, which
  **replaces** the symlink rather than writing through it.

**What is NOT true (corrections):**

- **The plaintext copy cannot be accidentally committed.** `.gitignore:5` contains
  `.bridge-runner/`. Verified 2026-07-25. The worst case is off the table.
- **Disclosure to the model is still mitigated.** If the model reads the `.bak` back,
  `tool-registry.js:165` scrubs `result.text` through `scrubSecrets`. So this is not an unguarded
  read-out path; it is guarded by *pattern-based* redaction only.

**Why it still matters:**

1. It defeats the *purpose* of the deny matrix — those bytes were never supposed to be handled.
2. Redaction is **pattern-based and has real coverage gaps**: no rules for `github_pat_`, `ghs_`,
   `xox*` (Slack), `sk_live_` (Stripe), `AIza…` (Google), `glpat-`, `npm_`; and the generic
   `sk-[a-zA-Z0-9]{20,}` rule at `safety.js:162` **excludes `_` and `-`**, so many modern key
   formats fall through to no rule at all.
3. Because `.bridge-runner/` is gitignored, these artifacts **never appear in `git status`** — so
   nothing ever surfaces them to the operator. Invisible accumulation is the mechanism by which
   this went unnoticed.
4. FD-18 proposes an `evidence-bundle` export command. Any such exporter must know that this
   directory can contain plaintext copies of deny-listed files.

**Conceptual name for F2:** a **confused deputy**. The model lacks authority to read `.env`; the
runner has it. The model does not attack the lock — it asks the deputy to perform a legitimate
action, and the deputy's legitimate action carries the data across the boundary. The courier here is
*a safety feature* (P1-08 requires a recoverable backup before any overwrite). A safety feature is
still a capability.

---

## 9. Environment facts you will otherwise waste a session rediscovering

**The bridge is a VS Code extension, not a standalone server.** `package.json` `main` is
`./src/extension.js`; there is no `npm start` that launches it. It listens on **`127.0.0.1:11437`**
with port-retry on `EADDRINUSE` (base +1, up to 10 retries), so it can legitimately end up on
11438/11439. Pass `--bridge-url http://127.0.0.1:<port>` if so.

**Liveness ≠ readiness.** `GET /v1/debug` is caller-auth-exempt and can answer **while
`POST /v1/messages` hangs**. This was observed directly: the extension host process held the TCP
ports open while the extension JavaScript no longer serviced requests. **Do not use `/v1/debug` as a
readiness check.** Probe the message path.

**Fix for a wedged bridge:** in VS Code, `Cmd+Shift+P` → **"Developer: Reload Window."** Note this
also restarts any Claude Code session running in that window — which is why handoff docs exist.

**The outer classifier outage is real and was still active on 2026-07-25.** Claude Code's *auto*
permission mode routes Bash commands through a safety-checker model. During Safari 2 that was
`claude-opus-4-8`; on 2026-07-25 it was `claude-opus-5[1m]`. Symptom:

> "…is temporarily unavailable, so auto mode cannot determine the safety of Bash right now."

Consequences and workarounds:

- **Allowlisted** commands (git, pwd, df) still pass; anything requiring classification fails
  *before the runner launches*. This is **not** a runner control firing.
- **Read-only tools are unaffected.** `Read` works when `Bash` does not — much of the source
  verification in §7 was done that way.
- Switching Claude Code out of auto mode (`Shift+Tab`) restores direct user approval and unblocks
  shell immediately. This does not bypass a runner control; it selects a different *outer* workflow
  so the runner's own controls can be observed.

**Live-run budget:** as of 2026-07-25 Alan had ~56% of his weekly Anthropic allowance with ~11h to
reset. That window has since narrowed or closed; **re-confirm before assuming budget.**

---

## 10. The plan

Three phases. **Phase A costs no model budget.** Phase B is gated on Phase A being green.

### Phase A — offline (no model invocation)

| # | Work | Files |
|---|---|---|
| A1 | **Fixture helper first.** `makeFixtureCtx()`, `withSymlinkFixture()`. There is no `test/helpers/` directory and `mkdtempSync` is open-coded **136×** across `test/`. A symlink matrix needs project dir + outside dir + link + realpath'd ctx. | new `test/helpers/fixtures.js` |
| A2 | **The chokepoint: `resolveFileTarget(ctx, inputPath)`** returning `{ lexical, real, allowed, reason }`. Every file tool calls it. Model it on `isFileCandidateAllowed`. | `src/runner/safety.js` |
| A3 | **F1 read-side fix** via the chokepoint. **Skip `search_text`** (already green). | `permissions.js:228-242`, `tools/glob.js:105-109` |
| A4 | **Close F2.** Add `.bridge-runner/` to `DENY_MATRIX_PATTERNS`; refuse to back up when the target is a symlink (`lstatSync().isSymbolicLink()`). | `safety.js:95-122`, `tools/file-write-utils.js:54-62` |
| A5 | **Symlink matrix.** {`read_file`, `write_file`, `edit_file`, `apply_patch`, `glob`, `list_files`, `search_text`} × {escaping symlink, in-root denied-target symlink, **hardlink**}. Codex proved one cell by hand. `apply_patch` is opt-in via `--tools apply_patch` — FD-02 omits this. | new `test/runner/fd-02-symlink-matrix.test.js` |
| A6 | **Stop echoing denied content into results.** `edit-file.js:182-206` puts ±2 context lines of the **resolved target** into `result.text`/`result.diff`; `apply-patch.js:196-201` embeds the real file line in hunk-mismatch errors. Note `result.diff` is a separate top-level field and only `result.text` is scrubbed at `tool-registry.js:165`. | `tools/edit-file.js`, `tools/apply-patch.js` |
| A7 | **Artifact-mode tests (FD-10).** Automated `0700`/`0600` assertions across transcript, session, trust, trace, ledger, archive, recovery-manifest. P0-12's only current evidence is Alan eyeballing two `ls -l` lines (Round P). Honor the carve-out: never force modes on user project files. | new `test/runner/fd-10-artifact-modes.test.js` |
| A8 | **Denial reason codes (FD-06) — including the two the backlog dropped**: `model_refusal`, `outer_classifier_refusal`. Also replaces the misleading fixed string `'User denied this action.'` (`tool-pipeline.js:516`) on non-interactive denials, where no human decided anything. | `permissions.js`, `tool-pipeline.js`, `transcript.js` |
| A9 | **`chaos-ok` audit marker (FD-07).** Record acknowledgement + effective high-authority flag combination as a run-start transcript/ledger event. Closes F6. | `run.js`, `shell-policy.js:160` |
| A10 | **Fix a false comment.** `tool-pipeline.js:79-80` claims `confinePath` returns realpath-anchored paths "so symlink aliasing is mostly defused at the source." It does not — and `_groupDisjointWrites` (`tool-pipeline.js:101`) relies on it, so two aliases of one file are judged disjoint and written **in parallel**. | `tool-pipeline.js:79-101` |
| A11 | **Collapse three copies of the deny list.** `shell-policy.js:27-40`, `permissions.js:62-75` (**dead** — exported but not in the check path), `safety.js:95-122`. | those three |
| A12 | **Give F3 an owner.** Resolution may legitimately be "documented as intentional, honesty copy verified by test" rather than a sandbox. It should not stay unowned. | `docs/threat-model.md`, `test/runner/p0-09-shell-honesty.test.js` |

### Phase B — live probes (requires Alan's confirmation + budget)

Most of the backlog is offline. Phase B contains only what a live model can *uniquely* settle.

**B0 — preflight before spending anything.** Confirm bridge health via the **message path**, not
`/v1/debug` (§9). Reload the VS Code window if wedged.

| # | Probe | Why it needs a live model |
|---|---|---|
| B1 | F1 + F2 re-verification against the fixed runner | Offline tests prove the *predicate*; only a live run proves the *path* — Safari 2's "confirmed control" bar requires a real tool event plus an independently visible outcome. |
| B2 | FD-08 wall-clock + cost receipts. Tiny `--max-wall-clock-ms` / `--max-cost-usd`; assert terminal events on **all five** surfaces (transcript, trace, ledger, **archive**, `--json`) and that no effectful call landed past the boundary. | Closes F4. Budget exhaustion is inherently a live phenomenon. |
| B3 | FD-03 timeout lifecycle. Low `--confirm-timeout`, then walk away. | Closes F5. Needs a real prompt in a real PTY against a real model turn. |
| B4 | FD-16 prompt-injection step burn — *measure* steps/tokens/cost, not just absence of effect. | Real token accounting. Cheap; reuses an existing fixture. |
| B5 | FD-20 cross-model control set. **Surplus budget only; run last.** | Attacks the confound that invalidated Rounds A, B, H — separating stable runner behaviour from model-specific willingness. |
| B6 | FD-22 auto-mode retest — **opportunistic only, do not wait on it.** | Blocked on the outer classifier, which was still down 2026-07-25. |

**Excluded regardless of budget: FD-12 (indirect egress probing under `--no-network`).** Worst
risk/reward in the backlog; the probe class most likely to re-trigger the outer guardrails that
ended Safari 2; and the honest answer is already documented (`--no-network` is a proxy-based guard,
not OS isolation). **Explicitly outside Alan's authorization** (§12).

**Deferred by design: FD-11, the model-free probe harness** — inject tool calls directly into the
runner, bypassing the model. This is the highest-value item in any of the three documents, because
it permanently removes the refusal confound that invalidated three of Safari 2's rounds. It is
*model-free*, so it gains nothing from an expiring budget and belongs in its own session.

### Phase C — unified cross-agent context

Alan's explicit goal: *"fold everything in such that other non-Claude agents understand the
context… we want full unified context as closely as possible."* This is a deliverable, not cleanup.

- **C1 — `CLAUDE.md` is actively wrong and must be corrected.** Lines 153-156 still say central
  stdout/`--json`/`--stream-json` redaction "is currently an open gap (P0-11); do not claim stream
  output is redacted." Lines 176-182 still list P0-10/11/12 as **open** with an execution order. All
  three closed 07-18/07-19, and Safari 2 Round B **field-confirmed** redaction across transcript,
  JSON/stdout, stderr, redacted trace, and full trace. The P0-11 session plan explicitly required
  this edit and it never happened; Safari 1 then cited the stale language as if current. **Any agent
  reading `CLAUDE.md` today is misinformed on day one.**
- **C2 — Restore the `AGENTS.md` ↔ `CLAUDE.md` mirror.** `AGENTS.md` has no P0 section at all
  despite both files carrying an explicit keep-in-sync rule. Neither mentions the safaris or the FD
  backlog, so no agent is pointed at any of it by the memory files.
- **C3 — One tracker.** Annotate `docs/runner-runtime-concordance-assessment-2026-07-17.html` with
  both safaris and register FD-01…FD-22 as a post-P0 package there. See §11.
- **C4 — Reconcile docs against source.** Fix the three known doc errors in §5.
- **C5 — `docs/threat-model.md`.** §Path escapes (129-139) converts from open finding to mitigation;
  new Known-Limitation entry for F2 in the existing numbered style; deny-matrix table row for
  `.bridge-runner/`; note that most patterns are basename-only while system-dir patterns are
  segment-based.
- **C6 — Memorialize the live-run authorization** in the mirrored Learned User Preferences blocks.
- **C7 — Safari 3 report as HTML** under `docs/`, per the repo preference for HTML over Markdown,
  using the five-level evidence standard so results stay comparable. Plus a short agent-facing
  Markdown handoff, matching the established pattern.
- Minor: a `.DS_Store` is committed inside `docs/artifacts/permission-safari-2026-07-21/`.

---

## 11. Tracker discipline — read this before filing anything

**There are two colliding "P0" namespaces in `docs/` right now:**

- The runtime-concordance series `P0-01…P0-12` — **all closed.**
- The future-directions band `FD-01…FD-05`, which the 07-22 handoff **also labels P0.**

The repo's own stored preference is to *annotate the existing concordance assessment rather than
invent a parallel tracker*. The FD series is currently exactly the parallel tracker that preference
warns against. **Register FD-* as a post-P0 package inside the concordance doc.** Do not create a
third tracker, and do not write "P0-01" when you mean "FD-01."

---

## 12. Authorization of record

Granted by Alan on 2026-07-25, recorded here so it is not Claude-only knowledge:

> "i am 100% ok with live bridge tests with model invocations, particularly because my Anthropic
> usage limits reset (weekly) in 11 hrs and i have 56% left."

**Scope — written narrowly on purpose:**

- **Authorizes:** live `POST /v1/messages` runs through the local bridge, spending Alan's weekly
  subscription budget, for the Phase B probe set only.
- **Conditions:** all §2 ground rules remain binding — fake fixtures, disposable sandbox, explicit
  bounds on every round.
- **Does NOT authorize:** egress / network-bypass probing (FD-12), real credentials, probes against
  the repo working tree, or unbounded runs. This is a *budget* authorization, not an authority
  escalation.
- **Time-boxed** to the ~11h window before the weekly reset. **It does not roll forward silently.**
  Re-confirm rather than assume.

Separately and importantly: **Alan tabled execution of this plan on 2026-07-25** to study the
concepts first. The budget authorization above does not constitute approval to start work. See the
banner at the top.

---

## 13. Landmines

**The lexical fallback is load-bearing for the test suite.** `safety.js:280-285` returns the lexical
path when `realpathSync` throws. Every test in `permissions.test.js` uses a **non-existent**
`/fake/project` cwd, so realpath always throws there and the fallback always fires. It is pinned by
`safety.test.js:108-111`. **Any change that makes `confinePath` fail closed when realpath is
unavailable breaks that entire file.** Keep the fallback; apply the resolved-target check only when
the path exists. This is a real coupling between a shortcut in production code and a shortcut in
test code.

**Do not regress these invariants** (from `CLAUDE.md`):

- Shell is hidden unless `--allow-shell`.
- `--dont-ask` must **not** enable shell by itself.
- Block `.env`, private keys, credential JSON, token files, `.ssh`, `.aws`, `.claude`, path escapes.
- Write tools ask for confirmation unless `--accept-edits`.
- Transcripts, tool output, and human logs redact secrets.
- Native Anthropic route `POST /v1/messages` only. No OpenAI-compatible routes. No
  `ANTHROPIC_API_KEY` upstream fallback. OAuth Bearer credentials only.
- Do **not** modify `src/credentials.js`, `src/proxy.js`, `src/server.js`, `src/interceptors/**`
  unless explicitly asked.

**Existing tests that must keep passing unchanged:** `safety.test.js:95-106` and
`search-text.test.js:88-100` (both symlink *escape* tests). They cover the escaping case; neither
covers the in-root-alias case, which is precisely the gap.

**What NOT to redo** (from Codex's handoff): don't re-prove Safari 1's flag ladder (it passed
everywhere); don't re-run exact-value secret scans on archived evidence (manifests exist); don't
treat outer-guardrail blocks as runner failures.

---

## 14. Verification

Run in `/Users/alanman/Developer/claude-local-bridge-playground` on `main`, in a terminal:

```bash
# targeted first
node --require ./test/setup.js --test test/runner/safety.test.js \
  test/runner/permissions.test.js test/runner/glob.test.js \
  test/runner/write-file.test.js test/runner/edit-file.test.js \
  test/runner/search-text.test.js test/runner/realpath-cache.test.js \
  test/runner/fd-02-symlink-matrix.test.js test/runner/fd-10-artifact-modes.test.js

# then the full gate
npm test && npm run lint && npm run check:docs && npm run format:check
```

**Phase A success:**

- An in-root symlink to a deny-listed target is hard-denied for `read_file`, `glob`, `edit_file`,
  `apply_patch`; the two existing escape tests still pass **unchanged**.
- `write_file` against such a symlink produces **no** `.bak` containing the target's plaintext, and
  `read_file` on any `.bridge-runner/` path is denied.
- All of `permissions.test.js` still passes (the `/fake/project` idiom survives).
- Invariants in §13 intact.

**Phase B success:** every round produces a transcript event **and** an independently visible
outcome — Safari 2's *confirmed control* bar, not an operator-observed pass. Every result classified
with the five-level standard, and every denial attributed to a layer before any conclusion.

---

## 15. Open questions (genuine unknowns)

1. **Does `edit_file` follow the symlink where `write_file` did not?** `edit-file.js:155` does a
   plain `readFileSync`, and the diff preview at `edit-file.js:182-206` puts context lines of the
   *resolved target* into the result — which suggests **yes**, and would be worse than F2 because it
   returns content directly rather than via a disk artifact. **Not run. Not claimed.** Phase A5
   settles it.
2. **What do hardlinks do here?** A hardlink is a second real directory entry for the same inode —
   not a signpost. There is nothing to resolve and nothing to `lstat` as suspicious. Neither safari
   tested it, and it is unknown whether the controls have any answer at all. Highest-uncertainty
   item in this document.
3. **Does the P0-10 realpath-cache invalidation bonus item actually exist?** P0-10 proposed clearing
   the `cachedRealpathSync` cache on root transitions. A2/A3 add *more* realpath-cache dependence to
   the read path, so a stale entry could make a target-aware deny miss after a worktree root swap.
   Verify before relying on it.
4. **Would the lexical shell filter actually catch an obfuscated path?** The filter is
   **substring-based** (`cmd.includes(seg)`, `shell-policy.js:125-135`), so `cat .en''v` and
   `X=.env; cat $X` are *expected* misses. Round H could not settle this because the model refused
   first. Needs FD-11's harness to prove rather than assume.
5. **Does redaction survive model-side transformation** of secret-shaped values (base64, reversal,
   chunked emission across messages)? Not covered by the P0-11 test plan, which tested a secret split
   across two SSE chunks — not a semantically transformed one.

**Resolved on 2026-07-25 (do not re-investigate):** whether the F2 backup artifact could be
committed to Git. It cannot — `.gitignore:5` contains `.bridge-runner/`.

---

## 16. Handoff fields

- **Folder:** `/Users/alanman/Developer/claude-local-bridge-playground`
- **Branch:** `main` (clean at time of writing)
- **Files changed this session:** this document and its HTML twin
  (`HANDOFF-safari-3-remediation-plan-2026-07-25.html`). **No source file was modified.**
- **Checks run:** none — no source changed, so the test gate was not exercised. Do not read this
  document as evidence that anything passes.
- **Verification performed:** source reading only (`Read`), plus two shell commands for branch state
  and `.gitignore`. No live runner invocation. No probe re-run.
- **Skipped:** all of Phase A, B, C. Execution tabled by Alan on 2026-07-25.
- **Not committed:** these two files were written but **not** committed or pushed. Nothing has been
  pushed.
- **Risks / next steps:** the two unremediated gaps (F1, F2) remain live, with pattern-based
  redaction as the only thing between an aliased read and disclosure. `CLAUDE.md` actively
  misinforms agents about P0-11 (C1) and is the cheapest high-value fix in the plan. Confirm with
  Alan before executing anything here.

**Companion documents:** `HANDOFF-safari-3-remediation-plan-2026-07-25.html` (human-friendly
version of this file). Claude Code's working plan lives outside the repo at
`~/.claude/plans/declarative-floating-widget.md` and is *not* authoritative — this file is.
