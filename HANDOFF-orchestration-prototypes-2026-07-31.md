# HANDOFF — Orchestration Prototype Slice (L1 + H2 + H1 + W1) — 2026-07-31

| Field | Value |
| --- | --- |
| Type | Agent-facing execution handoff (plan approved by Alan, execution authorized) |
| Written by | Claude Code session, 2026-07-31 |
| Intended executor | Cursor agent on Alan's Mac (or any agent with local shell access) |
| Repo | `claude-local-bridge-playground`, branch `main` |
| Prototype workspace | `~/Developer/orchestration-prototypes/` (sibling folder, NOT under git) |
| Token spend | **Authorized by Alan** — small budget, ~12–18 short live calls total (H1 leg B + W1 live worker). L1, H2, and W1's stub/regex workers are zero-token. |
| Bridge | Live and auth'd at `http://localhost:11437` (VS Code extension must be running) |

---

## 0. Read this first

1. **You are Cursor: you auto-load `AGENTS.md` but NOT `CLAUDE.md`.** Everything from `CLAUDE.md`
   that this task needs is restated here. Do not assume you have it from elsewhere.
2. **Why execution stopped mid-slice:** the previous session (Claude Code) hit a transient
   Claude-Code-infrastructure outage on state-changing tool calls. It does not affect you. Nothing
   about the plan failed — zero runs were executed, so there are no partial results to reconcile.
3. **The working tree has intentional uncommitted changes.** `git status` will show `CLAUDE.md`
   modified and this handoff file as new. The `CLAUDE.md` edits are a deliberate correction made
   with Alan's approval on 2026-07-31 (stale path-safety narrative replaced with verified current
   state). **Do not revert them.** Committing is Alan's call — ask him in your first response.
4. **Hard boundaries (from `CLAUDE.md`, binding on you too):**
   - Do NOT edit `src/**`, `bin/**`, or `test/**` in this repo. Prototypes live only in
     `~/Developer/orchestration-prototypes/`. Results documents go in this repo's `docs/`.
   - Do not touch bridge/auth/proxy internals; do not restore profiles, OpenAI-compatible routes,
     or API-key fallbacks.
   - Single-tracker rule: if any finding graduates to runner work, register it as an `FD-*` entry
     in `docs/runner-runtime-concordance-assessment-2026-07-17.html` — never a new tracker.
   - Alan is a programming novice: over-explain, say where each command runs, one step at a time
     for anything risky, and end with the handoff fields (folder, branch, files, checks, skipped,
     risks). See `AGENTS.md` Novice-First Rules — they apply fully.
5. **Kill any run that loops unexpectedly** rather than letting it burn Alan's quota.

## 1. Background in one paragraph

The repo's research phase (study `docs/ai-orchestration-preliminary-study-2026-07-29.md`, review
`docs/ai-orchestration-study-review-and-next-steps-2026-07-30.html`, fact-check
`docs/runner-claims-validation-2026-07-31.md`) concluded the runner already embodies the
"user-owned orchestration" architecture, and the next step is small local prototypes. Alan chose
four, in execution order **L1 → H2 → H1 → W1**. Each produces a results doc in `docs/`. The full
approved plan is reproduced below with everything the previous session already verified — trust
these facts, they were checked against source on 2026-07-31.

## 2. Already done — do not redo

- `~/Developer/orchestration-prototypes/l1-stub-harness/mock-bridge.js` — **written, not yet run.**
  A ~110-line dependency-free Node mock of `POST /v1/messages`: turn 1 returns a `list_files`
  `tool_use` block, turn 2 (detected by presence of a `tool_result` in the last message —
  stateless by design) returns final text. Logs each request to `requests.log`. Listens on
  `127.0.0.1:11999`.
- `~/Developer/orchestration-prototypes/l1-stub-harness/fixture-target/` — 3 harmless files
  (`readme.txt`, `hello.js` with one TODO, `about.yaml`).
- Verified facts you should build on rather than re-derive:
  - Runner CLI: prompt is **positional**; key flags: `--bridge-url <url>`, `--cwd <path>`,
    `--trust-workspace` (required headless), `--output-format json`, `--accept-edits`,
    `--max-steps <n>`, `--capabilities <list>`. Entry: `bin/local-bridge-runner.js`.
  - Metrics source: with `--output-format json`, the terminal `result` event contains
    `num_turns`, `usage.input_tokens`, `usage.output_tokens`, `duration_ms`
    (emitted in `src/runner/run.js` ~line 971). The run **manifest does NOT contain token data**
    and read-only runs write no manifest at all — do not look there.
  - Transcript JSONL (default `~/.bridge-runner/logs/<ts>.jsonl`) ends with `{type:'final'}` and
    `{type:'usage', ...}` events; transcripts are redacted at write time.
  - Mock response shape must include `content` (array of blocks), `stop_reason`, `usage` — the
    runner buffers full JSON by default (`src/runner/model-client.js`); non-200 → typed error.
  - srt: the real repo is **`anthropic-experimental/sandbox-runtime`** (npm
    `@anthropic-ai/sandbox-runtime`, CLI `srt`). macOS uses Seatbelt via `sandbox-exec`; requires
    `ripgrep`. Settings JSON shape:
    `{"filesystem": {"denyRead": [...], "allowWrite": [...], "denyWrite": [...]}}` — macOS
    supports git-style globs (`**/.env`). Invoke: `srt --settings <file> <command>`. Its README
    says **nothing about symlink handling** — that silence is exactly what H2 tests. Beta research
    preview: APIs may change; if install/run fails, the failure narrative IS the deliverable.
  - Safari-2 attack shape to replicate (from `docs/permission-safari-2-findings-2026-07-21.md`):
    an **in-root symlink with an innocent basename whose target basename is deny-listed**
    (`ln -s .env notes.txt`), plus an out-of-root escape link. Note the runner's gate now blocks
    this class (`resolveFileTarget`, `src/runner/safety.js:366` + `src/runner/permissions.js:215`);
    H2 asks whether srt blocks it at the **OS** layer too.

## 3. The four prototypes

### L1 — stub-model runner harness (zero tokens) — NEXT ACTION

1. Terminal, folder `~/Developer/orchestration-prototypes/l1-stub-harness`:
   `node mock-bridge.js` (leave running; success = "listening" line printed).
2. Second terminal, folder = the playground repo root:
   ```bash
   node bin/local-bridge-runner.js \
     --bridge-url http://127.0.0.1:11999/v1/messages \
     --cwd ~/Developer/orchestration-prototypes/l1-stub-harness/fixture-target \
     --trust-workspace --output-format json \
     "List the files in this project."
   ```
3. Success: run completes with the mock's scripted final text; `requests.log` shows **exactly 2**
   lines (turnDetected 1 then 2); transcript JSONL written under `~/.bridge-runner/logs/`;
   `result` event shows `num_turns: 2`-ish and the mock's fake usage numbers.
4. Write `notes.md` in the L1 folder (what ran, what the transcript shows). Walk Alan through the
   transcript in chat — the learning payload is the point of L1.

### H2 — srt sandbox evaluation (zero tokens)

1. Folder `~/Developer/orchestration-prototypes/h2-srt-eval`: `npm init -y` then
   `npm install @anthropic-ai/sandbox-runtime` (**local install only, never `-g`**; invoke via
   `npx srt` or `node_modules/.bin/srt`). Check `ripgrep` present (`rg --version`), `brew install
   ripgrep` if not — ask Alan before brew installs.
2. Build `attack-fixtures/`: `.env` containing `FAKE_SECRET=not-a-real-secret-1234`;
   `ln -s .env notes.txt` (in-root alias); `outside-target/real.env` one level ABOVE the fixture
   dir with `escape.txt` symlinking to it (out-of-root escape).
3. `srt-settings.json` in the fixture dir:
   `{"filesystem": {"denyRead": ["**/.env"], "allowWrite": ["."], "denyWrite": ["**/.env"]}}`
4. Probe matrix — run each under srt from inside `attack-fixtures/`, record allow/deny + exact
   error text: `cat .env` (direct denied read), `cat notes.txt` (symlink alias — THE question),
   `cat escape.txt` (escape link), `echo x >> notes.txt` (write via alias), `cat readme-ish
   allowed file` (control, must succeed). Also run each WITHOUT srt once to show the OS default
   (everything succeeds) for contrast.
5. Deliverable: `docs/srt-sandbox-evaluation-2026-07-31.html` (+ short `.md` twin) in the repo:
   method, matrix (attack shape × srt result × runner-gate result), adoption verdict, what runner
   integration would require. Do NOT edit `docs/threat-model.md` (its rewrite belongs to HE-05).

### H1 — CodeAct-on-the-bridge (live tokens, authorized)

1. Build `h1-codeact/fixture-project/`: ~6 small text/code files seeded with a KNOWN number of
   `TODO`/`FIXME` comments (write down the answer key first). Task for both legs: "count
   TODO/FIXME comments per file and write summary.md with a table."
2. **Leg A (classic loop)** — real runner against the LIVE bridge (default URL, or
   `--bridge-url http://localhost:11437`), from the repo root:
   `node bin/local-bridge-runner.js --cwd <fixture-project> --trust-workspace --accept-edits
   --output-format json --max-steps 12 "<task prompt>"` — run 2–3×, capture `num_turns`, usage,
   `duration_ms` from each `result` event, and delete `summary.md` between runs.
3. **Leg B (CodeAct)** — small Node client (`codeact-leg/client.js`) POSTs ONE request to the
   bridge `/v1/messages`: system prompt says "reply with a single self-contained Node script using
   only fs/path relative to cwd; no network; no child processes", user prompt = same task.
   Extract the script from the response, **show it to Alan and get his OK before executing**
   (novice-safety rule; or run under srt if H2 succeeded), then run it with cwd = fixture,
   `env: {}` in a child process. Capture the single call's usage + wall clock. Run 2–3×.
4. Deliverable: `docs/codeact-bridge-experiment-2026-07-31.html` (+ `.md`): metrics table (tokens,
   round-trips, wall clock, correctness vs answer key, failures), honest limitations section
   (single task, tiny N — a probe, not a benchmark).
5. Budget guard: legs A+B together stay within ~12–18 live calls.

### W1 — same task, three workers, one contract (mostly zero tokens)

The thesis demo: a bounded deterministic program is a legitimate worker peer of a model.
1. `w1-worker-bakeoff/contract.md` + JSON Schema: input (target dir), output (per-file counts +
   rendered table), declared cost ceiling, timeout, authority (read-only + one write). One screen.
2. `dispatcher.js` (~50 lines): load contract, invoke named worker, validate output against
   schema, enforce timeout, record wall clock + declared-vs-actual cost.
   **Zero worker-specific logic in the dispatcher — that IS the experiment.** No
   `if (worker === ...)` branches; workers share one interface (e.g., async run(input) → output).
3. Workers: `workers/live.js` (reuse H1 leg-B client, or shell out to the runner headless — reuse
   H1's captured data where runs would be identical, to save tokens), `workers/stub.js` (canned
   correct answer, zero tokens), `workers/regex.js` (pure Node walk + regex count, no model).
4. Run all three through the unchanged dispatcher 2–3× each; table: correctness vs answer key,
   wall clock, cost, variance. If the live worker fails schema validation, record it — that
   variance finding motivates the gateway validation-and-repair layer; it is a result, not a bug
   in your setup.
5. Deliverable: `docs/worker-bakeoff-2026-07-31.html` (+ `.md`), explicitly noting this reframes
   the study's P3 external-SDK bake-off: the contract boundary matters, not the SDK.

## 4. Finishing the slice

- Repo checks (repo root): `npm run check:docs` and `npm run format:check` (new docs only —
  `npm test` / `npm run lint` are skippable if you touched no repo JS, say so in the handoff).
  Note: `format:check` has known pre-existing warnings (`CLAUDE.md`, `README.md`, several
  HANDOFF files) — do not "fix" unrelated files; just ensure YOUR new files pass.
- Add pointers for the four new docs under "Active thread" in `CLAUDE.md`'s Current Work Thread
  AND keep `AGENTS.md` untouched (nothing here changes its rules; the Learned blocks stay as-is).
- End with the standard handoff fields. Commit/push only if Alan asks in-turn.

## 5. Risks and honesty rules

- Report real numbers only; never fabricate a run result. A failed prototype with a precise
  failure narrative is a valid deliverable (especially H2 — srt is a beta preview).
- The bridge must actually be up for H1/W1 live legs (VS Code with the extension running).
  If `localhost:11437` refuses connections, stop and tell Alan rather than debugging the bridge.
- Generated code (H1 leg B) executes on Alan's Mac: confinement is cwd + empty env + Alan's
  eyes-on approval (or srt). Do not skip the approval step to save time.
- File:line anchors in this handoff are 2026-07-31 snapshots and may drift.
