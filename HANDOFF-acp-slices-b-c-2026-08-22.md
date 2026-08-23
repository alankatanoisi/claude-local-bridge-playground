# Handoff — Bridge Runner ACP thread, Slices B + C (2026-08-22)

**Written:** 2026-08-22, by Claude (Fable), end of the session that committed Slices B+C.
**Supersedes:** `HANDOFF-bridge-runner-acp-2026-08-11.md` (kept unchanged as a historical
record; its START HERE now carries a banner pointing here).
**Audience:** the next coding agent on the ACP (Agent Client Protocol) thread. Alan should
not need to re-explain any of this.

---

## START HERE

1. Read the working agreement first: `docs/working-with-alan.md`, then
   `docs/agent-user-autonomy-boundary-2026-08-11.md`. They change how you talk, not just
   what you do.
2. Run the startup preflight from `AGENTS.md` (`pwd`, branch, remote, `git status --short`).
3. The playground tree should be **clean** after this handoff's commits. If you find
   uncommitted files, another agent may be mid-flight — ask Alan before touching anything.
4. Other agents work here concurrently. Never kill processes by pattern match. Alan's live
   T3 app runs on port **3773** — never touch it. Our demo dev server (when running) uses
   **15470** (server) / **7430** (web).

---

## 1. Where the A/B/C/D build plan stands

| Slice                                                                   | Status                                                             |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **A** — headless caller ports (`onEvent`, `confirm`, `askUserQuestion`) | **Done and committed** (`b898ee9`, 2026-08-11).                    |
| **B** — ACP front end over the real runner                              | **Done, tested, committed this session.**                          |
| **C** — connect to T3                                                   | **Playground side done and committed. T3 side NOT done** — see §3. |
| **D** — cooperative cancel + live streaming                             | Not started. Notes in the 08-11 handoff §3 still apply.            |

Baseline: full suite green at commit time (see the commit messages for exact counts;
1031 tests as of 2026-08-22, up from 1000 pre-Slice-B). `npm run lint`,
`npm run format:check`, `npm run check:docs` all pass.

## 2. What Slice B built (all in this repo, zero new dependencies)

```text
bin/local-bridge-acp.js            entry point: stdout guard + per-instance default flags
src/runner/acp/ndjson.js           newline framing (sibling of src/runner/lsp/jsonrpc.js)
src/runner/acp/connection.js       JSON-RPC 2.0 bidirectional bookkeeping
src/runner/acp/agent.js            the translator: ACP ⇄ run()
test/runner/acp-transport.test.js  framing + connection units
test/runner/acp-agent.test.js      full turns against the real runner (stubbed model)
```

Design decisions worth not re-deriving:

- **stdout guard.** In an ACP process stdout IS the protocol channel, and `run()` prints
  its final answer there in text mode (`run.js` `finish`). The entry point captures the
  real stdout writer for frames and redirects every other stdout write to stderr. This is
  why `run.js` needed no changes.
- **Redaction is inherited.** Everything the agent emits derives from the already-scrubbed
  `onEvent` stream (P0-11 boundary). The FG-C10/C11 sink guards do not fire for stdout
  writers; a test pins that no raw secret crosses the wire.
- **Approval correlation.** `confirm.ask()` only receives a string; the tool identity
  comes from pairing it with the most recent `approval_required` event, which is sound
  because the tool pipeline's write loop is serial.
- **Sessions.** `session/new` → fresh `sessionId`; each `session/prompt` is one `run()`
  with `resume: turnCount > 0`; checkpoints live in `~/.bridge-runner/sessions/` (or
  `--session-dir`). `session/load` accepts any id whose checkpoint exists (no scrollback
  replay yet).
- **Cancellation (pre-Slice-D).** `session/cancel` denies all remaining approvals of the
  turn and reports `cancelled`; it cannot yet abort the model call mid-flight.
- **Errors.** Runner error-class stop reasons (`bridge_error`, `workspace_not_trusted`,
  `cwd_invalid`, `resume_failed`, `message_contract_error`) become JSON-RPC errors on
  `session/prompt`; everything else maps onto ACP's five stop reasons
  (`acpStopReasonFor` in agent.js).
- **Shell stays singular.** Capability groups are per-session boolean config options,
  EXCEPT shell, which is only the `--allow-shell` flag on the agent command line.
- **Workspace trust is not bypassed.** Headless + untrusted cwd fails closed with a clear
  error. `--trust-workspace` on the command line records consent per instance.

## 3. What Slice C did — and the piece that remains

### Done (playground side, committed)

The T3 Cursor-driver contract was **file-verified** against the fork (an Explore agent
read the driver source; findings below) and the agent implements it:

- `cursor/list_available_models` — T3 builds the model dropdown ONLY from this extension
  method (not from ACP `models`). Each model carries its composer knobs.
- `session/set_model` — implemented for spec completeness, but note T3's Cursor host
  actually changes model via `session/set_config_option` with configId `model`.
- Session **modes** `ask` / `plan` / `code`, each backed by a real runner flag:
  default approvals / `plan: true` / `acceptEdits: true`. Mode changes arrive as
  configId `mode` (and via the `session/mode/set` extension; both handled).
- Composer knob naming that survives T3's mapper: `effort` (category `thought_level`)
  and `context` (category `model_config`, name "Token Budget").
- **Permission options** `allow-once` / `allow-always` / `reject-once`.
- The binary tolerates the `acp` positional token T3 appends to the launch command.

### NOT done — the remaining Slice C acceptance

**No real model turn has gone through the T3 interface yet.** Specifically:

1. The shim at
   `/Users/alanman/Developer/t3code-bridge-ui/apps/server/scripts/bridge-runner-agent-shim.sh`
   still execs the MOCK agent. It must be repointed to
   `node /Users/alanman/Developer/claude-local-bridge-playground/bin/local-bridge-acp.js`
   (keep its `about` answer; strip or rely on the tolerated `acp` positional; add
   `--trust-workspace`, and start with NO `--capabilities` flag so the first live run is
   read-only).
2. Start a NEW thread in T3 (threads are locked to the provider they started with).
3. Acceptance: a real turn streams into T3; then enable `--capabilities edits` and verify
   a working approval card end to end. This spends real model calls — confirm with Alan
   before the first live run.

### T3 driver contract — field-verified facts (do not re-derive)

From the fork source (paths relative to `/Users/alanman/Developer/t3code-bridge-ui`,
`apps/server/src/provider/`):

- **Launch:** `<binaryPath> about --format json` probe (needs `cliVersion` parseable as
  `YYYY.MM.DD…` ≥ 2026.04.08 and a non-null `userEmail`), then `<binaryPath> acp` for the
  session. `authenticate` arrives with methodId `cursor_login` — must not error.
- **Composer ceiling under the Cursor driver:** model dropdown + mode toggle + exactly
  four name-matched knob slots (`Layers/CursorProvider.ts` `buildCursorCapabilitiesFromConfigOptions`):
  - _reasoning_: select whose id/name says effort/reasoning; values must normalize to
    low/medium/high/max/xhigh — non-matching values (e.g. `auto`) are silently dropped
    from the dropdown (currentValue may still be one of them).
  - _contextWindow_: select with category exactly `model_config` and id `context`.
  - _fastMode_ / _thinking_: boolean-like, category `model_config`, name-matched.
  - Everything else is silently discarded — capability toggles do NOT render under this
    driver; per-instance command-line flags are the tool-permission story there.
- **Permission cards:** T3's reply optionIds are HARD-CODED (`allow-always`,
  `allow-once`, `reject-once`) — it does not echo the agent's ids. Full-access runtime
  mode auto-picks `allow_always` client-side without showing a card.
- **Config caching:** T3 validates every `set_config_option` value against its cached
  copy of the agent's configOptions and SKIPS the RPC when `currentValue` already equals
  the request — so every config response must return accurate `currentValue`s.
- **cwd:** thread `worktreePath` if set, else the project `workspaceRoot`; resolved and
  non-empty, passed to both the child process and `session/new`.
- Composer control changes reach the agent just before the NEXT prompt, not instantly.

### The fleet demo (2026-08-22, mock-only, kept)

Six provider instances registered in the gitignored
`/Users/alanman/Developer/t3code-bridge-ui/.t3/userdata/settings.json`, all pointing at
the mock shim, differing in displayName (with "MOCK + date" markers) and accentColor:
Runner / Explore / Build / Orchestrator / Shell Lab / Rubber Duck. This demonstrated the
**instances-as-permission-scopes** answer to the 08-11 handoff's open question 2: in the
real version each instance launches `bin/local-bridge-acp.js` with different flags, so
the authority ceiling is fixed at spawn, before any model output exists. Capability
differences in the demo are cosmetic (all six run the same mock).

## 4. Suggested next steps, in order

1. Finish Slice C acceptance (§3): repoint the shim, read-only live turn, then the
   approval-card turn. Confirm with Alan before spending model calls.
2. Decide the `effort=auto` composer question: T3's Reasoning dropdown drops `auto`; if
   T3 force-selects a level, the user's dropdown silently overrides the runner's
   model-aware default. Observe live behavior, then either keep `auto` out of the
   dropdown deliberately or map a default.
3. Slice D per the 08-11 handoff §3 (cooperative cancel via a checked abort token in
   `midTurnCheck`; streaming + structured events together; the streaming scrubber).
4. Real fleet: same six instances, each with its own flags (worth a small settings
   example file if Alan wants it preserved beyond userdata).

## 5. Standing constraints

- No commits or pushes unless Alan asks (the 2026-08-22 commits were explicitly requested).
- Never kill processes by pattern match; port 3773 is Alan's live T3 app.
- T3 work happens in the worktrees, never the main fork checkout.
- The Codex playground (`~/Developer/codex-local-bridge-playground`) is intentionally
  paused pending this thread's shape; do not "clean it up" from here.
