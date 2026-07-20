# Agent handoff — P1-11 closed, P1-12 halted (2026-07-20)

> **RETIRED 2026-07-20 (later session):** this handoff is a historical snapshot from the
> 429-interrupted session and its "still open" list is stale. P1-07, P1-12, P1-13, P1-14, and
> P1-15 were closed and P1-06 was contained later on 2026-07-20. Do not use this file to plan
> a session. Use
> [`docs/runner-p2-next-session-handoff-2026-07-20.md`](./runner-p2-next-session-handoff-2026-07-20.md)
> instead; per-finding status lives in the annotation cards of
> [`docs/runner-runtime-concordance-assessment-2026-07-17.html`](./runner-runtime-concordance-assessment-2026-07-17.html).

**Audience:** any coding agent starting a fresh session on this playground.
**Previous handoff:** [`docs/runner-p1-next-session-handoff-2026-07-19.md`](./runner-p1-next-session-handoff-2026-07-19.md) (+ HTML twin)
**Source assessment:** [`docs/runner-runtime-concordance-assessment-2026-07-17.html`](./runner-runtime-concordance-assessment-2026-07-17.html) (status annotation cards at top — P1-11 card added)

## Which clone / branch

| Check | Expected |
| --- | --- |
| Folder | `/Users/alanman/Developer/claude-local-bridge-playground` |
| Branch | `main` |
| Remote `origin` | `https://github.com/alankatanoisi/claude-local-bridge-playground.git` |
| Canonical repo | reference-only — do **not** open PRs there |

```bash
pwd
git rev-parse --show-toplevel
git branch --show-current
git remote -v
git status --short
git pull --ff-only origin main
```

## State snapshot (as of this session)

- **Closed:** all P0-01…12; P1-01, P1-02, P1-03, P1-04, P1-05, P1-08, P1-09, P1-10, **P1-11 (this session)**; WP2 authority ceiling; docs drift gate.
- **Halted mid-session (still open):** **P1-12** — see below before touching it.
- **Still open:** P1-06, P1-07, P1-12, P1-13, P1-14, then P2s, then a day-to-day docs rewrite pass.

## What P1-11 changed (this session)

**Problem (assessment P1-11):** `makeStreamingScrubber` in `src/runner/safety.js` held a fixed
4096-char trailing window. A multi-line private-key block longer than the window could stream out
half-raw, and labeled stable identifiers could be cut at the emit boundary — redaction depended on
where chunk boundaries happened to fall.

**Fix:** rewrote `makeStreamingScrubber` to be **split-invariant** — output depends only on total
content, never on chunking:

1. **Line alignment** — complete lines are scrubbed and emitted as whole units; the trailing
   incomplete line is held until its newline (or `end()`). All single-line patterns (API keys,
   JWTs, labeled stable identifiers, `SECRET=` assignments) always see the whole line.
2. **Bounded PEM fence parser** — an unterminated `-----BEGIN … PRIVATE KEY-----` switches to a
   hold state (cap `STREAM_MAX_PEM_HOLD` = 256KB). A closed block is scrubbed with the buffered
   `scrubSecrets` so streaming output matches buffered sinks byte-for-byte. Oversized blocks are
   redacted **fail-closed** (marker emitted, content dropped until the END fence). An unterminated
   block at `end()` matches buffered behavior (no redaction — same as `scrubSecrets`).
3. **Bounded memory** — a single line longer than `STREAM_MAX_LINE_HOLD` (64KB) flushes in
   deterministic 64KB slabs measured from the line start (chunk-arrival independent).

Exported constant `STREAM_SCRUB_WINDOW` was removed; `STREAM_MAX_LINE_HOLD` and
`STREAM_MAX_PEM_HOLD` are exported instead. No callers changed — `push()`/`end()` interface is
identical (consumers: `model-client.js` live SSE stdout, `tool-registry.js` `runAndScrub`,
`redaction-boundary.js`).

**Acceptance criterion met (pending test run):** new property test
`test/runner/p1-11-streaming-redaction.test.js` asserts identical redacted output for **every**
split position of each secret fixture (plus stride/fence-adjacent sampling for the large PEM
fixture), buffered-equivalence with `scrubSecrets`, fail-closed oversized blocks, and bounded
memory on a 1MB single line.

**Known accepted edges (documented in code comments):**

- A secret spanning a `\n` (e.g. `Bearer\n<token>`) is scrubbed per-line, which can differ from
  buffered scrubbing — but is still split-invariant (deterministic).
- Lines > 64KB flush in slabs, so a secret straddling a slab cut inside one >64KB line could
  evade — deterministic, and far beyond any realistic secret size.

## P1-12 — attempted and HALTED (do not assume any state)

P1-12 (CLI accepts `https://` bridge URLs but `model-client.js` is HTTP-only) was started in this
session: a protocol-aware `transportFor()` (http/https module + keep-alive agent + default port
selection, typed non-retryable `BridgeUrlError`) was partially applied. The operator **denied** the
edit wiring it into `post()` and chose "Stop P1-12". **All model-client.js changes were fully
reverted** — `git status` confirms the file is back to its committed state. P1-12 remains open.

If you pick P1-12 up later, the sketch that was in flight:

- `const https = require('https')` + `keepAliveHttpsAgent` alongside the existing http agent.
- `transportFor(reqUrl)` returns `{ request, agent, defaultPort }` by `reqUrl.protocol`; throws a
  typed `BridgeUrlError` (`retryable = false`) for anything else.
- Use it in **both** `post()` and `postStream()` (replace `http.request` and `port || 80`).
- Acceptance: every accepted scheme completes a mock request (spin up a local https server with a
  self-signed cert in tests, or at minimum assert the https path is selected); unsupported schemes
  fail before the run starts (CLI `normalizeBridgeUrl` already rejects non-http(s)).
- Ask Alan first — the stop may reflect a preference for the containment option (reject
  `https://` explicitly at the CLI) instead of adding TLS support.

## Files changed this session

- `src/runner/safety.js` — new split-invariant `makeStreamingScrubber`; exports
  `STREAM_MAX_LINE_HOLD` / `STREAM_MAX_PEM_HOLD` (removed `STREAM_SCRUB_WINDOW`).
- `test/runner/p1-11-streaming-redaction.test.js` — new property/fixture tests.
- `docs/threat-model.md` — split-invariance paragraph in the secret-redaction section.
- `docs/runner-runtime-concordance-assessment-2026-07-17.html` — P1-11 annotation card.
- `docs/runner-p1-next-session-handoff-2026-07-20.md` — this file.

## Non-obvious traps (carried forward + new)

- Do **not** restore agent/capability profiles.
- Do **not** widen child authority above the parent ceiling (`authority.js`).
- Do **not** put caller tokens on child argv — env only.
- Do **not** treat `--dont-ask` as enabling shell.
- Do **not** advertise `--replay`/`--repair` as working without `BRIDGE_RUNNER_EXPERIMENTAL=1`.
- **New:** keep `PEM_BEGIN_MARKER`/`PEM_END_MARKER` in `safety.js` in sync with the private-key
  entry in `SECRET_PATTERNS` — if you add key types to one, add them to the other.
- **New:** any new multi-line secret pattern needs a streaming strategy (fence parser or hold
  rule); single-line patterns are covered automatically by line alignment.
- For Anthropic facts: official docs first (`docs.anthropic.com`, `code.claude.com/docs`,
  `support.claude.com`).

## Verification before claiming done

Run in Terminal at the repo root:

```bash
node --require ./test/setup.js --test \
  test/runner/p1-11-streaming-redaction.test.js \
  test/runner/streaming-tool-result.test.js \
  test/runner/p0-11-redaction-boundary.test.js
npm test
npm run lint
npm run check:docs
npm run format:check
```

Note: the session that authored this handoff had **no shell access**, so these checks were NOT
executed — run them before trusting the P1-11 acceptance claim, and fix forward if a fixture
assertion needs adjusting (the invariant itself, not the tests, is the contract).

## Recommended next work (one slice per session)

1. **P1-14** — Hook execution trust: docs vs runtime.
2. **P1-07** — Model/effort/thinking catalog lag (official Anthropic sources first).
3. **P1-12** — only after re-confirming direction with Alan (see halt note above).
4. **P1-13** — instruction-delta watching vs minimal/bare context policy.
5. Later: compatibility doctor, built-ins/templates/skills, then a docs rewrite of day-to-day
   surfaces only.

## Fresh-session starter prompt (copy/paste)

```text
You are in /Users/alanman/Developer/claude-local-bridge-playground on main
(origin = claude-local-bridge-playground). Read AGENTS.md + CLAUDE.md, run the
startup preflight, pull --ff-only origin main, then read
docs/runner-p1-next-session-handoff-2026-07-20.md.

All P0s and P1-01..05,08,09,10,11 (+ WP2, docs gate) are closed. P1-12 was
halted by the operator — re-confirm before touching it. Implement the next
open P1 I name. Do not rewrite all docs; do not touch bridge auth internals
unless required for runner transport. End with folder/branch, files, checks,
skipped, risks. Commit/push only if asked.
```

## Handoff fields

- **Folder / branch:** playground `main`
- **This session files:** see "Files changed this session" above
- **Checks:** none executed in-session (no shell); the verification block above is mandatory
- **Skipped:** P1-12 (operator halt, reverted); full docs rewrite; README/quickstart/command-builder
  untouched (no CLI surface changed)
- **Risks:** P1-11 tests authored but not yet executed; per-line vs buffered divergence for
  newline-spanning `Bearer` tokens (deterministic, documented); oversized-PEM fail-closed path
  drops non-secret text after an unterminated fence past 256KB (intentional fail-closed trade)
