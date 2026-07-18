# Runner Runtime Concordance — P0 Handoff

**Prepared:** 2026-07-18  
**Repository:** `alankatanoisi/claude-local-bridge-playground`  
**Local folder:** `/Users/alanman/Developer/claude-local-bridge-playground`  
**Branch:** `main`  
**Intended continuation point:** GitHub `origin/main`

## Purpose

This is the agent-facing continuation document for the runner runtime concordance work. It records what was assessed, what was implemented, why the design changed, what was verified, and what remains. A future agent should read this file and the annotated assessment before changing the runner.

Primary assessment:

- `docs/runner-runtime-concordance-assessment-2026-07-17.html`

Historical incident evidence:

- `docs/postmortems/2026-07-11-compaction-tool-pairing-postmortem.md`
- `docs/postmortems/`

## Repository identity and branch discipline

This playground repository is the active laboratory. The similarly named canonical repository is reference-only unless Alan explicitly requests promotion work.

Before doing anything, verify:

```bash
# Show the folder in which the terminal is currently operating.
pwd

# Confirm which Git repository owns that folder.
git rev-parse --show-toplevel

# Confirm the active branch. It should say "main" for this playground workflow.
git branch --show-current

# Confirm that origin points to claude-local-bridge-playground, not the canonical repository.
git remote -v

# Reveal uncommitted work before pulling, editing, or switching branches.
git status --short
```

Expected folder and repository root:

```text
/Users/alanman/Developer/claude-local-bridge-playground
```

Expected branch:

```text
main
```

Expected remote:

```text
https://github.com/alankatanoisi/claude-local-bridge-playground.git
```

Do not pull over an unexplained dirty working tree. Do not move this work to the canonical repository.

## Current executive status

The assessment identified 43 findings: 12 P0, 15 P1, and 16 P2. Alan approved P0-01 through P0-03, Option 1 containment for P0-04 through P0-06 plus typed HTTP retries (P1-03), then P0-07 through P0-09. **Stopping point for this session: P0-09 landed.** Next session should take **P0-10 through P0-12 as one chunk**.

| Finding | Current status | Resolution |
|---|---|---|
| P0-01 — invalid tool history after compaction | Implemented and verified | Semantic exchange grouping, exact tool-ID validation before every request, safe resume batching, bounded/idempotent clipping, interactive repeated-failure recovery; second-pass review also rejects whitespace-only tool IDs |
| P0-02 — agent profiles widen authority | Retired and archived | Runtime agent profiles and their CLI flags were removed; historical source and tests were retained as inert text files |
| P0-03 — capability/tool profiles fail open | Retired and archived | Runtime capability profiles were removed; visibility now comes from explicit feature gates and tool allowlists |
| P0-04 — search_text deny-matrix bypass | Implemented and verified | Shared `isFileCandidateAllowed` (realpath + deny matrix) on every search backend; symlink escape and `.env` fixtures |
| P0-05 — hidden/aliased tool executes unoffered | Implemented and verified | Per-run `offeredTools` snapshot; execute hard-denies unoffered names and aliases |
| P0-06 — apply_patch shell interpolation | Quarantined | Never offered; every execute path refuses until argv/atomic/hunk/rollback repair |
| P1-03 — deterministic HTTP retries | Implemented and verified | Typed `BridgeHttpError` / `BridgeNetworkError`; fail-fast 4xx; retry only 429/5xx/network with capped Retry-After |
| P0-07 — destructive worktree cleanup confirmation | Implemented and verified | `exit_worktree` + `cleanup: true` always asks with purpose-built copy; never implied by `--accept-edits` / `--dont-ask` |
| P0-08 — worker startup / trust / confinement | Implemented and verified | Package-pinned worker binary; `--inherit-workspace-trust` without writing `trust.json`; Set allowlists honored; test-only `skipTrustGate` |
| P0-09 — shell sandbox honesty | Implemented and verified | Shared honesty constants; CLI/help/confirmations/system prompt/threat-model/command-builder/quickstart/README all state unsandboxed local-account authority |
| P0-10 — permission cache across root changes | Open · next session | Include canonical root identity in cache keys; invalidate on scope changes; re-confine before I/O |
| P0-11 — centralized redaction | Open · next session | One redaction service before stdout/JSON/stream/SSE/transcript/ledger fan-out |
| P0-12 — private session/ledger files | Open · next session | 0700 directories / 0600 files; clarify `--no-session-persistence` vs diagnostics |

Full `apply_patch` repair remains open under P0-06; quarantine is containment only.

**Next-session handoff (start here for P0-10–12):**

- `docs/runner-p0-next-session-handoff-2026-07-18.md` (agent)
- `docs/runner-p0-next-session-handoff-2026-07-18.html` (browser)

## Decisions and rationale

### 1. Tool calls are batches, not a FIFO queue

An assistant response may request several tools at once. Local operations can finish in a different order from the order in which the model requested them. Therefore, correctness means:

- one assistant `tool_use` batch;
- immediately followed by one user `tool_result` batch;
- exactly one result for every requested tool ID;
- no missing, duplicate, orphaned, or extra IDs;
- result order may differ from request order.

The validator compares exact ID membership rather than assuming pristine sequential completion. Compaction treats the assistant request and its complete result batch as one indivisible semantic exchange.

### 2. Strict contract, flexible foreground recovery

Alan normally runs the runner visibly with verbose streaming and actively watches it. The runtime therefore does not stop after two individual tool errors.

It counts **fully failed tool batches**:

- a parallel batch containing four failed calls counts as one failed batch;
- any successful result in a batch resets the streak;
- a human declining permission is not counted as a broken tool;
- after three consecutive fully failed batches, the runner asks the foreground user what to do.

The choices are:

1. Continue with a fresh guarded recovery window — recommended and default.
2. Add user guidance, then continue.
3. Stop safely.

When no interactive terminal is available, the runner stops safely instead of guessing. Three batches is the initial policy, not a sacred constant; measure real use before changing it.

### 3. Agent profiles were the wrong abstraction for this runner

Alan uses granular flags and had not found the bundled agent profiles useful. Profiles also created competing sources of authority and could override explicit choices. The selected design is therefore simpler:

- no active runtime agent profiles;
- no `--agent` or `--list-agents` option;
- no profile-selected editing, shell, plan, worktree, or tool changes;
- generic read-only child workers with an explicit seven-tool list;
- historical implementations preserved under `docs/archive/runner-profiles/` for possible future research.

If a future subagent-template feature is desired, design it as a narrowing template beneath an immutable parent authority ceiling. Do not simply restore the retired profile merge logic.

### 4. Capability profiles were retired for the same reason

Capability/tool profiles were not being used and had fail-open behavior: a newly registered tool could become visible merely because a profile had not classified it. Tool visibility now has one direct source:

- explicit runner feature gates; and
- the optional `--tools`/`--allowed-tools` allowlist.

### 5. P0-04 protects both location and file type

The assessment's “permission layer” wording refers to two independent boundaries:

- **Location boundary:** `--cwd` establishes the authorized project root. A symlink inside the project must not silently grant access to a file outside it.
- **Sensitive-file boundary:** `.env`, private keys, credential JSON, tokens, `.ssh`, `.aws`, `.claude`, and similar classes remain blocked even if they exist inside the project root.

An agent's belief that another folder would help is not authorization. A future explicit “request another root” workflow could ask Alan to approve an additional folder for one run, but sensitive credential classes should remain hard-denied.

## Implemented code map

### Message integrity

- `src/runner/message-contract.js`
  - Defines the typed local contract error.
  - Validates exact tool ID membership, uniqueness, roles, adjacency, and block ordering.
  - Groups messages into semantic exchanges for compaction.
- `src/runner/context-compactor.js`
  - Compacts only at semantic exchange boundaries.
  - Keeps clipping bounded and idempotent.
- `src/runner/run.js`
  - Validates the exact final message payload immediately before each bridge request.
  - Reconstructs parallel transcript results into a single result batch.
  - Persists and restores the failed-batch streak.
- `src/runner/kernel/contract.js`
  - Adds `message_contract_error` as a local stop reason.
- `src/runner/beginner-hints.js`
  - Explains the local contract stop without blaming the bridge.

### Tool-failure recovery

- `src/runner/tool-pipeline.js`
  - Counts fully failed batches rather than individual failed calls.
  - Resets on progress or a human permission decision.
- `src/runner/confirmation.js`
  - Provides the three-choice foreground recovery prompt.

### Profile retirement and child authority

- `src/runner/tool-visibility.js`
  - Replaces profile layering with explicit visibility gates and allowlists.
- `src/runner/tools/spawn-agent.js`
  - Defines a generic read-only child with seven explicit tools.
- `src/runner/worker-runtime.js`
  - Removes profile application and keeps child options beneath parent settings.
- `bin/local-bridge-runner.js`
  - Removes the retired profile CLI surface.
- `docs/archive/runner-profiles/`
  - Contains non-executable historical source and tests with `.txt` suffixes.

### Tests

- `test/runner/message-contract.test.js`
- `test/runner/profiles-retired.test.js`
- Updated agent-loop, compaction, resume, confirmation, pipeline, child-agent, output, context-policy, and beginner-hint tests.

## Verification evidence

Final implementation checks for the Option 1 containment slice (P0-04–P0-06 + P1-03):

- Repository-wide Node test suite: **574/574 passed**.
- Runner-only test suite: **537/537 passed**.
- `npm run lint`: passed.
- `npm run check:docs`: passed (still reports package default `claude-sonnet-4-5` — P2-15 blind spot unchanged).
- `npm run format:check`: passed.
- `git diff --check`: passed.

No live bridge canary was run in this slice; typed 401 fail-fast is covered by unit tests. Refresh Claude Code / VS Code credentials before any paid multi-turn canary.

## Live canary status

A tightly capped, read-only Sonnet 4.5 canary reached the local bridge but stopped before any model tool call:

1. First response: HTTP 401, “Invalid authentication credentials.”
2. Existing retry: HTTP 401, “x-api-key header is required.”
3. Model usage: zero input and zero output tokens.

This does not invalidate the local P0-01 tests. It does establish two important continuation facts:

- the live bridge/Claude credential state needs to be refreshed before the next paid canary;
- deterministic HTTP 401 currently consumes the general retry path, reinforcing the assessment's recommendation for typed fail-fast 4xx handling.

Do not “fix” the second response by restoring an upstream `x-api-key` success path. This repository intentionally remains OAuth-only and Anthropic-native.

## Remaining work and recommended order

### Next session chunk (approved stop point after P0-09)

1. **P0-10 — permission cache across root changes**
   - Include canonical root identity in every permission-decision cache key.
   - Invalidate on worktree / cwd scope changes.
   - Re-confine immediately before each I/O; restore undo only to currently validated paths.
2. **P0-11 — centralized redaction**
   - One redaction service used by stdout, JSON, stream-json, SSE, model text, tool inputs, transcripts, ledgers, archives, human logs, and hooks before fan-out.
3. **P0-12 — private session and ledger files**
   - Create private run-bundle directories at 0700 and files at 0600.
   - Label canonical resume state as sensitive; define `--no-session-persistence` as disabling resumable state only—not diagnostics.

Use `docs/runner-p0-next-session-handoff-2026-07-18.md` as the agent entrypoint for that chunk.

### After P0-10–12

4. **Full P0-06 repair** — argv `apply_patch`, atomic writes, hunk validation, rollback (after quarantine).
5. Continue the assessment sequence: monotonic authority ceiling, evidence-capable plan mode, private telemetry finalizer, compatibility doctor, recovery/session completion, built-ins/templates/skills, documentation rewrite.

Confirm the exact P0 numbering against the annotated assessment before coding.

## Non-obvious traps for the next agent

- Do not equate “results may arrive out of order” with “messages may be arbitrarily interleaved.” Result order is flexible; batch membership and adjacency are strict.
- Do not silently repair malformed resumed history. Preserve the evidence and fail locally with a clear contract error.
- Do not count each failed parallel tool as a separate recovery strike.
- Do not count a user's denied confirmation as a tool malfunction.
- Do not restore agent or capability profiles to solve a template need.
- Do not let a child worker inherit more authority than its parent, even if a future template requests it.
- Do not treat regex command scanning as an operating-system sandbox.
- Do not interpret `--dont-ask` as permission to expose shell.
- Do not restore `/v1/models`, OpenAI-compatible endpoints, API-key fallback, captured `x-api-key` replay, or prohibited auth behavior while implementing the compatibility doctor.
- Do not claim the live bridge canary passed until credentials are refreshed and a real multi-turn tool loop completes.
- Do not treat a green `npm run check:docs` as proof that runner defaults agree; it currently misses the 4.5-versus-4.6 default split.
- Preserve the original assessment evidence. Add dated status annotations rather than rewriting historical observations as though they were never true.

## Resumption checklist

1. Read `AGENTS.md` completely.
2. Run the repository identity checks at the top of this document.
3. Confirm local `main` matches `origin/main` before editing.
4. Read the annotated status section at the top of the assessment.
5. Read the full finding being implemented, including alternatives and acceptance criteria.
6. Read the directly relevant postmortem.
7. Add a failing regression test before or alongside the fix.
8. Keep changes in the runner/docs lane unless bridge internals are strictly required.
9. Run focused tests, then runner tests, then the broader repository checks.
10. Record skipped checks and live-canary limitations honestly.

## Publication note

This handoff, its HTML companion, the annotated assessment, and the P0-01 through P0-03 implementation are intended to be committed together directly to playground `main`. No canonical-repository promotion or pull request is part of this handoff.
