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

const PHASES = Object.freeze(['research', 'synthesize', 'execute', 'verify']);

class Coordinator {
  constructor(options = {}) {
    this.eventBus = options.eventBus || createEventBus({ emitStdout: options.streamEvents });
    this.workers = options.workerRuntime || new WorkerRuntime(options.workerOptions);
    this.sessionBaseDir =
      options.sessionBaseDir || require('path').join(process.env.HOME || process.cwd(), '.bridge-runner', 'sessions');
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

    this.eventBus.emit('system', {
      subtype: 'coordinator_init',
      sessionId,
      phases,
      cwd: input.cwd,
    });

    if (phases.includes('research')) {
      this.eventBus.emit('phase', { phase: 'research', status: 'started' });
      if (input.useWorkers !== false) {
        const workerResult = await this.workers.spawnWorker({
          prompt:
            'Research-only: list and read key files relevant to this objective. Do not edit. Objective: ' +
            input.objective,
          cwd: input.cwd,
          phase: 'research',
          agent: 'explore',
          allowedTools: ['list_files', 'read_file', 'search_text', 'git_status'],
          maxSteps: 6,
        });
        artifacts.workerResults.push(workerResult);
        this.eventBus.emit('worker_finished', { workerId: workerResult.workerId, phase: 'research' });
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
        trustWorkspace: true,
        skipTrustGate: false,
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
      const verifyResult = await this.workers.spawnWorker({
        prompt:
          'Verify-only: inspect the repo state and confirm whether the objective appears satisfied. Read-only. Objective: ' +
          input.objective +
          '\nPrior result: ' +
          (kernelResult.finalText || '').slice(0, 1500),
        cwd: input.cwd,
        phase: 'verify',
        agent: 'verify',
        maxSteps: 4,
      });
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
  Coordinator,
  synthesizeSpec,
};
