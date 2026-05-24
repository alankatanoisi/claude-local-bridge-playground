# Handoff — Perf Parity Work

A short read-me for whoever picks this work up next (including future Alan).

## Where we are

- **Folder**: `/home/user/claude-local-bridge` (canonical)
- **Branch**: `claude/magical-edison-7Qou6`
- **Open PR**: [#17 — Perf parity: prompt cache + file cache + persistent shell + bench](https://github.com/alankatanoisi/claude-local-bridge/pull/17) (draft)
- **Plan it follows**: `/root/.claude/plans/suggest-performance-improvements-in-agile-cray.md`

## What "perf parity" means here

We're closing the gap between this runner and **Claude Code** on
turn-by-turn cost and latency. Claude Code's speed comes from a small
set of well-known tricks (Anthropic prompt caching, in-memory file
cache, a persistent bash shell, parallel reads). The roadmap copies
those tricks one at a time, behind tests, into the runner.

## What landed in this PR

| Roadmap | Plain-language version | Where it lives |
| --- | --- | --- |
| **A1** Prompt caching | Tell the Anthropic API to remember our system prompt, tool list, and most of the prior conversation between turns, so it doesn't re-read everything every time. Cuts input cost ~90% on long sessions. | `src/runner/run.js` — `applyCacheControlBudget` |
| **B1** File cache | Keep recently-read files in memory; serve repeat reads from RAM. Invalidates automatically when the file changes on disk. | `src/runner/tools/_file-cache.js`, `src/runner/tools/read-file.js` |
| **B2** Persistent shell | Keep one bash process alive across many `bash` tool calls instead of starting a fresh shell every time. Opt-in via `BRIDGE_RUNNER_PERSISTENT_SHELL=1`. Smoke test: 20 echos drop from 47 ms to 19 ms. | `src/runner/tools/persistent-shell.js`, `src/runner/tools/bash.js` |
| **(plumbing)** Async tool registry | The persistent shell needs an `await`, so the registry's `execute`/`executeForce` now return Promises. Sync tools still work unchanged. | `src/runner/tool-registry.js`, `src/runner/run.js` |
| **D3** Turn-latency bench | Standalone harness that fakes the bridge, runs N scripted turns, and prints latency percentiles + cache breakpoint counts. Lets future perf changes be measured instead of guessed at. | `test/runner/bench/turn-latency.bench.js` |

## Checks that ran clean

- `npm test` (default config): **252/253 pass** in ~1.7 s
- `BRIDGE_RUNNER_PERSISTENT_SHELL=1 npm test`: **252/253 pass**
- `npm run lint`: clean
- `npx prettier --check` on every touched file: clean
- Bench output:
  ```
  cache_control per request:
    system: 1.00
    tools:  1.00
    msgs:   0.50
    total:  2.50 / 4 allowed
  ```
- Verified no leaked bash child processes after the test suite (an
  earlier draft of the persistent shell did leak them; `unref()` +
  `stdin.end()` in shutdown fixed it).

## The one failing test, explained

`test/runner/bash.test.js > bash tool > reports signal when process is killed`
fails on both this branch and the baseline `git stash`. It's about how
the bash tool reports a process that killed itself with `SIGABRT`. It
predates this work and is **out of scope** for the perf PR. Leaving
it for a dedicated bug-fix branch.

## What changed inside the safety envelope

Nothing. All the existing safety invariants still hold:

- Hidden shell unless `--allow-shell` (the persistent shell honours the
  same gate; the bash tool itself never even calls the persistent path
  if shell is denied).
- Write tools still ask for confirmation unless `--accept-edits`.
- `.env` / `.ssh` / `.aws` / `.claude` / `.bridge-runner` / private
  keys / token files / path-traversal escapes all still blocked.
- Secret scrubbing on transcripts and tool output still runs.
- The bridge layer (`src/credentials.js`, `src/proxy.js`,
  `src/server.js`, `src/interceptors/**`) was not touched, per
  `CLAUDE.md`.

## Risks to keep an eye on

1. **Persistent shell is opt-in for a reason.** It's been smoke-tested
   and unit-tested but never run in a real long-lived session yet. If
   we flip the default to on later, do a session where `bash` is used
   heavily and watch `pgrep -af "bash --norc"` for leaks.
2. **Prompt cache breakpoints can churn.** Right now we mark the last
   block of the second-most-recent message. If a future change starts
   mutating older messages mid-session (e.g. an aggressive compaction
   pass), the cache would invalidate on every turn. The bench's
   `cache_control` numbers are the smoke detector — they should stay
   near 2.5/4 in steady state.
3. **File cache trusts the permission layer.** It caches anything
   `read-file` was allowed to read. Don't add tools that bypass
   permissions and call `_file-cache` directly without the same gate.

## What's next (roadmap, in order)

In the plan file, the unshipped items are:

- **C1** — debounce session-store writes (stop the per-turn full
  rewrite of `session.json`).
- **C2** — append-only ledger with a cursor on resume (stop re-reading
  the entire ledger file on startup).
- **A2 / A3** — memoize per-block token estimates; reuse cached system
  prompt across compaction generations.
- **B3** — run independent write tools in parallel when paths don't
  overlap and confirmation is already granted.
- **B4** — stream large tool outputs (> 100 KB) instead of buffering.
- **D1** — run independent coordinator workers concurrently.
- **D2** — cache `fs.realpathSync` resolutions in the permissions
  check.

Each one is independently shippable. Suggested next step: **C1 + C2
together** (both target the same hot path — `session-store.js` and
`session-ledger.js` — and they're easy to verify with the bench
harness already in place).

## How to run things locally

```bash
# All tests (no persistent shell)
npm test

# All tests with persistent shell on
BRIDGE_RUNNER_PERSISTENT_SHELL=1 npm test

# Lint + format check
npm run lint
npx prettier --check "src/**/*.js" "test/**/*.js"

# Bench (human readable)
node --require ./test/setup.js test/runner/bench/turn-latency.bench.js

# Bench (machine readable, for diffing before/after a perf change)
node --require ./test/setup.js test/runner/bench/turn-latency.bench.js --json --runs 50
```

## Glossary (in case you're new to this part of the repo)

- **Runner** = the local CLI agent loop in `src/runner/**` and
  `bin/local-bridge-runner.js`. Distinct from the **bridge** layer
  (VS Code extension + local HTTP proxy in `src/`).
- **Prompt cache** = an Anthropic API feature where you mark blocks
  of a request with `cache_control` so the server can re-use a parse
  of an identical prefix from a recent request, cutting cost and TTFT.
- **Breakpoint** = one `cache_control` marker. You get 4 per request
  on the Anthropic API.
- **Sentinel echo** = the trick the persistent shell uses to know when
  a command has finished — it appends `printf "...$?...\n"` after the
  command, then reads stdout until that exact string appears.
- **Cache hit / miss** = whether the prompt cache served a request
  from cache or had to reprocess. Visible in the response's
  `usage.cache_read_input_tokens` / `cache_creation_input_tokens`.
