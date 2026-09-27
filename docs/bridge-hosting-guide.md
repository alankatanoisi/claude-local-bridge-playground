# Claude Bridge: three ways to run it

A practical guide for Alan · September 26, 2026

**Start with Standalone when memory is tight.** It runs the bridge without a desktop editor, browser tab, or cmux. Desktop and Browser are available for comparison. Each mode uses the same bridge request-handling code and the existing Claude login on this Mac.

This is a personal research setup. It is installed locally; it does not publish a server on the internet. The other laptop still needs its own installation and Claude login.

## Open the controls on this laptop

1. Click the blue smiling **Finder** icon in the Dock.
2. In Finder's menu bar, choose **Go → Go to Folder** (or press Shift–Command–G).
3. Paste `~/Applications/Claude Bridge Lab` and press Return. The `~` means your own home folder.
4. Double-click one of the numbered `.command` files. These open **Terminal**, the app that runs written commands. You do not paste commands into Spotlight or the browser address bar.

| Control | What it does | What success looks like |
| --- | --- | --- |
| 1 Start Desktop | Starts an isolated desktop VS Code instance, containing the bridge extension | A window titled Claude Bridge — desktop; its status bar shows port 11447 |
| 2 Start Browser | Starts the existing Coder code-server and opens your normal browser | An empty browser editor; its status bar shows port 11457 |
| 3 Start Standalone | Starts the bridge as a background process managed by macOS | Terminal says the dedicated standalone bridge is listening on port 11467; no editor opens |
| 4 Status | Checks all three dedicated modes and listener ownership | The selected mode says running and listening (owned) |
| 5 Stop Dedicated Bridges | Stops only the three jobs created by this installer | Dedicated modes stop; your ordinary editor and its bridge are not targeted |
| 6 / 7 / 8 Test | Sends a small real model request through the named mode | PASS and BRIDGE_OK |
| 9 Open Guide | Opens this guide in a browser | This page appears |

A **port** is a numbered connection point on your computer. A **listener** is a program waiting at one of those connection points. “Listening” proves startup; **Test** proves a real model response. The Test controls use a small amount of model usage.

Starting a different mode stops the other dedicated modes. Finish any active runner request before switching: switching interrupts requests to the old mode. The installer does not stop your ordinary VS Code or its existing bridge on port 11437. Close that ordinary editor yourself once your work there is saved if you want to reclaim its memory.

The launcher's Terminal window can close after the command completes. macOS keeps the selected background job running independently. Desktop mode still needs its dedicated editor instance. Browser mode still needs its editor tab.

## Browser login and the important tab limitation

The browser address is **http://127.0.0.1:18080/**. That is the editor page, not the model endpoint. `127.0.0.1` means this computer. cmux is not involved.

The Start Browser control copies a randomly generated, laptop-local editor password to the clipboard. If the browser asks for a password, click the password field, press Command–V, and click Submit. Do not save it to a password manager unless you want to. Starting Browser again copies it again. This password protects only the local code-server editor; it is not your Claude password or login token.

**Keep this tab open while using Browser mode.** In the live test on this laptop, closing the tab cleanly terminated the extension host and the bridge listener. code-server itself remained running. Reopening the editor activates the bridge again. An extension host is the process that runs an editor's extensions.

Use the empty editor window provided by the launcher. Opening an untrusted folder can disable the bridge extension. There is no need to open a project in this dedicated editor: the runner's `--cwd` chooses the project separately.

## Connect the runner to the selected mode

The dedicated modes deliberately use separate addresses so they do not collide with the everyday bridge.

| Mode | Messages endpoint for the runner |
| --- | --- |
| Desktop | `http://127.0.0.1:11447/v1/messages` |
| Browser | `http://127.0.0.1:11457/v1/messages` |
| Standalone | `http://127.0.0.1:11467/v1/messages` |
| Existing everyday bridge | `http://127.0.0.1:11437/v1/messages` (not controlled here) |

An **endpoint** is an address to which a program sends requests. In your command builder, use the bridge URL setting if offered. Otherwise append `--bridge-url` followed by the matching address to the runner command it generates. The runner's default remains port 11437; starting a dedicated mode does not silently redirect an existing runner command.

For an optional read-only check from the project checkout on either Mac, open Terminal with Command–Space, type **Terminal**, press Return, then enter the following blocks one at a time. Spotlight is used only to open Terminal; the commands go inside Terminal.

First choose the project folder:

```bash
# Move Terminal into the Claude playground checkout on this Mac.
cd "$HOME/Developer/claude-local-bridge-playground"
```

Then, after starting Standalone, run:

```bash
# The bridge URL selects the standalone host.
# --cwd selects the folder the agent may inspect.
# --trust-workspace records your consent to inspect this particular folder.
# --tools exposes only the read-only file-listing tool for this example.
node bin/local-bridge-runner.js \
  --bridge-url http://127.0.0.1:11467/v1/messages \
  --cwd "$PWD" \
  --trust-workspace \
  --tools list_files \
  --max-steps 4 \
  "Use list_files once and briefly describe the top-level folders."
```

Success is an actual file-listing tool result and a final answer. If the folder command fails, stop and locate your real checkout in Finder; do not run from an unrelated folder. The portable installer bundle is for installing the hosts and does not replace your working project checkout.

## Install on the other laptop

**Use the portable installer bundle supplied with this task.** It contains code and documentation, not this laptop's settings, passwords, logs, transcripts, or Claude credentials. The hosting source is also included in the playground repository. After syncing a checkout that contains these additions, run scripts/hosting/Install.command from that checkout; downloading source alone does not install or update the hosts.

The bundle is `Claude-Bridge-Installer-2026-09-26.zip`, next to the launcher folder in `~/Applications/Claude Bridge Lab Transfer/`. Use Finder's AirDrop or your usual private file-transfer method to copy it to the other Mac. Transfer is your action; this task does not send files to another device.

1. On the other Mac, double-click the ZIP in Finder to extract **Claude Bridge Installer**.
2. Move that extracted folder into your **Developer** folder. In Finder, **Go → Home**, then open or create **Developer**. The resulting path should be `~/Developer/Claude Bridge Installer`.
3. Confirm the prerequisites below. Installation is intended for your normal signed-in macOS account.
4. Inside **Claude Bridge Installer**, open **docs → bridge-hosting-guide.html** to keep this guide handy.
5. Open **scripts → hosting → Install.command** by double-clicking it. Terminal displays the source folder and intended Library installation folder, installs both bridge extensions, then reports that all three modes are installed.
6. In Finder, use **Go → Go to Folder**, enter `~/Applications/Claude Bridge Lab`, and try **3 Start Standalone**, followed by **8 Test Standalone**.
7. Try **1 Start Desktop → 6 Test Desktop**, then **2 Start Browser → 7 Test Browser**. For Browser, complete the local password login first and leave the editor tab open.

**Prerequisites:** Node.js version 22 or newer, desktop Visual Studio Code in `/Applications/Visual Studio Code.app`, Coder code-server installed through Homebrew, and a working Claude Code login on that laptop.

Node.js is the program that executes our JavaScript. Homebrew is a macOS software installer. If your other Mac already has them, keep the existing installations.

To check Node.js, open Terminal on that Mac and enter `node --version` from any folder. Success is `v22...` or newer. If Terminal says command not found, use the official [Node.js download page](https://nodejs.org/en/download) or your existing Homebrew setup. Install Visual Studio Code from its [official download page](https://code.visualstudio.com/download), then place it in Applications.

To check code-server, enter `code-server --version` in Terminal from any folder. If it is missing and Homebrew already works, run this in Terminal:

```bash
# Download Coder's browser-hosted editor using the existing Homebrew installer.
brew install code-server
```

Success is that `code-server --version` prints its version. If `brew` is missing, follow the official [Homebrew setup](https://brew.sh/) first. Coder's [macOS installation documentation](https://coder.com/docs/code-server/install#macos) describes this installation route.

For Claude, use your normal Claude Code sign-in on the other Mac. This installer reads that laptop's existing login. It does not copy the first Mac's Keychain entries or token files, and it does not implement Claude's login or refresh process.

If Finder refuses to execute the command file or it opens as text, use Terminal instead. First enter:

```bash
# Use the folder you intentionally placed in Developer.
cd "$HOME/Developer/Claude Bridge Installer"
```

Then enter:

```bash
# Run the same installer directly. Success prints the launcher-folder path.
node bin/bridge-hosts.js install
```

Do not bypass a browser or macOS security warning automatically. Read what it identifies and ask for help if it does not match this bundle and your intended local install.

## Stop, restart, update, and remove

**Stop:** double-click **5 Stop Dedicated Bridges**. To restart, stop and then select the desired Start control. Browser mode additionally needs its tab reopened or refreshed. None of these controls log you out of Claude.

**After logging out or restarting the Mac:** start your chosen mode again. Automatic startup at login is not enabled. Closing Terminal after starting a mode is fine. Sleeping the Mac pauses local work; this setup does not make a sleeping laptop answer requests.

**Update the installed code:** after a hosting code change, run Install again from the updated checkout or a new bundle. It stops managed modes and installs a fresh snapshot. A snapshot is a copy of the source at a particular moment; edits in the research checkout do not alter an already-installed snapshot. Old snapshots remain under the Library installation folder for inspection. Installation rewrites the dedicated host settings to the documented defaults; preserve intentional customizations separately before reinstalling.

**Remove the installation:** first use Stop. In Finder, move `~/Applications/Claude Bridge Lab` and `~/Library/Application Support/Claude Bridge Lab` to Trash. Use Go to Folder to reach the hidden Library location. This removes these launchers and their private local state. It does not remove VS Code, Node.js, Homebrew code-server, your source checkout, or Claude login. Emptying Trash is unnecessary. The installer creates no persistent entry in `~/Library/LaunchAgents`.

## Troubleshooting

| Symptom | Meaning and next action |
| --- | --- |
| Status says listening, but the runner fails | Confirm the runner's bridge URL matches the selected mode; then run its Test control |
| Browser job running, bridge not listening | Open http://127.0.0.1:18080/, sign in if asked, and wait for Claude Bridge :11457 in the status bar |
| Restricted Mode is visible | Return the dedicated editor to an empty window; do your project editing in your ordinary editor |
| Port is occupied | The controller refuses to take over an unrelated program. Use Stop for managed modes; ask for help identifying anything else using that exact port |
| A controller operation is active | Wait for the other Start/Stop/Install command. The temporary control lock releases automatically when the controller exits; if the message persists, ask for help identifying the program using control port 18081 |
| Test reports HTTP 401 | Refresh your normal Claude Code login on this Mac, then stop and restart the selected bridge to clear its credential cache |
| Test reports another HTTP error | Keep the status code; it distinguishes model availability, upstream failure, and local setup. Do not paste credential files into chat |
| macOS asks for Keychain access | Confirm it is the expected local Node/Code process accessing your Claude Code login. A denied request can prevent authentication |
| An app update moved an executable | Run Install again; it records this Mac's current Node, VS Code, and code-server paths |
| Installer fails | Earlier working snapshots are retained. Stop managed modes and rerun after correcting the reported missing prerequisite; do not delete the source checkout |

Private installation state is at `~/Library/Application Support/Claude Bridge Lab`. Logs are under `logs/`; installed source copies are under `releases/`. The standalone debug token is private at `standalone/debug-token.json`. In an editor host, the command palette offers **Claude Local Bridge: Copy Debug Token** for deliberate diagnostic access; it is not printed into persistent logs.

Model endpoint caller authentication retains the repository's existing loopback-only default (off). The editor page has its own local password; debug endpoints have their separate token. These are different controls for different connections. All listeners remain on this Mac's loopback interface; this installation does not expose the editor or bridge to your phone or the network.

## Evidence and limits

See [the dated verification report](bridge-hosting-verification-2026-09-26.html) for exact checks and observed behavior. All three modes were exercised with a real normal response, a real stream, and a runner request that called `list_files` against a synthetic folder. Browser tab closure was tested and stopped the extension. The other laptop has not been installed or tested by this session.

No overnight endurance, sleep/wake, full reboot, or automatic credential-refresh guarantee is implied. The bridge relies on the existing local Claude login; if that login needs renewal, use Claude Code normally and restart the bridge. The standalone host uses the repository's fallback request fingerprint because no editor interception is running; a future upstream compatibility change may require updating the installed snapshot.

Memory observations are point-in-time diagnostics, not a promise of a specific saving. Browser-process memory must be counted alongside code-server, and macOS compression makes resident-page snapshots differ from Activity Monitor's memory figures. Standalone avoids both editor hosts and the browser client.
