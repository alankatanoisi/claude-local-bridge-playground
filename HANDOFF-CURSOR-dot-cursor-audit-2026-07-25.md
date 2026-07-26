# HANDOFF — For Cursor Agent only: audit the `.cursor/` primitives with Alan

**Audience: Cursor Agent, in Cursor chat, in this repository.** Not for Claude Code or Codex.
**Written by:** Claude Code (Fable 5), 2026-07-25, at Alan's request.
**How to use:** Alan will paste or point you at this file. Treat it as the task brief. Everything in the
"Verified inventory" and "Verified findings" sections was checked on 2026-07-25 — you do not need to
rediscover it, but you are welcome to re-verify (commands provided).

---

## 1. The ask, in one paragraph

The `.cursor/` directory in this repo contains 20 files, **most last modified in May 2026** — roughly two
months stale. Several of them reference runtime concepts that have since been **retired**, and at least two
of those are **live primitives** (an agent definition and a skill) rather than archived notes, meaning they
can actively mislead Alan or you today. Nothing in `.cursor/` mentions the work that has dominated this repo
for the past week. **Your task is to audit `.cursor/` together with Alan, interactively, and produce a triage
plan** — not to unilaterally clean it up.

---

## 2. Ground rules — read these before proposing anything

**Alan is a novice programmer and a former lawyer.** Both matter here.

1. **He values authenticity of record very highly.** His words: *"the raw and authentic and original — even if
   messy and bloated — tells me so much more in retrospect than the editorialized and the tidy."*
   **Default to preserving, not deleting.** If something is stale, your first instinct should be to *mark or
   move* it, not remove it. Deletion requires his explicit per-file approval.
2. **Ask before every destructive action.** Deleting, overwriting, or rewriting a file needs his sign-off.
   Batch your proposals so he can approve a group, but never assume.
3. **Explain where things run and what success looks like.** He should never have to guess whether something
   belongs in Terminal, Cursor chat, VS Code, or a browser.
4. **Define jargon once.** Do not assume he knows terms like glob, frontmatter, MDC, symlink, or shim.
5. **One decision at a time for anything irreversible.** Batch only the safe stuff.
6. **Separate "stale" from "wrong."** A May plan describing May's goals is *accurate history*. A May **skill**
   telling you to use a flag that no longer exists is *actively harmful*. Treat these completely differently —
   this distinction is the core of the whole audit.

---

## 3. Current reality you are probably missing

**Your own `.cursor/` docs will mislead you about the present state of this repo.** Brief yourself on these
before you evaluate anything. Sources: `AGENTS.md` (which you auto-load) and
`CLAUDE.md` (which you do **not** auto-load, and which was amended 2026-07-25).

- **Agent profiles and capability profiles are RETIRED.** Do not restore `--agent`, `--profile`,
  `--list-agents`, or `--list-profiles`. Historical code lives under `docs/archive/runner-profiles/`.
- **OpenAI-compatible endpoints are forbidden.** No `/v1/chat/completions`, no `/v1/models`. The only model
  route is the native Anthropic `POST /v1/messages`. There is no upstream `ANTHROPIC_API_KEY` fallback and no
  `claudeLocalBridge.apiKey` credential source. OAuth Bearer only.
- **"Parity" is a retired framing.** The repo was once oriented toward OpenAI/Codex feature parity; it is now
  an **Anthropic-native runner lab** focused on a minimal core with explicit opt-ins.
- **All P0-01 … P0-12 runtime-concordance items are CLOSED** (last three on 2026-07-18/19). Any doc describing
  them as open is stale. Note `CLAUDE.md` itself carried that error for six days until it was corrected today.
- **Two adversarial "permission safaris" have run** against the runner's permission system. Safari 2 (run by
  **Codex**, rounds A–P) found a symlink gap that is **still unremediated**. There are two known live
  path-safety gaps right now. Start here: `HANDOFF-safari-3-remediation-plan-2026-07-25.md`.
- **There are two colliding `P0` namespaces** in `docs/`: the closed `P0-01…P0-12` series, and an
  `FD-01…FD-05` band that a 07-22 handoff *also* labels P0. Say `FD-01` when you mean `FD-01`.

**Also know this about your own position:** `.cursor/**` is **not visible to Claude Code or Codex.** They do
not load your rules, skills, or agent definitions. So a stale primitive in `.cursor/` degrades *your* work
specifically, and no other agent can see or correct it. That is why this audit is yours to run.

---

## 4. Verified inventory (2026-07-25)

20 files. Reproduce with `find .cursor -type f` from the repo root in a terminal.

| Path | Size | Modified | Kind |
| --- | --- | --- | --- |
| `.cursor/settings.json` | 200B | Jul 9 | **Live config** — enables 3 plugins |
| `.cursor/rules/anthropic-primary-sources.mdc` | 2.8K | May 26 | **Live rule** (auto-applied) |
| `.cursor/agents/runner-command-builder.md` | 8.8K | May 26 | **Live agent definition** |
| `.cursor/skills/anthropic-official/SKILL.md` | 5.5K | May 28 | **Live skill** |
| `.cursor/skills/anthropic-official/sources.md` | 4.0K | May 28 | Live skill resource |
| `.cursor/skills/anthropic-official/surfaces.md` | 2.2K | May 26 | Live skill resource |
| `.cursor/skills/anthropic-platform-expert/SKILL.md` | 4.7K | May 28 | **Live skill** |
| `.cursor/skills/runner-command-builder/SKILL.md` | 3.2K | May 26 | **Live skill** |
| `.cursor/skills/oauth-evidence/SKILL.md` | 4.9K | May 25 | **Live skill** |
| `.cursor/skills/lab-integrator/SKILL.md` | 2.5K | May 25 | **Live skill** |
| `.cursor/skills/parity-archivist/SKILL.md` | 4.5K | May 26 | **Live skill** — name references retired framing |
| `.cursor/skills/observability-scribe/SKILL.md` | 3.5K | May 25 | **Live skill** |
| `.cursor/plans/harness_hardening_roadmap_*.plan.md` | 38K | May 24 | Historical plan |
| `.cursor/plans/beyond_perf_parity_lab-notes_*.plan.md` | 31K | May 25 | Historical plan |
| `.cursor/plans/phase_3_critique_*.plan.md` | 14K | Jul 10 | Historical plan (newest) |
| `.cursor/plans/runner-top-agent-roadmap_*.plan.md` | 5.4K | May 24 | Historical plan |
| `.cursor/hooks/state/continual-learning.json` | 218B | Jul 21 | **Live machinery state** |
| `.cursor/hooks/state/continual-learning-index.json` | 8.6K | Jul 19 | **Live machinery state** |
| `.cursor/.DS_Store` | 10K | Jul 19 | macOS junk |
| `.cursor/skills/.DS_Store` | 10K | Jul 8 | macOS junk |

**Note the shape:** 8 live skills + 1 live agent + 1 live rule + 1 live config = **11 primitives that affect
your behavior right now**, nearly all from May. Only 4 files are historical plans.

---

## 5. Verified findings

Reproduce all of these from the repo root in a terminal.

### 5a — Four files reference retired profile/agent flags

```bash
grep -rln -- "--profile\|--agent\b\|--list-agents\|--list-profiles" .cursor
```

Hits:

- `.cursor/agents/runner-command-builder.md` ← **LIVE agent definition**
- `.cursor/skills/runner-command-builder/SKILL.md` ← **LIVE skill**
- `.cursor/plans/harness_hardening_roadmap_*.plan.md` (historical)
- `.cursor/plans/beyond_perf_parity_lab-notes_*.plan.md` (historical)

**Why this is the highest-priority finding:** the first two are live. If Alan invokes the
`runner-command-builder` skill or agent, it may hand him CLI flags that **no longer exist**, and the runner
will reject them. `AGENTS.md` explicitly says these flags must not be restored. This has a plausible claim to
being one of the "stale primitives" that Alan says have negatively impacted every agent working here.

**Epistemic caution:** the `--agent\b` pattern can produce false positives (it would match `--agents`, or
prose using the word). **Verify each hit in context** before concluding it is stale. Do not report a file as
broken because a regex matched it.

### 5b — Thirteen of twenty files mention OpenAI-compatible or "parity" concepts

```bash
grep -rlnE "chat/completions|/v1/models|openai|OpenAI|parity" .cursor
```

Thirteen files hit, including **every skill**. But this grep proves only that *the term appears* — not that
the document is stale.

**Triage each into one of three buckets, and do not skip this step:**

- **Legitimately mentions OpenAI** — e.g. `anthropic-official` or `anthropic-platform-expert` may reference
  other providers for comparison or to say "do not use this." Keep as-is.
- **Historically about parity** — describes a goal the repo has since abandoned. This is *accurate history*.
  Preserve; mark as historical.
- **Instructs you to do something now-forbidden** — tells you to build, restore, or test an
  OpenAI-compatible surface. **This is the harmful category.** `parity-archivist` is the most likely
  candidate given its name, but confirm by reading it rather than assuming.

### 5c — Nothing in `.cursor/` knows about the last week

```bash
grep -rlniE "safari|FD-0|P0-1[012]|symlink" .cursor   # returns nothing
```

Zero hits. Your loaded context has no awareness of the permission safaris, the closed P0 items, or the two
live path-safety gaps. This is a **gap to fill**, not something to delete.

### 5d — Live machinery state

`.cursor/hooks/state/continual-learning.json` last ran around 2026-07-19/21 with `turnsSinceLastRun: 7`.
`continual-learning-index.json` is 8.6K. **Do not delete or hand-edit these** without understanding what the
continual-learning hook does — they are operational state, not documentation. Ask Alan before touching them.

### 5e — Two committed `.DS_Store` files

`.cursor/.DS_Store` and `.cursor/skills/.DS_Store`, 10K each. macOS Finder metadata with no value. Note
`.gitignore` already lists `.DS_Store` and `**/.DS_Store`, so these were committed **before** that rule
existed and are still tracked. Removing them from tracking is safe and uncontroversial — but still confirm,
and note there is a third one at `docs/artifacts/permission-safari-2026-07-21/.DS_Store`.

---

## 6. The triage taxonomy to apply

For each of the 20 files, place it in exactly one bucket and state your evidence:

| Bucket | Meaning | Default action |
| --- | --- | --- |
| **CURRENT** | Accurate and useful today | Leave alone. Note the verification date. |
| **STALE-HARMFUL** | A live primitive that instructs you to do something retired, forbidden, or impossible | **Fix or disable.** Highest priority. |
| **STALE-HISTORICAL** | Accurately describes a past state; no live instruction | **Preserve.** Mark as historical — do not delete. |
| **NEEDS-UPDATE** | Broadly right but missing current reality | Propose a specific patch for Alan to approve. |
| **JUNK** | No informational value in any timeframe (`.DS_Store`) | Propose removal. |
| **UNKNOWN** | You could not determine status | **Say so.** Do not guess. Ask Alan. |

**The distinction that matters most:** STALE-HARMFUL and STALE-HISTORICAL are both "old," and treating them
the same is how you either break history or leave a live landmine in place.

---

## 7. Questions to ask Alan (he expects to be questioned)

Ask these before proposing changes, not after:

1. **Do you still use these skills?** Go through the eight one at a time. A skill Alan never invokes is a
   different problem from one he relies on. `parity-archivist` and `oauth-evidence` in particular sound
   era-specific — are they still part of your workflow?
2. **`runner-command-builder` exists as both an agent and a skill.** Do you use both? Is that duplication
   intentional? This pair is also the one carrying retired flags, so it needs a decision either way.
3. **How do you want stale-but-accurate history marked?** Options worth putting to him, given how much he
   values the original record: a status header added to each file (changes the original), moving them to a
   `.cursor/plans/archive/` subdirectory (preserves bytes exactly, changes the path), or a single external
   index file recording status (**touches no original at all** — likely his preference).
4. **Is the continual-learning hook still active and wanted?** It last ran around Jul 19–21. If it is live,
   its state files are machinery. If it is abandoned, that changes what to do with them.
5. **Are the three plugins in `settings.json` still in use?** `agent-compatibility`,
   `compound-engineering`, `mintlify-cursor-plugin`.
6. **Should `.cursor/` gain a pointer to the shared docs?** Right now nothing in `.cursor/` references
   `AGENTS.md`, the safari work, or the current tracker — so your context starts narrower than it needs to be.

---

## 8. What NOT to do

- **Do not delete anything without per-file approval.** Especially not the `plans/` files — 88K of primary
  record from May, and Alan explicitly values raw originals over tidy summaries.
- **Do not rewrite the four historical plans** to reflect current reality. That destroys their value as
  history. Mark them; do not edit them.
- **Do not edit `AGENTS.md` or `CLAUDE.md` as part of this task.** A separate coordinated pass covers those.
  `CLAUDE.md` was amended today; `AGENTS.md` is deliberately untouched pending that pass. Editing either here
  would create the exact cross-agent divergence this whole exercise exists to eliminate. If you find something
  that belongs in `AGENTS.md`, **write it in your report** and leave the file alone.
- **Do not hand-edit the continual-learning state files** without understanding the hook.
- **Do not conclude a file is stale because a grep matched it.** Read it. Report evidence, not pattern hits.
- **Do not run the standard checks expecting a clean pass and panic.** `npm run format:check` reports
  **pre-existing** Prettier warnings on `package.json` / `package-lock.json` that are unrelated to any change
  you make. On Linux, one bash-tool test fails for platform reasons. Both are documented in `AGENTS.md`.

---

## 9. Deliverable

Produce, for Alan's review:

1. **A triage table** — all 20 files, one bucket each, with the evidence for the classification.
2. **A prioritized action list**, STALE-HARMFUL first, each item marked as needing his approval or not.
3. **Concrete proposed patches** for the STALE-HARMFUL items — actual text, so he can read the change before
   agreeing to it. Start with `runner-command-builder` (agent + skill), since those are live and carry
   retired flags.
4. **A recommendation on the history-marking approach** from question 3, with the trade-offs stated. Note that
   an external index touches no original file, which fits his stated preference for authentic records.
5. **A short list of what `.cursor/` should learn** about current repo reality — the profiles retirement, the
   Anthropic-native direction, the closed P0 series, and the live symlink gaps.
6. **Handoff fields**, per repo convention: folder, branch, files changed, checks run, anything skipped, risks.

**Per Alan's standing preference, write the human-facing version of this report as HTML rather than
Markdown.** He finds HTML easier to read for anything complex.

---

## 10. One framing worth carrying into the audit

This repo is a laboratory for studying how coding-agent harnesses behave — permissions, context, tool safety.
It has spent the past week discovering that its *safety* controls drift when the same rule is enforced in
several places independently.

`.cursor/` is the same failure in the *instruction* layer: eleven live primitives, written across a few days
in May, never revisited as the project's direction changed underneath them. **The lesson transfers.** A rule
written once and never re-verified is not a rule — it is a fossil that still executes. What you are doing is
not cleanup; it is bringing one agent's instruction layer back into agreement with reality, and recording
what you found so it does not silently drift again.

---

**Cross-references:** `AGENTS.md` (shared instructions, your auto-loaded context) ·
`CLAUDE.md` (amended 2026-07-25, not auto-loaded by you, worth reading once) ·
`AGENT-DOCS-DIVERGENCE-2026-07-25.html` (how those two files diverged, and why) ·
`HANDOFF-safari-3-remediation-plan-2026-07-25.md` (the live path-safety findings).
