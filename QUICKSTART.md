# Claude Local Bridge — Quick Start Commands

## Step 1: Verify the bridge is running

First, make sure Terminal is in the playground checkout. This matters because this is the active OAuth-only experiment
lane.

```bash
cd "/Users/alanman/Developer/claude-local-bridge-playground"
```

If you see this folder in your prompt, you are in the right place:

```text
claude-local-bridge-playground
```

`/v1/debug` is locked. To use it, open **VS Code -> View -> Output**, choose **Claude Local Bridge**, copy the
`x-claude-local-bridge-debug-token` value from the startup log, then run:

```bash
curl -s http://localhost:11437/v1/debug \
  -H "x-claude-local-bridge-debug-token: PASTE_TOKEN_HERE" \
  | python3 -m json.tool
```

Success includes `"credentialPolicy": "oauth-only"` and `"authenticated": true`.

---

## Step 1.5: Caller auth is optional

The bridge no longer requires a second local caller token by default. This restores the older simple local setup.

Only use this section if you intentionally enable `claudeLocalBridge.requireCallerAuth` in VS Code settings. If you do
enable it, set a static token once:

```json
"claudeLocalBridge.callerAuthToken": "local-dev-token"
```

Then export it in the same Terminal tab where you run commands:

```bash
export BRIDGE_CALLER_TOKEN=local-dev-token
```

Quick check:

```bash
echo "$BRIDGE_CALLER_TOKEN"
```

You should see:

```text
local-dev-token
```

---

## Step 1.6: OAuth-only evidence mode

This playground intentionally ignores Anthropic Console API keys. Do **not** set a real `ANTHROPIC_API_KEY` for this
experiment. The only upstream credential path should be a Claude Code OAuth Bearer token from live interception,
`CLAUDE_CODE_OAUTH_TOKEN`, macOS Keychain, or `~/.claude/.credentials.json`.

Placeholder values like `local` may still be useful for client-side environment checks. The bridge does not forward
that placeholder value to Anthropic.

---

## Step 2: Test the bridge with a native Anthropic Messages request

```bash
curl -s -X POST http://localhost:11437/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-haiku-4-5","max_tokens":30,"messages":[{"role":"user","content":"say hi"}]}'
```

If this returns a response → bridge works.

If you see `Unauthorized: Missing Bearer token`, caller auth is enabled in VS Code settings. Either disable
`claudeLocalBridge.requireCallerAuth`, or use the optional token setup above.

---

## Step 3: If Step 2 fails — test token directly

```bash
node probe.js
```

This tests your OAuth token against multiple Anthropic endpoints and tells you which one works.

---

## Step 4: Point Claude Code CLI at the bridge

Run these in Terminal, not inside Claude Code:

```bash
export ANTHROPIC_BASE_URL=http://localhost:11437
export ANTHROPIC_API_KEY=local
claude "what is 2+2?"
```

This tells Claude Code to route its requests through the bridge instead of directly to Anthropic.
The bridge ignores the incoming `local` placeholder and uses your Claude Code OAuth token.

> **Note:** `ANTHROPIC_API_KEY=local` is only a local placeholder. Your OAuth setup is not affected.

---

## Step 5: Try the local runner carefully

The runner is a small coding-agent loop that uses this bridge. In Terminal, first change into the folder that contains
the runner:

```bash
cd "/Users/alanman/Developer/claude-local-bridge-playground"
```

Do not run these runner commands from:

```text
/Users/alanman/Library/Mobile Documents/com~apple~CloudDocs/Documents/GitHub/claude-local-bridge
```

That older checkout can be useful as a reference, but it may not have the current runner flags.

Start with a read-only or plan-style run:

```bash
node bin/local-bridge-runner.js \
  --cwd "/Users/alanman/path/to/project" \
  --allowed-tools list_files,read_file,search_text,git_status \
  --verbose \
  "List the top-level files, summarize the project, then stop. Do not edit files."
```

What to expect: the runner prints tips and progress lines in Terminal, asks the bridge for model responses, and leaves a
JSONL transcript under `~/.bridge-runner/logs/`. If you need a form instead of typing flags by hand, open
`docs/command-builder.html` in a browser and copy its generated command.

To keep a metadata flight recorder for a test run, add `--trace-level summary`:

```bash
node bin/local-bridge-runner.js \
  --cwd "/Users/alanman/path/to/project" \
  --trace-level summary \
  --allowed-tools list_files,read_file,search_text,git_status \
  "List the top-level files and stop. Do not edit files."
```

The runner prints its trace path in Terminal. A correlated bridge trace is written under
`~/.claude-local-bridge/traces/`. `summary` avoids prompt bodies. `redacted` and `full` can include source-code and prompt
details, so treat those files as sensitive.

Safety reminders:

- `--accept-edits` lets the model change project files without a write approval prompt.
- `--allow-shell` is required before the model can use bash commands.
- `--dont-ask` skips prompts for risky tools you already enabled; it does not enable shell by itself.
- A run that needs approval but has no interactive Terminal input is denied instead of silently approving.
- `--no-network` is a best-effort HTTP/HTTPS proxy guard for bash, not a true network sandbox.
- Traces show what the local bridge and runner saw; they do not expose Anthropic's private server-side telemetry.
- `--caller-token "$BRIDGE_CALLER_TOKEN"` is only needed if you intentionally enabled local caller auth. It is not your
  upstream Anthropic credential.

---
