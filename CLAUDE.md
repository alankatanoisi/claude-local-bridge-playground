# CLAUDE.md

**Doc type:** durable reference + auto-loaded guardrails. **Facts verified as of 2026-07-25.**
**Perishable status does not belong in this file** — see [Current Work Thread](#current-work-thread) for
the pointer to where status lives.

Claude-specific instructions for this repository. Read `AGENTS.md` first; it contains the shared beginner-first workflow and safety rules. The **Learned User Preferences** and **Learned Workspace Facts** blocks below must stay mirrored with `AGENTS.md` so Claude Code and Cursor see the same Alan preferences.

## Which File Loads Where

Three agent surfaces read this repo and **they do not load the same files**. Know which one you are
before assuming your context is complete.

| Surface | Auto-loads | Does NOT auto-load |
| --- | --- | --- |
| **Claude Code** (this file's audience) | `CLAUDE.md` | `AGENTS.md`, `.cursor/**` |
| **Cursor** | `AGENTS.md`, `.cursor/rules/**` | `CLAUDE.md` |
| **Codex** | `AGENTS.md` | `CLAUDE.md`, `.cursor/**` |

Consequences that have caused real problems:

- Safety invariants must be restated **in this file** to be reliably in a Claude Code session's
  context. That is why some content here duplicates `AGENTS.md` rather than only linking to it.
- Only the two **Learned** blocks at the bottom are under the mirroring rule. Everything else in this
  file and `AGENTS.md` was written independently and **has drifted**. Treat `AGENTS.md` as upstream for
  the Learned blocks; for anything else, check both before trusting either.
- `.cursor/**` primitives are **not** visible to Claude Code or Codex, and as of 2026-07-25 several of
  them contradict current invariants. Do not assume Cursor shares your understanding.

## Which Clone Is This?

Run `pwd` before assuming:

| Path ends with                   | This clone     | GitHub                                                                                            | Expected branch |
| -------------------------------- | -------------- | ------------------------------------------------------------------------------------------------- | --------------- |
| `claude-local-bridge-playground` | **Playground** | [claude-local-bridge-playground](https://github.com/alankatanoisi/claude-local-bridge-playground) | `main`          |
| `claude-local-bridge`            | **Canonical**  | [claude-local-bridge](https://github.com/alankatanoisi/claude-local-bridge)                       | reference-only  |

If you are in playground, commits belong to the playground repo on `main`. Do not open or continue canonical repo pull requests unless Alan explicitly asks. A pull request is a GitHub request to merge one branch into another; this repo normally works directly on playground `main`.

## Startup Preflight

At the start of file, repo, docs, testing, syncing, or command-line work, verify the location before editing:

```bash
pwd
git rev-parse --show-toplevel
git branch --show-current
git remote -v
git status --short
```

Success in this playground looks like:

- `pwd` and the repo root end with `/Users/alanman/Developer/claude-local-bridge-playground`
- the branch is `main`
- `origin` points to `alankatanoisi/claude-local-bridge-playground`
- the working tree has no unexpected dirty source files

Then pull this branch before new edits when it is safe to do so:

```bash
git pull --ff-only origin main
```

If the folder is home, Downloads, an iCloud checkout, a scratch folder, or the canonical repo, pause and tell Alan before editing.

## Human Context

Alan is using agents to learn and build. He is a strong systems thinker, highly curious, and enthusiastic about learning, but a true novice at programming and terminal workflows. It is correct to treat him as if he does not understand usual programmer conventions. Default to over-explaining, not under-explaining.

### Novice-First Rules

1. Never assume Alan knows whether something belongs in Terminal, VS Code, Cursor chat, GitHub in a browser, or a local folder path.
2. Define jargon once when you use it. Examples: branch, commit, push, pull request, merge, current working directory, lint, JSONL.
3. Every command you give must say where to run it, what folder to use first, and what success looks like.
4. Prefer one step at a time for Git and Terminal unless Alan asks for a batch.
5. Warn before risky actions such as pushing, force pushing, deleting files, enabling shell access, accepting edits automatically, or editing outside the repo.
6. Do not skip handoff fields: folder, branch, files, checks, skipped checks, and risks.
7. Prefer HTML docs over Markdown for complex documentation.
8. Prefer liberal and generous amounts of inline comments in code to explain the "why" behind the "what".
9. When adding new JavaScript in the runner, short beginner-friendly `//` comments are welcome where they explain non-obvious control flow. Do not add comments that only repeat what the code already says.
10. When in doubt, provide more context and explanation rather than less.
11. When providing multiple options, explain the pros and cons of each to help Alan make an informed decision.

## Project Overview

Claude Local Bridge is the transport shim: a VS Code extension that exposes Claude Code credentials through a local HTTP
API on `localhost:11437`.

The runner is an experimental local coding-agent loop on top of that bridge:

```text
prompt -> local bridge /v1/messages -> model response -> tool_use -> local tool execution -> tool_result -> repeat
```

The bridge owns OAuth, keychain, interceptor, and proxy behavior. The runner owns the part we are actively evolving:
the local agent loop, capability groups, permissions, prompts, transcripts, archives, and command-line user
experience.

## Architecture Boundary

Claude Local Bridge has two layers:

- Bridge layer: VS Code extension, local HTTP server, OAuth/keychain/interceptor/proxy behavior. Treat this as transport
  plumbing unless Alan asks for bridge work.
- Runner layer: local CLI agent loop, capability groups, prompts, templates, permissions, transcripts,
  archives, readable logs, docs, and command builder. Treat this as the active product surface.

## Current Direction

The playground is an Anthropic-native **cc bridge runner lab**. The current goal is to make the runner simpler,
smaller by default, and easier to extend through project-local primitives. The bridge keeps model transport available,
but subsequent work should not overfocus on OAuth/interceptor/proxy internals.

Design direction:

- Minimal default prompt and minimal startup context.
- Explicit opt-ins for instruction docs, repo maps, skills, shell, and advanced patch mode.
- Customization through `.bridge-runner/` files, prompt templates, hooks, and command-builder presets.
  (Not profiles — see the retirement invariant under Safety Rules.)
- Capability groups over large flat tool menus.

Transport invariants:

- Keep the native Anthropic Messages route: `POST /v1/messages`.
- Do not restore OpenAI-compatible routes such as `/v1/chat/completions` or `/v1/models`.
- Do not restore Anthropic Console API-key fallback paths (no upstream `ANTHROPIC_API_KEY` fallback).
- Do not add or restore `claudeLocalBridge.apiKey` as an upstream credential source.
- Upstream model calls should use Claude Code OAuth Bearer credentials only.
- Dummy API-key strings such as `local` are only local client placeholders; they must not be forwarded upstream as `x-api-key` or become upstream Anthropic auth.
- Do not capture or replay upstream `x-api-key` credentials as a success path.
- Keep debug, trace, transcript, and log surfaces redacted because OAuth tokens and fingerprints are sensitive local account state.
- Document policy risk plainly when transport/auth behavior is relevant: this is personal research, not proof of Anthropic approval.

For Anthropic API, Claude Code, billing, or policy facts, use official sources first: `docs.anthropic.com`,
`code.claude.com/docs`, `support.claude.com`, and official `github.com/anthropics/*` repositories. Make use of the
anthropic-platform-expert and/or anthropic-official skills to provide accurate and up-to-date information.

Do not modify bridge/auth/proxy internals unless explicitly requested or clearly needed to keep runner transport
working:

- `src/credentials.js`
- `src/proxy.js`
- `src/server.js`
- `src/interceptors/**`

Runner tasks should usually stay in:

- `bin/local-bridge-runner.js`
- `src/runner/**`
- `test/runner/**`
- `docs/**`
- `README.md`

## Key Files

- `README.md`: main project and runner guide.
- `CLAUDE.md`: Claude-specific working notes.
- `package.json`: VS Code extension metadata, scripts, and defaults.
- `src/server.js`: local bridge HTTP server.
- `src/proxy.js`: Anthropic request forwarding.
- `src/runner/run.js`: main runner loop.
- `src/runner/model-client.js`: local `/v1/messages` client.
- `src/runner/tool-registry.js`: runner tool dispatch.
- `src/runner/permissions.js`: allow/ask/deny policy.
- `src/runner/safety.js`: path confinement, deny matrix, environment scrubbing, and secret redaction.
- `bin/local-bridge-runner.js`: runner command-line entrypoint.
- `bin/local-bridge-archive.js`: local runner archive browser/importer.

## Safety Rules

Keep these invariants:

- Shell is hidden unless `--allow-shell` is set.
- `--dont-ask` must not enable shell by itself.
- Block `.env`, private keys, credential JSON, token files, `.ssh`, `.aws`, `.claude`, and path escapes.
- Write tools ask for confirmation unless `--accept-edits` is set.
- Tool output, transcripts, stream output, JSON output, and human logs redact secrets. All sinks pass
  through one central redaction boundary (`src/runner/redaction-boundary.js`). **Corrected 2026-07-25:**
  this line previously described the central boundary as an open gap (P0-11). P0-11 closed 2026-07-19 and
  permission safari 2 field-confirmed redaction across transcript, JSON/stdout, stderr, redacted trace, and
  full trace. The stale caveat had persisted for six days and was propagated into other documents.
- `--cwd` means the target project folder the tools operate inside.
- Agent profiles and capability profiles are **retired** runtime concepts. Do not restore `--agent`,
  `--profile`, `--list-agents`, or `--list-profiles`; historical code lives under
  `docs/archive/runner-profiles/`. (This invariant was present in `AGENTS.md` but missing here until
  2026-07-25 — a Claude Code session had no way to know.)

### Known live gaps (as of 2026-07-25)

Two path-safety gaps are **observed and unremediated**. Redaction is the only thing standing behind the
first one, so do not treat the deny matrix as target-aware:

- An in-root symlink whose own basename is innocent but whose **resolved target** basename is deny-listed
  (`.env`) is opened by `read_file`. `confinePath` resolves the link only to test containment, then returns
  the lexical path, so the deny matrix never sees the real target.
- `write_file` on such a symlink causes the backup step to read the denied file and write a **plaintext
  copy** into `.bridge-runner/backups/`, which is not covered by the deny matrix (shell-policy does block
  it). Gitignored, so it never appears in `git status`.

Full analysis and the remediation plan: `HANDOFF-safari-3-remediation-plan-2026-07-25.md`.
`src/runner/safety.js` `isFileCandidateAllowed` is the correct reference pattern already in-tree.

## Checks

Run relevant targeted tests first, then the standard checks before handoff:

```bash
npm test
npm run lint
npm run check:docs
npm run format:check
```

For runner-only work:

```bash
node --require ./test/setup.js --test test/runner/*.test.js
```

## Current Work Thread

**This section holds pointers only. It must never accumulate status.** Perishable state rots inside a
durable document — the previous version of this section listed P0-10/11/12 as open for six days after all
three closed, and every agent that read this file was misinformed on arrival.

**Single tracker:** `docs/runner-runtime-concordance-assessment-2026-07-17.html`. Annotate it when closing
items rather than starting a parallel tracker.

**Status as of 2026-07-25:**

- **P0-01 … P0-12: all closed** (P0-10 on 07-18; P0-11 and P0-12 on 07-19). Record:
  `docs/runner-p0-10-12-agent-handoff-2026-07-18.md`.
- **Active thread: the permission safaris.** Two adversarial field tests of the permission machinery have
  run. Safari 1 (flag-composition ladder) passed everywhere. Safari 2 (Codex, rounds A–P) found the symlink
  gap above and made no source fix. Safari 3 (remediation) is **planned and explicitly not authorized to
  execute** — read the banner in the handoff before acting.
  - Start here: `HANDOFF-safari-3-remediation-plan-2026-07-25.md` (and its `.html` twin for humans).
  - Findings: `docs/permission-safari-2-findings-2026-07-21.md` (authoritative).
  - Backlog: `docs/HANDOFF-safari-future-directions-2026-07-22.md` (authoritative; the `.html` is derived
    and truncated — do not treat differences as a second opinion).

**Two colliding `P0` namespaces exist in `docs/`.** The runtime-concordance series `P0-01…P0-12` is closed;
the future-directions band `FD-01…FD-05` is *also* labelled P0 by the 07-22 handoff. Write `FD-01` when you
mean `FD-01`. Register FD-* inside the concordance tracker rather than creating a third tracker.

## Docs To Keep Updated

When changing runner behavior or CLI options, update:

- `README.md`
- `docs/runner-quickstart.html`
- `docs/command-builder.html`
- `docs/threat-model.md` when safety behavior changes

## Learned User Preferences

These preferences are **universal for this repo** (same content as `AGENTS.md`). Follow them in Claude Code sessions too; do not treat them as Cursor-only memory. When continual-learning updates `AGENTS.md`, keep this block in sync.

> **Mirror verified in sync with `AGENTS.md` on 2026-07-25.** Both Learned blocks matched bullet-for-bullet.
> The mirroring rule is holding; the drift in this repo is in the *non-mirrored* sections, which were written
> independently in each file. A `check:agent-docs` script that fails the gate on divergence would make this
> verification automatic instead of manual — recommended, not yet built.

- Treat `docs/command-builder.html` as the primary day-to-day runner UX; keep it lean, and update it when runner CLI flags or capabilities change.
- Prefer compact in-UI explanations for runner flags (hover/"what does this do"/glossary) over relying on long docs alone; Alan learns mainly by doing.
- When drafting multi-step plans for this repo, write them as HTML rather than Markdown.
- When resolving mutually exclusive or risky command-builder choices, grey out or warn without resetting unrelated toggles the user already set.
- Prefer strengthening runner plan-mode so plans are usable without Alan manually spelling out every proposed step; skip a separate HTML plan doc on an implementation turn when he says to.
- Creative expansion beyond a written slice is welcome when it stays inside minimalism and deterministic-control invariants.
- After a runtime slice lands, prefer keep-building over a broad docs refresh unless Alan asks for docs or CLI/behavior changed enough to require it.
- At P0/P1 chunk stop points, prefer annotated concordance/roadmap updates plus a dedicated agent-facing handoff (not only chat summary); commit/push/sync when he asks in the same turn.
- Technical guardrails and safety checks are not disrespect: Alan owns goal-level and executive decisions; agents own developer-intelligence guardrails (cwd/branch checks, risky-flag warnings, refuse unsafe shortcuts).
- Prefer over-explaining Terminal/Git/app ownership (Terminal vs VS Code vs Cursor vs GitHub browser) over assuming Alan already knows the workflow.

## Learned Workspace Facts

Same content as `AGENTS.md` — keep mirrored.

- A sibling Codex lab lives at `/Users/alanman/Developer/codex-local-bridge-playground`; keep that work separate from this Claude playground unless Alan explicitly asks to cross-apply.
- Local runner session artifacts often live under `~/.bridge-runner`; prefer a unified transcript/index layout when changing logging rather than inventing a second parallel scheme.
- Runtime concordance / P0–P1 remediation status is tracked in dated docs under `docs/` (assessment HTML plus agent-facing handoffs); annotate those when closing items rather than inventing a parallel tracker.

## Handoff

Always end with:

- Folder and branch used.
- Files changed.
- Tests/checks run.
- Anything skipped.
- Risks or next steps.

Do not claim something is pushed unless `git push` actually succeeded.
