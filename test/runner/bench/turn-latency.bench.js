'use strict';

// turn-latency.bench.js — Standalone perf harness for the runner loop.
//
// Stubs modelClient.post with canned responses so the bench measures runner
// overhead (context assembly, compaction, tool execution, ledger writes,
// session persistence) without any real network latency.
//
// Usage:
//   node --require ./test/setup.js test/runner/bench/turn-latency.bench.js
//   node --require ./test/setup.js test/runner/bench/turn-latency.bench.js --runs 20 --steps 8 --json
//   node --require ./test/setup.js test/runner/bench/turn-latency.bench.js --live --model claude-sonnet-4-6
//
// Flags:
//   --runs N        number of independent run() invocations (default 10)
//   --steps N       maxSteps per run (default 6 — yields ~3 model turns per
//                   run with the alternating tool/answer canned script)
//   --json          emit JSON instead of human-readable summary
//   --live          target the real bridge instead of the stubbed model.
//                   Reports real cache_read_input_tokens / input_tokens.
//                   Refuses to run with an unknown model. Aborts on estimated
//                   spend > BRIDGE_BENCH_LIVE_MAX_USD (default $0.50).
//                   E2: live mode is opt-in and not run in CI.
//   --model NAME    model identifier (required with --live; e.g.
//                   claude-sonnet-4-6, claude-opus-4-7, claude-haiku-4-5)
//
// The bench writes a JSON report to stdout in --json mode so callers can diff
// before/after across perf changes. Track in particular:
//   • req_p95_ms / req_mean_ms — per-turn loop overhead
//   • cache_control.mean_breakpoints_per_request — should be 3.5–4 after A1/E1
//   • cache_read_input_tokens_ratio (live only) — steady-state target ≥ 0.85

const path = require('path');
const os = require('os');
const fs = require('fs');

const modelClient = require('../../../src/runner/model-client');
const { run } = require('../../../src/runner/run');

// E2: per-1M-token USD pricing for the spend cap. Models not in this table
// are refused under --live so an unknown model can't blow the budget.
const LIVE_MODEL_PRICES_PER_1M = {
  'claude-opus-4-7': { input: 15.0, output: 75.0 },
  'claude-opus-4-6': { input: 15.0, output: 75.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-sonnet-4-5': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5-20251001': { input: 1.0, output: 5.0 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
};

function parseArgs(argv) {
  const args = { runs: 10, steps: 6, json: false, live: false, model: 'bench-model' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--runs') args.runs = Number(argv[++i]);
    else if (argv[i] === '--steps') args.steps = Number(argv[++i]);
    else if (argv[i] === '--json') args.json = true;
    else if (argv[i] === '--live') args.live = true;
    else if (argv[i] === '--model') args.model = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') {
      process.stdout.write(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 30).join('\n') + '\n');
      process.exit(0);
    }
  }
  return args;
}

function estimateLiveCostUsd(model, usage) {
  const prices = LIVE_MODEL_PRICES_PER_1M[model];
  if (!prices) return null;
  const inTok = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
  const outTok = usage.output_tokens || 0;
  return (inTok / 1_000_000) * prices.input + (outTok / 1_000_000) * prices.output;
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function countCacheControl(body) {
  let sys = 0;
  let tools = 0;
  let msgs = 0;
  if (Array.isArray(body.system)) {
    for (const b of body.system) if (b && b.cache_control) sys++;
  }
  if (Array.isArray(body.tools)) {
    for (const t of body.tools) if (t && t.cache_control) tools++;
  }
  if (Array.isArray(body.messages)) {
    for (const m of body.messages) {
      if (Array.isArray(m.content)) {
        for (const b of m.content) if (b && b.cache_control) msgs++;
      }
    }
  }
  return { sys, tools, msgs };
}

function setupTmpWorkspace() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-bench-'));
  fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello\n');
  fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'world\n');
  return tmpDir;
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.live) {
    if (!LIVE_MODEL_PRICES_PER_1M[args.model]) {
      process.stderr.write('--live requires --model from: ' + Object.keys(LIVE_MODEL_PRICES_PER_1M).join(', ') + '\n');
      process.exit(2);
    }
  }

  const turnOverheadMs = [];
  const runWallMs = [];
  let totalRequests = 0;
  const cacheTotals = { sys: 0, tools: 0, msgs: 0 };
  const liveUsageTotals = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
  let liveSpendUsd = 0;
  const liveMaxUsd = (() => {
    const env = parseFloat(process.env.BRIDGE_BENCH_LIVE_MAX_USD);
    return Number.isFinite(env) && env > 0 ? env : 0.5;
  })();
  let lastPostEnd = 0;
  let requestsThisRun = 0;
  let liveBudgetExceeded = false;

  const originalPost = modelClient.post;
  if (args.live) {
    // Live mode: wrap the real post for telemetry + spend tracking. Aborts
    // remaining runs if the estimated total cost exceeds liveMaxUsd.
    modelClient.post = async (body) => {
      totalRequests++;
      requestsThisRun++;
      if (lastPostEnd) turnOverheadMs.push(Date.now() - lastPostEnd);
      const c = countCacheControl(body);
      cacheTotals.sys += c.sys;
      cacheTotals.tools += c.tools;
      cacheTotals.msgs += c.msgs;
      lastPostEnd = Date.now();
      const response = await originalPost(body);
      const u = response.usage || {};
      liveUsageTotals.input_tokens += u.input_tokens || 0;
      liveUsageTotals.output_tokens += u.output_tokens || 0;
      liveUsageTotals.cache_read_input_tokens += u.cache_read_input_tokens || 0;
      liveUsageTotals.cache_creation_input_tokens += u.cache_creation_input_tokens || 0;
      const cost = estimateLiveCostUsd(args.model, u);
      if (cost !== null && cost !== undefined) liveSpendUsd += cost;
      if (liveSpendUsd > liveMaxUsd) {
        liveBudgetExceeded = true;
        const err = new Error(
          'BRIDGE_BENCH_LIVE_MAX_USD ($' +
            liveMaxUsd.toFixed(2) +
            ') exceeded after $' +
            liveSpendUsd.toFixed(4) +
            ' on ' +
            totalRequests +
            ' requests; aborting',
        );
        err.code = 'BENCH_BUDGET_EXCEEDED';
        throw err;
      }
      return response;
    };
  } else {
    modelClient.post = async (body) => {
      totalRequests++;
      requestsThisRun++;
      if (lastPostEnd) turnOverheadMs.push(Date.now() - lastPostEnd);

      const c = countCacheControl(body);
      cacheTotals.sys += c.sys;
      cacheTotals.tools += c.tools;
      cacheTotals.msgs += c.msgs;

      lastPostEnd = Date.now();

      // Alternating script: tool call → final text. Keeps the loop honest
      // (exercises the tool branch and the final-answer branch each run).
      if (requestsThisRun % 2 === 1) {
        return {
          content: [{ type: 'tool_use', id: 'tu' + totalRequests, name: 'list_files', input: { path: '.' } }],
          usage: { input_tokens: 100, output_tokens: 10 },
        };
      }
      return {
        content: [{ type: 'text', text: 'Final answer for request ' + totalRequests }],
        usage: { input_tokens: 100, output_tokens: 5 },
      };
    };
  }

  const tmpDir = setupTmpWorkspace();
  // Runner prints the final answer via console.log when outputFormat is 'text'.
  // That's noise inside the bench, so swallow it for the duration of the runs.
  const realLog = console.log;
  console.log = () => {};
  try {
    for (let i = 0; i < args.runs; i++) {
      if (liveBudgetExceeded) break;
      requestsThisRun = 0;
      lastPostEnd = 0;
      const start = Date.now();
      try {
        await run({
          prompt: 'bench prompt ' + i,
          cwd: tmpDir,
          model: args.model,
          maxTokens: 64,
          maxSteps: args.steps,
          quiet: true,
          skipTrustGate: true,
        });
      } catch (err) {
        if (err && err.code === 'BENCH_BUDGET_EXCEEDED') {
          process.stderr.write(err.message + '\n');
          break;
        }
        throw err;
      }
      runWallMs.push(Date.now() - start);
    }
  } finally {
    console.log = realLog;
    modelClient.post = originalPost;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  const report = {
    runs: args.runs,
    steps_cap_per_run: args.steps,
    total_requests: totalRequests,
    run_wall_ms: {
      mean: runWallMs.reduce((a, b) => a + b, 0) / Math.max(1, runWallMs.length),
      p50: percentile(runWallMs, 50),
      p95: percentile(runWallMs, 95),
      p99: percentile(runWallMs, 99),
    },
    req_overhead_ms: {
      samples: turnOverheadMs.length,
      mean: turnOverheadMs.reduce((a, b) => a + b, 0) / Math.max(1, turnOverheadMs.length),
      p50: percentile(turnOverheadMs, 50),
      p95: percentile(turnOverheadMs, 95),
      p99: percentile(turnOverheadMs, 99),
    },
    cache_control: {
      total_system_breakpoints: cacheTotals.sys,
      total_tool_breakpoints: cacheTotals.tools,
      total_message_breakpoints: cacheTotals.msgs,
      mean_breakpoints_per_request:
        (cacheTotals.sys + cacheTotals.tools + cacheTotals.msgs) / Math.max(1, totalRequests),
    },
  };

  if (args.live) {
    const totalInput =
      liveUsageTotals.input_tokens +
      liveUsageTotals.cache_read_input_tokens +
      liveUsageTotals.cache_creation_input_tokens;
    report.live = {
      model: args.model,
      usage: { ...liveUsageTotals },
      cache_read_input_tokens_ratio: totalInput > 0 ? liveUsageTotals.cache_read_input_tokens / totalInput : 0,
      estimated_spend_usd: liveSpendUsd,
      max_spend_usd: liveMaxUsd,
      budget_exceeded: liveBudgetExceeded,
    };
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return;
  }

  const f = (n) => (typeof n === 'number' ? n.toFixed(2) : String(n));
  console.log('runner bench — turn latency');
  console.log('  runs:             ' + report.runs + ' × maxSteps=' + report.steps_cap_per_run);
  console.log('  total requests:   ' + report.total_requests);
  console.log(
    '  run wall ms:      mean=' +
      f(report.run_wall_ms.mean) +
      '  p50=' +
      report.run_wall_ms.p50 +
      '  p95=' +
      report.run_wall_ms.p95 +
      '  p99=' +
      report.run_wall_ms.p99,
  );
  console.log(
    '  req overhead ms:  mean=' +
      f(report.req_overhead_ms.mean) +
      '  p50=' +
      report.req_overhead_ms.p50 +
      '  p95=' +
      report.req_overhead_ms.p95 +
      '  p99=' +
      report.req_overhead_ms.p99 +
      '  (n=' +
      report.req_overhead_ms.samples +
      ')',
  );
  console.log('  cache_control per request:');
  console.log('    system: ' + (report.cache_control.total_system_breakpoints / Math.max(1, totalRequests)).toFixed(2));
  console.log('    tools:  ' + (report.cache_control.total_tool_breakpoints / Math.max(1, totalRequests)).toFixed(2));
  console.log(
    '    msgs:   ' + (report.cache_control.total_message_breakpoints / Math.max(1, totalRequests)).toFixed(2),
  );
  console.log('    total:  ' + report.cache_control.mean_breakpoints_per_request.toFixed(2) + ' / 4 allowed');
  if (report.live) {
    console.log('  live (model=' + report.live.model + '):');
    console.log('    cache_read_input_tokens_ratio: ' + report.live.cache_read_input_tokens_ratio.toFixed(3));
    console.log(
      '    spend: $' +
        report.live.estimated_spend_usd.toFixed(4) +
        ' / $' +
        report.live.max_spend_usd.toFixed(2) +
        (report.live.budget_exceeded ? ' (BUDGET EXCEEDED, aborted)' : ''),
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
