'use strict';

/**
 * Top-level coordinator — phased orchestration above AgentKernel.
 */

const { runKernel } = require('./kernel/agent-kernel');
const { STOP_REASONS } = require('./kernel/contract');
const { createEventBus } = require('./event-bus');
const { WorkerRuntime } = require('./worker-runtime');
const { SessionStore, resolveSessionPath, makeSessionId, sessionPathFor } = require('./session-store');
const { compileSpec } = require('./coordinator-spec-compiler');
const { createBudgetBroker } = require('./budget-broker');

const PHASES = Object.freeze(['research', 'synthesize', 'execute', 'verify']);

// Read-only tool set shared by the research and verify workers. Previously
// duplicated inline at both spawn sites.
const RESEARCH_TOOLS = Object.freeze(['list_files', 'read_file', 'search_text', 'glob', 'git_status', 'manage_tasks']);

/**
 * D1: Group a phasePlan by dependency-free batches using Kahn-style topological
 * sort. Returns an array of batches (arrays of node ids); each batch can run
 * concurrently because every node in it has all its dependencies resolved by
 * earlier batches.
 *
 * Throws if the graph has a cycle or references a missing dep — fail loud so
 * malformed specs don't silently serialize.
 */
function groupPhasePlanByDeps(phasePlan) {
  if (!Array.isArray(phasePlan) || phasePlan.length === 0) return [];
  const byId = new Map();
  for (const p of phasePlan) {
    if (!p || !p.id) throw new Error('phasePlan node missing id');
    if (byId.has(p.id)) throw new Error('phasePlan duplicate id: ' + p.id);
    byId.set(p.id, { id: p.id, deps: Array.isArray(p.deps) ? p.deps.slice() : [], _remaining: 0 });
  }
  for (const node of byId.values()) {
    for (const d of node.deps) {
      if (!byId.has(d)) throw new Error('phasePlan missing dep: ' + d + ' (required by ' + node.id + ')');
    }
    node._remaining = node.deps.length;
  }
  const batches = [];
  const done = new Set();
  while (done.size < byId.size) {
    const ready = [];
    for (const node of byId.values()) {
      if (done.has(node.id)) continue;
      if (node._remaining === 0) ready.push(node.id);
    }
    if (ready.length === 0) throw new Error('phasePlan cycle detected; remaining: ' + (byId.size - done.size));
    batches.push(ready);
    for (const id of ready) done.add(id);
    for (const node of byId.values()) {
      if (done.has(node.id)) continue;
      node._remaining = node.deps.filter((d) => !done.has(d)).length;
    }
  }
  return batches;
}

/**
 * Run a phasePlan via groupPhasePlanByDeps; each batch runs concurrently via
 * Promise.all. `runFn(id)` is awaited for every node in a batch before
 * moving to the next batch.
 */
async function runPhasePlan(phasePlan, runFn) {
  const batches = groupPhasePlanByDeps(phasePlan);
  const results = new Map();
  for (const batch of batches) {
    const batchResults = await Promise.all(batch.map((id) => Promise.resolve().then(() => runFn(id))));
    for (let i = 0; i < batch.length; i++) results.set(batch[i], batchResults[i]);
  }
  return results;
}

/**
 * How big a slice of the unleased remainder a single child should request.
 *
 * This matters only for concurrent spawns. `broker.acquire(usage)` with no
 * request claims the WHOLE unleased remainder, which is right when children run
 * one at a time (see tools/spawn-agent.js) but wrong for a fan-out: the first
 * child would take everything and its siblings would be refused. Dividing by
 * the batch size gives every concurrent sibling a usable, reserved slice.
 *
 * Returns {} when uncapped or when there is nothing to divide, which makes
 * acquire() behave exactly as it does today.
 */
function computeLeaseRequest(broker, totalUsage, divisor) {
  if (!broker || !divisor || divisor <= 1) return {};
  const rem = broker.unleasedRemaining(totalUsage);
  const request = {};
  if (typeof rem.input_tokens === 'number') request.input_tokens = Math.floor(rem.input_tokens / divisor);
  if (typeof rem.output_tokens === 'number') request.output_tokens = Math.floor(rem.output_tokens / divisor);
  return request;
}

/**
 * Map each phasePlan node id to the size of the batch it runs in, so a
 * concurrent sibling knows how many ways the remainder must be split.
 */
function batchSizeById(phasePlan) {
  const sizes = new Map();
  for (const batch of groupPhasePlanByDeps(phasePlan)) {
    for (const id of batch) sizes.set(id, batch.length);
  }
  return sizes;
}

/** Shape returned in place of a worker result when the budget refuses a spawn. */
function refusedWorkerResult(phase, reason) {
  return {
    workerId: null,
    state: 'refused',
    phase,
    finalText: '',
    summary: 'refused: ' + reason,
    claims: [],
    evidencePaths: [],
    confidence: 'low',
    exitCode: 1,
    stderr: '',
    events: [],
    usage: null,
    stopReason: 'budget_refused',
    duration_ms: 0,
    leaseId: null,
    refused: true,
  };
}

class Coordinator {
  constructor(options = {}) {
    this.eventBus = options.eventBus || createEventBus({ emitStdout: options.streamEvents });
    this.workers = options.workerRuntime || new WorkerRuntime(options.workerOptions);
    this.sessionBaseDir =
      options.sessionBaseDir || require('path').join(process.env.HOME || process.cwd(), '.bridge-runner', 'sessions');
  }

  /**
   * Spawn a worker against a budget lease instead of a copied ceiling.
   *
   * Before this existed the coordinator passed `inherit.maxCostUsd` (a copy of
   * the parent ceiling) to every child and never touched the broker, so N
   * concurrent children could each spend up to the full ceiling. Leasing
   * reserves a slice up front and reconciles the child's real usage on return,
   * which is the invariant budget-broker.js was written to hold:
   * sum(active leases) + totalUsage never exceeds the caps.
   *
   * Mirrors the proven pattern in tools/spawn-agent.js (acquire → spawn →
   * release/reconcile) rather than inventing a second scheme.
   */
  async _spawnLeasedWorker(spec, options, budget) {
    const { broker, totalUsage, divisor } = budget || {};
    const phase = spec.phase || 'research';

    let lease = null;
    if (broker) {
      lease = broker.acquire(totalUsage, computeLeaseRequest(broker, totalUsage, divisor));
      // Refuse loudly. Running unbudgeted would defeat the ceiling entirely.
      if (!lease) return refusedWorkerResult(phase, 'no unleased budget remainder for this worker');
    }

    const budgetRemaining =
      lease && !lease.unconstrained ? { input_tokens: lease.input_tokens, output_tokens: lease.output_tokens } : null;

    let result;
    try {
      result = await this.workers.spawnWorker({ ...spec, budgetRemaining, leaseId: lease && lease.leaseId }, options);
    } catch (err) {
      // Release with no usage so the child is recorded as incomplete rather
      // than silently holding a reservation for the rest of the run.
      if (broker && lease) broker.release(lease.leaseId, null);
      throw err;
    }

    if (broker && lease) {
      const released = broker.release(lease.leaseId, result.usage || null);
      if (released && released.reconciled && released.usage) {
        totalUsage.input_tokens += released.usage.input_tokens || 0;
        totalUsage.output_tokens += released.usage.output_tokens || 0;
      }
    }
    result.leaseId = (lease && lease.leaseId) || null;
    return result;
  }

  async run(input) {
    const phases = input.phases || ['research', 'synthesize', 'execute'];
    const sessionId = input.sessionId || makeSessionId();
    const sessionPath =
      resolveSessionPath({ sessionId, sessionPath: input.sessionPath }) ||
      sessionPathFor(this.sessionBaseDir, sessionId);
    const store = new SessionStore(sessionPath);
    store.load();
    store.updateMetadata({ cwd: input.cwd, model: input.model, objective: input.objective });

    const startedAt = Date.now();
    const artifacts = { sessionPath, sessionId, workerResults: [], synthesis: null, structured: null };

    // Budget leases for child workers. Caps of null/undefined mean "no ceiling
    // on this dimension" and leasing becomes a no-op, so the uncapped path
    // behaves exactly as it did before leases existed.
    const broker = createBudgetBroker({
      inputCap: input.budgetInputTokens,
      outputCap: input.budgetOutputTokens,
    });
    const totalUsage = { input_tokens: 0, output_tokens: 0 };
    const budgetOf = (divisor) => ({ broker, totalUsage, divisor });

    // Options shared by every worker spawn in this run.
    const workerOptions = {
      callerToken: input.callerToken || null,
      parentCeiling: input.parentCeiling || null,
    };
    const inheritFor = (overrides = {}) => ({
      model: input.model || null,
      effort: input.effort || null,
      thinking: input.thinking || null,
      bridgeUrl: input.bridgeUrl || null,
      noNetwork: !!input.noNetwork,
      maxWallClockMs: input.maxWallClockMs || null,
      maxCostUsd: input.maxCostUsd || null,
      // A3-F2: pass the coordinator --max-tokens ceiling to workers (plan nodes
      // may override per-node via node.maxTokens below).
      maxTokens:
        typeof overrides.maxTokens === 'number'
          ? overrides.maxTokens
          : typeof input.maxTokens === 'number'
            ? input.maxTokens
            : null,
      traceLevel: input.traceLevel || null,
      parentRunId: sessionId,
      hasCallerToken: !!input.callerToken,
    });

    this.eventBus.emit('system', {
      subtype: 'coordinator_init',
      sessionId,
      phases,
      cwd: input.cwd,
    });

    if (phases.includes('research')) {
      this.eventBus.emit('phase', { phase: 'research', status: 'started' });
      if (input.useWorkers !== false) {
        const plan = Array.isArray(input.researchPlan) && input.researchPlan.length ? input.researchPlan : null;

        if (plan) {
          // D1 wired: dependency-free nodes now actually run concurrently through
          // runPhasePlan. Before this, runPhasePlan/groupPhasePlanByDeps existed
          // and were unit-tested but nothing in the run path ever called them.
          const nodesById = new Map(plan.map((n) => [n.id, n]));
          const sizes = batchSizeById(plan);
          this.eventBus.emit('system', {
            subtype: 'research_fanout',
            nodes: plan.map((n) => n.id),
            batches: groupPhasePlanByDeps(plan).map((b) => b.length),
          });

          const results = await runPhasePlan(plan, async (id) => {
            const node = nodesById.get(id);
            const workerResult = await this._spawnLeasedWorker(
              {
                prompt:
                  'Research-only: list and read key files relevant to this task. Do not edit. Task: ' +
                  (node.prompt || node.description || id) +
                  '\nOverall objective: ' +
                  input.objective,
                cwd: input.cwd,
                phase: 'research',
                allowedTools: Array.isArray(node.allowedTools) ? node.allowedTools : [...RESEARCH_TOOLS],
                maxSteps: node.maxSteps || 6,
                inherit: inheritFor({
                  maxTokens: typeof node.maxTokens === 'number' ? node.maxTokens : undefined,
                }),
              },
              workerOptions,
              // Split the remainder across this node's concurrent batch.
              budgetOf(sizes.get(id) || 1),
            );
            this.eventBus.emit('worker_finished', {
              workerId: workerResult.workerId,
              phase: 'research',
              node: id,
              leaseId: workerResult.leaseId || null,
              refused: !!workerResult.refused,
            });
            return workerResult;
          });

          for (const id of plan.map((n) => n.id)) {
            const r = results.get(id);
            if (r) artifacts.workerResults.push({ ...r, node: id });
          }
        } else {
          // Unchanged single-worker path (now leased rather than copy-of-ceiling).
          const workerResult = await this._spawnLeasedWorker(
            {
              prompt:
                'Research-only: list and read key files relevant to this objective. Do not edit. Objective: ' +
                input.objective,
              cwd: input.cwd,
              phase: 'research',
              allowedTools: [...RESEARCH_TOOLS],
              maxSteps: 6,
              // P1-10: coordinator workers inherit the same model/bridge/network ceilings.
              inherit: inheritFor(),
            },
            workerOptions,
            budgetOf(1),
          );
          artifacts.workerResults.push(workerResult);
          this.eventBus.emit('worker_finished', {
            workerId: workerResult.workerId,
            phase: 'research',
            leaseId: workerResult.leaseId || null,
          });
        }
      }
      this.eventBus.emit('phase', { phase: 'research', status: 'completed' });
    }

    let synthesisSpec = input.objective;
    let structured = null;

    if (phases.includes('synthesize')) {
      this.eventBus.emit('phase', { phase: 'synthesize', status: 'started' });
      const compiled = compileSpec(input.objective, artifacts.workerResults);
      if (compiled.rejected) {
        this.eventBus.emit('phase', { phase: 'synthesize', status: 'failed', reason: compiled.reason });
        return {
          sessionId,
          sessionPath,
          phases,
          duration_ms: Date.now() - startedAt,
          error: 'Spec compilation rejected: ' + compiled.reason,
          artifacts,
          events: this.eventBus.getHistory(),
          objective: input.objective,
          cwd: input.cwd,
          model: input.model,
          // Research workers may already have spent tokens before the spec was
          // rejected, so report the same budget telemetry as the success path.
          budget: broker.snapshot(totalUsage),
          childUsage: { ...totalUsage },
        };
      }
      synthesisSpec = compiled.spec;
      structured = compiled.structured;
      artifacts.synthesis = synthesisSpec;
      artifacts.structured = structured;
      store.updateRunner({ activeTaskIds: [], lastSynthesis: synthesisSpec.slice(0, 4000) });
      store.save();
      this.eventBus.emit('phase', { phase: 'synthesize', status: 'completed', bytes: synthesisSpec.length });
    }

    let kernelResult = null;

    if (phases.includes('execute')) {
      this.eventBus.emit('phase', { phase: 'execute', status: 'started' });
      const executePrompt = synthesisSpec + '\n\n---\nExecute the implementation spec now.\n';
      kernelResult = await runKernel({
        prompt: executePrompt,
        cwd: input.cwd,
        model: input.model,
        maxTokens: input.maxTokens || 2000,
        sessionPath,
        sessionId,
        outputFormat: input.outputFormat || 'text',
        inheritTrust: true,
        trustWorkspace: false,
        ...(input.kernelOptions || {}),
      });
      this.eventBus.emit('phase', {
        phase: 'execute',
        status: kernelResult?.stopReason === STOP_REASONS.SUCCESS ? 'completed' : 'failed',
        stopReason: kernelResult?.stopReason,
      });
    }

    if (phases.includes('verify') && kernelResult) {
      this.eventBus.emit('phase', { phase: 'verify', status: 'started' });
      const verifyResult = await this._spawnLeasedWorker(
        {
          prompt:
            'Verify-only: inspect the repo state and confirm whether the objective appears satisfied. Read-only. Objective: ' +
            input.objective +
            '\nPrior result: ' +
            (kernelResult.finalText || '').slice(0, 1500),
          cwd: input.cwd,
          phase: 'verify',
          allowedTools: [...RESEARCH_TOOLS],
          maxSteps: 4,
          inherit: inheritFor(),
        },
        workerOptions,
        budgetOf(1),
      );
      artifacts.workerResults.push(verifyResult);
      this.eventBus.emit('phase', { phase: 'verify', status: 'completed' });
      artifacts.verification = verifyResult.summary;
    }

    store.save();

    const result = {
      sessionId,
      sessionPath,
      phases,
      duration_ms: Date.now() - startedAt,
      synthesis: artifacts.synthesis,
      structured,
      kernelResult,
      artifacts,
      events: this.eventBus.getHistory(),
      objective: input.objective,
      cwd: input.cwd,
      model: input.model,
      // Lease telemetry so a field test can check the broker invariant
      // (sum of active leases + usage never exceeded the caps) after the run.
      budget: broker.snapshot(totalUsage),
      childUsage: { ...totalUsage },
      error: null,
    };

    if (process.env.BRIDGE_RUNNER_ARCHIVE !== '0' && !input.noArchive) {
      try {
        const { archiveCoordinatorSummary } = require('./archive/run-exporter');
        archiveCoordinatorSummary(result);
      } catch (err) {
        console.error('[coordinator archive] ' + err.message);
      }
    }

    return result;
  }
}

/** @deprecated use compileSpec from coordinator-spec-compiler */
function synthesizeSpec(objective, researchDigest) {
  const digest = String(researchDigest || '').trim();
  const workerResults = digest ? [{ summary: digest, claims: [digest], evidencePaths: [], confidence: 'legacy' }] : [];
  const compiled = compileSpec(objective, workerResults);
  if (compiled.rejected && digest) {
    return (
      '## Objective\n' +
      objective +
      '\n\n## Research findings\n' +
      digest +
      '\n\n## Implementation spec\n- Inspect relevant files\n- Apply minimal changes\n- Verify outcome\n'
    );
  }
  return compiled.rejected ? objective : compiled.spec;
}

module.exports = {
  PHASES,
  RESEARCH_TOOLS,
  Coordinator,
  synthesizeSpec,
  groupPhasePlanByDeps,
  runPhasePlan,
  computeLeaseRequest,
  batchSizeById,
};
