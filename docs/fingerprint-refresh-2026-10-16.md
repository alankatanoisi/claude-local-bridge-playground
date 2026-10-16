# Claude Code fingerprint refresh — October 16, 2026

The repository fallback fingerprint and all three current managed bridge installations now use Claude Code **2.1.301**. A fresh localhost capture supplied the values. The final fingerprint check completed with **no drift**. Standalone, desktop, and browser each passed a real model request returning **BRIDGE_OK**.

## Folder, branch, and scope

- Repository: `/Users/alanman/Developer/claude-local-bridge-playground`.
- Remote: `https://github.com/alankatanoisi/claude-local-bridge-playground.git`.
- Started on clean, current `main`; `git pull --ff-only origin main` reported already up to date.
- The supported prepare command created `codex/fingerprint-refresh-2026-10-16`. A branch is a named line of Git work that keeps these changes separate from main.
- Owner authorized committing, pushing, and synchronizing all three modes after desktop and browser validation. Git destination: playground `main`. The final chat handoff records the actual commit and remote synchronization verification.
- Installed snapshot: `/Users/alanman/Library/Application Support/Claude Bridge Lab/releases/2026-10-16T08-33-48-271Z-c6fac6`.

## What changed

| Field                              | Before                                                   | Verified replacement                   |
| ---------------------------------- | -------------------------------------------------------- | -------------------------------------- |
| Verification date                  | 2026-09-28                                               | 2026-10-16                             |
| Claude Code version                | 2.1.283                                                  | 2.1.301                                |
| User agent (client identification) | claude-cli/2.1.283 (external, sdk-ts, agent-sdk/0.3.276) | claude-cli/2.1.301 (external, sdk-cli) |
| Anthropic software library version | 0.112.1                                                  | 0.128.0                                |

Other stable header values stayed the same. The agent identity sentence stayed the same. The fallback billing block remains `null`, which means no saved billing block.

Today's earlier 01:09 Pacific check observed billing-block presence. The fresh prepare capture and final check observed no billing block. These are separate observations; the earlier record has not been rewritten. No billing value was copied, invented, or saved. Capability-specific and unreviewed beta flags remain excluded from the saved fallback.

## Dependent components

`src/credentials.js` and `src/fingerprint.js` already read the shared JSON fingerprint file. Updating that file updates their fallback values without changing either JavaScript module. The runner uses the bridge's transport and has no separate copy of these version values.

The supported installer rebuilt the current managed source snapshot and both editor extension packages. Each installed fingerprint file matches the repository file byte for byte:

- Standalone source snapshot: version 2.1.301, exact match.
- Dedicated desktop extension: version 2.1.301, exact match.
- Dedicated browser extension: version 2.1.301, exact match.
- SHA-256 checksum (a content identity used to compare files): `3a90d7d08fb8c0083fbb20da9953afc7dd35408c8f9079e7084a279aa9fc05b4`.

The installer refreshed the local installation manifest and Finder launchers. Standalone was the only managed mode running before installation. During follow-up validation, the supported controller switched to desktop on port 11447, then browser on port 11457. The local code-server editor at port 18080 was opened in Edge and its extension activated. Each mode passed its live model check. Standalone was then restored on port 11467; desktop and browser are stopped because the controller runs one managed mode at a time. No ordinary bridge listener was detected on port 11437. No separate ordinary bridge installation was found in the standard VS Code, VS Code Insiders, or Cursor extension folders checked. Historical installation snapshots remain historical copies.

## Validation and first-run evidence

- The initial supported `npm run fingerprint:prepare` captured the new values and prepared the patch. Its focused validation failed because the existing test explicitly expected 2.1.283; that failure was reproduced before updating the expectation. Its full-suite gate also reported failure. The original prepare record is preserved.
- After updating the test expectation, all **47 focused fingerprint and bridge tests passed**.
- A separately run full `npm test` completed successfully: **1,162 tests; 1,161 passed; zero failed; one TODO; zero skipped**. Duration: approximately 127 seconds. TODO means the repository marks a known unfinished test; it is not counted as a passing test.
- `npm run lint`: passed.
- `npm run check:docs`: passed.
- Formatting checks for the changed JSON and JavaScript files: passed.
- `git diff --check`: passed.
- Final `npm run fingerprint:check`: completed, local and npm latest versions both 2.1.301, no header or system-block differences, no drift.
- Installed fingerprint files: all three exact matches.
- `node bin/bridge-hosts.js test standalone`: passed with a real model response, BRIDGE_OK.
- Follow-up `node bin/bridge-hosts.js test desktop`: passed with a real model response, BRIDGE_OK.
- Follow-up `node bin/bridge-hosts.js test browser`: passed with a real model response, BRIDGE_OK, after the browser editor activated its installed extension.

The full `npm run format:check` reports warnings in three unchanged root handoff files: `HANDOFF-golden-eval-he06-thermo-nuclear-2026-09-06.md`, `HANDOFF-permission-cache-thermo-nuclear-2026-09-07.md`, and `HANDOFF-starlark-r11-thermo-nuclear-2026-09-06.md`. Those unrelated documents were left unchanged.

## Files changed and evidence

- `src/claude-code-fingerprint-fallback.json`: refreshed verified identity.
- `test/fingerprint-automation.test.js`: updated explicit version expectation and explanatory comments.
- `docs/automation-ledger/fingerprint-checks/2026-10-16T08-32-52-841Z-prepare.md` and `.html`: original preparation result, including failed initial validation.
- `docs/automation-ledger/fingerprint-checks/2026-10-16T08-34-12-442Z-check.md` and `.html`: final no-drift check.
- `docs/fingerprint-refresh-2026-10-16.md` and `.html`: this handoff.

Private local sanitized JSON records are under `/Users/alanman/.bridge-runner/fingerprint-checks/`. The direct full-suite log is `/tmp/claude-fingerprint-full-2026-10-16.log`; the focused log is `/tmp/claude-fingerprint-focused-2026-10-16.log`. Temporary logs may disappear later.

## Limits and remaining work

All three modes were verified on disk and each passed a separate live model check. Streaming and a runner tool loop were not separately exercised during this fingerprint-only refresh. The real responses establish that the updated installed fallback worked for those requests; they do not establish every model or future session. The other Mac and the separate Codex playground were outside this task's local installation scope.

The update is active locally in standalone and ready for the other two managed modes when started. The desktop and browser live checks close the earlier verification gap; no additional fingerprint code changes were necessary.
