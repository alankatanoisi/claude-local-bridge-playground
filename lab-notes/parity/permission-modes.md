# Permission modes (Claude Code → runner)

Last updated: 2026-05-24  
Code: [`src/runner/permissions.js`](../../src/runner/permissions.js), [`bin/local-bridge-runner.js`](../../bin/local-bridge-runner.js)

Claude Code exposes **named permission modes** (default, plan, accept edits, bypass). The playground runner maps them to **CLI flags** and an internal `MODES` table — not 1:1 named strings.

## Mode mapping

| CC concept                 | Runner CLI flags            | Internal mode (`activeMode`) | Read      | Write     | Shell     | Recovery  |
| -------------------------- | --------------------------- | ---------------------------- | --------- | --------- | --------- | --------- |
| Default / ask              | (none)                      | `default`                    | allow     | ask       | ask       | allow     |
| Accept edits               | `--accept-edits`            | `acceptEdits`                | allow     | allow     | ask       | allow     |
| Don't ask (partial bypass) | `--dont-ask`                | `dontAsk`                    | allow     | ask       | allow\*   | allow     |
| Accept + don't ask         | `--accept-edits --dont-ask` | `acceptEditsAndDontAsk`      | allow     | allow     | allow\*   | allow     |
| Plan                       | `--plan`                    | `plan`                       | plan_only | plan_only | plan_only | plan_only |

\*Shell still requires `--allow-shell`. **`--dont-ask` does not enable bash by itself** (safety invariant).

## Tool allowlist

| Flag                    | Effect                                  |
| ----------------------- | --------------------------------------- |
| `--allowed-tools a,b,c` | Restrict which tools the model may call |
| `--agent explore` etc.  | Built-in profile presets tool subsets   |

## Plan mode behavior

When `--plan` is set:

- Write/shell tools return **dry-run / plan_only** results instead of executing.
- Useful for inspection before `--accept-edits`.

## Differences from Claude Code

| CC feature                         | Playground                                             |
| ---------------------------------- | ------------------------------------------------------ |
| Named `permissionMode` in SDK      | Flag composition only                                  |
| `auto` / YOLO classifier           | **Not implemented** (intentional — see HARNESS_VISION) |
| Dynamic mode switching mid-session | Requires new run with different flags                  |

## Safety invariants (unchanged)

- `.env`, keys, `.ssh`, `.aws`, `.claude`, path escapes → **deny**
- Write tools → confirm unless `--accept-edits`
- Bash → hidden unless `--allow-shell`
- Decision cache (Ext-8) never caches `ask` outcomes

## Evidence

- `test/runner/permission-explainer.test.js`
- `test/runner/permission-decision-cache.test.js`
- [docs/threat-model.md](../../docs/threat-model.md)

## Related

- [claude-parity-matrix.md](./claude-parity-matrix.md)
