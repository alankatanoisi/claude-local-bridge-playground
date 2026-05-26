# Headless Agent Runner Beginner Guide

This guide covers the current runner in this branch. It is a **CLI runner**, not the older experimental
`/v1/agent/runs` HTTP API.

## Which folder?

| Folder                                                    | Purpose                                                           |
| --------------------------------------------------------- | ----------------------------------------------------------------- |
| `/Users/alanman/Developer/claude-local-bridge`            | Canonical bridge + runner (merge target)                          |
| `/Users/alanman/Developer/claude-local-bridge-playground` | **Agent OS experiments** — coordinator, session store, compaction |

This guide uses the **playground** paths when showing new harness features. Swap the path if you work in canonical only.

```bash
cd "/Users/alanman/Developer/claude-local-bridge-playground"
```

## Mental Model

### Simple kernel loop (every run)

```text
you type one objective
  -> model responds
    -> model may request tools
      -> runner checks permissions
        -> runner executes allowed tools
          -> runner sends tool results back to model
            -> model continues
              -> final answer (stopReason: success)
```

The bridge handles Claude credentials. The runner handles local tools and the agent loop.

In this playground, "Claude credentials" means **Claude Code OAuth Bearer credentials only**. Anthropic Console API keys
are intentionally ignored so local runner tests do not accidentally use a different billing path from the policy question
Alan is investigating.

### Top-level agent (playground — optional coordinator)

```text
your objective
  -> Coordinator: research (read-only worker, optional)
  -> Coordinator: synthesize (builds a spec — no vague "based on findings")
  -> Agent kernel: execute (main tool loop)
  -> Coordinator: verify (read-only worker, optional)
  -> final answer + session file saved
```

Think of **two CLIs**:

- `bin/local-bridge-runner.js` — single kernel run (one tool loop)
- `bin/local-bridge-coordinator.js` — phased orchestration above the kernel

## Required Setup

The bridge does not require a local caller-auth token by default. That keeps simple runner commands working like before.

The bridge does require an OAuth credential upstream. The normal beginner path is: open Claude Code once so the bridge can
read the macOS Keychain credential or capture a live Bearer token. Do not put a real Anthropic Console API key in this
playground; dummy client values like `local` are only placeholders for tools that require an API-key field.

Caller auth is optional. If you intentionally enable `claudeLocalBridge.requireCallerAuth`, set a predictable token in VS
Code settings:

```json
"claudeLocalBridge.callerAuthToken": "local-dev-token"
```

Then export it in the same Terminal tab where you run commands:

```bash
export BRIDGE_CALLER_TOKEN=local-dev-token
```

The runner can read that environment variable automatically. You can also pass it explicitly:

```bash
--caller-token "$BRIDGE_CALLER_TOKEN"
```

## Safe First Run

```bash
cd "/Users/alanman/Developer/claude-local-bridge-playground"

node bin/local-bridge-runner.js \
  --cwd "/Users/alanman/Developer/claude-local-bridge-playground" \
  --allowed-tools list_files,read_file,search_text,git_status \
  --max-steps 8 \
  --verbose \
  "List the files under src/runner/ and read the first 15 lines of run.js. Do not edit files."
```

## Session persistence (playground)

Use a **session id** so resume uses canonical state, not just transcript replay:

```bash
node bin/local-bridge-runner.js \
  --cwd "/Users/alanman/Developer/claude-local-bridge-playground" \
  --session-id my-session-1 \
  --allowed-tools list_files,read_file \
  --max-steps 4 \
  "List files in src/runner/kernel"

node bin/local-bridge-runner.js \
  --cwd "/Users/alanman/Developer/claude-local-bridge-playground" \
  --session-id my-session-1 \
  --resume-session \
  --allowed-tools list_files,read_file \
  --max-steps 4 \
  "What was the first thing I asked in this session?"
```

Session files live here:

```text
~/.bridge-runner/sessions/<session-id>.state.json
```

Transcripts in `~/.bridge-runner/logs/` are still an **audit log**. The `.state.json` file is the **source of truth** for resume when `--session-id` is set.

## Coordinator example (playground)

```bash
node bin/local-bridge-coordinator.js \
  --cwd "/Users/alanman/Developer/claude-local-bridge-playground" \
  --session-id coord-demo-1 \
  --no-workers \
  --phases research,synthesize,execute \
  "Summarize how permissions.js works. Do not edit files."
```

- `--no-workers` skips background subprocess workers (good for beginners).
- Omit `--phases` to use the default phased pipeline.

## Useful Flags

| Flag                            | What it means                                                              |
| ------------------------------- | -------------------------------------------------------------------------- |
| `--cwd <path>`                  | The project folder the runner tools can inspect or edit                    |
| `--session-id <id>`             | Save/load canonical session at `~/.bridge-runner/sessions/<id>.state.json` |
| `--session-path <path>`         | Explicit path to a session state JSON file                                 |
| `--resume-session`              | Resume messages from the session store (requires session id/path)          |
| `--new-session`                 | Force a fresh session; ignore resume flags                                 |
| `--task-scope`                  | One-task preset: tighter steps + earlier compaction                        |
| `--effort <low\|medium\|high\|max>` | Control model effort on the runner path only                           |
| `--trusted-workspace`           | Enable hooks from `.bridge-runner/hooks.json` in the target project        |
| `--caller-token <token>`        | Optional local bridge caller-auth token                                    |
| `--allowed-tools <list>`        | Only expose these tools to the model                                       |
| `--output-format text`          | Normal human-readable terminal output                                      |
| `--output-format json`          | One final JSON object (includes `stopReason` when available)               |
| `--output-format stream-json`   | One JSON event per line for automation                                     |
| `--human-log <path>`            | Write a plain text run log                                                 |
| `--trace-level summary`         | Write local metadata traces without prompt bodies                          |
| `--trace-level redacted`        | Include scrubbed request/tool payloads                                     |
| `--trace-level full`            | Include broad local payload evidence; still redacts auth-looking fields    |
| `--plan`                        | Dry-run risky tools instead of executing them                              |
| `--accept-edits`                | Let write tools modify files without prompting                             |
| `--allow-shell`                 | Expose the bash tool                                                       |
| `--dont-ask`                    | Skip prompts for tools that are already enabled                            |
| `--max-context-tokens <n>`      | Warn near budget; halt at 2× budget                                        |
| `--max-tool-calls-per-turn <n>` | Cap tool calls per model response                                          |

## Tool Sets I Recommend

Read-only:

```bash
--allowed-tools list_files,read_file,search_text,git_status
```

Read-only plus recovery:

```bash
--allowed-tools list_files,read_file,search_text,git_status,undo_edit
```

Careful editing:

```bash
--allowed-tools list_files,read_file,search_text,git_status,edit_file,write_file,apply_patch,undo_edit
```

Shell only when needed:

```bash
--allow-shell --allowed-tools list_files,read_file,search_text,git_status,bash
```

## Stream JSON Example

```bash
node bin/local-bridge-runner.js \
  --cwd "/Users/alanman/Developer/claude-local-bridge-playground" \
  --output-format stream-json \
  --allowed-tools list_files,read_file,search_text,git_status \
  "List src/runner files and summarize each one. Do not edit files."
```

Each line is a JSON event. Event types include `system`, `assistant`, `tool_use`, `tool_result`, `compaction`, and `result`.
Useful for scripts or other agents.

## Flight Recorder Example

```bash
node bin/local-bridge-runner.js \
  --cwd "/Users/alanman/Developer/claude-local-bridge-playground" \
  --trace-level summary \
  --allowed-tools list_files,read_file,search_text,git_status \
  "Inspect the runner safety layer and report what it blocks. Do not edit files."
```

Trace files:

```text
~/.bridge-runner/traces/*.runner.jsonl
~/.claude-local-bridge/traces/*.bridge.jsonl
```

## Human Log Example

```bash
node bin/local-bridge-runner.js \
  --cwd "/Users/alanman/Developer/claude-local-bridge-playground" \
  --human-log ~/.bridge-runner/logs/runner-review.md \
  --allowed-tools list_files,read_file,search_text,git_status \
  "Review the runner docs and explain what a beginner should know. Do not edit files."
```

## Stop reasons (automation)

When using `--output-format json`, the final object may include `stopReason`:

| Value                     | Meaning                           |
| ------------------------- | --------------------------------- |
| `success`                 | Model finished without more tools |
| `max_steps`               | Hit `--max-steps` limit           |
| `context_budget_exceeded` | Token budget guard tripped        |
| `max_tool_calls_per_turn` | Too many tools in one turn        |
| `bridge_error`            | Local bridge request failed       |

## What To Do When Something Breaks

### `Unknown option '--output-format'` or `--session-id'`

You are running an old file. Run:

```bash
cd "/Users/alanman/Developer/claude-local-bridge-playground"
node bin/local-bridge-runner.js --help
```

The help output should include:

```text
--output-format <f>
--trace-level <l>
--session-id <id>
--caller-token <t>
```

### `Unauthorized: Missing Bearer token`

Caller auth is enabled. The easiest beginner fix is to disable `claudeLocalBridge.requireCallerAuth` in VS Code settings
and restart the extension.

If you want to keep caller auth enabled, run:

```bash
export BRIDGE_CALLER_TOKEN=local-dev-token
```

Then retry with:

```bash
--caller-token "$BRIDGE_CALLER_TOKEN"
```

### The model keeps calling tools forever

Lower the limit:

```bash
--max-steps 8
```

Also limit tools:

```bash
--allowed-tools list_files,read_file,search_text,git_status
```

### You are worried it might edit files

Use:

```bash
--plan
```

and avoid:

```bash
--accept-edits
```

### Resume did not remember the conversation

Prefer **session id** over transcript-only resume:

```bash
--session-id my-run-1
```

Check that `~/.bridge-runner/sessions/my-run-1.state.json` exists and grew after the first run.

## Best Starter Command

```bash
cd "/Users/alanman/Developer/claude-local-bridge-playground"

node bin/local-bridge-runner.js \
  --cwd "/Users/alanman/Developer/claude-local-bridge-playground" \
  --session-id beginner-safe-1 \
  --trace-level summary \
  --human-log ~/.bridge-runner/logs/safe-first-run.md \
  --allowed-tools list_files,read_file,search_text,git_status \
  --max-steps 8 \
  --verbose \
  "Explain this repo at a high level. Do not edit files."
```

## Further reading (playground)

- `lab-notes/AGENT_OS_ARCHITECTURE.md` — layer diagram and module map
- `lab-notes/HARNESS_VISION.md` — long-term harness roadmap
- `lab-notes/CHAOS_ORCHESTRATION.md` — parallel experiment tracks
