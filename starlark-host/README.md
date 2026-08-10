# Starlark Host (phased-hybrid control plane)

This subtree is the graduated `s1-starlark-phased-hybrid` prototype
(architecture-review recommendation R3 — see
`docs/2026-08-06-starlark-architecture-review.md` at the repo root). It tests
one narrow architecture:

```text
Claude planner -> generated Starlark -> validated job descriptors
       -> bounded Claude workers -> recorded results/failures
       -> Claude recovery planner -> validated retry descriptors
       -> final synthesis
```

It does not modify the bridge runner. The Starlark evaluator has no filesystem,
network, shell, model, or module-loading functions. The Node control plane owns
model selection, concurrency, timeouts, budgets, source documents, failures,
and artifact persistence.

It now includes two concrete workflows behind the same provider-neutral worker
contract:

- `repo_fanout` discovers at most six approved JavaScript files under
  `src/runner`, then assigns exactly one file to each independent worker job.
- `test_triage` runs one named, allowlisted test suite without a shell, converts
  its TAP failures into bounded virtual documents, and assigns one failure to
  each triage worker.

The symbolic workers (`repo_file_analyst` and `test_failure_triager`) do not
contain provider or model identifiers. The host resolves each symbolic name to
a provider adapter and model route. The current live adapter uses the local
Claude bridge, but the registry contract can accept additional adapters later.

## Safety gates

- Mock mode is the default and costs nothing.
- Live mode requires both `--mode live` and an explicit `--max-cost-usd`.
- The CLI refuses a cap above the configuration ceiling of `$10`.
- Generated Starlark cannot select a model or introduce unknown descriptor fields.
- The planner sees document metadata; workers receive only explicitly referenced documents.
- The experiment is read-only over the configured target repository.
- Test subprocesses use an executable allowlist, no shell, a confined working
  directory, an output ceiling, a timeout, and an environment with likely
  credentials removed.
- Every phase writes an append-only JSONL event ledger and atomic state checkpoint.
- Every selected input is copied into a permission-restricted local run artifact
  so a run can be inspected without relying on provider traces.
- Live scripts request `full` bridge traces by default. These contain prompts and
  source-code payloads, so treat them as sensitive local files.

## Local preflight

Run these commands in Terminal from this folder:

```bash
npm run preflight
npm run mock
```

Success means the Go evaluator builds, all Node tests pass, and mock mode creates
a completed run under `runs/` with deliberate failures and bounded retries.

## Workflow dry runs

These commands use deterministic mock workers and therefore cost `$0`:

```bash
npm run workflow:repo
npm run workflow:triage
npm run matrix:offline
```

The evaluation matrix is itself expanded by bounded Starlark and then validated
by the host. It has eight cases: two workflows, two control-model labels (Haiku
4.5 and Sonnet 5), two fault profiles, and one repetition. In offline mode the
model labels verify routing and record structure only; they do **not** measure
real differences between those models.

Workflow runs are written under `workflow-runs/`. Matrix descriptors, per-case
runs, incremental results, and the final summary are written under
`matrix-runs/`.

A live workflow remains opt-in and requires an explicit cost cap:

```bash
node bin/run-workflow.js \
  --workflow repo_fanout \
  --mode live \
  --planner-model claude-haiku-4-5 \
  --worker-model claude-sonnet-5 \
  --fault-profile none \
  --trace-level full \
  --max-cost-usd 1
```

The new eight-case matrix runner is deliberately offline-only in this slice.
That prevents a harmless dry-run command from silently becoming eight paid
multi-call agent runs.

## Live canary

The VS Code bridge must already be running on the intended Claude account.
This command varies the main planner while keeping workers on Sonnet 5:

```bash
node bin/run-experiment.js \
  --mode live \
  --axis planner \
  --model claude-fable-5 \
  --fault-profile mixed \
  --trace-level full \
  --max-cost-usd 10
```

Direct prototype calls write correlated bridge traces under
`~/.claude-local-bridge/traces/`. They do not create conventional
`~/.bridge-runner/traces/*.runner.jsonl` files because the prototype bypasses
the runner loop. A conventional runner invocation can record both layers with
`--trace-level full`.

To probe the smallest active Claude tier as the control-plane model while
retaining Sonnet 5 workers, use `--model claude-haiku-4-5`.

Use `--matrix` instead of `--model ...` only after reviewing the canary. The
worker-axis matrix fixes Fable 5 as planner and varies the worker model:

```bash
node bin/run-experiment.js \
  --mode live \
  --axis worker \
  --matrix \
  --fault-profile mixed \
  --max-cost-usd 10
```

The dollar figures are local estimates based on the playground catalog. They do
not prove which Anthropic subscription or promotional-credit bucket was charged.

## Repeated-trial evaluation (R4)

`bin/run-eval.js` repeats the canonical mixed-fault experiment N times per
planner model and scores every run from its durable record (state.json +
events.jsonl): first-pass validity, lint repairs, rejection classes,
retry correctness, artifacts, synthesis outcome, latency, per-run cost,
trace completeness. `npm run eval:mock` exercises the loop for free;
live runs require `--mode live --campaign <id> --max-cost-usd <cap>`.
Output lands under `eval-runs/` (gitignored run evidence). Results doc:
`docs/starlark-r4-planner-eval-2026-08-10.md` at the repo root.

## Durable campaign budgets (R1/R2)

Every live run meters its spend against a durable campaign ledger under
`~/.bridge-runner/campaigns/<campaignId>/budget.ledger.jsonl` — an append-only
JSONL file shared across separate commands and processes. A live run without
`--campaign` starts a fresh campaign and prints its id in the summary; pass
that id to later commands to draw from the same allowance:

```bash
node bin/run-workflow.js --workflow repo_fanout --mode live \
  --campaign campaign-2026-08-10-example --max-cost-usd 2 ...
node bin/run-workflow.js --workflow test_triage --mode live \
  --campaign campaign-2026-08-10-example --max-cost-usd 2 ...
```

Both commands above share ONE $2 cap: the second sees what the first spent.
Properties, tested in `test/campaign-budget.test.js`:

- Reserve/settle/release records are appended under a cross-process lock, so
  two concurrent commands cannot both pass the same ceiling check.
- A reservation left behind by a crashed process is released automatically,
  recorded as an explicit `stale_pid` correction — never rewritten away.
- The cap is fixed at campaign creation; rejoining with a different
  `--max-cost-usd` is an error. Start a new campaign to change budgets.
- Metering is in dollars and cache-aware: `cache_read_input_tokens` and
  `cache_creation_input_tokens` move the remaining balance (R2 regression).
- Mock runs stay in-memory and free; they do not create campaign ledgers.

## Plan hygiene and hostile-input hardening (R5/R6/R7)

- `src/descriptor-policy.js` is the single source of descriptor policy: the
  validator's allowed keys/bounds and the prompts' policy text both render
  from it, and `test/descriptor-policy.test.js` holds the field→enforcement
  concordance (every accepted field must be observable at its enforcement
  point — probed functionally, not assumed).
- `src/starlark-lint.js` pre-lints generated programs before the Go
  evaluator: adjacent string literals (the Python-ism seen live) are
  auto-repaired and recorded on the ledger; f-strings, `while`, imports,
  `load()`, exceptions, and classes come back as line-numbered diagnostics
  that guide the model's repair attempt without spending an evaluator round.
- `test/adversarial-starlark.test.js` keeps a hostile-program corpus aimed at
  the evaluator boundary (comprehension bombs, recursion, homoglyph entry
  points, descriptor smuggling, output floods). The evaluator harness now
  also caps evaluator stdout (default 4 MB) and fails closed.

## Synthesis strategies and synthesis-only resume (R10)

Synthesis is independently fallible AND independently retryable. The
coordinator's `auto` strategy uses one bounded call for small result sets and
switches to map-reduce (chunk summaries, then one combining call) when the
result set outgrows a single ceiling-bound response. A `partial` run whose
workers succeeded is healed WITHOUT re-running workers:

```bash
node bin/resume-synthesis.js \
  --run-dir workflow-runs/<the partial run> \
  --campaign <campaign id> --max-cost-usd 2 \
  --model claude-haiku-4-5 --strategy map_reduce --trace-level full
```

Resume events append to the same run ledger with continuing sequence
numbers; nothing is rewritten. Field-proven 2026-08-10: the fan-out canary
that truncated its monolithic synthesis was completed by the same model via
map-reduce for ~$0.015.
