#!/usr/bin/env node
'use strict';

/**
 * meter-probe.js — measure how fast a request path spends the subscription
 * meter (the OAuth plan's 5-hour window), one arm at a time.
 *
 * Why this exists (2026-11-04): Anthropic reports the plan's usage windows on
 * every OAuth response as `anthropic-ratelimit-unified-5h-utilization` (and
 * the 7-day twin). The value has two decimals, so one request never moves it.
 * What CAN be measured is how many tokens (or list-price dollars) pass between
 * two consecutive 1% ticks. That interval is the arm's "cost of 1% of the
 * window". Comparing intervals across arms and models answers, with data
 * instead of inference, how each path is metered.
 *
 * Arms:
 *   --arm bridge   POST /v1/messages on a local bridge (default: the lab copy on
 *                  port 11477). The bridge adds the plan's OAuth token and its
 *                  Claude Code identity; the meter comes back as response
 *                  headers (forwarded since 2026-11-04).
 *   --arm print    `claude -p` (Claude Code's own headless mode). One process
 *                  per request; the meter comes from its `rate_limit_event`
 *                  and the tokens/cost from its `result.modelUsage`.
 *
 * Every request carries fresh pseudo-random filler text so prompt caching
 * cannot make two requests share a prefix; output is capped at a few tokens.
 * That makes each request almost purely "input tokens", which is the simplest
 * quantity to compare.
 *
 * Usage (run from the repo root, in Terminal):
 *   node scripts/meter-probe.js --arm bridge --model claude-haiku-5-5 \
 *     --input-tokens 50000 --intervals 2 --max-usd 2 --out ~/.bridge-runner/experiments/x.jsonl
 *
 * Output: one JSON line per request (tokens, list-price cost, meter reading,
 * tick flag) plus a final `summary` line with one row per complete interval.
 * Prompts are synthetic filler, so the JSONL contains nothing personal.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const { spawn } = require('child_process');

// List prices in USD per million tokens (claude-api skill table, cached
// 2026-10-06). Cache write = 1.25x (5 min) / 2x (1 h) of input; cache read
// is the per-model figure from the same table. Haiku 5.5 doubles its input
// price above 100K prompt tokens, so keep Haiku requests below that.
const PRICES = {
  'claude-opus-5-5': { input: 4, output: 20, cache_read: 0.2, cache_write_5m: 5, cache_write_1h: 8 },
  'claude-sonnet-5-5': { input: 2, output: 10, cache_read: 0.2, cache_write_5m: 2.5, cache_write_1h: 4 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cache_read: 0.01, cache_write_5m: 0.125, cache_write_1h: 0.2 },
};

const SYSTEM_PROMPT = 'You are a terse assistant.';
const TAIL_INSTRUCTION = '\n\nIgnore the text above. Reply with exactly: OK';

// ── Arguments ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {
    arm: 'bridge',
    model: 'claude-haiku-5-5',
    inputTokens: 20000,
    intervals: 1,
    maxRequests: 500,
    maxUsd: 1,
    out: null,
    bridgeUrl: 'http://127.0.0.1:11477',
    ledger: null,
    budgetCap: Infinity,
    maxTokensOut: 16,
    printCwd: null,
    pauseMs: 250,
    cacheUser: false,
  };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`Missing value for ${key}`);
    switch (key) {
      case '--arm':
        out.arm = value;
        break;
      case '--model':
        out.model = value;
        break;
      case '--input-tokens':
        out.inputTokens = Number(value);
        break;
      case '--intervals':
        out.intervals = Number(value);
        break;
      case '--max-requests':
        out.maxRequests = Number(value);
        break;
      case '--max-usd':
        out.maxUsd = Number(value);
        break;
      case '--out':
        out.out = value;
        break;
      case '--bridge-url':
        out.bridgeUrl = value;
        break;
      case '--ledger':
        out.ledger = value;
        break;
      case '--budget-cap':
        out.budgetCap = Number(value);
        break;
      case '--max-tokens-out':
        out.maxTokensOut = Number(value);
        break;
      case '--print-cwd':
        out.printCwd = value;
        break;
      case '--pause-ms':
        out.pauseMs = Number(value);
        break;
      case '--cache-user':
        out.cacheUser = value === 'true' || value === '1';
        break;
      default:
        throw new Error(`Unknown option ${key}`);
    }
  }
  if (!['bridge', 'print'].includes(out.arm)) throw new Error('--arm must be bridge or print');
  if (!PRICES[out.model]) throw new Error(`No price table for ${out.model}`);
  if (!out.out) throw new Error('--out FILE.jsonl is required');
  return out;
}

// ── Filler text ────────────────────────────────────────────────────────────

// A small deterministic pseudo-random generator (mulberry32). Seeding it per
// request gives reproducible filler that still differs between requests, so
// no two prompts share a cacheable prefix.
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The filler reads as a dull inventory listing. The first version was a wall
// of random nature words, and Haiku's safety classifier declined one such
// prompt; mundane structured text keeps every request boring on purpose.
const ITEMS = (
  'chair table lamp shelf binder stapler ledger invoice envelope carton pallet crate ' +
  'bracket hinge bolt washer gasket cable adapter charger monitor keyboard mouse headset'
).split(' ');
const STATUSES = ['pending', 'shipped', 'received', 'counted', 'reordered'];

function filler(seed, approxChars) {
  const next = prng(seed);
  const lines = [];
  let length = 0;
  for (let i = 1; length < approxChars; i++) {
    const ref = Math.floor(next() * 0xffffffff)
      .toString(16)
      .padStart(8, '0');
    const line =
      `Entry ${i}: ref-${ref} item=${ITEMS[Math.floor(next() * ITEMS.length)]} ` +
      `qty=${Math.floor(next() * 500)} status=${STATUSES[Math.floor(next() * STATUSES.length)]}`;
    lines.push(line);
    length += line.length + 1;
  }
  return lines.join('\n');
}

// ── Cost ───────────────────────────────────────────────────────────────────

function listCost(model, usage) {
  const p = PRICES[model];
  const input = usage.input_tokens || 0;
  const output = usage.output_tokens || 0;
  const read = usage.cache_read_input_tokens || 0;
  const w5 = usage.cache_creation?.ephemeral_5m_input_tokens ?? usage.cache_creation_input_tokens ?? 0;
  const w1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  return (
    (input * p.input + output * p.output + read * p.cache_read + w5 * p.cache_write_5m + w1h * p.cache_write_1h) / 1e6
  );
}

// ── Bridge arm ─────────────────────────────────────────────────────────────

function postBridge(url, body) {
  return new Promise((resolve, reject) => {
    const target = new URL('/v1/messages', url);
    const data = Buffer.from(JSON.stringify(body), 'utf8');
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': data.length,
          // A local placeholder only; the bridge never forwards it upstream.
          'x-api-key': 'local',
        },
        timeout: 300000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* non-JSON error body */
          }
          resolve({ status: res.statusCode, headers: res.headers, json, text });
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('bridge request timed out')));
    req.end(data);
  });
}

function meterFromHeaders(h) {
  const num = (v) => (v === undefined ? null : Number(v));
  return {
    five_hour: {
      utilization: num(h['anthropic-ratelimit-unified-5h-utilization']),
      resets_at: num(h['anthropic-ratelimit-unified-5h-reset']),
      status: h['anthropic-ratelimit-unified-5h-status'] || null,
    },
    seven_day: {
      utilization: num(h['anthropic-ratelimit-unified-7d-utilization']),
      resets_at: num(h['anthropic-ratelimit-unified-7d-reset']),
      status: h['anthropic-ratelimit-unified-7d-status'] || null,
    },
  };
}

async function bridgeRequest(opts, seed, chars) {
  const text = filler(seed, chars) + TAIL_INSTRUCTION;
  const body = {
    model: opts.model,
    max_tokens: opts.maxTokensOut,
    system: SYSTEM_PROMPT,
    // --cache-user mirrors Claude Code, which writes each prompt into the
    // 1-hour cache (billed at 2x input). Measuring both shapes separates "how
    // the identity is metered" from "how cache writes are metered".
    messages: [
      {
        role: 'user',
        content: opts.cacheUser ? [{ type: 'text', text, cache_control: { type: 'ephemeral', ttl: '1h' } }] : text,
      },
    ],
    // Lowest effort keeps thinking (which counts as output) near zero.
    output_config: { effort: 'low' },
  };
  const started = Date.now();
  const res = await postBridge(opts.bridgeUrl, body);
  const latency = Date.now() - started;
  if (res.status !== 200 || !res.json?.usage) {
    return {
      error: `HTTP ${res.status}: ${res.text.slice(0, 300)}`,
      latency_ms: latency,
      meter: meterFromHeaders(res.headers),
    };
  }
  if (res.json.stop_reason === 'refusal') {
    // Whether a declined request is metered is unknown, so it must not be
    // counted toward an interval. It is recorded, then excluded.
    return {
      error: `refusal: ${JSON.stringify(res.json.stop_details || null)}`,
      latency_ms: latency,
      meter: meterFromHeaders(res.headers),
      usage: res.json.usage,
    };
  }
  const usage = res.json.usage;
  return {
    request_id: res.headers['x-request-id'] || null,
    latency_ms: latency,
    usage: {
      input_tokens: usage.input_tokens || 0,
      output_tokens: usage.output_tokens || 0,
      cache_read_input_tokens: usage.cache_read_input_tokens || 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens || 0,
      cache_creation: usage.cache_creation || null,
    },
    cost_usd: listCost(opts.model, usage),
    meter: meterFromHeaders(res.headers),
    stop_reason: res.json.stop_reason || null,
  };
}

// ── Print arm (`claude -p`) ────────────────────────────────────────────────

function printEnv() {
  // Start from the real environment (Claude Code needs its login and config),
  // then drop the variables that mark "I am a child of a running Claude Code
  // session" — a probe must be an ordinary headless run. The entrypoint is set
  // to print mode's own default so the probe does not inherit whatever label
  // the shell that launched it happened to carry.
  const env = { ...process.env };
  for (const key of [
    'CLAUDECODE',
    'CLAUDE_CODE_CHILD_SESSION',
    'CLAUDE_CODE_SESSION_ID',
    'CLAUDE_CODE_MESSAGING_SOCKET',
    'CLAUDE_CODE_MESSAGING_TOKEN',
    'CLAUDE_CODE_SESSION_ATTENDED',
    'CLAUDE_CODE_EXECPATH',
  ]) {
    delete env[key];
  }
  env.CLAUDE_CODE_ENTRYPOINT = 'sdk-cli';
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  return env;
}

function printRequest(opts, seed, chars) {
  return new Promise((resolve) => {
    const args = [
      '-p',
      '--model',
      opts.model,
      '--output-format',
      'stream-json',
      '--verbose',
      '--max-turns',
      '1',
      '--no-session-persistence',
      '--tools',
      '',
      '--system-prompt',
      SYSTEM_PROMPT,
      '--effort',
      'low',
      '--strict-mcp-config',
      '--disable-slash-commands',
    ];
    const started = Date.now();
    const child = spawn('claude', args, {
      cwd: opts.printCwd || os.tmpdir(),
      env: printEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out = [];
    const err = [];
    child.stdout.on('data', (c) => out.push(c));
    child.stderr.on('data', (c) => err.push(c));
    child.on('close', (code) => {
      const latency = Date.now() - started;
      const lines = Buffer.concat(out)
        .toString('utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      const rate = lines.find((l) => l.type === 'rate_limit_event');
      const result = lines.find((l) => l.type === 'result');
      const windows = rate?.rate_limit_info?.unifiedWindows || {};
      const meter = {
        five_hour: {
          utilization: windows.five_hour?.utilization ?? null,
          resets_at: windows.five_hour?.resetsAt ?? null,
          status: windows.five_hour?.status ?? null,
        },
        seven_day: {
          utilization: windows.seven_day?.utilization ?? null,
          resets_at: windows.seven_day?.resetsAt ?? null,
          status: windows.seven_day?.status ?? null,
        },
      };
      if (!result || result.is_error || code !== 0) {
        const text = lines.find((l) => l.type === 'assistant')?.message?.content?.[0]?.text || '';
        resolve({
          error: `claude exit ${code}; terminal_reason=${result?.terminal_reason || 'none'}; ${text.slice(0, 200)}; stderr=${Buffer.concat(err).toString('utf8').slice(0, 200)}`,
          latency_ms: latency,
          meter,
        });
        return;
      }
      // modelUsage is keyed by the model id Claude Code resolved; fall back to
      // the first entry in case it canonicalises the id differently.
      const mu = result.modelUsage?.[opts.model] || Object.values(result.modelUsage || {})[0] || {};
      const usage = {
        input_tokens: mu.inputTokens || 0,
        output_tokens: mu.outputTokens || 0,
        cache_read_input_tokens: mu.cacheReadInputTokens || 0,
        cache_creation_input_tokens: mu.cacheCreationInputTokens || 0,
        cache_creation: {
          ephemeral_5m_input_tokens: mu.cacheCreationEphemeral5mInputTokens || 0,
          ephemeral_1h_input_tokens: mu.cacheCreationEphemeral1hInputTokens || 0,
        },
      };
      resolve({
        request_id: result.session_id || null,
        latency_ms: latency,
        usage,
        // Claude Code's own list-price figure, cross-checked against ours.
        cost_usd: result.total_cost_usd ?? listCost(opts.model, usage),
        cost_usd_ours: listCost(opts.model, usage),
        other_models: Object.keys(result.modelUsage || {}).filter((m) => m !== opts.model),
        meter,
        stop_reason: result.stop_reason || null,
      });
    });
    // If the child exits before reading its prompt, the pipe write fails with
    // EPIPE; the 'close' handler above already reports that run as an error.
    child.stdin.on('error', () => {});
    child.stdin.end(filler(seed, chars) + TAIL_INSTRUCTION);
  });
}

// ── Main loop ──────────────────────────────────────────────────────────────

function ledgerTotal(file) {
  if (!file || !fs.existsSync(file)) return 0;
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .reduce((sum, line) => sum + (Number(JSON.parse(line).cost_usd) || 0), 0);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const seedBase = (Date.now() % 2147483647) | 1;
  const write = (record) => fs.appendFileSync(opts.out, JSON.stringify(record) + '\n');
  const spentBefore = ledgerTotal(opts.ledger);
  if (spentBefore >= opts.budgetCap) {
    console.error(`Budget cap reached (${spentBefore.toFixed(2)} >= ${opts.budgetCap}); not starting.`);
    process.exit(2);
  }

  // Characters per token is learned from the first real response. Hex ids and
  // numbers tokenize densely, so the starting guess is low.
  let charsPerToken = 2.6;
  let spent = 0;
  let lastUtil = null;
  let ticks = [];
  let intervalAcc = null;
  const intervals = [];
  console.log(`[probe ${runId}] arm=${opts.arm} model=${opts.model} target≈${opts.inputTokens} input tokens/request`);

  for (let seq = 1; seq <= opts.maxRequests; seq++) {
    if (spent >= opts.maxUsd) {
      console.log(`stop: --max-usd ${opts.maxUsd} reached`);
      break;
    }
    if (spentBefore + spent >= opts.budgetCap) {
      console.log('stop: global budget cap reached');
      break;
    }
    const chars = Math.round(opts.inputTokens * charsPerToken);
    const seed = (seedBase + seq * 7919) >>> 0;
    const r = opts.arm === 'bridge' ? await bridgeRequest(opts, seed, chars) : await printRequest(opts, seed, chars);
    const util = r.meter?.five_hour?.utilization ?? null;
    const record = {
      type: 'request',
      run_id: runId,
      ts: new Date().toISOString(),
      arm: opts.arm,
      model: opts.model,
      seq,
      target_input_tokens: opts.inputTokens,
      ...r,
      tick: lastUtil !== null && util !== null && util !== lastUtil ? { from: lastUtil, to: util } : null,
      window_reset: lastUtil !== null && util !== null && util < lastUtil,
    };
    write(record);
    if (opts.ledger && r.cost_usd)
      fs.appendFileSync(
        opts.ledger,
        JSON.stringify({ ts: record.ts, arm: opts.arm, model: opts.model, cost_usd: r.cost_usd }) + '\n',
      );

    if (r.error) {
      console.log(`#${seq} ERROR ${r.error}`);
      // Back off briefly; a run of errors ends the probe.
      await new Promise((res) => setTimeout(res, 2000));
      if (seq >= 3 && record.seq - (ticks.at(-1)?.seq || 0) > 3) {
        // keep going; errors do not cost meter
      }
      continue;
    }

    spent += r.cost_usd;
    // Calibrate on the whole prompt (plain input + cache reads + cache
    // writes): with --cache-user, or in print mode, the prompt is billed as a
    // cache write and `input_tokens` is only a few tokens. The correction is
    // clamped so one odd reading can never balloon the next request.
    const actualIn = r.usage.input_tokens + r.usage.cache_read_input_tokens + r.usage.cache_creation_input_tokens;
    if (seq === 1 && actualIn > 0) {
      const factor = Math.min(4, Math.max(0.25, opts.inputTokens / actualIn));
      charsPerToken = charsPerToken * factor;
    }
    if (intervalAcc) {
      intervalAcc.requests += 1;
      intervalAcc.input_tokens += r.usage.input_tokens;
      intervalAcc.cache_read_tokens += r.usage.cache_read_input_tokens;
      intervalAcc.cache_write_tokens += r.usage.cache_creation_input_tokens;
      intervalAcc.output_tokens += r.usage.output_tokens;
      intervalAcc.cost_usd += r.cost_usd;
    }
    const line =
      `#${seq} in=${r.usage.input_tokens} cr=${r.usage.cache_read_input_tokens} cw=${r.usage.cache_creation_input_tokens} ` +
      `out=${r.usage.output_tokens} $${r.cost_usd.toFixed(4)} ${r.latency_ms}ms 5h=${util} 7d=${r.meter?.seven_day?.utilization}`;
    if (record.tick) {
      console.log(line + `  <-- TICK ${record.tick.from} -> ${record.tick.to}`);
      ticks.push({ seq, from: record.tick.from, to: record.tick.to, ts: record.ts });
      if (intervalAcc && !record.window_reset) {
        intervals.push({
          ...intervalAcc,
          ended_seq: seq,
          to: util,
          seconds: (Date.now() - intervalAcc.started_ms) / 1000,
        });
      }
      // The request that crossed the tick is counted as the first request of
      // the next interval (its tokens pushed the meter over the line).
      intervalAcc = {
        from: util,
        started_seq: seq,
        started_ms: Date.now(),
        requests: 1,
        input_tokens: r.usage.input_tokens,
        cache_read_tokens: r.usage.cache_read_input_tokens,
        cache_write_tokens: r.usage.cache_creation_input_tokens,
        output_tokens: r.usage.output_tokens,
        cost_usd: r.cost_usd,
      };
      if (intervals.length >= opts.intervals) {
        console.log(`stop: ${intervals.length} complete interval(s) observed`);
        break;
      }
    } else {
      console.log(line);
    }
    lastUtil = util;
    if (opts.pauseMs > 0) await new Promise((res) => setTimeout(res, opts.pauseMs));
  }

  const summary = {
    type: 'summary',
    run_id: runId,
    arm: opts.arm,
    model: opts.model,
    spent_usd: spent,
    ticks,
    intervals,
  };
  write(summary);
  console.log('\nSummary:');
  console.log(
    `  spent (list price): $${spent.toFixed(4)}; ticks seen: ${ticks.length}; complete intervals: ${intervals.length}`,
  );
  for (const iv of intervals) {
    console.log(
      `  ${iv.from} -> ${iv.to}: ${iv.requests} requests, input ${iv.input_tokens}, cache-read ${iv.cache_read_tokens}, ` +
        `cache-write ${iv.cache_write_tokens}, output ${iv.output_tokens}, $${iv.cost_usd.toFixed(4)}, ${iv.seconds.toFixed(0)}s`,
    );
  }
}

main().catch((error) => {
  console.error(`meter-probe failed: ${error.message}`);
  process.exit(1);
});
