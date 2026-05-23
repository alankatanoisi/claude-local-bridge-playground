# Codex Handoff: Claude Local Bridge Runner — Safe Engineering Tasks

## Purpose

Use this handoff as the first attachment or pasted context for Codex. It intentionally focuses on legitimate local-runner engineering: agent loop correctness, state durability, safety controls, compatibility hygiene, and tests.

Do **not** optimize for evasion, detection bypass, usage-limit circumvention, or request fingerprint mimicry. Keep the VS Code extension/local bridge as the transport/auth boundary and keep the runner focused on safe local orchestration.

## Current architecture inferred from the OpenRouter/Fusion materials

The project has these major pieces:

- VS Code extension / local HTTP bridge: transport, auth, keychain/credential handling, `/v1/messages`, and `/v1/chat/completions`.
- Node local runner: CLI entrypoint, tool loop, tool registry, local file/shell tools, permission gates, session persistence.
- Desired behavior: headless coding-agent loop with practical Claude Code-like ergonomics while staying beginner-readable.

## Highest-priority implementation themes

### 1. Canonical session ledger

Create one canonical append-only session ledger. It should preserve both:

- the raw provider-facing message blocks needed to resume a Messages API loop;
- internal runner state that the model never sees but the runner needs to continue safely.

Minimum fields per turn/tool event:

```json
{
  "schemaVersion": 1,
  "sessionId": "...",
  "turnId": 12,
  "timestamp": "...",
  "providerRequest": {},
  "providerResponse": {},
  "assistantMessage": {},
  "toolCalls": [],
  "toolResults": [],
  "runnerState": {
    "cwd": "...",
    "workspaceRoot": "...",
    "allowlist": [],
    "undoLog": [],
    "budget": {},
    "lastToolFailures": []
  }
}
```

Acceptance criteria:

- `--continue` restores messages, budget counters, current directory, allowlist decisions, and undo/transaction state.
- Writes are atomic: write temp file, fsync where practical, then rename.
- Corrupt or partial records are detected and reported with a recovery path.

### 2. Hard stop conditions and loop-health checks

Do not rely on model self-termination.

Implement explicit limits:

- max agent steps;
- max tool calls;
- max repeated identical tool call failures;
- max wall-clock runtime;
- max cumulative input/output tokens or approximate character budget;
- max consecutive tool-only loops without a meaningful assistant plan update.

Acceptance criteria:

- identical failed tool call replay is blocked with a structured error;
- shell/search/edit ping-pong loops are detected;
- the runner returns a clear terminal summary explaining why it stopped.

### 3. Tool schema validation and structured tool results

Every tool should validate arguments before execution and return a consistent result envelope:

```json
{
  "ok": true,
  "tool": "read_file",
  "summary": "Read 142 lines from src/runner/run.js",
  "data": {},
  "truncated": false,
  "error": null
}
```

For failures:

```json
{
  "ok": false,
  "tool": "shell",
  "summary": "Command refused by safety policy",
  "error": {
    "code": "SHELL_COMMAND_DENIED",
    "message": "Command requires explicit approval",
    "retryable": false
  }
}
```

Acceptance criteria:

- invalid arguments never reach file or shell execution;
- tool errors are stable enough that the model can recover without retrying blindly;
- stdout/stderr and large file reads are truncated with explicit metadata.

### 4. File safety and workspace boundaries

Implement path normalization before every read/write/edit/delete:

- resolve `realpath`;
- reject symlink escapes;
- reject `..` traversal outside allowed roots;
- require explicit approval for writes outside the current workspace root;
- keep a transaction/undo log for every write operation.

Acceptance criteria:

- tests cover symlink escape, relative traversal, case-insensitive path edge cases where relevant, and missing file behavior;
- edits are previewed or diffed before destructive writes;
- undo can restore the previous file content after a failed multi-step edit.

### 5. Shell safety policy

Use a risk classifier before shell execution.

Recommended tiers:

- `safe`: read-only commands such as `pwd`, `ls`, `git status`, targeted `grep`;
- `review`: package installs, build scripts, tests, network calls;
- `danger`: deletion, chmod/chown, credential access, destructive git commands, pipe-to-shell, sudo, process killing.

Acceptance criteria:

- dangerous commands are denied by default;
- review-tier commands require explicit approval;
- command output is captured, truncated, and audited;
- shell hooks cannot silently approve or transform unsafe commands.

### 6. Anthropic Messages API compatibility hygiene

Keep provider-facing request construction isolated and heavily tested.

Acceptance criteria:

- assistant/tool_use/tool_result block ordering round-trips through tests;
- prompt-cache annotations are added only to stable, high-value blocks and not spammed across every tool definition;
- beta headers, tool definitions, model names, max token settings, and stop reasons are preserved without being scattered through business logic;
- the runner can degrade gracefully when a provider feature is unavailable.

### 7. Context management

Avoid dumping entire files/transcripts into every turn.

Acceptance criteria:

- file reads support line ranges and search before full read;
- large outputs are summarized or chunked;
- context packing reports what was included, omitted, and truncated;
- the session ledger stores full local artifacts while the model receives only the needed excerpt.

## Suggested Codex task sequence

### Task A — Inventory and tests first

Ask Codex:

> Read the repository only. Produce an implementation map for `bin/local-bridge-runner.js`, `src/runner/run.js`, `src/runner/tool-registry.js`, `src/runner/tools/*`, `src/runner/permissions.js`, and `src/runner/safety.js`. Then add failing tests for session resume, repeated tool failure detection, path allowlist enforcement, and atomic ledger writes. Do not modify production code yet.

### Task B — Canonical session ledger

Ask Codex:

> Implement a canonical append-only session ledger with atomic writes and schemaVersion. Preserve raw provider messages separately from internal runner state. Update `--continue` so it restores cwd, budget counters, undoLog, and prior tool failure history. Keep code beginner-readable and add comments at the API boundaries.

### Task C — Stop conditions

Ask Codex:

> Add hard stop conditions to the agent loop: max steps, max tool calls, max repeated identical tool failures, max wall-clock runtime, and max context budget. Return a clear stop summary. Add tests for each stop reason.

### Task D — Path and shell safety

Ask Codex:

> Harden all file and shell tools. Normalize paths with realpath, block symlink escapes, enforce workspace allowlists, record undo data for writes, and add a shell risk classifier with deny-by-default dangerous commands. Add tests for traversal, symlink escape, dangerous shell commands, and undo.

### Task E — Provider compatibility

Ask Codex:

> Isolate provider request construction and add snapshot tests for Messages API request/response shape, especially tool_use/tool_result order, stop_reason handling, prompt-cache annotations, and graceful degradation when optional provider features are absent.

## Files worth attaching to Codex

Attach in this order:

1. This handoff file.
2. `inventory.md` so Codex knows which exported sources exist.
3. The relevant current repository files.
4. The original OpenRouter JSON and full Fusion HTML files only when asking Codex to mine more historical rationale.

For long sessions, prefer the handoff plus targeted excerpts over attaching every raw export at once.
