# T3 ACP four-host integration — implementation handoff

October 16, 2026 · Agent-facing record with a browser-readable companion

**Implemented and migrated on the 2020 laptop; original VS Code successful acceptance remains pending.** Do not read this as all-four-host live signoff or as Cursor invariant-review signoff. This implementation snapshot was prepared before its commit. Alan subsequently authorized committing and synchronizing all 20 intended files; that save operation does not close the outstanding live acceptance or actual Cursor review.

## Location, ownership, and starting point

- Folder: `/Users/alanman/Developer/claude-local-bridge-playground`.
- Branch: `main`; starting committed revision `0011586410412e96b47047e82fe028c21d0b6f21`, after the separate fingerprint work completed and released the clean, pulled checkout.
- The current dirty files belong to this integration. Keep the single-editor ownership rule; do not have another agent edit these files concurrently.
- Scope: runner ACP (Agent Client Protocol), managed-host connection policy, local T3 migration, tests, and paired HTML/Markdown documentation. Upstream auth, proxy, fingerprint data, and ordinary editor settings were not edited.
- Alan explicitly authorized commit, push, and synchronization after checking the 20-file change set. The 2024 laptop migration and machine configuration remain separate.

## Behavior and implementation map

| Files                                                                                                              | What changed                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bin/t3-bridge-runner.sh`                                                                                          | New generic Local ACP launcher. Standalone default, existing Node resolution, trust and explicit shell opt-in retained. Old Cursor shim retained.               |
| `bin/local-bridge-acp.js`                                                                                          | Host-selection opt-in, fixed-URL conflict rejection, loopback VS Code override, private caller-token forwarding. Legacy clients remain fixed-URL.               |
| `src/hosting/ensure.js`                                                                                            | Four choices and deadlines, selected-host-only ensure, no ordinary VS Code lifecycle calls, no fallback or model replay.                                        |
| `src/hosting/connection-operations.js`                                                                             | Async macOS operations, existing socket lock, job/listener ownership, bootstrap or non-killing kickstart, deduplicated browser activation. No stop API.         |
| `src/hosting/control.js`                                                                                           | Exposes ensure and its adapter; old exclusive manual start operation unchanged.                                                                                 |
| `src/runner/acp/agent.js`                                                                                          | `bridge_host` selector, turn snapshot, local connection card, cancellation, endpoint injection, selection restore, unique activity identifiers across restarts. |
| `src/runner/acp/host-settings.js`                                                                                  | Private schema-versioned enum companion beside the checkpoint; validated identifiers, no-follow reads, exclusive temporary files and atomic replacement.        |
| `test/bridge-host-ensure.test.js`, `test/bridge-host-operations.test.js`, `test/runner/acp-host-selection.test.js` | Host policy, real socket-lock adapter tests with mocked subprocesses, ACP session/persistence/compatibility checks.                                             |
| `test/runner/false-green-telemetry-sink.test.js`                                                                   | Registers the reviewed companion writer, which passes structured state through the common scrubber.                                                             |
| `test/runner/false-green-oracle-strength.test.js`                                                                  | Registers one intentional macOS-only launchctl test; other adapter tests remain portable.                                                                       |
| `docs/t3-bridge-host-integration.md`, `.html`                                                                      | Current setup, architecture, customization scope, recovery, and explicit evidence limits.                                                                       |
| `README.md`, old hosting guide pair, dated September T3 guide                                                      | Point to the new route and distinguish ensure from exclusive manual Start.                                                                                      |
| This handoff and its HTML companion                                                                                | Review findings, evidence, remaining acceptance, and next-agent boundaries.                                                                                     |

The generic launcher preserves shell availability from Alan’s existing explicit launcher configuration. Host selection does not grant shell or bypass approvals. The guide explains a direct ACP command without `--allow-shell` for an intentionally shell-free provider.

## T3 machine migration

The existing `acpRegistry_bridge_runner` instance was changed in place using T3’s interface. Display name is **Bridge Runner (Local ACP)**. Executable is the absolute repository path to `bin/t3-bridge-runner.sh`, with empty arguments. The old `BRIDGE_RUNNER_BRIDGE_URL` was removed; `BRIDGE_RUNNER_NODE=/Users/alanman/.local/bin/node` and `BRIDGE_RUNNER_CAPABILITIES=edits` were retained. Provider instance identity and model preferences were preserved. The old Cursor bridge instance remains disabled.

T3 version exercised: `0.1.1-nightly.20261016.3190`. Test chat: **Bridge Integration Acceptance Test**. Model: Haiku 4.5. Mode: Ask. Working project/environment: 2020 laptop playground. No model write tools or shell were used in live acceptance.

Machine settings and runner session/campaign artifacts remain private local state outside Git. Do not copy settings, checkpoint bodies, trace payloads, passwords, tokens, or account identifiers into a report or commit.

## Independent invariant review

An independent Codex reviewer performed read-only review and a final follow-up; this is **not** actual Cursor signoff. The final follow-up reported no new actionable findings and 24 focused tests passing.

| Finding                                                                                           | Resolution and verification                                                                                                                                              |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P2: loaded desktop job with no PID was treated as a live job                                      | Ensure now waits only for an actual PID. A loaded stopped job uses `kickstart` without `-k`; unloaded uses bootstrap. Policy and adapter tests pass.                     |
| P2: a saved selection without a model checkpoint could not reload after a failed first preflight  | A valid settings companion now permits load with no model history; the next request starts without resume. Unknown sessions and invalid settings still fail explicitly.  |
| Live UI: T3 replaced a missing update title with “Tool” and displayed structured output awkwardly | Local connection updates repeat their title, kind and origin metadata and use plain-text details. Failure and success were inspected in T3.                              |
| Live UI: process-local connection counters repeated after a T3 restart                            | Activity IDs now include a random UUID (universally unique identifier); fresh-agent regression test verifies that a restored turn cannot reuse the previous activity ID. |

## Not bugs — do not change these boundaries

- Original VS Code is connect-only even if an editor happens to be running. No launch/restart/stop/settings changes and no nearby-port scan.
- A responsive original endpoint proves connection, not editor-process ownership. Managed hosts retain controller ownership checks.
- Discovery, creating a session, changing a selector, and listing models remain passive.
- Failed preflight submits no model request. Failures do not select another bridge or replay an entire prompt.
- Configuration changes during a turn take effect next turn; one turn keeps one endpoint.
- The connection activity uses ACP’s tool-card transport but is explicitly local controller work, not a model tool.
- Canceling or closing a chat does not stop shared services. Other managed hosts remain running.
- Browser activation needs its editor tab and sometimes Alan’s login; no password is copied or displayed by ensure.
- The old manual Start controls remain exclusive and can stop other dedicated modes. T3 uses ensure instead.
- The companion stores only the host enum and format version, not credentials, URLs, model configuration, or conversation payloads.

## Live evidence and limits

| Acceptance item                                                     | Evidence                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Standalone from stopped state                                       | Real T3 reply `STANDALONE_OK MAPLE-2020`; service automatically started.                                                                                                                                                                         |
| Dedicated Desktop from stopped state                                | Same T3 chat replied `DESKTOP_OK MAPLE-2020`; Standalone stayed running.                                                                                                                                                                         |
| Browser from stopped state                                          | Same T3 chat replied `BROWSER_OK MAPLE-2020`; editor opened; other two hosts stayed running.                                                                                                                                                     |
| Original VS Code unavailable                                        | Port 11437 had no listener; T3 gave the exact requested next-action message; no automatic lifecycle/fallback.                                                                                                                                    |
| Selection after T3 restart                                          | Existing/debug selection was restored after quitting/reopening T3.                                                                                                                                                                               |
| Conversation after T3 restart                                       | Switching to Standalone then replying returned `RESTORED_OK MAPLE-2020`.                                                                                                                                                                         |
| Readable local connection activity                                  | Failure and success titles/details inspected in T3 after final presentation fixes.                                                                                                                                                               |
| Simultaneous different-host sessions                                | Two scripted real ACP clients completed overlapping Standalone/Desktop prompts in 2.516 seconds. This is protocol/runtime evidence, not two simultaneously clicked T3 chats.                                                                     |
| Constrained read-only tool loop                                     | Standalone emitted one real tool event and completed `TOOL_LOOP_OK` in a disposable private fixture; shell/writes unavailable to that harness.                                                                                                   |
| Streaming and cancellation                                          | Real streamed chunk followed by ACP cancellation; settled as cancelled after 115 ms.                                                                                                                                                             |
| Recovery                                                            | First recovery hit the deliberately small 256-token output limit. A separate load of the same saved session with 512 tokens completed `AFTER_CANCEL_OK`. Preserve the first failed test result; do not call the initial campaign entirely green. |
| Shared-service health                                               | All three jobs remained running with owned, ready listeners after the scripted checks; the same job PIDs survived that campaign.                                                                                                                 |
| Original success, visibility, and Standalone-to-original continuity | **Pending Alan starting the ordinary/debug bridge.** No corresponding successful original request was claimed.                                                                                                                                   |
| Browser login from a signed-out state                               | Not separately exercised; existing browser authentication was available. Mock tests cover activation waits/timeouts.                                                                                                                             |
| Two concurrent T3 UI chats and T3 Stop button                       | Scripted ACP concurrency/cancellation verified; separate full UI exercise remains outstanding.                                                                                                                                                   |
| 2024 laptop                                                         | Outside this migration and acceptance.                                                                                                                                                                                                           |

The T3 Browser turn’s displayed one-file diff came from the implementing agent editing presentation code concurrently, not a model tool. Subsequent UI turns were run without concurrent source edits to avoid that misleading attribution.

Campaign limit: $3. Through the nine recorded runner outcomes, estimated model cost was **$0.0381434**, with **$2.25 conservatively reserved** for bounded prompts. Failed unavailable-original checks made no model request. The private campaign is under `~/.bridge-runner/campaigns/t3-acp-hosts-2026-10-16/`; only aggregate usage was reported, never ledger payload text.

## Checks, first failures, and final status

Focused host/adapter/ACP checks: **24 passed**. The source-output and assertion guards also passed after their required reviewed-register updates. Lint and documentation checks passed. `git diff --check` passed.

The earlier full run after adding adapter tests had 1,186 tests: 1,184 passed, one failure from the unregistered intentional macOS-only test, and one existing TODO. The skip-register entry was added with its environment explanation, then its focused regression suite passed (14 tests). **Final full suite: 1,186 total, 1,185 passed, zero failures, zero skips, one existing TODO; 129.0 seconds.** The corrected full run is logged at `/tmp/t3-acp-final-confirmed-suite.log`.

Formatting checks report three pre-existing root handoff files; these were left unchanged:

- `HANDOFF-golden-eval-he06-thermo-nuclear-2026-09-06.md`
- `HANDOFF-permission-cache-thermo-nuclear-2026-09-07.md`
- `HANDOFF-starlark-r11-thermo-nuclear-2026-09-06.md`

The existing HS-01 case-variant private-key test remains an explicit TODO. This task does not close that unrelated safety limitation.

The new HTML guide’s section parity, local links and navigation were checked against Markdown. Browser automation was disabled in Work settings, so a browser-rendered guide screenshot was not obtained. The HTML was opened/queued in the current Codex file panel and contains no external scripts, fonts or analytics.

## Next steps and retained state

1. Alan starts the intended ordinary VS Code bridge himself using **Shift–Command–P → Claude Local Bridge: Start Server**. Confirm its actual port; use the validated provider override only if necessary.
2. Continue the existing test conversation through original/debug and inspect the corresponding request in that VS Code diagnostic surface without exposing tokens. Record successful model response and editor visibility as separate claims.
3. Complete the remaining two-chat/Stop UI acceptance if needed; respect the remaining campaign reservation and $3 maximum.
4. Obtain the actual Cursor invariant review required by the repository charter. Give Cursor this handoff and the current working diff; do not claim the independent Codex review replaced it.
5. Alan authorized saving and pushing this implementation checkpoint. Verify local and remote revision equality after that operation; treat 2024 migration as a separate action.

All three managed hosts intentionally remain running so other chats are not interrupted. The test chat is left on working Standalone with the selector available. Original VS Code was not started or changed. No installation replacement, upstream credential change, branch reset, or canonical-repository operation was performed. Commit/push synchronization is authorized as a subsequent save step; the final Git revision and push verification are reported in chat.

## Companion guide

- [Setup and architecture guide](docs/t3-bridge-host-integration.html)
- [Markdown setup guide](docs/t3-bridge-host-integration.md)
- [Browser-readable handoff](HANDOFF-t3-acp-hosts-2026-10-16.html)
