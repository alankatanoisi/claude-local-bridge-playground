# Playground Git Remote

This note applies only to the **playground** folder:

```bash
/Users/alanman/Developer/claude-local-bridge-playground
```

## Repository lanes (2026 cutover)

Playground now uses its **own GitHub repository**. Canonical extension work stays in a separate repo.

| Lane           | Local folder                     | GitHub                                                                                            | Push branch             |
| -------------- | -------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------- |
| **Playground** | `claude-local-bridge-playground` | [claude-local-bridge-playground](https://github.com/alankatanoisi/claude-local-bridge-playground) | **`main`**              |
| **Canonical (archived)** | `claude-local-bridge` | [claude-local-bridge](https://github.com/alankatanoisi/claude-local-bridge) | frozen — tags `archive-2026-05-*` only |

`origin` in the playground folder should point at the **playground repo** only. Optional read-only remote `canonical-archive` may fetch history from the archived canonical repo; **do not push** to it (`git remote set-url --push canonical-archive DISABLED`).

## Safe push workflow (Terminal)

Run this from **Terminal** before pushing. It proves you are in the playground lane, not the canonical repo.

```bash
cd "/Users/alanman/Developer/claude-local-bridge-playground"

pwd
# Expected: .../claude-local-bridge-playground

git branch --show-current
# Expected: main (tracks origin/main)

git remote -v
# Expected: origin points to github.com/alankatanoisi/claude-local-bridge-playground.git

git status --short
# Expected: no unexpected source files. .DS_Store noise is okay to ignore.

git pull --ff-only origin main
git push origin main
```

**Success looks like:** `main -> main`, `Everything up-to-date`, or branch set to track `origin/main` with no `fatal:` errors.

## Pull requests

All playground PRs belong on the **playground repo**, base **`main`**. See [`PLAYGROUND_PR_POLICY.md`](PLAYGROUND_PR_POLICY.md).

**Do not** open playground PRs on `alankatanoisi/claude-local-bridge` (canonical `main` is posterity only).

## What NOT to do

- Do **not** push playground experiments to canonical repo `main` or merge without promotion ritual.
- Do **not** work in `/Users/alanman/Developer/claude-local-bridge` when you mean to experiment.
- Do **not** assume canonical GitHub `main` reflects playground work.

## Remote cutover (one-time reference)

If remotes need repair:

```bash
cd "/Users/alanman/Developer/claude-local-bridge-playground"
git remote rename origin canonical-archive   # if origin still points at old repo
git remote add origin https://github.com/alankatanoisi/claude-local-bridge-playground.git
git push -u origin main
```

## Related docs

- [`PLAYGROUND_PR_POLICY.md`](PLAYGROUND_PR_POLICY.md)
- [`PROMOTION_RITUAL.md`](PROMOTION_RITUAL.md)
- [`ALAN_OPERATOR_PROFILE.md`](ALAN_OPERATOR_PROFILE.md) — agent ground truth
- Canonical pointer: [docs/playground-lane.md](https://github.com/alankatanoisi/claude-local-bridge/blob/codex/runner-clean-pr/docs/playground-lane.md)
