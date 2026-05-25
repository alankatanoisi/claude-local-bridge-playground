---
schemaVersion: 1
audience: agents
source: claude-code-insights
canonicalReport: lab-notes/claude-code-insights/report.html
frictionTags:
  - wrong_cwd
  - sandbox_vs_real_repo
  - abandoned_session
  - heavy_bash_no_plan
  - reckless_flags
---

# Alan operator profile (for agents — not a tutorial for Alan)

**Required reading** before substantial work in this repository or with Alan on bridge/runner topics. Distilled from Claude Code Insights; full narrative in [`claude-code-insights/report.html`](claude-code-insights/report.html).

## Who Alan is

- Strong **systems and security thinking** — can drive end-to-end workflows (analyze, reproduce, patch, disclose).
- **True novice** at programming, Terminal, Git, and knowing which app (Terminal vs VS Code vs Cursor vs GitHub browser) owns a step.
- Sometimes **reckless** with runner flags (`--accept-edits`, `--allow-shell`, `--dont-ask`) without fully internalizing risk.
- Project technical maturity **does not** imply Alan knows Git, branches, or cwd conventions.

**Agents MUST** over-explain, slow down on risky actions, and never assume Alan knows “obvious” developer conventions.

## What works well (encourage these)

- End-to-end security work on the bridge (empirical verification + remediation + communication).
- Read-only exploration and documentation tasks before edits.
- Clear handoffs: folder, branch, files changed, checks run, success criteria.

## Recurring friction (agents MUST prevent)

| Pattern                           | Agent response                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| Wrong cwd / ran `/init` from home | Confirm `pwd` and target repo **before** any edit; state folder in every command block |
| Sandbox path vs real repo         | Verify git remote and path match Alan’s intent                                         |
| Session abandoned mid-task        | Finish or explicitly hand off; don’t leave ambiguous state                             |
| Heavy bash without planning       | Prefer `--plan` or read-only tools when Alan is exploring                              |

## Agent contract

### MUST

- Read this file and [`AGENTS.md`](../AGENTS.md) Human Context before substantial edits.
- State **where** to run commands (Terminal vs browser), **which folder** to `cd` into, and **what success looks like**.
- State **folder and branch** in every handoff.
- Confirm cwd before file edits in playground or canonical worktrees.
- Open PRs only on the **playground GitHub repository** (`alankatanoisi/claude-local-bridge-playground`), base **`main`**.
- Port playground → canonical only via [`PROMOTION_RITUAL.md`](PROMOTION_RITUAL.md).

### MUST NOT

- Assume Alan knows branch, commit, push, PR, merge, JSONL, or lint without defining once.
- Open playground PRs against **canonical** repo `main` ([`PLAYGROUND_PR_POLICY.md`](PLAYGROUND_PR_POLICY.md)).
- Merge playground chaos into canonical `main` without explicit reviewed promotion.
- Enable or encourage `--accept-edits` + `--allow-shell` without plain-language warnings.

## Repository lanes

| Lane           | Local folder                                 | GitHub                                                                                            | Branch                  |
| -------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------- |
| **Playground** | `~/Developer/claude-local-bridge-playground` | [claude-local-bridge-playground](https://github.com/alankatanoisi/claude-local-bridge-playground) | `main`                  |
| **Canonical**  | `~/Developer/claude-local-bridge`            | [claude-local-bridge](https://github.com/alankatanoisi/claude-local-bridge)                       | `codex/runner-clean-pr` |

Canonical GitHub **`main`** is archival/posterity — not the target for playground work.

## Source pointers

- Full Insights HTML: [`lab-notes/claude-code-insights/`](claude-code-insights/)
- Playground git/PR rules: [`PLAYGROUND_PR_POLICY.md`](PLAYGROUND_PR_POLICY.md), [`PLAYGROUND_GIT_REMOTE.md`](PLAYGROUND_GIT_REMOTE.md)
- Promotion: [`PROMOTION_RITUAL.md`](PROMOTION_RITUAL.md)
