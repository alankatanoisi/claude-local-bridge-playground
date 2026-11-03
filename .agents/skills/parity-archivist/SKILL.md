---
name: parity-archivist
description: >-
  Maintains Claude Code parity lab-notes—claude-parity-matrix.md (adopt/skip/later +
  evidence), permission-modes.md, structured-output.md—from HARNESS_VISION and runner
  code. Use when Alan asks for parity matrix, permission mode mapping, or structured
  output design vs runner today.
---

# Parity Archivist

Maps **Claude Code / Agent SDK expectations** to **playground runner reality** in `lab-notes/parity/`. Policy facts come from **anthropic-official** seed rows; technical doc facts from **anthropic-platform-expert** seed rows—do not invent Anthropic stance here.

## When to use

- Create or extend `lab-notes/parity/claude-parity-matrix.md`
- Write `lab-notes/parity/permission-modes.md` (CC modes → CLI flags → `permissions.js`)
- Write `lab-notes/parity/structured-output.md` (design-only schema parity)
- Adopt / skip / later decisions with evidence column

## When not to use

- Official policy citation sweeps (**anthropic-official**)
- SDK/API/docs/X watch sweeps (**anthropic-platform-expert**)
- Live demo commands or bench numbers (**oauth-evidence**)
- Stream-json event catalog (**observability-scribe**)
- Weekly cross-link rollup (**lab-integrator**)

## Charter

Read [`lab-notes/agents/CHARTER.md`](../../lab-notes/agents/CHARTER.md).

## File ownership (this lane only)

| File | Scope |
| ---- | ----- |
| `lab-notes/parity/claude-parity-matrix.md` | Master matrix |
| `lab-notes/parity/permission-modes.md` | Mode ↔ flags ↔ code |
| `lab-notes/parity/structured-output.md` | Spike / design-only |

Do **not** edit `anthropic-official-posture.md`, `anthropic-platform-watch.md`, `oauth-headless-demo-runbook.md`, or `observability-contract.md` in the same session unless Alan merges lanes.

## Read first

1. `lab-notes/HARNESS_VISION.md` (especially parity / gap tables)
2. `lab-notes/parity/anthropic-official-posture.md` (if present; else note blocked on official lane)
3. `lab-notes/parity/anthropic-platform-watch.md` (if present; else note blocked on platform lane)
4. `src/runner/permissions.js`, `bin/local-bridge-runner.js` (flags)
5. `src/runner/kernel/contract.js` (`STOP_REASONS`, `KERNEL_EVENT_TYPES`)
6. `docs/threat-model.md` (safety invariants for permission rows)

## Workflow

1. Confirm matrix seed rows exist in official posture (or document `blocked: no seed rows`).
2. Audit runner: grep `permissions`, `--plan`, `--accept-edits`, `--allow-shell`, coordinator paths.
3. For each capability row, pick **adopt | skip | later** with **evidence** (test path, file:line, or `none`).
4. Update matrix; then permission-modes or structured-output if in scope.
5. Hand off per CHARTER.

## Matrix row schema (required columns)

| Column | Content |
| ------ | ------- |
| Capability | Short name (e.g. `permission-mode:plan`) |
| Claude Code / SDK reference | Doc link or behavior note |
| Playground status | `wired` / `partial` / `lab-only` / `missing` |
| Decision | `adopt` / `skip` / `later` |
| Evidence | `test/runner/...`, `src/runner/...`, or `lab-notes/...` |
| Policy note | From official posture only, or `n/a` |

## Matrix starter (copy into deliverable)

```markdown
# Claude parity matrix (playground)

Last updated: YYYY-MM-DD
Sources: HARNESS_VISION.md, anthropic-official-posture.md

| Capability | CC/SDK reference | Playground status | Decision | Evidence | Policy note |
| ---------- | ---------------- | ----------------- | -------- | -------- | ----------- |
| … | … | … | … | … | … |
```

## Permission modes doc skeleton

```markdown
# Permission modes (Claude Code → runner)

| CC concept | Runner CLI | Code anchor | Notes |
| -------- | ---------- | ----------- | ----- |
| default / ask | (no --dont-ask) | permissions.js | … |
| accept edits | --accept-edits | … | … |
| bypass permissions | --dont-ask (not shell) | … | Shell still needs --allow-shell |
```

## Structured output doc skeleton

Mark every section **design-only** until wired in `run.js` / model client. Compare Anthropic structured output docs to current message schema; list blockers (schema validation, tool loop).

## Code anchors

| Topic | Path |
| ----- | ---- |
| Main loop | `src/runner/run.js` |
| Permissions | `src/runner/permissions.js` |
| CLI | `bin/local-bridge-runner.js` |
| Kernel stops | `src/runner/kernel/contract.js` |
| Coordinator | `src/runner/coordinator.js` |

## Handoff

- **oauth-evidence** — when matrix shows `missing` items that need live proof
- **observability-scribe** — when matrix rows need stream-json / stopReason evidence
- **lab-integrator** — after matrix v1 lands
