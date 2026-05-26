# Reddit workaround coverage (runner vs Claude Code)

Last updated: 2026-05-24

This table maps common [r/ClaudeAI](https://www.reddit.com/r/ClaudeAI/) megathread workarounds to what **local-bridge-runner** can mitigate vs what requires **Claude Code / VS Code settings** outside this repo.

| Theme | CC workaround | Runner mitigation | Coverage (disciplined runner use) |
| ----- | ------------- | ----------------- | --------------------------------- |
| Session rot / loops | Fresh chat, `/clear` | Session health, semantic cycle stop, `--task-scope` | ~75% |
| Usage burn | Compact often, shorter tasks | `--task-scope`, opt-in auto-memory, cache + compaction | ~75% |
| Effort / thinking | `/effort` in TUI | `--effort` → `output_config.effort` (runner path only) | ~50% |
| Poisoned resume | Avoid `--resume` on bad sessions | Degraded resume gate, `--new-session`, `--ack-resume-risk` | ~70% |
| Long context | Compact ladder, lean CLAUDE.md | Ext-11 instruction delta, aggressive compaction presets | ~60% |
| Lean CLAUDE.md | Keep instructions small | Instruction delta + docs | ~55% |
| CC auto memory | Disable `autoMemoryEnabled` | Runner auto-memory **off by default**; `--auto-memory` opt-in | Runner: high; CC: see sidecar doc |

**Overall:** ~65–75% for operators who follow [runner-megathread-playbook.md](./runner-megathread-playbook.md). Generic Claude Code users without the runner see much lower coverage.

## Related

- [runner-megathread-playbook.md](./runner-megathread-playbook.md)
- [claude-code-sidecar-settings.md](./claude-code-sidecar-settings.md)
- [parity/claude-parity-matrix.md](./parity/claude-parity-matrix.md)
