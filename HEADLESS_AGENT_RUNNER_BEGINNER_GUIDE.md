# Headless Agent Runner Beginner Guide

This guide covers the current runner in this branch. It is a **CLI runner**, not the older experimental
`/v1/agent/runs` HTTP API.

Use this folder:

```bash
cd "/Users/alanman/.codex/worktrees/runner-clean-pr"
```

## Mental Model

Think of the runner like this:

```text
you type one objective
  -> model responds
    -> model may request tools
      -> runner checks permissions
        -> runner executes allowed tools
          -> runner sends tool results back to model
            -> model continues
              -> final answer
```

The bridge handles Claude credentials. The runner handles local tools and the agent loop.

## Required Setup

The bridge is protected by local caller auth. Set a predictable token in VS Code settings:

```json
"claudeLocalBridge.callerAuthToken": "local-dev-token"
```

Then export it in Terminal:

```bash
export BRIDGE_CALLER_TOKEN=local-dev-token
```

The runner can read that environment variable automatically. You can also pass it explicitly:

```bash
--caller-token "$BRIDGE_CALLER_TOKEN"
```

## Safe First Run

```bash
cd "/Users/alanman/.codex/worktrees/runner-clean-pr"
export BRIDGE_CALLER_TOKEN=local-dev-token

node bin/local-bridge-runner.js \
  --cwd "/Users/alanman/.codex/worktrees/runner-clean-pr" \
  --caller-token "$BRIDGE_CALLER_TOKEN" \
  --allowed-tools list_files,read_file,search_text,git_status \
  --max-steps 8 \
  --verbose \
  "List the files under src/runner/ and read the first 15 lines of run.js. Do not edit files."
```

## Useful Flags

| Flag                          | What it means                                                           |
| ----------------------------- | ----------------------------------------------------------------------- |
| `--cwd <path>`                | The project folder the runner tools can inspect or edit                 |
| `--caller-token <token>`      | Local bridge caller-auth token                                          |
| `--allowed-tools <list>`      | Only expose these tools to the model                                    |
| `--output-format text`        | Normal human-readable terminal output                                   |
| `--output-format json`        | One final JSON object                                                   |
| `--output-format stream-json` | One JSON event per line for automation                                  |
| `--human-log <path>`          | Write a plain text run log                                              |
| `--trace-level summary`       | Write local metadata traces without prompt bodies                       |
| `--trace-level redacted`      | Include scrubbed request/tool payloads                                  |
| `--trace-level full`          | Include broad local payload evidence; still redacts auth-looking fields |
| `--plan`                      | Dry-run risky tools instead of executing them                           |
| `--accept-edits`              | Let write tools modify files without prompting                          |
| `--allow-shell`               | Expose the bash tool                                                    |
| `--dont-ask`                  | Skip prompts for tools that are already enabled                         |

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
  --cwd "/Users/alanman/.codex/worktrees/runner-clean-pr" \
  --caller-token "$BRIDGE_CALLER_TOKEN" \
  --output-format stream-json \
  --allowed-tools list_files,read_file,search_text,git_status \
  "List src/runner files and summarize each one. Do not edit files."
```

Each line is a JSON event. This is useful for scripts or other agents.

## Flight Recorder Example

```bash
node bin/local-bridge-runner.js \
  --cwd "/Users/alanman/.codex/worktrees/runner-clean-pr" \
  --caller-token "$BRIDGE_CALLER_TOKEN" \
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
  --cwd "/Users/alanman/.codex/worktrees/runner-clean-pr" \
  --caller-token "$BRIDGE_CALLER_TOKEN" \
  --human-log ~/.bridge-runner/logs/runner-review.md \
  --allowed-tools list_files,read_file,search_text,git_status \
  "Review the runner docs and explain what a beginner should know. Do not edit files."
```

## What To Do When Something Breaks

### `Unknown option '--output-format'`

You are running an old file. Run:

```bash
cd "/Users/alanman/.codex/worktrees/runner-clean-pr"
node bin/local-bridge-runner.js --help
```

The help output should include:

```text
--output-format <f>
--trace-level <l>
--caller-token <t>
```

### `Unauthorized: Missing Bearer token`

Run:

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

## Best Starter Command

```bash
cd "/Users/alanman/.codex/worktrees/runner-clean-pr"
export BRIDGE_CALLER_TOKEN=local-dev-token

node bin/local-bridge-runner.js \
  --cwd "/Users/alanman/.codex/worktrees/runner-clean-pr" \
  --caller-token "$BRIDGE_CALLER_TOKEN" \
  --trace-level summary \
  --human-log ~/.bridge-runner/logs/safe-first-run.md \
  --allowed-tools list_files,read_file,search_text,git_status \
  --max-steps 8 \
  --verbose \
  "Explain this repo at a high level. Do not edit files."
```
