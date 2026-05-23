# Claude Local Bridge Beginner Guide

This guide is intentionally basic. It assumes you are on a Mac and you may not be comfortable with Terminal yet.

When this guide says **Terminal**, it means the Mac app named **Terminal**. Do not paste commands into Spotlight, a
browser address bar, or the VS Code search box.

## What This Project Is

The **bridge** is a local server on your Mac. It usually listens here:

```text
http://127.0.0.1:11437
```

Other tools can call that local server. The bridge then forwards requests to Anthropic using your saved Claude Code
credentials.

The **runner** is a command-line agent loop in this repo. It can ask the model what to do, run local tools such as
`read_file`, send tool results back to the model, and continue until it has a final answer.

## The Correct Folder

For the current runner work, use this folder:

```bash
cd "/Users/alanman/Developer/claude-local-bridge"
```

You are in the right folder if this command:

```bash
pwd
```

prints:

```text
/Users/alanman/Developer/claude-local-bridge
```

If you run from the older CloudDocs checkout, you may see errors like:

```text
Unknown option '--output-format'
```

That means Terminal is in the wrong checkout.

## Open Terminal

1. Press `Command + Space`.
2. Type `Terminal`.
3. Press `Return`.

You should see a prompt that looks roughly like:

```text
alanman@Alans-Laptop ~ %
```

That is where commands go.

## Verify The Bridge

Paste this into Terminal:

```bash
curl -s http://127.0.0.1:11437/v1/debug | python3 -m json.tool
```

Success includes:

```json
"status": "running"
```

and:

```json
"authenticated": true
```

## Local Caller Token Is Optional

The bridge used to require a local caller-auth token, which made simple curl and runner commands harder. The default is
now back to the simpler behavior: no local caller token is required.

This token is not your Anthropic token. It is only a local password between your terminal command and your local bridge.

Only use this section if you intentionally turn on `claudeLocalBridge.requireCallerAuth` in VS Code settings.

If you turn caller auth on, set this in VS Code settings JSON:

```json
"claudeLocalBridge.callerAuthToken": "local-dev-token"
```

Then in the same Terminal tab where you run bridge commands:

```bash
export BRIDGE_CALLER_TOKEN=local-dev-token
```

Check it:

```bash
echo "$BRIDGE_CALLER_TOKEN"
```

You should see:

```text
local-dev-token
```

## Test Models

Run this:

```bash
curl -s http://127.0.0.1:11437/v1/models | python3 -m json.tool
```

If you see:

```text
Unauthorized: Missing Bearer token
```

then caller auth is enabled. Either disable `claudeLocalBridge.requireCallerAuth`, or use the optional caller-token setup
above.

## Run A Safe Read-Only Runner Test

Paste this:

```bash
cd "/Users/alanman/Developer/claude-local-bridge"

node bin/local-bridge-runner.js \
  --cwd "/Users/alanman/Developer/claude-local-bridge" \
  --allowed-tools list_files,read_file,search_text,git_status \
  --max-steps 8 \
  --verbose \
  "List the top-level files, summarize this project, then stop. Do not edit files."
```

What should happen:

- Terminal prints runner tips.
- The runner sends a request to the local bridge.
- The model may ask for read-only tools.
- The runner prints a final answer.

## Use The Command Builder

Open this file in a browser:

```text
/Users/alanman/Developer/claude-local-bridge/docs/command-builder.html
```

Use it when you do not want to remember all the flags. Important fields:

- **Runner repo folder**: `/Users/alanman/Developer/claude-local-bridge`
- **Target project folder**: the project you want the runner to inspect
- **Caller auth token**: optional local bridge password; only needed if you enabled caller auth
- **Tools**: start with only `list_files`, `read_file`, `search_text`, `git_status`

## Common Problems

### Unknown option `--output-format`

You are in the wrong folder. Run:

```bash
cd "/Users/alanman/Developer/claude-local-bridge"
```

### Unauthorized: Missing Bearer token

Caller auth is enabled. The easiest beginner fix is to disable `claudeLocalBridge.requireCallerAuth` in VS Code settings,
then restart the extension.

If you want to keep caller auth enabled, run:

```bash
export BRIDGE_CALLER_TOKEN=local-dev-token
```

Then include either:

```bash
--caller-token "$BRIDGE_CALLER_TOKEN"
```

or a curl header:

```bash
-H "Authorization: Bearer $BRIDGE_CALLER_TOKEN"
```

### Connection refused

The bridge is not running, or it is on a different port. In VS Code, open **View -> Output**, choose **Claude Local
Bridge**, and look for the real port.

## Safe Defaults

Start with:

```bash
--allowed-tools list_files,read_file,search_text,git_status
```

Avoid these until you know why you need them:

```bash
--accept-edits
--allow-shell
--dont-ask
```

Use tracing when you want local observability:

```bash
--trace-level summary
```

`summary` avoids prompt bodies. `redacted` and `full` can include source-code and prompt details, so treat those files
as sensitive.
