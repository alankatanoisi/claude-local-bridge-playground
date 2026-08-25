# Handoff — ACP Slice D: cooperative cancel + live streaming (2026-08-24)

**Written:** 2026-08-24 by Claude (Fable), same day as the Slice C live acceptance.
**Prior state:** `HANDOFF-acp-slices-b-c-2026-08-22.md` (still authoritative for Slices A–C).
**Status: Slice D built, unit-tested (1042 pass / 0 fail / 1 todo), and live-verified
on Sonnet 5 and Opus 5 — with one verification step pending a bridge reload (§4).**

## 1. What landed (commits `d3b09b1`, `1dc17de`, `cbdb59e`)

- **Cooperative cancel** — `run()` option `shouldCancel()` polled at three safe
  boundaries (top of step; after a model response BEFORE it enters the session
  checkpoint; between the read batch and any write). Cancelled turns finalize with
  stopReason `cancelled`, never `process.exit`, and the checkpoint stays resumable.
- **In-flight stream abort** — `model-client.postStream` polls the same token and
  destroys the request the moment it flips (`BridgeCancelledError`, mapped to
  CANCELLED, never the retry path). Cancel-to-response latency fell from 5.1 s
  (Sonnet) / 20.8 s (Opus) to ~200 ms on both, and the upstream generation stops.
- **Live caller streaming** — `run()` option `onStreamText(text)` (with
  `stream: true`) delivers scrubbed live text deltas through a per-request
  split-invariant streaming scrubber, independent of outputFormat. Terminal stdout
  streaming is unchanged. Note: the scrubber is line-aligned, so short single-line
  answers arrive as one flush; long multi-line output streams line by line.
- **ACP agent** — always streams; buffered assistant text is suppressed once deltas
  arrive (kept as fallback); `session/cancel` now aborts the turn for real.
- **Bridge hardening (`src/proxy.js` / `src/server.js` — boundary exception used)** —
  see §3. A client disconnect mid-SSE no longer crashes the bridge; it now also
  aborts the upstream request.

## 2. Live matrix results (real bridge, real models, ~$2 of the $20 budget)

Sonnet 5: streaming ✓, mid-turn cancel ✓, session-survives-cancel ✓, approval
allow/deny/cancel-at-card ✓✓✓, tiny-budget → ACP `max_tokens` ✓ (13 live chunks).
Opus 5: tool loop over the streaming path with always-on thinking ✓ (signature
deltas preserved across the loop — the risky edge), approval write ✓, mid-turn
cancel ✓, session survives ✓. No model-specific protocol breakage found.

## 3. The bridge outage during testing — root cause and fix

The first live cancel tests killed the bridge (extension host restart, new PID).
Cause: `src/proxy.js` attached **no `'error'` handler** on the client-facing
response; a client socket destroyed mid-SSE made the next `res.write()` raise an
unhandled stream error. `src/server.js`'s catch could then write to the same dead
socket. This predates Slice D (any mid-stream disconnect could trigger it); Slice D
made it routine. Fixed in `cbdb59e` with a regression test in
`test/anthropic.integration.test.js` ("survives a client that disconnects
mid-stream"). Bridge-internals edit justified by the CLAUDE.md exception (clearly
needed to keep runner transport working); Alan was notified in-session.

## 4. Pending / next

1. **Live-verify the bridge fix**: the running extension still executes pre-fix
   code until Alan reloads it (and confirm WHICH checkout backs the live extension —
   playground vs canonical). Reproducer: `/tmp/slice-d-cancel-latency.js` (rerun it;
   the bridge PID on 11437 must survive).
2. T3-UI eyeball of streaming/cancel (the collaborative browser lost loopback
   access; frame-level verification was done over stdio instead — stronger, but the
   visual check is still worth one session).
3. Residuals: `effort=auto` composer question (B+C handoff §4), first-class T3
   driver (08-11 handoff Slice D notes), `ask_user_question` over ACP.
