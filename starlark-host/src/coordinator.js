'use strict';

const path = require('path');

const { checkAbort, createRunController } = require('./run-abort');
const { inputContentHash, loadDocuments, publicDocument } = require('./documents');
const { acceptedPlanHashes, contentHash } = require('./plan-hash');
const { policyDisclosure } = require('./descriptor-policy');
const { FaultInjector } = require('./failures');
const { buildHostJsonPlan, buildHostJsonRecovery } = require('./json-plan');
const { RunLedger, atomicWrite } = require('./ledger');
const { evaluateStarlark, extractStarlark } = require('./starlark');
const { lintStarlark } = require('./starlark-lint');
const { buildSynthesisPrompt, runSynthesis, validateSynthesisResponse } = require('./synthesis');
const { validateJobs } = require('./validator');
const { parseWorkerOutput } = require('./worker-contract');
const { restoreWorkerRun } = require('./worker-resume');

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
    controller = createRunController(),
    executionContext = null,
  }) {
    this.executionContext = executionContext;
    this.faultProfile = faultProfile;
    this.controller = controller;
    this.signal = controller.signal;
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
    this.plannerLadder = Array.isArray(plannerLadder) && plannerLadder.length > 0 ? plannerLadder : [plannerModel];
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

  async run({ resume = false } = {}) {
    if (resume) {
      // Medium #4: resume is a phase DISPATCH, not a replay. worker-resume.js
      // reads the ledger and says what the run is; the phase methods below
      // then each do only the work the ledger does not already record.
      const restored = restoreWorkerRun({
        ledger: this.ledger,
        objective: this.config.objective,
        planSource: this.planSource,
        plannerModel: this.plannerModel,
        plannerLadder: this.plannerLadder,
        policyFor: (documents) => this.policy(documents),
      });
      this.state = restored.state;
      if (restored.kind === 'completed') {
        // A recorded run_completed beat a stale checkpoint; repair the file.
        if (restored.staleCheckpoint) this.checkpoint();
        return this.state;
      }
      if (restored.kind === 'partial') {
        // Synthesis FAILED (refusal/truncation/empty) after all workers were
        // durable. That is a different tool's job. An ABORT during synthesis
        // is not a failure and stays here: see resumePhases. If the partial
        // checkpoint itself was lost, repair it first so that tool can run.
        if (restored.staleCheckpoint) this.checkpoint();
        throw new Error('use resume-synthesis for a partial run whose synthesis failed');
      }
      this.documents = restored.documents;
      this.inputHash = restored.inputHash;
      this.activePlannerModel = restored.activePlannerModel;
      this.ladderIndex = restored.ladderIndex;
      this.resumeData = restored.resumeData;
    } else {
      // This is the host's configuration, not planner authority. Credentials
      // remain in the environment and are never included in this receipt.
      atomicWrite(path.join(this.ledger.runDir, 'run-context.json'), {
        config: this.config,
        plannerModel: this.plannerModel,
        plannerLadder: this.plannerLadder,
        workerModel: this.workerModel,
        workerName: this.workerName,
        faultProfile: this.faultProfile,
        planSource: this.planSource,
        executionContext: this.executionContext,
      });
    }
    // Abort-commit protocol (thermo-nuclear Medium #2). The abort signal is
    // NOT wired to a ledger write here on purpose. An earlier version appended
    // `run_aborted` from the signal listener, i.e. while worker promises were
    // still in flight, so a worker that had already been charged could land
    // its `job_succeeded` AFTER the abort receipt (or, worse, be thrown away).
    // Now the only path to `run_aborted` is the catch below, which runs after
    // mapConcurrent's Promise.allSettled has drained every in-flight worker.
    // That makes "no job start or result after run_aborted" a mechanical
    // property of the ledger instead of a race. SIGKILL right after SIGINT
    // loses the abort receipt but not the job receipts; resume rebuilds from
    // events, which are the truth, not from state.json.
    try {
      checkAbort(this.signal);
      return await (resume ? this.resumePhases() : this.runPhases());
    } catch (error) {
      if (!this.signal.aborted) throw error;
      this.recordAbort();
      return this.state;
    }
  }

  recordAbort() {
    if (this.state.phase === 'aborted') return;
    const interruptedPhase = this.state.phase;
    this.state.phase = 'aborted';
    this.state.abortReason = String(this.signal.reason?.message || this.signal.reason || 'cancelled');
    this.state.cost = this.bridge.budget.toJSON();
    this.ledger.append('run_aborted', { reason: this.state.abortReason, interruptedPhase });
    // Every in-flight worker has settled by the time we get here, so this
    // checkpoint carries the results that actually landed (see runJobs).
    this.checkpoint();
  }

  // ---------------------------------------------------------------------------
  // The pipeline, as phases. A fresh run walks all of them in order. A resume
  // walks the same methods, but each one is idempotent against the ledger:
  // a plan that was accepted is adopted, not regenerated; a job with a
  // terminal receipt is reused, not restarted; a phase with nothing left to do
  // writes no checkpoint. So a run aborted after every worker finished goes
  // straight to synthesis — the "already past workers → only synthesis" arm
  // the review asked for, without a second control plane.
  // ---------------------------------------------------------------------------

  async runPhases() {
    const documents = this.documents || loadDocuments(this.config);
    const publicDocuments = documents.map(publicDocument);
    this.inputHash = inputContentHash(contentHash, this.config.objective, documents);
    this.state.inputHash = this.inputHash;
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
      inputHash: this.inputHash,
    });
    const policy = this.policy(publicDocuments);
    const plan = await this.planPhase(publicDocuments, policy);
    const initialResults = await this.workerPhase(plan, documents);
    await this.recoveryPhase({ initialResults, documents, publicDocuments, policy });
    return this.synthesisPhase();
  }

  async resumePhases() {
    const documents = this.documents;
    const publicDocuments = documents.map(publicDocument);
    const { plan, recovery, results } = this.resumeData;
    // Say on the ledger which arm resume is taking, so an operator (and the
    // tests) can read the decision instead of inferring it from what follows.
    this.ledger.append('worker_resume_started', {
      previousPhase: this.state.phase,
      trace: this.bridge.traceMetadata?.() || null,
      remaining: {
        plan: plan.jobs.filter((job) => !results.has(job.id)).length,
        recovery: recovery ? recovery.jobs.filter((job) => !results.has(job.id)).length : null,
        synthesis: true,
      },
    });
    this.state.inputHash = this.inputHash;
    this.state.results = [];
    this.adoptPlan(plan);
    const policy = this.policy(publicDocuments);
    const initialResults = await this.workerPhase(plan, documents);
    await this.recoveryPhase({ initialResults, documents, publicDocuments, policy });
    return this.synthesisPhase();
  }

  async planPhase(publicDocuments, policy) {
    this.state.phase = 'planning';
    this.checkpoint();
    let plan;
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
      const hashes = this.acceptedHashes(jobs);
      this.ledger.append('plan_validated', { jobs, planSource: 'host_json', metrics, hashes });
      plan = { jobs, metrics, hashes };
    } else {
      plan = await this.generateValidatedPlan({
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
    checkAbort(this.signal);
    this.adoptPlan(plan);
    return plan;
  }

  adoptPlan(plan) {
    this.state.planMetrics = plan.metrics;
    this.state.planHashes = plan.hashes || null;
    this.state.jobs = plan.jobs;
  }

  // True when at least one of these jobs has no terminal receipt yet. On a
  // fresh run that is every job; on a resume it is only the unfinished ones.
  hasPendingJobs(jobs) {
    return jobs.some((job) => !this.resumeData?.results.has(job.id));
  }

  async workerPhase(plan, documents) {
    if (this.hasPendingJobs(plan.jobs)) {
      this.state.phase = 'workers';
      this.checkpoint();
    }
    // runJobs returns a recorded receipt without starting the job, so when
    // nothing is pending this costs no calls and appends no events.
    const results = await this.runJobs(plan.jobs, documents, 1);
    checkAbort(this.signal);
    this.state.results.push(...results);
    return results;
  }

  async recoveryPhase({ initialResults, documents, publicDocuments, policy }) {
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
    if (!failures.length) return [];

    const recoveryPolicy = {
      ...policy,
      failedJobIds: failures.filter((failure) => failure.retryable).map((failure) => failure.job_id),
      exactJobs: undefined,
      requireAllInputs: false,
    };
    let recoveryPlan;
    if (this.resumeData?.recovery) {
      // The accepted recovery plan is evidence; adopt it, never re-plan.
      recoveryPlan = this.resumeData.recovery;
    } else {
      this.state.phase = 'recovery_planning';
      this.checkpoint();
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
        const hashes = this.acceptedHashes(retries, null, failures);
        this.ledger.append('recovery_plan_validated', { jobs: retries, planSource: 'host_json', metrics, hashes });
        recoveryPlan = { jobs: retries, metrics, hashes };
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
    }
    checkAbort(this.signal);
    const recoveryJobs = recoveryPlan.jobs;
    this.state.recoveryMetrics = recoveryPlan.metrics;
    this.state.recoveryHashes = recoveryPlan.hashes || null;
    if (this.hasPendingJobs(recoveryJobs)) {
      this.state.phase = 'recovery_workers';
      this.checkpoint();
    }
    // D-F1: retries carry the host's rejection reason. The feedback flows
    // host -> worker directly (appended to the retry prompt), never through
    // the recovery planner's task text — the planner would pay the measured
    // verbosity tax and burn task-character budget relaying it. This
    // mirrors the planner repair loop, where the host's rejection message
    // is what makes second attempts succeed.
    const priorFailures = new Map(
      initialResults
        .filter((result) => !result.ok)
        .map((result) => [result.job.id, { code: result.error.code, message: result.error.message }]),
    );
    const recoveryResults = await this.runJobs(recoveryJobs, documents, 2, priorFailures);
    checkAbort(this.signal);
    this.state.results.push(...recoveryResults);
    return recoveryResults;
  }

  async synthesisPhase() {
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
      signal: this.signal,
    });
    // No abort check here (Medium #1): if runSynthesis returned, its bridge
    // calls settled and the text is paid for. Record run_completed so resume
    // is a no-op instead of buying the synthesis again.
    const synthesisFailure = synthesis.ok ? null : synthesis.failure;
    this.state.phase = synthesisFailure ? 'partial' : 'completed';
    this.state.synthesis = synthesis.text;
    this.state.synthesisFailure = synthesisFailure;
    this.state.synthesisStrategy = synthesis.strategy;
    this.state.synthesisCalls = synthesis.calls;
    this.state.cost = { usedUsd: this.bridge.budget.usedUsd, calls: this.bridge.budget.calls };
    if (synthesisFailure) {
      this.ledger.append('synthesis_failed', synthesisFailure);
    } else {
      this.ledger.writeArtifact('synthesis', {
        text: synthesis.text,
        jobIds: this.state.results.map((result) => result.job.id),
      });
    }
    this.ledger.append('run_completed', {
      successful: this.state.results.filter((result) => result.ok).length,
      failed: this.state.results.filter((result) => !result.ok).length,
      synthesisOk: !synthesisFailure,
      estimatedCostUsd: this.bridge.budget.usedUsd,
    });
    atomicWrite(path.join(this.ledger.runDir, 'result.json'), this.state);
    // A completed checkpoint must never precede its synthesis artifact.
    this.checkpoint();
    return this.state;
  }

  acceptedHashes(jobs, program = null, failures = null) {
    return acceptedPlanHashes({ jobs, program, failures, inputHash: this.inputHash });
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
    checkAbort(this.signal);
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
        checkAbort(this.signal);
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
      checkAbort(this.signal);
      const repairSuffix = rejection
        ? `\n\nYour previous Starlark was rejected by the host. Error:\n${rejection.error}\n\nRejected source:\n${rejection.source}\n\nReturn a corrected complete program only.`
        : '';
      const response = await this.bridge.call({
        model,
        system,
        prompt: prompt + repairSuffix,
        maxTokens,
        label: `${phaseLabel}:${model}:attempt:${attempt}`,
        signal: this.signal,
      });
      // Abort-commit protocol (Medium #1, planner leg): the planner response
      // above is paid for. Finish this attempt (lint, evaluate, validate) and
      // record its outcome before the abort is honored at the loop top, so a
      // resume reuses the accepted plan instead of buying a new one.
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
        const hashes = this.acceptedHashes(jobs, lint.source, context.failures || null);
        this.ledger.writeArtifact(`${phaseLabel}-source-accepted`, { source: lint.source });
        this.ledger.append(acceptedEvent, { jobs, starlarkSteps: evaluated.steps, metrics, hashes });
        return { jobs, metrics, hashes };
      } catch (error) {
        // A rejection is honest evidence about a paid attempt; record it even
        // when an abort is pending. The next attempt's loop-top check stops
        // the retry from starting.
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

  async runJobs(jobs, documents, attempt, priorFailures = null) {
    const byId = new Map(documents.map((document) => [document.id, document]));
    // Receipts that landed, in completion order. On abort mapConcurrent throws
    // and its ordered result array is lost, so this list is what lets the
    // abort checkpoint (and the CLI summary) report the successes that really
    // happened instead of showing zero while events.jsonl says otherwise.
    const landed = [];
    let results;
    try {
      results = await this.runJobsConcurrently(jobs, byId, attempt, priorFailures, landed);
    } catch (error) {
      if (this.signal.aborted) this.state.results.push(...landed);
      throw error;
    }
    return results;
  }

  runJobsConcurrently(jobs, byId, attempt, priorFailures, landed) {
    const record = (result) => {
      landed.push(result);
      return result;
    };
    return mapConcurrent(
      jobs,
      this.config.maxConcurrency,
      async (job, index) => {
        // A recorded terminal receipt wins over a possibly older checkpoint.
        // Reuse failures too: the existing recovery planner owns retry policy.
        const previous = this.resumeData?.results.get(job.id);
        if (previous) return record(previous);
        // D-F1: a retry learns why its predecessor was rejected.
        const feedback = job.retry_of && priorFailures ? priorFailures.get(job.retry_of) || null : null;
        this.ledger.append('job_started', {
          jobId: job.id,
          attempt,
          worker: job.worker,
          ...(feedback ? { retryFeedback: feedback } : {}),
        });
        const before = this.faults.beforeCall(index, attempt);
        if (before) return record(this.recordFailure(job, attempt, before));

        const supplied = job.input_ids.map((id) => byId.get(id));
        let response;
        try {
          const request = {
            prompt: buildWorkerPrompt(this.config.objective, job, supplied, feedback),
            maxTokens: job.max_output_tokens,
            timeoutMs: job.timeout_ms,
            label: `worker:${job.id}:attempt:${attempt}`,
            signal: this.signal,
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
          // The ONLY place abort may drop a job without a terminal receipt: the
          // call itself was cut off (fetch destroyed, reservation released, no
          // usage settled). Resume treats "started, no receipt" as re-execute,
          // which is the documented at-least-once rule for genuinely
          // interrupted work.
          checkAbort(this.signal);
          return record(
            this.recordFailure(job, attempt, {
              error: {
                code: error.retryable ? 'bridge_transient' : 'bridge_error',
                retryable: Boolean(error.retryable),
                message: error.message,
              },
              charged: false,
            }),
          );
        }

        // Abort-commit protocol (Medium #1): from here on the provider has
        // RETURNED and the budget has settled, so this job is paid for. There
        // is deliberately no abort check between this line and the terminal
        // receipt: whatever the response turned out to be (valid output,
        // injected failure, unparseable text) it gets persisted, so `--resume`
        // reuses it instead of buying it again. The queue stops taking new
        // jobs at the top of mapConcurrent's loop.
        const altered = this.faults.afterCall(index, attempt, response);
        if (altered.injectedFailure) return record(this.recordFailure(job, attempt, altered));
        try {
          const output = parseWorkerOutput(altered.text);
          const artifact = this.ledger.writeArtifact(`${job.id}-attempt-${attempt}`, output);
          const result = { ok: true, job, attempt, artifact, output, usage: altered.usage, costUsd: altered.costUsd };
          this.ledger.append('job_succeeded', {
            jobId: job.id,
            attempt,
            artifact,
            confidence: output.confidence,
            usage: altered.usage,
            costUsd: altered.costUsd,
          });
          return record(result);
        } catch (error) {
          return record(
            this.recordFailure(job, attempt, {
              error: { code: 'invalid_worker_output', retryable: true, message: error.message },
              charged: true,
            }),
          );
        }
      },
      this.signal,
    );
  }

  recordFailure(job, attempt, failure) {
    // No abort check: a failure receipt is terminal evidence about work that
    // already happened (or was deliberately skipped by fault injection).
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

function buildWorkerPrompt(objective, job, documents, feedback = null) {
  const sections = documents.map(
    (document) => `DOCUMENT ${document.id} (${document.relativePath}, sha256 ${document.sha256}):\n${document.text}`,
  );
  // D-F1: on a retry, the host states exactly why the previous attempt was
  // rejected. Host-authored and deterministic — worker-axis data showed that
  // without this, a model can fail the same constraint fifteen times in a
  // row because "return strict JSON" never tells it WHAT was wrong.
  const feedbackSection = feedback
    ? `\n\nPREVIOUS ATTEMPT REJECTED BY THE HOST (${feedback.code}):\n${feedback.message}\n` +
      'Correct exactly this problem in your response. All other contract rules still apply.'
    : '';
  return `OBJECTIVE:\n${objective}\n\nASSIGNED TASK:\n${job.task}${feedbackSection}\n\n${sections.join('\n\n')}`;
}

async function mapConcurrent(items, limit, fn, signal) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      checkAbort(signal);
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }
  // Wait for EVERY worker, including rejected calls, before finalizing the
  // run. Promise.all would return early and leave budget cleanup in flight.
  const settled = await Promise.allSettled(Array.from({ length: Math.min(limit, items.length) }, worker));
  checkAbort(signal);
  const rejected = settled.find((entry) => entry.status === 'rejected');
  if (rejected) throw rejected.reason;
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
