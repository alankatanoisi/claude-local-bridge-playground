# Playground PR policy

Hard rules for agents and Alan when working from:

```bash
/Users/alanman/Developer/claude-local-bridge-playground
```

## Repository

| Item | Value |
|------|-------|
| GitHub repo | [alankatanoisi/claude-local-bridge-playground](https://github.com/alankatanoisi/claude-local-bridge-playground) |
| Default branch | `main` |
| PR base | **`main`** (or feature branch → `main`) |

## MUST

- Open PRs on the **playground repository only**.
- Use `--repo alankatanoisi/claude-local-bridge-playground --base main` with `gh pr create`.
- Prefix draft titles with `[playground]` when helpful for review.

## MUST NOT

- Open PRs on `alankatanoisi/claude-local-bridge` for playground experiment work.
- Target canonical repo **`main`** with playground commits (see PR #17 — wrong repo, wrong base).
- Auto-merge playground into canonical without [`PROMOTION_RITUAL.md`](PROMOTION_RITUAL.md).

## Examples

**Correct (after repo cutover):**

```bash
cd "/Users/alanman/Developer/claude-local-bridge-playground"
gh pr create --repo alankatanoisi/claude-local-bridge-playground --base main --title "[playground] archive + perf pack"
```

**Wrong:**

```bash
gh pr create --base main   # on canonical repo — do not use for playground work
```

## Canonical lane (for comparison)

Serious extension + clean runner: `~/Developer/claude-local-bridge`, branch `codex/runner-clean-pr`, repo [claude-local-bridge](https://github.com/alankatanoisi/claude-local-bridge).

See also [`PLAYGROUND_GIT_REMOTE.md`](PLAYGROUND_GIT_REMOTE.md) and canonical [`docs/playground-lane.md`](https://github.com/alankatanoisi/claude-local-bridge/blob/codex/runner-clean-pr/docs/playground-lane.md).
