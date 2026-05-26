# Claude Code sidecar settings (not enforced by bridge)

These mitigations appear in community megathreads for **Claude Code / VS Code**. This repository **does not** toggle them in extension code. Configure them manually in Claude Code.

## autoMemoryEnabled

**Problem:** CC auto-memory can accumulate noisy context and burn usage.

**CC-side fix:** Disable auto memory in Claude Code settings when you prefer manual control.

**Runner equivalent:** Runner auto-memory is **opt-in** (`--auto-memory` or `BRIDGE_RUNNER_AUTO_MEMORY=1`). Default is off.

## Version pin (e.g. 2.1.68)

**Problem:** Some users pin Claude Code versions to avoid regressions.

**CC-side fix:** Install or pin the VS Code extension version you trust.

**Bridge/runner:** No version pin in this repo. Bridge fingerprint strings follow captured Claude Code betas; update carefully when Anthropic changes headers.

## Avoid `--resume` on unstable sessions

**Problem:** Resuming poisoned CC sessions repeats loops.

**CC-side fix:** Start a new session in the TUI when quality drops.

**Runner equivalent:** `--resume-session` is blocked when `session.runner.health.degraded` is true unless `--ack-resume-risk`. Prefer `--new-session`.

## ENABLE_TOOL_SEARCH and other env toggles

Community posts mention env vars for CC behavior. Those apply to the **Claude Code process**, not `local-bridge-runner`.

Document what you set locally; do not expect the bridge to enforce them.

## Related

- [runner-megathread-playbook.md](./runner-megathread-playbook.md)
- [reddit-workaround-coverage.md](./reddit-workaround-coverage.md)
