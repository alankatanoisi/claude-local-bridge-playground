# Claude Code fingerprint automation

This folder contains the project-side history and macOS scheduling template for the local Claude Code fingerprint
checker. It is personal, unsanctioned research. The automation does not establish Anthropic approval.

## What the three commands do

Run these commands in **Terminal**, after changing to the playground folder:

```bash
cd /Users/alanman/Developer/claude-local-bridge-playground
```

- `npm run fingerprint:check` performs a read-only fingerprint comparison. It may create reports and a new ledger
  entry, but it does not edit bridge source code.
- `npm run fingerprint:due` reads the last successful local check. It runs a real check only when the last success is
  at least seven days old; otherwise it exits immediately.
- `npm run fingerprint:prepare` may prepare a manifest patch only when the repository is clean, the installed Claude
  Code release matches npm latest, and fingerprint drift is confirmed.

The `prepare` command may fast-forward a clean local `main`, create a branch named
`codex/fingerprint-refresh-YYYY-MM-DD`, edit the structured fallback manifest, and run validation. It never commits,
pushes, merges, resets, or discards work.

## Safety boundaries

The checker starts the locally installed `claude` binary with:

- a dummy OAuth value;
- a temporary Claude configuration directory;
- safe mode and no tools;
- an Anthropic base URL bound to a temporary server on `127.0.0.1`.

The mock receives the request and returns a tiny local streaming response. It does not forward anything to Anthropic.
The checker never reads the macOS Keychain and never runs `probe.js`.

Only explicitly allowlisted identity headers are retained. Authorization, OAuth tokens, `x-api-key`, session IDs,
retry/timeout values, billing values, request bodies, account metadata, and trace bodies are excluded. Existing
request-shape beta filtering remains in force, and newly observed beta families are not promoted without human review.

## Where records go

Detailed private records are written with owner-only permissions under:

```text
~/.bridge-runner/fingerprint-checks/
```

The main files are `last-run.json`, `last-success.json`, timestamped JSON records, and timestamped text reports.

Each real check also creates one append-only project entry under:

```text
docs/automation-ledger/fingerprint-checks/
```

This per-run layout avoids multiple processes appending to one shared Markdown file. A ledger entry is an ordinary
uncommitted Git file until Alan reviews and commits it. This is intentional: scheduled automation does not make Git
history decisions.

Important consequence: a new ledger entry makes the repository dirty. `fingerprint:prepare` will then refuse to edit
the fallback until the existing ledger/source changes have been reviewed and handled. That is the conservative
sign-in/sign-out boundary, not an error in the checker.

## Manual first run

In **Terminal**, run:

```bash
cd /Users/alanman/Developer/claude-local-bridge-playground
npm run fingerprint:check
```

Success looks like three final lines naming the action, the private local report, and the repo ledger entry. If drift is
found, the action says `report only`; check mode still does not edit the fallback.

Common failures:

- `claude --version check failed`: Claude Code is not available on Terminal's `PATH`. Confirm with `claude --version`.
- `npm registry version check failed`: the Mac is offline or npm is temporarily unavailable. The due checker will try
  again later because no successful-check timestamp is written.
- `localhost capture was incomplete`: Claude Code changed its request shape. Review the local report with an agent; do
  not weaken the allowlist just to make the check pass.
- `repository already has local changes`: prepare mode protected the existing work. Review `git status` before trying
  again.

## Optional macOS schedule

The tracked file `com.alanman.claude-fingerprint-check.plist` is a LaunchAgent template already filled with this Mac's
playground path. A LaunchAgent is a macOS background schedule that runs while the user is logged in.

The template invokes `fingerprint:due`:

- at login/wake opportunity through `RunAtLoad`;
- every four hours while the Mac is available;
- at Monday 12:00 PM as the preferred weekly time.

The seven-day due check is the real authority. Duplicate wakeups exit quickly, and a lock prevents overlapping real
runs. If Monday noon is missed because the laptop is asleep, the next overdue opportunity is recorded as `catch-up`.

No LaunchAgent was installed or loaded as part of adding this file.

### Install only after explicit approval

First perform the manual check above. It creates the log directory required by the LaunchAgent. Then, in **Terminal**:

```bash
mkdir -p /Users/alanman/Library/LaunchAgents
cp -n /Users/alanman/Developer/claude-local-bridge-playground/docs/automation-ledger/com.alanman.claude-fingerprint-check.plist /Users/alanman/Library/LaunchAgents/
plutil -lint /Users/alanman/Library/LaunchAgents/com.alanman.claude-fingerprint-check.plist
launchctl bootstrap gui/$(id -u) /Users/alanman/Library/LaunchAgents/com.alanman.claude-fingerprint-check.plist
```

`plutil` should print `OK`. The `launchctl bootstrap` command is usually silent when it succeeds. Because `cp -n` does
not overwrite an existing file, inspect and deliberately replace an old installed copy when updating the template.

To ask macOS to evaluate the due check immediately:

```bash
launchctl kickstart -k gui/$(id -u)/com.alanman.claude-fingerprint-check
```

To turn the schedule off without deleting project files:

```bash
launchctl bootout gui/$(id -u)/com.alanman.claude-fingerprint-check
```

The installed plist can then be moved from `~/Library/LaunchAgents` to the Trash in Finder. The repo template and run
history remain intact.

## Manual review workflow

When a check reports drift:

1. Review the timestamped local report and repo ledger entry.
2. Resolve or commit any unrelated local changes, including prior ledger entries.
3. Run `npm run fingerprint:prepare` in Terminal.
4. Review the proposed branch, manifest diff, and validation summary with an agent.
5. Commit, push, or merge only after explicit approval.

The structured fallback source of truth is `src/claude-code-fingerprint-fallback.json`. Body-level fallback system
blocks remain separately owned by `src/credentials.js` and are intentionally outside automatic patching.
