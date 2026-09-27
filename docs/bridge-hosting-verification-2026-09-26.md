# Three bridge hosts: verification and handoff

September 26, 2026 · local macOS installation

All three requested modes are installed and have passed real model responses, streaming, and a real runner tool loop. Standalone is the mode left running. Read [the everyday guide](bridge-hosting-guide.html) for click-by-click use and the second-Mac procedure.

## Installed result

- Dedicated desktop VS Code: isolated user data and extension folder, bridge port 11447.
- Existing Homebrew Coder code-server: isolated user data and extension folder, editor port 18080 and bridge port 11457. Keep the browser editor tab open.
- Standalone: real Node process with no VS Code dependency at runtime, bridge port 11467. Managed by macOS independently of Terminal.
- Nine numbered Finder controls live in `~/Applications/Claude Bridge Lab`.
- Private settings, logs, jobs and copied source live in `~/Library/Application Support/Claude Bridge Lab`.
- A portable ZIP and extracted installer live in `~/Applications/Claude Bridge Lab Transfer`.
- Installation from that separate portable source folder succeeded. All 154 installed source and command-line files match the checkout byte for byte; both installed editor extension source trees also match.

The modes share existing request handling and credential lookup. Dedicated editor modes disable the interception proxy. Standalone uses explicit host settings rather than a mocked editor API. Port selection is strict, and the controller verifies listener process ownership before reporting readiness. Starting one mode stops the other dedicated modes. Regular editors are not controlled by these jobs.

## Final live acceptance

Tests used the existing local Claude login, model `claude-sonnet-5`, synthetic prompts, and a disposable synthetic folder. A successful web status alone was not accepted as proof. The runner had only the read-only `list_files` tool available.

| Mode | Bridge port | Test time (UTC) | Normal response | Stream | Tool calls / successful results |
| --- | --- | --- | --- | --- | --- |
| Desktop | 11447 | 2026-09-26T23:25:36.802Z | 200 / pass | 200 / pass | 1 / 1 |
| Browser | 11457 | 2026-09-26T23:26:08.046Z | 200 / pass | 200 / pass | 1 / 1 |
| Standalone | 11467 | 2026-09-26T23:26:54.327Z | 200 / pass | 200 / pass | 1 / 1 |

Each stream was reconstructed from its text events and checked for the expected answer. Each runner exited successfully after an actual tool invocation and result. Listener ownership was verified against the managed job. Aggregate records are in `~/.bridge-runner/hosting-verification/*-result.json`; private runner transcripts remain outside the repository and are not included in the transfer package.

Browser login and the editor status bar were inspected in Edge. Closing the browser tab was tested: code-server stayed alive, but the extension host exited and bridge port 11457 closed. Reopening an empty editor reactivated the extension. This is why the guide requires an open tab.

An early stream check incorrectly looked for a word inside individual stream chunks; the verifier was corrected to reconstruct the text. Initial editor startup with an untrusted folder prevented extension activation; launchers now open an empty editor. Reused transcript filenames initially accumulated prior tool counts; evidence files now use unique names. Final rows above each show one new tool call and one successful result.

## Automated checks and review

- Final full suite: **1,143 passed, 0 failed, 0 cancelled, 0 skipped, 1 pre-existing TODO**; 1,144 tests total. Exit status 0.
- Seven dedicated standalone/controller regression tests passed. They cover real child-process startup, caller authentication and private token persistence, duplicate-process rejection without damaging the original token, occupied ports, graceful shutdown with an unfinished request, cleanup after token-write failure, job configuration and operating-system lock ownership/recovery.
- JavaScript lint passed. Documentation defaults and runner manifest checks passed (15 offered models).
- Formatting check reports the same three pre-existing root handoff Markdown warnings: `HANDOFF-golden-eval-he06-thermo-nuclear-2026-09-06.md`, `HANDOFF-permission-cache-thermo-nuclear-2026-09-07.md`, and `HANDOFF-starlark-r11-thermo-nuclear-2026-09-06.md`.
- `git diff --check` passed.
- Independent read-only Codex review inspected startup, duplicate processes, controller locking, ownership and cleanup. Its final follow-up found no remaining functional blocker in those fixes. This was not a Cursor review and does not claim to be one.
- The HTML guide was opened and visually inspected in Edge. Both HTML documents are generated from their adjacent Markdown sources and use embedded styling.

Check output remains in `/tmp/claude-bridge-hosting-final-{tests,lint,docs,format}.log`; temporary logs are not permanent archival storage. No Starlark-specific test run was needed because its implementation was not changed.

## Memory and operational limits

Standalone measured **52 MiB resident memory in one process** at 2026-09-26T23:26:55Z. This counts resident pages only; compressed/swapped memory and shared-page accounting differ from Activity Monitor. Browser-host measurements omit the browser client and are not comparable totals. No precise savings percentage is claimed.

No overnight endurance, sleep/wake, full reboot, or live credential-refresh cycle was tested. No automatic login startup is enabled. Existing Claude Code login renewal remains external to this bridge; renew normally and restart if necessary. A sleeping laptop cannot serve local requests. Standalone uses fallback request fingerprint metadata because no editor interception is running.

The other Mac was not remotely installed or tested. Its documented prerequisites are Node 22+, desktop VS Code, Homebrew code-server and its own Claude Code login. The portable package excludes local settings, passwords, credentials, logs, transcripts and installed binaries. Host software prerequisites must be installed on that Mac separately.

## Agent handoff: location and ownership

Folder: `/Users/alanman/Developer/claude-local-bridge-playground`. Branch: `main`. Remote: `alankatanoisi/claude-local-bridge-playground`. At the original installation handoff, these changes were uncommitted. Alan subsequently authorized two separate commits and a push of main: one for the model/catalog work and one for the hosting work. Consult Git history for the resulting revisions; the chat handoff records verified push status.

Hosting-owned new files: `bin/bridge-hosts.js`, `bin/local-bridge-standalone.js`, `src/host-runtime.js`, `src/standalone.js`, `src/hosting/control.js`, `scripts/hosting/Install.command`, `scripts/hosting/verify-live.js`, `scripts/hosting/measure-memory.js`, `test/standalone-host.test.js`, and the `docs/bridge-hosting-*` guide, plan and verification files.

Hosting-owned modified files: `package.json`, `src/bridge-trace.js`, `src/caller-auth.js`, `src/extension.js`, `src/handlers/anthropic.js`, `src/handlers/debug.js`, `src/proxy.js`, `src/server.js`, `src/utils.js`. Changes introduce explicit host configuration, strict port behavior, optional capture proxy, deliberate debug-token copying and log redaction while retaining existing default extension behavior.

The other completed session owns the four command-builder/quickstart HTML modifications, `src/runner/model-catalog.js`, `src/runner/acp/agent.js`, and four runner tests (`acp-agent`, `context-management-rebuild`, `false-green-model-evolution`, `p1-07-model-catalog`). Those edits were preserved. Whole-source installation snapshots include them, but this task does not claim authorship or independent live validation of each newly listed model. Do not stage the entire working tree blindly.

## Follow-up boundaries

Use the controls to compare modes under your ordinary workload. Save and close any ordinary VS Code instance yourself if you want to reclaim its memory. Existing commands still default to bridge port 11437: set the documented `--bridge-url` explicitly when using a dedicated mode. A subsequent agent should inspect this handoff, current status and the source diff before committing or updating installed snapshots.
