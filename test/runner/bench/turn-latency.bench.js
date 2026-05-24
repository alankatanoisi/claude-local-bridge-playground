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
//
// Flags:
//   --runs N    number of independent run() invocations (default 10)
//   --steps N   maxSteps per run (default 6 — yields ~3 model turns per run
//               with the alternating tool/answer canned script)
//   --json      emit JSON instead of human-readable summary
//
// The bench writes a JSON report to stdout in --json mode so callers can diff
// before/after across perf changes. Track in particular:
//   • req_p95_ms / req_mean_ms — per-turn loop overhead
//   • cache_control.mean_breakpoints_per_request — should be 3 after A1
//   • ledger_writes_per_run — should drop after C1/C2 land

const path = require('path');
const os = require('os');
const fs = require('fs');

const modelClient = require('../../../src/runner/model-client');
const { run } = require('../../../src/runner/run');

function parseArgs(argv) {
  const args = { runs: 10, steps: 6, json: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--runs') args.runs = Number(argv[++i]);
    else if (argv[i] === '--steps') args.steps = Number(argv[++i]);
    else if (argv[i] === '--json') args.json = true;
    else if (argv[i] === '--help' || argv[i] === '-h') {
      process.stdout.write(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 22).join('\n') + '\n');
      process.exit(0);
    }
  }
  return args;
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

  const turnOverheadMs = [];
  const runWallMs = [];
  let totalRequests = 0;
  const cacheTotals = { sys: 0, tools: 0, msgs: 0 };
  let lastPostEnd = 0;
  let requestsThisRun = 0;

  const originalPost = modelClient.post;
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

  const tmpDir = setupTmpWorkspace();
  // Runner prints the final answer via console.log when outputFormat is 'text'.
  // That's noise inside the bench, so swallow it for the duration of the runs.
  const realLog = console.log;
  console.log = () => {};
  try {
    for (let i = 0; i < args.runs; i++) {
      requestsThisRun = 0;
      lastPostEnd = 0;
      const start = Date.now();
      await run({
        prompt: 'bench prompt ' + i,
        cwd: tmpDir,
        model: 'bench-model',
        maxTokens: 64,
        maxSteps: args.steps,
        quiet: true,
        skipTrustGate: true,
      });
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
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
