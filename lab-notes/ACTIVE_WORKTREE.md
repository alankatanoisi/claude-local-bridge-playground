# Active worktree (read first)

**All new runner, lab-notes, and harness work goes here — and stays here.**

| What | Value |
| ---- | ----- |
| **Folder** | `/Users/alanman/Developer/claude-local-bridge-playground` |
| **GitHub** | [alankatanoisi/claude-local-bridge-playground](https://github.com/alankatanoisi/claude-local-bridge-playground) |
| **Branch** | `main` |
| **Push** | `git push origin main` |

## Do not use for active work

| Wrong target | Why |
| ------------ | --- |
| `~/Developer/claude-local-bridge` (canonical) | Extension lane; frozen unless Alan asks for **promotion** |
| PR on [claude-local-bridge](https://github.com/alankatanoisi/claude-local-bridge) **#17** (`claude/magical-edison-7Qou6`) | Wrong repo; abandoned — playground `main` supersedes |
| Canonical GitHub repo | **Archived** after Alan confirms on GitHub; tags `archive-2026-05-main` and `archive-2026-05-runner-clean-pr` |

## Quick check (run before editing)

```bash
pwd
# MUST end with: claude-local-bridge-playground

git remote get-url origin
# MUST contain: claude-local-bridge-playground.git

git branch --show-current
# Expected: main
```

If any check fails, **stop** and switch folder or remote before coding.

## Relation to canonical PR #17

Playground `main` is **ahead** of `canonical-archive/claude/magical-edison-7Qou6` (megathread, OAuth cache fix, lab-notes program, extensions). Do not merge #17 into playground; do not continue perf work on the canonical branch.

Promotion to canonical extension repo is a **separate ritual** only when Alan asks: [`PROMOTION_RITUAL.md`](PROMOTION_RITUAL.md).
