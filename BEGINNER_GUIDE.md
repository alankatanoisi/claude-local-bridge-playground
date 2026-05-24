# Claude Local Bridge Beginner Guide

This guide is intentionally basic. It assumes you are on a Mac and you may not be comfortable with Terminal yet.

When this guide says **Terminal**, it means the Mac app named **Terminal**. Do not paste commands into Spotlight, a
browser address bar, or the VS Code search box.

---

## Cheat sheet: which folder am I in?

**Run this first** whenever you (or an agent) are about to edit, commit, or push:

```bash
pwd
git branch --show-current
```

| If `pwd` ends with… | You are in… | Branch should be… | What it’s for |
| ------------------- | ----------- | ----------------- | ------------- |
| `claude-local-bridge-playground` | **Playground** (alternate universe) | `playground/local-runner-chaos` | Your personal experiments — never production |
| `claude-local-bridge` (no `-playground`) | **Canonical** (serious lane) | `codex/runner-clean-pr` | Cleaner work you might port or merge later |
| Anything under `iCloud` or `claude-local-bridge-runner-test` | **Reference only** | (varies) | Don’t edit here unless you mean to |

**Quick jump commands:**

```bash
# Playground (experiments, harness, coordinator)
cd "/Users/alanman/Developer/claude-local-bridge-playground"

# Canonical (serious runner work)
cd "/Users/alanman/Developer/claude-local-bridge"
```

**Push safety:** Only push from playground if you mean to back up *experiments*. Playground uses branch `playground/local-runner-chaos`. Details: [lab-notes/PLAYGROUND_GIT_REMOTE.md](./lab-notes/PLAYGROUND_GIT_REMOTE.md).

**Wrong-folder symptoms:**

- `Unknown option '--session-id'` → you’re probably in canonical, not playground.
- Agent edited files you didn’t expect → ask which folder they used in their handoff.

---

## What This Project Is

The **bridge** is a local server on your Mac. It usually listens here:

```text
http://127.0.0.1:11437
```

Other tools can call that local server. The bridge then forwards requests to Anthropic using your saved Claude Code
credentials.

The **runner** is a command-line agent loop in this repo. It can ask the model what to do, run local tools such as
`read_file`, send tool results back to the model, and continue until it has a final answer.

The runner is now layered like a small **agent operating system**:

```text
Coordinator (optional top-level)  →  research / synthesize / execute / verify
Agent kernel (core loop)          →  model + tools + permissions + stop reasons
Session store                     →  canonical *.state.json for resume
Context compactor                 →  clip / snip / ghost when context grows
```

## Which Folder To Use

See the **cheat sheet at the top** of this guide. Short version:

| Folder                                                    | When to use it                                             |
| --------------------------------------------------------- | ---------------------------------------------------------- |
| `/Users/alanman/Developer/claude-local-bridge`            | Canonical bridge + runner work you may merge               |
| `/Users/alanman/Developer/claude-local-bridge-playground` | Experiments: coordinator, session store, compaction, hooks |

If you see `Unknown option '--session-id'`, you are in an older checkout. The new harness flags live in the
**playground** folder first.

## The Correct Folder (canonical runner)

For everyday runner work on the clean branch, use:

```bash
cd "/Users/alanman/Developer/claude-local-bridge"
```

For **playground experiments** (coordinator, session store, agent kernel):

```bash
cd "/Users/alanman/Developer/claude-local-bridge-playground"
```

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

Paste this (canonical folder):

```bash
cd "/Users/alanman/Developer/claude-local-bridge"

node bin/local-bridge-runner.js \
  --cwd "/Users/alanman/Developer/claude-local-bridge" \
  --allowed-tools list_files,read_file,search_text,git_status \
  --max-steps 8 \
  --verbose \
  "List the top-level files, summarize this project, then stop. Do not edit files."
```

**Playground** — same test with session persistence:

```bash
cd "/Users/alanman/Developer/claude-local-bridge-playground"

node bin/local-bridge-runner.js \
  --cwd "/Users/alanman/Developer/claude-local-bridge-playground" \
  --session-id safe-readonly-demo \
  --allowed-tools list_files,read_file,search_text,git_status \
  --max-steps 8 \
  --verbose \
  "List files under src/runner and summarize. Do not edit files."
```

After it finishes, check:

```bash
ls ~/.bridge-runner/sessions/
```

You should see `safe-readonly-demo.state.json` — that is the **canonical session file** (not the JSONL transcript).

## Use The Command Builder

Open this file in a browser:

```text
/Users/alanman/Developer/claude-local-bridge/docs/command-builder.html
```

Use it when you do not want to remember all the flags. Important fields:

- **Runner repo folder**: `/Users/alanman/Developer/claude-local-bridge` (or playground for new harness flags)
- **Target project folder**: the project you want the runner to inspect
- **Caller auth token**: optional local bridge password; only needed if you enabled caller auth
- **Tools**: start with only `list_files`, `read_file`, `search_text`, `git_status`
- **Session id** (playground): use `--session-id` for resumable runs with a `.state.json` file

## Top-Level Coordinator (playground only)

For multi-phase runs (research → synthesize → execute), use the coordinator CLI in the playground:

```bash
cd "/Users/alanman/Developer/claude-local-bridge-playground"

node bin/local-bridge-coordinator.js \
  --cwd "/Users/alanman/Developer/claude-local-bridge-playground" \
  --no-workers \
  "Explain the runner architecture in plain English. Do not edit files."
```

Add `--no-workers` while learning — it skips background subprocess workers and keeps things simpler.

## Common Problems

### Unknown option `--output-format` or `--session-id`

You are in the wrong folder or an old checkout. Run:

```bash
cd "/Users/alanman/Developer/claude-local-bridge"
node bin/local-bridge-runner.js --help
```

For playground harness flags (`--session-id`, coordinator), use:

```bash
cd "/Users/alanman/Developer/claude-local-bridge-playground"
node bin/local-bridge-runner.js --help
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
