# Handoff — ask_user_question live over ACP + effort=auto in T3 (2026-08-31)

> **Thermo-nuclear review 2026-08-31 — CLOSED same day:**
> `HANDOFF-acp-ask-user-question-thermo-nuclear-2026-08-31.md`. Live-verify
> claims in this file are not contradicted. All four findings (catch-all
> "guess" text, cancel hang, leftover judgment prompt, liberal answer parsing)
> fixed in the review's recommended order with its recommended tests; see the
> CLOSED banner there for the fix summary. "Any transport error → safe
> fallback" in §-below is superseded: only `-32601` gets the guess fallback
> now; cancel/disconnect/other errors fail closed.

**Written:** 2026-08-31 by Claude (Fable). Closes the 08-25 ACP handoff's R4 (question
tool) and R3 (`effort=auto` composer decision — Alan chose "add Auto to T3's dropdown").
**Prior thread entry:** `HANDOFF-acp-status-and-recommendations-2026-08-25.md` (bannered;
this file is the current entry). Slice A–D records unchanged.

## 1. The finding: why ask_user_question never fired

Alan reported the tool has existed for the playground's whole life but no model ever
called it, in any run mode, even when prompts invited questions. Diagnosis (verified in
code, then live):

- The tool was **always offered** — it is in the `core` capability group, never hidden,
  and passed every visibility gate. Mechanically nothing was broken.
- The **model-facing description talked models out of it**: "Use it only when unresolved
  ambiguity would materially change the result and no safe assumption is available.
  Requires an interactive terminal; unavailable in child workers, plan mode, or
  --dont-ask runs." A model cannot see which run type it is in, so the safe inference
  from that text is "probably unavailable — do not call." Models complied, universally.
- Over ACP the agent additionally **stubbed the path closed** ("not available over ACP
  yet") because no clean mapping existed at Slice A time.

The "critical prompts" Alan did see (merge confirmations etc.) are the _permission_
gate (`confirm.ask`), a different mechanism that models cannot decline to trigger.

## 2. What changed

### Playground (this repo)

- `src/runner/tools/ask-user-question.js` — description rewritten to affirmative
  guidance ("The operator expects to be consulted: prefer asking over guessing…"),
  runtime-availability moved to an honest trailing clause ("If no operator channel
  exists the call fails with an explanation - then proceed on your best safe
  assumption"). The runtime fail-closed guards themselves are unchanged.
- `src/runner/context-builder.js` — matching one-line prompt description.
- `src/runner/acp/agent.js` — the stub is now a real bridge to **T3's native question
  card**: the Cursor CLI extension request `cursor/ask_question` (agent → client),
  `{ toolCallId, title?, questions: [{ id, prompt, options: [{id, label}],
allowMultiple? }] }` → `{ answers: { [questionId]: selection } }`. Details:
  - `toolCallId` is the real `tool_use` id (`ctx.toolUseId` from tool-registry).
  - Option descriptions are folded into labels (T3's extractor drops descriptions).
  - `parseAskQuestionAnswer` accepts option ids, labels, strings, arrays, or
    id/prompt-keyed records (hosts differ) and maps everything back to labels.
  - Dismissed/cancelled card (empty answers) → fail-closed "user dismissed" result.
  - Client without the method (JSON-RPC -32601 or transport error) → the old safe
    fallback text. A non-T3 ACP client is never hung or crashed.
- Tests: 4 new cases in `test/runner/acp-agent.test.js` (round-trip with id→label
  mapping + wire-shape assertions; dismissed card; method-not-found fallback;
  prompt-text-keyed label answers). Test client gained an `onAskQuestion` handler.

### T3 fork (`~/Developer/t3code-bridge-ui`, branch `claude/bridge-runner-mock-provider`)

- Commit `100b3890a`: `normalizeCursorReasoningValue` in
  `apps/server/src/provider/Layers/CursorProvider.ts` accepts `"auto"` (it silently
  dropped anything outside low/medium/high/max/xhigh — the R3 blocker). New test in
  `CursorProvider.test.ts` with the Bridge Runner option shape (Auto present,
  `isDefault` from `currentValue: "auto"`). Suite 24/24.
- The agent side already advertised Auto (`describeModelKnobs`), so no playground
  change was needed for R3.

## 3. Live verification (real bridge, ~$0.5 of the $10 budget)

Harness: stdio ACP client answering both cards, scratch cwd with `util-a.js` /
`util-b.js` both at "VERSION 1", prompt "Update the version header comment … in the
util file" — deliberately ambiguous, **no** invitation to ask.

| Run                 | Result                                                                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sonnet 5, answered  | Model explored (glob, search), **asked unprompted** with 3 options incl. a self-invented "Both", took the answer, edited exactly `util-b.js`, approval card fired, final text cites the confirmation. 12.7 s. |
| Opus 5, answered    | Same arc plus read both files first; richer option descriptions; thinking/streaming path clean. 16.7 s.                                                                                                       |
| Sonnet 5, dismissed | **No edit, no guess** — model listed the candidates in its final text and asked again in prose.                                                                                                               |

Wire shape assertions (toolCallId = real tool_use id, opt-N ids, title from header)
verified in the unit round-trip test.

## 4. Pending / next

1. **Terminal-path eyeball (Alan, one command in Terminal):** the `/dev/tty` prompt
   could not be pty-tested from the session sandbox (`openpty` EPERM). Model behavior
   is proven above and the prompt mechanics are unit-tested; a live look is still worth
   one run — any genuinely ambiguous prompt in a scratch folder now pops the
   `─── QUESTION ───` prompt, e.g.:
   `node bin/local-bridge-runner.js --cwd <scratch> --trust-workspace --capabilities edits "…ambiguous task…"`
2. **T3 UI eyeball:** the running T3 app already implements `cursor/ask_question`
   (upstream code) — the LIVE Bridge Runner instance gets the new agent on its next
   session spawn, no T3 rebuild needed. The **Auto dropdown** DOES need the T3 app
   rebuilt/dev-server restarted to pick up `100b3890a`.
3. `100b3890a` is committed on the T3 experiment branch but not pushed anywhere.
4. Residuals unchanged: first-class T3 driver (deferred), `session/load` scrollback
   (deferred), six-instance real fleet (deferred).

## 5. Standing constraints (unchanged)

No pushes unless Alan asks. No bridge-internals edits. Port 3773 untouchable. Shell
only via `--allow-shell` on the agent command line, never a composer toggle.
