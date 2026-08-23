# Proposal — recalibrate `AGENTS.md` and `CLAUDE.md`

**Date:** 2026-08-22

**Status:** Proposal only; no live agent instruction file has been replaced or edited.

**Browser companion:** [Open the standalone HTML version](agent-docs-recalibration-2026-08-22.html)

## Decision requested

Approve a later, separate implementation pass that makes `AGENTS.md` and `CLAUDE.md` shorter and easier to enter while preserving every authority, safety, user-context, validation, and handoff invariant.

The proposed recalibration is structural, not behavioral:

- keep `AGENTS.md` as the shared contract for Codex, Cursor, and other surfaces that load it;
- keep `CLAUDE.md` self-sufficient for Claude Code, because Claude Code does not automatically load `AGENTS.md`;
- remove perishable work history from both live instruction files;
- make the Current Work Thread a small list of pointers whose targets own the status narrative;
- keep the **Learned User Preferences** and **Learned Workspace Facts** blocks exactly mirrored;
- retain the existing conservative runner and transport rules without weakening or broadening authority;
- do not replace either live file until Alan has reviewed and approved the final proposed text.

## Why recalibration is needed

The two live documents are individually useful, but they currently mix four jobs:

1. durable collaboration rules;
2. repository and safety invariants;
3. environment-specific operating instructions;
4. a dated history of completed work.

The first three jobs belong in live instructions. The fourth belongs in handoffs, trackers, and dated records.

The clearest example is `CLAUDE.md`: its Current Work Thread says that it “holds pointers only” and “must never accumulate status,” but the section then carries roughly eighty lines of dated P0/P1, permission-safari, orchestration, Starlark, and Agent Client Protocol (ACP) status. The newest pointer is valuable; the accumulated narrative makes every new agent reconstruct old history before it reaches the current boundary.

Two environment notes also need current verification during the later implementation pass:

- the Cursor Cloud section says `npm run format:check` has pre-existing failures, but that gate passed on this Mac on 2026-08-22;
- the same section names an old total of 478 passing tests, while the current local suite reported 1,032 tests, 1,031 passing, 0 failing, and 1 registered TODO on 2026-08-22.

Those statements may still describe a particular Linux environment, so this proposal does **not** silently rewrite them. It proposes labeling them as environment-specific evidence and refreshing them only from a new Cloud run.

## Proposed information architecture

### `AGENTS.md` — shared contract

Keep these sections, in this order:

1. **Purpose and load scope** — who reads this file and what it controls.
2. **Human context and novice-first communication** — the concise operational rules, with the fuller profile linked.
3. **Repository identity and startup preflight** — folder, branch, remote, dirty-tree stop, then fast-forward-only pull.
4. **Current direction and ownership boundaries** — runner lab first; bridge/auth internals protected unless explicitly in scope.
5. **Authority and safety invariants** — the complete conservative rule set in one place.
6. **Current work pointers** — only the authoritative ACP handoff, concordance tracker, and any other owner-designated live tracker.
7. **Checks and handoff contract** — targeted checks, four broad gates, and required final fields.
8. **Environment appendix** — Cursor Cloud facts, clearly labeled with platform and last verification date.
9. **Learned User Preferences** — copied verbatim and kept mirrored.
10. **Learned Workspace Facts** — copied verbatim and kept mirrored.

Sections that can be compressed without losing behavior:

- merge **Project Overview**, **Current Direction**, and the explanatory half of **Boundaries** into one concise “Direction and boundaries” section;
- reduce **Key Files** to the entry points an agent must actually choose between, linking to `README.md` or `docs/ARCHITECTURE.md` for the wider map;
- keep the four standard checks once rather than restating their purpose in several places;
- keep detailed environment anecdotes in the environment appendix, not the shared main path.

### `CLAUDE.md` — Claude-specific self-contained contract

Keep these sections, in this order:

1. **Load map** — the important fact that Claude Code loads `CLAUDE.md`, not `AGENTS.md`.
2. **Shared operating contract, restated** — repository identity, preflight, novice-first rules, boundaries, and every safety invariant required in Claude Code context.
3. **Claude-specific notes** — only genuinely Claude-specific tool/runtime behavior.
4. **Current work pointers** — the same short pointer list, with no status prose.
5. **Checks and handoff contract**.
6. **Learned User Preferences** — exactly mirrored from `AGENTS.md`.
7. **Learned Workspace Facts** — exactly mirrored from `AGENTS.md`.

Sections to move out of the live path:

- move the dated “Path-safety status” explanation to the existing threat model and validation record; keep one live invariant plus pointers;
- remove the P0/P1/orchestration/Starlark chronology from Current Work Thread; its dated source documents remain available;
- remove “corrected on date X” narratives once the corrected invariant itself is stated plainly and its evidence is linked.

## Exact proposed Current Work Thread text

The later implementation should replace the long status narrative in `CLAUDE.md` with a pointer-only section equivalent to this:

```markdown
## Current Work Thread

This section contains pointers only. The linked handoffs and trackers own status,
completion claims, evidence, and next steps.

- Active ACP (Agent Client Protocol) thread:
  `HANDOFF-acp-slices-b-c-2026-08-22.md`
- Runtime concordance tracker:
  `docs/runner-runtime-concordance-assessment-2026-07-17.html`
- Durable owner profile:
  `docs/working-with-alan.md`
- Final collaboration boundary:
  `docs/agent-user-autonomy-boundary-2026-08-11.md`

Do not add status prose here. Update or supersede the owning handoff/tracker instead.
```

If Alan designates another simultaneous live thread later, add one pointer to its authoritative handoff. Do not copy that handoff’s progress narrative into the agent file.

## Invariant-retention crosswalk

No item in this table may be lost during a later rewrite.

| Invariant                                                                                                   | Proposed durable home              | Claude Code requirement |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------- | ----------------------- |
| Work only in `/Users/alanman/Developer/claude-local-bridge-playground` unless Alan says otherwise           | Repository identity                | Restate in `CLAUDE.md`  |
| Expected branch is `main`; expected `origin` is the playground repository                                   | Repository identity                | Restate                 |
| Run `pwd`, repository-root, branch, remote, and short-status preflight before project work                  | Startup preflight                  | Restate                 |
| Stop on an unexpected dirty tree; preserve concurrent work                                                  | Startup preflight                  | Restate                 |
| Pull with `git pull --ff-only origin main` before edits when safe                                           | Startup preflight                  | Restate                 |
| Ask Alan when instructions are ambiguous or conflicting                                                     | Collaboration contract             | Restate                 |
| Assume beginner-level Terminal/Git knowledge; define jargon and explain where commands go                   | Human context / Novice-First Rules | Restate                 |
| Use generous explanatory code comments where they teach non-obvious control flow                            | Novice-First Rules                 | Restate                 |
| This is a long-horizon research playground; understanding is the deliverable                                | Human context                      | Restate                 |
| Keep Markdown reports paired with polished standalone HTML unless Alan says otherwise                       | Documentation rule                 | Restate                 |
| Runner work is the default lane; bridge/auth/proxy internals require explicit scope or transport necessity  | Direction and boundaries           | Restate                 |
| Preserve native Anthropic `POST /v1/messages`; do not restore OpenAI-compatible routes                      | Transport invariants               | Restate                 |
| Do not restore upstream API-key fallback, `claudeLocalBridge.apiKey`, or captured `x-api-key` success paths | Transport invariants               | Restate                 |
| Dummy client keys remain local placeholders only                                                            | Transport invariants               | Restate                 |
| Keep debug, trace, transcript, stream, JSON, and human-log surfaces redacted                                | Safety invariants                  | Restate                 |
| Read `SECURITY.md` before security or safety-boundary changes                                               | Safety invariants                  | Restate                 |
| Shell stays hidden unless `--allow-shell` is set                                                            | Safety invariants                  | Restate                 |
| `--dont-ask` cannot enable shell by itself                                                                  | Safety invariants                  | Restate                 |
| Sensitive paths, credential files, private keys, and path escapes stay blocked                              | Safety invariants                  | Restate                 |
| Write tools require confirmation unless `--accept-edits` is set                                             | Safety invariants                  | Restate                 |
| `--cwd` is the target project, not necessarily the runner repository                                        | Safety invariants                  | Restate                 |
| Agent/capability profiles stay retired; do not restore their old flags                                      | Runtime invariants                 | Restate                 |
| Runner session ledgers may contain sensitive prompts/paths; report aggregate counts only                    | Evidence handling                  | Restate                 |
| Do not initiate unsolicited Terms, policy, legal, or approval commentary                                    | Owner collaboration boundary       | Restate with pointer    |
| Warn immediately about concrete secret exposure, unintended publication, or destructive commands            | Owner collaboration boundary       | Restate                 |
| `docs/command-builder.html` is the primary day-to-day runner interface                                      | Learned User Preferences           | Mirror verbatim         |
| Learned preference/fact blocks must match between both files                                                | Mirror contract                    | Keep identical          |
| Run relevant targeted checks, then the four broad gates when practical                                      | Checks                             | Restate                 |
| Final handoff must name folder, branch, files, checks, skipped checks, risks, and commit/push state         | Handoff                            | Restate                 |
| Do not claim a push unless it actually succeeded                                                            | Handoff                            | Restate                 |

## Proposed guard against future drift

After Alan approves the text rewrite, add a small documentation check that extracts the bullets under **Learned User Preferences** and **Learned Workspace Facts** from both live files and fails if they differ.

That check should be deliberately narrow:

- it should enforce only the two blocks that the repository already declares mirrored;
- it should not require the rest of `AGENTS.md` and `CLAUDE.md` to be identical;
- it should print the first differing bullet in plain language;
- it should run under `npm run check:docs`;
- it should have its own focused tests before joining the gate.

This is a future implementation suggestion only. No script or test is added by this documentation task.

## Proposed approval and implementation sequence

1. Alan reviews this proposal and chooses whether the target structure is correct.
2. A later agent drafts complete replacement candidates beside the live files, with an invariant-by-invariant comparison.
3. Run the mirror comparison and all four repository gates against those candidates where possible.
4. Alan approves the exact replacement text.
5. Replace `AGENTS.md` and `CLAUDE.md` in one commit so no agent surface sees a half-migrated contract.
6. Re-run all four gates and verify that the Current Work Thread contains pointers only.
7. Keep this proposal and the documentation audit as the decision/evidence record.

## Explicit non-goals

- No runner, bridge, test, `bin/`, `src/`, or `starlark-host/` source change.
- No change to current permissions, safety defaults, credential handling, or provider routing.
- No replacement of `AGENTS.md` or `CLAUDE.md` in this task.
- No deletion of historical handoffs or evidence.
- No attempt to make Claude Code auto-load `AGENTS.md`; the proposal respects the current load boundary.
- No claim that environment-specific Cursor Cloud notes are wrong without a fresh run in that environment.

## Recommendation

Approve the architecture of this recalibration, then ask for one separate replacement-text pass. The highest-value change is the smallest one: make Current Work Thread genuinely pointers-only while retaining the complete shared safety contract and the exact mirrored Learned blocks.
