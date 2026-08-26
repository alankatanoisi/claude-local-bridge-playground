# Codex task brief — <TASK NAME> (<YYYY-MM-DD>)

<!--
TEMPLATE (docs/templates/CODEX-TASK-template.md). How to use:
  1. Copy to the repo root as CODEX-TASK-<slug>-<date>.md (root = easy to point at;
     archive it once the task is accepted — a brief should not outlive its task).
  2. Fill every <angle-bracket> slot. Delete sections that genuinely do not apply,
     but keep "Before anything else", "Hard constraints", and "Definition of done" —
     those three are what make a brief executable to the letter.
  3. Hand Alan the paste block from the charter (docs/agent-team-charter-2026-08-25.md §4).
Reference example of a completed, executed brief: CODEX-TASK-docs-audit-2026-08-22.md.
-->

**Repo:** `/Users/alanman/Developer/claude-local-bridge-playground` only. <ADJUST IF NOT>
**Commissioned by:** Alan, <DATE>. Drafted by <AGENT> at Alan's request.
**Disposition of this file:** operative instructions. When the task is done and Alan
has accepted it, archive this brief (it should not outlive its task at the repo root).

---

## Before anything else

1. Read `docs/working-with-alan.md` and `docs/agent-user-autonomy-boundary-2026-08-11.md`.
2. Run the startup preflight from `AGENTS.md`, then `git pull --ff-only origin main`.
   **The tree must be clean and up to date before you start.** If it is dirty, stop
   and ask Alan — another agent may be mid-flight (charter ground rule 2).
3. Current thread state you must not re-derive: <LIST THE AUTHORITATIVE HANDOFF(S)>.

## The task

<NUMBERED PARTS. For each part: exactly what to produce, where it goes, and what
"done" looks like for that part. Name concrete files. If a part is conditional,
say on what. If ordering matters, say so — Codex executes in the order written.>

## Hard constraints

- <SCOPE FENCE: directories/files that are OUT of scope — e.g. "src/ and test/ are
  out of scope; docs only" or "stay in src/runner/\*\* + tests">
- Never edit an original record's content; annotate with dated banners only.
- No unsolicited policy/Terms-of-Service commentary (final owner boundary — see the
  autonomy record above).
- Do not restore retired concepts (`--agent`, `--profile`); do not edit
  `src/credentials.js`; bridge internals (`src/proxy.js`, `src/server.js`,
  interceptors) only if the brief explicitly says so.
- Never quote `~/.bridge-runner` ledger/transcript payload text; aggregates only.
- Alan's live T3 app is port 3773 — never touch it; never kill processes by
  pattern match.
- <TASK-SPECIFIC CONSTRAINTS>

## Gates — all must pass before handoff

```bash
npm test            # expect <N> pass / 0 fail (state the baseline you inherited)
npm run lint
npm run format:check
npm run check:docs
```

<IF THE TASK IS DOCS-ONLY, THE GATES STILL RUN — moves and renames can break them.>
If a gate breaks, fix the cause or revert the change that broke it — never the gate.

## Definition of done

- <MEASURABLE ACCEPTANCE ITEMS — the exhaustive checklist Codex is good at. Prefer
  assertions over vibes: file X exists with Y, test Z passes, no references to W remain.>
- End with the standard handoff block: folder, branch, files changed, checks run
  (real output), anything skipped, risks/next steps.
- Report verification raw: real pass/fail first; never quietly fix and report as if
  it passed on the first try (charter ground rule 4).
- If you deviated from this brief anywhere, say exactly where and why (charter
  ground rule 5) — deviation with disclosure is fine; silent deviation is not.

## Commit shape

<SUGGESTED COMMIT(S) WITH conventional-commit MESSAGES.> Commit but **do not push
until Alan says so** (unless Alan's kickoff message already authorized push).
