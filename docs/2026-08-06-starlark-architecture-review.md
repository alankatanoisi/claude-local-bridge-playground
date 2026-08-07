# Starlark Control-Plane Architecture Review — Evaluation, Language Verdict, and 14 Recommendations

**Date:** 2026-08-06 (Pacific time)
**Author:** Fable (agent-facing companion to `docs/2026-08-06-starlark-architecture-review.html` — the HTML is the human-facing rich version; this file is optimized for agent pickup)
**Inputs read:** `docs/2026-08-06-starlark-phased-hybrid-live-results.md`, `docs/2026-08-06-starlark-workflow-expansion.md`, `docs/roadmap-direction-review-and-five-next-steps-2026-08-06.md`, `docs/ARCHITECTURE.md`, `docs/ai-orchestration-study-review-and-next-steps-2026-07-30.html`, `docs/diagrams/starlark-runtime-architecture.png`, plus `src/runner/**` module layout.
**Status:** Assessment memo. No source changes made. Every recommendation is scoped for a separately authorized chunk.

---

## 1. Executive verdict

**The architecture is sound and the Starlark choice is defensible-to-optimal — for the specific slot it occupies.** The critical design insight the team already made, and should now write down as doctrine, is this: **the Starlark layer is not CodeAct. It is code-as-plan, not code-as-action.** The generated program has *zero* capabilities — no filesystem, network, shell, model calls, or module loading. It can only construct inert job descriptors that a fail-closed host validator inspects. This sidesteps the exact collision the roadmap review flagged as N-5 (CodeAct bypasses every tool-argument-layer path control by construction). A Starlark plan cannot bypass path controls because it never touches paths — the host collector does, inside the existing confinement rules.

Three structural risks are visible and none is fatal:

1. **Two control planes now exist** (native runner `coordinator.js` stack vs. the Starlark host), duplicating scheduling, budgeting, ledgers, and retry policy — and the diagram honestly labels the edge between them "SEPARATE TODAY — no integration edge." Drift, not decision, is currently choosing the outcome.
2. **Budget authority is process-local** while the ambition (unattended matrices, multi-command campaigns) is cross-process. Both 08-06 docs flag this as the top gap; this review agrees and ranks it R1.
3. **The prototype lives outside Git**, which means the project's own hardest-won round-3 lesson — "machinery built, exported, unit-tested, never wired / never reviewed" (the F1/F2/F5 class, addressed by N-1 reachability doctrine) — cannot be enforced on it.

## 2. Architecture evaluation

### Strengths (keep; do not renegotiate)

| Property | Evidence |
| --- | --- |
| Authority inversion: model proposes, host disposes | Validator rejected out-of-policy Fable descriptors twice; fail-closed on unknown fields, model/provider fields, excessive limits |
| Capability-free generated code | Starlark receives no I/O, no module loads; step + wall-time ceilings tested |
| Symbolic worker registry as the provider seam | `repo_file_analyst` → host-owned route; provider+model combined only inside the registry |
| Evidence discipline | Append-only JSONL ledger, atomic state, bridge trace correlation with shared trace IDs, deliberately preserved failure evidence |
| Failure injection as first-class methodology | Four-fault deterministic profile; charged-but-discarded and permanent-gap cases both covered |
| Semantic success classification | `model_refusal`, `truncated_synthesis` distinguished from `completed`; HTTP 200 ≠ success institutionalized after a real field failure |

### Weaknesses / risks (ranked)

1. **No durable cross-process campaign budget** — the $10 gate was manually maintained across commands. Blocker for unattended use.
2. **Cost metering is token-shaped, not dollar-shaped** — mirrors runner A3-F4: cache read/creation tokens are returned by `release()`-equivalents but never counted against ceilings. The error grows with exactly the concurrency being pursued.
3. **Control-plane duplication with the runner** — `budget-broker.js`, `session-ledger.js`, `ledger-repair.js`, `worker-runtime.js` all have Starlark-host analogues being reinvented in scratch space.
4. **"Validated but not enforced" field class** — the `timeout_ms` disconnect (finding 6) was fixed as an instance; nothing prevents the class. Same shape as N-1.
5. **Prompt-policy vs validator drift** — finding 1 showed policy must be both disclosed and enforced; today the disclosure (prompt text) and enforcement (validator) are separately maintained artifacts.
6. **Synthesis is the most fragile stage** — one refusal + three truncations across the live sequence; currently a single monolithic call at the end of an otherwise resumable pipeline.
7. **Single-trial evidence** — the model comparison table is explicitly not statistically meaningful; no scoring rubric yet.
8. **Provider-neutrality is structural, not proven** — one live adapter (local Claude bridge); no second-adapter contract test.

## 3. Was Starlark optimal? (vs. Python, Java, Go, Rust, and the alternatives that matter more)

Frame the question correctly first: there are **two language slots**, and the named alternatives mostly belong to the other slot.

- **Slot A — the language the model generates** (the control-plane plan program). Candidates: Starlark, sandboxed Python, Lua, pure JSON/YAML data, CUE/Dhall, sandboxed JS/WASM.
- **Slot B — the evaluator/host implementation language.** Candidates: Go, Rust, Java, Node. The prototype already answers this: Node host + `starlark-go` evaluator. Go is not a competitor to Starlark here; it is Starlark's most mature runtime (the canonical implementation). Java (Bazel's original) and `starlark-rust` (Meta) are viable substitutes with no compelling reason to switch.

### Slot A comparison

| Dimension | Starlark | Sandboxed Python | Lua | Pure JSON/YAML | CUE / Dhall | JS-in-isolate / WASM |
| --- | --- | --- | --- | --- | --- | --- |
| Hermetic by **construction** (not configuration) | **Yes** | No — sandboxing is negative-space work, historical escapes | Partial — must strip stdlib | Yes (no compute at all) | Yes | No — sandbox is configuration |
| Guaranteed termination | **Yes** (no `while`, no recursion by default) | No | No | Trivially | Yes (Dhall total) | No |
| Deterministic evaluation | **Yes** (specified goal) | No | No | Yes | Yes | Achievable with effort |
| LLM generation fluency | **High** (Python-shaped; one syntax gap found: no implicit string concat) | Highest | Medium | High but verbose | Low — thin training corpus → more repair loops | High |
| Bounded compute (loops, comprehensions, Cartesian expansion) | **Yes** — the matrix expansion is the payoff | Yes | Yes | **No** — loses the entire point | Yes | Yes |
| Mature restricted evaluator available | **Yes** (starlark-go, starlark-rust, Java) | Weak (every option is a compromise) | Good (but see stdlib stripping) | n/a | Good | Good |
| Live field evidence in this project | 5 models produced valid plans within 2 attempts; **Haiku 4.5 first-pass** | — | — | — | — | — |

**Verdict:** Starlark occupies a rare point in the design space — the only listed option that is simultaneously hermetic *by construction*, terminating *by construction*, deterministic, and close enough to Python that even the smallest active Claude tier generates it correctly first-pass. Python/Java/Go/Rust are all wrong for Slot A precisely because the requirement is a language that **cannot do anything**: general-purpose languages make you build the "cannot" yourself, forever. The only real competitors are pure JSON (choose it when a workflow needs no expansion — see R14's cheap-path note) and CUE/Dhall (better formal guarantees, materially worse LLM fluency, i.e. a higher repair tax). **Conclusion: keep Starlark. The decision was correct on the evidence, not just on taste.** Caveats: keep descriptors (never capabilities) as the only output; keep the Go subprocess as an isolation boundary rather than resenting it as ops cost; pair with deterministic linting (R6).

## 4. Fourteen recommendations

Priorities: **P0** = blocks unattended/paid scaling; **P1** = do before widening the matrix; **P2** = strengthens the platform; **P3** = opportunistic.

| # | P | Recommendation | Essence |
| --- | --- | --- | --- |
| R1 | P0 | **Durable atomic campaign budget ledger** | One append-only budget ledger keyed by campaign ID, atomic reserve/settle records, shared across processes and commands. Reuse `session-ledger.js` patterns (sequence numbers, cursor sidecar, atomic state) rather than inventing a second scheme. The manual "reduce the allowance after each command" step must die before any unattended matrix. |
| R2 | P0 | **Meter dollars, not tokens** | Bind campaign ceilings to `estimateCostUsd`-style accounting including cache-read/creation rates; keep token caps as a secondary dimension. This is the Starlark-host twin of runner N-3/A3-F4 — fix both with the same design so the two planes don't diverge on the meaning of "budget." Regression test: a cache-heavy reconciliation must move remaining budget. |
| R3 | P1 | **Bring the prototype under version control** | Graduate `s1-starlark-phased-hybrid` from `~/Developer/orchestration-prototypes/` into Git (playground subtree or sibling repo). Out-of-git code is exempt from review, CI, and the N-1 reachability doctrine — the exact conditions that produced the F1/F2/F5 defect class. Keep only scratch spikes outside Git. |
| R4 | P1 | **Repeated-trial scoring harness before widening** | Implement the live-results doc's own next-experiment: ≥5 repetitions per control model, fixed fixtures, deterministic rubric (first-pass validity, repair success, forbidden-authority attempts, retry correctness, artifact count, synthesis state, latency, cost, trace completeness). Extend `golden-eval.js` / `evals/harbor/` rather than building a third harness (N-2's instruction). Single trials must stop being quoted as rankings. |
| R5 | P1 | **Single-source the descriptor policy + field→enforcement concordance test** | One machine-readable schema/limits file generates BOTH the validator's rules and the prompt's policy-disclosure section (kills the finding-1 drift class). Then a concordance test asserts every field the validator accepts has a bound enforcement point (kills the finding-6 `timeout_ms` class — "validated but not enforced" becomes a CI failure, not a field discovery). |
| R6 | P1 | **Deterministic Starlark pre-lint for LLM Python-isms** | Before evaluation, run a cheap static pass catching known model failure modes: adjacent string literals (found live, twice), f-strings, `while`, recursion, chained ternaries, set literals. Auto-repair the mechanical ones; return precise diagnostics for the rest so the model's repair attempt is guided. Measure "repair tax" per model as a harness metric (R4). |
| R7 | P1 | **Adversarial-program corpus for the evaluator** | The live tests exercised honest-but-fallible planners. Add a hostile corpus: comprehension bombs (billion-laughs via cross products), deep nesting, huge string/list allocation, step-ceiling probes, unicode identifier tricks, descriptor smuggling (fields that alias authority fields), oversized descriptor counts. Assert ceilings + fail-closed behavior under all of them. This is the Safari discipline applied to the new surface. |
| R8 | P2 | **Decide the runner integration edge deliberately** | The diagram says "SEPARATE TODAY — no integration edge." Make that a decision, not drift. Recommended shape: expose validated workflows to the native runner as a capability-gated tool (e.g. `run_workflow`) that routes through the runner's permission gate + workspace trust, while the Starlark host keeps its own validator. Explicitly reject the alternative (porting the runner's coordinator into the Starlark host) to stop duplicate control-plane growth. |
| R9 | P2 | **Prove provider-neutrality with a second adapter + contract test** | Cheapest honest second adapter is a deterministic one (regex/static analyzer serving `repo_file_analyst`'s contract) — zero cost, full contract coverage; a Gemini adapter can follow. Until then, say "provider-neutral structure," never "provider-neutral," in docs — the workflow-expansion doc already models this discipline; keep it. |
| R10 | P2 | **Terminal-state machine + synthesis-only resume; map-reduce synthesis** | Formalize campaign terminal states (`completed`, `partial:model_refusal`, `partial:truncated_synthesis`, `failed:*`) as an enum with defined transitions. Because worker artifacts are durable, synthesis should be retryable *alone* — never re-run workers to retry a synthesis. For truncation: chunked map-reduce synthesis (per-artifact compression, then combine) instead of one monolithic ceiling-bound call. Synthesis stays independently fallible, but its failures become cheap. |
| R11 | P2 | **Campaign resume + cancellation tests** | Port the A1/F6 discipline: kill a live campaign mid-flight, resume from ledger, assert completed jobs are not re-run and the interrupted job is at-least-once with intent/result pairing. Test cancellation propagation to in-flight worker calls (abort signal is now wired; prove it under concurrency). |
| R12 | P2 | **Unify evidence layout + end-to-end trace joins** | Adopt the `~/.bridge-runner` unified transcript/index conventions for campaign artifacts instead of a second parallel scheme (this is a recorded workspace fact/preference). Ensure a single campaign ID joins: budget ledger ↔ campaign ledger ↔ worker artifacts ↔ runner traces ↔ bridge traces. The 5-event bridge trace correlation already works; extend the join upward. |
| R13 | P3 | **Cost-tiered planner routing with escalation** | The data says Haiku 4.5 passed both plans first-attempt at the lowest cost. Make routing policy explicit: plan with the cheapest tier; escalate one tier only on validation failure after the lint pass (R6). Evidence-driven, revisit after R4's repeated trials — do not hardcode reputation. |
| R14 | P3 | **Exploit determinism: golden plans, program hashing, and a JSON cheap path** | Starlark's determinism means identical inputs → identical descriptors. (a) Golden-plan tests: snapshot expected descriptor sets per fixture; planner-prompt changes show up as reviewable diffs. (b) Hash the generated program + inputs to cache expansion and to detect "same plan, different program" drift across models. (c) For workflows needing no expansion (fixed small job lists), skip Starlark entirely and accept a plain JSON descriptor list through the same validator — reserve the program layer for where it pays (matrix/Cartesian/fan-out expansion). |

## 5. Suggested sequence

| Order | Items | Paid? | Rationale |
| --- | --- | --- | --- |
| 1 | R1 + R2 | No | Budget correctness before any further live spend; twin fix with runner N-3 |
| 2 | R3 + R5 | No | Get the code reviewable, then make policy drift and dead fields impossible |
| 3 | R6 + R7 | No | Cheapen the repair loop; harden the evaluator against hostile programs |
| 4 | R4 | Yes, ceilinged | Repeated trials with honest ceilings (post-R2) and rubric scoring |
| 5 | R9 + R10 + R11 | Mostly no | Contract proof + resumable terminal states + kill tests |
| 6 | R8, R12 | No | Integration decision + evidence unification once the host is stable |
| 7 | R13, R14 | No/low | Optimization passes informed by R4 data |

R1–R3 and R5–R7 are independent and parallelizable across sessions.

## 6. Boundaries

- No source changes were made in this review; playground working tree untouched apart from this file and its HTML twin.
- Prototype code itself was not readable from this repo (it lives outside Git — which is itself finding R3); prototype claims are taken from the three dated 08-06 docs and the architecture diagram.
- Cost figures quoted are the docs' local-catalogue estimates, not billing statements.
- Ledger privacy rule inherited: aggregate counts only; no payload quoting.
