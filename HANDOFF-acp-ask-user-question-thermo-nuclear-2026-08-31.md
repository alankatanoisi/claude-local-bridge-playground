# Handoff — Thermo-nuclear review of `c39ca6d` (ask_user_question / ACP card)

> **CLOSED 2026-08-31 — all four findings fixed** (Fable), in this file's
> recommended order, with the recommended tests. Medium #1: the asker's catch now
> branches — cancel text on `cancelRequested`, the guess fallback only on `-32601`,
> disconnect flips `cancelRequested` and stops the turn, any other client error
> fails closed with no guess invitation. Medium #2: the pending
> `cursor/ask_question` races a 100 ms cancel poller; `session/cancel` settles the
> ask with a real `tool_result` and the turn finalizes `cancelled` (test: card
> never resolves, prompt returns within 5 s). Medium #3: the
> `buildToolJudgmentSection` bullet rewritten affirmatively; its test now rejects
> the old discouraging phrases. Low #4: `parseAskQuestionAnswer` resolves labels
> before synthetic ids, drops unknown strings, and returns `invalid` on
> multi-pick answers to single-choice questions (exported + unit-tested).
> Checks: targeted 4-file suite 59/59; full suite (scratch HOME) 1055 pass /
> 0 fail / 1 todo; lint, format, docs clean. Not live-verified over T3 — the
> fixed seams are error/cancel/disconnect paths, all covered by protocol-level
> tests against the real runner. Findings text below preserved unchanged.

**Written:** 2026-08-31. Review only; no runner/ACP code changed (this file + a
banner on the thread-entry handoff).
**Scope:** already-landed playground `main` commit `c39ca6d`
(`feat(runner): ask_user_question works — affirmative description + live ACP
bridge to T3's question card`). No feature branch. No pull request for this
commit — do not invent one.
**Prior:** `HANDOFF-acp-ask-user-question-2026-08-31.md` remains the build and
live-verify record. This file is the audit of that commit's code.
**Verified against:** the diff and the current callers (`run.js`,
`tool-pipeline.js`, `tool-registry.js`, `user-question.js`, `connection.js`,
`context-budget.js`). Not against the prior handoff's claims.

Four files in the commit: `src/runner/acp/agent.js`,
`src/runner/tools/ask-user-question.js`, `src/runner/context-builder.js`,
`test/runner/acp-agent.test.js`. HEAD is later docs-only (`4e1bd6b`,
`3233bd6`); those files were not touched again.

## Findings (in-scope for `c39ca6d` only)

No High findings. The live-verify arc (model asks, honors the answer, dismissed
card does not write) is consistent with the code path that T3 actually takes:
the client returns `{ answers: { … } }` or empty answers. The gaps below are
the error, cancel, and prompt-surface seams that the four new tests do not
cover.

### Medium

1. **Every `cursor/ask_question` failure is narrated as "client does not
   support this method; guess."**
   `src/runner/acp/agent.js` 658–663: a bare `catch` returns
   `'ask_user_question is not supported by this ACP client; continue with your
best safe assumption.'` The comment at 620–622 names this as the intended
   fallback for "any transport or method-not-found error."
   `connection.js` 108–109 rejects with `RpcError` and a numeric `code`.
   `-32601` (`METHOD_NOT_FOUND`) is the non-T3 case the four tests cover
   (`test/runner/acp-agent.test.js` ~713–728) and is a correct guess-and-continue
   signal. The same string is also used for:
   - **Connection closed** (`connection.js` 122–130, 141–143 →
     `INTERNAL_ERROR` / "Connection closed"). `session.cancelRequested` is
     **not** set on stdin end. `ask_user_question` is read-only, so the tool
     result is recorded, `midTurnCheck` does not stop on cancel, and `run()`
     posts the "guess" result back to the **bridge HTTP** model call — which
     does not need the ACP socket. The model can still `write_file`. ACP
     `session/update` after that is a no-op (`connection.js` 55–56 `if
(closed) return`).
   - **Any other JSON-RPC error** (`INVALID_PARAMS`, `INTERNAL_ERROR`, a host
     that rejects the card with a non-empty error instead of empty
     `answers`).
   - **Cancel-as-error.** `session/cancel` (477–479) only flips
     `cancelRequested`. If T3 then **rejects** the in-flight
     `cursor/ask_question` instead of settling `{ answers: {} }`, this catch
     fires, the "guess" `tool_result` is persisted, and _then_
     `run.js` 1798–1802 `midTurnCheck` may abort the turn as `cancelled`.
     Resume of that checkpoint still contains the guess text.
     `confirm.ask` at 589–591 catch-returns `'deny'` — the safe counterpart.
     The new asker catch-returns the opposite instruction.
     Tests: only `-32601` and empty `answers`. No test for `-32603`, connection
     close, or `session/cancel` during the await.

2. **In-flight `cursor/ask_question` is not cooperative with `session/cancel`.**
   Cancel is checked only **before** the request (`agent.js` 632–634). The
   await at 646–657 does not poll `session.cancelRequested` and
   `connection.request` (`connection.js` 139–148) has no abort. Slice D's
   `shouldCancel` (`agent.js` 693; `run.js` 1716 and 1800) cannot run until
   this Promise settles.
   If T3's Stop dismisses the card with empty `answers` (the live-verify
   path), Medium #1's dismiss branch (665–667) is correct and the hang does
   not happen. If T3 leaves the JSON-RPC request pending — the same shape as
   a user staring at the card — Stop does nothing until they pick or
   dismiss. `session/request_permission` has the same await shape; this
   commit **adds a second** blocking agent→client request on the read-only
   path, so a question (not a write approval) can now pin the turn.
   Tests: `cooperative-cancel-stream.test.js` injects a **synchronous**
   `askUserQuestion` that flips the cancel flag and returns. It does not
   exercise a pending `connection.request`. The four new ACP tests all
   resolve the card immediately.

3. **The always-on tool-judgment prompt still contains the discouragement this
   commit names as the root cause.**
   Default `run()` uses `progressive: true` (`run.js` ~1262, ~1372). That
   path never emits `FULL_TOOL_DESCRIPTIONS` (the one-line this commit
   updated in `context-builder.js` 56). It always emits
   `buildToolJudgmentSection` (`context-builder.js` 114).
   `context-budget.js` 164–167 is unchanged:
   `'Use ask_user_question only when unresolved ambiguity would materially
change the result and a safe assumption is not available.'`
   That is the same "only when / safe assumption" wording removed from
   `ask-user-question.js` 16–22. The API `tools[].description` is now
   affirmative; the standing system-prompt judgment line still talks the
   model out of asking. Live Sonnet/Opus still asked — this is not "the
   tool is dead again" — but the prompt surfaces this commit touched are
   incomplete, and a more instruction-following model (or a future prompt
   tweak) can revive the original failure. `test/runner/context-budget.test.js`
   25–31 only asserts the section _mentions_ `ask_user_question`, so it
   cannot catch this leftover.

### Low

4. **`parseAskQuestionAnswer` trusts host strings that are not in the option
   list, and does not honor `allow_multiple`.**
   `agent.js` 261: `const label = labelById.get(text) || text;` — an unknown
   string becomes a `User selected:` result. TTY `parseSelection`
   (`user-question.js` 49) rejects unknown tokens.
   Generated ids are `'opt-' + (i + 1)` (637–638). A user-supplied option
   **label** equal to `'opt-1'` is looked up as an id and maps to option 1's
   label, not the option the user labelled `opt-1`.
   If `allow_multiple` is false and the host returns two ids, both are
   accepted (255–263). TTY rejects extra picks (`user-question.js` 50).
   Liberal parsing is documented in-commit and is the right default for
   host variance; the collision and `allow_multiple` holes are the part
   that can silently mis-report the operator's choice. No unit export, no
   test with a colliding label or a multi-select when `allow_multiple` is
   off.

## Not bugs (do not "fix")

- Rewriting the model-facing description from "use only when / unavailable
  in…" to affirmative guidance. That is the point of the commit. The TTY
  fail-closed guards in `user-question.js` 57–95 (plan, `--dont-ask`,
  `spawnDepth`, no TTY) are unchanged. `ask-user-question.test.js` still
  covers those **without** an injected `ctx.askUserQuestion`.
- ACP plan mode actually showing a question card. Plan allows read-only
  tools (`permissions.js` 51–52). The TTY plan-mode refusal is
  "do not block a plan on `/dev/tty`." A hosted card is a reasonable
  operator channel. Do not copy the TTY plan stub into the ACP asker
  unless Alan wants plan sessions to never ask.
- Workers still cannot ask. `execute()` 59–61 only bypasses
  `user-question.js` when a hosted asker is injected. Child workers are a
  separate CLI process (`worker-runtime.js`) with `spawnDepth > 0` and no
  ACP connection. `user-question.js` 70–74 still fails closed.
- Empty `answers` → dismissed, `is_error: true`, model does not get a
  selection. Matches the live dismissed-card run. Keep this.
- `-32601` → explained no + "best safe assumption." That is the non-T3
  client path. Keep it; **narrow** the catch (Medium #1), do not delete
  the fallback.
- Folding `description` into the wire `label` (`agent.js` 635–641). T3
  drops descriptions; the model seeing `Blue — the calm choice` is
  intended. The round-trip test's `/User selected: Blue/` regex is
  correctly loose.
- Prompt-text-keyed answers and label-or-id values
  (`parseAskQuestionAnswer` 244–249, 255–260). Host variance; tested.
- `cursor/ask_question` is a Cursor-host extension, not a baseline ACP
  method. Using it for T3 is the design. Non-T3 clients hit `-32601`.
- `FULL_TOOL_DESCRIPTIONS` only feeding the non-progressive prompt. Dead
  for default `progressive: true` runs; updating it was still the right
  companion edit. Do not rip it out.
- No feature-flag leak. No new env vars, ports, or credential paths. No
  bridge/`src/proxy.js` / `src/credentials.js` edits.
- Test client omitting `.catch` on `onAskQuestion` is test-only; a
  throwing handler hangs that test, not production.

## Recommended fix order

Stay in `src/runner/acp/agent.js` + `src/runner/context-budget.js` + the
matching tests. Do not touch credentials, proxy, or the TTY asker unless a
finding forces it.

1. **Medium #1** — In the `catch` of `askUserQuestion`, branch on the error
   and on `session.cancelRequested` _after_ the await:
   - `session.cancelRequested` → the existing cancel text
     (`Turn was cancelled before the question could be asked.`), not the
     guess text.
   - `err && err.code === ERROR_CODES.METHOD_NOT_FOUND` (`-32601`) → keep
     today's "not supported … best safe assumption" string.
   - `err && err.message === 'Connection closed'` (or
     `ERROR_CODES.INTERNAL_ERROR` from `connection.close`) → fail closed
     **without** telling the model to guess, and treat the turn as over
     (flip `session.cancelRequested` or return a result `run()` will map
     to `STOP_REASONS.CANCELLED` / a hard stop — do not leave a live
     `run()` posting to the bridge with no ACP client).
   - Any other RPC/transport error → dismissed-style fail-closed
     ("question could not be asked") with **no** "best safe assumption"
     clause.
     Tests in `test/runner/acp-agent.test.js`: (a) client answers `-32603`
     or `INVALID_PARAMS` → tool_result is_error and does **not** match
     `/best safe assumption/`; (b) after `cursor/ask_question` is sent,
     end the client input stream → no subsequent `write_file` in a stub
     that would otherwise write on the second `post()`; (c) `-32601` still
     matches `/not supported/` + `/best safe assumption/`.

2. **Medium #2** — Race `connection.request('cursor/ask_question', …)`
   against `session.cancelRequested` (poll or a cancel waiter). On
   cancel, return the cancel text and let `run.js` 1800 finalize. Do not
   leave the JSON-RPC request as the only way the turn can finish.
   Test: `onAskQuestion` never resolves; client `notify('session/cancel')`
   after the request is observed; `session/prompt` returns
   `stopReason: 'cancelled'` within a short timeout (not a hang). Mirror
   the Slice D cancel-during-read pattern; persist a real `tool_result`
   for the ask so resume does not look crashed.

3. **Medium #3** — Rewrite the `ask_user_question` bullet in
   `buildToolJudgmentSection` (`context-budget.js` 164–167) to match the
   new API description: consult the operator at a real decision point;
   if the call fails, then assume. Update
   `test/runner/context-budget.test.js` so it asserts the new wording
   (and **rejects** `/only when unresolved ambiguity/` / `/safe assumption
is not available/`).

4. **Low #4** (optional, same slice) — After mapping ids → labels, drop
   any `selected` entry that is not in `wireOptions`' labels. If
   `!payload.allow_multiple && selected.length > 1`, fail closed as
   invalid (same as TTY). Add a direct test: option label `'opt-1'` must
   not resolve as option 1 when it is option 2's label. Exporting
   `parseAskQuestionAnswer` for that test is fine.

## Pointers for the implementing agent

- Preflight: playground folder
  `/Users/alanman/Developer/claude-local-bridge-playground`, branch
  `main`, `origin` = `alankatanoisi/claude-local-bridge-playground`.
  Pull `--ff-only` if the tree is clean. Do not start from the canonical
  repo.
- `parseAskQuestionAnswer` is file-private; drive it through
  `createTestClient({ onAskQuestion })` unless you export it.
- `RpcError` already has `.code`. Import `ERROR_CODES` is already in
  `agent.js` 38.
- `ask_user_question` is `read-only`, so it runs inside
  `executeReadOnlyBatch` (`tool-registry.js` 332–335) **before**
  `midTurnCheck`. Cancel-during-ask must settle that read result _and_
  then let `run.js` 1798–1802 abort before any write in the same turn.
- Do not restore `--agent` / `--profile`. Do not edit
  `src/credentials.js`, `src/proxy.js`, `src/server.js`.
- Targeted tests:
  `node --require ./test/setup.js --test test/runner/acp-agent.test.js test/runner/context-budget.test.js test/runner/ask-user-question.test.js test/runner/cooperative-cancel-stream.test.js`
  Then `npm test` / `npm run lint` before handoff.
- Thread entry after a fix: banner
  `HANDOFF-acp-ask-user-question-2026-08-31.md` again and close the
  findings in **this** file (same pattern as
  `HANDOFF-acp-slice-d-thermo-nuclear-2026-08-25.md`).
- Commit/push only if Alan asks.

## Suggested commit shape (if asked)

One commit is enough:
`fix(runner): distinguish ACP ask_question errors from -32601; abort on cancel/disconnect; align judgment prompt`.
