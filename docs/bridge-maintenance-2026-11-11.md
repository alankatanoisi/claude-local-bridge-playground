# Bridge fingerprint, model catalog, and T3 maintenance — November 11, 2026

All three managed bridge modes now use the verified Claude Code **2.1.322** fingerprint. Each mode passed a normal model response, a reconstructed streaming response, and a real runner `list_files` tool loop. The final capture reports **no drift**. T3's visible Bridge Runner model picker now includes the four new catalog entries.

## Location and Git scope

- Folder and repository root: `/Users/alanman/Developer/claude-local-bridge-playground`.
- Remote: `https://github.com/alankatanoisi/claude-local-bridge-playground.git`.
- Started on clean, current `main` at `90ed816`; pulled before editing.
- The supported fingerprint preparation command created `codex/fingerprint-refresh-2026-11-11`.
- Owner authorized commit, push, and synchronization to playground `main`. Actual final commit and remote equality are recorded in the chat handoff after publication.
- No other worktree, other Mac, canonical repository, or sibling Codex playground was updated.

## Verified fingerprint delta

| Field                  | Previous fallback                      | Fresh local capture                    |
| ---------------------- | -------------------------------------- | -------------------------------------- |
| Claude Code            | 2.1.301                                | 2.1.322                                |
| User agent             | claude-cli/2.1.301 (external, sdk-cli) | claude-cli/2.1.322 (external, sdk-cli) |
| Runtime identification | v26.3.0                                | v26.12.1                               |
| Verification date      | 2026-10-16                             | 2026-11-11                             |

The Anthropic library identification remains 0.128.0. Other stable headers and the short agent identity sentence were unchanged. The observed billing block was absent and the saved fallback remains `null`. Captures used dummy credentials and a localhost mock. No credentials, billing values, session identifiers, or raw captured request bodies were saved in Git.

Ledger filenames use UTC, so these November 11 Pacific records begin with `2026-11-12`. The original preparation result is `docs/automation-ledger/fingerprint-checks/2026-11-12T00-18-28-536Z-prepare.md`; the final no-drift result is `2026-11-12T00-28-56-164Z-check.md`. Both have HTML companions. Initial failures are preserved.

## Model catalogs and T3

The catalog revision is `2026-11-11-fable-5-2-sonnet-haiku-5-5`. New identifiers are `claude-fable-5-2`, `claude-mythos-5-2`, `claude-sonnet-5-5`, and `claude-haiku-5-5`. The shared default remains `claude-sonnet-5`. Older choices remain selectable.

- New point releases have separate entries before broader family matchers, with dated official provenance. Fable 5.2's rate is $8 input/$40 output per million tokens, with $0.20 cache reads and $16 one-hour cache writes. Mythos shares its specifications and pricing, with limited availability. [Official Fable 5.2 page](https://platform.claude.com/docs/en/models/fable-5-2/overview), checked November 11.
- Sonnet 5.5 has its own $0.10 cache-read rate. Its thinking cannot be fully disabled; the runner rejects `thinking off`. The separate upstream `between_tools` mode is not added by this change. [Official Sonnet 5.5 page](https://platform.claude.com/docs/en/models/sonnet-5-5/overview), checked November 11.
- Haiku 5.5 has prompt-size pricing tiers: up to 100,000 prompt tokens uses $0.10/$0.50 input/output; above that uses $0.50/$2.50. Cache reads and writes count toward prompt size. Unknown prompt sizes use the higher tier for conservative projections. [Official Haiku 5.5 page](https://platform.claude.com/docs/en/models/haiku-5-5/overview), checked November 11.
- All four additions support the five existing effort levels. Haiku 5.5 accepts disabled thinking only through high effort. [Official effort documentation](https://platform.claude.com/docs/en/build-with-claude/effort), checked November 11.
- Both command builders advertise the new identifiers. Validation caught the second builder applying older Sonnet 5 rules to Sonnet 5.5 because the default entry came first. Lookup now uses the longest matching identifier, preserving the existing default and point-release behavior.
- The generic ACP agent reports a version containing the catalog revision. The historical Cursor-style shim's dated version was also bumped. ACP means Agent Client Protocol, the message format T3 uses to communicate with the runner.

T3's actual configured executable is `/Users/alanman/Developer/claude-local-bridge-playground/bin/t3-bridge-runner.sh`. A protocol check through that executable confirmed 10 models in both `session/new` and `cursor/list_available_models`, accepted all four new selections, and completed a live Haiku 5.5 prompt. UI inspection initially found six cached models. Refreshing status and reloading the interface were insufficient; briefly disabling and re-enabling only the idle Bridge Runner provider refreshed it. Final settings showed all four additions enabled, and the composer menu visibly listed them under Bridge Runner (Local ACP). Executable and environment settings were preserved.

## Authentication repair found during live validation

The first standalone acceptance request failed with HTTP 401. Claude Code reported a valid existing login, but the bridge reported no Bearer token. Metadata inspection found two Keychain entries for the same Claude Code service: the unscoped lookup selected an entry with no Claude login token, while the current macOS account's entry contained a current token.

`src/credentials.js` now selects the current macOS username with a separate `-a` argument using `execFileSync`. Separate arguments avoid shell interpretation of usernames. No Keychain item, password, account scope, or upstream authentication fallback was created or changed. A regression test recreates duplicate-service selection using synthetic credentials and checks the exact account-scoped arguments; it accesses no actual Keychain data.

## Installed copies and live results

Current installed snapshot: `/Users/alanman/Library/Application Support/Claude Bridge Lab/releases/2026-11-12T00-23-48-992Z-98346d`.

All **152 runtime source files** in each of the standalone source snapshot, dedicated desktop extension, and dedicated browser extension match the repository byte for byte. All three carry fingerprint 2.1.322. Installation was rerun after the credential repair so the saved copies include that fix.

| Mode       | Port  | Normal response  | Streaming | Real runner tool loop                             |
| ---------- | ----- | ---------------- | --------- | ------------------------------------------------- |
| Standalone | 11467 | Passed, HTTP 200 | Passed    | Passed: one list_files call and successful result |
| Desktop    | 11447 | Passed, HTTP 200 | Passed    | Passed: one list_files call and successful result |
| Browser    | 11457 | Passed, HTTP 200 | Passed    | Passed: one list_files call and successful result |

The checks used `scripts/hosting/verify-live.js` and synthetic temporary folders. Streaming was validated by reconstructing text events. Browser's editor was opened and signed into at localhost:18080 using its existing local password; the password was not logged. After testing, standalone was restored and passed another BRIDGE_OK model request. Desktop and browser are stopped because the controller runs one managed mode at a time. Ordinary editors and unowned listeners were not stopped.

Additional bounded model probes:

| Identifier        | Result                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| claude-fable-5-2  | HTTP 200, BRIDGE_OK                                                                                |
| claude-sonnet-5-5 | HTTP 200, BRIDGE_OK                                                                                |
| claude-haiku-5-5  | Live ACP prompt passed, BRIDGE_OK                                                                  |
| claude-mythos-5-2 | HTTP 404, not_found_error; advertised as limited availability, not verified usable by this account |

## Automated validation and failure history

- Initial prepare validation failed on the old pinned fingerprint expectation, which was reproduced before fixing it. Its separate full-suite gate also reported failure; that gate's wrapper has a short timeout/output limit, so it is not treated as a full-suite diagnosis.
- First model-focused run: 164 passed, one failure exposing command-builder point-release shadowing. After repair: **167 passed, zero failures**.
- The first new Keychain test called an internal, unexported function and failed as a test setup error. It was corrected to call the public `getCredentials` entry point; rerun: **25 passed**, including the bridge tests.
- Full suite before the Keychain repair: **1,379 passed**, zero failed/skipped/TODO.
- Final full suite after the runtime repair: **1,380 passed**, zero failed/skipped/TODO; approximately 229 seconds.
- Starlark verification, including evaluator build: **128 passed**, zero failed/skipped/TODO.
- Lint, documentation defaults, runner manifest, cross-surface agent/skill parity, full formatting, and Git whitespace checks passed. One unused test import identified by lint was removed and lint rerun cleanly.
- Final fingerprint check: completed, local Claude Code and npm latest both 2.1.322, no drift.

## New reusable skill

`bridge-maintenance` is an explicitly invoked project skill, mirrored at `.agents/skills/bridge-maintenance/SKILL.md` and `.cursor/skills/bridge-maintenance/SKILL.md`. It covers verified captures, official model facts, both T3 launch paths, cache refresh, account-scoped credential diagnosis, saved installations, real acceptance checks, evidence privacy, paired HTML reports, and authorized Git synchronization. It contains no fixed current model version and performs no automatic background maintenance.

Example future request: "Use bridge-maintenance to check fingerprint drift, refresh models for T3 ACP, test all three modes, then commit, push, and sync."

## Changed files and scope limits

Runtime changes: `src/claude-code-fingerprint-fallback.json`, `src/credentials.js`, `src/runner/model-catalog.js`, `src/runner/model-pricing.js`, `src/runner/acp/agent.js`, `bin/local-bridge-acp.js`, and `bin/t3-cursor-shim.sh`. Both command-builder HTML files, the corresponding fingerprint/model/pricing/ACP tests, the new Keychain regression test, mirrored skill files, and paired dated evidence reports are included.

Raw transcripts, credentials, local installation manifests, browser passwords, and temporary test logs are excluded from Git. Sanitized local hosting results are under `~/.bridge-runner/hosting-verification/`; execution logs are `/tmp/bridge-refresh-*-2026-11-11*.log` and may be temporary.

This validates the tested models and synthetic requests, not every model or an endurance run. Haiku's aggregate run-cost summaries may conservatively use a long-prompt tier when accumulated usage crosses its threshold; they remain estimates, not invoices. This task did not add `between_tools`, 300K batch output, or new default models.

The previously failed T3 chat was configured for the separate ordinary VS Code debug bridge. That host is connect-only and was not restarted or live-tested here; the three managed modes and the actual ACP launcher were tested separately. Old failed conversation history was preserved. Choose the tested Standalone host in T3 for managed operation; an existing degraded session may need a fresh chat rather than bypassing its recovery warning.
