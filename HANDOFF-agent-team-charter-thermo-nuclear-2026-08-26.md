# Handoff — Thermo-nuclear review of the four-seat charter (`e8f9297`, 2026-08-26)

> **CLOSED 2026-08-31 — all six findings fixed** (Fable), in this file's recommended
> order: Medium #1 in `98bf4e6` (concurrent-sessions bullet reconciled with
> tree-is-the-baton), Medium #2 + Low #4 + Low #5 in `7ae0cdd` (baton = local
> commit, push stays Alan-gated; relay tiers spelled out in the mirrored bullet;
> ground rule 6 names `.cursor/rules/**`), Medium #3 + Low #6 in `dd166b6`
> (template defines immutable records; full bridge fence). Learned blocks
> re-verified bullet-identical after each edit. Findings text below preserved
> unchanged.

**Written:** 2026-08-26. Review only; no source changed except this file.
**Scope:** already-landed playground `main` commit `e8f9297` (`e8f9297^..e8f9297`). No feature branch, no pull request.
**Diff:** `AGENTS.md` (+1 Learned bullet), `CLAUDE.md` (+1 matching Learned bullet), new `docs/agent-team-charter-2026-08-25.md` (105 lines), new `docs/templates/CODEX-TASK-template.md` (76 lines). Docs-only; no `src/`, `test/`, `bin/`, or package scripts.
**Verified against:** the current tree at `e8f9297` (`origin/main`), not against prior handoffs. Cited historical files were opened only to check whether _this_ commit's pointers resolve.

There are **no High** findings. This commit does not change runtime, credentials, ports, feature flags, or developer build steps. The issues below are auto-loaded instruction collisions that will make later agents stop, double-write, or refuse legitimate edits.

## Findings (in-scope for `e8f9297` only)

### High

None.

### Medium

1. **Auto-loaded Learned block now contradicts itself on concurrent work.**
   `AGENTS.md` line 243 (unchanged by this commit, still in the same list the new bullet joined) says agents "work in this repo concurrently" and that docs must stay synchronized across surfaces. The new bullet at `AGENTS.md` line 248 / `CLAUDE.md` (same bullet, mirrored) says "the tree is the baton (start only on a clean, pulled `main`)." Charter ground rule 2 (`docs/agent-team-charter-2026-08-25.md` lines 54–57) is stricter still: "One agent in the checkout at a time" and "Nobody starts until the previous agent's work is committed, pushed, and pointed to by a handoff."
   Those two instructions now sit in the **same auto-loaded list** with no reconciling sentence. Cursor and Codex load `AGENTS.md`; Claude Code loads `CLAUDE.md`. An agent can honestly pick either rule. The charter's own scar-tissue note (line 57) is that concurrent agents have already committed mixed-author work here — leaving the old concurrent bullet unmodified is how that happens again.
   These _can_ be true together (sessions exist on three surfaces; only one writer holds the working tree). The commit never says that.

2. **Ground rule 2 requires a push; the Codex paste block and template forbid pushing.**
   Charter ground rule 2 (`docs/agent-team-charter-2026-08-25.md` lines 54–56): next agent must not start until the previous work is "committed, **pushed**, and pointed to by a handoff."
   Charter §4 Codex paste block (lines 80–81): "Commit in its suggested shape but **do not push until I say so.**"
   Template (`docs/templates/CODEX-TASK-template.md` lines 75–76): "Commit but **do not push until Alan says so.**"
   This is an in-commit contradiction, not a clash with older docs. If Codex follows the paste block, Cursor following ground rule 2 must refuse to start the review until Alan separately authorizes a push. If Cursor follows the paste-block review ritual ("landed commits") on the local tree, it violates ground rule 2. Alan's existing rule in `AGENTS.md` line 200 / Learned line 239 is already "push when he asks." Ground rule 2 silently upgraded that to a relay precondition.

3. **Template promotes a docs-archive rule to a keep-always hard constraint without defining "original record."**
   Template HOWTO (`docs/templates/CODEX-TASK-template.md` lines 7–9) says keep the Hard constraints section on every brief. One of those bullets (line 39) is "Never edit an original record's content; annotate with dated banners only."
   That sentence was the move-only rule from `CODEX-TASK-docs-audit-2026-08-22.md` (lines 45–46, 77–78), where source/`src/` was separately fenced **out of scope**. Charter ground rule 3 (lines 58–61) defines the thing that is immutable: superseded **handoffs**, banner-annotated, content preserved. The reusable template never restates that definition.
   Codex's kickoff paste says "do exactly what it says." A filled code brief that keeps this bullet can be read as "do not edit existing files." That is the wrong fence for an execute-the-runner-slice task.

### Low

4. **Learned-bullet compression overstates when the full relay is required.**
   New Learned bullet (`AGENTS.md` line 248): "Full relay only for landed or safety-boundary work."
   Charter §2 (`docs/agent-team-charter-2026-08-25.md` lines 37–42) splits three cases: prototype = no relay; **landed runner code** = at least a Cursor invariant review after landing (Fable may have built it); **safety-boundary / bridge-transport** = full relay, no exceptions.
   "Full relay only for X" is meant to exclude exploration. It is easy to misread as "landed work always runs Codex brief → build → Cursor." That would force a Codex pass onto slices Fable already landed, which the charter does not require. This bullet is what every agent auto-loads; the finer split lives only in the charter file they may not open.

5. **Ground rule 6 understates Cursor's auto-load set.**
   Charter lines 68–70: "Claude Code auto-loads `CLAUDE.md`; Cursor and Codex auto-load `AGENTS.md`."
   `CLAUDE.md` lines 14–18 (table, not part of this diff, checked because the new rule restates it): Cursor auto-loads `AGENTS.md` **and** `.cursor/rules/**`, and does **not** auto-load `CLAUDE.md`. The same table warns that as of 2026-07-25 several `.cursor/**` primitives contradict current invariants.
   Ground rule 6's payload ("anything every agent must know lives in the mirrored Learned blocks") is still the right rule. Omitting `.cursor/rules/**` makes Cursor look like Codex. A Cursor session will still have those rules in context; they can fight the charter without the charter naming them.

6. **Template's standing fence is looser than `AGENTS.md` Boundaries.**
   Template lines 42–44: do not restore `--agent` / `--profile`; do not edit `src/credentials.js`; "interceptors" only if the brief says so.
   `AGENTS.md` lines 127–131 (and `CLAUDE.md` ~158–164): the fence is `src/credentials.js`, `src/proxy.js`, `src/server.js`, `src/interceptors/**`, **and** VS Code extension auth settings. Retired flags in `AGENTS.md` also include `--list-agents` and `--list-profiles`.
   A filled brief that copies the template literally can leave `src/interceptors/**` and extension auth settings unnamed. Low because the fill-in SCOPE FENCE is supposed to tighten this per task — it will not, unless Fable remembers.

## Not bugs (do not “fix”)

- Docs-only commit: no runtime, credential, port, feature-flag, or `package.json` script change. `npm run check:docs` and `npm run format:check` both passed on this tree (2026-08-26).
- Learned User Preferences (17 bullets) and Learned Workspace Facts (5 bullets) **match** between `AGENTS.md` and `CLAUDE.md`. The commit message's "mirror verified bullet-for-bullet" claim is true.
- Cited files exist: `docs/working-with-alan.md`, `docs/agent-user-autonomy-boundary-2026-08-11.md`, `CODEX-TASK-docs-audit-2026-08-22.md`, `HANDOFF-acp-slice-d-thermo-nuclear-2026-08-25.md`. Commit `12f0842` exists. The M4 `streamed` deviation the charter cites is in `src/runner/run.js` lines 1784–1789 (`streamed: streamingActive` so `finish()` does not reprint onto hosted stdout). Do not "correct" that citation.
- T3 port **3773** in the template is an existing operator constraint (same number in `HANDOFF-acp-status-and-recommendations-2026-08-25.md` and earlier ACP handoffs), not a remapped repo port. The runner/bridge default remains `localhost:11437` (`scripts/check-doc-defaults.js`).
- Markdown (not HTML) for the charter is correct: §4 is paste blocks, and the existing HANDOFF / `CODEX-TASK-*` convention is Markdown. Do not add an HTML twin just to satisfy the "plans as HTML" preference.
- "What this is NOT: a gate" and freeform Alan+Fable as the default mode are intended. Do not turn the relay into a required workflow for exploration.
- Template still requiring `npm test` / lint / `check:docs` / `format:check` on docs-only tasks is intended (`docs/templates/CODEX-TASK-template.md` line 59). The 2026-08-22 docs-audit brief needed those gates because moves break them.
- `CODEX-TASK-docs-audit-2026-08-22.md` still sitting at the repo root (the template says archive accepted briefs) is **pre-existing**, not introduced here. Citing it as the executed reference is accurate. Do not archive it as part of a charter fix unless Alan asks.
- Ground rule 1 ("author never reviews their own work") is why this file exists. Fable drafted the charter; Cursor is the other evidence type. Do not treat this review as a violation of the rule it is applying.
- `format:check`'s prettier glob is `"*.md"` at repo root only, so `docs/agent-team-charter-2026-08-25.md` and `docs/templates/CODEX-TASK-template.md` are not format-gated. Pre-existing glob; do not expand prettier as part of this fix unless Alan wants that separately.
- No feature-flag leak, no secret-path change, no new environment variable, no interceptors/credentials edit.

## Recommended fix order

Stay in the four files this commit touched. Do not touch `src/`, tests, or bridge internals.

1. **Medium #1** — In both Learned blocks, qualify the old concurrent bullet (or the new one, or both) so they cannot be read as opposite orders. Suggested shape: concurrent _sessions/surfaces_ are expected; exclusive _write lock_ on the playground checkout (`git status` clean, `main` pulled) before an agent starts edits. Keep the two Learned blocks byte-for-bullet identical.
2. **Medium #2** — Split "landed for the next agent" from "pushed to GitHub." Local `main` commit + handoff pointer is enough for Cursor to start a review on this machine. Push remains Alan-gated (`AGENTS.md` line 200). Update charter ground rule 2, and make the Codex paste block / template agree with that sentence.
3. **Medium #3** — In the template Hard constraints, replace the bare "original record" bullet with the charter's definition: dated handoffs / notebooks / original records are banner-annotated, never rewritten. Source, tests, and living files (`AGENTS.md`, `CLAUDE.md`, runner code) are editable when the brief's scope fence says so. Keep the HOWTO's "keep Hard constraints" instruction only if this bullet is safe to copy into a code brief.
4. **Low #4** — One clause in the Learned charter bullet: landed _runner_ code needs a Cursor invariant review after it lands; full Explore→Brief→Build→Review is for safety-boundary / bridge-transport only. Mirror into `CLAUDE.md`.
5. **Low #5** — Charter ground rule 6: add that Cursor also auto-loads `.cursor/rules/**`, and that those files are not visible to Claude Code or Codex (already in `CLAUDE.md` lines 14–28). Point at the Learned blocks as the only shared source of truth.
6. **Low #6** — Template standing fence: copy `AGENTS.md` Boundaries names (`src/proxy.js`, `src/server.js`, `src/interceptors/**`, VS Code extension auth settings) and retired flags (`--list-agents`, `--list-profiles`). Leave the per-task SCOPE FENCE as the fill-in.

## Pointers for the implementing agent

- Preflight: folder `/Users/alanman/Developer/claude-local-bridge-playground`, branch `main`, `origin` = `alankatanoisi/claude-local-bridge-playground`. `git pull --ff-only origin main` if the tree is still clean. If it is dirty, stop (that is ground rule 2, correctly applied).
- Edit only: `AGENTS.md`, `CLAUDE.md`, `docs/agent-team-charter-2026-08-25.md`, `docs/templates/CODEX-TASK-template.md`. After any Learned-bullet change, diff the two Learned sections bullet-for-bullet before handing off (no `check:agent-docs` script exists yet; this is still manual).
- Checks: `npm run check:docs` and `npm run format:check` are enough for this docs-only fix. `npm test` / `npm run lint` are optional unless a later instruction expands scope. `format:check` will **not** see the two files under `docs/`; that is expected.
- Do not restore `--agent` / `--profile`. Do not edit `src/credentials.js`, `src/proxy.js`, `src/server.js`, or `src/interceptors/**`. Do not archive `CODEX-TASK-docs-audit-2026-08-22.md` unless Alan asks. Do not add an HTML twin of the charter.
- Commit/push only if Alan asks.

## Suggested commit shape (if asked)

One commit: `docs: reconcile charter relay rules (checkout lock vs push vs original-record fence)`.
