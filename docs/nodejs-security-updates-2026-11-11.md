# November Node.js security updates — November 11, 2026

**Result:** The November security patches are published. The shared runtime is now **22.23.5**, the administrator-owned installation is **24.22.3**, and **26.13.1** is installed in the version manager. The idle gateway was restarted and verified. Dedicated-host startup selections were corrected. **Homebrew-owned binaries and application-bundled runtimes still need follow-up; they are not certified patched by this report.**

Assessment date: November 11, 2026, 06:42 PM Pacific. The four November 4 reports are preserved in the repository at Alan's explicit request. This report and its HTML companion add two intentional documentation files. No report was discarded or moved out of Git's working folder.

## Published fixes and scope

The official November release announcement now lists **22.23.5, 24.22.3, and 26.13.1** as security releases. Issues include server memory disclosure, denial of service, and authentication/certificate-policy defects. Applicability depends on the functions an application uses; an installed release number alone does not prove that a particular application is exploitable. [November announcement](https://nodejs.org/en/blog/vulnerability/november-2026-security-releases), [22.23.5 release](https://nodejs.org/en/blog/release/v22.23.5/), [24.22.3 release](https://nodejs.org/en/blog/release/v24.22.3/), [26.13.1 release](https://nodejs.org/en/blog/release/v26.13.1/)

This work covers the known standalone installations, relevant startup selections, the observed Node.js processes, and installed Electron applications in the two standard Applications locations. It is a bounded update/inventory exercise, not an exhaustive search of every cache, a compromise investigation, or exploit testing against active applications.

Node.js is the executable that runs JavaScript outside a browser. Electron packages Node.js with browser technology inside a desktop application; changing the shared Node.js executable does not replace an application's bundled runtime. [Electron security documentation](https://www.electronjs.org/docs/latest/tutorial/security)

## Standalone installation results

| Installation                                           | Before                     | Verified after      | Status                                                                                                        |
| ------------------------------------------------------ | -------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------- |
| Shared local runtime, `/Users/alanman/.local/bin/node` | 22.23.4                    | **22.23.5**         | Installed from the official Apple Silicon archive; shared node/npm/npx links updated atomically.              |
| Administrator-owned `/usr/local/bin/node`              | 24.22.2                    | **24.22.3**         | Official signed/notarized installer completed successfully; native arm64 execution verified.                  |
| Version manager, `.nvm/versions/node/`                 | 26.4.0 and 26.13.0 present | **26.13.1 added**   | New patch installed and executed; prior versions retained. No shell aliases or default-major choices changed. |
| Homebrew Node.js 22                                    | 22.23.4                    | **22.23.4 remains** | Pending Homebrew; its live recipe still lists 22.23.4.                                                        |
| Homebrew default Node.js                               | 26.13.0                    | **26.13.0 remains** | Pending Homebrew; its live recipe still lists 26.13.0.                                                        |

All official Node.js downloads matched the SHA-256 fingerprints in the corresponding official release checksum files. The system installer also passed the Node.js Foundation developer-signature and Apple-notarization checks. Existing standalone versions and old link targets were retained for recovery. The shared npm package manager remains **10.9.9**, as bundled with the patch release.

A new interactive login shell selected **22.23.5** from `/Users/alanman/.local/share/nodejs/v22.23.5/bin/node`. The actual T3 bridge launcher was also started with an empty input pipe, its process executable was verified as that same runtime, and it exited successfully. No model prompt or paid request was sent.

The Homebrew result is a live-catalogue limitation, not a successful patch installation: both installed recipe versions match what Homebrew currently publishes, but remain below the November fixes. The Homebrew-managed files were not overwritten with an unrelated installer. [Live Node.js 22 formula](https://formulae.brew.sh/api/formula/node@22.json), [live default Node.js formula](https://formulae.brew.sh/api/formula/node.json)

## Startup selections and observed processes

The idle `com.alanman.opencode-go-cowork-gateway` service was checked for active connections, stopped through its normal graceful termination path, and restarted through macOS's service manager. Its new executable path is the verified **22.23.5** installation. Its encrypted local health endpoint passed with the existing public certificate authority used to verify the connection. No private key was inspected.

A separate historical installation under `~/Library/Application Support/Claude Bridge Lab` contained an installation manifest and three unloaded jobs pinned to **22.22.3**. Four files were backed up and updated:

- The installation manifest now selects **22.23.5**.
- The standalone job now starts the patched executable.
- The browser job explicitly starts its existing code-server JavaScript entry point with the patched executable, avoiding the package's hardcoded Homebrew interpreter.
- The three jobs' helper-command search paths now start with the patched runtime directory.

The browser server's version command succeeded when explicitly run under the patched executable. Job labels, startup policies, working directories, existing server arguments, bridge source, and authentication settings were preserved. All three dedicated jobs were unloaded before and after the changes; this check did not start them or exercise a model request. The Finder launchers already use the shared Node.js link and required no changes.

An initial preflight expected a Finder-launcher edit and stopped before writing when that assumption was false. The scope was corrected to the four files actually requiring changes; their file formats and retained startup-policy fields were then checked. These startup-selection changes do not replace Electron inside the dedicated desktop editor.

The ordinary `code-server` command still has a shebang selecting Homebrew Node.js 22 and therefore remains pending Homebrew's update. The dedicated browser job's explicit patched interpreter avoids that stale selection for that managed path. A shebang is the first line of an executable script that tells the operating system which program should run it.

The final process sample found **15 older shared-runtime processes using 22.23.4**, all owned by ChatGPT/Codex. They were left running because this chat and the separately requested cleanup chat are active. After active chats/jobs have finished, save unsent text, focus **ChatGPT**, press **Command–Q**, then reopen **ChatGPT** from Finder's Applications folder. A full app quit allows fresh tool processes to select the patched shared link; simply closing a window can leave processes running. This refresh has not yet been observed. It will not independently update ChatGPT's separately bundled Node.js runtime.

## Vendor application updates and remaining attention

Two inactive applications were updated from current vendor downloads:

| Application    | Before    | Installed after | Electron / upstream Node.js baseline after |
| -------------- | --------- | --------------- | ------------------------------------------ |
| Claude Desktop | 4.23118.0 | **5.1231.2**    | 45.2.1 / **24.22.1**                       |
| Antigravity    | 2.31.0    | **2.31.2**      | 44.9.1 / **24.22.0**                       |

Both archives matched the published catalogue checksums. Each new bundle passed code-signature verification, matched the installed developer identity, and was accepted by macOS Gatekeeper. The previous bundles are retained as `.app.recovery` folders outside Applications. Account and user-data folders were not modified.

These application updates do **not** establish November Node.js coverage. Their upstream baselines remain below the new security releases. The baseline is inferred by matching installed Electron metadata to the official Electron release index; application-specific backports can differ and were not verified. The latest Electron stable entry checked, **45.3.1**, also reports baseline **24.22.2**, rather than the November Node.js 24 patch. [Electron release index](https://releases.electronjs.org/releases.json), [Electron 45.3.1 release](https://github.com/electron/electron/releases/tag/v45.3.1), [Electron runtime-update policy](https://www.electronjs.org/docs/latest/tutorial/electron-timelines#nodejs-version-support)

Current update-channel evidence:

- **Visual Studio Code 1.146.0:** its official updater returned HTTP status 204, meaning no update payload for the installed stable build. Its upstream Node.js baseline is **24.22.1**.
- **Cursor 3.29.15:** the release version matches the current public catalogue. The official download request returned HTTP 403, so the exact distributed build and any backports could not be independently checked. Its upstream baseline is **24.22.1**.
- **T3 Code Nightly 0.1.10-nightly.20261111.4544:** matches the newest nightly release found. Newer preview-channel releases were not substituted for Nightly. Its upstream baseline is **24.22.1**. [Current nightly release](https://github.com/pingdotgg/t3code/releases/tag/v0.1.10-nightly.20261111.4544)
- **ChatGPT/Codex 26.1106.51428, build 26605:** the built-in updater returned **up to date**. Its computer-use executable and current artifact runtime both directly measured **24.22.1**. Vendor verification or a later app/runtime update is needed for the November fixes.
- **Raycast 2.11.1.0:** matches the checked application catalogue version. Its observed running backend is **26.12.1**, and another installed runtime is **22.23.4**. Both are below their November patch versions; application-managed runtime files were not manually overwritten.
- **Antigravity IDE 2.6.0:** matches the checked catalogue version, with an older upstream baseline of **22.21.1**.
- **Old T3 Alpha:** remains in its previously authorized `.app.recovery` location, outside Applications. It is a historical recovery copy, not a current patched installation.

Catalogue references: [Claude](https://formulae.brew.sh/api/cask/claude.json), [Antigravity](https://formulae.brew.sh/api/cask/antigravity.json), [Cursor](https://formulae.brew.sh/api/cask/cursor.json), [Raycast](https://formulae.brew.sh/api/cask/raycast.json), [Antigravity IDE](https://formulae.brew.sh/api/cask/antigravity-ide.json).

The wider installed Electron inventory follows. Every listed upstream baseline is below the applicable November release or belongs to an older line. That makes vendor patch verification necessary; it does not prove that every listed application is reachable through a reported defect. Available updates for the additional apps outside the primary group above were not checked in this run.

| Installed application | Application version          | Electron | Upstream Node.js baseline |
| --------------------- | ---------------------------- | -------- | ------------------------- |
| 1Password             | 8.12.46-26.BETA              | 43.8.4   | 24.22.1                   |
| AI Renamer            | 1.7.5                        | 33.4.11  | 20.18.3                   |
| Antigravity IDE       | 2.6.0                        | 39.2.3   | 22.21.1                   |
| Antigravity           | 2.31.2                       | 44.9.1   | 24.22.0                   |
| Claude                | 5.1231.2                     | 45.2.1   | 24.22.1                   |
| Cursor                | 3.29.15                      | 43.8.4   | 24.22.1                   |
| Discord               | 0.0.385                      | 37.6.0   | 22.19.0                   |
| Fabric                | 0.2.9                        | 38.1.0   | 22.19.0                   |
| GitHub Desktop        | 3.6.10                       | 44.9.1   | 24.22.0                   |
| Mintlify              | 0.1.34                       | 44.9.2   | 24.22.0                   |
| OpenCode              | 1.17.14                      | 42.3.3   | 24.15.0                   |
| Pinokio               | 7.2.6                        | 39.2.3   | 22.21.1                   |
| T3 Code (Nightly)     | 0.1.10-nightly.20261111.4544 | 44.10.1  | 24.22.1                   |
| Visual Studio Code    | 1.146.0                      | 43.8.6   | 24.22.1                   |
| Wispr Flow            | 1.6.1337                     | 43.8.3   | 24.22.0                   |
| logioptionsplus       | 2.9.1013853                  | 45.1.0   | 24.22.1                   |

**AI Renamer deserves a separate framework-refresh or retirement review:** its upstream Node.js **20.18.3** baseline belongs to a line whose public support ended **April 30, 2026**. The current release campaign does not provide a standard Node.js 20 patch. [Official support schedule](https://github.com/nodejs/Release/blob/main/schedule.json)

## Validation, repositories, and handoff

| Check                                                           | Result under patched shared Node.js 22.23.5                   |
| --------------------------------------------------------------- | ------------------------------------------------------------- |
| Full main test suite, one test file at a time                   | **1,380 passed; 0 failed**                                    |
| Starlark verification suite                                     | **128 passed; 0 failed**                                      |
| Lint                                                            | **Passed**                                                    |
| Documentation defaults, manifest, and agent-doc synchronization | **Passed**                                                    |
| Repository-wide formatting                                      | **Passed**                                                    |
| Fresh Terminal-style login shell                                | **22.23.5 selected**                                          |
| Actual T3 bridge launcher                                       | **Patched executable verified; clean exit; no model request** |
| Gateway restart and encrypted health endpoint                   | **Passed on the new executable**                              |
| Browser-server version check under patched Node.js              | **Passed**                                                    |
| Managed job file formats and retained startup policies          | **Passed; hosts remain unloaded**                             |
| Two application signatures and Gatekeeper acceptance            | **Passed**                                                    |

The current checkout was verified as `/Users/alanman/Developer/claude-local-bridge-playground`, on **main**, with the expected playground remote. A fast-forward-only pull preserved the four local reports and advanced the checkout from `2fc7d9202365d0cedd83f1083ad5c97e5be12e3f` to **`3b6d9c1ef6bda1a5379f926295e03a8777e8c803`**. The source changes received by that pull belong to the existing upstream work; this chat made no repository runtime-source edits.

The original four reports remain in the repository, as Alan requested. This dated Markdown report and its standalone HTML companion add two report files, and the November 4 execution report receives a forward link. The resulting six intentional documentation files remain uncommitted. No commit or push was performed.

A separate user-owned chat, **Review and clean up Codex playground changes**, was created for `/Users/alanman/Developer/codex-local-bridge-playground`. It verified the initial **46 changed paths**, owns that repository's preservation/review/cleanup, and is working independently. It was instructed to pin its test executable so this shared-runtime update cannot change a baseline run midway through. This chat did not edit the Codex repository.

Private downloads, checksum files, signatures, compatibility logs, process metadata, startup-file backups, and recovery copies are under:

`/Users/alanman/Documents/Codex/2026-11-11-nodejs-security-updates/`

Important records include `download-receipts.json`, `shared-runtime-change.json`, `system-installer-result.json`, `nvm-runtime-update.json`, `runtimes-after.json`, `managed-runtime-update.json`, `gateway-restart.json`, `apps-after.json`, `application-updates.json`, `checks.json`, and `restart-ownership.json`. Earlier executable installations were retained for recovery; package/app account state was not copied into this repository.

Targeted report-format, structure, source-parity, link, and whitespace checks are completed before handoff. Actual launches of the unloaded managed hosts, browser-login interaction, graphical app workflows, live model/provider requests, exploit reproduction, and exhaustive machine-wide dependency searches were skipped. T3's previously observed network binding was not changed.

Remaining actions: wait for patched Homebrew recipes and vendor-bundled runtime updates or verified backport statements; refresh ChatGPT/Codex tool processes after active work finishes; review the oldest app frameworks separately; and follow the dedicated Codex cleanup chat for that repository's result.
