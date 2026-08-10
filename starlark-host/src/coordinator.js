'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { policyDisclosure } = require('./descriptor-policy');
const { FaultInjector } = require('./failures');
const { buildHostJsonPlan, buildHostJsonRecovery } = require('./json-plan');
const { RunLedger, atomicWrite } = require('./ledger');
const { evaluateStarlark, extractStarlark } = require('./starlark');
const { lintStarlark } = require('./starlark-lint');
const { buildSynthesisPrompt, runSynthesis, validateSynthesisResponse } = require('./synthesis');
const { validateJobs } = require('./validator');

const PLANNER_SYSTEM = `You are the planning model inside a user-owned orchestration system. Return only Starlark source code. The code must define def plan(ctx) and return a list of job dictionaries. Starlark has no imports, while loops, exceptions, async functions, filesystem, network, shell, or model access. Unlike Python, adjacent string literals are not implicitly joined; use + when combining strings. The host validates every descriptor and chooses all model IDs.`;
const RECOVERY_SYSTEM = `You are the recovery-planning model inside a user-owned orchestration system. Return only Starlark source code defining def recover(ctx). Return retry job descriptors only for failures where retryable is true. Every retry must include retry_of. Do not retry permanent failures.`;
class PhasedCoordinator {
  constructor({
    config,
    bridge,
    plannerModel,
    plannerLadder,
    workerModel,
    faultProfile,
    runDir,
    documents,
    workerName,
    workerRegistry,
    planSource = 'starlark',
  }) {
    this.config = config;
    this.bridge = bridge;
    // R14c: 'starlark' (default) has the planner model write a program;
    // 'host_json' builds the descriptor list deterministically on the host —
    // zero planner calls, zero evaluator rounds, SAME validator.
    if (!['starlark', 'host_json'].includes(planSource)) {
      throw new Error(`unknown plan source '${planSource}'`);
    }
    this.planSource = planSource;
    this.plannerModel = plannerModel;
    // R13: cost-tiered planner routing. The ladder is ordered cheapest-first;
    // planning starts on tier 0 and escalates one tier ONLY when a tier
    // exhausts its repair attempts (the R4 data behind this: the cheapest
    // planner had the best structural compliance, so escalation should be an
    // exception path, not the default). A single-entry ladder reproduces the
    // pre-R13 behavior exactly.
    this.plannerLadder =
      Array.isArray(plannerLadder) && plannerLadder.length > 0 ? plannerLadder : [plannerModel];
    // The tier that most recently produced an ACCEPTED program. Recovery
    // starts where planning ended (no point re-failing the cheap tier), and
    // synthesis uses this model too.
    this.activePlannerModel = this.plannerLadder[0];
    this.ladderIndex = 0;
    this.workerModel = workerModel;
    this.documents = documents || null;
    this.workerName = workerName || config.workerName || 'code_analyst';
    this.workerRegistry = workerRegistry || null;
    if (!config.workerProfiles[this.workerName]) throw new Error(`unknown active worker '${this.workerName}'`);
    this.faults = new FaultInjector(faultProfile);
    this.ledger = new RunLedger(runDir);
    this.state = {
      phase: 'created',
      plannerModel,
      plannerLadder: this.plannerLadder,
      planSource: this.planSource,
      workerModel,
      workerName: this.workerName,
      workerProfiles: workerRegistry ? workerRegistry.publicProfiles() : null,
      trace: bridge.traceMetadata ? bridge.traceMetadata() : null,
      jobs: [],
      results: [],
      calls: [],
    };
  }

  async run() {
    const documents = this.documents || loadDocuments(this.config);
    const publicDocuments = documents.map(publicDocument);
    // Inputs are local run artifacts rather than model conversation state.
    // This gives the user a replayable evidence bundle even if a provider trace
    // is unavailable, while the Starlark program still sees metadata only.
    for (const document of documents) {
      this.ledger.writeArtifact(`input-${document.id}`, {
        ...publicDocument(document),
        text: document.text,
      });
    }
    this.ledger.append('run_started', {
      plannerModel: this.plannerModel,
      workerModel: this.workerModel,
      workerName: this.workerName,
      trace: this.state.trace,
      objective: this.config.objective,
      documents: publicDocuments,
    });

    this.state.phase = 'planning';
    this.checkpoint();
    const policy = this.policy(publicDocuments);
    let initialPlan;
    if (this.planSource === 'host_json') {
      // R14c: fully determined plan — build it, validate it, spend nothing.
      const jobs = validateJobs(
        buildHostJsonPlan({ documents: publicDocuments, workerName: this.workerName, policy }),
        policy,
        'plan',
      );
      const metrics = {
        attempts: 0,
        repairs: 0,
        firstPassValid: true,
        lintFixes: 0,
        model: 'host_json',
        escalations: 0,
      };
      this.ledger.append('plan_validated', { jobs, planSource: 'host_json', metrics });
      initialPlan = { jobs, metrics };
    } else {
      initialPlan = await this.generateValidatedPlan({
        phaseLabel: 'plan',
        functionName: 'plan',
        system: PLANNER_SYSTEM,
        prompt: buildPlanPrompt(this.config, publicDocuments, this.workerName, policy),
        context: { objective: this.config.objective, documents: publicDocuments },
        policy,
        validationPhase: 'plan',
        maxTokens: 3000,
        acceptedEvent: 'plan_validated',
      });
    }
    const jobs = initialPlan.jobs;
    this.state.planMetrics = initialPlan.metrics;
    this.state.jobs = jobs;

    this.state.phase = 'workers';
    this.checkpoint();
    const initialResults = await this.runJobs(jobs, documents, 1);
    this.state.results.push(...initialResults);

    const failures = initialResults
      .filter((result) => !result.ok)
      .map((result) => ({
        job_id: result.job.id,
        worker: result.job.worker,
        task: result.job.task,
        input_ids: result.job.input_ids,
        retryable: result.error.retryable,
        code: result.error.code,
      }));

    let recoveryJobs = [];
    if (failures.length) {
      this.state.phase = 'recovery_planning';
      this.checkpoint();
      const recoveryPolicy = {
        ...policy,
        failedJobIds: failures.filter((failure) => failure.retryable).map((failure) => failure.job_id),
        exactJobs: undefined,
        requireAllInputs: false,
      };
      let recoveryPlan;
      if (this.planSource === 'host_json') {
        const retries = failures.some((failure) => failure.retryable)
          ? validateJobs(buildHostJsonRecovery({ failures, policy: recoveryPolicy }), recoveryPolicy, 'recovery')
          : [];
        const metrics = {
          attempts: 0,
          repairs: 0,
          firstPassValid: true,
          lintFixes: 0,
          model: 'host_json',
          escalations: 0,
        };
        this.ledger.append('recovery_plan_validated', { jobs: retries, planSource: 'host_json', metrics });
        recoveryPlan = { jobs: retries, metrics };
      } else {
        recoveryPlan = await this.generateValidatedPlan({
          phaseLabel: 'recover',
          functionName: 'recover',
          system: RECOVERY_SYSTEM,
          prompt: buildRecoveryPrompt(this.config, publicDocuments, failures, this.workerName, policy),
          context: { objective: this.config.objective, documents: publicDocuments, failures },
          policy: recoveryPolicy,
          validationPhase: 'recovery',
          maxTokens: 2500,
          acceptedEvent: 'recovery_plan_validated',
        });
      }
      recoveryJobs = recoveryPlan.jobs;
      this.state.recoveryMetrics = recoveryPlan.metrics;
      this.state.phase = 'recovery_workers';
      this.checkpoint();
      const recoveryResults = await this.runJobs(recoveryJobs, documents, 2);
      this.state.results.push(...recoveryResults);
    }

    this.state.phase = 'synthesis';
    this.checkpoint();
    // R10: synthesis is independently fallible AND independently retryable —
    // worker artifacts above are already durable, so a synthesis failure must
    // never cost a worker re-run (see resume-synthesis.js). Strategy 'auto'
    // switches to map-reduce when the result set outgrows one bounded call.
    const synthesis = await runSynthesis({
      bridge: this.bridge,
      // R13: synthesis runs on whichever ladder tier last produced an
      // accepted program (equals plannerModel when no ladder is configured).
      model: this.activePlannerModel,
      objective: this.config.objective,
      results: this.state.results,
      options: this.config.synthesis,
    });
    const synthesisFailure = synthesis.ok ? null : synthesis.failure;
    this.state.phase = synthesisFailure ? 'partial' : 'completed';
    this.state.synthesis = synthesis.text;
    this.state.synthesisFailure = synthesisFailure;
    this.state.synthesisStrategy = synthesis.strategy;
    this.state.synthesisCalls = synthesis.calls;
    this.state.cost = { usedUsd: this.bridge.budget.usedUsd, calls: this.bridge.budget.calls };
    this.checkpoint();
    if (synthesisFailure) {
      this.ledger.append('synthesis_failed', synthesisFailure);
    } else {
      this.ledger.writeArtifact('synthesis', { text: synthesis.text });
    }
    this.ledger.append('run_completed', {
      successful: this.state.results.filter((result) => result.ok).length,
      failed: this.state.results.filter((result) => !result.ok).length,
      synthesisOk: !synthesisFailure,
      estimatedCostUsd: this.bridge.budget.usedUsd,
    });
    atomicWrite(path.join(this.ledger.runDir, 'result.json'), this.state);
    return this.state;
  }

  policy(documents) {
    const profile = this.config.workerProfiles[this.workerName];
    return {
      maxJobsPerPhase: this.config.maxJobsPerPhase,
      inputIds: documents.map((document) => document.id),
      // The plan is deliberately restricted to this workflow's symbolic
      // worker. Other registered workers exist, but generated code cannot
      // silently switch task type or provider route.
      workerNames: [this.workerName],
      defaultTimeoutMs: 30000,
      maxTimeoutMs: 60000,
      defaultMaxOutputTokens: profile.maxOutputTokens,
      maxOutputTokens: profile.maxOutputTokens,
      maxTaskCharacters: this.config.maxTaskCharacters,
      failedJobIds: [],
      exactJobs: documents.length,
      oneInputPerJob: true,
      requireAllInputs: true,
      allowDependencies: false,
    };
  }

  async generateValidatedPlan({
    phaseLabel,
    functionName,
    system,
    prompt,
    context,
    policy,
    validationPhase,
    maxTokens,
    acceptedEvent,
  }) {
    // R13: try each ladder tier in turn, two attempts per tier. Escalation is
    // recorded on the ledger so the repair tax of cheap-first routing stays
    // measurable. Tiers below the current index are never revisited.
    let lastError = null;
    let totalAttempts = 0;
    for (; this.ladderIndex < this.plannerLadder.length; this.ladderIndex += 1) {
      const tier = this.plannerLadder[this.ladderIndex];
      try {
        const accepted = await this.generateValidatedPlanOnModel({
          model: tier,
          phaseLabel,
          functionName,
          system,
          prompt,
          context,
          policy,
          validationPhase,
          maxTokens,
          acceptedEvent,
          attemptOffset: totalAttempts,
        });
        this.activePlannerModel = tier;
        return accepted;
      } catch (error) {
        lastError = error;
        totalAttempts += 2;
        const next = this.plannerLadder[this.ladderIndex + 1];
        if (next) {
          this.ledger.append(`${phaseLabel}_escalated`, {
            from: tier,
            to: next,
            error: error.message,
          });
        }
      }
    }
    throw lastError || new Error(`${phaseLabel} did not produce a valid plan`);
  }

  async generateValidatedPlanOnModel({
    model,
    phaseLabel,
    functionName,
    system,
    prompt,
    context,
    policy,
    validationPhase,
    maxTokens,
    acceptedEvent,
    attemptOffset = 0,
  }) {
    let rejection = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const repairSuffix = rejection
        ? `\n\nYour previous Starlark was rejected by the host. Error:\n${rejection.error}\n\nRejected source:\n${rejection.source}\n\nReturn a corrected complete program only.`
        : '';
      const response = await this.bridge.call({
        model,
        system,
        prompt: prompt + repairSuffix,
        maxTokens,
        label: `${phaseLabel}:${model}:attempt:${attempt}`,
      });
      // Artifact numbering is global across ladder tiers so an escalated
      // phase never overwrites the cheap tier's rejected source.
      const globalAttempt = attemptOffset + attempt;
      const source = extractStarlark(response.text);
      this.ledger.writeArtifact(`${phaseLabel}-source-attempt-${globalAttempt}`, { source });

      // R6: deterministic pre-lint. Mechanical Python-isms are auto-repaired
      // (and recorded); everything else becomes a precise rejection that
      // guides the model's repair attempt WITHOUT spending an evaluator round.
      const lint = lintStarlark(source);
      if (lint.applied.length) {
        this.ledger.append(`${phaseLabel}_lint_repaired`, { applied: lint.applied });
      }
      try {
        if (lint.diagnostics.length) {
          const message =
            'Starlark pre-lint rejected the program:\n' +
            lint.diagnostics.map((diagnostic) => `- ${diagnostic.message}`).join('\n');
          const error = new Error(message);
          error.lintRules = lint.diagnostics.map((diagnostic) => diagnostic.rule);
          throw error;
        }
        const evaluated = await evaluateStarlark({
          source: lint.source,
          functionName,
          context,
          maxSteps: this.config.maxStarlarkSteps,
          timeoutMs: this.config.starlarkTimeoutMs,
        });
        const jobs = validateJobs(evaluated.result, policy, validationPhase);
        const metrics = {
          attempts: globalAttempt,
          repairs: globalAttempt - 1,
          firstPassValid: globalAttempt === 1,
          lintFixes: lint.applied.length,
          model,
          escalations: this.ladderIndex,
        };
        this.ledger.append(acceptedEvent, { jobs, starlarkSteps: evaluated.steps, metrics });
        return { jobs, metrics };
      } catch (error) {
        rejection = { source, error: error.message };
        this.ledger.append(`${phaseLabel}_rejected`, {
          attempt: globalAttempt,
          model,
          error: error.message,
          ...(error.lintRules ? { lintRules: error.lintRules } : {}),
        });
        if (attempt === 2) throw error;
      }
    }
    throw new Error(`${phaseLabel} did not produce a valid plan`);
  }

  async runJobs(jobs, documents, attempt) {
    const byId = new Map(documents.map((document) => [document.id, document]));
    return mapConcurrent(jobs, this.config.maxConcurrency, async (job, index) => {
      this.ledger.append('job_started', { jobId: job.id, attempt, worker: job.worker });
      const before = this.faults.beforeCall(index, attempt);
      if (before) return this.recordFailure(job, attempt, before);

      const supplied = job.input_ids.map((id) => byId.get(id));
      let response;
      try {
        const request = {
          prompt: buildWorkerPrompt(this.config.objective, job, supplied),
          maxTokens: job.max_output_tokens,
          timeoutMs: job.timeout_ms,
          label: `worker:${job.id}:attempt:${attempt}`,
        };
        if (this.workerRegistry) {
          response = await this.workerRegistry.execute({ workerName: job.worker, ...request });
        } else {
          const profile = this.config.workerProfiles[job.worker];
          response = await this.bridge.call({
            model: this.workerModel,
            system: profile.system,
            effort: profile.effort || 'low',
            ...request,
          });
        }
      } catch (error) {
        return this.recordFailure(job, attempt, {
          error: { code: error.retryable ? 'bridge_transient' : 'bridge_error', retryable: Boolean(error.retryable), message: error.message },
          charged: false,
        });
      }

      const altered = this.faults.afterCall(index, attempt, response);
      if (altered.injectedFailure) return this.recordFailure(job, attempt, altered);
      try {
        const output = parseWorkerOutput(altered.text);
        const artifact = this.ledger.writeArtifact(`${job.id}-attempt-${attempt}`, output);
        const result = { ok: true, job, attempt, artifact, output, usage: altered.usage, costUsd: altered.costUsd };
        this.ledger.append('job_succeeded', { jobId: job.id, attempt, artifact, confidence: output.confidence });
        return result;
      } catch (error) {
        return this.recordFailure(job, attempt, {
          error: { code: 'invalid_worker_output', retryable: true, message: error.message },
          charged: true,
        });
      }
    });
  }

  recordFailure(job, attempt, failure) {
    const result = { ok: false, job, attempt, error: failure.error, charged: Boolean(failure.charged) };
    this.ledger.append('job_failed', {
      jobId: job.id,
      attempt,
      error: failure.error,
      charged: Boolean(failure.charged),
    });
    return result;
  }

  checkpoint() {
    this.ledger.checkpoint(this.state);
  }
}

function loadDocuments(config) {
  return config.documents.map((document) => {
    const absolutePath = path.resolve(config.targetRoot, document.path);
    const relativePath = path.relative(config.targetRoot, absolutePath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      throw new Error(`document escapes target root: ${document.path}`);
    }
    const buffer = fs.readFileSync(absolutePath);
    if (buffer.length > config.maxDocumentBytes) {
      throw new Error(`document exceeds ${config.maxDocumentBytes} bytes: ${document.path}`);
    }
    return {
      id: document.id,
      relativePath,
      bytes: buffer.length,
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      text: buffer.toString('utf8'),
    };
  });
}

function publicDocument({ id, kind, relativePath, bytes, sha256, metadata }) {
  return {
    id,
    kind: kind || 'document',
    path: relativePath,
    bytes,
    sha256,
    ...(metadata ? { metadata } : {}),
  };
}

// R5: both prompts render their policy sections from descriptor-policy.js, so
// the bounds the model reads are the bounds the validator enforces — always.
function buildPlanPrompt(config, documents, workerName = config.workerName || 'code_analyst', policy) {
  const effectivePolicy = policy || policyFromConfig(config, workerName, documents);
  const disclosure = policyDisclosure({
    policy: effectivePolicy,
    phase: 'plan',
    workerName,
    documentCount: documents.length,
  });
  return `${config.objective}\n\nAvailable bounded inputs:\n${JSON.stringify(documents, null, 2)}\n\n${disclosure}`;
}

function buildRecoveryPrompt(config, documents, failures, workerName = config.workerName || 'code_analyst', policy) {
  const effectivePolicy = policy || policyFromConfig(config, workerName, documents);
  const disclosure = policyDisclosure({
    policy: effectivePolicy,
    phase: 'recovery',
    workerName,
    documentCount: documents.length,
  });
  return `${config.objective}\n\nDocuments:\n${JSON.stringify(documents, null, 2)}\n\nFailures:\n${JSON.stringify(failures, null, 2)}\n\n${disclosure}`;
}

// Fallback policy shape for direct prompt-builder calls (tests, tooling) that
// do not pass the coordinator's policy object. Mirrors PhasedCoordinator.policy().
function policyFromConfig(config, workerName, documents) {
  const profile = config.workerProfiles[workerName];
  return {
    maxJobsPerPhase: config.maxJobsPerPhase,
    maxTimeoutMs: 60000,
    defaultTimeoutMs: 30000,
    defaultMaxOutputTokens: profile.maxOutputTokens,
    maxOutputTokens: profile.maxOutputTokens,
    maxTaskCharacters: config.maxTaskCharacters,
    inputIds: documents.map((document) => document.id),
  };
}

function buildWorkerPrompt(objective, job, documents) {
  const sections = documents.map(
    (document) => `DOCUMENT ${document.id} (${document.relativePath}, sha256 ${document.sha256}):\n${document.text}`,
  );
  return `OBJECTIVE:\n${objective}\n\nASSIGNED TASK:\n${job.task}\n\n${sections.join('\n\n')}`;
}

function parseWorkerOutput(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const output = JSON.parse(cleaned);
  const keys = Object.keys(output).sort();
  if (JSON.stringify(keys) !== JSON.stringify(['claims', 'confidence', 'evidence', 'summary'])) {
    throw new Error('worker JSON must contain exactly summary, claims, evidence, confidence');
  }
  if (typeof output.summary !== 'string' || !output.summary.trim() || output.summary.length > 700) {
    throw new Error('summary must be 1..700 characters');
  }
  if (
    !Array.isArray(output.claims) ||
    output.claims.length > 4 ||
    output.claims.some((value) => typeof value !== 'string' || value.length > 300)
  ) {
    throw new Error('claims must contain at most 4 strings of at most 300 characters');
  }
  if (
    !Array.isArray(output.evidence) ||
    output.evidence.length > 4 ||
    output.evidence.some((value) => typeof value !== 'string' || value.length > 300)
  ) {
    throw new Error('evidence must contain at most 4 strings of at most 300 characters');
  }
  if (typeof output.confidence !== 'number' || output.confidence < 0 || output.confidence > 1) {
    throw new Error('confidence must be between 0 and 1');
  }
  return output;
}

async function mapConcurrent(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

module.exports = {
  PhasedCoordinator,
  buildPlanPrompt,
  buildRecoveryPrompt,
  buildSynthesisPrompt,
  buildWorkerPrompt,
  loadDocuments,
  parseWorkerOutput,
  publicDocument,
  validateSynthesisResponse,
};
