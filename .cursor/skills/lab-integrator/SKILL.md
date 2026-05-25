---
name: lab-integrator
description: >-
  Keeps playground lab-notes aligned—weekly-integration.md rollups, cross-links between
  parity/observability/oauth docs, agents README freshness. Use when Alan asks for weekly
  lab summary, doc index cleanup, or integration note after multiple lanes landed files.
---

# Lab Integrator

**Editor-of-record for cross-cutting lab-notes**—not for deep content in parity/observability/oauth files owned by other lanes.

## When to use

- Create or append `lab-notes/weekly-integration.md`
- Fix broken cross-links between `lab-notes/parity/*`, `lab-notes/observability/*`, `lab-notes/agents/*`
- Refresh `lab-notes/agents/README.md` lane table after skill changes
- Short index sections in `lab-notes/HARNESS_VISION.md` (links only, not rewrites)

## When not to use

- First draft of parity matrix, official posture, or observability contract (owner lanes)
- Live OAuth runs or bridge code
- Rewriting policy claims without **anthropic-official** sources

## Charter

Read [`lab-notes/agents/CHARTER.md`](../../lab-notes/agents/CHARTER.md).

## File ownership

| File | Scope |
| ---- | ----- |
| `lab-notes/weekly-integration.md` | Dated rollups |
| `lab-notes/agents/README.md` | Lane index (with CHARTER link) |

Touch other `lab-notes/**` only to add **Links** sections or fix URLs—do not change adopt/skip decisions or policy tables owned elsewhere.

## Workflow

1. List files changed since last weekly entry (`git log --since` or Alan's list).
2. For each lane, one bullet: path + one-sentence outcome + blocker if any.
3. Add **Recommended next lane** (skill name from `.cursor/skills/*/SKILL.md`).
4. Verify README table matches five skills (no deprecated expert row).
5. Hand off per CHARTER.

## Weekly entry template

```markdown
## YYYY-MM-DD

**Theme:** (one line)

| Lane | Outputs | Blocked |
| ---- | ------- | ------- |
| anthropic-official | lab-notes/parity/anthropic-official-posture.md | … |
| oauth-evidence | … | … |
| parity-archivist | … | … |
| observability-scribe | … | … |
| lab-integrator | this entry | — |

**Next:** invoke `<skill-name>` for …

**Links added:** (paths only)
```

## Lane index snippet (keep README in sync)

Five Cursor project skills under `.cursor/skills/`:

1. `anthropic-official`
2. `oauth-evidence`
3. `parity-archivist`
4. `observability-scribe`
5. `lab-integrator`

Shared rules: `lab-notes/agents/CHARTER.md`.

## Handoff

Usually none—integrator runs last. If a lane is starved, name the skill Alan should invoke next.
