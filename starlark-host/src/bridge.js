'use strict';

const path = require('path');

const TRACE_LEVELS = new Set(['off', 'summary', 'redacted', 'full']);

class CostBudget {
  constructor(limitUsd) {
    this.limitUsd = limitUsd;
    this.usedUsd = 0;
    this.reservedUsd = 0;
    this.calls = [];
    this.reservations = new Map();
    this.nextReservation = 1;
  }

  reserve(estimatedUsd, label) {
    if (this.usedUsd + this.reservedUsd + estimatedUsd > this.limitUsd) {
      throw new Error(
        `cost gate blocked ${label}: estimated $${estimatedUsd.toFixed(4)} would exceed $${this.limitUsd.toFixed(2)}`,
      );
    }
    const id = this.nextReservation++;
    this.reservations.set(id, { estimatedUsd, label });
    this.reservedUsd += estimatedUsd;
    return id;
  }

  settle(id, entry) {
    const reservation = this.reservations.get(id);
    if (!reservation) throw new Error(`unknown cost reservation ${id}`);
    this.reservations.delete(id);
    this.reservedUsd = normalizeMoneyFloat(this.reservedUsd - reservation.estimatedUsd);
    this.record(entry);
    if (this.usedUsd > this.limitUsd) {
      throw new Error(
        `estimated experiment cost $${this.usedUsd.toFixed(4)} exceeded cap $${this.limitUsd.toFixed(2)} after ${entry.label}`,
      );
    }
  }

  release(id) {
    const reservation = this.reservations.get(id);
    if (!reservation) return;
    this.reservations.delete(id);
    this.reservedUsd = normalizeMoneyFloat(this.reservedUsd - reservation.estimatedUsd);
  }

  record(entry) {
    this.usedUsd += entry.costUsd;
    this.calls.push(entry);
  }

  toJSON() {
    return {
      limitUsd: this.limitUsd,
      usedUsd: this.usedUsd,
      reservedUsd: this.reservedUsd,
      calls: this.calls,
    };
  }
}

class ClaudeBridge {
  constructor({
    runnerRepo,
    bridgeUrl,
    callerToken,
    budget,
    effort = 'medium',
    traceLevel = 'off',
    traceId,
    runId = traceId,
  }) {
    if (!TRACE_LEVELS.has(traceLevel)) {
      throw new Error(`unsupported trace level: ${traceLevel}`);
    }
    if (traceLevel !== 'off' && !traceId) {
      throw new Error('traceId is required when tracing is enabled');
    }
    this.runnerRepo = runnerRepo;
    this.bridgeUrl = bridgeUrl;
    this.callerToken = callerToken;
    this.budget = budget;
    this.effort = effort;
    this.traceLevel = traceLevel;
    this.traceId = traceId || null;
    this.runId = runId || null;
    this.nextTraceTurn = 1;
    this.pricing = require(path.join(runnerRepo, 'src/runner/model-pricing.js'));
    this.capabilities = require(path.join(runnerRepo, 'src/runner/model-capabilities.js'));
  }

  traceMetadata() {
    return {
      level: this.traceLevel,
      traceId: this.traceId,
      runId: this.runId,
      bridgeTracePath:
        this.traceLevel === 'off'
          ? null
          : path.join(
              process.env.HOME || '',
              '.claude-local-bridge',
              'traces',
              `${this.traceId}.bridge.jsonl`,
            ),
    };
  }

  async call({
    model,
    system,
    prompt,
    maxTokens,
    label,
    effort = this.effort,
    timeoutMs = 120000,
  }) {
    // The counter is assigned before the network wait. Concurrent workers can
    // finish in any order, but every request still receives one stable number.
    const traceTurn = this.nextTraceTurn++;
    const rates = this.pricing.resolveRates(model);
    // Source code is token-dense, so three characters per token deliberately
    // over-reserves compared with the common four-character approximation.
    const estimatedInputTokens = Math.ceil((system.length + prompt.length) / 3);
    const pessimisticCost =
      (estimatedInputTokens / 1_000_000) * rates.input + (maxTokens / 1_000_000) * rates.output;
    // Await tolerates both budgets: the in-memory CostBudget is synchronous,
    // the durable campaign budget takes a cross-process lock.
    const reservation = await this.budget.reserve(pessimisticCost, label);

    const capability = this.capabilities.capabilityForModel(model);
    // Haiku 4.5 and older families do not accept the newer effort/adaptive
    // controls. The host omits unsupported fields instead of letting a worker
    // spend a request on a predictable validation error.
    const selectedEffort = capability.effortLevels ? effort : 'auto';
    const selectedThinking = ['manual-only', 'manual-or-none'].includes(capability.thinking)
      ? 'auto'
      : 'adaptive';
    const controls = this.capabilities.resolveModelControls({
      model,
      effort: selectedEffort,
      thinking: selectedThinking,
    });
    const body = {
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
      ...(controls.effort ? { output_config: { effort: controls.effort } } : {}),
      ...(controls.thinkingConfig ? { thinking: controls.thinkingConfig } : {}),
    };
    const started = Date.now();
    let response;
    try {
      // Native fetch uses a concurrent connection pool. The runner's buffered
      // client intentionally has one socket, which would serialize this trial.
      response = await postMessage(this.bridgeUrl, body, this.callerToken, {
        level: this.traceLevel,
        traceId: this.traceId,
        runId: this.runId,
        turn: traceTurn,
      }, timeoutMs);
    } catch (error) {
      await this.budget.release(reservation);
      throw error;
    }
    const text = (response.content || [])
      .filter((block) => block && block.type === 'text')
      .map((block) => block.text || '')
      .join('\n')
      .trim();
    const summary = this.pricing.summarizeUsage(model, response.usage || {});
    await this.budget.settle(reservation, {
      label,
      model,
      usage: response.usage || {},
      costUsd: summary.costUsd,
      durationMs: Date.now() - started,
      requestId: response._localBridge?.headers?.['x-request-id'] || null,
      stopReason: response.stop_reason || null,
      traceId: this.traceId,
      traceTurn,
    });
    return {
      text,
      usage: response.usage || {},
      costUsd: summary.costUsd,
      rawStopReason: response.stop_reason,
      traceId: this.traceId,
      traceTurn,
    };
  }
}

async function postMessage(bridgeUrl, body, callerToken, trace = {}, timeoutMs = 120000) {
  const headers = { 'content-type': 'application/json' };
  if (callerToken) headers.authorization = `Bearer ${callerToken}`;
  if (trace.level && trace.level !== 'off') {
    // These are the same correlation headers used by the conventional runner.
    // They ask the bridge to create one request-scoped trace without changing
    // the global VS Code setting or tracing unrelated bridge traffic.
    headers['x-local-bridge-trace-level'] = trace.level;
    headers['x-local-bridge-trace-id'] = trace.traceId;
    headers['x-local-bridge-run-id'] = trace.runId;
    headers['x-local-bridge-trace-turn'] = String(trace.turn);
  }
  let response;
  try {
    response = await fetch(bridgeUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    const error = new Error(`bridge network error: ${cause.message}`);
    error.retryable = true;
    throw error;
  }

  const raw = await response.text();
  if (!response.ok) {
    const error = new Error(`bridge returned HTTP ${response.status}: ${raw.slice(0, 500)}`);
    error.statusCode = response.status;
    error.retryable = response.status === 429 || response.status >= 500;
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const error = new Error(`bridge returned invalid JSON: ${raw.slice(0, 500)}`);
    error.retryable = false;
    throw error;
  }
  parsed._localBridge = {
    headers: { 'x-request-id': response.headers.get('x-request-id') },
    status_code: response.status,
  };
  return parsed;
}

function normalizeMoneyFloat(value) {
  // Decimal currency arithmetic stored in binary can leave values such as
  // 1.38e-17 after balanced concurrent reservations. Treat sub-picodollar
  // residue as zero so checkpoints reflect the real accounting state.
  return Math.abs(value) < 1e-12 ? 0 : value;
}

class MockBridge {
  constructor({ budget, workerName = 'code_analyst' }) {
    this.budget = budget;
    this.workerName = workerName;
  }

  async call({ label }) {
    let text;
    if (label.startsWith('plan:')) {
      text = `def plan(ctx):
    jobs = []
    for doc in ctx["documents"]:
        jobs.append({
            "id": "analyze_" + doc["id"],
            "worker": "${this.workerName}",
            "task": "Analyze the supplied file for the objective, identify its control boundary, and report one failure mode.",
            "input_ids": [doc["id"]],
            "depends_on": [],
            "timeout_ms": 30000,
            "max_output_tokens": 900,
        })
    return jobs`;
    } else if (label.startsWith('recover:')) {
      text = `def recover(ctx):
    jobs = []
    for failed in ctx["failures"]:
        if failed["retryable"]:
            jobs.append({
                "id": "retry_" + failed["job_id"],
                "retry_of": failed["job_id"],
                "worker": failed["worker"],
                "task": failed["task"] + " This is a bounded retry; return strict JSON.",
                "input_ids": failed["input_ids"],
                "depends_on": [],
                "timeout_ms": 30000,
                "max_output_tokens": 900,
            })
    return jobs`;
    } else if (label.startsWith('worker:')) {
      text = JSON.stringify({
        summary: `Deterministic mock analysis for ${label}`,
        claims: ['The host owns the authority boundary.'],
        evidence: ['Supplied fixture text'],
        confidence: 0.9,
      });
    } else {
      text = 'Mock synthesis: the host validated plans, recorded failures, retried eligible work, and retained artifacts.';
    }
    const call = { label, model: 'mock', usage: {}, costUsd: 0, durationMs: 1, requestId: null };
    await this.budget.record(call);
    return { text, usage: {}, costUsd: 0, rawStopReason: 'end_turn' };
  }
}

module.exports = { ClaudeBridge, CostBudget, MockBridge, postMessage };
