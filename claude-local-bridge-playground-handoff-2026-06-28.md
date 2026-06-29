# Handoff — Claude Local Bridge Playground (runner lab)

**Generated:** 2026-06-28  
**Repo:** `/Users/alanman/Developer/claude-local-bridge-playground`  
**Branch:** `main` (synced with `origin`)  
**Latest commit:** `f1460e8` — pushed to `https://github.com/alankatanoisi/claude-local-bridge-playground`

---

## Session goal (completed)

Ship **Phase 2** of the runner expansion roadmap — subagents, file-based agents, and git worktree isolation — then **commit and push** all accumulated uncommitted work to GitHub.

**Outcome:** All three Phase 2 slices are implemented, tested, documented, committed, and pushed. Local and remote are clean (`0 ahead, 0 behind`).

---

## What shipped (reference artifacts; do not re-read in full unless needed)

### Phase 2 — three slices

| Slice | Feature                                                                           | Key files                                                                                                       |
| ----- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1     | File-based agent loader (`.md` + YAML frontmatter → runner profiles)              | `src/runner/agents/agent-loader.js`, `src/runner/agents/registry.js`, `test/runner/agent-loader.test.js`        |
| 2     | Model-callable `spawn_agent` (child runner via `WorkerRuntime`, `spawnDepth` cap) | `src/runner/tools/spawn-agent.js`, `src/runner/permissions.js`, `test/runner/spawn-agent.test.js`               |
| 3     | Git worktree isolation (`enter_worktree` / `exit_worktree`)                       | `src/runner/tools/enter-worktree.js`, `src/runner/tools/exit-worktree.js`, `test/runner/worktree-tools.test.js` |

Also included in the same commit (earlier uncommitted slices):

- `glob`, `manage_tasks` tools
- Tool catalog / pipeline / permissions updates (`orchestration`, `worktree` categories)
- Runner internals: `run.js`, `worker-runtime.js`, `coordinator.js`, `context-budget.js`, `prompt-templates.js`, `session-store.js`, `test-watcher.js`
- Docs: `README.md`, `docs/threat-model.md`, `docs/runner-quickstart.html`, `docs/command-builder.html`, `docs/runner-expansion-roadmap.md`

Full design context: `docs/runner-expansion-roadmap.md` (§5 and §11).

### Vendored reference repo

- `awesome-claude-code-subagents/` — committed into playground after removing its inner `.git` (per user request). It is **no longer** a standalone git clone; updates must be re-downloaded from upstream.
- Inspiration for agent `.md` frontmatter format; runner maps CC tool names conservatively (drops network/MCP; gates `bash` behind `--allow-shell`).

### Local-only (not in repo)

- `.bridge-runner/agents/*.md` — example file agents (`code-reviewer`, `debugger`, etc.) exist locally but are **gitignored** via `.bridge-runner/` rule. User may want these shipped later.

---

## Architecture notes for the next agent

### Runner vs bridge

- **Active surface:** `src/runner/**`, `bin/local-bridge-runner.js`, `test/runner/**`, `docs/**`
- **Do not touch** unless explicitly needed: `src/credentials.js`, `src/proxy.js`, `src/server.js`, `src/interceptors/**`

### Transport invariants (must preserve)

- Native route: `POST /v1/messages` only
- OAuth Bearer via Claude Code only — no API-key fallback, no OpenAI-compat routes
- Shell hidden unless `--allow-shell`; writes ask unless `--accept-edits`
- Path confinement via `ctx.cwdRealpath` / `safety.confinePath`

### Subagent / worktree safety

- `spawn_agent`: top-level only (`spawnDepth === 0`); children cannot spawn; default `ask`; capped spawns per run
- Worktrees: one active per run (`ctx.worktree`); live under `~/.bridge-runner/worktrees/`; branch prefix `bridge-runner/`; `cleanup=false` by default on exit
- Switching worktree updates `ctx.cwd` / `ctx.cwdRealpath` — all tools automatically confine to the worktree

### UI / docs convention (user request)

When adding runner features, **always update** `docs/command-builder.html` in the same change set (tool checkboxes, presets, capability groups).

---

## Verification state at handoff

```bash
# Last known good (run in repo root)
npm test                                    # 475/475 pass (full suite)
node --require ./test/setup.js --test test/runner/*.test.js  # 444/444 runner-only
npm run lint && npm run format:check && npm run check:docs
```

Git: `working tree clean`, `main` up to date with `origin/main`.

---

## Recommended next work

Per `docs/runner-expansion-roadmap.md` §11:

1. **Parallel worktree orchestration** — multiple isolated worktrees for coordinator/parallel subagents (current v1: one worktree per run)
2. **Background bash + polling** — long-running shell with status checks
3. **Executable hooks** — project-local hook scripts beyond current dispatcher
4. **`skill` execution** — invoke project skills from the runner loop

**Explicitly deferred:** network tools (`WebFetch`, `WebSearch`, MCP) until egress policy is designed and documented in `docs/threat-model.md`.

**Housekeeping candidates:**

- `list_worktrees` tool + session-end cleanup for orphaned `~/.bridge-runner/worktrees/`
- Optionally ship curated `.bridge-runner/agents/` examples in-repo (user has not requested yet)
- Split future work into feature branches + PRs if user wants review workflow (they currently work directly on `main`)

---

## Operator context (Alan)

- Strong systems thinker; **novice at Terminal/Git** — over-explain where commands run, define jargon, state what success looks like
- Default lane: **playground** repo on `main`; canonical `claude-local-bridge` is reference-only — do not push/PR there unless asked
- Preflight before edits: `pwd`, `git branch --show-current`, `git remote -v`
- Only commit when explicitly asked; push to `main` requires user approval in Cursor

Evidence pointers: `AGENTS.md`, `CLAUDE.md`, `lab-notes/ALAN_OPERATOR_PROFILE.md`

---

## Prior conversation transcript

For granular implementation decisions and debugging history:

`/Users/alanman/.cursor/projects/Users-alanman-Developer-claude-local-bridge-playground/agent-transcripts/68b4799a-103d-4c1b-943e-1b077cd4de18/68b4799a-103d-4c1b-943e-1b077cd4de18.jsonl`

---

## Suggested skills

Invoke these when the next session starts, depending on focus:

| Skill                           | When                                                          |
| ------------------------------- | ------------------------------------------------------------- |
| `anthropic-official`            | Any Anthropic API, Claude Code, billing, or policy questions  |
| `anthropic-platform-expert`     | Agents SDK, Messages API, model/tool behavior                 |
| `tdd`                           | Implementing the next tool slice with tests first             |
| `harness-engineering-playbook`  | Parallel worktrees, subagent orchestration, harness parity    |
| `improve-codebase-architecture` | Refactoring coordinator/worker-runtime for parallel worktrees |
| `documentation-engineer`        | Large doc updates beyond command-builder                      |
| `readme-generator`              | If README needs a maintainer-grade refresh after next feature |
| `handoff`                       | End of next session                                           |

---

## Quick start for the next agent

```bash
cd /Users/alanman/Developer/claude-local-bridge-playground
pwd && git branch --show-current && git remote -v && git status --short
git pull --ff-only origin main   # if starting fresh later
```

Read first: `AGENTS.md`, `CLAUDE.md`, `docs/runner-expansion-roadmap.md` §11.

Then pick the next slice (likely **parallel worktree orchestration**) and update `docs/command-builder.html` with any new CLI/tool surface.
