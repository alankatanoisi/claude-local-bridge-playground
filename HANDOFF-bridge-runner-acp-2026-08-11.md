# Handoff — Bridge Runner over ACP (Agent Client Protocol)

**Written:** 2026-08-11, end of a long working session with Alan.
**Audience:** the next coding agent. Alan should not need to explain any of this again.

---

## START HERE

Alan will paste a short prompt pointing you at this file. Do this in order:

1. **Read the working agreement first** —
   `docs/working-with-alan.md` in this repo, then `docs/agent-user-autonomy-boundary-2026-08-11.md`.
   Do not skip these; they change how you should talk, not just what you should do.
2. **Run the startup preflight** from `AGENTS.md` (`pwd`, branch, remote, `git status --short`).
3. **Expect uncommitted work.** Slice A (below) is finished but **not committed**: four
   modified files under `src/runner/` plus `test/runner/headless-ports.test.js`. Do not
   discard, stash, or `git checkout` over them, and do not commit them without asking.
   Verify they are still intact with `npm test` (expect 1000 pass / 0 fail / 1 todo).
4. **Then start Slice B** (§3). Slice A is done; A's whole purpose was to make B possible
   without touching `run.js` again.

Other agents may be working in this repository at the same time. Never kill processes by
pattern match, and never touch Alan's live T3 Code app on port 3773.

---

## 0. Read this first

**How to work with Alan is documented, not folklore.** Read
`/Users/alanman/Developer/claude-local-bridge-playground/docs/working-with-alan.md`
before your first substantive reply. Short version: he is a strong systems thinker and a
deliberate novice programmer; this is long-horizon personal research with no shipping
destination; expand every acronym on first use; his basic questions are the working method
and deserve complete, condescension-free answers. Also read
`docs/agent-user-autonomy-boundary-2026-08-11.md` in the same repo (hard boundary on
unsolicited policy commentary).

In the T3 Code fork, `/Users/alanman/Developer/t3code/FORK.md` carries the same context and
states that upstream's `AGENTS.md` rules stand but Alan's intent wins in the fork.

---

## 1. What this project is

Alan has a personal "bridge runner": a local coding-agent loop in plain JavaScript
(`/Users/alanman/Developer/claude-local-bridge-playground`) that talks to Anthropic models
through a local bridge (a VS Code extension exposing Claude Code credentials on
`localhost:11437`). He drives it from the terminal via a copy-paste command builder.

The goal being explored: make the bridge runner a **first-class provider inside T3 Code**
(the open-source coding-agent GUI he forked), speaking **ACP (Agent Client Protocol)** over
stdio — so it gets a real graphical interface, clickable dropdowns instead of
command-line flags, clickable approve/deny cards, and remote/mobile access — instead of
impersonating T3's built-in Claude provider through environment variables.

---

## 2. Where everything stands

### Repositories

| Path                                                      | Branch                               | State                                                                                                                      |
| --------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `/Users/alanman/Developer/claude-local-bridge-playground` | `main`                               | Clean and **pushed** except `starlark-host/experiment.config.json` (Alan's own unrelated one-line change — leave it alone) |
| `/Users/alanman/Developer/t3code` (his fork)              | `main`                               | Synced with upstream (merge `5f8c13892`) and **pushed**                                                                    |
| `/Users/alanman/Developer/t3code-bridge-ui`               | `claude/bridge-runner-mock-provider` | **Uncommitted** — this session's working interface mock                                                                    |
| `/Users/alanman/Developer/t3code-acp-poc`                 | `codex/bridge-runner-acp-poc`        | **Uncommitted** — Codex's earlier protocol proof of concept                                                                |

Nothing in the two worktrees has been committed. That is deliberate, not an oversight.

### Done this session

1. **Verified Codex's earlier ACP proof of concept** against the actual T3 source. Sound
   overall; five corrections found (documented in conversation, summarised in §5 below).
2. **Owner-profile documentation** written and pushed across both repos — see
   `docs/working-with-alan.md` (+ `.html`), the additions to `AGENTS.md`/`CLAUDE.md`,
   `.github/copilot-instructions.md`, `README.md`, and `FORK.md` in the fork.
3. **A dependency security fix** in the playground (`js-yaml` 3.15.0 → 3.15.1, commit
   `6c5176e`, 993/993 tests passing, zero vulnerabilities reported afterwards).
4. **Slice "step 1" — a working mock provider in the real T3 interface.** Details below.

### The interface mock (working, verified end to end)

Three uncommitted files in `/Users/alanman/Developer/t3code-bridge-ui`:

- `apps/server/scripts/bridge-runner-mock-agent.ts` — a fake ACP agent advertising three
  models (`bridge-fable-5`, `bridge-sonnet-5`, `bridge-haiku-4.5`) each with Effort /
  Token Budget / Fast controls; emits plan → tool call → permission request → streamed
  reply echoing the live settings. No model call, no credential, no file touched.
- `apps/server/scripts/bridge-runner-agent-shim.sh` — answers T3's `about --format json`
  probe with fixed placeholder details, then hands `acp` to the mock agent.
- `.t3/userdata/settings.json` (gitignored) — registers a second Cursor-driver instance
  named **"Bridge Runner"** and disables all five built-in providers so their probes never
  touch the shared CLI home directories Alan's other agents are using.

**Zero T3 production files were modified.** The mock rides T3's Cursor driver as a host
because that driver probes its agent for models and builds composer dropdowns from whatever
the agent advertises. The only tell is the Cursor icon.

Run it: from `/Users/alanman/Developer/t3code-bridge-ui`, with
`PATH="$PWD/node_modules/.bin:/usr/local/bin:$PATH" vp run dev`. Ports are **15470**
(server) / **7430** (web), derived from the worktree path. The startup log prints a
single-use pairing URL — **hand it to Alan; do not consume it**, because the startup token
carries admin scopes he needs for the Settings screen. A replacement standard-scope token
comes from `node apps/server/src/bin.ts pair`.

**The dev server is currently stopped** (Alan asked for the ports down). His live T3 app
runs on port **3773** — never touch it, and never kill processes by pattern match.

---

## 3. Next session's job: the A/B/C/D build plan

The interface question is answered. All remaining work is functional and structural, and it
lives almost entirely in the **playground repo**, not in T3.

### Slice A — DONE (built at the end of this session, uncommitted)

Implemented in the playground repo, all additive, full suite green (1000 pass / 0 fail,
up from 993 — the 7 new tests). Lint, format, and docs checks pass. **Not committed.**

- `src/runner/run.js` — `makeOutput` takes an optional `onEvent` subscriber (faults are
  swallowed so a bad subscriber can't kill a run); `options.confirm` is merged over the
  terminal module so omitted methods fall back; the failure-recovery prompt uses that
  merged port; `ctx.askUserQuestion` added.
- `src/runner/tools/ask-user-question.js` — prefers the injected asker.
- `src/runner/kernel/agent-kernel.js` — the three ports added to the option whitelist
  (that adapter drops anything not listed; its own comment warns about this bug class).
- `src/runner/kernel/contract.js` — documented in the `KernelInput` typedef.
- `test/runner/headless-ports.test.js` — new, 7 tests.

Gotcha discovered while writing the tests: `write_file` is in the `edits` capability
group, which is **off** unless requested. A test that drives a write without
`capabilities: ['edits']` never gets an approval prompt at all — and a naive "denied write
leaves no file" assertion passes vacuously. The test now asserts the port was consulted.

Original plan for reference:

### Slice A (original plan) — Make the runner drivable without a terminal

**Goal:** a non-terminal caller can run one turn and answer an approval. No protocol code yet.
**Where:** `/Users/alanman/Developer/claude-local-bridge-playground`, files
`src/runner/run.js` and `test/runner/`.

Four changes, all small and local:

1. **Event callback.** `makeOutput(outputFormat)` at `run.js:132-149` buffers events and
   writes them to standard output. Add an `options.onEvent` callback invoked inside `emit`
   (and `finish`). Roughly four lines. Critically, scrubbing already runs at `run.js:136`
   _before_ events enter the buffer, so a subscriber inherits redaction for free.
2. **Injectable approval port.** `run.js:11` hard-requires `./confirmation`, and passes it
   at `run.js:843`. Change to `options.confirm || confirm`. The tool pipeline already
   validates and accepts an injected port (`tool-pipeline.js:185-190`) — it was designed
   for this.
3. **The other two terminal-welded prompts:** the tool-failure-recovery prompt
   (called at `run.js:1706`) and `src/runner/user-question.js`'s `askUserQuestion`.
   Both need the same treatment.
4. **Tests** in `test/runner/` proving a headless caller drives a turn end to end and can
   answer an approval with "allow" and with "deny".

**Why this must be first:** `src/runner/confirmation.js` opens `/dev/tty` and **fails
closed** when no terminal exists (`confirmation.js:155-160`). Under any hosted process,
every write and shell approval silently becomes a deny and the run looks mysteriously
inert with no error message. This is the single highest-value trap to eliminate early.

**Verification:** `npm test` (or the targeted
`node --require ./test/setup.js --test test/runner/<file>.test.js`), then `npm run lint`
and `npm run format:check`. Do not run repo-wide checks beyond these.

**Acceptance:** a test spawns no terminal, calls `runKernel`/`run` with `onEvent` and a
fake confirm port, sees the expected event sequence, and gets both an allowed and a denied
tool outcome.

---

### Slice B — The ACP front end, against the real runner but no T3

**Goal:** `bin/local-bridge-acp.js` speaks ACP over stdio and drives the real runner.
**Where:** new files `bin/local-bridge-acp.js`, `src/runner/acp/**`, `test/runner/acp-*.test.js`.
This fits inside the documented runner boundary in `AGENTS.md`; `bin/` already holds four
sibling entry points, so an extra one is idiomatic.

- **No new dependency.** The repo has zero runtime dependencies and should keep it that
  way. Crib the JSON-RPC bookkeeping from `src/runner/lsp/jsonrpc.js` (already used by the
  language-server client); swap its `Content-Length` framing for ACP's newline framing.
- **Methods to implement** (agent side): `initialize`, `authenticate` (accept and move on),
  `session/new`, `session/load`, `session/prompt`, `session/cancel`,
  `session/set_config_option`. Client calls to make: `session/update` and
  `session/request_permission`.
- **Event translation.** The runner's event taxonomy is already frozen in
  `src/runner/kernel/contract.js` (`KERNEL_EVENT_TYPES`, `STOP_REASONS`). Map
  `assistant` → `agent_message_chunk`, `tool_use` → `tool_call`, `tool_result` →
  `tool_call_update`, `approval_required` → `session/request_permission`, `result`/`error`
  → the prompt response's stop reason. Tool **kinds** come free from each tool module's
  declared category (`tool-catalog.js`): read-only → `read`/`search`, write → `edit`,
  shell → `execute`.
- **Approval translation.** ACP permission outcome → the injected confirm port from Slice A.
- **Config options → runner flags.** ACP config options are only ever _select_ or _boolean_
  shaped, so numbers must be presets. Suggested first set: effort, token budget, trace
  level, and one boolean per tool-permission group.
- **Session model.** `run()` is one-shot per prompt, not a long-lived session object. Use
  `session/new` → allocate a session id; `session/prompt` → one `run()` with
  `resume: true`. Works today; costs a bootstrap per turn.
- **Redaction.** Emit ACP messages from inside the existing output sink so scrubbing is
  inherited. A brand-new writer module will trip the repo's own architecture guards
  (`test/runner/false-green-redaction-parity.test.js:203`, `KNOWN_STREAM_SINKS`) — that is
  those tests working correctly; budget for it, and prefer not to need it.
- **One process per session.** `run()` installs global signal handlers and sets
  `process.exitCode`, so two concurrent runs in one process are unsafe. T3 spawns one agent
  process per session anyway, so this costs nothing — just don't build a multiplexer.

**Acceptance:** a test client (or Codex's terminal harness in the POC worktree) completes a
full turn against the real runner over ACP, including an approval round trip and a denial.

---

### Slice C — Connect the two

**Goal:** first real turn visible in the T3 interface.

Point the shim in `/Users/alanman/Developer/t3code-bridge-ui/apps/server/scripts/bridge-runner-agent-shim.sh`
at `bin/local-bridge-acp.js` instead of the mock agent. Keep the `about` response.

- **This is the first slice that spends real model calls.** Alan has said the bridge is up
  and he has granted live-call permission for realistic testing — but confirm before the
  first live run, and start with a read-only capability set so the worst outcome is a file
  being read.
- Start a **new thread** in T3; threads are locked to the provider they started with.
- Expect to iterate on config-option naming: T3's Cursor host maps only four slots
  (reasoning, contextWindow, fastMode, thinking) and silently discards anything else.

**Acceptance:** a real bridge-runner turn streams into the T3 interface with a working
approval card.

---

### Slice D — Cancellation and streaming

Two genuine gaps, both understood:

- **Cooperative cancel does not exist.** There is no `AbortSignal` anywhere in
  `src/runner/**`; the only cancel path is a signal handler that finalizes and calls
  `process.exit()` (`run.js:983-1011`). ACP's `session/cancel` should abort the turn and
  keep the session alive. The existing `midTurnCheck` hook (`run.js:1659`) already has the
  right shape — it returns `{ stop, message }` — and is the natural place for a checked
  abort token. A `finalizeRun` variant that does not exit the process is also needed.
- **Streaming and structured events are mutually exclusive today.** The guard is
  `stream && outputFormat === 'text'` (`run.js:1412` and `run.js:1441`). ACP needs live
  text _and_ structured tool events in the same session. `postStream` already accepts a
  per-frame callback in its signature (`model-client.js:167`) — `run.js:1442` passes
  `null`. Relax the guard, pass a real callback, and gate the direct standard-output write
  separately. Use the _streaming_ scrubber (`safety.makeStreamingScrubber()`), not the
  buffered one — a secret can split across chunk boundaries.

Also consider a first-class T3 driver at this point (own name and icon, unlimited
dropdowns instead of the four-slot Cursor limit): new files under
`apps/server/src/provider/{Drivers,Layers,acp}/` modelled on the Grok quartet, one line in
`apps/server/src/provider/builtInDrivers.ts`, and one key in
`packages/contracts/src/settings.ts` for the instance to auto-appear. Only that last one is
an upstream-tracked file with merge cost.

---

## 4. Verified facts worth not re-deriving

- The runner's permission model **cannot be bypassed by a lying client.** The deny matrix
  and path confinement are enforced in `permissions.check`, again in `executeForce` after
  approval (`tool-registry.js:297-303`), and again inside each file tool. An external
  "allow" can only collapse an _ask_; hard denies survive.
- ACP config options are a two-member union — **select or boolean only** — in both the
  protocol schema and T3's contracts (`packages/contracts/src/model.ts`). No numeric input,
  slider, free text, or multi-select exists in the composer. Presets are the only shape.
- T3's composer control renderer is **generic** — it draws every descriptor the server
  sends. The four-slot limit is in the Cursor translator, not the interface.
- T3's provider **settings screen** does support free text, multi-line text, password
  fields, and switches — so free-form values belong there, not in the composer.
- Only **Cursor and Grok** speak ACP in T3. Codex uses a different protocol; Kimi does not
  exist in the codebase. "ACP Registry" in the Settings dialog is a non-functional
  coming-soon stub.
- Node versions differ per repo: the playground is **Node 22, CommonJS, zero runtime
  dependencies, `node:test`**; the T3 fork needs **Node 24** (`/usr/local/bin/node` is
  24.14.0) and its `vp` tool lives at `<worktree>/node_modules/.bin/vp`.

---

## 5. Corrections to Codex's earlier report (already communicated to Alan)

Its architectural conclusion was sound and its proof of concept genuinely worked, but:
Codex-the-provider does not use ACP; Kimi does not exist; provider registration is a
hard-coded array rather than configuration; `session/close` is marked unstable and unused by
T3 production code (scope-based teardown is the real pattern); and the POC did touch one
production file (`packages/effect-acp/tsconfig.json`).

---

## 6. Suggested skills

- **`tdd`** — Slice A is a natural red-green-refactor: write the headless-approval test
  first, watch it fail for the right reason (silent deny), then add the injection points.
- **`find-docs`** — for anything about the Agent Client Protocol specification or Effect-TS
  before writing T3-side code. Do not rely on training data for protocol details.
- **`diagnose`** — if a run goes mysteriously inert, the terminal-approval fail-closed
  behaviour is the first hypothesis to test.
- **`test-t3-app`** — the fork's own skill for an integrated pass in a real client, for
  Slice C. Ask permission before spinning up browsers (the fork's `AGENTS.md` requires it).
- **`handoff`** — at the end of the next session.

---

## 7. Open questions for Alan

1. Which runner controls should be promoted into the composer first? Effort, token budget,
   trace level, and per-tool-group toggles are the candidates; the long tail of flags is
   better left as per-instance defaults.
2. Should the multiple-instance trick become the tool-permission story — e.g. separate
   "Bridge Runner (Explore)" and "Bridge Runner (Implement)" entries instead of toggles?
3. When to spend live model calls (Slice C) and with which capability ceiling.

## 8. Standing constraints

- No commits or pushes unless Alan asks.
- Never kill processes by pattern match; his live T3 app (port 3773) and other agents are
  running concurrently. On this Mac use `lsof -iTCP -sTCP:LISTEN` to find a port's owner.
- T3 work happens in a worktree, never the main checkout, so state stays isolated.
- His `starlark-host/experiment.config.json` change is his own; leave it uncommitted.
