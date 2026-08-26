# Handoff — Thermo-nuclear review of ACP Slice D (2026-08-25)

> **CLOSED 2026-08-25 — all five findings fixed in commit `12f0842`** (Fable), in this
> file's recommended order, with the recommended tests (High #2 verified against a real
> local SSE server; High #1 with session persistence on). One documented deviation from
> the letter of the M4 fix: `result.streamed` is set for caller streaming too, so
> `finish()` cannot reprint the full answer onto a hosted process's redirected stdout —
> same intent, one step further. Live re-verified: cancel 225 ms (Sonnet) / 166 ms
> (Opus), bridge PID stable. Findings text below preserved unchanged.

**Written:** 2026-08-25. Review only; no code changed.
**Scope:** already-landed `main` commits `d3b09b1^..HEAD` (`d3b09b1`, `1dc17de`, `cbdb59e`). No feature branch, no PR.
**Prior:** `HANDOFF-acp-slice-d-2026-08-24.md` remains the build/live-verify record. This file is the audit of that work.
**Do not** treat the Slice D claim “cancelled turns leave the checkpoint resumable” as fully true until High #1 is closed.

## Findings (in-scope for the Slice D diff only)

### High

1. **Mid-turn cancel persists unpaired `tool_use`.**
   After the assistant batch is checkpointed (`src/runner/run.js` ~1694), the new `midTurnCheck` cancel (~1771) finalizes **without** pushing `tool_result`s (~1804). Next ACP prompt uses `resume: session.turnCount > 0`. F6 `reconcileForResume` then injects `"Recovered after crash…"` placeholders and **drops real read output**. Resume “works” only as crash-repair.
   The post-model cancel checkpoint (~1690) respects the invariant in the adjacent comment; this seam does not.
   Tests: resume coverage is cancel-during-`post()` only (`cooperative-cancel-stream.test.js`). Mid-turn test uses `noSessionPersistence: true`.

2. **In-flight abort can `session/update` after `session/prompt` already returned `cancelled`.**
   `src/runner/model-client.js` ~381–384: `reject(BridgeCancelledError)` then `req.destroy()`, no abort flag, `cb(event)` still live. Leftover SSE `data` can call `onStreamText` → ACP `session/update` after the prompt handler has returned. A fast next prompt on the same session can interleave leftover chunks.
   Tests stub `postStream` and never exercise destroy-vs-callback ordering.

### Medium

3. **Sticky `process.exitCode = 1`.** `finalizeRun` (~1157) sets 1 on any non-success and never clears it. ACP is a long-lived process calling `run()` directly. Tests already reset this in `afterEach`. T3 stdin-close uses `process.exit(0)` (`bin/local-bridge-acp.js` ~146–148), so a clean disconnect still reports 0; any other exit after Stop reports failure.

4. **ACP `stream: true` also enables terminal stdout streaming.** `streamStdout = stream && outputFormat === 'text'` is independent of `onStreamText`. ACP does not set `outputFormat` (defaults `'text'`). Live tokens go to `process.stdout.write` (`model-client.js` ~281–284, ~340–343). Protocol survives only because `bin/local-bridge-acp.js` remaps stdout → stderr; the full (scrubbed) answer still dumps to T3 diagnostics every turn. Embeds without that remap corrupt JSON-RPC.

5. **Transient bridge retry re-streams text the client already saw.** Live deltas emit as they arrive; retryable `ECONNRESET`/5xx still `continue`s the step. `streamedThisTurn` only suppresses the buffered copy, not the second live pass. Pre-Slice-D ACP only forwarded completed `assistant` events, so a failed `post()` was silent.

## Not bugs (do not “fix”)

- Post-model cancel-before-persist is correct; that resume test is valid.
- `CANCELLED` is not a degraded-health reason; `assertResumeAllowed` will not block resume.
- Streaming redaction via `makeStreamingScrubber()` on `onStreamText` is split-invariant; the split-inside-secret test is real.
- Bridge client-disconnect hardening (`src/proxy.js` / `src/server.js`) closes the original unhandled `res.write` crash. Residual `res.end()` on a dead socket is covered by the new `'error'` listener.
- `err.isCancelled` correctly skips the bridge-error retry path.
- Aborting the in-flight model call is intended. No feature-flag leak.

## Recommended fix order

Do these as one small runner slice. Stay in `src/runner/**` + tests unless a finding forces otherwise. Do not touch credentials/proxy except High #2 stays in `model-client.js`.

1. **High #2** — In `postStream`, set `aborted = true` before `reject`/`destroy`. Ignore `cb` and `res 'data'` after that. Detach listeners. Add a test that uses the **real** `postStream` (not a stub) and proves no callback after `BridgeCancelledError`.
2. **High #1** — On `turn.aborted` from cancel, persist a complete result batch: real read `tool_result`s plus synthetic cancelled/denied results for skipped writes. Do **not** rely on F6 crash language for Stop. Add a resume test with session persistence **on**, mixed `read_file` + `write_file`, cancel during the read, then a third `run({ resume: true })` that (a) passes `assertValidAnthropicMessages` without synthetic crash text for the completed read, and (b) still has no write side effect.
3. **Medium #3** — Do not set `process.exitCode` when a hosted caller is in play (`onStreamText` / ACP / kernel). Or save/restore around each ACP turn and set `0` on success. Drop the `afterEach` `process.exitCode = 0` workaround once this is real.
4. **Medium #4** — `streamStdout = stream && outputFormat === 'text' && !streamCaller`. Keep `streamed: streamStdout` so `finish()` does not `console.log` the full answer onto the (redirected) stdout path. Optional: ACP may also pass `outputFormat: 'json'` as belt-and-suspenders; the boolean gate is the real fix.
5. **Medium #5** — If any `onStreamText` delta was delivered this step, do not take the transient-bridge retry `continue`. Fail that step (or retry without live replay). Test: first `postStream` emits one delta then throws retryable; assert the caller received the prefix once.

## Pointers for the implementing agent

- Preflight: playground `main`, `origin` = `alankatanoisi/claude-local-bridge-playground`, pull `--ff-only` if clean.
- Runner tests: `node --require ./test/setup.js --test test/runner/cooperative-cancel-stream.test.js test/runner/acp-agent.test.js`
- Then `npm test` / `npm run lint` before handoff.
- Do not restore `--agent` / `--profile`. Do not edit `src/credentials.js`.
- Bridge reload (Slice D handoff §4) is still pending Alan; unrelated to these runner fixes.
- Commit/push only if Alan asks.

## Suggested commit shape (if asked)

One commit is enough: `fix(runner): close Slice D cancel/stream races (resume batch, abort flag, hosted exitCode, stdout gate, no retry-after-delta)`.
