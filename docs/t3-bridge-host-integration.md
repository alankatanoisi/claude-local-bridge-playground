# One T3 provider, four bridge connections

Alan’s setup and architecture guide · October 16, 2026

**Use Bridge Runner (Local ACP) in T3, then choose Bridge host in the runner-options menu beside the model.** Standalone is the default for new chats. You can change the connection between turns without starting another conversation or entering a Terminal flag.

ACP means **Agent Client Protocol**: the structured messages T3 and the runner exchange. A bridge host is the local program handling the runner’s model connection. Changing hosts changes that connection; it does not choose a different model or grant more tool permissions.

## Choose the right host

| Bridge host                | Local Messages endpoint              | What happens when you submit a prompt                                                                      | Best use                                                                   |
| -------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Standalone                 | `http://127.0.0.1:11467/v1/messages` | Reuses the installed service, or starts it if stopped; waits up to 30 seconds                              | Everyday use, especially when memory is tight; no editor window needed     |
| Desktop — dedicated editor | `http://127.0.0.1:11447/v1/messages` | Reuses or starts the separate installed editor host; waits up to 60 seconds                                | An isolated desktop editor for inspection                                  |
| Browser — browser editor   | `http://127.0.0.1:11457/v1/messages` | Reuses or starts the installed service; opens its editor when activation is needed; waits up to 90 seconds | Browser-based editor access; keep its tab open                             |
| VS Code — existing/debug   | `http://127.0.0.1:11437/v1/messages` | Checks only, for at most five seconds; Alan starts and controls the editor                                 | Your original VS Code debugging environment and full diagnostic visibility |

`127.0.0.1` means the computer running the selected T3 environment. A **port** is the numbered connection point after the colon. An **endpoint** is the complete request address. The Browser editor page is a separate address: `http://127.0.0.1:18080/`.

All four choices use **the environment selected in T3**. The 2020 environment connects to the 2020 laptop. This does not route through the 2024 laptop, and that laptop’s migration remains a separate step.

## Use it in T3

1. Open **T3 Code (Nightly)** from the Dock or Applications folder.
2. Open a chat in the intended project and confirm its environment is **2020 MacBook Air (Alan)**.
3. Use the model menu to choose a model belonging to **Bridge Runner (Local ACP)**.
4. Open the adjacent runner-options menu. It shows controls such as Ask, Effort, Token Budget, and **Bridge host**.
5. Choose a host. Selecting an item only saves the choice; it does not start services or spend model usage.
6. Submit your prompt. A **Bridge connection (local)** activity reports checking, startup or editor activation, and connection. The model request begins only after connection succeeds.

T3 controls the placement and visual style of ACP selectors. This integration uses the existing runner-options menu rather than adding a custom toolbar or dashboard.

Each chat remembers its selected host. A change made while a reply is running takes effect on the **next** turn. The active turn keeps one endpoint for every request in its tool loop. The model, project, approvals, available tools, and checkpoint conversation continue through a host switch. A **checkpoint** is the runner’s saved conversation, used to continue a later turn.

**Screenshots and other images** (added 2026-10-16). Dropping an image into the composer works: the agent advertises image support, converts each PNG, JPEG, GIF or WebP attachment into the form the model API accepts, and places it in front of your text. An attachment the model cannot take (another format, or over the 7 MB media limit) is not sent; the prompt text gains a line such as `[image attachment 1 not forwarded: unsupported media type image/svg+xml]` so neither you nor the model is left guessing. Images are kept inside the saved checkpoint so later turns still “see” them; logs and ledgers record only how many images a turn carried, never their bytes.

**Tool-step ceiling** (added 2026-10-16). One ACP turn may run up to **1000** tool steps before the runner stops with “Reached max_steps”. The command-line runner keeps its default of 16 because a one-shot command should fail fast; a chat turn has you watching and a Stop button, so the ceiling is only a safety net. T3 has no composer control for it. To change it, add `--max-steps <n>` to the provider’s launch arguments in T3 (the same place `--allow-shell` lives).

## Original VS Code: keep the debugging option

Choose **VS Code — existing/debug** to deliberately use your ordinary editor’s bridge. The integration never launches, stops, restarts, reinstalls, or changes settings in that editor. It does not search neighboring ports or silently choose another host.

If it is unavailable, T3 reports: **“The existing VS Code bridge is unavailable at port 11437. Start the bridge in your VS Code session, then retry.”**

To start it yourself, bring your usual **VS Code** window forward. Press **Shift–Command–P** to open its Command Palette, type **Claude Local Bridge: Start Server**, and select that command. Success means the bridge reports its listening port in that editor. Then return to T3 and retry. If the command is absent, that editor may not have the extension loaded; check the intended extension/debugging session before changing anything.

A successful response proves that the endpoint served the request. It does not prove which editor process owns that endpoint. For a separate visibility check, inspect the corresponding request in your VS Code bridge diagnostics. Host selection does not enable verbose traces, copy a debug token, or weaken existing redaction. Full traces can contain prompts and source code, so they remain a separate deliberate setting.

If your original extension reports another port, set the provider environment variable `BRIDGE_RUNNER_VSCODE_URL` to its exact local Messages endpoint. For example, `http://127.0.0.1:11438/v1/messages` changes **only** this choice. Accepted hosts are `localhost`, `127.0.0.1`, and `[::1]`, using HTTP or HTTPS and the Messages path. Credentials in the address, query strings, fragments, remote hosts, and unrelated paths are rejected. Nothing scans for the new port automatically.

## Browser activation and resource use

Browser mode runs a local editor service, then needs an editor tab to activate its extension. When that tab is needed, the integration opens `http://127.0.0.1:18080/` once per activation window. Concurrent chats share that activation attempt rather than opening repeated tabs. If login is requested, Alan completes it; the integration never copies or displays its password. The password belongs to this laptop’s local editor installation, not the T3 provider.

Keep the Browser editor tab open while using that host. If activation times out, open the same address in your browser, finish the existing login, wait for the editor to load, then retry in T3. A timed-out connection sends no model request.

Standalone avoids an editor and browser tab, so it is the useful default on an 8 GB laptop. Desktop and Browser consume additional resources. Hosts stay running after a prompt is stopped, a chat closes, or T3 quits, because another chat may be using them. Close or stop dedicated hosts deliberately when they are idle if you want to reclaim memory.

## Provider configuration and migration

On the 2020 laptop the existing provider instance was migrated in place; its identity and model preferences were retained. No duplicate provider is required.

| T3 provider setting          | Value or meaning                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------- |
| Display name                 | Bridge Runner (Local ACP)                                                                       |
| Provider route               | Local ACP command, rather than the built-in Cursor provider                                     |
| Executable / Binary path     | `/Users/alanman/Developer/claude-local-bridge-playground/bin/t3-bridge-runner.sh`               |
| Arguments                    | Empty                                                                                           |
| `BRIDGE_RUNNER_NODE`         | Existing executable Node.js path; on this laptop `/Users/alanman/.local/bin/node`               |
| `BRIDGE_RUNNER_CAPABILITIES` | Existing `edits` setting retained; other supported groups remain explicit choices               |
| `BRIDGE_RUNNER_HOST`         | Optional initial host: `standalone`, `desktop`, `browser`, or `vscode`; absent means Standalone |
| `BRIDGE_RUNNER_VSCODE_URL`   | Optional loopback override for existing/debug only                                              |
| `BRIDGE_CALLER_TOKEN`        | Optional existing local caller-authentication token, supplied privately through the environment |
| `BRIDGE_RUNNER_BRIDGE_URL`   | Remove this old fixed-address setting for the four-host provider                                |

Do not combine `--bridge-host` or `BRIDGE_RUNNER_HOST` with a generic fixed `--bridge-url` or `BRIDGE_RUNNER_BRIDGE_URL`: the agent rejects the conflict instead of ignoring one setting. The generic launcher explicitly opts into host selection. Direct ACP clients without that opt-in retain their previous fixed-URL behavior and receive no automatic host management.

The launcher resolves Node.js using the existing explicit setting and usual installation paths. It preserves this setup’s existing workspace-trust and explicit `--allow-shell` launch choices. **Shell is available in this launcher**, with supervised approval behavior; changing Bridge host never grants it. To create a provider without shell, use Node.js and `bin/local-bridge-acp.js --bridge-host standalone --trust-workspace` directly, with separate arguments in T3, omitting `--allow-shell`. Do not add `shell` to the capability-group variable. Ask, Plan, Code, and T3’s access selection still control their established runner behavior.

Caller tokens authenticate local clients to a bridge that requires them. They are not upstream model credentials. They never appear in the selector, companion settings, or connection diagnostics. The host choice does not alter Claude login, fingerprint behavior, upstream credentials, or the native `/v1/messages` surface.

## What automatic startup does

The sequence is: **capture this turn’s host → inspect/check → reuse or start → wait for activation → send the prompt → run the existing tool loop**.

The new asynchronous **ensure** operation reuses a healthy selected host, starts a stopped installed host, and leaves every other managed mode running. It checks that managed listeners belong to the controller’s selected job. It refuses an unrelated process occupying a managed port. It does not automatically install, replace, restart an unhealthy running service, switch hosts, or replay a failed model request.

Startup decisions use the existing controller lock: one local operation owns the startup decision at a time. The lock is released before the longer editor-activation wait, so another chat can start a different host. Subprocesses and waits support cancellation. Canceling startup prevents model submission; canceling a reply uses the existing runner cancellation path. Neither stops a shared service.

**The older manual Start controls behave differently:** they intentionally stop the other dedicated modes before starting the chosen mode. Do not use those exclusive Start controls while another chat needs a different managed host. T3 uses ensure, which preserves those other hosts. Existing manual commands retain their original meaning.

## Persistence and authority boundaries

The runner’s checkpoint stays under its existing session directory. The selected host is saved beside it as `<session-id>.acp.json`, containing only `schemaVersion: 1` and `bridgeHost`. It uses private permissions, validated session identifiers, an exclusive temporary file, and atomic replacement. **Atomic replacement** means readers see the previous complete file or the next complete file rather than a half-written file.

A failed save leaves the previous selection intact. Invalid saved settings report an explicit error instead of falling back. A session with settings but no successful model turn can still reload; an older checkpoint without settings uses the provider default. The companion file stores neither the endpoint override nor a caller token and does not rewrite an active conversation checkpoint.

Lifecycle authority belongs to the fixed local controller. Prompt text, workspace files, and model tools cannot supply launch commands or turn a host selection into permission to manage ordinary editors.

## Recovery without guessing

| What T3 reports                         | Useful next action                                                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Existing VS Code unavailable            | Start the bridge yourself in the intended VS Code session; check its actual port; retry                                               |
| Dedicated installation missing          | Install the dedicated hosts deliberately using the existing hosting installation guide; retry afterward                               |
| Port occupied by another process        | Inspect which program owns that exact port; this integration stops nothing and chooses no alternative                                 |
| Browser not ready                       | Open `http://127.0.0.1:18080/` in your browser, finish login, keep its tab open, and retry                                            |
| Managed job running but unhealthy       | Inspect that dedicated editor or private service logs; decide on a manual repair while other chats are idle                           |
| Saved settings invalid or unreadable    | Inspect the named session’s private `.acp.json`; repair or remove that companion deliberately, preserving the conversation checkpoint |
| Fixed URL conflicts with host selection | Remove the old generic fixed URL from this provider, or use a separate legacy fixed-URL provider                                      |
| Node executable unavailable             | Correct `BRIDGE_RUNNER_NODE` to an existing executable on the selected laptop                                                         |

For a read-only managed-host status check, open **Terminal**: press Command–Space, type Terminal, and press Return. Paste the following there, one block at a time. Spotlight opens Terminal; commands go into the Terminal window.

```bash
# Move Terminal to this laptop’s real playground checkout.
cd /Users/alanman/Developer/claude-local-bridge-playground
```

```bash
# Inspect dedicated jobs and listener ownership; this sends no model request.
node bin/bridge-hosts.js status
```

Success lists the three dedicated modes and whether their listeners are owned. It does not prove a model reply; a short T3 prompt provides that separate evidence. If the folder is absent, stop and locate the checkout on that laptop. Do not install into a random replacement folder.

To leave this integration, change the T3 provider command deliberately while chats are idle. The old `bin/t3-cursor-shim.sh` remains available for historical Cursor-driver configurations, and direct ACP without `--bridge-host` remains the fixed-URL route. Do not reuse the generic launcher with Cursor-only launch arguments. Returning to the old Cursor route may still encounter T3’s Cursor-authentication gate; the Local ACP route avoids that dependency.

## Architecture and customization range

| Layer              | Responsibility                                                                       | Main file                              |
| ------------------ | ------------------------------------------------------------------------------------ | -------------------------------------- |
| T3 launcher        | Node resolution, explicit startup defaults, protocol-only output                     | `bin/t3-bridge-runner.sh`              |
| ACP entry point    | Validate flags, reject fixed-URL conflict, forward local caller auth                 | `bin/local-bridge-acp.js`              |
| ACP session        | Advertise controls, snapshot each turn, connection activity, selection restore       | `src/runner/acp/agent.js`              |
| Settings companion | Validate and privately save the selected host                                        | `src/runner/acp/host-settings.js`      |
| Host policy        | Four endpoints, deadlines, connect-only VS Code, non-disruptive ensure               | `src/hosting/ensure.js`                |
| macOS adapter      | Cooperative lock, job/listener ownership, asynchronous launch and browser activation | `src/hosting/connection-operations.js` |
| Host table         | The one list of ports, launchd names, output parsers, readiness probe, and lock      | `src/hosting/hosts.js`                 |
| ACP turn helpers   | Prompt-block parsing and the per-turn connection card, out of the translator         | `src/runner/acp/prompt-content.js`, `src/runner/acp/bridge-connection.js` |
| Existing runner    | Model requests, approvals, tools, streaming, conversation checkpoints                | `src/runner/run.js`                    |

The present customization surface includes provider command/environment defaults, model selection, effort, output-token presets, Ask/Plan/Code, supported capability toggles, and the new host selector. These controls must be backed by real runner behavior. A model label added only to T3 does not establish upstream model support.

Future separate work could add validated step/time/cost controls, prompt templates, richer diagnostics, session listing/export/fork, or MCP (Model Context Protocol) services. Images are accepted since 2026-10-16 (one shared acceptor decides: media type, decoded size, base64 shape); audio and embedded context remain advertised as unsupported. Custom dashboards require a verified T3 extension surface or changes to T3 itself. Remote hosts and automatic failover are excluded. No additional controls are implemented merely because they appear in this possibilities list.

## Verification record and remaining acceptance

On the 2020 laptop, real short replies succeeded through Standalone, Desktop, and Browser from stopped state. One continuing chat retained the marker `MAPLE-2020` across those three connections. All three managed services remained running simultaneously. The existing/debug failure was verified with no port-11437 listener, and the selected existing/debug option survived quitting and reopening T3.

After quitting and reopening T3, the same chat replied `RESTORED_OK MAPLE-2020` through Standalone. The connection card’s title and plain-text details were verified in T3 on both failure and success. Two separate real ACP clients also completed simultaneous Standalone/Desktop turns, including a read-only `list_files` loop. Streaming cancellation settled in 115 milliseconds after the first chunk. A recovery check first hit the deliberately low 256-token limit; raising the test limit to 512 allowed that saved session to answer successfully. These scripted checks use real hosts and the real runner, but do not substitute for two simultaneous chats clicked through T3’s interface.

The existing/debug successful response, matching request visibility inside the ordinary VS Code diagnostics, and Standalone-to-original continuity require Alan’s ordinary bridge to be started. They remain separate from the successful managed-host responses. The 2024 laptop is outside this migration.

Mock-based tests cover passive discovery, endpoints/override, idempotent startup, occupancy and installation failures, unhealthy jobs, browser activation, cancellation, saved settings, turn boundaries, legacy behavior, caller-token forwarding, and protocol output. Passing mocks establish those controlled cases; they do not substitute for the remaining editor-level checks. See the dated implementation handoff for the final check counts, live-test spend, independent-review findings, and any remaining acceptance items.

## Related material

- [Dedicated host installation and manual controls](bridge-hosting-guide.html)
- [Historical September T3 Cursor-driver setup](t3-code-nightly-setup-2026-09-26.html)
- [ACP session configuration specification](https://agentclientprotocol.com/protocol/v1/session-config-options)
- [Markdown companion](t3-bridge-host-integration.md)
