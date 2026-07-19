# Agent Handoff — P0-10 / P0-11 / P0-12 Execution (2026-07-18)

Audience: agents only. Supersedes `runner-p0-next-session-handoff-2026-07-18.md` for these three items.
Source assessment: `docs/runner-runtime-concordance-assessment-2026-07-17.html`.
Human-readable review: `docs/runner-p0-10-12-review-2026-07-18.html`.

## State snapshot (verified 2026-07-19 against live tree)

- P0-01..P0-09: annotated done in the assessment.
- P0-10: **DONE 2026-07-18 (Session A)**. `ctx.rootEpoch` + confined undo-edit restores.
- P0-12: **DONE 2026-07-19 (Session B)**. `src/runner/private-fs.js` + adoption across session/ledger/manifest/transcript/human-log/traces/backups/trust/worktrees. `--no-session-persistence` = resume checkpoints only.
- P0-11: **DONE 2026-07-19 (Session C)**. `src/runner/redaction-boundary.js`; wired into `makeOutput`, SSE stdout, tool-input display copies, session-on-disk, ledger appends. Streaming scrubber uses full `scrubSecrets`.
- Full P0-06 repair: **DONE 2026-07-19**. Pure-JS apply_patch; quarantine retired; still hidden unless `--tools apply_patch`.
- **All P0-01..P0-12 closed.** Next: post-P0 packages.

## Execution order (historical)

1. Session A: P0-10 — done
2. Session B: P0-12 — done
3. Session C: P0-11 — done
4. Session D: full P0-06 apply_patch repair — done
5. Next: post-P0 assessment packages (optional P1 smoke subset remains)

## Session A — P0-10: root-change cache & recovery integrity

Verified evidence:
- `src/runner/permissions.js` `_decisionKey()` (~L130-139): key = toolName + flag bits + argsKey. **No root/cwd token.**
- Decision cache is a per-ctx WeakMap; `src/runner/worktree-utils.js` `activateSlot()` / `deactivateToRepoRoot()` **mutate the same ctx** (`ctx.cwd = entry.path`), so cached decisions survive root swaps. `invalidateDecisionCache` is only called from `tool-registry.js` on write paths, never on worktree transitions.
- `src/runner/tools/undo-edit.js` (~L68-79): validates `entry.path` via `confinePath(ctx)` but **writes `entry.absolute_path`** recorded under the old root.

Plan:
1. Add `ctx.rootEpoch` (integer, default 0). Include it in `_decisionKey`. O(1) invalidation — do not walk/clear the cache.
2. Increment `ctx.rootEpoch` in both `activateSlot()` and `deactivateToRepoRoot()`.
3. In `undo-edit.js`, use the `confinePath` result as the write target; treat `absolute_path` as advisory metadata. If confined path != stored absolute path, refuse with a clear error naming both.
4. Bonus (cheap): clear/epoch the `cachedRealpathSync` cache in `safety.js` on the same transitions.

Tests (add to `test/runner/permission-decision-cache.test.js` + `undo-edit.test.js`):
- Cached allow for `edit_file a.txt` under root A must NOT auto-allow after ctx root changes to B (simulate by mutating ctx.cwd + bumping epoch via the real worktree functions if feasible).
- undo-edit after root change either restores inside current root or refuses; never writes the old-root absolute path.

Targeted check: `node --require ./test/setup.js --test test/runner/permission*.test.js test/runner/undo*.test.js test/runner/worktree-tools.test.js`

## Session B — P0-12: private-by-construction artifacts

Verified evidence:
- `grep -rn "mode: 0o\|0o600\|0o700\|chmod" src/runner` → **zero matches**. All writers depend on umask.
- 21 files call `mkdirSync`/`writeFileSync`. Internal-artifact writers (adopt helper): session-store, session-ledger, transcript, human-log, archive/* (4 files), recovery/run-manifest, golden-eval, memory/auto-memory, memory-review, streaming-write, workspace-fingerprint, workspace-trust, worktree-utils, loop-autopsy, tools/undo (backups), tools/file-write-utils (backup side only).
- **Do NOT force modes on user project files**: `tools/write-file.js`, `tools/apply-patch.js` main write paths are user-facing — leave umask behavior there.
- Reclassification: manifest write under `--no-session-persistence` is now **intentional** (`run.js:333-338` comment; powers `undo last-run`). Keep behavior; apply 0600/0700 and keep manifest content minimal (no message text). Update the assessment annotation accordingly when closing.

Plan:
1. New `src/runner/private-fs.js`: `ensurePrivateDir(dir)` (mkdir recursive `{ mode: 0o700 }` + chmod existing), `privateWriteFileSync(file, data)` (write `{ mode: 0o600 }`; for atomic rename patterns, `chmod` after rename since rename preserves tmp modes).
2. Adoption sweep over internal writers listed above. Watch for `fs.renameSync` temp-file patterns (streaming-write, session-store debounce) — set mode on the temp file at creation.
3. Directories to cover: project `.bridge-runner/**` and home `~/.bridge-runner/**` (backups, worktrees registry, archive catalog).

Tests:
- New `test/runner/private-fs.test.js`: modes on fresh create, pre-existing looser dir gets tightened, rename path keeps 0600.
- Add mode assertions (`fs.statSync(...).mode & 0o777`) to session-ledger/session-store/human-log tests. Skip strict assertions on Windows (`process.platform === 'win32'`).

## Session C — P0-11: centralized redaction boundary

Verified evidence (zero scrub/redact references today in): `run.js` (stdout, `--json`, `--stream-json` emission ~L132-137), `model-client.js` (SSE deltas), `tool-pipeline.js` (tool inputs), `session-store.js`, `session-ledger.js`.
Already redacted: `tool-registry.js` (tool results), `human-log.js`, `transcript.js`, `archive/run-exporter.js`, `hooks/hook-runner.js`, `trace-utils.js`.

Key asset: `safety.js` already exports `makeStreamingScrubber` (streaming-safe, handles secrets split across chunk boundaries) plus `scrubSecrets` / `scrubObject` / `scrubStableIdentifiers`. This is a wiring task, not a design task.

Plan:
1. Create one redaction boundary: a per-run scrubber instance (from `makeStreamingScrubber`) applied at (a) the model-client delta callback before any listener sees text, and (b) the run.js emit chokepoint for text/json/stream-json events.
2. Scrub session-store messages **at append time**, not on every debounce save (perf: avoid O(conversation) per save). Same for ledger prompt previews at record time.
3. Scrub model-authored tool inputs in `tool-pipeline.js` before they reach trace/echo surfaces (execution still receives raw input — scrub display copies only, otherwise you corrupt legitimate file content writes; think carefully and add a test proving a file body containing a token-like string is still written verbatim by write_file while its echo/trace is scrubbed).
4. After boundary lands, audit for double-scrub (tool-registry inner scrub + emit scrub) and de-dupe deliberately.

Tests:
- Mock model stream emits a fake secret split across two SSE chunks → assert absent from stdout, `--json`, `--stream-json`, session file, ledger, trace.
- write_file with token-like content in body still writes verbatim to disk.

Also update: `CLAUDE.md` Safety Rules line (restore the unconditional claim once true), `docs/threat-model.md`.

## Invariants that must survive every session

- Shell hidden unless `--allow-shell`; `--dont-ask` never enables shell.
- Deny matrix (.env, keys, .ssh, .aws, .claude) untouched.
- No OpenAI-compat routes, no API-key fallback (see CLAUDE.md Transport invariants).
- Run before handoff: targeted tests, then `npm test`, `npm run lint`, `npm run check:docs`, `npm run format:check` (expect npm test > 30s; use a background/long-timeout run).
- Beginner-friendly inline comments on non-obvious control flow (CLAUDE.md rule 9).
- When closing each item, annotate the finding block in `docs/runner-runtime-concordance-assessment-2026-07-17.html` the same way P0-01..09 were annotated, and update this file's state snapshot.
