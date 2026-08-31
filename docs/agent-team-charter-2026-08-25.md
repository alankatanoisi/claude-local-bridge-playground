# Agent Team Charter — the four seats (2026-08-25)

**Doc type:** durable reference. Commissioned by Alan on 2026-08-25 after the Slice D
cycle proved the pattern live; drafted by Claude (Fable).
**What this is:** the default division of labor between Alan and the three coding
agents that work in this repository, plus the handoff rituals that make their work
compose instead of collide.
**What this is NOT:** a gate. Freeform exploratory sessions between Alan and Fable
remain the primary working mode of this playground — the fleet demo, the ACP
(Agent Client Protocol) slices, and most of the best findings here came from
exactly that mode. The charter's job is to make **landed** work safe, not to
bureaucratize exploration. When in doubt, explore first, charter later.

## 1. The seats

| Seat                    | Owns                                                                                                                           | Typical deliverable                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| **Alan** (owner)        | Questions, goals, weirdness direction, approvals, spend, final decisions                                                       | Plain-language intent (paste blocks); decisions at forks  |
| **Fable** (Claude Code) | Exploration, architecture, first working slices, live verification, translating Alan's intent into execution briefs for others | Working prototypes; dated handoffs; `CODEX-TASK-*` briefs |
| **Codex**               | Executing written briefs to the letter, exhaustive test matrices, mechanical sweeps, docs hygiene                              | Landed implementations with full gate evidence            |
| **Cursor**              | Invariant review of landed work ("thermo-nuclear" passes), codebase-consistency audits, harness-native tasks                   | Review handoffs with a fix plan **and a "not bugs" list** |

Alan does not write specifications. He writes intent; **Fable writes the spec.** The
`CODEX-TASK-docs-audit-2026-08-22.md` brief and the Slice D fix cycle are the
reference examples of the interface working.

## 2. The relay

```text
Explore (Fable) → Brief (Fable) → Build (Codex) → Review (Cursor) → Fix (per the
review's own fix order; Fable or Codex) → Record (whoever finishes updates the
thread-entry handoff)
```

**Match stages to risk — most work does NOT run the full relay:**

- **Prototype / throwaway / exploration:** Fable solo (or Alan+Fable live). No relay.
  This is most of the playground, by design.
- **Landed runner code:** at least one Cursor invariant review after it lands
  (the Slice D pattern: build fast + live-verify outcomes, then let a different
  evidence type read the seams).
- **Safety-boundary or bridge/transport changes:** full relay, no exceptions.

Why three agents and not one: they verify with different **evidence types**. Fable
verifies by running things (outcomes), Cursor by reading seams (invariants), Codex
by exhausting the matrix (coverage). None subsumes the others; together they
triangulate.

## 3. Ground rules (all learned the hard way here)

1. **Author never reviews their own work for landing-grade changes.** Reviews go to
   a different agent than the one who wrote the code. Reviews must include a
   "not bugs — do not fix" section so correct decisions survive the pass.
2. **One agent in the checkout at a time; the tree is the baton.** Nobody starts
   until the previous agent's work is committed on local `main` and pointed to by
   a handoff. A push to GitHub is **not** part of the baton — on this machine a
   local commit is a valid handoff target, and pushing stays Alan-gated (agents
   push only when Alan asks). An agent finding a dirty tree on arrival stops and
   asks Alan.
   (Scar tissue: concurrent agents have committed mixed-author work here before.)
3. **One current-entry document per thread.** Every work thread has exactly one
   authoritative "start here" handoff; superseded ones get a dated banner pointing
   forward, with their historical content preserved unchanged (originals are
   immutable records — annotate with banners, never rewrite).
4. **Verification is reported raw.** Real pass/fail output first, always — never
   quietly fix and report as if it passed on the first try.
5. **Deviations from a brief or review are documented, not silent.** If the
   implementer deviates from the letter of a spec (even for good reason), the
   commit message and handoff say so explicitly (example: the M4 `streamed` flag
   deviation in `12f0842`).
6. **Surface awareness.** Claude Code auto-loads `CLAUDE.md`; Cursor auto-loads
   `AGENTS.md` **plus** `.cursor/rules/**` (files Claude Code and Codex never see,
   and which have drifted from current invariants before — see the "Which File
   Loads Where" table in `CLAUDE.md`); Codex auto-loads `AGENTS.md` only.
   Anything every agent must know lives in the mirrored Learned blocks of BOTH
   files, or it does not reliably exist.

## 4. Entry rituals (paste blocks for Alan)

**Codex — execute a brief:**

```text
Read <BRIEF-FILE>.md at the repo root of
/Users/alanman/Developer/claude-local-bridge-playground and do exactly what it
says, in order: preflight + pull first, then the tasks. Follow its hard
constraints. Commit in its suggested shape but do not push until I say so. If
anything is ambiguous, ask me instead of guessing.
```

**Cursor — thermo-nuclear review of landed work:**

```text
Do a thermo-nuclear review of the landed commits <RANGE> in
/Users/alanman/Developer/claude-local-bridge-playground. Review only — change no
code. Write findings to a dated HANDOFF-*-thermo-nuclear-*.md at the repo root:
severity-ranked findings with file/line evidence, a "not bugs (do not fix)"
section, a recommended fix order, and pointers for the implementing agent.
Verify claims against the code, not against the handoffs.
```

**Fable — new brief for Codex:** just tell Fable the intent in plain language; it
drafts the brief from `docs/templates/CODEX-TASK-template.md` and shows you before
you hand it over.

## 5. Related records

- Owner profile and working method: `docs/working-with-alan.md`
- Brief template: `docs/templates/CODEX-TASK-template.md`
- Reference brief (executed): `CODEX-TASK-docs-audit-2026-08-22.md` and its commits
- Reference review cycle (executed): `HANDOFF-acp-slice-d-thermo-nuclear-2026-08-25.md`
  → fixed in `12f0842`
