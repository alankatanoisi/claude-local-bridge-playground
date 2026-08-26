# Handoff — ACP thread status and recommendations (2026-08-25)

**Written:** 2026-08-25, after a status pass (no code changes).
**Audience:** the next coding agent on the ACP (Agent Client Protocol) thread.
**Does not supersede** the slice write-ups. Those remain the implementation record:

- A–C design + T3 Cursor-host contract: `HANDOFF-acp-slices-b-c-2026-08-22.md`
- Slice D cancel/streaming + bridge disconnect fix: `HANDOFF-acp-slice-d-2026-08-24.md`
- Historical plan (stale START HERE): `HANDOFF-bridge-runner-acp-2026-08-11.md`

This file is the current **shape + what to do next**. The 08-22 handoff §1 table still
says Slice D is unstarted and Slice C’s T3 side is open — that table is stale; the
in-document completion notes and the Slice D handoff are the truth.

---

## START HERE

1. Read `docs/working-with-alan.md`, then `docs/agent-user-autonomy-boundary-2026-08-11.md`.
2. Preflight from `AGENTS.md`. Expected: playground clone, branch `main`, origin
   `alankatanoisi/claude-local-bridge-playground`.
3. Do **not** treat this as a build-from-zero thread. Slices A–D are committed at
   `1fcfbeb`. Uncommitted `.cursor/hooks/state/continual-learning.json` is Cursor
   local state — leave it alone.
4. Alan’s live T3 app is port **3773** — never touch it. Demo ports (when used) are
   **15470** (server) / **7430** (web). Never kill processes by pattern match.

---

## 1. Current shape

ACP here is a **translator process**, not a second agent. T3 Code (Alan’s coding-agent
GUI) spawns `bin/local-bridge-acp.js` and speaks newline-delimited JSON-RPC 2.0 over
stdio (standard input/output). The process owns no models, credentials, files, or
permission decisions. It converts ACP ⇄ `run()`.

```text
T3 Code
  └─ node bin/local-bridge-acp.js     stdout = protocol wire (guarded)
        ├─ src/runner/acp/ndjson.js
        ├─ src/runner/acp/connection.js
        └─ src/runner/acp/agent.js    translator; one prompt at a time
              └─ run()
                    ├─ onEvent / confirm / askUserQuestion   Slice A
                    ├─ shouldCancel()                        Slice D
                    └─ onStreamText()                        Slice D
                          └─ local bridge :11437
```

| Slice | What | Status |
| ----- | ---- | ------ |
| **A** | Headless caller ports | Done (`b898ee9`) |
| **B** | ACP front end over the real runner | Done, unit-tested |
| **C** | T3 Cursor-host contract + live acceptance | Playground done; **live turn + working approval card passed 2026-08-24** |
| **D** | Cooperative cancel + live streaming | **Built, unit-tested, live-verified on Sonnet 5 and Opus 5** |

Working facts the next agent should not re-derive:

- Redaction is inherited from `onEvent` (P0-11). ACP never sees raw model/tool bytes.
- Shell is only `--allow-shell` on the **instance command line**. Never a composer toggle.
- Workspace trust is not bypassed: headless + untrusted cwd fails closed; `--trust-workspace` records consent per instance.
- Sessions: `session/new` → fresh id; later `session/prompt` calls `run({ resume })`; checkpoints under `~/.bridge-runner/sessions/`. `session/load` reopens a checkpoint; **no scrollback replay**.
- T3 Cursor host builds the model dropdown **only** from `cursor/list_available_models`. Composer slots that survive the mapper: `effort` (thought_level) and `context` (token budget). Capability toggles do **not** render there.
- Modes `ask` / `plan` / `code` are real runner flags (approvals / `plan: true` / `acceptEdits: true`).
- Permission card optionIds T3 sends are hard-coded: `allow-once` / `allow-always` / `reject-once`.
- Live matrix (Slice D, ~$2 of a $20 budget): streaming, mid-turn cancel ~200 ms after aborting the in-flight stream, session survives cancel, allow/deny/cancel-at-card, tiny-budget → ACP `max_tokens`. Opus 5 tool loop with thinking signatures preserved.

**The one operational leftover on the built slices:** `cbdb59e` stops the bridge from crashing when a client disconnects mid-SSE (Server-Sent Events). That commit is in git. The **running VS Code extension still executes pre-fix code until Alan reloads it**. Confirm which checkout backs the live extension (playground vs canonical). Reproducer: `/tmp/slice-d-cancel-latency.js` — the bridge PID on 11437 must survive.

---

## 2. Recommendations (do in this order)

### R1 — Reload the live bridge, then re-prove cancel (do first)

No design. Ask Alan to reload the Claude Local Bridge extension, confirm playground vs
canonical, rerun the cancel-latency script. Success: PID on 11437 lives; cancel-to-response
stays ~200 ms.

This is the only unverified claim left from Slice D. Everything below can wait on it;
nothing else should expand the thread until this is marked done in the Slice D handoff §4.

### R2 — One T3-UI eyeball of streaming + cancel

Protocol verification was over stdio (stronger). The visual pass is still worth one
session: tokens appearing in the thread, Stop aborting the turn, thread still usable
afterward.

Do this on the **same** live session as R1 if Alan is already in T3. Do not rebuild a
driver for it.

### R3 — Lock the `effort=auto` composer decision (observe, then choose)

T3’s Reasoning dropdown silently drops values that do not normalize to
low/medium/high/max/xhigh. `auto` is the runner’s model-aware default and will not appear
as a selectable slot; T3 may still hold it as `currentValue` until the user picks a level.

**Recommend after R2, not before:** watch once whether T3 force-selects a level on the
next composer change.

- **Keep `auto` as default, omit it from the dropdown (preferred if T3 leaves it alone).**
  Pros: runner stays model-aware; no fake “medium” default. Cons: a later T3 selection
  silently overrides `auto` and the UI never shows that Auto was the prior state.
- **Map a concrete default (`medium`) into the dropdown.** Pros: UI and runner always
  agree. Cons: throws away the catalog’s auto policy for ACP sessions.

Do not “fix” this by inventing a fifth T3 thought_level. The mapper will drop it.

### R4 — Next *code* slice, if Alan wants keep-building: `ask_user_question` over ACP

Slice A already injects `askUserQuestion`. The ACP agent currently fails that path
closed. Wiring it is playground-only, small, and finishes the headless-caller surface
on the T3 wire.

Pros: stays in this repo; no T3 fork; real gap. Cons: T3 elicitation UX may be thin;
confirm against the Cursor-host source before promising a card.

### R5 — Do **not** build a first-class T3 driver unless Alan wants composer-visible capabilities

A custom driver (own name/icon, unlimited knobs) was sketched in the 08-11 handoff Slice D
notes. The Cursor-host path is already live-verified.

- **Stay on Cursor mapper (default).** Pros: zero T3-fork work; known four-slot contract;
  permission ceiling stays on spawn flags (the intended instances-as-scopes answer).
  Cons: capability groups never appear in the composer; we keep borrowing Cursor’s identity.
- **First-class driver.** Pros: unlimited dropdowns, capability toggles in UI, own branding.
  Cons: work lives in the T3 fork (`Drivers` / `Layers` / `builtInDrivers.ts` plus a
  settings key in tracked `packages/contracts`); merge cost; easy to over-build relative
  to a lab that already works.

Recommend the driver **only** if Alan’s next goal is “I want to flip `edits` in the GUI
instead of registering another instance.” Otherwise R4 is the better keep-building slice.

### R6 — Defer

- **`session/load` scrollback replay.** Load already restores the checkpoint; replay is
  cosmetics.
- **Six-instance real fleet.** The mock fleet already proved instances-as-permission-scopes.
  A real fleet is a T3 `settings.json` exercise (different spawn flags per instance), not a
  runner gap. Worth a small example file only if Alan wants it preserved outside userdata.

---

## 3. Standing constraints (unchanged)

- No commits or pushes unless Alan asks.
- Do not modify `src/credentials.js` / `src/proxy.js` / `src/server.js` / interceptors
  unless required to keep transport working (the Slice D disconnect fix was that exception).
- T3 edits happen in worktrees, never the main fork checkout.
- Codex playground (`~/Developer/codex-local-bridge-playground`) stays paused unless Alan
  explicitly asks to cross-apply.
- Do not quote `~/.bridge-runner` ledger payload text; aggregates only.

---

## 4. Suggested prompt for the next session

If Alan wants the operational leftover closed:

> Reload the live Claude Local Bridge extension (confirm playground vs canonical
> checkout), rerun `/tmp/slice-d-cancel-latency.js`, and mark Slice D handoff §4 item 1
> done if the PID on 11437 survives. Then one T3-UI pass of streaming + cancel.

If Alan wants keep-building after that:

> Wire `ask_user_question` over ACP (R4). Do not start a first-class T3 driver unless I
> say so.
