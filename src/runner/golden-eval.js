'use strict';

/**
 * golden-eval.js — Replay canned model transcripts and assert runner-side behavior.
 *
 * Used by `runner eval` and test/runner/golden-eval.test.js. No live OAuth/model calls.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const modelClient = require('./model-client');
const confirm = require('./confirmation');
const { run } = require('./run');

const DEFAULT_GOLDEN_DIR = path.join(__dirname, '../../test/runner/golden');

const SECRET_PATTERNS = [
  /sk-ant-[a-zA-Z0-9_-]+/g,
  /Bearer\s+[A-Za-z0-9._-]+/gi,
  /\bghp_[A-Za-z0-9]{20,}\b/g,
];

function listGoldenCases(dir = DEFAULT_GOLDEN_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => path.join(dir, name));
}

function loadGoldenCase(casePath) {
  const raw = JSON.parse(fs.readFileSync(casePath, 'utf8'));
  if (!raw.id) raw.id = path.basename(casePath, '.json');
  if (!raw.prompt) throw new Error('Golden case missing prompt: ' + casePath);
  if (!Array.isArray(raw.model_script) || raw.model_script.length === 0) {
    throw new Error('Golden case missing model_script: ' + casePath);
  }
  return raw;
}

function setupCaseWorkspace(baseDir, caseData) {
  const cwd = path.join(baseDir, 'cwd');
  fs.mkdirSync(cwd, { recursive: true });
  const files = caseData.cwd_files || {};
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(cwd, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
  }
  return cwd;
}

function installScriptedModel(script) {
  const originalPost = modelClient.post;
  const originalPostStream = modelClient.postStream;
  let callIndex = 0;

  async function nextResponse() {
    const entry = script[Math.min(callIndex, script.length - 1)];
    callIndex++;
    return {
      id: entry.id || 'msg_golden_' + callIndex,
      content: entry.content || [],
      usage: entry.usage || {},
      stop_reason: entry.stop_reason,
    };
  }

  modelClient.post = async () => nextResponse();
  modelClient.postStream = async () => nextResponse();

  return () => {
    modelClient.post = originalPost;
    modelClient.postStream = originalPostStream;
  };
}

function installConfirmPort(mode) {
  if (!mode) return () => {};
  const originalAsk = confirm.ask;
  confirm.ask = async () => (mode === 'allow' ? 'allow' : 'deny');
  return () => {
    confirm.ask = originalAsk;
  };
}

function readTraceEventTypes(tracePath) {
  if (!tracePath || !fs.existsSync(tracePath)) return [];
  return fs
    .readFileSync(tracePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line).type;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function extractToolSequence(events) {
  const sequence = [];
  for (const event of events || []) {
    if (event.type !== 'tool_result') continue;
    sequence.push({
      name: event.name,
      ok: !event.is_error,
      permission: event.permission || null,
    });
  }
  return sequence;
}

function listTouchedFiles(cwd, beforeSnapshot) {
  const touched = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const rel = path.relative(cwd, full);
      if (beforeSnapshot.has(rel)) continue;
      touched.push(rel);
    }
  }
  walk(cwd);
  return touched.sort();
}

function snapshotRelativeFiles(cwd) {
  const set = new Set();
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      set.add(path.relative(cwd, full));
    }
  }
  walk(cwd);
  return set;
}

function redactSecrets(text) {
  let out = String(text);
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, '<REDACTED>');
  }
  return out;
}

function normalizeValue(value, ctx) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    let text = value;
    if (ctx.cwd) text = text.split(ctx.cwd).join('<CWD>');
    if (ctx.home) text = text.split(ctx.home).join('<HOME>');
    text = text.replace(/\/tmp\/[^\s"']+/g, '<TMP>');
    text = text.replace(/\b\d{4}-\d{2}-\d{2}T[\d:.]+Z\b/g, '<TS>');
    text = text.replace(/\brun_[a-f0-9]+\b/g, '<RUN_ID>');
    text = text.replace(/\bmsg_[a-zA-Z0-9_]+\b/g, '<MSG_ID>');
    text = text.replace(/\btu[a-zA-Z0-9_-]+\b/g, '<TOOL_USE_ID>');
    return redactSecrets(text);
  }
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item, ctx));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = normalizeValue(nested, ctx);
    }
    return out;
  }
  return value;
}

function normalizeSnapshot(snapshot, ctx) {
  return normalizeValue(snapshot, ctx);
}

async function executeGoldenCase(caseData, options = {}) {
  const tmpRoot = options.tmpRoot || fs.mkdtempSync(path.join(os.tmpdir(), 'golden-eval-'));
  const cwd = setupCaseWorkspace(tmpRoot, caseData);
  const tracePath = path.join(tmpRoot, 'trace.jsonl');
  const transcriptPath = path.join(tmpRoot, 'transcript.jsonl');
  const beforeFiles = snapshotRelativeFiles(cwd);

  const restoreModel = installScriptedModel(caseData.model_script);
  const restoreConfirm = installConfirmPort(caseData.confirm);

  const runOpts = {
    prompt: caseData.prompt,
    cwd,
    model: 'golden-test-model',
    maxTokens: 256,
    maxSteps: 4,
    bare: true,
    quiet: true,
    skipTrustGate: true,
    noArchive: true,
    noSessionPersistence: true,
    outputFormat: 'text',
    traceLevel: 'summary',
    tracePath,
    transcriptPath,
    ...(caseData.run || {}),
  };

  let result;
  const originalWrite = process.stdout.write;
  process.stdout.write = () => true;
  try {
    result = await run(runOpts);
  } finally {
    process.stdout.write = originalWrite;
    restoreModel();
    restoreConfirm();
  }

  const actual = normalizeSnapshot(
    {
      stopReason: result.stopReason,
      steps: result.steps,
      tool_sequence: extractToolSequence(result.events),
      stream_event_types: (result.events || []).map((event) => event.type),
      trace_event_types: readTraceEventTypes(tracePath),
      files_touched: listTouchedFiles(cwd, beforeFiles),
    },
    { cwd, home: os.homedir() },
  );

  return { actual, tmpRoot, cwd, result };
}

function diffObjects(expected, actual, label = '') {
  const diffs = [];
  const keys = new Set([...Object.keys(expected || {}), ...Object.keys(actual || {})]);
  for (const key of [...keys].sort()) {
    const pathLabel = label ? label + '.' + key : key;
    const exp = expected ? expected[key] : undefined;
    const act = actual ? actual[key] : undefined;
    if (Array.isArray(exp) || Array.isArray(act)) {
      const expJson = JSON.stringify(exp ?? []);
      const actJson = JSON.stringify(act ?? []);
      if (expJson !== actJson) {
        diffs.push({ path: pathLabel, expected: exp, actual: act });
      }
      continue;
    }
    if (exp !== null && exp !== undefined && typeof exp === 'object' && act !== null && act !== undefined && typeof act === 'object') {
      diffs.push(...diffObjects(exp, act, pathLabel));
      continue;
    }
    if (exp !== act) {
      diffs.push({ path: pathLabel, expected: exp, actual: act });
    }
  }
  return diffs;
}

function formatDiffs(caseId, diffs) {
  const lines = ['Golden regression: ' + caseId];
  for (const diff of diffs) {
    lines.push('  ' + diff.path);
    lines.push('    expected: ' + JSON.stringify(diff.expected));
    lines.push('    actual:   ' + JSON.stringify(diff.actual));
  }
  return lines.join('\n');
}

async function runGoldenEval(options = {}) {
  const dir = options.dir || DEFAULT_GOLDEN_DIR;
  const filter = options.filter || null;
  const update = !!options.update;
  const verbose = !!options.verbose;

  const casePaths = listGoldenCases(dir).filter((casePath) => {
    if (!filter) return true;
    const base = path.basename(casePath, '.json');
    return base.includes(filter) || casePath.includes(filter);
  });

  if (casePaths.length === 0) {
    throw new Error('No golden cases found in ' + dir);
  }

  const results = [];
  let failed = 0;

  for (const casePath of casePaths) {
    const caseData = loadGoldenCase(casePath);
    const { actual } = await executeGoldenCase(caseData);

    if (update) {
      caseData.expect = actual;
      fs.writeFileSync(casePath, JSON.stringify(caseData, null, 2) + '\n', 'utf8');
      if (verbose) console.error('[golden] updated ' + casePath);
      results.push({ id: caseData.id, ok: true, updated: true });
      continue;
    }

    if (!caseData.expect) {
      failed++;
      results.push({ id: caseData.id, ok: false, error: 'missing expect block (run with --update)' });
      continue;
    }

    const diffs = diffObjects(caseData.expect, actual);
    if (diffs.length) {
      failed++;
      const message = formatDiffs(caseData.id, diffs);
      if (verbose) console.error(message);
      results.push({ id: caseData.id, ok: false, diffs, message });
    } else {
      if (verbose) console.error('[golden] ok ' + caseData.id);
      results.push({ id: caseData.id, ok: true });
    }
  }

  return { ok: failed === 0, failed, total: casePaths.length, results };
}

module.exports = {
  DEFAULT_GOLDEN_DIR,
  listGoldenCases,
  loadGoldenCase,
  setupCaseWorkspace,
  normalizeSnapshot,
  executeGoldenCase,
  diffObjects,
  runGoldenEval,
};
