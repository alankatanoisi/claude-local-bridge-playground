# VS Code existing/debug bridge repair and T3 verification — November 11, 2026

The ordinary VS Code bridge is installed, active on **port 11437**, and verified through the visible T3 interface. A fresh T3 Bridge Runner chat selected **Haiku 5.5 → VS Code — existing/debug**, sent a bounded synthetic prompt with no tools, and displayed **T3_VSCODE_BRIDGE_OK**.

## Folder, branch, and initial state

- Repository and current folder: `/Users/alanman/Developer/claude-local-bridge-playground`.
- Branch: clean, current `main`, starting at `1fac44f`; `git pull --ff-only origin main` reported already up to date.
- Remote: `https://github.com/alankatanoisi/claude-local-bridge-playground.git`.
- Initially, port 11437 had no listener and ordinary VS Code had no Claude Local Bridge extension installed. Standalone was the only managed mode running.
- The source already contained the verified 2.1.322 fingerprint and the current-account Keychain lookup fix from the preceding maintenance commit. No additional transport or credential-source changes were needed.

## Repair performed

Installed the current verified local VSIX (VS Code extension package) into ordinary VS Code using its supported command-line installer. The source package was `/Users/alanman/Library/Application Support/Claude Bridge Lab/releases/2026-11-12T00-23-48-992Z-98346d/claude-local-bridge.vsix`.

The resulting ordinary extension is `/Users/alanman/.vscode/extensions/alankatanoisi.claude-local-bridge-1.0.0`. All **152 installed source files** match the repository byte for byte. Its saved fingerprint is **Claude Code 2.1.322**. It activated without a separate debug launch and reported Keychain credentials in the editor status bar. Port inspection identified the listener as a VS Code extension-host process.

The T3 host selector remains connect-only for `vscode`: submitting a prompt may connect to the existing editor, but does not install, launch, restart, or stop it. Installing the extension was a separate, explicitly authorized maintenance action. Ordinary VS Code must remain open for this option to work.

## Verification results

| Check                                                          | Result                                                                                      |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Installed ordinary extension fingerprint and source comparison | Passed: 2.1.322 and 152 exact file matches                                                  |
| Direct Haiku 5.5 request to port 11437                         | Passed: HTTP 200, expected synthetic answer                                                 |
| Normal response through the generalized live verifier          | Passed: HTTP 200                                                                            |
| Reconstructed streaming response                               | Passed: HTTP 200                                                                            |
| Real runner list_files loop in a synthetic temporary folder    | Passed: one tool call and one successful tool result                                        |
| Visible T3 chat using VS Code — existing/debug                 | Passed: T3_VSCODE_BRIDGE_OK, Haiku 5.5                                                      |
| Four-host ACP selector rerun                                   | Passed for vscode, standalone, desktop, and browser; one completed connection card per host |

The visible T3 test chat is titled **Bridge Connection Smoke Test**. Existing failed chats were preserved. The test did not inspect project files or request tools.

An additional protocol check used T3's actual executable, `bin/t3-bridge-runner.sh`, then selected each host through `session/set_config_option` with `configId: bridge_host`. Each host used a fresh session, Haiku 5.5 at low effort, a synthetic no-tools prompt, and an expected reply. A pass requires a normal end-of-turn response plus exactly one completed connection activity card.

The first four-host attempt passed VS Code and standalone but hit desktop's readiness deadline on a cold start. Private startup logs showed the dedicated desktop extension subsequently activated successfully on port 11447 with Keychain credentials. The healthy job was not killed or replaced; the check was rerun. The timeout is retained as first-run evidence, not rewritten as a first-attempt pass. The Mac was under substantial load, so cold editor startup can still require a retry.

## Repository changes

- `scripts/hosting/verify-live.js` now also accepts `vscode`. Managed modes retain their job and listener-ownership checks. The ordinary editor is probed without any start/stop/install operation; its evidence explicitly records `managed: false` and `listenerOwned: null` rather than claiming controller ownership.
- Mirrored `.agents/skills/bridge-maintenance/SKILL.md` and `.cursor/skills/bridge-maintenance/SKILL.md` now cover explicitly requested ordinary VS Code installation, source comparison, and visible T3 testing.
- This dated Markdown report and its standalone HTML companion retain the results and practical instructions.

The installed extension and local T3 test chat are machine-specific application state. They are not committed to Git. Raw logs, credentials, screenshots containing private terminal data, and session payloads are excluded.

## Checks run and checks skipped

- Focused standalone-host, ACP host-selection, ACP agent, and T3 shim tests: **66 passed**, zero failed/skipped/TODO.
- Lint, documentation defaults, runner manifest, cross-surface agent/skill synchronization, full formatting, and Git whitespace checks: passed before handoff.
- The ordinary VS Code live verifier completed all three real checks successfully.
- Full runner and Starlark suites were not repeated for this follow-up. The prior maintenance run passed 1,380 runner tests and 128 Starlark tests. This follow-up changes the acceptance script and documentation only; runtime modules are unchanged. Those earlier counts are historical evidence, not a fresh run in this follow-up.

## Using the repaired option

In **T3 Code**, select **Bridge Runner (Local ACP)** in the model menu, choose a model, then set **Bridge host → VS Code — existing/debug**. Keep ordinary **Visual Studio Code** open. A successful prompt displays its answer and a completed bridge connection card.

If port 11437 becomes unavailable, open ordinary VS Code, press **Shift–Command–P** to open its command menu, type **Claude Local Bridge: Start Server**, and select that command. Success is a status-bar entry showing **Claude Bridge :11437 [keychain]**. If the command is missing, the extension is not installed in that VS Code profile. If a different port appears, another process may already occupy 11437; inspect it rather than stopping an unknown process.

For an optional repeat of the scripted live check, open **Terminal** by pressing Command–Space, typing Terminal, and pressing Return. Paste the following into Terminal:

```bash
# Move Terminal into the actual playground folder before running its script.
cd /Users/alanman/Developer/claude-local-bridge-playground

# Test the already-running ordinary VS Code bridge; this does not start it.
node scripts/hosting/verify-live.js vscode
```

Success is a result with `mode: vscode` and all three checks reporting `passed: true`. An unavailable-bridge error means VS Code or its bridge must be started first. An HTTP 401 means the local Claude login needs inspection; do not add an upstream API key as a workaround.

## Final state and limits

Final managed state is restored to standalone running; ordinary VS Code remains open with its bridge active. Desktop and browser test jobs are stopped after verification. Git commit/push and exact local/remote revision equality are recorded in the final chat handoff after the push completes.

This confirms synthetic requests through the installed ordinary extension and T3's host selector. It does not establish endurance, reboot behavior, every model, or another machine's installation. A previously failed session can retain its recovery warning; the fresh acceptance chat demonstrates a working connection without bypassing recovery checks.

A concrete credential exposure was observed in a pre-existing T3 terminal panel. The panel was hidden before testing, and the token was not copied into this report. Revocation or renewal of that displayed token remains an owner follow-up; this task did not change the login.
