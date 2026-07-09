# Claude Local Bridge Playground

> **This is the active repository** ([claude-local-bridge-playground](https://github.com/alankatanoisi/claude-local-bridge-playground), branch **`main`**). Canonical [claude-local-bridge](https://github.com/alankatanoisi/claude-local-bridge) is archived (tags `archive-2026-05-main` and `archive-2026-05-runner-clean-pr`); do not open new PRs there.

This repo is now the active lab for the **cc bridge runner**: a small local coding-agent loop that uses the bridge as
its model transport, then focuses on prompts, tools, permissions, transcripts, archives, and command-line ergonomics.

The bridge still matters. It exposes a local Anthropic Messages API on `http://localhost:11437` and injects Claude Code
OAuth credentials so the runner can call models without an Anthropic Console API key. But for new work in this repo,
treat bridge/OAuth/interceptor code as plumbing and treat the runner as the product surface.

## Current Direction: Minimal Runner Lab

The goal is to build, optimize, and customize a compact local runner inspired by minimalist-but-extensible agent design
philosophies such as pi:

- Keep the default prompt small and repo-agnostic.
- Keep startup context minimal until a flag, profile, or template asks for more.
- Keep the tool surface understandable by grouping capabilities: read, write, recovery, and optional shell.
- Prefer small extension points over a large core: `.bridge-runner/` prompts, prompt templates, profiles, hooks,
  archives, and command-builder presets.
- Remove compatibility layers and old docs when they make the runner harder to understand.

Transport policy still has guardrails:

- The bridge ignores `ANTHROPIC_API_KEY`.
- The bridge ignores the old `claudeLocalBridge.apiKey` setting.
- The bridge ignores intercepted `x-api-key` credentials.
- Upstream auth must be `authorization: Bearer <Claude Code OAuth token>`.
- Any local placeholder key such as `ANTHROPIC_API_KEY=local` is for client-side checks only; it is not forwarded to Anthropic.

Treat runs as personal research and local tooling, and experimental exploration during this AI Renaissance.

For the local CLI runner prototype that now ships in this repo, see [docs/runner-quickstart.html](./docs/runner-quickstart.html).
To explore which Claude Code harness capabilities are prudent to add next, see
[docs/runner-expansion-roadmap.md](./docs/runner-expansion-roadmap.md).
For the manual self-hosted GitHub Actions proof of concept, see
[docs/bridge-runner-actions-poc.md](./docs/bridge-runner-actions-poc.md).
For the feasibility assessment and phased fork plan for the OpenAI Codex variant of the runner (decided: built as a
separate `codex-local-bridge-playground` repo), see
[docs/codex-bridge-runner-roadmap.html](./docs/codex-bridge-runner-roadmap.html); no Codex code lives in this repo.

The runner can inspect this repo or any other local project by passing that project as `--cwd`.

## Repository lanes (read this first)

| Lane                                | Local folder                                 | GitHub                                                                                            | Branch                             | Use for                                           |
| ----------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------- |
| **Playground (this repo — active)** | `~/Developer/claude-local-bridge-playground` | [claude-local-bridge-playground](https://github.com/alankatanoisi/claude-local-bridge-playground) | `main`                             | Runner experiments, docs, safety, and tooling     |
| **Canonical (archived)**            | `~/Developer/claude-local-bridge`            | [claude-local-bridge](https://github.com/alankatanoisi/claude-local-bridge)                       | frozen at `archive-2026-05-*` tags | Codex reference only; local folder kept for Codex |

- Playground commits belong in **this** GitHub repo only.
- Canonical repo is archived/reference-only unless Alan deliberately asks to resume promotion work.

Before edits, agents should sanity-check the lane:

```bash
pwd
git branch --show-current
git remote -v
git status --short
```

Success in this playground repo means the folder ends with `claude-local-bridge-playground`, the branch is `main`,
`origin` points at `alankatanoisi/claude-local-bridge-playground`, and there are no unexpected dirty source files.

iCloud checkout: reference-only, not for active runner work.

---

## Defaults at a glance

Defaults below are sourced from `package.json` (`contributes.configuration.properties`).

| Setting                               | Default (from package.json) | Notes                                            |
| ------------------------------------- | --------------------------- | ------------------------------------------------ |
| `claudeLocalBridge.port`              | `11437`                     | Local bridge listens on `http://localhost:11437` |
| `claudeLocalBridge.defaultModel`      | `claude-sonnet-4-5`         | Used when requests omit `model`                  |
| `claudeLocalBridge.anthropicBaseUrl`  | `https://api.anthropic.com` | Upstream Anthropic endpoint                      |
| `claudeLocalBridge.logRequests`       | `false`                     | Verbose request/response logging                 |
| `claudeLocalBridge.logTimeZone`       | `local`                     | Output timestamps use the system timezone        |
| `claudeLocalBridge.requireCallerAuth` | `false`                     | Optional local Bearer-token gate for API routes  |
| `claudeLocalBridge.callerAuthToken`   | `""`                        | Optional static caller token                     |

---

## How it works

### Architecture flow

```
local runner / Claude CLI
  └──> Claude Local Bridge (http://localhost:11437)
        ↓ credential discovery
        ↓ Anthropic Messages request passthrough
        └──> api.anthropic.com
```

For runner work, the bridge is just the transport boundary. The runner owns the agent loop:

```text
prompt -> local bridge /v1/messages -> model response -> tool_use -> local tool execution -> tool_result -> repeat
```

The extension discovers credentials automatically (see priority order below), injects the auth header, and streams
upstream responses back to callers.

---

## Credential Discovery (OAuth-Only Priority Order)

| #   | Source                                       | Notes                                                                          |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------ |
| 1   | Live intercepted Claude Code Bearer token    | Captured from Claude Code traffic inside this VS Code process or capture proxy |
| 2   | `CLAUDE_CODE_OAUTH_TOKEN` env var            | Long-lived OAuth token from `claude setup-token`                               |
| 3   | **macOS Keychain** `Claude Code-credentials` | Automatically set when you log in via `claude /login`                          |
| 4   | `~/.claude/.credentials.json`                | Linux / Windows fallback; also macOS if keychain is locked                     |

On macOS with Claude Code installed, **Priority 3 is used automatically** if no fresher live intercepted Bearer token exists.

---

## Supported Endpoints

| Endpoint                         | Format           | Notes                                                  |
| -------------------------------- | ---------------- | ------------------------------------------------------ |
| `POST /v1/messages`              | Anthropic native | Proxied verbatim to api.anthropic.com                  |
| `POST /v1/messages/count_tokens` | Anthropic        | Mock response (returns 0) for Claude CLI preflight     |
| `GET /v1/debug`                  | JSON             | Locked diagnostic endpoint; requires local debug token |

---

## Configuration

Open **VS Code Settings** and search for `Claude Local Bridge`:

| Setting                               | Default                     | Description                               |
| ------------------------------------- | --------------------------- | ----------------------------------------- |
| `claudeLocalBridge.port`              | `11437`                     | HTTP server port                          |
| `claudeLocalBridge.anthropicBaseUrl`  | `https://api.anthropic.com` | Override for staging                      |
| `claudeLocalBridge.defaultModel`      | `claude-sonnet-4-5`         | Default model when none is specified      |
| `claudeLocalBridge.logRequests`       | `false`                     | Verbose request logging to Output channel |
| `claudeLocalBridge.logTimeZone`       | `local`                     | `local`, `utc`, or an IANA timezone name  |
| `claudeLocalBridge.requireCallerAuth` | `false`                     | Enforce Bearer token for incoming callers |
| `claudeLocalBridge.callerAuthToken`   | `""`                        | Static Bearer token override              |

### Caller auth (optional)

By default, bridge endpoints do not require a second local caller token. This keeps local curl and runner usage simple.

If you enable `claudeLocalBridge.requireCallerAuth`, bridge endpoints require:

```http
Authorization: Bearer <your-caller-token>
```

When caller auth is enabled, normal API endpoints require the caller token. Debug endpoints still use the separate
debug-token header described below.

### Debug endpoint token

`/v1/debug` and any future `/v1/debug/*` endpoints require a separate local debug token printed in the **Claude Local Bridge** VS Code Output log:

```http
x-claude-local-bridge-debug-token: <token from Output log>
```

That token is only a local diagnostic door code. It is not your Claude OAuth token.

---

## Base URL

Use the bridge root for Claude CLI and runner traffic:

```text
http://localhost:11437
```

---

## Using with Claude Code CLI

Set `ANTHROPIC_BASE_URL` to the bridge root (no `/v1`):

```bash
export ANTHROPIC_BASE_URL=http://localhost:11437
export ANTHROPIC_API_KEY=local  # local placeholder for client env checks; not forwarded upstream

claude
```

The Claude Code CLI routes requests through the bridge, which injects the resolved OAuth Bearer token.

## Local Bridge Runner

The runner is the active local coding-agent loop in this repo. It uses the bridge as model transport, but its own
concerns are prompts, tools, permissions, sessions, archives, and extension points. Run it from the folder that contains
`bin/local-bridge-runner.js`:

```bash
cd "/Users/alanman/Developer/claude-local-bridge-playground"
node bin/local-bridge-runner.js "List the files in this repo and summarize what it does."
```

To test a different local folder, keep running the runner from this repo and point the tools at the other project with
`--cwd`:

```bash
cd "/Users/alanman/Developer/claude-local-bridge-playground"
node bin/local-bridge-runner.js \
  --cwd "/Users/alanman/path/to/another/project" \
  --verbose \
  "List the top-level files, summarize the project, then stop. Do not edit files."
```

For disposable test runs, create a fresh throw-away lab instead of reusing an old folder:

```bash
cd "/Users/alanman/Developer/claude-local-bridge-playground"
LAB="$(node scripts/create-runner-throwaway-lab.js)"
node bin/local-bridge-runner.js \
  --cwd "$LAB" \
  --agent bench \
  --trust-workspace \
  --allow-shell \
  --accept-edits \
  --dont-ask \
  --chaos-ok \
  --max-steps 24 \
  "Fix the calculator bug, run npm test, and summarize the result."
```

The helper prints a new timestamped folder under `~/Documents/claude-local-bridge-runner-throwaway-labs/`. This avoids
mixing a tiny smoke task with stale files from an older copied repo.

**Startup context (default: minimal).** By default the runner uses a small Anthropic-native system prompt and does **not**
inject `AGENTS.md`, `CLAUDE.md`, repo maps, repo context, or skills. Use `--include-instruction-docs`,
`--include-repo-context`, `--include-repo-map`, `--include-skills`, or `--agent project` when you want richer project
context. `--bare` forces the smallest prompt. The bridge may still prepend Claude Code OAuth identity blocks upstream.

Project-local prompt primitives live under `.bridge-runner/`:

- `.bridge-runner/SYSTEM.md` replaces the built-in default system prompt for that project.
- `.bridge-runner/APPEND_SYSTEM.md` appends project rules after the default or replacement system prompt.
- `.bridge-runner/prompts/<name>.md` defines reusable prompt templates for `--prompt-template <name>`.

Matching global files under `~/.bridge-runner/` are also loaded. Project files win over global replacement prompts;
append files are applied global first, then project, then CLI flags.

### Prompt-template registry

Prompt templates are reusable instruction snippets prepended to your request with `--prompt-template <name>`. They live
as Markdown files with optional YAML frontmatter and resolve in this order (first match wins):

1. project — `<cwd>/.bridge-runner/prompts/<name>.md`
2. global — `~/.bridge-runner/prompts/<name>.md`
3. built-in — shipped with the runner (`explore`, `review`, `cleanup`, `verify`, `grill`, `simplify`)

Frontmatter gives a template a typed shape so it can be listed, validated, and parameterized:

```markdown
---
title: Review (findings-first)
summary: Review the relevant code for correctness, safety, and missing tests.
parameters: focus?
recommended-tools: read_file, search_text, git_status
recommended-permissions: look-only
tags: review, quality
---

Review the relevant code... Lead with concrete findings.

{{focus}}
```

`parameters` is a comma list where a trailing `?` marks a parameter optional. The body references parameters as
`{{name}}`, and you fill them at runtime with repeatable `--prompt-arg key=value`:

```bash
node bin/local-bridge-runner.js --prompt-template review --prompt-arg focus="error handling in run.js" "Review my change"
```

Parameter values are **attacker-influenced text**, so the runner refuses values that look like prompt-injection or
control tokens (forged `Human:`/`Assistant:` turns, `<|…|>` tokens, `{{ }}` delimiters, frontmatter fences) rather than
splicing them into the prompt. Missing required parameters fail the run before any model call.

Browse and validate the registry with the `local-bridge-prompts` CLI (run from the playground folder):

```bash
node bin/local-bridge-prompts.js list                 # all templates (project > global > built-in)
node bin/local-bridge-prompts.js show review          # metadata + body for one template
node bin/local-bridge-prompts.js validate             # lint every template; non-zero exit on errors
```

The model-facing tool surface is framed as four capability groups:

- **Read:** `list_files`, `read_file` (text + images/PDF), `search_text`, `glob`, `git_status`, `lsp_query` (opt-in)
- **Session:** `manage_tasks` — in-session checklist stored in the session file
- **Clarification:** `ask_user_question` — structured multiple-choice prompts (TTY required; fail closed in workers/`--dont-ask`)
- **Orchestration:** `spawn_agent` — delegate a subtask to a child agent (top-level only; asks by default)
- **Worktree:** `enter_worktree`, `exit_worktree`, `list_worktrees` — parallel git worktree slots per run
- **Skills:** `run_skill` — load a skill document body by name (read-only)
- **Write:** `edit_file`, `write_file`
- **Recovery:** `undo`, `undo_edit`
- **Shell:** `bash`, `manage_shell_jobs` — hidden unless `--allow-shell` is set

`apply_patch` still exists for advanced patch-style edits, but it is hidden by default. Opt into it explicitly with
`--tools apply_patch` or include it in a comma-separated `--tools` / `--allowed-tools` list.

### Recovery: undo a whole run

The `undo` / `undo_edit` tools recover a single file. For rolling back an entire run — say an `--accept-edits` run that
touched a dozen files — the runner writes a **per-run manifest** to `<cwd>/.bridge-runner/runs/<run-id>/manifest.json`
listing every edit and the backup saved before it. The `local-bridge-undo` CLI turns those manifests into a one-command
rollback. Run it from the playground folder and point `--cwd` at the project the runner edited:

```bash
# List recorded runs, newest first
node bin/local-bridge-undo.js list-runs --cwd /path/to/project

# Preview reverting the most recent run (changes nothing)
node bin/local-bridge-undo.js last-run --cwd /path/to/project --dry-run

# Revert it — asks you to confirm first (add --yes to skip the prompt in scripts)
node bin/local-bridge-undo.js last-run --cwd /path/to/project

# Revert an older run by its run id or session id
node bin/local-bridge-undo.js run <run-id|session-id> --cwd /path/to/project
```

Files are restored to their pre-run state in reverse order. If a file changed **after** the run you are reverting (a
later run, a manual edit, Git), it is marked `diverged` and skipped unless you add `--force`, so newer work is never
clobbered by surprise. In a non-interactive shell the command **fails closed**: without `--yes` (or `--dry-run`) it
refuses rather than silently rewriting files. Manifests are small JSON pointers (they reference backups, they do not copy
file bodies) and are not auto-deleted; prune old ones by removing the matching `.bridge-runner/runs/<run-id>` folder.

### Custom agents from files

Use `--agent <name>` or `--agent path/to/agent.md` to load a Markdown file with YAML frontmatter (the same format as
[awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents)). Discovery order:

- Built-in profiles (`explore`, `plan`, `implement`, …) win over file names.
- Bare names resolve under `.bridge-runner/agents/` in the project, then `~/.bridge-runner/agents/`.
- Paths load any compatible file on demand (including agents from an external clone).

This playground ships a small curated set under `.bridge-runner/agents/` (`code-reviewer`, `debugger`,
`refactoring-specialist`, `test-automator`). File agent bodies are **untrusted text** — they become system-prompt addons
only. Claude Code tool names are mapped to runner tools (`Read` → `read_file` + `list_files`, `Grep` → `search_text`,
etc.). `WebFetch` / `WebSearch` and MCP tools are dropped. `Bash` is included only when you also pass
`--allow-shell`.

The `spawn_agent` tool lets the main loop delegate a focused subtask to a child runner (isolated context).
Children cannot spawn further children. Spawning asks for confirmation unless `--dont-ask` is set.

The `enter_worktree` / `exit_worktree` tools create isolated git worktrees on fresh branches so risky
edits happen without touching the main checkout. Use the optional `slot` parameter to run **multiple parallel
worktrees** in one session — re-enter the same slot to switch cwd between them. `list_worktrees` shows active
slots and orphan directories under `~/.bridge-runner/worktrees/`. `enter_worktree` switches the runner's cwd into
the worktree; all subsequent tools operate inside it until you switch slots or call `exit_worktree`, which restores
the original cwd and, with `cleanup=true`, removes the worktree and branch. Default is `cleanup=false` to preserve
work for review. Requires `--cwd` to be a git repo.

List orphan worktrees from the CLI (no model call):

```bash
node bin/local-bridge-runner.js runner worktrees list
```

The `run_skill` tool loads a skill Markdown body by name from `.bridge-runner/skills/` or `.cursor/skills/`.
It is read-only — it returns text for the model to follow; it does not execute shell or network actions embedded
in the skill document.

With `--allow-shell`, `manage_shell_jobs` starts long-running shell commands in the background (dev servers, watch
tasks), then lists, polls, or kills them by job id. Background commands pass the same shell-policy scanner as
synchronous `bash`. Up to eight jobs per run.

`read_file` automatically returns multimodal content for images (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`) and PDF
files inside `cwd`. Image/PDF bytes are attached as Anthropic content blocks for the model; human logs and transcripts
store summaries only (not raw base64). Size caps: 7MB images, 10MB PDFs.

With `--enable-lsp`, the `lsp_query` tool talks to a local language server over stdio (for example
`typescript-language-server` for `.ts`/`.js` files). Actions: `definition`, `references`, `hover`, `diagnostics`.
Install the server globally or on PATH before use.

Project hooks in `.bridge-runner/hooks.json` can use `"action": "exec"` (or `"run"`) to run a trusted shell command
at lifecycle events (`session_start`, `pre_tool`, `post_tool`, `session_end`, …). Exec hooks require workspace trust
and `"trusted": true` in the hooks config; hook commands are scanned by the same shell policy as `bash`.

Useful runner options:

| Option                                                   | Purpose                                                                            |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `--cwd <path>`                                           | Target project folder the tools can inspect or edit                                |
| `--bare`                                                 | Minimal context: no instruction docs, repo block, or skills                        |
| `--include-instruction-docs`                             | Opt in to AGENTS.md / CLAUDE.md instruction hierarchy                              |
| `--include-repo-context`                                 | Opt in to session repo-context block (cwd/git fingerprint)                         |
| `--include-claude-md`                                    | Include CLAUDE.md in repo-context (needs `--include-repo-context`)                 |
| `--include-repo-map`                                     | Opt in to repo map inside repo-context                                             |
| `--include-skills`                                       | Opt in to skills listing in the system prompt                                      |
| `--agent <name\|path>`                                   | Built-in profile, file name under `.bridge-runner/agents/`, or path to agent `.md` |
| `--list-agents`                                          | List built-in and discovered file agents, then exit                                |
| `--permission-mode <m>`                                  | default, plan, accept-edits, dont-ask, accept-edits-dont-ask, auto                 |
| `--tools <list>`                                         | Expose only these tools; include `apply_patch` to opt into patch mode              |
| `--append-system-prompt` / `--append-system-prompt-file` | Add text after the default system prompt                                           |
| `--system-prompt-file`                                   | Replace default system prompt with a file                                          |
| `--exclude-dynamic-system-prompt-sections`               | Put cwd/git fingerprint in the first user message instead                          |
| `--no-session-persistence`                               | Skip writing session checkpoints under ~/.bridge-runner/sessions/                  |
| `--allowed-tools <list>`                                 | Same as `--tools` (legacy name)                                                    |
| `--include-file <path>`                                  | Attach a bounded file from `--cwd` before the model call                           |
| `--prompt-template <name>` / `--template <name>`         | Prepend a reusable prompt template: review, cleanup, explore, or file              |
| `--prompt-arg key=value`                                 | Fill a `{{key}}` placeholder in the chosen prompt template (repeatable)            |
| `--human-log <path>`                                     | Write a plain text log of the prompt, tool results, and final answer               |
| `--trace-level <level>`                                  | Write correlated flight-recorder traces: summary, redacted, or full                |
| `--trace-path <path>`                                    | Choose the runner trace JSONL path; bridge trace path is correlated                |
| `--bridge-url <url>`                                     | Override local bridge endpoint/root; also reads `BRIDGE_RUNNER_BRIDGE_URL`         |
| `--caller-token <token>`                                 | Local bridge caller-auth token; can also use `BRIDGE_CALLER_TOKEN` env             |
| `--plan`                                                 | Plan mode: describe actions instead of executing them                              |
| `--no-network`                                           | Best-effort HTTP/HTTPS proxy guard for shell, not a network sandbox                |
| `--system-prompt <s>`                                    | Override the default system prompt                                                 |
| `--continue`                                             | Resume from the latest transcript in ~/.bridge-runner/logs/                        |
| `--stream`                                               | Stream assistant text live while still preserving streamed tool inputs             |
| `--accept-edits`                                         | Auto-approve edit/write tools                                                      |
| `--allow-shell`                                          | Expose the bash tool; hidden by default                                            |
| `--enable-lsp`                                           | Expose `lsp_query` (requires a language server on PATH)                            |
| `--test-watch`                                           | After successful writes, auto-run detected tests (requires `--allow-shell`)        |
| `--no-archive`                                           | Skip per-turn archive export to `~/.bridge-runner/archive/`                        |

Open [docs/command-builder.html](./docs/command-builder.html) in your browser if you prefer a form that builds these
commands for you. See [docs/runner-expansion-roadmap.md](./docs/runner-expansion-roadmap.md) for a categorized plan to
expand runner tools and harness parity over time. A conservative first run is read-only or `--plan`; use
`--accept-edits` only when file changes are intended, and add `--allow-shell` only when the runner needs commands such
as tests.

### Runner flight recorder

Pass `--trace-level summary` when you need a local audit trail of one runner call without writing prompt bodies. It
records runner turns, local tool decisions, Anthropic usage and cache counters returned to the runner, bridge request
boundaries, forwarded header names, and upstream status metadata. The correlated files default to
`~/.bridge-runner/traces/*.runner.jsonl` and `~/.claude-local-bridge/traces/*.bridge.jsonl`.

`redacted` adds scrubbed request, response, tool-input, and tool-result payloads. `full` keeps the broadest local payload
details while still redacting authorization and key-looking fields. Neither mode reveals Anthropic's internal
classification logic or server-side telemetry; it records what this local runner and bridge can observe at their own
boundaries. Treat redacted and full traces as sensitive source-code logs.

The runner sends correlation headers to the bridge automatically. For a direct Anthropic `/v1/messages` bridge client,
either set the VS Code setting `claudeLocalBridge.traceLevel` or send `x-local-bridge-trace-level: summary` with an
authenticated local request.

### Runner archive (per-turn JSON)

After each run, the runner writes a searchable archive under `~/.bridge-runner/archive/` (one folder per `runId`, per-turn JSON files, and a catalog index). This is in addition to the JSONL transcript in `~/.bridge-runner/logs/`.

- **Browse:** `node bin/local-bridge-archive.js list`
- **Import old logs:** `node bin/local-bridge-archive.js ingest-legacy`
- **Disable:** `--no-archive` or `BRIDGE_RUNNER_ARCHIVE=0`

The archive is local-only by default and is not committed to this repository.

### Usage & cost summary

At the end of every run the runner prints a one-line token/cost summary to **stderr** (stdout stays
clean for piping), for example:

```
[runner usage] in=1234 out=567 cache_read=8901 cache_write=234 (reuse 78%) ~$0.0123
```

- `reuse` is the share of prompt tokens served from the prompt cache (a reuse rate, not a true hit rate).
- The dollar figure is an **estimate** from a local price table (`src/runner/model-pricing.js`) and now
  prices cache reads and cache writes separately as well as plain input/output. Unknown model names fall
  back to the closest family (opus/sonnet/haiku) before the generic default.
- `--log-level quiet` suppresses the summary; `--verbose` adds a short multi-line breakdown.
- The same numbers are recorded as a `usage` event in the JSONL transcript and as a **Usage & Cost**
  section in the `--human-log` file, so token counts and estimated cost are available without redirection.
- `--max-cost-usd <n>` uses the same estimate to stop a run once it crosses the budget.
- `--budget-input-tokens <n>` and `--budget-output-tokens <n>` enforce hard token caps using API
  usage counters. A soft warning event fires at 80% of each cap; stream-json consumers also receive
  `{ type: "budget", input_tokens, output_tokens, wall_ms, spawns, depth }` at tool boundaries.
- Child agents spawned via `spawn_agent` inherit the parent's remaining token budget by default.

### Golden-transcript eval harness

Replay canned model transcripts through a fake client — no live OAuth — and assert runner-side
behavior (tool dispatch order, permission decisions, trace event types):

```bash
npm run runner:eval
# or
node bin/local-bridge-runner.js runner eval
node bin/local-bridge-runner.js runner eval read-list   # filter by case id substring
node bin/local-bridge-runner.js runner eval --update    # refresh expect blocks after intentional changes
```

Golden cases live in `test/runner/golden/*.json`. Each case pins a `model_script` (assistant tool-call
stream) and an `expect` snapshot. Paths, timestamps, and secrets are normalized before diffing. When you
change runner behavior on purpose, run with `--update` and commit the refreshed `expect` blocks together
with the code change so reviewers can see the regression approval explicitly.

### Tool capability profiles (`--profile`)

Composable per-tool allow/deny profiles layer over permission flags. Built-ins: `review-only`,
`edit-source-no-shell`, `git-readonly-shell`. Project files: `.bridge-runner/profiles/<name>.json`.
List with `--list-profiles`.

### Runner perf parity (prompt cache, file cache, shell)

- **Prompt cache:** Automatic on every model request (system + tools + stable message prefix breakpoints).
- **File cache:** In-memory LRU for `read_file` (invalidates on file change).
- **Persistent shell:** Opt-in only — `BRIDGE_RUNNER_PERSISTENT_SHELL=1` (default stays spawn-per-command).
- **Bench:** `node --require ./test/setup.js test/runner/bench/turn-latency.bench.js`

### Harbor / Terminal-Bench evals

This repo includes a Harbor installed-agent adapter at `evals.harbor.cc_bridge_runner_agent:CcBridgeRunnerAgent`.
It installs the runner inside a Harbor task container while calling the host bridge through `--bridge-url` /
`BRIDGE_RUNNER_BRIDGE_URL`.

Before the first eval, start the VS Code bridge on the host Mac and confirm a container can see it:

```bash
docker run --rm curlimages/curl:latest \
  -s -o /dev/null -w "%{http_code}" \
  http://host.docker.internal:11437/v1/debug
```

`401` is the expected result here. It means the container reached the bridge, and the bridge correctly refused the
debug endpoint without a debug token.

Start with the local smoke task before running larger datasets:

```bash
harbor run \
  -p evals/harbor/tasks/cc-bridge-runner-smoke \
  --agent-import-path evals.harbor.cc_bridge_runner_agent:CcBridgeRunnerAgent \
  -m claude-sonnet-4-6 \
  --n-concurrent 1 \
  --job-name cc-bridge-runner-smoke
```

For Terminal-Bench through Harbor, keep early runs small and single-threaded:

```bash
harbor run \
  -d terminal-bench/terminal-bench-2 \
  --agent-import-path evals.harbor.cc_bridge_runner_agent:CcBridgeRunnerAgent \
  -m claude-sonnet-4-6 \
  --n-tasks 5 \
  --n-concurrent 1 \
  --job-name cc-bridge-runner-tbench-smoke
```

## OAuth Token Expiry

Claude Code OAuth tokens expire periodically. The bridge will:

1. Return a `401` to the caller if the token has expired
2. Clear its credential cache automatically
3. Retry once with freshly discovered credentials

If the retry also fails, run `claude /login` (or open Claude Code) so the token refreshes.

---

## Status Bar

The extension shows a status bar item: `📡 Claude Bridge :11437 [keychain]`

Click it to see the current credential source and server status.

---

## Commands

- `Claude Local Bridge: Start Server`
- `Claude Local Bridge: Stop Server`
- `Claude Local Bridge: Show Status`
- `Claude Local Bridge: Show Credential Source`

---

## Development

```bash
npm install
npm run format   # Prettier
npm run lint     # ESLint
npm test         # node:test suite
npm run check:docs
```

Press `F5` in VS Code to launch an Extension Development Host.
