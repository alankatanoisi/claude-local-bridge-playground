# Handoff — Starlark thread status and recommendations (2026-08-25)

> **R8 DECIDED 2026-08-31 (Alan): freeze as a lab.** `starlark-host/` stays a separate
> experiment with its own CLI; no `run_workflow` runner edge, no Starlark code in
> `src/runner/**`. §5 R1's "recommended default" is now the owner decision. Consequences
> per this handoff: R11 (kill/resume tests) becomes the natural next in-lab build if the
> lab resumes; R6-deferred items stay deferred; do not port the runner coordinator into
> the host. Findings text below preserved unchanged.

**Written:** 2026-08-25. Status pass + test run; no Starlark source changed.
**Audience:** the next coding agent on the Starlark (phased-hybrid control plane) thread.
**Does not supersede** the bundle write-ups. Those remain the implementation record:

| Record                                                                                    | What it still owns                                       |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `docs/2026-08-06-starlark-architecture-review.md`                                         | Original R1–R14 recommendations and the language verdict |
| `HANDOFF-bundle-a-starlark-2026-08-10.md`                                                 | R3 subtree + R1/R2 campaign budget                       |
| `HANDOFF-bundle-b-starlark-2026-08-10.md`                                                 | R5/R6/R7/R10                                             |
| `HANDOFF-bundle-c-starlark-2026-08-10.md` + `docs/starlark-r4-planner-eval-2026-08-10.md` | R4 planner-axis live eval                                |
| `HANDOFF-bundle-d-starlark-2026-08-10.md` + `docs/starlark-r4-worker-eval-2026-08-10.md`  | R13/R9/R14c + worker-axis live eval                      |

This file is the current **shape + what to do next**. Last Starlark _code_ commit is
`4c6904a` (2026-08-11, D-F1). The thread has been idle while ACP shipped.

---

## START HERE

1. Read `docs/working-with-alan.md`, then `docs/agent-user-autonomy-boundary-2026-08-11.md`.
2. Preflight from `AGENTS.md`. Expected: playground clone, branch `main`, origin
   `alankatanoisi/claude-local-bridge-playground`.
3. Do **not** treat this as a build-from-zero thread. Bundles A–D plus D-F1 and the
   1200-char worker ceiling are committed. Uncommitted `.cursor/hooks/state/continual-learning.json`
   is Cursor local state — leave it alone.
4. Live spend needs Alan’s explicit ceiling. Do not start a live eval because a leftover
   campaign id exists in a handoff. This machine currently has **no**
   `~/.bridge-runner/campaigns/` directory; treat 08-10 dollar figures as historical
   record, not a live remaining balance.
5. The Go evaluator binary is gitignored (`starlark-host/bin/starlark-eval`). This
   2026-08-25 pass found **Go not installed** here, so `npm --prefix starlark-host run verify`
   cannot build it. Node tests that skip when the binary is missing are fine; tests that
   spawn it without skipping **fail**. That is an environment gap, not a host regression.
6. Do not quote `~/.bridge-runner` or `starlark-host/{runs,workflow-runs,eval-runs}` ledger
   payload text; aggregates only.

---

## 1. What this lab is

`starlark-host/` is a **bounded experiment**, not the bridge runner. Doctrine (do not
renegotiate): **Starlark is code-as-plan, not code-as-action.** The generated program has
zero capabilities — no filesystem, network, shell, model calls, or module loading. It only
builds inert job descriptors. The Node host validates them, picks models, meters dollars,
runs workers, and writes artifacts.

```text
Claude planner → generated Starlark (or host JSON) → validateJobs()
    → bounded workers (bridge adapter OR deterministic adapter)
    → recorded results/failures
    → recovery planner (or host-JSON recovery)
    → synthesis (single / map-reduce / auto)
```

Two concrete workflows share one provider-neutral worker contract:

- `repo_fanout` — at most six approved `.js` files under `src/runner`, one file per job
- `test_triage` — one allowlisted test suite, no shell; one failure per triage job

Entry points: `starlark-host/bin/run-experiment.js`, `run-workflow.js`, `run-eval.js`,
`run-matrix.js` (offline-only by design), `resume-synthesis.js`.

The host **does not** go through `src/runner/run.js`. Direct bridge calls write traces
under `~/.claude-local-bridge/traces/`, not conventional runner transcripts.

---

## 2. R1–R14 scorecard (as of 2026-08-25)

| #    | P   | Item                                                               | Status                                                                                                                                                                                                                          |
| ---- | --- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1   | P0  | Durable cross-process campaign budget                              | **Done** (`campaign-budget.js`, live-proven 08-10)                                                                                                                                                                              |
| R2   | P0  | Meter dollars, cache-aware                                         | **Done** in code + regression test. Live 08-10 canaries carried **zero** cache tokens (host does not send `cache_control`)                                                                                                      |
| R3   | P1  | Prototype under git                                                | **Done** (`starlark-host/`)                                                                                                                                                                                                     |
| R4   | P1  | Repeated-trial scoring harness                                     | **Done** — planner axis 25 live trials; worker axis 20 scored trials (11 401 casualties re-run)                                                                                                                                 |
| R5   | P1  | Single-source descriptor policy + concordance                      | **Done**                                                                                                                                                                                                                        |
| R6   | P1  | Starlark pre-lint + auto-repair                                    | **Done** (adjacent-string `+` only)                                                                                                                                                                                             |
| R7   | P1  | Adversarial evaluator corpus + stdout ceiling                      | **Done** (tests skip if evaluator binary missing)                                                                                                                                                                               |
| R8   | P2  | Runner integration edge                                            | **Open decision.** See §5 R1                                                                                                                                                                                                    |
| R9   | P2  | Second worker adapter + contract test                              | **Done** (`deterministic-analyst.js`, $0, byte-reproducible)                                                                                                                                                                    |
| R10  | P2  | Map-reduce synthesis + synthesis-only resume                       | **Done**, live-healed Bundle A’s truncated fan-out for ~$0.015                                                                                                                                                                  |
| R11  | P2  | Campaign kill / mid-flight resume / cancel-under-concurrency tests | **Unbuilt.** Resume today is synthesis-only. No campaign-level abort token                                                                                                                                                      |
| R12  | P2  | Unify evidence layout + end-to-end trace joins                     | **Open.** Campaigns _intended_ under `~/.bridge-runner/campaigns/`; run artifacts still under gitignored `starlark-host/{runs,workflow-runs,matrix-runs,eval-runs}/`. This machine has neither campaigns dir nor those run dirs |
| R13  | P3  | Cost-tiered planner ladder                                         | **Done** (`--planner-ladder` on `run-workflow` only — deliberately not on `run-eval`, so comparisons stay clean)                                                                                                                |
| R14a | P3  | Golden-plan snapshots                                              | **Unbuilt**                                                                                                                                                                                                                     |
| R14b | P3  | Program + input hashing                                            | **Unbuilt**                                                                                                                                                                                                                     |
| R14c | P3  | JSON cheap path                                                    | **Done** (`json-plan.js`, `--plan-source host_json`, same `validateJobs` gate)                                                                                                                                                  |

Post-eval follow-ups from the worker-axis doc:

| ID   | Item                                                 | Status                                                                                                                                                                                       |
| ---- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-F1 | Feed host validation error into worker retries       | **Closed** `4c6904a` (2026-08-11). Feedback is host-authored on the retry prompt, not relayed through the recovery planner                                                                   |
| D-F2 | Revisit the 700-char summary cliff                   | **Partially closed.** Owner decision: ceiling **700 → 1200**, single-sourced in `worker-contract.js`, pinned by a decision test. The contract is still a character cliff, not a token budget |
| D-F3 | Worker-side pre-check (truncate/split before reject) | **Unbuilt.** Do not silently truncate unless Alan chooses that over “reject and explain”                                                                                                     |

**Comparability caveat (do not bury):** the 08-10 two-axis tables describe the **old**
contract (700-char ceiling, blind worker retries). D-F1 + 1200 change retry semantics.
A new campaign would be required to measure the combined effect. Do not quote 15/15
Sonnet / 0/15 Opus 5 as current-contract rankings.

Historical campaign `campaign-2026-08-10-r4-planner`: handoffs recorded **$16.2642
settled of $20**. That ledger is **not present** on this machine today.

---

## 3. What this 2026-08-25 pass actually ran

Preflight: playground `main`, origin `alankatanoisi/claude-local-bridge-playground`,
fast-forwarded through `e8f9297` (ACP/charter work; no Starlark files in that range).

```text
npm --prefix starlark-host run verify
  → fail: `go: command not found` (cannot build bin/starlark-eval)

npm --prefix starlark-host test
  → 90 tests: 66 pass / 15 fail / 9 skip
  → all 15 fails are spawn ENOENT on starlark-eval (or an assertion that the
     pipeline `completed`, which requires that binary)
  → the 9 skips are the R7 corpus, which already guards on a missing binary
```

Last code commit touching `starlark-host/`: `4c6904a` (2026-08-11). Test count grew
84 → 90 after D-F1 + worker-contract concordance.

Local evidence dirs `starlark-host/{runs,workflow-runs,matrix-runs,eval-runs}`: **absent**.
`~/.bridge-runner/campaigns/`: **absent**. `~/.bridge-runner` itself exists (sessions,
traces, logs from earlier runner work).

Honest implication: this pass confirms the _tree_ and the _Node-side_ tests. It does
**not** re-prove the Go evaluator, live workflows, or campaign accounting on this
machine.

---

## 4. Drift worth not re-deriving

- **Two control planes still exist.** The 08-06 review warned that drift, not decision,
  would grow a second host. Bundles A–D then _did_ give `starlark-host` its own budgets,
  run ledgers, eval harness, and synthesis resume. The runner still has
  `coordinator.js` / `budget-broker.js` / `session-ledger.js`. There is still **no**
  `run_workflow` tool in `src/runner/**`.
- The 08-10 runner-architecture review recommended the opposite growth direction:
  native coordinator as campaign host, Starlark as a capability-free plan compiler,
  _do not_ port budgets into the Starlark host. That ship has sailed for the lab.
  R8 is now “freeze vs wire one edge,” not “where should budgets live.”
- README canary and `experiment.config.json` `fixedPlannerModel` still default the
  **planner** to Fable 5. The two-axis conclusion was **plan with Haiku 4.5, work with
  Sonnet 5**. Defaults did not catch up.
- `json-plan.js` recovery tasks still append “return strict JSON only.” D-F1 still
  fires because `retry_of` + `priorFailures` land in `buildWorkerPrompt`. The stale
  sentence is leftover wording, not a bypass.
- The 8-case `run-matrix.js` path remains **offline-only** by design.
- Open operational residual from the worker-axis eval: a bridge HTTP 401 window killed
  11 trials and cleared on restart. Never root-caused. Shape (sudden, every later call,
  $0) looks like a credential-refresh gap. Do not “investigate the bridge” unless Alan
  asks — that is a boundary exception.

---

## 5. Recommendations (do in this order)

### R1 — Decide the integration edge before writing more host features

Alan owns this. Two coherent answers; an undecided third month of host growth is the
failure mode the 08-06 review named.

- **Freeze as a lab (recommended default).** `starlark-host/` stays a separate
  experiment with its own CLI. Pros: matches how it was actually built; no collision
  with the just-landed ACP surface; keeps Starlark’s “cannot do anything” slot clean.
  Cons: two ledgers, two budget stories, two resume stories forever.
- **One runner edge (`run_workflow`).** A capability-gated runner tool that calls the
  existing host validator, going through workspace trust + the permission gate. Pros:
  T3/ACP could invoke a workflow; one user-facing agent. Cons: young ACP + young host
  in the same process; easy to accidentally widen Starlark into CodeAct; touches
  `src/runner/**`.

Do **not** port the runner coordinator into the Starlark host. Do **not** start a
Gemini adapter, a third workflow, or a live 8-case matrix until this fork is explicit.

### R2 — If the lab stays separate: close R11 next (Codex-shaped, free)

R10 resume is synthesis-only. A killed _worker phase_ cannot be resumed without
re-running completed jobs — the exact A1/F6 gap the review copied here as R11.

Scope: abort token on in-flight bridge worker calls; resume from the run ledger;
assert completed jobs are not re-run; at-least-once pairing on the interrupted job;
a concurrency kill test. Stay in `starlark-host/**` + tests. Reuse the runner’s
Slice D cancel lessons (`shouldCancel`, destroy-then-ignore callbacks) without
copying ACP.

Skip R11 only if Alan chooses freeze-and-archive (no further unattended live runs).

### R3 — Cheap honesty: R14a golden plans (free)

Host JSON (R14c) plus the deterministic worker (R9) already give a $0 path _if_
planning skips Starlark. Snapshot expected descriptor lists per fixture so planner
prompt edits show up as reviewable diffs. Natural companion: make the “full pipeline
at $0” adapter test use `--plan-source host_json` so it does not require Go.

R14b (program hashing) can wait until golden plans exist to hash against.

### R4 — Paid measurement, only if Alan wants a new ranking

Worker-axis re-run under the **current** contract (1200-char ceiling + D-F1 feedback).
Fresh campaign id, fresh ceiling (the 08-10 remainder is not on this machine and
would be the wrong contract anyway). Previous worker-axis scored ~$9.78 for 5×5;
a directional ~$5 slice (e.g. Sonnet + Opus 5 + Haiku, 3–5 reps) would test whether
Opus 5’s 0/15 was the cliff or the blind retry.

Do not widen to new workflows or an 8-case live matrix on the same campaign.

### R5 — Small residuals, only after R1

- Install Go on this machine (or document the required version) so `npm run verify`
  is real; make coordinator/workflow tests **skip** like the R7 corpus when the
  binary is missing, instead of failing ENOENT.
- Align README / `fixedPlannerModel` with “plan Haiku, work Sonnet” _or_ leave them
  as historical canary defaults and say so in one sentence.
- Per-run spend delta in live summaries (Bundle A noted campaign-cumulative
  `estimatedCostUsd` is easy to misread).
- D-F3: do **not** auto-truncate worker summaries. If anything, a lint-style
  diagnostic that names the overshoot without inventing content.

### R6 — Defer

- First-class T3/ACP `run_workflow` (depends on R1 = wire-an-edge).
- Full R12 evidence unification into `~/.bridge-runner` (do it as part of R11
  resume work if at all; do not invent a third layout).
- Gemini / third live adapter (R9 already proved the seam with a deterministic one).
- `**`-operator auto-repair in the Starlark linter (starlark-go rejects at parse;
  wait for R4-style data that it pays).
- Raising or lowering the 1200-char ceiling again without a new eval.

---

## 6. Standing constraints

- No commits or pushes unless Alan asks.
- Do not modify `src/credentials.js` / `src/proxy.js` / `src/server.js` / interceptors
  unless required to keep transport working.
- Starlark work stays in `starlark-host/**` plus dated docs/handoffs, unless Alan
  explicitly chooses the `run_workflow` edge.
- Mock mode is the default. Live mode needs `--mode live` **and** `--max-cost-usd`.
  Config ceiling is $20 (`maxExperimentCostUsd`); do not raise it silently.
- Do not restore `--agent` / `--profile`.
- Codex playground stays paused unless Alan asks to cross-apply.

---

## 7. Suggested prompts for the next session

If Alan wants the architecture fork named:

> Read `HANDOFF-starlark-status-and-recommendations-2026-08-25.md`. I am deciding R8.
> Recommend freeze-as-lab vs a capability-gated `run_workflow` in the runner, with
> pros/cons against the fact that ACP just landed. Do not implement either until I pick.

If Alan wants keep-building inside the lab after freeze:

> Close R11 in `starlark-host/` (kill/resume/cancel tests). Follow the 08-25 handoff
> §5 R2 scope. Do not touch the runner. Do not spend live money.

If Alan wants a new ranking:

> Re-run the worker axis under the current 1200-char + D-F1 contract on a fresh
> campaign. Confirm the dollar cap with me before the first live call.
