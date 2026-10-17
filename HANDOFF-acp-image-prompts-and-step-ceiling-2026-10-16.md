# HANDOFF — ACP image attachments + per-turn step ceiling (2026-10-16)

> **Cursor thermo-nuclear review, 2026-10-17:** [`HANDOFF-acp-hosts-images-thermo-nuclear-2026-10-17.md`](HANDOFF-acp-hosts-images-thermo-nuclear-2026-10-17.md).
> This file is the build record. The “decoded size” wording in §2 does not match the length formula that landed (review Medium #4). Do not implement from this file.

**Doc type:** dated record of one landed slice. **Author:** Fable 5.1 (Claude Code), Alan-directed.
**Folder:** `/Users/alanman/Developer/claude-local-bridge-playground`, branch `main`.
**Status:** built and unit/protocol-tested; **not yet live-verified in T3** (see §4) and **not committed** at
the time of writing — Alan decides both.

## 1. What Alan asked for

Two problems surfaced while using the Bridge Runner through T3 Code's Local ACP provider on 2026-10-16:

1. **Dropping screenshots into the composer failed** with the same error for one image as for five. That rules
   out a payload-size limit; T3 gates attachments on the agent's advertised `promptCapabilities.image`, which
   was `false`. Alan chose "path 1": real image support, not a graceful-degrade message and not a docs-only note.
2. **A real work turn stopped at "Reached max_steps (16)"** mid-edit (it was, ironically, this very fix). The
   ceiling comes from the runner's CLI default; the ACP binary passed nothing, and T3 exposes no knob for it.
   Alan's owner decision: a default of **1000** for ACP turns.

## 2. What landed

| File                                        | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/runner/acp/agent.js`                   | `promptCapabilities.image: true`. New `promptContentFrom(blocks)` splits an ACP prompt into `{ text, attachments, dropped }`; ACP `{type:'image', data, mimeType}` → Anthropic `{type:'image', source:{type:'base64', media_type, data}}`. Unsupported media type, missing data, or decoded size over `MAX_IMAGE_BYTES` (7 MB, shared with `media-read.js`) is dropped with a numbered placeholder appended to the text. Image-only prompts get a stub (`(See attached image.)`). `promptTextFrom` is now a thin wrapper. `run()` is called with `promptAttachments` (only when non-empty) and `maxSteps: runDefaults.maxSteps \|\| DEFAULT_ACP_MAX_STEPS` (1000). Exports: `promptContentFrom`, `PROMPT_IMAGE_MEDIA_TYPES`, `DEFAULT_ACP_MAX_STEPS`. |
| `src/runner/run.js`                         | New option `promptAttachments`, passed to both `buildUserMessage` call sites (fresh and resume). `prompt` stays a plain string. Transcript `user_prompt` and ledger `user_prompt` gain `images: <count>` only when > 0 — counts, never bytes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `src/runner/context-builder.js`             | `buildUserMessage(text, stdinText, prefixBlocks, attachments)`: well-formed image blocks go after env-prefix blocks and before the text block; malformed blocks are refused. Plain-string return shape is unchanged when there are no attachments.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `src/runner/context-compactor.js`           | `estimateBlockChars` charges a flat 1,600 tokens per image block instead of counting base64 as prose (a 600 KB screenshot would otherwise look like ~200k tokens and trip the context budget).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `bin/local-bridge-acp.js`                   | New `--max-steps <n>` flag (positive integer, validated, documented in `--help`), forwarded via `runDefaults`. Default stays in `agent.js` so it is testable without spawning.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `test/runner/acp-agent.test.js`             | Initialize asserts `image: true`; existing text-extraction test updated for the placeholder; new tests for attachment forwarding (shape, text-only turns carry no key, image-only stub) and for the step default vs. command-line override (including the `maxSteps: undefined` clobber case).                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `test/runner/acp-image-prompt.test.js`      | **New.** Unit tests for the conversion (all four media types, case normalization, drop reasons, size limit, stubs), `buildUserMessage` composition, the compactor estimate, a scrub round-trip proving persisted base64 survives `scrubDeepSecrets`, and the binary's `--max-steps` parsing (`--help`, `=abc`, `=0`, `=-5`).                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `docs/t3-bridge-host-integration.{md,html}` | Two paragraphs under "Use it in T3": images, and the step ceiling with the `--max-steps` instruction.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

### Design choices worth knowing

- **`prompt` stays a string.** Images travel as a sibling option. Every text sink in `run.js` (ledger
  `prompt.slice(0, 500)`, `trace.capture(prompt)`, human log, archive collector, transcript) is untouched and
  cannot receive image bytes. This was the alternative to making `prompt` a content array and teaching five
  sinks to summarise it.
- **Images persist in the session checkpoint.** `session-store.js` writes the API messages to disk so later turns
  resume with them; the model must keep seeing the screenshot, so the bytes stay. Cost: roughly the image size per
  screenshot per session file. The on-disk scrub (`scrubDeepSecrets`) cannot corrupt them: every secret pattern
  needs `-`, `_`, `.`, whitespace or an inner `=`, none of which occur in standard base64 — pinned by test.
- **Order inside the user message:** env-prefix text → images → prompt text, following Anthropic's
  image-then-question guidance.
- **Step default lives in `agent.js`, not the binary,** and is applied _after_ the `runDefaults` spread so a
  caller passing `maxSteps: undefined` still lands on 1000. The CLI runner's `DEFAULT_MAX_STEPS = 16` is
  deliberately unchanged (changing it would ripple into README, quickstart and both command-builder docs).

## 3. Checks run (real output)

- `node --require ./test/setup.js --test test/runner/acp-image-prompt.test.js` — 16/16 pass. First run had one
  failure: `--max-steps -5` was rejected by Node's `parseArgs` ("argument is ambiguous") before our validation;
  the test now uses the `--max-steps=-5` form and passes.
- `node --require ./test/setup.js --test test/runner/acp-agent.test.js` — 32/32 pass.
- `npm run lint` — clean. Prettier run on all changed files.
- Full runner suite, `check:docs`, `format:check`: see the chat report for this session (run after this file was
  written).

## 4. Not done / next

1. **Live verification in T3.** Restart the provider (T3 relaunches the agent process; the capability is read at
   `initialize`), drop one screenshot on a text turn, confirm the model describes it. Then a two-image turn and a
   follow-up turn that refers back to the image (exercises the persisted checkpoint path). Expect the usual
   bridge-metered cost of ~1,600 input tokens per image.
2. **Cursor invariant review** of this range per the four-seat charter; this handoff is the review brief. Known
   "not bugs": the 1,600-token flat estimate is a heuristic by design; `audio`/`embeddedContext` stay `false`.
3. **Commit/push** only on Alan's word. Suggested message: `Accept image attachments over ACP and raise the ACP
step ceiling to 1000`.
4. Optional later: a composer select for the step ceiling. Not attempted — T3's Cursor host silently drops
   descriptors it does not recognise (see the `describeModelKnobs` comment), so it needs a live probe first.
