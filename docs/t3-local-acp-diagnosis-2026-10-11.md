# T3 Code: bridge runner connection diagnosis

Verified on Alan's Mac on October 11, 2026. Installed T3 Code Nightly: `0.0.46-nightly.20261011.2980`.

## Resolution verified October 16, 2026

The manual local ACP connection is now saved and working on **2020 MacBook Air (Alan)** in T3 Code Nightly `0.1.1-nightly.20261016.3190`. The October 11 investigation below is retained as historical evidence; its pending setup statements describe that earlier session.

The provider is **Bridge Runner (Local ACP)**, instance ID `acpRegistry_bridge_runner`, using the executable and two environment variables listed below, with no arguments. One additional environment variable is required for the selected bridge on this laptop: `BRIDGE_RUNNER_BRIDGE_URL=http://127.0.0.1:11467/v1/messages`.

T3 discovered the runner's models without a Cursor login. The first live hello attempt failed with `ECONNREFUSED` at port `11437`: no ordinary bridge was running. All managed bridge services were also stopped. Starting the already-installed standalone service and pointing this provider to port `11467` resolved that separate transport problem.

A fresh T3 chat, using Claude Haiku 4.5 through the local ACP provider with supervised approvals and runner Ask mode, completed the requested response: “Hello Alan — Bridge Runner on the 2020 laptop is connected.” The test requested no tools or file access. The standalone bridge was left running, and the old Cursor-based bridge entry was left disabled.

To restart the existing service later, open **Finder**, press **Command–Shift–G**, enter `/Users/alanman/Applications/Claude Bridge Lab`, and double-click **3 Start Standalone.command**. A Terminal window should report that the bridge is listening on port `11467`. A listening message establishes startup; a completed T3 reply establishes the model connection.

No runner, launcher, bridge, or authentication source changes were required. T3's provider settings were saved outside this repository in `/Users/alanman/.t3/userdata/settings.json`. Validation established discovery, the saved endpoint, controller ownership of the running service, and one completed live reply. Tool approvals, file edits, cancellation, other models, and long-running sessions were not exercised during this setup. Alan separately reported that the manual ACP setup worked on the 2024 laptop; that machine was not inspected in this session.

## Finding

The old bridge-runner provider is configured as a Cursor provider. This T3 version uses Cursor's Agent SDK (Software Development Kit) for that provider instead of launching the configured ACP (Agent Client Protocol) command. The installed code requires Cursor credentials before opening a Cursor SDK agent. The live app shows the corresponding sign-in warning, and Alan's failed turn reports “Cursor Agent SDK open failed.”

Our launcher still works. The appropriate replacement is T3's new **Local ACP command** provider, which starts an existing executable and speaks ACP directly to it. No Cursor account is needed for this connection: the bridge runner advertises an empty list of authentication methods because the local bridge handles Claude credentials.

Signing into Cursor would enable T3's actual Cursor agent. It would not make that provider run our bridge runner.

## Prepared replacement

Open the **T3 Code (Nightly) app**, then **Settings → Providers → Add provider → Local ACP command**. These values belong in T3's settings fields, not Terminal.

- Label: `Bridge Runner (Local ACP)`.
- Instance ID: `acpRegistry_bridge_runner`.
- ACP source: `Local command`.
- Executable: `/Users/alanman/Developer/claude-local-bridge-playground/bin/t3-cursor-shim.sh`.
- Arguments: none.
- Environment variable `BRIDGE_RUNNER_NODE`: `/Users/alanman/.local/bin/node`.
- Environment variable `BRIDGE_RUNNER_CAPABILITIES`: `edits`.
- Both variable values are ordinary local settings; they are not credentials.

The existing launcher starts `bin/local-bridge-acp.js` and already works with no arguments. Although its filename mentions Cursor, its normal execution path is also usable as a generic ACP launcher. Its old identity-probe compatibility code is unnecessary for the new provider but does not prevent this connection.

No new launcher or runner source change is required by the startup evidence. The existing launcher preserves Alan's previously selected shell setting and file-edit capability. These are separate from approval behavior: supervised Ask mode requests approval for effectful tools; runner hard denies remain in place. Selecting full access can allow commands without a permission card. Do not change access modes simply to repair provider discovery.

## Current verification status

- Repository location and root: `/Users/alanman/Developer/claude-local-bridge-playground`.
- Git branch: `main`; starting revision: `8ef529f3e026d55faf59e641baeecd01faa7c1b7`.
- GitHub remote: the expected `alankatanoisi/claude-local-bridge-playground` repository.
- Starting working tree was clean. Safe fast-forward pull reported “Already up to date.”
- The live T3 app was inspected and the new Local ACP wizard was exercised.
- A replacement provider was prepared at the **Add instance** step. Saving it and running a brief model test await Alan's choice.
- The old provider was preserved.
- Focused ACP agent, transport, and T3 launcher tests: **59 passed, 0 failed**.
- A direct no-model startup probe used the same launcher and variables as the proposed provider. It returned agent name `bridge-runner-acp`, agent version `1.0.0`, protocol version `1`, and no authentication methods.
- T3's generic ACP runtime requests protocol version `2`; the runner responds with version `1`. Actual T3 discovery remains necessary to verify that negotiation end to end.
- The HTTP listener on `127.0.0.1:11437` responded to a read-only request with an unknown-route error. This establishes a responding listener only. The current bridge source has no `/ping` or `/health` route, so those addresses do not establish readiness.

## What success must look like

After saving, refresh provider status inside T3. The new provider should discover the runner's models and options and should not request a Cursor login. Then use a fresh test chat with **Bridge Runner (Local ACP)** selected and send a brief hello prompt. A completed reply is the next useful proof that T3, the ACP runner, the bridge, and upstream Claude authentication work together.

If discovery fails, inspect the new provider's exact startup error before changing code. If discovery succeeds but a prompt fails, diagnose the bridge/model request separately. A ready provider card alone does not prove a successful model call.

An existing chat associated with the old Cursor instance should not be assumed to migrate its underlying session automatically. Preserve its history and use a fresh test chat first. Session continuation, permissions, questions, cancellation, images, and prolonged operation are separate checks; the focused automated tests do not establish every feature in the new T3 connection.

T3's generic ACP provider does not supply application-level text generation such as automatic thread titles, branch names, or commit-message generation. Those helpers may need another T3 provider. This limitation does not itself prevent normal runner chat.

## Evidence and handoff

The strongest version-specific evidence is the installed application archive: `/Applications/T3 Code (Nightly).app/Contents/Resources/app.asar`. Its packaged server contains Cursor SDK credential checks and the generic ACP local-command driver. Selected packaged files were extracted for read-only examination under `/tmp/t3-acp-diagnosis-20261011/`; this temporary directory is not a durable installation or repository.

The existing provider settings were read selectively from `/Users/alanman/.t3/userdata/settings.json`. Do not copy credentials or raw logs into reports. Our executable and protocol implementation are `bin/t3-cursor-shim.sh`, `bin/local-bridge-acp.js`, and `src/runner/acp/agent.js`.

Official upstream source corroborates the installed behavior:

- [Cursor provider driver](https://github.com/pingdotgg/t3code/blob/main/packages/provider-cursor/src/server/driver.ts): SDK agent startup requires Cursor authentication.
- [Generic ACP provider driver](https://github.com/pingdotgg/t3code/blob/main/packages/provider-acp-registry/src/server/driver.ts): generic ACP model/configuration discovery and application helper limits.

These upstream links track a moving branch. The installed app, rather than a potentially different web revision, was used for the version-specific conclusion.

Files added by this diagnosis: this Markdown report and its standalone HTML companion. Runner, bridge, authentication, and launcher source are unchanged. Documentation-default and runner-manifest checks passed. Formatting checks passed for both new report files after formatting the HTML companion. Full repository tests, lint, and broad formatting checks were not run because there is no runtime source change. No commit or push was performed. Remaining risk: the prepared generic connection still needs live T3 discovery and a completed model reply before it can be called a verified repair.
