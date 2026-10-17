# Handoff — Thermo-nuclear code-quality review of T3 host selection and ACP images (2026-10-17)

**Written:** 2026-10-17. Review only. No runner code was changed.
**Scope:** landed playground `main` commits `ac43f12a78fe8b67dca96ad3f3f479db4f619ed5` (per-chat T3 bridge hosts) and `fb6b0fd4dba83deb76e48f46bae622f6aa7cda0c` (ACP image attachments and the 1000-step ceiling). No feature branch and no pull request. Parent of the range is `0011586`.
**Verdict:** do not treat this range as structurally done. Behavior is carefully tested. The shape of the code is not. Two blockers: ACP grew a second copy of the hosting machinery next to `src/hosting/control.js`, and `src/runner/acp/agent.js` went from 837 lines to 1032.

**Prior write-ups are context, not evidence.** Claims below were checked against the current files.

- `HANDOFF-t3-acp-hosts-2026-10-16.md` — build record. Its Codex note (“no new actionable findings”) is not this review.
- `HANDOFF-acp-image-prompts-and-step-ceiling-2026-10-16.md` — build record. Its “decoded size” sentence does not match the size check that landed (Medium #4).

## What these commits actually added

`ac43f12` lets one ACP (Agent Client Protocol) process offer four bridge hosts and start the three managed ones on the first prompt. `fb6b0fd` turns T3 image blocks into Anthropic image blocks and raises the ACP tool-step ceiling from the runner default of 16 to 1000.

Line counts, `wc -l` on the commits:

| File | Before `ac43f12` | After `ac43f12` | After `fb6b0fd` (HEAD) |
| --- | ---: | ---: | ---: |
| `src/runner/acp/agent.js` | 837 | 964 | **1032** |
| `test/runner/acp-agent.test.js` | 966 | 966 | **1043** |
| `src/hosting/control.js` | 419 | 423 | 423 |
| `src/runner/run.js` | 1978 | 1978 | 1989 |

`run.js` was already past 1000 lines. The image option belongs there. Do not split `run.js` because this diff touched it.

## Findings

### High

1. **ACP hosting is a second copy of `control.js`, and the “one port table” comment is false.**

   `src/hosting/ensure.js` lines 3–10 say the `HOSTS` table is the one place that prevents port drift. The managed ports already live in `src/hosting/control.js` line 11 (`MODES`: desktop `11447`, browser `11457`, standalone `11467`). The VS Code port `11437` also already lives in `src/runner/model-client.js` line 21 (`DEFAULT_BRIDGE_URL`). The browser editor port `18080` lives in `control.js` line 12 (`WEB_PORT`) and is typed again as a literal in the timeout string at `ensure.js` line 60.

   The same split continues through process inspection:

   | Concern | Existing | New copy |
   | --- | --- | --- |
   | launchd label | `control.js` lines 15–17, `LABEL_PREFIX` | `connection-operations.js` line 17, inlined |
   | `launchctl print` pid parse | `control.js` lines 25–31 | `connection-operations.js` lines 29–46, same regex |
   | descendant walk | `control.js` lines 85–100 | `connection-operations.js` lines 54–69 |
   | `lsof -Fp` listener parse | `control.js` lines 101–106 | `connection-operations.js` lines 48–51 |
   | OPTIONS `/v1/messages` probe | `control.js` lines 73–84 | `connection-operations.js` lines 71–84 |
   | loopback lock on port `18081` | `withLock`, `control.js` lines 384–400, fail immediately | `locked`, `connection-operations.js` lines 86–111, wait and retry |

   The copies already disagree, which is how drift starts. `control.js` `job()` treats every `launchctl` failure as “not loaded” (lines 29–30). The new `job()` treats exit codes 113 and 3 as “not loaded” and throws on anything else (lines 42–44). `ownsListener` treats an `lsof` failure as “not owned” (lines 107–108). The new `command()` turns that failure into a fixed error string (lines 25–26). `withLock` rejects when the port is busy. `locked` polls every 100 ms.

   `ensure.js` line 74 then reaches back up with `require('./control').connectionOperations()`, and `control.js` lines 404–406 reach back down with a lazy `require('./ensure')`. The CLI passes `undefined` as the operations argument (`bin/local-bridge-acp.js` lines 162–164) so that cycle is the production path. Construction stays passive today only because the `require` is inside `ensure()`, not because the dependency arrow is clean.

   There is a code-judo move that deletes the second stack without changing who is allowed to start or stop a host:

   - One host table. Managed ports, names, and timeouts come from it. `MODES` and `WEB_PORT` are derived from that table. The VS Code default URL is `DEFAULT_BRIDGE_URL`, not a third literal.
   - One inspector for label, pid line, descendant set, `lsof` rows, and the OPTIONS probe. The controller may keep a synchronous wrapper. ACP keeps the abortable wrapper. One function, two callers.
   - One lock function. `{ wait, signal }` is the ACP mode. Fail-immediately stays the controller mode. Same listen/close body, same port `18081`.
   - `createHostManager` receives `connectionOperations()` from `bin/local-bridge-acp.js`. `ensure.js` stops requiring `control.js`.

   Startup policy stays split on purpose. See “Not bugs”.

2. **`agent.js` and `acp-agent.test.js` both crossed 1000 lines because new features were poured into the translator.**

   `session/prompt` was already about 330 lines before this range. It is now lines 638–1007. These commits added a second job inside it: snapshot the composer (lines 894–897), paint a fake tool card (lines 907–929), save settings (line 931), await host startup (lines 932–935), and sometimes return `cancelled` (line 936) before `run()` (line 949). Image parsing is a pure function sitting in the same file (lines 52–64 and 274–325). The host blurbs are a four-way nested conditional inside `describeConfigOptions` (lines 173–184) instead of text on the host table.

   The module header (lines 6–9) now admits the file saves the bridge and drives the host manager. That is an honest description of a boundary that moved. The header should be able to go back to “this file translates ACP into `run()` options.”

   `fb6b0fd` is what crossed the line: `ac43f12` stopped at 964. The image tests then pushed `test/runner/acp-agent.test.js` from 966 to 1043. The two new cases (lines 974–1043) stub `run()` the same way `test/runner/acp-host-selection.test.js` already does. They do not need the real-runner harness at the top of `acp-agent.test.js`. `test/runner/acp-image-prompt.test.js` already exists for this contract; its header sends the protocol cases back into the file that was about to cross 1000.

   Decompose before the next ACP slice:

   - Move `promptContentFrom` / `promptTextFrom` / the media-type set out of `agent.js` (see Medium #4 for where the accept rule should live). Re-export `promptTextFrom` from `agent.js` so existing tests keep working.
   - Move the bridge-card block (lines 902–947) into a function whose only job is “connect this turn and always finish the card.” Call it from `session/prompt`. Fix Medium #3 in that function, not as a follow-up patch.
   - Put each host’s one-line description on `HOSTS`, and have `describeConfigOptions` read it.
   - Move the two stub-`run()` tests at `acp-agent.test.js` lines 974–1043 into `acp-image-prompt.test.js`.

   After that, `agent.js` should be back under 1000 (1032 minus the prompt parser and the card block). Do not also split `confirm` / `askUserQuestion` in this slice. Those predate this range. Split them only if the file is still over 1000 after the extractions above.

### Medium

3. **The new connection card has two cancel exits, and one of them leaves the card in progress.**

   Inside the host `try` (`agent.js` lines 930–947):

   - Line 936: if `ensure()` returns and `cancelRequested` or `connection.closed` is set, the handler `return`s `{ stopReason: 'cancelled' }` and never calls `connectionUpdate`.
   - Lines 939–945: if `ensure()` throws, the card is set to `failed` and then the handler returns `cancelled` or throws.

   `ensure()` can return after a cancel. Its last abort check is line 118, then line 119 sends “Connected—sending prompt” and line 120 returns. A `session/cancel` in that gap sets `cancelRequested` and resolves the promise. Line 936 then runs. The last card update is still `in_progress` (the status callback at lines 920–928). T3 keeps showing “Bridge connection (local)” as running after the turn has already ended as cancelled.

   The existing test “cancel during host startup” (`test/runner/acp-host-selection.test.js`) makes `ensure` reject on abort, so it only covers the catch path. It never asserts that the card left `in_progress`.

   The extracted function from High #2 should have one exit shape: every path emits one terminal `tool_call_update` (`completed`, `failed`, or a cancelled failure with the existing “no model request was sent” text) before the prompt handler returns. Add a stub where `ensure` resolves while `cancelRequested` is already true, and assert the last update for that `toolCallId` is not `in_progress`.

4. **Image acceptance is three policies, and the “decoded size” check does not decode.**

   `HANDOFF-acp-image-prompts-and-step-ceiling-2026-10-16.md` says an image is dropped when its decoded size is over `MAX_IMAGE_BYTES`. The code at `agent.js` lines 305–306 does `Math.floor((data.length * 3) / 4)`. That is not decoded length.

   Checked in Node against `MAX_IMAGE_BYTES` (`src/runner/media-read.js` line 20, 7 × 1024 × 1024 = 7340032):

   - `Buffer.alloc(7340032).toString('base64')` has length 9786712.
   - The formula returns 7340034, so an image of exactly the advertised limit is dropped.
   - `Buffer.byteLength(thatString, 'base64')` returns 7340032, which is the real decoded size. Padding is why: this length is `1` mod `3`, so the base64 ends in `==`, and the formula counts the padding as data.

   The test that pins the limit (`test/runner/acp-image-prompt.test.js`, the `'A'.repeat(...)` case) builds a string of the formula’s shape. It cannot catch the padding miss. Replace it with `Buffer.alloc(MAX_IMAGE_BYTES).toString('base64')` (must be kept) and `Buffer.alloc(MAX_IMAGE_BYTES + 1).toString('base64')` (must be dropped). Use `Buffer.byteLength(data, 'base64')` in the check. That helper already exists everywhere else this repo measures bytes.

   Two more copies of “what counts as an image”:

   - `PROMPT_IMAGE_MEDIA_TYPES` (`agent.js` line 56) repeats the four values of `IMAGE_MEDIA_TYPES` (`media-read.js` lines 11–17). One set, next to `MAX_IMAGE_BYTES`.
   - `buildUserMessage` (`context-builder.js` lines 231–236) accepts any `type: 'image'` whose `source.data` is a string. It does not look at media type, `source.type`, or size. `run.js` line 508 counts `promptAttachments.length` before that filter, and the ledger (lines 1316–1321) records that count. A block the builder drops is still reported as attached. ACP happens to build blocks the filter keeps, so today’s T3 path survives. The next caller will not.

   Put one acceptor next to `media-read.js`: media type, decoded byte length, and the Anthropic `{ type: 'image', source: { type: 'base64', media_type, data } }` shape. `promptContentFrom` uses it and still owns the visible placeholder text and the “(See attached image.)” stub. `buildUserMessage` uses the same acceptor. The ledger count is how many blocks were actually placed on the message.

   The 1600-token flat charge is the right idea and should stay 1600. The coupling is not. `estimateBlockChars` (`context-compactor.js` lines 45–54) adds `1600 * 4` fake characters so `estimateTokens` (line 68) can divide by 4 and get 1600 back. Charge `IMAGE_BLOCK_ESTIMATE_TOKENS` in `estimateTokens` when `block.type === 'image'`, and stop pretending the image is prose. The `chars / 4` comment at line 17 is the constant this is secretly depending on.

### Low

5. **Every prompt rewrites the host file that `set_config_option` already saved.**

   `session/set_config_option` persists, then returns (`agent.js`, the `bridge_host` branch around lines 582–586). The prompt path writes the same enum again (`agent.js` line 931) with `fsync` before `ensure()`. The first prompt of a new chat does need a save, because `session/new` only keeps the default in memory. Later prompts do not. A disk error on an unchanged file fails the turn before any model call, and the card shows a connection failure for a settings rewrite.

   Save when the companion file is missing or the stored host differs. Keep the “write must succeed before we report the new selection” rule on `set_config_option`.

## Not bugs (do not fix)

- Do not send ACP startup through `control.start` (`control.js` lines 126–136). That function stops the other managed modes. ACP `start` (`connection-operations.js` lines 129–146) must keep bootstrap-or-`kickstart` and must not pass `-k`. Sharing inspectors is the fix. Sharing the exclusive start verb would change the product.
- Do not add a stop operation for the ACP caller. Cancel and chat-close leave shared hosts running. That is the design.
- VS Code stays connect-only. No launch, restart, stop, or ownership adoption. A successful OPTIONS probe is enough for that host.
- Discovery stays passive: `initialize`, `session/new`, `session/load`, and model listing must not spawn `launchctl`. Injecting `connectionOperations()` at process start is fine; calling `ensure` during discovery is not.
- The flat 1600-token image estimate stays. Only the `* 4` disguise goes. `audio` and `embeddedContext` stay off (`agent.js` prompt capabilities).
- `DEFAULT_MAX_STEPS` in `run.js` line 64 stays 16. The ACP ceiling is `DEFAULT_ACP_MAX_STEPS` (1000), applied after the `runDefaults` spread (`agent.js` line 953). `run.js` line 1290 also uses `maxSteps || DEFAULT_MAX_STEPS`, so leave the `||` alone. `??` would fight that line.
- `bin/t3-bridge-runner.sh` always passes `--allow-shell` and `--trust-workspace`. That is the launcher’s explicit opt-in, matching the previous T3 shim. Host choice does not grant shell by itself. Do not “simplify” those flags off.
- `prompt` stays a string. Image bytes stay on `promptAttachments` and in the session checkpoint. Transcripts and the ledger store a count. Do not thread base64 into `prompt.slice`, traces, or human logs.
- The resume branch (`run.js` line 1222) still does not append a transcript `user_prompt` line. It did not before this range either. The ledger line after both branches does record `images`. Do not add a resume transcript event as part of this cleanup.
- `scrubDeepSecrets` around the host enum (`host-settings.js` line 54) stays. The file is tiny on purpose (schema version plus host, key count must be 2).
- `promptTextFrom` may stay as a one-line wrapper. Callers and tests use it. Move it with `promptContentFrom`; do not delete it.
- The false-green register edits (`acp/host-settings.js`, one Darwin skip in `test/bridge-host-operations.test.js`) stay. They are the reviewed-sink and reviewed-skip lists doing their job.
- `/usr/bin/open` stays inside the controller lock (`connection-operations.js` lines 148–167) unless a later slice writes the 90-second record in a way that still retries when `open` itself fails. Pulling `open` out of the lock as a drive-by drops that retry.
- Do not split `confirm` or `askUserQuestion` in this slice. Do not split `run.js`.

## Recommended fix order

One slice. Behavior of host choice, image forwarding, and the step ceiling stays. Structure shrinks.

1. **High #1** — One host table, one inspector, one lock. CLI passes operations into `createHostManager`. Add a test that managed `HOSTS` ports and `MODES` cannot diverge (or delete `MODES` as a second literal). Re-run `test/bridge-host-ensure.test.js`, `test/bridge-host-operations.test.js`, and `test/runner/acp-host-selection.test.js`. Those tests should keep passing without edits except imports.
2. **High #2 and Medium #3 together** — Extract the prompt parser and the connection-card function. The card function always emits a terminal update. Add the “`ensure` returns after cancel” test. `agent.js` ends under 1000 lines. Move `acp-agent.test.js` lines 974–1043 into `acp-image-prompt.test.js` so that file ends under 1000 too.
3. **Medium #4** — One image acceptor using `Buffer.byteLength(..., 'base64')` and `IMAGE_MEDIA_TYPES`. Ledger count matches blocks that were kept. Charge 1600 tokens directly in `estimateTokens`. Replace the `'A'.repeat` limit test with real base64 of `MAX_IMAGE_BYTES` and `MAX_IMAGE_BYTES + 1`.
4. **Low #5** — Save the companion file on the first prompt and when the selection changes. `set_config_option` still persists before it acknowledges the change.

## Pointers for the implementing agent

- Folder: `/Users/alanman/Developer/claude-local-bridge-playground`. Branch: `main`. Remote: `origin` → `alankatanoisi/claude-local-bridge-playground`. Start from a clean pulled `main`. This review was done at `fb6b0fd` with a clean tree.
- Read this file. Do not treat either October 16 handoff, or the Codex “no findings” paragraph, as the review result.
- Stay in `src/hosting/**`, `src/runner/acp/**`, `src/runner/media-read.js`, `src/runner/context-builder.js`, `src/runner/context-compactor.js`, `src/runner/run.js` (count only), `bin/local-bridge-acp.js`, and the tests named above. Do not edit `src/credentials.js`, `src/proxy.js`, `src/server.js`, or `src/interceptors/**`.
- Do not restore `--agent` or `--profile`.
- Focused checks, from the repo root:

  ```bash
  node --require ./test/setup.js --test \
    test/bridge-host-ensure.test.js \
    test/bridge-host-operations.test.js \
    test/runner/acp-host-selection.test.js \
    test/runner/acp-image-prompt.test.js \
    test/runner/acp-agent.test.js
  ```

  Then `npm test`, `npm run lint`, and `npm run check:docs` if a doc sentence about ports or image limits changed.
- `npm run format:check` already fails on three older handoff files listed in `HANDOFF-t3-acp-hosts-2026-10-16.md`. Leave those files alone.
- Live T3 checks (screenshot drop, VS Code connect-only success) are still Alan’s, and they are outside this structural slice.
- Commit and push only if Alan asks.

## Suggested commit shape (if asked)

One commit: `Simplify ACP host startup and image acceptance onto the existing helpers.`

Body, in plain language: the chat can still pick a bridge and still send screenshots. The program now has one list of ports, one way to ask macOS whether that bridge is ours, and one rule for which images are forwarded.
