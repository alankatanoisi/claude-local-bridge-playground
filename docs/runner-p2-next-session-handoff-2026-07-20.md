# Agent handoff — P1 package complete, P2 package next (2026-07-20)

**Audience:** any coding agent starting a fresh session on this playground.
**HTML twin:** [`docs/runner-p2-next-session-handoff-2026-07-20.html`](./runner-p2-next-session-handoff-2026-07-20.html)
**Previous handoff:** [`docs/runner-p1-next-session-handoff-2026-07-19.md`](./runner-p1-next-session-handoff-2026-07-19.md)
**Source assessment (per-finding truth):** [`docs/runner-runtime-concordance-assessment-2026-07-17.html`](./runner-runtime-concordance-assessment-2026-07-17.html) — the annotation cards at the top are the status of record.

> Note: `docs/runner-p1-next-session-handoff-2026-07-20.md` is **retired** — it was written by a
> 429-interrupted session and its "still open" list is stale. Do not plan from it.

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

## State snapshot (verified 2026-07-20)

- **P0:** all twelve closed (P0-01…P0-12).
- **P1:** package complete — P1-01…P1-05, P1-07…P1-15 closed; **P1-06 contained** (see residual below).
- **P2:** **P2-01 and P2-02 closed 2026-07-20** (seven-tool safe-core default + `--capabilities` opt-in
  groups; prompt capability prose generated from the same visibility function as the offered tools —
  see the assessment annotation cards and `test/runner/p2-01-02-tool-surface.test.js`).
  **P2-15 closed 2026-07-20** (docs drift gate now derives model/effort/thinking/template/tool
  expectations from the runtime modules — see the assessment card; gate authored via a
  bridge-runner session on `claude-opus-4-8`).
  **Still open: P2-03…P2-14, P2-16.**
- Known pre-existing failure (not P2 work): `test/runner/effort-passthrough.test.js` "injects small
  CLAUDE.md delta on a later turn after an edit" fails at HEAD since before the P1-06 commit — needs an
  owner (instruction-delta feature).

### P1-06 residual (contained, not fully repaired)

Containment landed 2026-07-20 in `src/fingerprint.js`: captured headers are classified
stable-identity vs request-specific, and only the stable group is replayed (live and fallback
paths); `anthropic-beta` is sanitized by prefix (`context-1m-*`, `fallback-credit-*` dropped);
the fallback no longer fabricates session id / retry count / timeout. Tests:
`test/p1-06-fingerprint-containment.test.js`.

Still open for **full repair** (needs live access, not doable offline):

1. Refresh the pinned fallback metadata (currently Claude Code 2.1.203 / stainless 0.94.0,
   captured 2026-07-07) from a fresh sanitized live capture.
2. Run a header-isolated 429/acceptance canary to confirm which headers the gateway actually
   requires, then tighten further if possible.
3. `src/credentials.js` still holds a legacy `CLAUDE_CODE_FINGERPRINT` constant whose header
   fields are dead for the header path (only its system-block fallback values are used). Cleaning
   it is bridge-boundary work — get explicit sign-off before touching that file.

## P2 package — suggested entry order

Status of record is the assessment; this is only a suggested order. One or two findings per
session; annotate the assessment card grid when closing.

1. ~~**P2-01** — default model tool schema larger than small-core direction.~~ **Closed 2026-07-20.**
2. ~~**P2-02** — system prompt advertises capability groups not actually exposed.~~ **Closed 2026-07-20.**
3. ~~**P2-15** — docs checks cover only three bridge defaults, not runner truth.~~ **Closed 2026-07-20.**
4. **P2-16** — small diagnostics and CLI parsing defects (small, standalone).
5. **P2-03** — bootstrap builds context the main loop partially rebuilds or ignores.
6. **P2-14** — context flags / command-builder descriptions vs runtime semantics (pairs naturally with P2-01…03 CLI changes; update `docs/command-builder.html` in the same slice).
7. **P2-04 / P2-05 / P2-06** — explore/plan/implement/verify/test/bench template defaults and consent expectations.
8. **P2-07 / P2-08 / P2-09** — replay/extractor inertness, agent-metadata imports, prompt-template runtime constraints.
9. **P2-10 / P2-11 / P2-12 / P2-13** — skills loader misses, stale `.cursor` assets, ignored `.bridge-runner` primitives, extension-point inventory/lifecycle contract.

## Non-obvious traps (carried forward)

- Do **not** restore agent/capability profiles (`--agent`, `--profile`, list flags).
- Do **not** widen child authority above the parent ceiling (`authority.js`).
- Do **not** put caller tokens on child argv — env only.
- Do **not** treat `--dont-ask` as enabling shell.
- Do **not** advertise `--replay`/`--repair` as working without `BRIDGE_RUNNER_EXPERIMENTAL=1`.
- Do **not** touch `src/credentials.js`, `src/proxy.js`, `src/server.js`, `src/interceptors/**` without explicit need + saying so first.
- Guardrail honesty posture (P0-09 / P1-15): describe trust as a path-consent record and `--no-network` as best-effort; never invent sandbox/isolation features in docs.
- For Anthropic facts: official docs first (`docs.anthropic.com`, `code.claude.com/docs`, `support.claude.com`).
- Prefer HTML for complex plans/handoffs; keep `docs/command-builder.html` the day-to-day UX.

## Verification before handoff

```bash
npm test
npm run lint
npm run check:docs
npm run format:check
```

Runner-only slices: `node --require ./test/setup.js --test test/runner/*.test.js`.
Bridge/fingerprint work: also run `node --require ./test/setup.js --test test/p1-06-fingerprint-containment.test.js test/bridge.test.js`.

## Fresh-session starter prompt (copy/paste)

```text
You are in /Users/alanman/Developer/claude-local-bridge-playground on main
(origin = claude-local-bridge-playground). Read AGENTS.md + CLAUDE.md, run the
startup preflight, pull --ff-only origin main, then read
docs/runner-p2-next-session-handoff-2026-07-20.md (and the HTML twin).

Work the next unclaimed P2 item(s) from the suggested entry order (start with
P2-16 unless told otherwise). Keep slices small: code + focused tests + a dated
annotation card in docs/runner-runtime-concordance-assessment-2026-07-17.html.
Do not rewrite all docs; do not touch bridge auth internals unless required for
runner transport (and say so first). End with folder/branch, files, checks,
skipped, risks.
```

## Handoff fields

- **Folder / branch:** playground `main`
- **Prepared by:** the 2026-07-20 session that verified P1-07/12/14, finished the P1-15 honesty pass, and landed P1-06 containment.
- **Checks:** run the verification block above before claiming done.
- **Skipped:** P2 work itself (deliberately not started); full docs rewrite.
- **Risks:** P1-06 is contained, not fully repaired (see residual); the pinned fallback fingerprint metadata is stale until a live capture refreshes it; beta trimming (`context-1m`, `fallback-credit` dropped) changes long-context/billing-fallback opt-in behavior and should be confirmed by the canary in the residual list.
