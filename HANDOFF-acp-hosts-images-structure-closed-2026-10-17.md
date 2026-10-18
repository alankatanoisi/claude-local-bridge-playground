# Handoff — Cursor's ACP hosts + images review: all five findings closed (2026-10-17)

> **Status banner.** Built and unit/protocol-tested on the 2020 laptop the afternoon of
> 2026-10-17 (Fable 5.1, Alan-directed, from the 2024 laptop over T3). **Committed to playground
> `main` the same afternoon** (Alan-directed) as one commit titled
> `Simplify ACP host startup and image acceptance onto the existing helpers`; find it with
> `git log --oneline --grep='Simplify ACP host startup'`. **Not yet Cursor-reviewed**
> — per the four-seat charter, landed runner code gets at least one Cursor invariant review after
> it lands; treat the claims below as the implementer's own account until that review exists.
> **Live T3 checks (screenshot drop, VS Code connect-only success) are still Alan's** and were
> not run here.

**Review being closed:** `HANDOFF-acp-hosts-images-thermo-nuclear-2026-10-17.md` (Cursor,
same day; range `ac43f12`…`fb6b0fd`). Its "Not bugs (do not fix)" list was honoured in full —
see §4.

## 1. What changed, in plain language

The chat can still pick a bridge host and still send screenshots. Nothing a user sees is
different, except two fixes:

- a screenshot of **exactly** the advertised 7 MB limit is now accepted (it used to be dropped,
  because the size check counted base64 padding as data), and
- if you press **Stop** at the exact moment the bridge finishes starting, the "Bridge connection
  (local)" card now shows **failed / cancelled** instead of staying stuck on "in progress".

Under the hood, the program now has **one** list of bridge ports, **one** way to ask macOS whether
a bridge is ours, **one** controller lock, and **one** rule for which images are forwarded. The ACP
translator (`agent.js`) is back under 1000 lines because the prompt parser and the connection card
moved into two small sibling files.

## 2. Finding-by-finding closure

| Cursor finding                                                             | Closed by                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **High #1** — second copy of the hosting machinery; false "one table" note | New leaf module **`src/hosting/hosts.js`**: the `HOSTS` table (name, port, timeout, `managed`, composer `description`), `MODES` and `WEB_PORT` **derived** from it, `LOCK_PORT`, `ROOT`, `LABEL_PREFIX`, launchd naming, the three output parsers, `probeMessagesEndpoint`, and `withLoopbackLock({ wait })`. `control.js` keeps its synchronous wrappers and exclusive Start; `connection-operations.js` keeps its abortable wrappers; both now call the same parsers, probe, and lock. The `vscode` host derives its port from `DEFAULT_BRIDGE_URL` (now exported by `model-client.js`); `validateVscodeUrl`'s default is that constant too. `ensure.js` no longer requires `control.js`; `control.js` no longer exports `connectionOperations`/`ensure`; `bin/local-bridge-acp.js` builds `connectionOperations()` at process start and injects it. `createHostManager()` without operations throws. Drift guard: `test/bridge-hosts-table.test.js`. |
| **High #2** — `agent.js` 1032 lines, test file 1043                        | `src/runner/acp/prompt-content.js` (parser) and `src/runner/acp/bridge-connection.js` (card) extracted; host blurbs moved onto the table; `agent.js` **943** lines. The two stub-`run()` tests moved into `acp-image-prompt.test.js`; `acp-agent.test.js` **972** lines. `promptTextFrom`/`promptContentFrom` stay re-exported from `agent.js`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Medium #3** — two cancel exits, one leaves the card in progress          | `connectBridgeForTurn()` decides the outcome first, then paints **exactly one** terminal `tool_call_update` on every path (completed; failed + error text; failed + cancelled text), then returns or throws. New test "a cancel that lands as startup finishes still closes the connection card" (ensure resolves while `cancelRequested` is already true); the existing catch-path test now also asserts the card's final state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Medium #4** — three image policies; "decoded size" did not decode        | One acceptor in `media-read.js`: `ACCEPTED_IMAGE_MEDIA_TYPES` (derived from the extension map), `acceptImage(mediaType, data)` using `Buffer.byteLength(data, 'base64')`, and `isAcceptedImageBlock(block)`. `promptContentFrom` uses it and keeps only the visible text; `buildUserMessage` uses it (a well-formed block with the wrong media type is now refused); `run.js` filters once and the transcript/ledger `images` count is the number of blocks **placed**. `estimateTokens` charges `IMAGE_BLOCK_ESTIMATE_TOKENS` (still 1600) directly; the `* 4` disguise is gone. Limit test now uses real base64 of `MAX_IMAGE_BYTES` (kept) and `+ 1` (dropped).                                                                                                                                                                                                                                                                                      |
| **Low #5** — every prompt rewrote the host file                            | `hostSettings.saveHostIfChanged()`: writes only when the companion file is missing or holds a different host; a corrupt/symlinked file raises `readHost`'s own error (loudly, before any model request). The save now runs **before** the connection card, so a settings failure is reported as itself. `set_config_option` still persists before acknowledging. Test pins inode stability across unchanged prompts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## 3. Decisions taken beyond the brief (read these)

1. **Controller inspection is now strict, like the adapter.** `control.js`'s `job()` used to read
   _every_ `launchctl print` failure as "not loaded". It now treats only exit codes 113/3 (absent
   service; 113 verified on this Mac, macOS 27.2) as not loaded and raises the shared fixed message
   on anything else. Consequence: a broken `launchctl` makes `status`/`stop`/`start` fail loudly
   instead of printing "stopped" or bootstrapping over unknown state. Cursor named the
   disagreement; this is the direction chosen. If Alan wants the lenient controller back, it is a
   two-line change in `job()`, not a revert.
2. **`status` prints hosts in table order** (standalone, desktop, browser) instead of the old
   literal's order (desktop, browser, standalone). Cosmetic; the Finder launchers are unchanged.
3. **`PROMPT_IMAGE_MEDIA_TYPES` is gone** from `agent.js` (it was a second copy); tests import
   `ACCEPTED_IMAGE_MEDIA_TYPES` from `media-read.js`.
4. **`DEFAULT_BRIDGE_URL` is exported** from `src/runner/model-client.js` (it was module-private).
   No behaviour change in the model client.
5. **`scripts/hosting/measure-memory.js`** held a _third_ copy of the process-tree walk; it now
   calls `processRowsFrom`/`descendantPids` from `hosts.js`. Not unit-tested (needs a live job);
   `node --check` passes and the rows shape (`[pid, ppid, rss]`) is unchanged.
6. **`docs/t3-bridge-host-integration.{md,html}`**: table rows for `hosts.js` and the two ACP
   helpers; the sentence "Images, audio, and embedded context remain advertised as unsupported" was
   stale since 2026-10-16 and now says images are accepted.
7. **Stricter outbound filter.** `buildUserMessage` previously forwarded any `type: 'image'` block
   with a string `source.data`; it now requires the exact base64 shape, a known media type, and
   the size limit. The only producer today (ACP) already met that rule, so no live path changes.

## 4. Cursor's "Not bugs" list — all honoured

ACP start still uses bootstrap-or-`kickstart` without `-k` and never `control.start`; no ACP stop
operation; VS Code stays connect-only; discovery stays passive (adapter construction is closures
only — pinned by the existing "discovery is passive" and "clean stdout" tests); the flat 1600-token
image charge stays; `DEFAULT_MAX_STEPS` 16 and the `||` in `run.js` untouched; the launcher's
`--allow-shell --trust-workspace` untouched; `prompt` stays a string and bytes stay on
`promptAttachments`; no resume-branch transcript event added; `scrubDeepSecrets` and the two-key
settings file unchanged; `promptTextFrom` kept; false-green register edits untouched;
`/usr/bin/open` stays inside the lock; `confirm`/`askUserQuestion` and `run.js` not split.

## 5. Checks run (real output, in order)

- **Baseline before any edit:** `npm test` → 1204 tests, **1203 pass, 0 fail**, 1 todo.
- **Focused set (Cursor's list + the new table test + `standalone-host` + `media-read`):**
  92 tests, **92 pass, 0 fail**.
- `npm run lint` → clean (no output).
- `npm run check:docs` → both checks passed.
- `prettier --check "src/**/*.js" "test/**/*.js"` → all files clean after `--write` on four
  files (`connection-operations.js`, `media-read.js`, `bridge-hosts-table.test.js`,
  `acp-image-prompt.test.js`).
- **Full `npm test` after the change:** 1213 tests, **1212 pass, 0 fail**, 1 todo (baseline 1204 → nine new tests net).
- `npm run format:check` still fails on the same four root handoff files it failed on before this
  slice (Cursor's review file plus three older thermo-nuclear handoffs). The new root `.md` files
  from this slice were formatted with Prettier. Left the older four alone, as instructed.

## 6. Skipped / not done

- Live T3 verification: a screenshot drop on each of the four hosts, a VS Code connect-only
  success, and a Stop pressed during startup — Alan's, on the T3 side.
- No commit, no push (not requested in the turn). Suggested commit (one commit, as Cursor
  proposed): `Simplify ACP host startup and image acceptance onto the existing helpers.`
- No Cursor invariant review yet of this closure.

## 7. Pointers for the next agent

- Folder `/Users/alanman/Developer/claude-local-bridge-playground`, branch `main`, remote
  `origin` → `alankatanoisi/claude-local-bridge-playground`. Start from a clean pulled `main`
  (this slice landed as the single commit named in the banner).
- Read Cursor's review first, then this file, then the code. `hosts.js`'s header comment is the
  map of what is shared and why.
- Reviewer focus suggestions: (a) the strict controller `job()` decision in §3.1; (b)
  `withLoopbackLock` is one body for two modes — confirm the controller's fail-fast message
  (`/active/`) and the adapter's wait/abort behaviour both still hold (tests:
  `standalone-host.test.js`, `bridge-host-operations.test.js`, `bridge-hosts-table.test.js`);
  (c) `connectBridgeForTurn` emits exactly one terminal update on every path.
- Files changed: `bin/local-bridge-acp.js`, `scripts/hosting/measure-memory.js`,
  `src/hosting/{hosts (new),control,connection-operations,ensure}.js`,
  `src/runner/acp/{agent,host-settings,prompt-content (new),bridge-connection (new)}.js`,
  `src/runner/{media-read,context-builder,context-compactor,model-client,run}.js`,
  `test/bridge-hosts-table.test.js` (new), `test/runner/{acp-agent,acp-host-selection,acp-image-prompt}.test.js`,
  `docs/t3-bridge-host-integration.{md,html}`, `CLAUDE.md` (pointer), and the banner on Cursor's
  review file.
