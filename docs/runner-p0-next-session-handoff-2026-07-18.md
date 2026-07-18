# Runner P0 next session — P0-10 through P0-12

**Prepared:** 2026-07-18 (stop after P0-09)  
**Repository:** `alankatanoisi/claude-local-bridge-playground`  
**Local folder:** `/Users/alanman/Developer/claude-local-bridge-playground`  
**Branch:** `main`  
**Remote:** `origin` → `alankatanoisi/claude-local-bridge-playground`  
**Browser twin:** `docs/runner-p0-next-session-handoff-2026-07-18.html`

## Purpose

Agent entrypoint for the **next session**. Alan asked to treat **P0-10, P0-11, and P0-12 as one chunk** after reviewing tonight or tomorrow. Do not reopen P0-01–P0-09 unless a regression appears.

## Read first (in order)

1. `AGENTS.md` (repo root) — novice-first rules, runner lane, safety invariants.
2. Annotated assessment status block at the top of  
   `docs/runner-runtime-concordance-assessment-2026-07-17.html`  
   then the full findings for `#P0-10`, `#P0-11`, and `#P0-12`.
3. Cumulative context (optional but useful):  
   `docs/runner-p0-handoff-2026-07-18.md`

## Preflight

```bash
pwd
git rev-parse --show-toplevel
git branch --show-current
git remote -v
git status --short
git pull --ff-only origin main
```

Success: folder ends with `claude-local-bridge-playground`, branch `main`, `origin` is the playground repo, working tree clean enough to edit.

## What is already done (do not re-litigate)

| ID | Status | Notes |
|---|---|---|
| P0-01–P0-05, P1-03 | Done | Message contract, profile retirement, search deny, offered tools, typed HTTP |
| P0-06 | Quarantined only | Full `apply_patch` repair still deferred |
| P0-07 | Done | Destructive `exit_worktree` cleanup always asks |
| P0-08 | Done | Worker binary pin, inherit trust, Set allowlists, `skipTrustGate` |
| P0-09 | Done | Shell honesty: unsandboxed local-account authority everywhere |

Recent commits on this arc include `5aea308` (P0-08) and the P0-09 honesty + handoff commit that follows it on `main`.

## This session’s chunk

### P0-10 — Cached permissions / recovery across root changes

**Problem:** Permission-decision cache keys omit canonical cwd/worktree identity. Entering a worktree mutates roots without clearing every decision. `undo_edit` can validate one path field but write a stored absolute path.

**Acceptance:** No cached decision or stored backup path can authorize I/O after the active canonical root changes.

**Likely touchpoints:** `src/runner/permissions.js`, `src/runner/worktree-utils.js`, `src/runner/tools/undo-edit.js`, `src/runner/safety.js`, focused tests under `test/runner/`.

**Suggested approach:** Include a canonical root token in every cache key; invalidate on scope changes; re-confine immediately before each I/O; restore only to the currently validated path.

### P0-11 — Centralized redaction

**Problem:** Tool results scrub, but raw assistant content, JSON/stream-json, SSE fragments, tool inputs, and some human/trace paths emit before one redaction boundary.

**Acceptance:** Secret fixtures split across chunks and present in model text, inputs, outputs, and errors are absent from every sink.

**Likely touchpoints:** `src/runner/run.js`, `src/runner/model-client.js`, `src/runner/tool-pipeline.js`, `src/runner/safety.js` (existing scrubbers), new shared redaction module if needed.

**Suggested approach:** One redaction service used by stdout, JSON, stream JSON, SSE, model text, tool inputs, transcripts, ledgers, archives, human logs, and hooks **before** fan-out. Prefer streaming-safe windowing over naive whole-string-only scrubbing.

### P0-12 — Private session and ledger files

**Problem:** Session/ledger artifacts rely on process umask instead of explicit 0700/0600. Recovery manifests can still be written when canonical persistence is disabled.

**Acceptance:** Private run-bundle directories at 0700 and files at 0600; canonical resume state labeled sensitive; `--no-session-persistence` disables resumable state only—not diagnostics.

**Likely touchpoints:** `src/runner/run.js`, `src/runner/session-store.js`, `src/runner/session-ledger.js`, recovery manifest writers.

## Constraints (non-negotiable)

- Runner lane only unless bridge change is strictly required for transport.
- Do **not** touch `src/credentials.js`, `src/proxy.js`, `src/server.js`, `src/interceptors/**` without explicit ask.
- OAuth-only; never “fix” 401 with upstream `x-api-key` success paths.
- Do not restore agent/capability profiles.
- `--dont-ask` must not enable shell; shell remains unsandboxed host authority (P0-09).
- Prefer failing regression tests before or with the fix.
- Prefer HTML for complex multi-step plans; keep Alan’s command-builder UX in mind if CLI flags change.

## Verification before handoff

```bash
node --require ./test/setup.js --test test/runner/*.test.js
npm test
npm run lint
npm run check:docs
npm run format:check
```

Record skipped checks honestly. Live bridge canary still needs a credential refresh; unit fixtures are enough for these P0s unless Alan asks for a paid canary.

## Handoff fields to return

- Folder and branch used
- Files changed
- Tests/checks run
- Anything skipped
- Risks or next steps (full P0-06 repair is the natural follow-on after this chunk)

Do not claim a push unless `git push` succeeded.
