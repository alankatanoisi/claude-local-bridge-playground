# Handoff — ACP chunk 1: Bridge Runner into T3 Code Nightly through a playground-owned launcher (2026-09-26)

**Written:** 2026-09-26 by Claude (Fable), Alan-directed, from the approved plan of the same day.
**Thread entry:** this file supersedes `HANDOFF-acp-ask-user-question-2026-08-31.md` as the ACP
(Agent Client Protocol) thread entry (that file is bannered; its text is unchanged). Slice records
A–D and the 08-31 question-card record stay the implementation history.
**Scope:** playground only. No T3 fork work, no bridge-internals edits, no push.

## 1. Why this chunk existed

Every live ACP verification before today ran inside a demo T3 dev stack in the fork worktree
`~/Developer/t3code-bridge-ui`. That folder is gone from disk (git still lists it as a prunable
worktree). With it went the untracked shim configuration (`.t3/userdata/settings.json`) and the
09-06 `start-bridge-dev.sh`. Alan's real T3 app, the packaged **T3 Code (Nightly)**
`0.0.43-nightly.20260926.2282` on port 3773, had never been wired to the runner: its Cursor
instance pointed at the genuine `cursor-agent` CLI.

Goal: let Alan chat with Bridge Runner inside the real Nightly app, with no fork and no demo
stack, and re-prove the 08-25 bridge disconnect fix (`cbdb59e`) with a probe that is committed
instead of living in `/tmp`.

## 2. What landed

| File                                         | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bin/t3-cursor-shim.sh` (git mode `100755`)  | The program T3's Cursor driver launches. Answers `about --format json` with shell built-ins only; strips T3's Cursor-only tokens (`-e <url>`, `--force`, `--auto-review`, `acp`); resolves node (`BRIDGE_RUNNER_NODE` → PATH → Homebrew → `/usr/local`); posture from `BRIDGE_RUNNER_CAPABILITIES` (unset = read-only core); refuses `shell`; one `exec`.                                                                                                                                                                         |
| `test/runner/acp-t3-shim.test.js`            | 18 cases: exec bit, both `about` shapes, `about` with an empty PATH, five T3 launch shapes × {no posture, `edits`}, unknown token → exit 2, `shell` → exit 2, PATH fallback for node, non-executable `BRIDGE_RUNNER_NODE` → exit 127.                                                                                                                                                                                                                                                                                             |
| `scripts/acp-live-probe.js`                  | Committed live probe (replaces the lost `/tmp/slice-d-cancel-latency.js`). Reuses `createConnection` from `src/runner/acp/connection.js` as the client. Sequence: `about` gate → bridge liveness (zero spend) → spawn shim as T3 does (`--auto-review acp`) → initialize/authenticate/session-new/list-models → stream + `session/cancel` on first chunk → bridge liveness again (+ PID compare) → second prompt on the same session → clean exit. Prints plain-language hints for sandbox `EPERM` and for bridge proxy failures. |
| `docs/t3-code-nightly-setup-2026-09-26.html` | Alan-facing setup guide: T3 UI route, hand-edit fallback with backup + JSON validation, four-item verification checklist, probe usage, troubleshooting, known limits.                                                                                                                                                                                                                                                                                                                                                             |
| `README.md`                                  | One paragraph under "Local Bridge Runner" pointing at the shim, the env vars, the setup doc, and the probe.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `CLAUDE.md`, 08-31 handoff                   | Pointer update and banner.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

Deliberately untouched: `bin/local-bridge-acp.js`, `src/runner/acp/**`, `package.json`,
`src/credentials.js`, `src/proxy.js`, `src/server.js`, `AGENTS.md` (no ACP pointer there),
`starlark-host/**` (another agent's uncommitted work; see §7).

## 3. T3 contract re-check (Step 0), against `upstream/main` fetched today

- `upstream/main` = `95030dc674` (2026-09-26). The Nightly build is the same day.
- Session launch (`apps/server/src/provider/acp/CursorAcpSupport.ts`): `[-e <apiEndpoint>]`, then
  `--auto-review` (auto mode) or `--force` (full-access mode) or nothing (supervised), then `acp`.
  The model probe sends a bare `acp`. **The pre-09-02 shim assumed `$1 == acp` and forwarded
  `"$@"`; on today's Nightly it would have crashed the agent's strict flag parser in auto and
  full-access modes.** The new shim strips those tokens and fails loudly (exit 2) on anything else.
- `about` gate (`CursorProvider.ts`): regex `^(\d{4})\.(\d{2})\.(\d{2})(?:\b|-|$)`, minimum
  `2026_04_08`; `userEmail` must be a non-null string; `~/.cursor/cli-config.json` `channel` must be
  absent or `lab` (absent on this Mac). Model discovery is cached 30 min keyed by
  `cliVersion` + auth; the shim's new `cliVersion` (`2026.09.26-bridge-runner-nightly`) busts it.
- Instance env: `mergeProviderInstanceEnvironment` merges the instance's variables over T3's own
  `process.env`, and the ACP spawn uses `extendEnv: true`. So `BRIDGE_RUNNER_NODE` and
  `BRIDGE_RUNNER_CAPABILITIES` set on the provider card reach the shim.
- Instance id from the UI dialog: `${driver}_${slug(label)}` → label "Bridge Runner" gives
  `cursor_bridge_runner`.
- Spawn is direct (`shell: false` on macOS); an absolute path to an executable `.sh` works.

## 4. Evidence

### 4.1 Static and unit

- `sh -n` clean; `git ls-files -s` shows `100755` for the shim (first executable file in `bin/`).
- Shim smoke: `about --format json` prints the identity JSON; `--auto-review acp` with stdin closed
  starts the real agent through `/Users/alanman/.local/bin/node` and exits 0.
- `test/runner/acp-t3-shim.test.js`: 18 pass, 0 fail. Existing ACP suites untouched and green.

### 4.2 Live probe runs (this session, sandboxed)

| Run | Environment                                      | about | bridge baseline  | handshake              | outcome                                                                                                                                                                  |
| --- | ------------------------------------------------ | ----- | ---------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | session sandbox, real `HOME`                     | ok    | alive, pid 25888 | ok, 4 models           | FAIL: `EPERM` writing `~/.bridge-runner/sessions/…ledger.jsonl` — the child inherited the session sandbox (known hazard from the 09-06 dev-stack notes). Not a code bug. |
| 2   | session sandbox, scratch `HOME` (writes allowed) | ok    | alive, pid 25888 | ok, 4 models, trust ok | FAIL at the first model call: bridge answered HTTP 500 `Failed to establish a socket connection to proxies: PROXY 127.0.0.1:9090`. See §5.                               |

**Cancel latency, bridge survival, and the second prompt were therefore not reached today.**
The probe is committed and the handshake half is proven; the first full `RESULT: PASS` is pending
a healthy bridge and a run from Alan's own Terminal (outside any agent sandbox).

### 4.3 Alan's manual checklist in T3 Nightly

Pending Alan. Fill in after the bridge is relaunched (see §5): streaming, Stop, approval card,
question card (setup doc §5).

## 5. Live finding: the bridge lost upstream network at 11:16 today (not this chunk's code)

- The live bridge on 127.0.0.1:11437 is an **Extension Development Host that Cursor launched
  from the playground folder at 10:32 today** (Cursor logs: "Loading development extension at
  /Users/alanman/Developer/claude-local-bridge-playground"; extension host pid 25888). It runs the
  playground's `src/` directly, so it already contains `cbdb59e`. R1's "which checkout backs the
  live bridge" question is answered; no reload was needed for the fix.
- The bridge served real `← 200 /v1/messages` responses at 10:37 (T3 explore runs).
- From **11:16** Alan's main Cursor window also logs `Failed to establish a socket connection to
proxies: PROXY 127.0.0.1:9090` for Cursor's own services (membership refresh, plugin
  marketplace). Nothing listens on 9090; `scutil --proxy` shows no system proxy; Cursor's
  `settings.json` sets no `http.proxy`. The editor resolved a proxy that does not exist, and the
  bridge inside it inherits that resolution. A direct one-token `POST /v1/messages` from this
  session reproduced the HTTP 500.
- **What Alan should do (Cursor, not Terminal):** quit and reopen Cursor, then press F5 with the
  playground open to relaunch the bridge; confirm with `curl -s http://127.0.0.1:11437/ping`
  (expect the JSON not_found line) and then run the probe from Terminal. If the proxy error
  returns, look for whatever configured a proxy on port 9090 around 11:16 (a VPN or proxy tool).

## 6. Deliberately not done (next chunk candidates)

- **Fork / Auto decision.** The Nightly is a packaged build, so fork commit `100b3890a` (Auto in
  the reasoning dropdown) cannot apply to it; Auto's absence is accepted for now. Not pushed.
- **T3 worktree hygiene.** `t3code-bridge-ui` and `t3code-acp-poc` are prunable registrations;
  `git worktree prune` is Alan's call. `start-bridge-dev.sh` and the demo settings are not
  recreated: the dev stack is retired in favour of the Nightly route.
- **First-class T3 driver**, **`session/load` scrollback replay**, **real fleet**: unchanged from
  08-25 R5/R6.
- **Old fork-shim path** still appears in older handoffs and
  `docs/bridge-runner-architecture-diagrams-2026-08-22.html`; left as history.
- **Log hygiene (later look, not urgent):** the bridge's Output channel in Cursor logs full
  request bodies (`→ /v1/messages body: …`, `CAPTURE` blocks) and, at startup, its debug-endpoint
  token in plain text. Both are local files under `~/Library/Application Support/Cursor/logs`.
  Neither is a credential exposure, but a capture/debug mode appears to be on by default.
- **Untestable shim branch:** "no node anywhere" (both fallback paths exist on this Mac).

## 7. Handoff fields

- **Folder / branch:** `/Users/alanman/Developer/claude-local-bridge-playground`, `main`, origin
  `alankatanoisi/claude-local-bridge-playground`. **Not pulled:** `origin/main` has four commits
  (Starlark fixes and fingerprint reports, 09-17…09-24) that touch two files also dirty in the
  working tree (`starlark-host/src/coordinator.js`, `worker-resume.js`); a fast-forward pull would
  refuse and stashing another agent's work was not mine to do (Alan chose "proceed, commit by
  path"). This chunk's commits touch none of those files, so the later merge is clean.
- **Files changed:** see §2.
- **Checks run:** `sh -n`; shim smoke; `acp-t3-shim` 18/18; ACP suites; `npm test`; `npm run lint`;
  `npm run format:check`; `npm run check:docs`; `npx prettier --check` + `npx eslint` on the probe.
  (Results recorded in the commit messages; see the session's final report.)
- **Skipped:** the full probe pass (bridge outage, §5); Alan's manual checklist (§4.3); pull of
  origin (§7).
- **Risks:** Nightly contract drift (shim fails loudly, extend the `case` list + test table);
  node not on the packaged app's PATH (set `BRIDGE_RUNNER_NODE`); invalid `settings.json`
  silently drops all instances (backup + validate); full-access mode hides approval cards (use
  supervised for the checklist); two T3 builds sharing `~/.t3/userdata/settings.json`.
