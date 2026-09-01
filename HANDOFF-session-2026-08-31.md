# Session handoff — 2026-08-31 (Fable → next session)

**Written:** 2026-08-31 by Claude (Fable), at Alan's request, to hand this session's
full context to a future session. **Doc type:** session record + START HERE for the
next agent. When its contents are absorbed into thread handoffs and work moves on,
this file is history — do not treat it as a fourth tracker.

## START HERE (next session)

1. Preflight per `AGENTS.md` (playground clone, `main`, origin
   `alankatanoisi/claude-local-bridge-playground`), then `git pull --ff-only origin main`.
2. Expected clean-ish state: `main` in sync with GitHub through `4e1bd6b` plus this
   file's commit. `.cursor/settings.json` / `.cursor/hooks/state/*` may show dirty —
   that is Cursor's own local state; **ignore it** (Alan's standing instruction
   2026-08-31).
3. Thread entries (one per thread, per charter ground rule 3):
   - **ACP:** `HANDOFF-acp-ask-user-question-2026-08-31.md` (current entry)
   - **Starlark:** `HANDOFF-starlark-status-and-recommendations-2026-08-25.md`
     (bannered: **R8 decided — frozen as a separate lab**)
   - **Team process:** `docs/agent-team-charter-2026-08-25.md` (its thermo-nuclear
     review is CLOSED — all six findings fixed)

## What this session did (all pushed)

1. **Rolled back an accidental commit.** `915ea89` was Alan hastily committing stale
   files from his other laptop (nine `.agents/skills/**` files, a Codex agent config,
   a ride-along Learned bullet). Reverted in `8cfef45` (revert, NOT reset — the other
   laptop reconciles with a plain `git pull`). Tree verified byte-identical to
   `d6bab17`. If any of those skills turn out wanted, they are recoverable from
   history at `915ea89`.
2. **Re-added the one good line** from that commit as its own commit (`1117257`):
   the post-review handoff bullet, mirrored in both Learned blocks.
3. **Closed the charter thermo-nuclear review** (all six findings): `98bf4e6`
   (Medium #1 — concurrency means sessions, not edits), `7ae0cdd` (Medium #2 + Lows
   #4/#5 — baton = local commit, push stays Alan-gated; relay tiers spelled out;
   Cursor auto-loads `.cursor/rules/**` too), `dd166b6` (Medium #3 + Low #6 —
   template defines immutable records; full bridge fence), `e0be363` (CLOSED banner).
   Also `46b895b`: prettier pass on Cursor's two 08-25/26 handoffs (whitespace only).
4. **Starlark R8 decided by Alan: freeze as a separate lab** (`a69c2d0`). No
   `run_workflow` runner edge; no Starlark code in `src/runner/**`. If the lab
   resumes, R11 (kill/resume tests) is the natural next in-lab build — Codex-shaped.
5. **`ask_user_question` fixed and live** (`c39ca6d`) **+ `effort=auto` in T3's
   dropdown** (T3 fork commit `100b3890a`). Full record:
   `HANDOFF-acp-ask-user-question-2026-08-31.md`. Root cause worth remembering: the
   tool was always offered; its own description talked models out of calling it.
   Live-verified on Sonnet 5 + Opus 5 (asked unprompted; dismissed card = no edit,
   no guess). ~$0.50 spent of a $10 authorization.

## Environment facts the next session needs

- **Session-sandbox settings were extended** in `.claude/settings.local.json`
  (personal, not committed): `sandbox.network.allowLocalBinding: true`,
  `allowedDomains: [localhost, 127.0.0.1]` (test suites bind local HTTP servers;
  the bridge lives on `127.0.0.1:11437`), and `sandbox.filesystem.allowWrite` for
  `~/Developer/t3code-bridge-ui` + `~/Developer/t3code/.git` (the T3 fork worktree
  and its git metadata). Without these, ~27 playground tests fail with
  `listen EPERM` and T3 work is read-only. Revertable by deleting the `sandbox` block.
- **Full playground suite is green only with a writable HOME**: a handful of suites
  write `~/.claude-local-bridge/traces/` and similar. Canonical green run:
  `HOME="$TMPDIR/testhome" npm test` → **1050 pass / 0 fail / 1 todo**. Under real
  HOME inside the sandbox, ~18 environmental failures remain (not regressions).
- **Runner processes spawned from the sandbox need a scratch HOME** too
  (`trust.json` lives under `$HOME/.bridge-runner`).
- `openpty` is sandbox-denied — terminal-TTY interactive paths cannot be pty-tested
  from inside a session; hand those to Alan's own Terminal.
- **T3 fork:** `~/Developer/t3code-bridge-ui`, branch `claude/bridge-runner-mock-provider`,
  tip `100b3890a`, local-only (never pushed). `~/Developer/t3code` is the parent
  repo; `t3code-acp-poc` is an older sibling — do not confuse them. Alan's live T3
  app is **port 3773 — never touch**.

## Alan's pending eyeballs (zero-cost, queued by him)

1. Terminal `─── QUESTION ───` prompt: any ambiguous task via
   `node bin/local-bridge-runner.js --cwd <scratch> --trust-workspace --capabilities edits "…"`.
2. T3 question card: next Bridge Runner session in the running app (no rebuild
   needed — the shim execs this checkout's agent).
3. Auto in the reasoning dropdown: needs the T3 dev server/app rebuilt to pick up
   `100b3890a`.

## Recommended next steps (Fable's ranking, none started)

1. **Cursor invariant review of `c39ca6d`** — the charter's own rule: landed runner
   code gets at least one Cursor review. The paste block is in the charter §4;
   range `c39ca6d^..c39ca6d` (or widen to `a69c2d0..4e1bd6b`).
2. **T3 dev server session** for the Auto dropdown + question-card eyeball —
   fun, cheap, and closes the last verification gaps of this slice.
3. **Question-card enrichments** (small, optional): the wire supports multiple
   questions per card and `allowMultiple` is already plumbed; a free-text "Other"
   option is the notable UX gap vs Claude Code's own AskUserQuestion.
4. **Starlark R11 as Codex's first charter brief** (only if Alan wants the frozen
   lab to keep moving): kill/resume/cancel-under-concurrency tests, stays in
   `starlark-host/**`, $0. Draft from `docs/templates/CODEX-TASK-template.md`.
5. **Parked, no urgency:** runner residuals (A1-F4/F5, A3-F4, DBOS arm, HE-05 OTel
   half), `check:agent-docs` mirror-gate script (recommended in CLAUDE.md, unbuilt),
   deciding whether any reverted `.agents/skills/**` content deserves deliberate
   re-landing.

## Standing constraints (unchanged, load-bearing)

- No pushes unless Alan asks (local commits ARE the baton — charter ground rule 2).
- No bridge-internals edits (`src/credentials.js`, `src/proxy.js`, `src/server.js`,
  `src/interceptors/**`) unless clearly needed for runner transport.
- No unsolicited policy/TOS commentary — final owner boundary
  (`docs/agent-user-autonomy-boundary-2026-08-11.md`).
- Never quote `~/.bridge-runner` ledger payload text; aggregates only.
- Do not restore `--agent`/`--profile`. Shell = `--allow-shell` only.
- Live spend needs Alan's explicit ceiling per session. This session's $10
  authorization was for this session only; ~$9.50 was never spent and does NOT
  carry over.
