# Playground Git Remote — Why Push Is Re-Enabled

This note applies only to the **playground** folder:

```bash
/Users/alanman/Developer/claude-local-bridge-playground
```

Branch:

```bash
playground/local-runner-chaos
```

## Two folders, two purposes

| Folder | Role | Who uses it |
| ------ | ---- | ----------- |
| `/Users/alanman/Developer/claude-local-bridge` | **Canonical** — serious local work, clean runner branch | Alan, when work should stay tidy |
| `/Users/alanman/Developer/claude-local-bridge-playground` | **Alternate universe** — experiments, harness ideas, coordinator chaos | Alan only, never production |

These are **not** the same timeline. Playground is allowed to diverge. Canonical should not be accidentally overwritten by playground pushes.

## Why push was disabled at first

When Codex first set up this playground clone, **push was turned off on purpose**:

```text
origin  DISABLED_DO_NOT_PUSH_FROM_PLAYGROUND (push)
```

That was a safety rail so an agent (or a mistaken command) could not upload experimental commits to GitHub while learning the repo layout. Fetch still worked — the folder could read from GitHub but not write back.

## Why push was re-enabled (Alan, personal use)

Push was re-enabled because:

1. **Backup** — Alan wants GitHub copies of playground work, not only files on one Mac.
2. **Personal sandbox only** — no production, no other users; this repo lane is for Alan's experiments.
3. **No cross-contamination** — playground pushes go to a **clearly named branch** (`playground/local-runner-chaos`), not to `main` or `codex/runner-clean-pr`.
4. **Canonical stays separate** — serious work continues in `/Users/alanman/Developer/claude-local-bridge`; playground does not replace it.

Re-enabled on: **2026-05-24** (document this date when you change remote policy again).

## Remote layout after re-enable

```bash
# Fetch (read from GitHub)
origin  https://github.com/alankatanoisi/claude-local-bridge.git

# Push (write to GitHub — same repo, different branch name)
origin  https://github.com/alankatanoisi/claude-local-bridge.git
```

Playground and canonical share one GitHub repository but use **different local folders and different branch names**. That keeps histories separable.

## Safe push workflow (Terminal)

Run these from the **playground** folder only:

```bash
cd "/Users/alanman/Developer/claude-local-bridge-playground"

# 1. Confirm you are in playground (not canonical)
pwd
git branch --show-current
# Expected branch: playground/local-runner-chaos

# 2. See what would upload
git status --short
git log origin/playground/local-runner-chaos..HEAD --oneline 2>/dev/null || git log -3 --oneline

# 3. Push this branch only
git push -u origin playground/local-runner-chaos
```

**Success looks like:** Terminal prints something like `branch 'playground/local-runner-chaos' set up to track 'origin/playground/local-runner-chaos'` with no `fatal:` errors.

**If push fails:** read the error — often auth (GitHub login) or network. Do not run push from the canonical folder by mistake.

## What NOT to do

- Do **not** push playground to `main` or merge playground into canonical without an explicit, reviewed port.
- Do **not** work in `/Users/alanman/Developer/claude-local-bridge` when you mean to experiment — use the playground path.
- Do **not** assume GitHub `main` reflects playground; it reflects the default branch unless you merged on purpose.

## Disabling push again (optional)

If you want the safety rail back:

```bash
cd "/Users/alanman/Developer/claude-local-bridge-playground"
git remote set-url --push origin DISABLED_DO_NOT_PUSH_FROM_PLAYGROUND
```

Local commits remain on your Mac; only upload stops.

## Related docs

- `BEGINNER_GUIDE.md` — which folder to use for what
- `lab-notes/PROMOTION_RITUAL.md` — optional manual port from playground → canonical (not automatic)
- `lab-notes/AGENT_OS_ARCHITECTURE.md` — playground harness layout
