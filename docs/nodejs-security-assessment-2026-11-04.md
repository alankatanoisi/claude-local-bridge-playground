# Node.js security assessment — November 4, 2026

**Follow-up:** Runtime updates and validation are now recorded in the [update report](nodejs-runtime-updates-2026-11-04.html). This assessment preserves the before-update snapshot.

**Decision:** Update the shared bridge/runner Node.js installation promptly, then reassess the November release when it becomes available. Several installed copies already predate October security fixes. The November announcement does not yet disclose enough detail to determine exploitability in this setup.

This is a local runtime inventory and advisory assessment, not a compromise investigation or a complete machine audit. No installed software, application settings, services, or repository runtime code were changed. The assessment and its HTML companion are the only new project files.

## What Node.js does here

Node.js is the program that executes JavaScript outside a browser. Our `.js` files contain instructions; Node.js runs those instructions and provides access to files, processes, and networking.

The bridge, command-line runner, Agent Client Protocol (ACP) adapter, coordinator, archive browser, and Starlark host use Node.js. The command-line entry files begin with `#!/usr/bin/env node`, which asks the computer to select a program named `node` from its executable search path. The T3 launcher can instead use an explicit `BRIDGE_RUNNER_NODE` setting. That distinction matters because an editor can choose a different Node.js executable from Terminal.

Electron is a desktop application framework that bundles Node.js with browser technology. Cursor, Visual Studio Code, Claude Desktop, and T3 Code each carry a separate copy. Changing Terminal's Node.js does not replace those bundled copies. [Electron security documentation](https://www.electronjs.org/docs/latest/tutorial/security)

## What the November announcement establishes

The advisory was published November 3. Node.js plans security releases for **22.x, 24.x, and 26.x on or shortly after November 11, 2026**, with a highest severity of **High** in each line. As checked November 4, it does not identify the vulnerabilities, fixed version numbers, affected functions, operating-system restrictions, or attack requirements. Treat these release lines as needing the forthcoming update; exact exposure remains unresolved. [November advisory](https://nodejs.org/en/blog/vulnerability/november-2026-security-releases), [official source text](https://raw.githubusercontent.com/nodejs/nodejs.org/main/apps/site/pages/en/blog/vulnerability/november-2026-security-releases.md)

The available release index lists **22.23.4**, **24.22.2**, and **26.13.0** as the latest versions in those respective lines at assessment time. These are existing releases, not the forthcoming November fixes. [Official release index](https://nodejs.org/dist/index.json)

## Directly measured standalone runtimes

These version numbers came from the executable itself. The broken Homebrew copy was identified by its installation path and loader failure instead.

| Location or owner                                                                              | Observed version                                 | Assessment and priority                                                                                                                                           |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Selected local Node.js: `/Users/alanman/.local/bin/node`                                       | **22.22.3**                                      | **First update priority.** Its link points to `/Users/alanman/.local/share/nodejs/v22.22.3/bin/node`. Several running Node.js processes use that same executable. |
| Homebrew Node.js 22: `/opt/homebrew/opt/node@22/bin/node`                                      | **22.23.3**                                      | Also behind the October security release. Updating this copy alone would leave the selected local copy unchanged.                                                 |
| Installer-managed copy: `/usr/local/bin/node`                                                  | **24.14.0**                                      | Older fallback; update or deliberately stop selecting it.                                                                                                         |
| Version-manager copy: `/Users/alanman/.nvm/versions/node/v26.4.0/bin/node`                     | **26.4.0**                                       | Older optional runtime; update if retained for use.                                                                                                               |
| Homebrew default: `/opt/homebrew/bin/node`                                                     | Path identifies **25.8.2**; version query failed | Fails to start because `libsimdjson.31.dylib` is missing. Node.js 25 is also out of upstream support. Repair or retire this fallback separately.                  |
| ChatGPT computer-use runtime: `/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node` | **24.22.1**                                      | At the October security-release version. Future November coverage depends on the application's runtime updates.                                                   |
| Codex artifact runtime, current observed generation                                            | **24.22.1**                                      | Same October baseline; separately managed. Changing the selected local Node.js does not update it.                                                                |
| Raycast runtime observed running                                                               | **26.12.1**                                      | At the October security-release version for its line. Another installed Raycast runtime measured **22.23.4**.                                                     |

The Codex artifact executable observed was `/Users/alanman/Library/Application Support/Codex/artifact-sessions/runtime-generations/generation-X1fdhC/runtime/bin/node`. Raycast's observed running executable was under `/Users/alanman/Library/Application Support/com.raycast.macos/node/runtime/node-v26.12.1-darwin-arm64/bin/node`.

Node.js **22.23.4** is the October security release for the active major line. It contains fixes missing from the standard older release, including changes to certificate checks, name resolution, HTTP connection reuse, and the bundled Brotli decompressor. Keep the bridge/runner on 22.x for the first update to avoid introducing an unrelated major-version migration. [Node.js 22.23.4 release](https://nodejs.org/en/blog/release/v22.23.4)

Node.js 24.22.1 and 26.12.1 are the corresponding October security releases. The Node.js support schedule keeps 22.x supported through April 30, 2027; 25.x ended support June 1, 2026. [24.22.1 release](https://nodejs.org/en/blog/release/v24.22.1), [26.12.1 release](https://nodejs.org/en/blog/release/v26.12.1/), [official support schedule](https://github.com/nodejs/Release/blob/main/schedule.json)

## Installed desktop applications

The application and Electron versions below were read from installed application metadata. The Node.js versions are **upstream mappings from Electron's release index**, not direct measurements inside each application. Vendors can apply additional fixes without changing the upstream base number, so a lower base version is an update/review signal, not proof of a specific missing patch.

| Installed application | Application version         | Electron version | Upstream Node.js baseline |
| --------------------- | --------------------------- | ---------------- | ------------------------- |
| Cursor                | 3.28.7                      | 42.11.16         | **24.19.0**               |
| Visual Studio Code    | 1.144.1                     | 43.8.3           | **24.22.0**               |
| Claude Desktop        | 4.4212.0                    | 44.9.3           | **24.22.0**               |
| T3 Code Nightly       | 0.1.8-nightly.20261104.4179 | 44.10.1          | **24.22.1**               |
| T3 Code Alpha         | 0.0.13                      | 40.6.0           | **24.13.1**               |
| Antigravity           | 2.24.0                      | 44.3.0           | **24.20.0**               |
| Antigravity IDE       | 2.1.1                       | 39.2.3           | **22.21.1**               |

Evidence: [Electron release index](https://releases.electronjs.org/releases.json), [Cursor's Electron baseline](https://releases.electronjs.org/release/v42.11.16), [Visual Studio Code's Electron baseline](https://releases.electronjs.org/release/v43.8.3), [Claude Desktop's Electron baseline](https://releases.electronjs.org/release/v44.9.3), [T3 Nightly's Electron baseline](https://releases.electronjs.org/release/v44.10.1).

Check vendor application updates for the older baselines and verify the fixes delivered. Do not manually replace files inside signed applications. Electron's release policy allows security backports, and updates must reach each application independently. [Electron runtime update policy](https://www.electronjs.org/docs/latest/tutorial/electron-timelines#nodejs-version-support)

## Reachability: what the code and processes actually show

**Bridge network binding — direct source evidence.** `src/server.js:54` explicitly binds to `127.0.0.1`, an address reachable on this Mac. The capture proxy also binds there. The observed socket inventory contained no listener on the usual Claude bridge port, 11437. A Node.js listener on 11438 belonged to a separate local lab, identified by its process working directory; it was not established as this Claude bridge. Local-only binding reduces unsolicited network access but does not protect every outbound connection or unsafe input-processing path.

**Existing October defects — conditional relevance.** The October advisory includes a Brotli decompression memory-corruption flaw, name-resolution and certificate-verification flaws, and a reused-connection response issue. Exploitation has specific input or peer requirements. The direct bridge/runner/Starlark source search found no Brotli decompression or `dns.resolve` calls. The bridge and model client do reuse network connections. This supports updating the runtime; it does not demonstrate a working exploit. Dependencies, editor extensions, alternate hosts, and unrelated tools were not exhaustively traced. [October advisory](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)

**T3 network binding — direct process evidence, separate follow-up.** T3 Code Nightly was listening on IPv4 `*:3773`, meaning all local IPv4 interfaces rather than only this Mac's loopback address. Firewall rules, application authentication, router behavior, and any tunnel routing were not evaluated. This is a reason to review the intended binding if local-only access is desired; it does not establish internet exposure, missing authentication, or a November exploit.

**November exploitability — unknown.** The announcement does not disclose which APIs are affected. There is no basis yet to narrow the November issues to servers, Windows, a permission mode, decompression, or any other particular feature. The October findings above are separate issues, not an identification of November's undisclosed flaws.

## Recommended order of work

1. **Update the selected bridge/runner installation from 22.22.3 to 22.23.4 now.** Install the newer executable beside the old one, verify the official download checksum, and switch the existing local `node` and `npm` links coherently. Retain the previous installation temporarily for recovery. A link is a small filesystem pointer; switching it changes which installed version future launches select.
2. **Verify the actual launch paths and restart affected tools deliberately.** T3's bridge launcher supports `BRIDGE_RUNNER_NODE`, and existing project documentation points to `/Users/alanman/.local/bin/node`. A running process continues using its old executable after a link changes. Check newly launched processes, then run the repository checks on the updated runtime. Coordinate restarts with active work.
3. **Address the other stale standalone copies and desktop applications.** Update Homebrew Node.js 22 and other retained copies through their owners. Repair or retire the broken, unsupported Node.js 25 fallback. Review app updates for Cursor, Visual Studio Code, Claude, and the older T3/Antigravity installations; verify vendor security backports where needed. Replacing the local symlink cannot fix these separate runtimes.
4. **Revisit the advisory on or after November 11.** Use the versions and attack requirements actually published then. Update the shared runner runtime again and check vendor-delivered runtimes independently. No automatic reminder or future monitoring was configured by this assessment.
5. **Review the T3 listener's intended network scope.** Establish whether access from other devices is intentional before changing its binding or service behavior.

Use project-specific versions where required: the sibling Codex playground declares Node.js `>=22`, while the T3 source checkout declares `26.12.1`. Do not force every project to use the bridge's selected 22.x version.

The repository's container recipe uses `node:22-alpine`; its GitHub workflow requests Node.js 22. Those declarations do not prove the version in an existing container or runner cache. After fixes are published, refresh the base image and rebuild any containers actually in use, and verify the executable used by workflow jobs. No container or workflow execution was inspected here. Updating JavaScript dependencies alone does not replace the Node.js executable.

## Evidence, checks, and handoff

- **Folder:** `/Users/alanman/Developer/claude-local-bridge-playground`.
- **Branch:** `main`; starting commit `2fc7d9202365d0cedd83f1083ad5c97e5be12e3f`.
- **Repository:** `origin` points to `alankatanoisi/claude-local-bridge-playground`; the canonical repository remains reference-only.
- **Startup:** directory, repository root, branch, remotes, and clean working tree verified. The required fast-forward-only pull reported already up to date before report creation.
- **Files added:** `docs/nodejs-security-assessment-2026-11-04.md` and the adjacent `.html` companion. No commit or push performed.
- **Checks performed:** official advisory and source retrieval; release/support-index comparison; direct standalone version queries; installed application metadata and Electron mapping; process executable and listening-socket inventory; targeted source and launcher review. Homebrew Node.js 25 failed its version query with a missing-library error, as recorded above.
- **Report checks:** passed targeted Prettier formatting, source-to-HTML hash and section/citation parity, balanced HTML and local links, `npm run check:docs`, and `git diff --check`. The HTML checker initially mishandled valid self-closing metadata tags; it passed after correcting the checker. No browser layout inspection was performed.
- **Checks skipped:** full runtime tests and source-code linting, dependency audit, exploit execution, live model calls, credential inspection, package installs, service restarts, firewall/tunnel review, and exhaustive searches of caches or every application. This was an assessment with no runtime changes; no remediation or exploit-validation claim is made.
- **Remaining risks:** stale shared and fallback runtimes remain installed; bundled application fixes require vendor verification; November applicability remains undisclosed; T3 network reachability needs a separate bounded check.

The intended next action is a controlled update of the selected 22.x runtime, followed by verification of the processes that actually use it.
