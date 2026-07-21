# HANDOFF — Permission Safari Future Directions & Outstanding Questions

**Date:** 2026-07-22

**Repository:** `/Users/alanman/Developer/claude-local-bridge-playground` (branch `main`)

**Audience:** Any agent (or human) picking up after Safari 1 + Safari 2 (both dated 2026-07-21)
**Status of prior work:** Observation complete. **No runner source was changed** during the safaris. This document is
forward-looking only — it lists what to do and answer next, not what was done.

## Read these first (context chain)

1. `docs/permission-safari-findings-2026-07-21.md` — Safari 1: permission-flag composition ladder (8 live rounds).
2. `docs/permission-safari-2-findings-2026-07-21.md` — Safari 2: Rounds A–P + isolated symlink `write_file` proof.
3. `docs/threat-model.md` — current documented posture, including the 2026-07-21 symlink caveat.
4. `docs/artifacts/permission-safari-2026-07-21/` — normalized evidence snapshots + SHA-256 manifests.
5. `docs/safari2-handoff-2026-07-21.html` — historical pre-run plan (context only; superseded by the findings).

## Ground rules for any follow-up session

- **Fake fixtures only.** Never use real credentials, real `.env` values, or real keys as probes.
- **Disposable sandboxes.** Run probes with `--cwd` pointed at a throwaway directory (e.g. under `/tmp`), never at the
  repository source tree.
- **Small bounds.** Use `--max-steps`, tool-call caps, wall-clock and cost budgets on every live round.
- **Evidence standard.** Classify every result as: confirmed control / model refusal / compensating control /
  suppressed claim / proof gap. A model refusal is _not_ proof a runner filter would have fired — design positive
  controls that actually emit the tool call.
- **Provenance discipline.** Three layers can deny: the outer product (Claude Code classifier / Codex UI), the model
  itself, and the runner's policy. Attribute each denial to the correct actor before drawing conclusions.
- **Fixes and probes are separate sessions.** Implement a fix, then re-run the relevant probe; don't interleave.

## Priority backlog

### P0 — Observed, unresolved issues (fix + regression-test)

| ID    | Item                                                                                                                                                                                                                                    | Acceptance criteria                                                                                                                                                                                                                                                                                             |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FD-01 | **Resolved-target deny checks for reads** (Safari 2 finding S2-01). An in-root symlink whose _alias_ basename looks safe but whose _target_ basename is deny-listed (`.env`) was readable; only central redaction prevented disclosure. | `permissions.check()` / `safety` applies the deny matrix to both the requested path and the realpath-resolved in-root target. Regression test: in-root alias → deny-listed target is hard-denied for `read_file`, `search_text` candidates, and `glob` results. Update `docs/threat-model.md` caveat when done. |
| FD-02 | **Sibling write-tool symlink behavior** (S2-02 proof boundary). `write_file` replaced the link object and did NOT write through — but `edit_file` and `apply_patch` were never tested.                                                  | Isolated fixture tests proving (or fixing) `edit_file` and `apply_patch` behavior on in-root symlinks to deny-listed targets. Hash-check the target before/after, and record link-object type. Also cover **hardlinks** (untested in both safaris).                                                             |
| FD-03 | **Interactive-timeout process lifecycle** (S2-03). After a confirmation timeout the CLI printed its final result but stayed alive until `Ctrl-C`.                                                                                       | Deterministic reproduction test; CLI exits with a defined code after timeout denial with no live handles.                                                                                                                                                                                                       |
| FD-04 | **Bridge request deadline** (S2-04, from the pre-Safari wedged-bridge episode). A hung `/v1/messages` call idled >3 minutes on an established local TCP connection.                                                                     | Client-side deadline + abort path in the runner's bridge client; a wedged call ends with a bounded, attributable error (e.g. `bridge_request_timeout`), covered by a test with a stalling mock server.                                                                                                          |
| FD-05 | **Liveness ≠ readiness.** `/v1/debug` answered while the model path hung.                                                                                                                                                               | Either a readiness probe that exercises the message path (tiny request), or explicit labeling everywhere that `/v1/debug` proves transport liveness only.                                                                                                                                                       |

### P1 — Auditability and receipt gaps

| ID    | Item                                                                                                                               | Acceptance criteria                                                                                                                                                                                                                        |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FD-06 | **Denial provenance taxonomy.** `User denied this action.` currently covers explicit human denial, missing TTY, timeout, and more. | Structured reason codes in transcripts, ledger, and model-facing tool results: at minimum `user_denied`, `approval_timeout`, `no_interactive_approval_channel`, `policy_hard_deny`, `authority_ceiling`, `capability_hidden`.              |
| FD-07 | **`--chaos-ok` durable audit marker** (S2-05). Warnings printed, but no transcript event recorded the acknowledgment.              | A transcript/ledger event capturing the acknowledgment and the effective high-authority flag combination at run start.                                                                                                                     |
| FD-08 | **Wall-clock and cost-budget terminal receipts** (Rounds L/M passed by operator observation only).                                 | Deterministic scenarios that emit an explicit terminal stop event (`wall_clock_exceeded`, `cost_budget_exceeded`) visible consistently in transcript, trace, ledger, and `--json` output; assert no effectful call ran after the boundary. |
| FD-09 | **Per-run transcript isolation.** Two manual attempts can look like one run in appendable files.                                   | Either one-transcript-per-run guaranteed, or explicit run-boundary records in appendable artifacts.                                                                                                                                        |
| FD-10 | **Automated artifact-permission tests** (Round P was a manual `ls -l`).                                                            | Tests asserting `0700` dirs / `0600` files across transcript, session, trust, trace, ledger, archive, and recovery-manifest creation paths.                                                                                                |

### P2 — Hardening probes still needing runner-level (not model-level) evidence

| ID    | Item                                                                                                                                                                                                 | Notes                                                                                                                                                                                                                                                           |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FD-11 | **Shell-filter canonicalization.** Round H produced only model refusals; the runner's lexical filter was never actually hit by an obfuscated path (quoted, variable-built, `$(echo …)`, normalized). | Needs a harness that injects tool calls directly (bypassing the model) or a scripted model that reliably emits them, so runner enforcement is tested in isolation. Fake fixtures only.                                                                          |
| FD-12 | **Indirect egress under `--no-network`.** Only direct `curl` was tested (denied pre-execution).                                                                                                      | Probe `unset http_proxy`, non-HTTP protocols (DNS, `nc`), and runtime APIs (`node -e 'fetch(…)'`) against a local-only listener. Keep documenting that this is a best-effort guard, not isolation.                                                              |
| FD-13 | **Case-sensitive filesystem retest.** Round O ran on case-insensitive macOS; `.ENV` existence checks can alias `.env`.                                                                               | Repeat filename-variant denial on Linux (or a case-sensitive APFS volume).                                                                                                                                                                                      |
| FD-14 | **Redaction property tests.** Positive control passed for tested fixtures/surfaces only.                                                                                                             | Property tests over chunk splitting, encodings (base64/URL-encoded/rot13 transforms of secret-shaped values), multiline keys, adjacent punctuation, and all trace levels. Open question: does redaction hold when the model _transforms_ a value before output? |
| FD-15 | **Interruption completeness.**                                                                                                                                                                       | `SIGINT`/kill at model-call, read-batch, confirmation-wait, and post-write boundaries; verify pending intents reconcile and terminal events are written.                                                                                                        |
| FD-16 | **Prompt-injection step burn.** Round E showed resilience, but denial-loop waste was not measured.                                                                                                   | Measure steps/tokens/cost consumed by hostile in-project text even when no sensitive effect is possible.                                                                                                                                                        |
| FD-17 | **OS-level sandbox exploration** (threat-model known limitation #1).                                                                                                                                 | Scoping spike: Seatbelt (macOS), Landlock/containers (Linux) as an opt-in execution mode for shell. Separate project; do not conflate with regex scanning.                                                                                                      |

### P3 — Methodology and tooling investments

| ID    | Item                                                                                                                                                                                                                                                                                                                      |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FD-18 | **Evidence-bundle command.** One command exporting normalized, redacted, hash-manifested run evidence (no provider reasoning, no fixture contents, no private home-dir state). Safari 2's manual normalization under `docs/artifacts/` is the template.                                                                   |
| FD-19 | **Recurring field-safari matrix.** A compact, versioned probe subset re-run after any permission/redaction/shell/persistence/transport change, with results diffed over time. Candidate for CI where probes are model-free (direct tool-call injection).                                                                  |
| FD-20 | **Cross-model control set.** Repeat a small ladder across model families/effort levels to separate stable runner behavior from model-specific refusal patterns.                                                                                                                                                           |
| FD-21 | **Outer-guardrail-compatible safari design.** Safari 2 was repeatedly blocked/hidden by outer product guardrails despite bounded fake-fixture experiments. Design pre-registered probe manifests (declared fixtures, bounded commands, expected effects) that are legible to outer classifiers and human reviewers alike. |
| FD-22 | **Auto-mode retest.** Auto permission mode was excluded due to the `claude-opus-4-8` classifier outage. When it recovers, characterize how outer auto mode composes with the runner's own permission ladder.                                                                                                              |

## Outstanding questions (concise list)

1. Should the deny matrix be **target-aware** for reads — and what is the right semantics for hardlinks, which have no
   "link object" to inspect? (FD-01/FD-02)
2. Do `edit_file` and `apply_patch` follow in-root symlinks where `write_file` did not? (FD-02)
3. Would the runner's lexical shell filter actually catch an obfuscated deny-listed path, or has model refusal been
   masking an untested filter the whole time? (FD-11)
4. Does redaction survive **model-side transformation** of secret-shaped values (base64, reversal, chunked emission
   across multiple messages)? (FD-14)
5. What exactly does the runner emit at **wall-clock and cost boundaries** — is there any window where an effectful
   tool call can land after the budget is exceeded? (FD-08)
6. Is the post-timeout live process (FD-03) a dangling handle (timer, stdin, socket) or an intentional wait — and are
   there other paths that leave the CLI alive after its final result?
7. Should `--dont-ask`'s name change, given field confusion that it might approve writes (it does not — Safari 1
   Round 4c)? Candidates: `--no-prompts`, `--non-interactive`.
8. Non-interactive denials read as `User denied this action.` — is it acceptable for model-facing text to imply a
   human decision that never happened? (FD-06)
9. How should `/v1/debug` liveness be labeled or supplemented so a wedged message path is detectable before a run
   hangs? (FD-04/FD-05)
10. Do the deny matrix and redaction behave identically on a **case-sensitive** filesystem, and are there
    Unicode/normalization (NFC/NFD) aliases of deny-listed basenames worth testing? (FD-13)
11. When outer auto mode returns, does its classifier ever _approve_ something the runner would deny (or vice versa),
    and how should that composition be documented? (FD-22)
12. What is the minimal probe subset worth running as a **standing regression matrix** after every permission-related
    change, and which probes can run model-free in CI? (FD-19)

## Suggested first session (concrete)

1. Enter a worktree; implement FD-01 (resolved-target deny for reads) with regression tests; update the
   `docs/threat-model.md` caveat.
2. Same session or next: FD-02 fixture tests for `edit_file` / `apply_patch` / hardlinks — evidence first, fix only if
   a write-through is observed.
3. Separately (small, independent): FD-06 denial reason codes, since several later probes want the taxonomy to exist
   for cleaner evidence.
4. Only after fixes land: schedule "Safari 3" as a short re-run of the affected probes (symlink ladder, timeout
   lifecycle, budget receipts) in a fresh disposable sandbox.

## What NOT to redo

- Don't re-prove Safari 1's flag-composition ladder — it passed everywhere; re-run only if permission code changes.
- Don't re-run the exact-value secret scans on the existing archives — manifests are in
  `docs/artifacts/permission-safari-2026-07-21/`.
- Don't treat the Codex/Claude Code outer-guardrail blocks as runner failures; they are documented context.

---

_Companion human-readable report: `docs/safari-future-directions-2026-07-22.html`._
