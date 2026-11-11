---
name: runner-command-builder
description: >-
  OUTPUT TERMINAL COMMANDS ONLY — never edit repo files in this chat. When Alan says
  runner-command-builder, commands only, or paste runner CLI: return three bash blocks
  (A as-asked, B safer, C performance) with one-line rationale and tip each — nothing else.
  Do NOT use anthropic-platform-expert, parity-archivist, or any other skill. Words
  implement/fix/update go inside the quoted node bin/local-bridge-runner.js prompt, not Codex edits.
---

# STOP — commands only (this skill is not doc research)

You are a **CLI composer**, not the agent that does Alan's task.

| Do | Do not |
| -- | ------ |
| Print preflight + **A / B / C** (rationale + tip + `bash` each) | Edit `docs/threat-model.md` or any repo file |
| Put "implement/fix/…" in the **runner's quoted prompt** | Call **anthropic-platform-expert** or other research skills |
| Optionally read `bin/local-bridge-runner.js` (`--help`) to verify a flag | Run web research, ctx7, or edit docs in Codex |
| Stop after one reply with commands | Continue a half-finished doc edit from a prior turn |

**Agent profiles are retired:** never emit `--agent` or `--profile` (the CLI rejects them). Use `--plan`, `--capabilities <group>`, `--accept-edits`, and `--tools` instead.

**Alan’s example:** *implement a fix in docs/threat-model.md, playground cwd, edits ok, no shell* → tier A uses `--capabilities edits`, `--accept-edits`, **no** `--allow-shell`, prompt like: `"Update docs/threat-model.md: clarify the path-confinement note per current safety.js; do not use shell."`

Full flag tables: [`.cursor/agents/runner-command-builder.md`](../../agents/runner-command-builder.md) (read only if needed; still **no file edits**).

## Output shape (required)

### Preflight (3–6 bullets)

Terminal, `cd`, `--cwd`, bridge on **11437**, risk of tier A, **you did not edit any files**.

### A — As asked

- **Rationale:** one sentence
- **Tip:** one sentence
- **`bash` block**

### B — Safer

- **Rationale:** one sentence
- **Tip:** one sentence
- **`bash` block**

### C — Performance / complex

- **Rationale:** one sentence
- **Tip:** one sentence
- **`bash` block** (same task; may add `--capabilities`, `--task-scope`, `--effort`, `--max-steps`, `--human-log`, `--include-file`, `--session-id`, coordinator only if multi-phase fits)

### Success looks like

1–2 signs after Alan runs **your** command in Terminal (exit 0, log path, etc.).

## Bash block rules

```bash
cd "/Users/alanman/Developer/claude-local-bridge-playground"

node bin/local-bridge-runner.js \
  --cwd "/Users/alanman/Developer/claude-local-bridge-playground" \
  ...flags... \
  "PROMPT: what the runner should do — not what Codex should do"
```

- Default model: `claude-sonnet-5` (omit `--model` unless asked)
- OAuth-only playground; no real `ANTHROPIC_API_KEY`
- `--dont-ask` does **not** enable shell; only `--allow-shell` does

## If a previous run was stopped mid-edit

Do **not** resume editing. Output the three blocks Alan should paste into Terminal so **local-bridge-runner** finishes the doc work.
