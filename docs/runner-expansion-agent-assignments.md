# Runner expansion — agent assignment blocks

Ready-to-paste prompts for **Claude Code Cloud**, **Codex**, **Cursor**, or other coding agents working on
[claude-local-bridge-playground](https://github.com/alankatanoisi/claude-local-bridge-playground).

**Source of truth:** [runner-expansion-roadmap.md](./runner-expansion-roadmap.md) (especially **§13**).

Copy **Block 0** (shared preamble) + **one assignment block** per session. Do not assign multiple blocks that touch
`permissions.js` / `run.js` in parallel without coordination.

---

## Sequencing at a glance

| Order | Block | Roadmap | Effort | Parallel-safe with |
| ----- | ----- | ------- | ------ | ------------------ |
| 1 | A | §4.5 `cc undo last-run` | Small | B |
| 2 | B | §4.6 Prompt-template registry | Small–Med | A |
| 3 | C | §5.8 Golden-transcript evals | Medium | — (do before D/E) |
| 4 | D | §5.9 Budget telemetry + token caps | Medium | — (after C) |
| 5 | E | §6.1 Composable tool profiles | Large | — (after C) |
| 6 | F | §5.2 Parallel worktree orchestration | Medium | G, H, I |
| 7 | G | §5.4 Background bash + polling | Medium | F, H, I |
| 8 | H | §5.5 `skill` execution tool | Medium | F, G, I |
| 9 | I | Executable hooks (§11 hooks table) | Medium | F, G, H |
| 10 | J | §4.4 `read_file` paging | Small | — |
| 11 | K | §4.3 `ask_user_question` | Medium | — |

**Never assign:** §7 network tools (`WebFetch`, `WebSearch`, MCP) until egress policy is designed.

**Cloud mega-sessions (burn usage safely):**

- **Phase 1 bundle:** Block A + Block B in one session (recovery + prompt registry).
- **Evals then ops:** Block C alone, then Block D in a follow-up.
- **Phase 2 harness bundle:** Blocks F + G + H + I only after Phase 1 is merged; expect a large diff — prefer one block per session if conflicts appear.

---

## Block 0 — Shared preamble (paste at top of every assignment)

```text
Repository: https://github.com/alankatanoisi/claude-local-bridge-playground
Branch: main (create feature/<short-name> from latest main unless told otherwise)
Do NOT work in the canonical repo (alankatanoisi/claude-local-bridge) — playground only.

Read before coding:
1. AGENTS.md and CLAUDE.md
2. docs/runner-expansion-roadmap.md — the slice cited in this task + §13 sequencing
3. docs/threat-model.md — any change that touches tools, permissions, shell, or writes

Boundaries:
- Runner lane: bin/local-bridge-runner.js, src/runner/**, test/runner/**, docs/**
- Do NOT modify bridge/auth unless required for runner transport: src/credentials.js, src/proxy.js, src/server.js, src/interceptors/**

Transport invariants (never break):
- Native POST /v1/messages only; OAuth Bearer upstream; no API-key fallback; no OpenAI-compat routes
- Shell hidden unless --allow-shell; --dont-ask must not enable shell
- Hard deny: .env, .ssh, .aws, .claude, keys, credentials, path escapes
- Writes ask unless --accept-edits; scrub secrets in logs/transcripts/traces

When this task changes CLI or tools, update in the same change set:
- README.md (if user-facing)
- docs/command-builder.html (required for new flags/tools)
- docs/threat-model.md (if safety surface changes)

Checks before handoff:
  node --require ./test/setup.js --test test/runner/*.test.js
  npm run lint
  npm run check:docs

Handoff must include: folder, branch, files changed, checks run, checks skipped, risks/next steps.
Only commit/push if this task explicitly asks you to.

--- CLOUD / HEADLESS VM DISCLAIMERS (Claude Code Cloud, Codex cloud, etc.) ---
- npm install is usually already done on cloud VMs; do not spend time re-installing unless tests fail on missing deps.
- You CANNOT run the VS Code bridge or real OAuth model calls in cloud. Do not claim end-to-end bridge success.
- npm test: expect ONE known Linux-only failure in test/runner/bash.test.js ("reports signal when process is killed") — treat as environment difference, not your regression, if all other tests pass.
- npm run format:check may fail on package.json / package-lock.json Prettier drift — pre-existing; do not reformat those unless the task is formatting.
- For runner loop integration without OAuth: use a local mock HTTP server on --bridge-url http://127.0.0.1:<port>/v1/messages that returns Anthropic Messages JSON (tool_use then text). Headless runs need --trust-workspace.
- Prefer unit tests + mock model client over live api.anthropic.com calls.
- Worktree/git tests: use temp repos in os.tmpdir(); do not assume Alan's Mac paths.
--- END CLOUD DISCLAIMERS ---
```

---

## Block A — §4.5 Recovery workflow (`cc undo last-run`)

```text
[Paste Block 0 above]

TASK: Implement docs/runner-expansion-roadmap.md §4.5 only — cc undo last-run recovery workflow.

Goal: Promote existing backups + undo tools into a single discoverable workflow. Primitives already exist:
- .bridge-runner/backups/ via src/runner/tools/file-write-utils.js
- undo / undo_edit tools

Deliver:
1. Per-run manifest: .bridge-runner/runs/<session-id>/manifest.json (edits + backup paths)
2. CLI subcommands or flags: undo last-run, undo run <session-id>, undo list-runs
3. Revert in reverse edit order with diff preview + confirmation (TTY); safe behavior in non-interactive
4. docs/command-builder.html — new Recovery tab/section pointing at these commands
5. Tests in test/runner/ (manifest write, list, revert happy path, partial-overlap edge case documented)

Decisions (document in code comments or README snippet):
- What happens if a later run also touched the same file
- GC policy for old manifests (minimal: document manual cleanup for v1)

Do NOT start: §4.6 prompt registry, §5.8 evals, network tools.
Scope: CLI + docs + tests; no new model-callable tools required unless you justify one.
```

---

## Block B — §4.6 Prompt-template registry

```text
[Paste Block 0 above]

TASK: Implement docs/runner-expansion-roadmap.md §4.6 only — prompt-template registry under .bridge-runner/prompts/.

Deliver:
1. Schema: .bridge-runner/prompts/<name>.md with YAML frontmatter (title, summary, parameters, recommended-tools, recommended-permissions, tags)
2. Built-ins in src/runner/prompts/; user/project templates override by name
3. CLI: list / show / validate (e.g. cc prompts list — match existing bin/ entry style)
4. Extend --prompt-template with --prompt-arg key=value substitution at runtime
5. Escape or refuse user parameter values that look like prompt-injection / control tokens
6. docs/command-builder.html — read registry (or shipped JSON) and auto-suggest permissions/tools for selected template
7. Tests: parse frontmatter, parameter validation, substitution, override order

Do NOT start: §4.5 recovery, §5.8 evals, network tools.
Reuse patterns from src/runner/agents/agent-loader.js where sensible.
```

---

## Block C — §5.8 Golden-transcript replay harness

```text
[Paste Block 0 above]

TASK: Implement docs/runner-expansion-roadmap.md §5.8 only — golden-transcript replay harness.

Goal: Catch runner regressions in tool dispatch, permissions, and trace shape without live model calls.

Deliver:
1. test/runner/golden/ — at least 2 canned cases (pinned model output stream + expected runner-side behavior)
2. Harness that replays through a fake/injected model client (no OAuth)
3. CLI entry: cc runner eval (or npm script) — diff actual vs expected; non-zero exit on regression
4. Normalize paths/timestamps in diffs for portability; redact secrets in golden files
5. Document in roadmap appendix or README how to approve intentional golden updates
6. Tests for the harness itself

Do NOT start: §5.9 budget telemetry, §6.1 capability profiles (those need this harness landed first).
Do NOT assign parallel edits to permissions.js with another agent.
```

---

## Block D — §5.9 Budget telemetry and token caps

```text
[Paste Block 0 above]

TASK: Implement docs/runner-expansion-roadmap.md §5.9 only — budget telemetry and token caps.

IMPORTANT: --max-wall-clock-ms and --max-cost-usd already exist in src/runner/run.js — do NOT duplicate them.

Deliver:
1. --budget-input-tokens N / --budget-output-tokens N (soft warning events + hard stop)
2. Trace event at tool boundaries: { type: "budget", input_tokens, output_tokens, wall_ms, spawns, depth }
3. spawn_agent children inherit parent remaining budget by default
4. docs/command-builder.html — budget panel in Permissions section
5. Tests: soft cap warns, hard cap stops cleanly, child inheritance

Prerequisite: §5.8 golden evals should be merged first if possible; if not, add focused tests here.

Do NOT start: §6.1 capability profiles in the same PR.
```

---

## Block E — §6.1 Composable tool capability profiles

```text
[Paste Block 0 above]

TASK: Implement docs/runner-expansion-roadmap.md §6.1 only — composable tool capability profiles.

Deliver:
1. .bridge-runner/profiles/<name>.json — per-tool allow/deny, optional arg constraints (shell regex, write size cap), rationale field
2. --profile <name> layered OVER existing category flags (--accept-edits, --allow-shell, etc.)
3. Built-in profiles: review-only, edit-source-no-shell, git-readonly-shell (names may vary; document them)
4. Denied tools absent or marked in model tool list
5. Profiles CANNOT bypass --chaos-ok interlock or hard-deny matrix (.env, .ssh, path escapes)
6. docs/command-builder.html — profile dropdown
7. Tests + update docs/threat-model.md

Prerequisite: §5.8 golden evals merged strongly preferred.

Do NOT start: network tools. Large diff — one feature per PR if needed.
```

---

## Block F — Parallel worktree orchestration

```text
[Paste Block 0 above]

TASK: Implement docs/runner-expansion-roadmap.md §5.2 / §5.3 follow-up — parallel worktree orchestration.

Context: enter_worktree / exit_worktree shipped (single active worktree per run). Extend to coordinated parallel isolation.

Deliver (scope tightly — propose MVP in PR description if needed):
1. Multiple worktrees per coordinator session OR queue of worktree jobs with clear ctx.worktree lifecycle
2. Integration with spawn_agent / coordinator where appropriate
3. Cleanup story (list orphaned worktrees, session-end hook or doc for manual prune)
4. Tests with temp git repos (cloud-safe)
5. docs/command-builder.html if new flags
6. docs/threat-model.md — worktree safety updates

Do NOT remove spawn_depth=1 cap. Do NOT start network tools.
```

---

## Block G — §5.4 Background bash + polling

```text
[Paste Block 0 above]

TASK: Implement docs/runner-expansion-roadmap.md §5.4 — background bash + output polling.

Build on: src/runner/persistent-shell.js, src/runner/subprocess-pool.js (if present).

Deliver:
1. Background job model (start, list, poll output, kill) — still gated behind --allow-shell
2. Model-callable tool(s) or bash schema extension — follow tool-catalog integration checklist in roadmap §2
3. Permissions: shell category; no bypass of shell-policy scanner
4. Tests including non-interactive / cloud headless behavior
5. command-builder + threat-model updates

Do NOT enable shell by default. Do NOT start network tools.
```

---

## Block H — §5.5 Skill execution tool

```text
[Paste Block 0 above]

TASK: Implement docs/runner-expansion-roadmap.md §5.5 — skill execution tool.

Context: --include-skills lists skills in prompt; execution closes the loop.

Deliver:
1. Model-callable skill tool (name TBD: run_skill / skill) — resolve paths from .bridge-runner/, .cursor/skills/, project skills
2. Respect workspace trust; cap output size; read-only vs write skills policy (default read-only execution)
3. tool-catalog + permissions + tests + command-builder
4. docs/threat-model.md — trust boundaries for skill execution

Do NOT fetch arbitrary URLs. Do NOT start MCP/network tools.
```

---

## Block I — Executable hooks

```text
[Paste Block 0 above]

TASK: Implement executable hooks per docs/runner-expansion-roadmap.md §11 (Hooks table) and §13 item 3.

Context: hook-dispatcher.js dispatches events but action is log-only today.

Deliver:
1. Trusted workspace + allowlisted hook commands (same bar as shell policy)
2. Execute on: post_tool (priority), pre_tool, session_start — at minimum post_tool for verify loop
3. No bypass of hard-deny matrix; hooks cannot exfiltrate secrets
4. Tests with mock commands
5. docs/threat-model.md + command-builder note

Start with PostToolUse auto-verify pattern (npm test filtered) as example in docs.
Do NOT implement PermissionRequest → Slack or other enterprise routing.
```

---

## Block J — §4.4 `read_file` paging polish

```text
[Paste Block 0 above]

TASK: Implement docs/runner-expansion-roadmap.md §4.4 only — read_file paging polish.

Deliver:
1. Clear PARTIAL view semantics (offset/limit), "read more" hints aligned with Claude Code Read where practical
2. Tests for edge cases (empty file, offset past EOF, binary guard unchanged)
3. No change to permission category (read-only)

Small scope — no command-builder change unless CLI flags added.
```

---

## Block K — §4.3 `ask_user_question`

```text
[Paste Block 0 above]

TASK: Implement docs/runner-expansion-roadmap.md §4.3 only — ask_user_question structured clarification.

Deliver:
1. Model-callable tool with multi-choice schema (reuse confirmation.js patterns)
2. TTY: interactive; non-interactive / --dont-ask / worker: fail closed or documented no-op
3. CI/cloud safe: must not hang waiting for stdin in headless mode
4. Full permission + tool-pipeline tests

High priority: matrix test non-TTY, coordinator worker, plan mode.
```

---

## Block MEGA-1 — Phase 1 bundle (Cloud-friendly single session)

```text
[Paste Block 0 above]

TASK: Phase 1 bundle — implement §4.5 AND §4.6 in one branch/PR.

Do Block A and Block B deliverables together. Merge order inside branch: recovery first, then prompt registry.

If time runs out: ship §4.5 complete with tests; leave §4.6 as follow-up commit on same branch.

Do NOT start §5.8 or network tools.
```

---

## Block MEGA-2 — Phase 2 evals + budget (two slices, one session only if confident)

```text
[Paste Block 0 above]

TASK: Implement §5.8 fully, then §5.9 on the same branch if §5.8 tests are green.

If §5.9 risks conflicting with unmerged §5.8 goldens, stop after §5.8 and hand off.

Do NOT start §6.1 capability profiles in this session.
```

---

## Handoff template (agent fills in and returns)

```text
## Handoff

- Folder: /path/to/claude-local-bridge-playground
- Branch: feature/...
- Roadmap slice: §X.X (Block ...)
- Files changed: (list)
- Checks run:
  - node --require ./test/setup.js --test test/runner/*.test.js → PASS/FAIL (N tests)
  - npm run lint → PASS/FAIL
  - npm run check:docs → PASS/FAIL
- Checks skipped: (e.g. live bridge E2E — no OAuth in cloud VM)
- Risks / follow-up: ...
- Commit/push: done / not done (only if asked)
```

---

## Quick reference links

| Doc | Purpose |
| --- | ------- |
| [runner-expansion-roadmap.md](./runner-expansion-roadmap.md) | Phases, §13 sequencing |
| [runner-expansion-roadmap-extensions.html](./runner-expansion-roadmap-extensions.html) | Why these directions exist |
| [threat-model.md](./threat-model.md) | Safety invariants |
| [bridge-runner-actions-poc.md](./bridge-runner-actions-poc.md) | CI lane (read-only; not a build target for writes) |
| [AGENTS.md](../AGENTS.md) | Repo rules + cloud VM notes |
