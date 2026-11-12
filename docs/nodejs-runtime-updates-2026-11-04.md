# Node.js updates and validation — November 4, 2026

**November 11 follow-up:** The published security updates and current remaining items are recorded in the [November 11 report](nodejs-security-updates-2026-11-11.html). This document preserves the November 4 execution record.

**Result:** The selected shared runtime is now **Node.js 22.23.4**. The other standalone installation paths were updated, the idle gateway was restarted and verified, and four desktop applications were updated. **One final ChatGPT/Codex quit and reopen remains necessary for three processes attached to this active chat.** Bundled application security coverage still requires vendor verification.

This is the execution record following the [original security assessment](nodejs-security-assessment-2026-11-04.html). Runtime changes were authorized in the same chat. No repository runtime source, model configuration, application account settings, or project version declarations were edited.

## Standalone runtime changes

| Installation                                                | Before           | Verified after                 | Selection and recovery                                                                                              |
| ----------------------------------------------------------- | ---------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Shared local installation, `/Users/alanman/.local/bin/node` | 22.22.3          | **22.23.4**                    | The `node`, `npm`, and `npx` links point to the new installation; old targets and installation retained.            |
| Homebrew Node.js 22                                         | 22.23.3          | **22.23.4**                    | Homebrew package revision `22.23.4_2`; measured through `/opt/homebrew/opt/node@22/bin/node`.                       |
| Homebrew default Node.js                                    | Broken 25.8.2    | **26.13.0**                    | Homebrew package revision `26.13.0_2`; `/opt/homebrew/bin/node` now starts successfully.                            |
| Administrator-owned `/usr/local/bin/node`                   | 24.14.0          | **24.22.2**                    | Updated with the official signed and notarized installer; native Apple Silicon execution verified.                  |
| Node Version Manager installation                           | 26.4.0 available | **26.13.0 added and verified** | Installed in `.nvm/versions/node/v26.13.0`; 26.4.0 remains for recovery. No aliases or shell startup files changed. |

The shared installation's bundled npm package manager and npx command launcher both report **10.9.9**. The system-wide 24.x installation's bundled npm reports **11.19.1** when explicitly run with that Node.js executable.

A new interactive login shell—the startup behavior used by a typical new Terminal window—selected `/Users/alanman/.local/share/nodejs/v22.23.4/bin/node`. The real T3 bridge launcher also selected that executable, then exited successfully when its empty input pipe closed. No model prompt or paid request was sent.

The first update stays within Node.js 22 for the bridge/runner. The newer Homebrew default is separate, and project-specific requirements remain intact. [Node.js 22.23.4 security release](https://nodejs.org/en/blog/release/v22.23.4), [official release index](https://nodejs.org/dist/index.json)

## Process restart and the final user step

The idle `com.alanman.opencode-go-cowork-gateway` service had no established connections before shutdown. It was stopped with a graceful termination signal, started through macOS's service manager, and verified using both its actual executable path and its read-only HTTPS health endpoint. It now uses **22.23.4**. HTTPS certificate verification used the existing local public certificate authority; no private key was inspected or changed.

Three remaining processes using shared Node.js **22.22.3** belong to the active ChatGPT/Codex session or one of its child processes. They were left running so the update work and its verification could finish. Changing an executable-selection link does not replace the executable already loaded by an existing process.

After reading the handoff, save any unsent text, focus the **ChatGPT/Codex desktop app**, choose **Quit** from its application menu or press **Command–Q**, then reopen the app from **Applications**. Merely closing a window may leave background processes running. The app can then start fresh tool processes through the updated shared link. This final restart has **not** been observed or verified in this execution record.

## Desktop application updates

Every replaced application was downloaded from its vendor's distribution host, checked against a published SHA-256 fingerprint, verified with Apple's code-signature tool, checked for the same developer identity as the installed app, and accepted by macOS Gatekeeper. Gatekeeper checks whether macOS accepts an application under its signing and notarization rules. The previous bundles are retained outside Applications with `.app.recovery` suffixes.

| Application        | Application version change | Electron after update | Upstream Node.js baseline |
| ------------------ | -------------------------- | --------------------- | ------------------------- |
| Visual Studio Code | 1.144.1 → **1.145.0**      | 43.8.3                | 24.22.0                   |
| Claude             | 4.4212.0 → **4.16336.0**   | 44.9.3                | 24.22.0                   |
| Antigravity        | 2.24.0 → **2.29.0**        | 44.5.1                | 24.21.0                   |
| Antigravity IDE    | 2.1.1 → **2.6.0**          | 39.2.3                | 22.21.1                   |

The Visual Studio Code command-line entry point was also run successfully and reported **1.145.0**, its new commit identifier, and the native `arm64` architecture. The four applications were not running when their bundles were replaced, so no active editor or Claude session was stopped.

The **upstream Node.js baseline** is the version published for that Electron release. It is inferred from installed Electron metadata and the official Electron release index, rather than measured inside each application. Several baselines still predate October's security-release versions. Updating the application did not establish that its bundled Node.js defects are fixed; additional vendor backports were not verified. Signed application bundles were updated as whole applications, with their user-data folders preserved. [Electron release index](https://releases.electronjs.org/releases.json), [Electron runtime update policy](https://www.electronjs.org/docs/latest/tutorial/electron-timelines#nodejs-version-support)

Other application results:

- **Cursor:** installed **3.28.7**, matching the current public download catalogue version. Its download endpoints returned HTTP 403, so the currently distributed build and any vendor backports could not be independently compared. The installed app remains unchanged, with Electron **42.11.16** and upstream Node.js baseline **24.19.0**. A catalogue version match does not certify security coverage.
- **T3 Code Nightly:** installed **0.1.8-nightly.20261104.4179**, matching the newest published nightly release checked through GitHub. It remains on Electron **44.10.1**, whose Node.js baseline is **24.22.1**. No update or restart was needed for its bundled runtime at this check.
- **ChatGPT/Codex:** the built-in update tool returned **up to date** for installed version **26.1029.61003**, build **24614**. Its observed computer-use and artifact runtimes remain **24.22.1**; they are application-managed and were not manually replaced.
- **Raycast:** the observed running runtime remains **26.12.1**, the October security-release version for that line. Its application-managed runtime was not manually replaced.
- **Old T3 Code Alpha:** version **0.0.13** was moved out of Applications after Alan explicitly chose recovery. Its complete bundle is preserved as `application-recovery/T3 Code (Alpha).app.recovery` in the private update-record folder. The recovery suffix removes its normal application-bundle name. It was not running, T3 Nightly metadata was verified unchanged, and no application user-data folders were modified. The archived upstream Node.js baseline is **24.13.1**; this is a preserved historical copy, not an updated runtime.

Vendor and release references: [Microsoft updater](https://update.code.visualstudio.com/api/update/darwin-arm64/stable/261c84cb1eddf11235f9e2c921425e9663fbe556), [Claude download catalogue](https://formulae.brew.sh/api/cask/claude.json), [Antigravity catalogue](https://formulae.brew.sh/api/cask/antigravity.json), [Antigravity IDE catalogue](https://formulae.brew.sh/api/cask/antigravity-ide.json), [Cursor catalogue](https://formulae.brew.sh/api/cask/cursor.json), [T3 nightly release](https://github.com/pingdotgg/t3code/releases/tag/v0.1.8-nightly.20261104.4179).

## Validation and the initial failures

| Check                                                                           | Actual result                                                                                                        |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| First full `npm test` run under 22.23.4                                         | **1,333 passed; 3 failed.** Failures were in two command-builder launch tests and one failed-startup lifecycle test. |
| Same failing files under previous Node.js 22.22.3, sequential execution         | **32 tests passed; 0 failed.**                                                                                       |
| Full suite under 22.23.4, at most two test files at once                        | **1,336 tests passed; 0 failed**, approximately 70 seconds.                                                          |
| `npm run lint`                                                                  | **Passed.**                                                                                                          |
| `npm run check:docs`                                                            | **Passed.**                                                                                                          |
| Repository-wide `npm run format:check`                                          | **Failed** on four untouched, pre-existing root handoff Markdown files.                                              |
| Fresh Terminal-style shell and real T3 launcher                                 | **Passed**, both selecting shared 22.23.4.                                                                           |
| Gateway restart, executable lookup, and HTTPS health check                      | **Passed.**                                                                                                          |
| Four replaced application signatures, developer identity, and Gatekeeper checks | **Passed.**                                                                                                          |
| Visual Studio Code command-line version check                                   | **Passed.**                                                                                                          |

The first-run failures occurred in time-sensitive tests. Lower-concurrency execution passed without changing repository code. That is evidence of successful execution under the new runtime, not proof that the original default-concurrency failures have been permanently resolved. The untouched formatting failures are in `HANDOFF-acp-hosts-images-thermo-nuclear-2026-10-17.md`, `HANDOFF-golden-eval-he06-thermo-nuclear-2026-09-06.md`, `HANDOFF-permission-cache-thermo-nuclear-2026-09-07.md`, and `HANDOFF-starlark-r11-thermo-nuclear-2026-09-06.md`.

The administrator-owned installer initially rejected the package path under Documents. The same checksum-verified package was staged in `/private/tmp`, discovered successfully, and installed successfully through macOS administrator authentication. The gateway's first health probe used HTTP and failed before any restart; the corrected HTTPS probe and restart succeeded. Native application-control connections timed out, so application replacements were verified through signatures, metadata, and the available command-line check rather than graphical interaction.

Targeted formatting passed for all four report files. HTML source fingerprints, section and citation parity, balanced tags, local links, standalone rendering dependencies, and new-file whitespace checks passed. The final repository documentation check also passed. Graphical application launch tests, a compromise investigation, live model calls, and exhaustive dependency or network-boundary audits were not performed. The T3 network-listener scope from the earlier assessment was not changed.

## Recovery records and handoff

Private downloads, checksums, receipts, check logs, and recovery copies are under:

`/Users/alanman/Documents/Codex/2026-11-04-nodejs-runtime-updates/`

Key records include `shared-runtime-change.json`, `runtimes-after.json`, `fresh-terminal-shell.json`, `t3-launcher-verification.json`, `gateway-restart.json`, `application-updates.json`, `applications-after.json`, `repository-checks.json`, `new-runtime-full-controlled.json`, `old-runtime-processes-remaining.json`, and `t3-alpha-retirement.json`. The prior system Node.js executable is retained as `system-node-before-update`. Superseded runtime installations and older Homebrew packages were retained; automatic cleanup was disabled. Homebrew upgraded the two requested Node.js packages and their dependencies, without a general package upgrade.

Repository folder: `/Users/alanman/Developer/claude-local-bridge-playground`. Branch: **main**, commit **2fc7d9202365d0cedd83f1083ad5c97e5be12e3f**. The directory, repository root, branch, remotes, and known prior report files were checked before work. A fast-forward-only pull reported already up to date.

Repository documentation changes are this Markdown report, its adjacent standalone HTML version, and a follow-up link added to both original assessment files. No repository runtime source was changed, and no commit or push was performed.

Remaining follow-up: perform the final ChatGPT/Codex quit and reopen; verify vendor security backports where the bundled baseline remains older; and reassess the planned November 11 release when details and fixes are published. These installed updates do not include undisclosed future November fixes. [November advisory](https://nodejs.org/en/blog/vulnerability/november-2026-security-releases)
