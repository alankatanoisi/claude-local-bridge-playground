# Runner megathread playbook

Operator recipes for **local-bridge-runner** aligned with community session-hygiene advice.

## Fresh session (default after a bad run)

When the runner prints a degraded-session hint or you hit max steps / loops:

```bash
cd "/Users/alanman/Developer/claude-local-bridge-playground"
node bin/local-bridge-runner.js \
  --cwd "/path/to/project" \
  --new-session \
  --session-id my-task-2 \
  --task-scope \
  --plan \
  --max-steps 8 \
  "Describe the change before editing."
```

- `--new-session` — do not load prior messages; reset session health metadata.
- `--task-scope` — tighter step default (8) and earlier compaction.
- `--plan` — dry-run risky tools on the first pass.

## Resume safely

Only resume when the last run ended with `stopReason: success` and no degraded health:

```bash
node bin/local-bridge-runner.js \
  --cwd "/path/to/project" \
  --session-id my-task-2 \
  --resume-session \
  "Continue from where we left off."
```

If you intentionally want to resume a degraded session:

```bash
node bin/local-bridge-runner.js \
  --session-id my-task-2 \
  --resume-session \
  --ack-resume-risk \
  "I accept the risk; continue anyway."
```

## Branch without losing history

```bash
node bin/local-bridge-runner.js \
  --fork-from my-task-2 \
  --session-id my-task-2-branch \
  --new-session \
  "Try a different approach."
```

Fork copies session state to a new file; `--new-session` starts the conversation fresh on the branch.

## Compact-after-task UX

For one task per invocation (megathread “compact after each task”):

```bash
node bin/local-bridge-runner.js \
  --new-session \
  --task-scope \
  --compact-each-turn \
  --max-steps 8 \
  --cwd "/path/to/project" \
  "Do one focused task and stop."
```

On success, the runner prints a reminder to start the next task with `--new-session`.

## Effort (runner only)

Does **not** change Claude Code TUI behavior — only requests sent by the runner:

```bash
node bin/local-bridge-runner.js \
  --effort high \
  --cwd "/path/to/project" \
  "Analyze this module deeply."
```

Levels: `low`, `medium`, `high`, `max`.

## Auto-memory (opt-in)

Runner auto-memory is **off** unless:

```bash
export BRIDGE_RUNNER_AUTO_MEMORY=1
# or
node bin/local-bridge-runner.js --auto-memory ...
```

Claude Code users should still disable `autoMemoryEnabled` in the IDE — see [claude-code-sidecar-settings.md](./claude-code-sidecar-settings.md).

## When **not** to resume

- Last stop reason was `semantic_cycle_detected`, `max_steps`, `context_budget_exceeded`, `tool_failure_escalation`, or `bridge_error`.
- Compaction generation is high (many compactions in one session).
- You changed task scope substantially — prefer `--new-session` or `--fork-from`.
