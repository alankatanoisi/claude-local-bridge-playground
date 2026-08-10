# Starlark Phased-Hybrid Prototype

This scratch project tests one narrow architecture:

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
The cost cap applies to one process. When several commands belong to one campaign,
subtract prior estimated use from the next command's allowance; durable campaign
budgeting across separate invocations remains future work.
