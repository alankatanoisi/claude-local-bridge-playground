# Playground Git Remote

This note applies only to the **playground** folder:

```bash
/Users/alanman/Developer/claude-local-bridge-playground
```

## Repository lanes (2026 cutover)

Playground now uses its **own GitHub repository**. Canonical extension work stays in a separate repo.

| Lane | Local folder | GitHub | Push branch |
|------|--------------|--------|-------------|
| **Playground** | `claude-local-bridge-playground` | [claude-local-bridge-playground](https://github.com/alankatanoisi/claude-local-bridge-playground) | **`main`** |
| **Canonical** | `claude-local-bridge` | [claude-local-bridge](https://github.com/alankatanoisi/claude-local-bridge) | `codex/runner-clean-pr` |

`origin` in the playground folder should point at the **playground repo**. Optional read-only remote `canonical-archive` can fetch history from the old shared repo.

## Safe push workflow (Terminal)

```bash
cd "/Users/alanman/Developer/claude-local-bridge-playground"

pwd
# Expected: .../claude-local-bridge-playground

git branch --show-current
# May show playground/local-runner-chaos locally; push maps to origin main

git status --short
git push -u origin HEAD:main
```

**Success looks like:** `main -> main` (or branch set to track `origin/main`) with no `fatal:` errors.

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
git push -u origin HEAD:main
```

## Related docs

- [`PLAYGROUND_PR_POLICY.md`](PLAYGROUND_PR_POLICY.md)
- [`PROMOTION_RITUAL.md`](PROMOTION_RITUAL.md)
- [`ALAN_OPERATOR_PROFILE.md`](ALAN_OPERATOR_PROFILE.md) — agent ground truth
- Canonical pointer: [docs/playground-lane.md](https://github.com/alankatanoisi/claude-local-bridge/blob/codex/runner-clean-pr/docs/playground-lane.md)
