# Claude Local Bridge Playground

> **Draft v2 — written from scratch 2026-09-26.** This file is a proposal, not yet the live root `README.md`.
> It was drafted after a full re-read of the current repo shape (bridge, runner, orchestration, hosting, ACP,
> Starlark lab). Review it, edit it, then decide whether to promote it over `README.md` or keep iterating.

This repository is a personal, long-horizon research playground for building and understanding a **local
coding-agent loop** that speaks Anthropic's native Messages API through a local credential bridge.

It is not headed to production, a release, or a customer. The deliverable is **understanding** — questions
answered, systems mapped, ideas tested. Prototypes here are disposable by design, and none of the work is
framed as shipping. If you want the owner profile that drives how agents should communicate here, read
[`docs/working-with-alan.md`](./docs/working-with-alan.md) (browser companion:
[`docs/working-with-alan.html`](./docs/working-with-alan.html)).

---

## 1. What lives here, in one picture

There are really four things in this repo, and they are deliberately layered so each can be understood on its own:

| Layer                    | What it is                                                                                                                                                       | Where it lives                                                                                                      | Status                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **Bridge**               | A VS Code extension (and now a standalone process) that exposes Claude Code OAuth credentials as a local Anthropic Messages endpoint on `http://localhost:11437` | `src/server.js`, `src/proxy.js`, `src/credentials.js`, `src/interceptors/**`, `src/standalone.js`, `src/hosting/**` | Transport plumbing — stable, change only when asked |
| **Runner**               | The experimental local coding-agent loop that uses the bridge as model transport and owns prompts, tools, permissions, sessions, budgets, and CLI ergonomics     | `bin/local-bridge-runner.js`, `src/runner/**`, `test/runner/**`                                                     | **The active product surface**                      |
| **Orchestration**        | Phased multi-agent control: a coordinator that runs research → synthesize → execute → verify, plus a separate Starlark-driven control-plane lab                  | `bin/local-bridge-coordinator.js`, `src/runner/coordinator.js`, `starlark-host/`                                    | Active research                                     |
| **Integrations & evals** | Editor integration via ACP (T3 Code), a Claude Code CLI path through the bridge, golden-transcript evals, and Harbor/Terminal-Bench adapters                     | `bin/local-bridge-acp.js`, `bin/t3-cursor-shim.sh`, `test/runner/golden/`, `evals/`                                 | Active research                                     |

The rule of thumb: **the bridge carries bytes; the runner is the experiment.** Most work in this repo lands in
the runner lane. Do not modify bridge/auth/proxy internals unless the change is needed to keep runner transport
working or Alan explicitly asks.

---

## 2. How it fits together

The bridge is a credential and transport boundary. The runner is the loop that sits on top of it:

```text
                          ┌──────────────────────────────────────────────┐
                          │  Claude Local Bridge (localhost:11437)       │
                          │  native POST /v1/messages only               │
   runner ── prompt ─────▶│  OAuth Bearer discovery + injection          │────▶ api.anthropic.com
                          └──────────────────────────────────────────────┘
                                    ▲
        ┌───────────────────────────┴───────────────────────────┐
        │  Runner agent loop (src/runner/run.js)                │
        │  model response → tool_use → permission gate →        │
        │  local tool execution → tool_result → repeat          │
        └───────────────────────────────────────────────────────┘
```

Runner loop in one line:

```text
prompt -> local bridge /v1/messages -> model response -> tool_use -> local tool execution -> tool_result -> repeat
```

Multi-tool responses are matched by `tool_use_id`, not by completion order. The runner validates that every
requested ID has exactly one result before each bridge call and stops locally if the state is malformed. Tool
errors are handled more patiently than that contract: one failed batch counts as one failure, a successful
sibling resets the streak, and a denied approval is not a failure. After three fully failed batches an
interactive run asks how to proceed; a non-interactive run stops safely.

---

## 3. Which clone is this?

| Path ends with                   | This clone              | GitHub                                                                                            | Branch         |
| -------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------- | -------------- |
| `claude-local-bridge-playground` | **Playground (active)** | [claude-local-bridge-playground](https://github.com/alankatanoisi/claude-local-bridge-playground) | `main`         |
| `claude-local-bridge`            | Canonical (archived)    | [claude-local-bridge](https://github.com/alankatanoisi/claude-local-bridge)                       | reference only |

Before editing, run the preflight and confirm:

```bash
pwd
git rev-parse --show-toplevel
git branch --show-current
git remote -v
git status --short
```

Success means the folder ends with `claude-local-bridge-playground`, the branch is `main`, `origin` points at
`alankatanoisi/claude-local-bridge-playground`, and there are no unexpected dirty source files. An iCloud
checkout is reference-only; never run the runner there.

---

## 4. The bridge (transport)

### What it does

The bridge is a local HTTP service that binds to loopback (`127.0.0.1`), discovers Claude Code OAuth
credentials, and forwards Anthropic Messages requests upstream. It lets local tools speak the Anthropic Messages
format **without an Anthropic Console API key**.

Supported endpoints:

| Endpoint                         | Format           | Notes                                                               |
| -------------------------------- | ---------------- | ------------------------------------------------------------------- |
| `POST /v1/messages`              | Anthropic native | Proxied to `api.anthropic.com` with the resolved OAuth Bearer token |
| `POST /v1/messages/count_tokens` | Anthropic        | Mock response (returns 0) for Claude CLI preflight                  |
| `GET /v1/debug`                  | JSON             | Locked diagnostic endpoint; requires the local debug token          |

### Credential discovery (OAuth only)

| #   | Source                                         | Notes                                                            |
| --- | ---------------------------------------------- | ---------------------------------------------------------------- |
| 1   | Live intercepted Claude Code Bearer token      | Captured inside the VS Code process or capture proxy             |
| 2   | `CLAUDE_CODE_OAUTH_TOKEN` environment variable | Long-lived token from `claude setup-token`                       |
| 3   | macOS Keychain `Claude Code-credentials`       | Set when you log in with `claude /login`                         |
| 4   | `~/.claude/.credentials.json`                  | Linux / Windows fallback; also macOS when the keychain is locked |

On macOS with Claude Code installed, source 3 is used automatically unless a fresher intercepted token exists.
OAuth tokens expire; the bridge returns `401`, clears its cache, and retries once. If that fails, run
`claude /login` (or open Claude Code) so the token refreshes.

### Transport invariants (do not break these)

- Native Anthropic Messages surface only: `POST /v1/messages` stays the route.
- No alternate vendor-compatible routes, and no Console API-key fallback paths.
- No `claudeLocalBridge.apiKey` source, and no replaying of captured upstream `x-api-key` as success.
- Dummy client keys such as `ANTHROPIC_API_KEY=local` are local placeholders only; they never become upstream auth.
- Upstream auth is `authorization: Bearer <Claude Code OAuth token>`.
- The bridge binds to loopback; it is not internet-facing. Debug, trace, transcript, and log surfaces stay
  redacted because tokens and fingerprints are sensitive local account state.

### Three ways to run the bridge

The everyday bridge is the VS Code extension on port **11437**. For experimental comparison — and for lower
memory use — a dedicated hosting controller can run three alternative modes on separate ports so they never
collide with the everyday bridge:

| Mode                            | Endpoint for the runner              | Control                                |
| ------------------------------- | ------------------------------------ | -------------------------------------- |
| Everyday VS Code extension      | `http://127.0.0.1:11437/v1/messages` | Normal VS Code                         |
| Dedicated Desktop               | `http://127.0.0.1:11447/v1/messages` | `bin/bridge-hosts.js start desktop`    |
| Dedicated Browser (code-server) | `http://127.0.0.1:11457/v1/messages` | `bin/bridge-hosts.js start browser`    |
| Dedicated Standalone            | `http://127.0.0.1:11467/v1/messages` | `bin/bridge-hosts.js start standalone` |

The standalone host (`src/standalone.js`) runs the same request-handling code as the extension but supplies its
own settings, so it needs no editor, browser tab, or mock of VS Code. The controller only manages the three jobs
it installed; it never stops your ordinary editor or guesses ownership by port. Start with Standalone when
memory is tight. The full step-by-step, beginner-oriented guide — including install on a second Mac, the browser
tab limitation, and memory notes — is [`docs/bridge-hosting-guide.html`](./docs/bridge-hosting-guide.html).

### Bridge configuration (VS Code settings)

Defaults come from `package.json` → `contributes.configuration.properties`.

| Setting                               | Default                     | Purpose                                                     |
| ------------------------------------- | --------------------------- | ----------------------------------------------------------- |
| `claudeLocalBridge.port`              | `11437`                     | Loopback port the server listens on                         |
| `claudeLocalBridge.anthropicBaseUrl`  | `https://api.anthropic.com` | Upstream endpoint (override for staging/gateway)            |
| `claudeLocalBridge.defaultModel`      | `claude-sonnet-5`           | Model used when a request omits one                         |
| `claudeLocalBridge.logRequests`       | `false`                     | Verbose request/response logging to the Output channel      |
| `claudeLocalBridge.logTimeZone`       | `local`                     | `local`, `utc`, or an IANA timezone for timestamps          |
| `claudeLocalBridge.traceLevel`        | `off`                       | Flight-recorder level: `off`, `summary`, `redacted`, `full` |
| `claudeLocalBridge.requireCallerAuth` | `false`                     | Optional local Bearer-token gate for API routes             |
| `claudeLocalBridge.callerAuthToken`   | `""`                        | Static caller token when caller auth is enabled             |

Debug endpoints use a separate local debug token, not the caller token or your OAuth token. In an editor host the
command palette offers **Claude Local Bridge: Copy Debug Token**. In standalone mode it lives at
`~/.bridge-runner/standalone/debug-token.json` (private, mode 600).

### Using the bridge with Claude Code CLI

Point `ANTHROPIC_BASE_URL` at the bridge root **without** a `/v1` suffix:

```bash
export ANTHROPIC_BASE_URL=http://localhost:11437
export ANTHROPIC_API_KEY=local   # local placeholder only; not forwarded upstream

claude
```

The Claude Code CLI then routes model traffic through the bridge, which injects the resolved OAuth Bearer token.

---

## 5. The runner (the active surface)

The runner is a compact local coding-agent loop. Its concerns are prompts, tools, permissions, sessions,
archives, budgets, and extension points — not OAuth. It is designed around a **small core with explicit
opt-ins**: the default prompt is short and repo-agnostic, startup context is minimal, and every capability that
can change files or run commands is off until you ask for it.

### Quick start

Run it from this folder (the runner uses `--cwd` to decide which project the tools may touch):

```bash
cd "/Users/alanman/Developer/claude-local-bridge-playground"

# A conservative first run: read-only tools, no edits, no shell.
node bin/local-bridge-runner.js --plan "Inspect this repo and describe its top-level structure."

# Point at another project without changing folders.
node bin/local-bridge-runner.js \
  --cwd "/Users/alanman/path/to/another/project" \
  --verbose \
  "List the top-level files, summarize the project, then stop. Do not edit files."
```

For disposable experiments, create a fresh throwaway lab instead of reusing an old folder:

```bash
LAB="$(node scripts/create-runner-throwaway-lab.js)"
node bin/local-bridge-runner.js \
  --cwd "$LAB" --trust-workspace \
  --allow-shell --accept-edits --dont-ask --chaos-ok \
  --max-steps 24 \
  "Fix the calculator bug, run npm test, and summarize the result."
```

The helper prints a new timestamped folder under `~/Documents/claude-local-bridge-runner-throwaway-labs/`.
Prefer read-only or `--plan` until you understand what a prompt will do; add `--accept-edits` only when file
changes are intended, and `--allow-shell` only when the runner needs commands such as tests.

The HTML command builder ([`docs/command-builder.html`](./docs/command-builder.html)) assembles these flags in a
form, and the re-imagined V2 ([`docs/command-builder-v2.html`](./docs/command-builder-v2.html)) adds two authority
dials, a live permission matrix, and an annotated command. Both are drift-tested against the real CLI by
`test/runner/command-builder-*.test.js`. The beginner walkthrough is
[`docs/runner-quickstart.html`](./docs/runner-quickstart.html).

### Capability groups (the tool surface)

Tools are grouped and disclosed progressively. **Only `core` is offered by default.** Every other group is an
explicit opt-in via `--capabilities <groups>` or its dedicated flag.

| Group       | Tools                                                                                               | Enabled by                             | What it does                                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `core`      | `list_files`, `read_file`, `search_text`, `glob`, `git_status`, `manage_tasks`, `ask_user_question` | always on                              | Read-only inspection, an in-session task checklist, and structured multiple-choice questions                           |
| `edits`     | `edit_file`, `write_file`, `apply_patch`                                                            | `--capabilities edits`                 | File writes; each asks for confirmation unless `--accept-edits`. `apply_patch` stays hidden until named in `--tools`   |
| `recovery`  | `undo`, `undo_edit`                                                                                 | `--capabilities recovery`              | Recover a single file from its pre-edit backup                                                                         |
| `agents`    | `spawn_agent`                                                                                       | `--capabilities agents`                | Delegate a read-only subtask to a child runner (top-level only; asks by default)                                       |
| `worktrees` | `enter_worktree`, `exit_worktree`, `list_worktrees`                                                 | `--capabilities worktrees`             | Isolated git worktree slots for risky edits                                                                            |
| `skills`    | `run_skill`                                                                                         | `--capabilities skills`                | Load a skill document body by name (read-only text, no embedded execution)                                             |
| `history`   | `search_history`, `expand_history`                                                                  | `--capabilities history`               | Deterministic recall over the session's own lossless canonical history, including spans the context projection clipped |
| `lsp`       | `lsp_query`                                                                                         | `--capabilities lsp` or `--enable-lsp` | Definition / references / hover / diagnostics from a local language server                                             |
| `shell`     | `bash`, `manage_shell_jobs`                                                                         | **`--allow-shell` only**               | Unsandboxed local-account authority; never enabled via `--capabilities`                                                |

`read_file` returns multimodal content for images (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`) and PDFs inside
`cwd`; raw bytes go to the model as content blocks, while logs and transcripts store summaries only. `glob`
finds files by pattern, `search_text` searches content, `list_files` lists one directory, and `git_status`
summarizes the working tree. `apply_patch` is advanced patch mode, hidden by default; prefer `edit_file` /
`write_file` for ordinary edits.

### Safety model

Safety is a set of guardrails, **not** OS-level isolation. Read [`SECURITY.md`](./SECURITY.md) for the
repository-wide scope and [`docs/threat-model.md`](./docs/threat-model.md) for the runner mechanics.

- Shell is hidden unless `--allow-shell` is set; `--dont-ask` never enables shell by itself.
- Write tools require confirmation unless `--accept-edits` is set, and plan mode never executes writes.
- Workspace trust is a consent record for a folder **path**. It does not scan, hash, or certify the folder's
  contents, and files added later are still covered by that consent.
- `.env`, private keys, credential JSON, token files, `.ssh`, `.aws`, `.claude`, `.gnupg`, and `.git` stay
  hard-denied, along with absolute path escapes and out-of-root symlinks. Denials are rechecked at execution time.
- Child agents and coordinator workers may **narrow** authority, never widen it.
- Every output sink — tool results, transcripts, stream/JSON output, human logs, ledger payloads, session
  checkpoints, archives — passes through one central redaction boundary.
- `--no-network` is a best-effort proxy guard for shell, not hard network isolation.

### Prompt structure and customization

By default the runner does **not** inject `AGENTS.md`, `CLAUDE.md`, repo maps, or skills. Add context only when
you want it: `--include-instruction-docs`, `--include-repo-context`, `--include-repo-map`, `--include-skills`, or
`--include-claude-md`. `--bare` forces the smallest possible prompt.

Project-local primitives live under `.bridge-runner/` (globals under `~/.bridge-runner/`):

- `.bridge-runner/SYSTEM.md` replaces the built-in system prompt for that project.
- `.bridge-runner/APPEND_SYSTEM.md` appends project rules after the system prompt.
- `.bridge-runner/prompts/<name>.md` defines reusable prompt templates.
- `.bridge-runner/hooks.json` defines lifecycle hooks (execution requires workspace trust and `"trusted": true`).

### Prompt templates

`--prompt-template <name>` prepends a reusable instruction snippet. Built-in templates are `explore`, `review`,
`cleanup`, `verify`, `grill`, and `simplify`; project and global files override them by name. Templates can carry
YAML frontmatter (`title`, `summary`, `parameters`, `recommended-tools`, `recommended-permissions`, `tags`) and
reference parameters as `{{name}}`, filled at runtime with repeatable `--prompt-arg key=value`. Parameter values
are treated as untrusted text: values that look like injection or control tokens are refused rather than spliced
in, and missing required parameters fail before any model call.

Browse and validate the registry from this folder:

```bash
node bin/local-bridge-prompts.js list
node bin/local-bridge-prompts.js show review
node bin/local-bridge-prompts.js validate
```

### Sessions, resume, and undo

A session is a durable record of a run. Under `~/.bridge-runner/sessions/` the runner keeps a debounced atomic
JSON checkpoint (`*.state.json`), an append-only sequence-numbered ledger (`*.ledger.jsonl`), a cursor sidecar,
and autopsy files. `--session-id` / `--session-path` choose a session; `--resume-session` resumes one;
`--continue` resumes the latest; `--fork-from <id>` forks a new one. Resume is ledger-aware: it reconciles a
checkpoint against the ledger and safely repairs stale or dangling state before continuing.

To roll back a whole run (for example an `--accept-edits` run that touched many files), each run writes a
manifest to `<cwd>/.bridge-runner/runs/<run-id>/manifest.json`, and the `local-bridge-undo` CLI reverts from it:

```bash
node bin/local-bridge-undo.js list-runs --cwd /path/to/project
node bin/local-bridge-undo.js last-run  --cwd /path/to/project --dry-run
node bin/local-bridge-undo.js last-run  --cwd /path/to/project
node bin/local-bridge-undo.js run <run-id|session-id> --cwd /path/to/project
```

Files are restored in reverse order. A file changed after the run is marked `diverged` and skipped unless
`--force`, so newer work is never silently clobbered. In a non-interactive shell the command fails closed without
`--yes` or `--dry-run`.

### Context, compaction, and history

Context shaping is request-local: checkpoints retain raw canonical messages, while a model-aware projection
protects the newest eight exchanges, reserves the requested output budget, and may replace only old evidence
with stable re-fetch markers or a deterministic checkpoint. When whole exchanges are hidden, a compact
**headline index** adds one line per hidden exchange using the assistant's own first sentence (no extra model
call), plus canonical addresses for recovery. Hidden-ness is measured on the request actually sent, and if
appending the index would push a fitting request over the input ceiling it is dropped rather than stopping the
run. The opt-in `history` group turns those markers into actionable recall via `search_history` and
`expand_history`.

### Budgets and cost

At the end of every run the runner prints a one-line token/cost summary to stderr (stdout stays clean for
piping), and records usage in the transcript and the human log. Guards include `--max-cost-usd`,
`--max-wall-clock-ms`, `--budget-input-tokens`, and `--budget-output-tokens`; child agents inherit the parent's
remaining budget. The dollar figure is a local estimate from `src/runner/model-pricing.js`, which prices cache
reads and writes separately. `--log-level quiet` suppresses the summary; `--verbose` adds a breakdown.

### Tracing, archives, and logs

- **Transcripts:** JSONL audit logs under `~/.bridge-runner/logs/` (choose a path with `--transcript`).
- **Human logs:** an optional Markdown mirror of a run via `--human-log <path>`.
- **Flight recorder:** `--trace-level summary|redacted|full` writes correlated runner and bridge JSONL traces.
  `redacted` and `full` can contain prompts and source-code detail, so treat them as sensitive local files.
- **Archive:** the runner writes a searchable per-turn archive under `~/.bridge-runner/archive/`
  (browse with `node bin/local-bridge-archive.js list`; disable with `--no-archive`).

### Golden-transcript evals

Replay canned model transcripts through a fake client — no live OAuth — and assert runner-side behavior (tool
dispatch order, permission decisions, trace event types):

```bash
npm run runner:eval
node bin/local-bridge-runner.js runner eval read-list   # filter by case id substring
node bin/local-bridge-runner.js runner eval --update    # refresh expect blocks after intentional changes
```

Cases live in `test/runner/golden/*.json`. Scoring is either a recorded `expect` snapshot diffed field-by-field,
or hand-written `checklist` terminal-state predicates (a case is green only at fraction 1.0, and unknown check
types fail). The seven `he06-*` cases cover the permission/budget/resume spine.

### Model catalog, effort, and thinking

`src/runner/model-catalog.js` is the single local source of model facts (context window, output ceiling, effort
and thinking support, and pricing). The Anthropic API remains the real source of truth: unknown or future model
IDs pass through unchanged, and the catalog only validates what it positively knows. The current catalog build
(`2026-09-26-fable-5-1-opus-5-5`) recognizes the current lineup (Claude Fable 5.1, Claude Opus 5.5, Claude
Sonnet 5, Claude Haiku 4.5) plus legacy models. The shared default is `claude-sonnet-5`.

- `--effort` accepts `auto` (omit), `low`, `medium`, `high`, `xhigh`, or `max`.
- `--thinking` accepts `auto`, `adaptive`, or `off`, and defaults to `auto`.
- `--temperature` is rejected for model families whose current contract does not accept a non-default value.

Known-incompatible combinations are rejected before the bridge is contacted; unknown future models stay
pass-through friendly.

---

## 6. Orchestration

### Coordinator (phased top-level agent)

`bin/local-bridge-coordinator.js` runs a phased top-level agent:
**research → synthesize → execute → verify**. Research and verify are read-only out-of-process workers;
synthesize is local and spends no tokens; execute is the in-process full loop. Authority is narrowed for children
(flags are AND-ed, tools intersected), and the top-level coordinator validates workspace trust once before
spawning anything.

```bash
node bin/local-bridge-coordinator.js --phases research,synthesize,execute,verify "Objective text here"
```

`--research-plan <file>` accepts a JSON array of `{ id, deps[], prompt, allowedTools?, maxSteps?, maxTokens? }`
nodes; dependency-free nodes run concurrently and the token remainder is split across the batch. Full details,
including the budget broker that issues token leases, are in
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

### In-loop delegation and worktrees

- `spawn_agent` (group `agents`) delegates a focused read-only subtask to a child runner with isolated context.
  Children cannot select a personality, cannot spawn further children, and inherit the parent's remaining budget.
- `enter_worktree` / `exit_worktree` / `list_worktrees` (group `worktrees`) create isolated git worktrees on
  fresh branches. For a **deterministic** guarantee, `--worktree` enters one fresh worktree **before the first
  model request**, so the whole run is confined and the original checkout is never the working root.

### Starlark host (separate control-plane lab)

`starlark-host/` is a graduated prototype that tests one narrow architecture:

```text
Claude planner -> generated Starlark -> validated job descriptors
       -> bounded Claude workers -> recorded results/failures
       -> Claude recovery planner -> validated retry descriptors
       -> final synthesis
```

It runs as its own subtree with its own README and its own checks (`npm run test:starlark`, which needs a Go
toolchain to build the evaluator). The Starlark evaluator has no filesystem, network, shell, model, or
module-loading functions; the Node control plane owns model selection, concurrency, timeouts, budgets, and
artifact persistence. Mock mode is the default and costs nothing; live mode requires both `--mode live` and an
explicit `--max-cost-usd`, metered against durable campaign ledgers under `~/.bridge-runner/campaigns/`. It is
deliberately **not** wired into the runner as a tool — see [`starlark-host/README.md`](./starlark-host/README.md).

---

## 7. Editor and agent integrations

### T3 Code (via ACP)

T3 Code's Cursor provider driver can launch any program that speaks ACP (Agent Client Protocol) over standard
input/output. `bin/local-bridge-acp.js` is the runner exposed as an ACP stdio agent, and
`bin/t3-cursor-shim.sh` is the playground-owned launcher that adapts T3's Cursor-only launch flags before
starting it. Flags on the ACP entry point are per-instance defaults; per-session controls come from ACP config
options. Shell remains the singular consented capability (`--allow-shell` on the shim) and is never exposed as a
composer toggle. Setup and verification: [`docs/t3-code-nightly-setup-2026-09-26.html`](./docs/t3-code-nightly-setup-2026-09-26.html).
Live health check from this folder (tiny real model spend): `node scripts/acp-live-probe.js`.

### Harbor / Terminal-Bench evals

`evals.harbor.cc_bridge_runner_agent:CcBridgeRunnerAgent` installs the runner inside a Harbor task container
while calling the host bridge through `--bridge-url` / `BRIDGE_RUNNER_BRIDGE_URL`. See the eval section of
[`docs/runner-expansion-roadmap.md`](./docs/runner-expansion-roadmap.md) and `evals/harbor/` for the smoke task.

### Read-only GitHub Actions POC

A manual, self-hosted, read-only invocation lane exists as `workflow_dispatch` only (no push, PR, or schedule):
[`docs/bridge-runner-actions-poc.md`](./docs/bridge-runner-actions-poc.md).

---

## 8. Where things live on disk

| Location                              | Contents                                                              |
| ------------------------------------- | --------------------------------------------------------------------- |
| `~/.bridge-runner/sessions/`          | Session checkpoints, ledgers, cursors, autopsies                      |
| `~/.bridge-runner/logs/`              | JSONL transcripts                                                     |
| `~/.bridge-runner/traces/`            | Runner flight-recorder JSONL                                          |
| `~/.bridge-runner/archive/`           | Searchable per-turn run archive                                       |
| `~/.bridge-runner/worktrees/`         | Git worktree slots                                                    |
| `~/.bridge-runner/campaigns/`         | Durable live-spend budget ledgers                                     |
| `~/.bridge-runner/standalone/`        | Standalone-host private state (config, debug token)                   |
| `~/.claude-local-bridge/traces/`      | Bridge flight-recorder JSONL                                          |
| `<cwd>/.bridge-runner/`               | Project prompts, system prompt, hooks, skills, run manifests, backups |
| `<cwd>/.bridge-runner/runs/<run-id>/` | Per-run edit manifest for `local-bridge-undo`                         |

These artifacts can contain prompts, file paths, and source code even after credential redaction. Treat them as
sensitive local evidence and never commit them.

---

## 9. Documentation map

The dated docs under `docs/` are the memory of this repo; this table is the reading order, not the whole list.

**Start here**

- [`docs/runner-quickstart.html`](./docs/runner-quickstart.html) — beginner walkthrough of the runner
- [`docs/command-builder.html`](./docs/command-builder.html) — primary day-to-day command UX
- [`docs/command-builder-v2.html`](./docs/command-builder-v2.html) — re-imagined builder with authority dials

**Architecture and safety**

- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — the durable system reference
- [`SECURITY.md`](./SECURITY.md) — repository-wide security scope and accepted risk
- [`docs/threat-model.md`](./docs/threat-model.md) — runner threat model and known limitations
- [`CONTEXT.md`](./CONTEXT.md) — domain vocabulary for the runner layer

**Direction and roadmap**

- [`docs/runner-expansion-roadmap.md`](./docs/runner-expansion-roadmap.md) — capability expansion map
- [`docs/runner-expansion-roadmap-extensions.html`](./docs/runner-expansion-roadmap-extensions.html) — critical companion
- [`docs/programmatic-tooling-research-review-2026-08-31.html`](./docs/programmatic-tooling-research-review-2026-08-31.html) — nine-paper research thread

**Orchestration**

- [`starlark-host/README.md`](./starlark-host/README.md) — the Starlark control-plane lab
- [`docs/coordinator-fanout-field-test-2026-07-31.md`](./docs/coordinator-fanout-field-test-2026-07-31.md) — coordinator field test

**Hosting**

- [`docs/bridge-hosting-guide.html`](./docs/bridge-hosting-guide.html) — three ways to run the bridge
- [`docs/bridge-hosting-verification-2026-09-26.html`](./docs/bridge-hosting-verification-2026-09-26.html) — observed behavior

**Integrations**

- [`docs/t3-code-nightly-setup-2026-09-26.html`](./docs/t3-code-nightly-setup-2026-09-26.html) — T3 Code via ACP
- [`docs/bridge-runner-actions-poc.md`](./docs/bridge-runner-actions-poc.md) — read-only Actions POC

**Agent working agreements**

- [`AGENTS.md`](./AGENTS.md) — shared rules for every coding agent
- [`CLAUDE.md`](./CLAUDE.md) — Claude Code-specific notes
- [`docs/agent-team-charter-2026-08-25.md`](./docs/agent-team-charter-2026-08-25.md) — four-seat team charter
- [`docs/working-with-alan.md`](./docs/working-with-alan.md) — the owner profile

---

## 10. Development and checks

```bash
npm install

npm test              # node:test suite (bridge + runner)
npm run lint          # ESLint
npm run check:docs    # bridge defaults + runner manifest drift checks
npm run format:check  # Prettier

# Runner-only
node --require ./test/setup.js --test test/runner/*.test.js

# Starlark host (requires Go to build the evaluator)
npm run test:starlark
```

The suite includes `test/runner/false-green-*.test.js` cases that guard specific invariants (deny matrix, CLI
contract, model evolution, catalog registration, contract durability). `npm run check:docs` runs
`scripts/check-doc-defaults.js` and `scripts/check-runner-manifest.js`, which keep this README, the command
builders, the CLI `--help`, the tool catalog, and the model catalog from drifting apart. Claude Code
fingerprint maintenance (`npm run fingerprint:check`, `fingerprint:due`, `fingerprint:prepare`) tracks upstream
harness compatibility.

Press `F5` in VS Code to launch an Extension Development Host for bridge work.

---

## 11. Direction, invariants, and non-goals

The runner follows a **small core with explicit opt-ins**:

- Keep the default system prompt short and generic.
- Keep startup context minimal unless a flag or template asks for more.
- Prefer capability groups over an ever-growing flat tool menu.
- Prefer `.bridge-runner/` files, prompt templates, hooks, and explicit flags for customization.
- Agent and capability **profiles are retired** and must not be restored (`--agent`, `--profile`,
  `--list-agents`, `--list-profiles`). Historical code lives under `docs/archive/runner-profiles/`.

Transport invariants are listed in §4. Other standing decisions:

- **No hard network surface yet.** Web fetch, web search, and MCP are deferred until egress policy is designed
  and documented. `--no-network` is a best-effort shell proxy guard, not isolation.
- **No model-driven permission escalation.** If the model wants shell mid-run, you re-run with broader flags;
  the runner does not negotiate authority.
- **Out of scope for this lab:** hosted-product surfaces (cloud scheduling, teleport, mobile, plugin
  marketplaces, UI statusline/voice), `NotebookEdit`, and enterprise/plugin distribution.

The full reasoning, including explicit "decisions to say no", lives in
[`docs/runner-expansion-roadmap.md`](./docs/runner-expansion-roadmap.md) §8 and its
[extensions companion](./docs/runner-expansion-roadmap-extensions.html).

---

## 12. Working with agents in this repo

Multiple agents (Claude Code, Cursor, Codex, and cloud agents) work here, but **concurrency means sessions, not
edits**: only one agent holds the working tree at a time, and an agent starts editing only on a clean, pulled
`main`. The tree is the baton. The four-seat charter is
[`docs/agent-team-charter-2026-08-25.md`](./docs/agent-team-charter-2026-08-25.md).

Every task ends with a handoff that states: folder and branch used, files changed, checks run, checks skipped
and why, and risks or follow-up work. Never claim something is pushed unless `git push` actually succeeded.
Dated `HANDOFF-*.md` files at the repo root are the agent-to-agent relay; dated docs under `docs/` are the
long-term experiment record.

Alan owns intent and executive decisions. Agents own developer-intelligence guardrails — cwd and branch checks,
risky-flag warnings, and refusing unsafe shortcuts — and those guardrails are not disrespect. The final owner
boundary is [`docs/agent-user-autonomy-boundary-2026-08-11.md`](./docs/agent-user-autonomy-boundary-2026-08-11.md).

---

## 13. Runner CLI reference

This table documents the user-facing runner flags. Maintenance-only surfaces (`--replay`, `--repair`,
`--approve-repair`, `--update`, and the `--template` alias) are intentionally omitted from README prose and
documented in `--help`.

**Input, model, and output**

| Flag                                       | Purpose                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| `--cwd <path>`                             | Target project folder the tools operate inside                            |
| `--model <name>`                           | Model name (defaults to the runner's built-in default)                    |
| `--max-tokens <n>`                         | Max output tokens per model request (this reserve reduces input headroom) |
| `--max-steps <n>`                          | Maximum tool loops (default 16)                                           |
| `--effort <level>`                         | Model effort: omit/`auto`, `low`, `medium`, `high`, `xhigh`, or `max`     |
| `--thinking <mode>`                        | Adaptive thinking: `auto`, `adaptive`, or `off` (default `auto`)          |
| `--temperature <f>`                        | Model temperature 0.0–1.0; omit for models that reject it                 |
| `--output-format <f>`                      | Output style: `text`, `json`, or `stream-json`                            |
| `--stream`                                 | Stream assistant text live while preserving streamed tool inputs          |
| `--verbose`                                | Print step-by-step progress to stderr                                     |
| `--log-level <level>`                      | Stderr verbosity: `quiet`, `normal`, or `verbose`                         |
| `--human-log <path>`                       | Write a plain-text log of prompt, tool results, and final answer          |
| `--trace-level <level>`                    | Write flight-recorder traces: `off`, `summary`, `redacted`, or `full`     |
| `--trace-path <path>`                      | Choose the runner trace JSONL path (bridge trace is correlated)           |
| `--transcript <path>`                      | JSONL transcript path (default under `~/.bridge-runner/logs/`)            |
| `--no-archive`                             | Skip per-turn archive export to `~/.bridge-runner/archive/`               |
| `--bridge-url <url>`                       | Override local bridge endpoint/root (or `BRIDGE_RUNNER_BRIDGE_URL`)       |
| `--caller-token <token>`                   | Local bridge caller-auth token (or `BRIDGE_CALLER_TOKEN`)                 |
| `--include-file <path>`                    | Attach a bounded file from `--cwd` before the model call (repeatable)     |
| `--system-prompt <text>`                   | Override the default system prompt                                        |
| `--system-prompt-file <path>`              | Replace the default system prompt with a file                             |
| `--append-system-prompt <text>`            | Append text after the default system prompt                               |
| `--append-system-prompt-file <path>`       | Append a file's contents after the system prompt                          |
| `--exclude-dynamic-system-prompt-sections` | Put cwd/git fingerprint in the first user message instead                 |

**Context opt-ins**

| Flag                         | Purpose                                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `--bare`                     | Minimal context: no instruction docs, repo block, or skills                                                                 |
| `--include-instruction-docs` | Opt in to the AGENTS.md / CLAUDE.md instruction hierarchy                                                                   |
| `--include-repo-context`     | Opt in to the session repo-context block (cwd/git fingerprint)                                                              |
| `--include-claude-md`        | Include CLAUDE.md in repo-context (requires `--include-repo-context`)                                                       |
| `--include-repo-map`         | Add a capped repo map (requires `--include-repo-context`)                                                                   |
| `--include-skills`           | Opt in to the skills listing in the system prompt                                                                           |
| `--auto-memory`              | Opt-in runner auto-memory in context (default off)                                                                          |
| `--prompt-template <name>`   | Prepend a reusable template: `explore`, `review`, `cleanup`, `verify`, `grill`, `simplify`, or a Markdown path (repeatable) |
| `--prompt-arg key=value`     | Fill a `{{key}}` placeholder in the chosen template (repeatable)                                                            |

**Permissions, tools, and authority**

| Flag                        | Purpose                                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `--permission-mode <m>`     | `default`, `plan`, `accept-edits`, `dont-ask`, `accept-edits-dont-ask`, or `auto` (legacy alias for `dont-ask`) |
| `--plan`                    | Plan mode: real read-only inspection; writes become recorded proposal diffs                                     |
| `--tools <names>`           | Expose only these tools; include `apply_patch` to opt into patch mode                                           |
| `--allowed-tools <names>`   | Same as `--tools` (legacy name)                                                                                 |
| `--capabilities <groups>`   | Enable optional groups: `edits`, `recovery`, `agents`, `worktrees`, `skills`, `history`, `lsp`                  |
| `--enable-lsp`              | Expose `lsp_query` (requires a language server on PATH)                                                         |
| `--accept-edits`            | Auto-approve edit/write/patch tools                                                                             |
| `--dont-ask`                | Skip confirmation for already-enabled risky tools                                                               |
| `--allow-shell`             | Expose `bash` / `manage_shell_jobs`; unsandboxed local-account authority                                        |
| `--test-watch`              | After successful writes, auto-run detected tests (requires `--allow-shell`)                                     |
| `--chaos-ok`                | Acknowledge the `--allow-shell --accept-edits --dont-ask` combination                                           |
| `--worktree`                | Start the run inside a fresh git worktree; the original checkout is never touched                               |
| `--shell-timeout <ms>`      | Max time for shell commands (default 30000, cap 900000)                                                         |
| `--no-network`              | Best-effort HTTP/HTTPS proxy guard for shell; not hard isolation                                                |
| `--trust-workspace`         | Record trust consent for the target folder (required in non-interactive/CI)                                     |
| `--trusted-workspace`       | Enable hooks from `.bridge-runner/hooks.json` (exec hooks also need `"trusted": true`)                          |
| `--inherit-workspace-trust` | Inherit a parent's validated cwd without writing a trust record                                                 |
| `--confirm-timeout <ms>`    | Auto-deny confirmation prompts after N ms (default: no timeout)                                                 |

**Sessions and recovery**

| Flag                       | Purpose                                                                     |
| -------------------------- | --------------------------------------------------------------------------- |
| `--session-id <id>`        | Canonical session id (`*.state.json` under `~/.bridge-runner/sessions/`)    |
| `--session-path <path>`    | Explicit path to a session state JSON file                                  |
| `--resume-session`         | Resume from the session store (requires `--session-id` or `--session-path`) |
| `--continue`               | Resume from the latest session checkpoint                                   |
| `--new-session`            | Force a fresh session (ignore `--resume` / `--continue`)                    |
| `--ack-resume-risk`        | Allow resume even when session health is degraded                           |
| `--fork-from <id>`         | Fork an existing session into a new session id/path                         |
| `--no-session-persistence` | Disable resume checkpoints; manifests/ledger/diagnostics may still write    |
| `--task-scope`             | Task-scoped preset: tighter steps and compaction                            |
| `--compact-each-turn`      | Aggressive compaction preset                                                |
| `--review-memory`          | List pending memory promotions for approval, then exit                      |
| `--session-extract`        | Queue a run-summary memory proposal after a successful trusted session      |

**Budgets and ceilings**

| Flag                            | Purpose                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `--max-wall-clock-ms <n>`       | Stop the run after N milliseconds                                            |
| `--max-cost-usd <n>`            | Stop once the estimated cost exceeds N USD                                   |
| `--budget-input-tokens <n>`     | Hard stop at N cumulative input tokens (soft warn at 80%)                    |
| `--budget-output-tokens <n>`    | Hard stop at N cumulative output tokens (soft warn at 80%)                   |
| `--max-run-tokens <n>`          | Cumulative input occupancy plus output guardrail                             |
| `--max-context-tokens <n>`      | Deprecated one-window alias retaining the legacy warning/2x-stop calculation |
| `--compact-at-tokens <n>`       | Advanced override for when old request evidence is compacted                 |
| `--max-tool-calls-per-turn <n>` | Cap tool calls per model response; halt if exceeded                          |

`--resume <path>` is deprecated and rejected: transcript resume is not supported; use `--resume-session`.

---

## 14. Status and where the memory lives

This README describes the durable shape of the project. **Perishable status does not belong here.** Current
work threads, open items, and their close-outs live in dated documents:

- The single runtime tracker is
  [`docs/runner-runtime-concordance-assessment-2026-07-17.html`](./docs/runner-runtime-concordance-assessment-2026-07-17.html).
- Agent-to-agent relay records are the root-level `HANDOFF-*.md` files.
- Thread entry points are named in `CLAUDE.md` → _Current Work Thread_ (pointers only, no status).

When a slice lands, update this README, `docs/runner-quickstart.html`, both command builders, and
`docs/threat-model.md` when safety behavior changes.
