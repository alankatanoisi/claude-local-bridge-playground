# Codex task brief — docs audit + within-repo archive (2026-08-22)

**Repo:** `/Users/alanman/Developer/claude-local-bridge-playground` only. NOT the Codex
playground, NOT the T3 fork or worktrees.
**Commissioned by:** Alan, 2026-08-22. Drafted by Claude (Fable) at Alan's request.
**Disposition of this file:** operative instructions. When the task is fully done and
Alan has accepted it, archive this brief along with the rest (it should not outlive its
task at the repo root).

---

## Before anything else

1. Read `docs/working-with-alan.md` and `docs/agent-user-autonomy-boundary-2026-08-11.md`.
2. Run the startup preflight from `AGENTS.md`, then `git pull --ff-only origin main`.
   **The tree must be clean and up to date before you start** — Fable pushed commits on
   2026-08-22 that this task depends on. If the tree is dirty, stop and ask Alan; another
   agent may be mid-flight.
3. Know the current thread state: `HANDOFF-acp-slices-b-c-2026-08-22.md` is the
   authoritative ACP-thread handoff. `HANDOFF-bridge-runner-acp-2026-08-11.md` is
   superseded (banner-marked). Do not "fix" either.

## The task, in three parts

### Part 1 — doc-by-doc audit (read-only)

Walk every document at the repo root and under `docs/` (Markdown and HTML). For each,
record in a single dated audit document (`docs/docs-audit-2026-08-22.md` or `.html`):

- What it is (one line), its date, and its **doc type**: durable reference / live
  instructions (protocol) / dated record (notebook) / handoff / derived artifact /
  stray-noise.
- Whether anything still points at it (CLAUDE.md, AGENTS.md, README, other docs, the
  `scripts/check-doc-defaults.js` and `scripts/check-runner-manifest.js` gates).
- Whether its claims still match the code where cheaply checkable. Do not deep-verify
  every claim; flag suspected rot rather than silently correcting it.
- Your best reading of **where the repo is heading**, synthesized at the end: the audit
  should close with a short "trajectory" section — what the document trail says this
  playground is becoming (e.g. the runner-lab → ACP/T3-provider arc), stated as
  Codex's independent read, not a paraphrase of Fable's handoffs.

### Part 2 — archive the noise (move-only, content-untouched)

- Create `docs/archive/unsorted-2026-08-22/` and MOVE stray/noisy/superseded loose files
  into it. Moves must preserve content byte-for-byte — **never edit, reformat, annotate,
  or "improve" an original**. Alan's rule: originals are immutable records.
- Candidates: dated one-off records with no inbound references, derived `.html` twins
  whose `.md` master is authoritative (check CLAUDE.md's warnings about which twin is
  authoritative before assuming), completed handoffs older than the current thread state.
- NOT candidates (leave in place): `README.md`, `SECURITY.md`, `CLAUDE.md`, `AGENTS.md`,
  `CONTEXT.md`, `docs/working-with-alan.*`, the autonomy-boundary docs, the current
  handoff `HANDOFF-acp-slices-b-c-2026-08-22.md`, the superseded-but-banner-marked
  08-11 ACP handoff, anything the check scripts read
  (`docs/command-builder.html`, `docs/runner-quickstart.html`, threat model), and the
  concordance tracker `docs/runner-runtime-concordance-assessment-2026-07-17.html`.
- Every move goes into a move ledger inside the archive folder
  (`docs/archive/unsorted-2026-08-22/MOVED.md`): old path → new path, one line each.
- If a moved file is referenced somewhere that must keep working, update the REFERENCE
  (a pointer is not an original), or don't move the file. When in doubt, don't move.
- After moving, all four gates must pass: `npm test`, `npm run lint`,
  `npm run check:docs`, `npm run format:check`. If a gate breaks, the move that broke it
  gets reverted or its references fixed — never the gate.

### Part 3 — draft recalibrated agent docs (propose, don't replace)

Draft updated agent-facing docs as NEW dated proposal files (e.g.
`docs/proposals/agent-docs-recalibration-2026-08-22.md`) rather than overwriting
`CLAUDE.md`/`AGENTS.md` wholesale. Goals: shrink stale narrative, keep every safety
invariant, keep the Learned blocks mirrored between `CLAUDE.md` and `AGENTS.md`
(the mirroring rule is load-bearing — see the note inside CLAUDE.md), and make the
Current Work Thread section pointers-only, as it already demands of itself.
Small surgical edits to CLAUDE.md/AGENTS.md are allowed where a fact is simply wrong,
but structural rewrites wait for Alan's approval of the proposal.

## Hard constraints

- Runner code, tests, `bin/`, `src/`, `starlark-host/` source: **out of scope, do not
  touch.**
- No unsolicited policy/Terms-of-Service commentary — final owner boundary, see
  `docs/agent-user-autonomy-boundary-2026-08-11.md`.
- No pushes without Alan's word. Suggested shape: one commit for the audit doc, one for
  the archive moves (git preserves history across moves; `git log --follow` still works),
  one for the proposals — then ask Alan before pushing.
- Never quote ledger/transcript payload text from `~/.bridge-runner` if you go looking at
  runtime state; aggregate counts only.
- End with the standard handoff block (folder, branch, files changed, checks run,
  skipped, risks/next steps).

## Paste-block prompt for Alan

```text
Read CODEX-TASK-docs-audit-2026-08-22.md at the repo root of
/Users/alanman/Developer/claude-local-bridge-playground and do exactly what it
says, in order: preflight + pull first, then the three parts. Move-only
archiving — never edit an original document's content. Commit in the suggested
three-commit shape but do not push until I say so. If anything is ambiguous,
ask me instead of guessing.
```
