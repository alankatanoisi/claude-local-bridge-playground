# Agent Lane Index

How to split **lab-notes documentation** work across six Cursor project skills without fighting the OAuth-only harness direction.

## Subagents vs skills (important)

| Kind          | Location                    | Does                                                             |
| ------------- | --------------------------- | ---------------------------------------------------------------- |
| **Skills**    | `.cursor/skills/*/SKILL.md` | Edit owned `lab-notes/` artifacts (research, parity, OAuth docs) |
| **Subagents** | `.cursor/agents/*.md`       | Specialized behavior — **not** the same as skills                |

**Runner command builder** — **Terminal commands only** (not a doc lane).

| File                                             | Role                                                         |
| ------------------------------------------------ | ------------------------------------------------------------ |
| `.cursor/skills/runner-command-builder/SKILL.md` | **Use this** when you invoke `@runner-command-builder`       |
| `.cursor/agents/runner-command-builder.md`       | Full flag reference (agent may read it; still no file edits) |

There is **no** skill named `anthropic-platform-watch` — only the markdown file `lab-notes/parity/anthropic-platform-watch.md` and the **anthropic-platform-expert** skill that owns research on it.

**Invoke (fresh chat, Agent mode):**

```text
@runner-command-builder — commands only, do not edit any files:

[paste your goal, cwd, read-only or allow edits, shell yes/no]
```

Do **not** write `Use runner-command-builder: implement…` without `@` and **commands only** — the main agent may read `anthropic-platform-expert` and edit the doc instead.

If the agent starts editing `lab-notes/` anyway, stop it and repeat with **commands only** in the first line.

## Shared rules

Read **[CHARTER.md](CHARTER.md)** — workspace, hard rules, handoff format, one-file-owner policy.

Quick reminders:

- Folder: `/Users/alanman/Developer/claude-local-bridge-playground`, branch `main`
- OAuth-only evidence harness — [`../OAUTH_ONLY_DIRECTION.md`](../OAUTH_ONLY_DIRECTION.md)
- No API keys, no live bridge, no tests unless Alan asks
- Prefer markdown in `lab-notes/`; bridge code gated in CHARTER
- **Anthropic research lookup order** (see `.cursor/rules/anthropic-primary-sources.mdc`): **WebFetch** official URLs (`docs.anthropic.com`, `code.claude.com/docs`, `support.claude.com`, `github.com/anthropics/*`) first; brief WebSearch **only** to find a permalink, then WebFetch it; **Context7 (ctx7) only** if official fetch fails or Alan explicitly wants indexed snippets — label non-official sources clearly

## Cursor lanes (six skills)

| Lane                      | Skill                                               | Owns                                                                                    | Invoke when                                                                                   |
| ------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Anthropic official        | `.cursor/skills/anthropic-official/SKILL.md`        | `lab-notes/parity/anthropic-official-posture.md`; surface picker in skill `surfaces.md` | Policy citations, Terms, subscription vs API, June 15 metering                                |
| Anthropic platform expert | `.cursor/skills/anthropic-platform-expert/SKILL.md` | `lab-notes/parity/anthropic-platform-watch.md`                                          | Agents SDK, Claude API / Messages API, docs index, changelogs, project-scoped X/public status |
| OAuth evidence            | `.cursor/skills/oauth-evidence/SKILL.md`            | `oauth-headless-demo-runbook.md`, `bench-parity-evidence.md`                            | Demo checklist, golden commands, artifact list (no live runs by default)                      |
| Parity archivist          | `.cursor/skills/parity-archivist/SKILL.md`          | `claude-parity-matrix.md`, `permission-modes.md`, `structured-output.md`                | Adopt/skip/later matrix from HARNESS_VISION + posture + platform watch + code                 |
| Observability scribe      | `.cursor/skills/observability-scribe/SKILL.md`      | `lab-notes/observability/observability-contract.md`                                     | stopReason + stream-json catalog                                                              |
| Lab integrator            | `.cursor/skills/lab-integrator/SKILL.md`            | `weekly-integration.md`, this README, cross-links                                       | After other lanes land files                                                                  |

Bundled references for official lane: `.cursor/skills/anthropic-official/sources.md`, `surfaces.md`.

## Recommended order

1. **anthropic-official** and **anthropic-platform-expert** (parallel OK) — policy seed rows + technical seed rows
2. **oauth-evidence** — runbook + bench template (documents blockers; Alan runs live)
3. **parity-archivist** — matrix cites official posture (policy), platform watch (technical), and code evidence
4. **observability-scribe** — contract supports matrix/autopsy rows
5. **permission-modes** / **structured-output** (parity-archivist)
6. **lab-integrator** — weekly rollup

Policy and technical docs before parity before integration—so the matrix does not guess Anthropic stance or SDK surface.

**Handoff:** anthropic-official ends with **Matrix seed rows** (policy). anthropic-platform-expert ends with **Matrix seed rows (technical)**. Parity archivist merges both.

## Deprecated

`anthropic-claude-expert` was merged into **anthropic-official** for policy/surface picker. **anthropic-platform-expert** is the separate technical lane (SDK/API/docs/X watch)—not a revival of the old expert name.
