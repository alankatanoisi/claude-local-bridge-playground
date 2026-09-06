'use strict';

/**
 * golden-eval.js — Replay canned model transcripts and assert runner-side behavior.
 *
 * Used by `runner eval` and test/runner/golden-eval.test.js. No live OAuth/model calls.
 *
 * Two scoring modes coexist per case (a case may use either or both):
 *
 *  - `expect` (legacy snapshot): one recorded snapshot of the whole run
 *    (event orderings included) diffed field-by-field. All-or-nothing and
 *    sensitive to harmless reordering; kept for the original two cases.
 *  - `checklist` (terminal-state predicates, 2026-09 research review idea 2 /
 *    EnvScaler): a list of small named predicates over the FINAL state of the
 *    run — workspace files, stop reason, tool outcomes, trace event types.
 *    Each item passes or fails independently; the case reports a pass
 *    fraction (partial credit) and only a fraction of 1.0 counts as green.
 *    Deterministic and solution-path-agnostic: the run may reach the terminal
 *    state any way it likes.
 *
 * Cases may also be multi-phase (`phases: [...]`) — several run() invocations
 * sharing one workspace and, with `use_session: true`, one session store.
 * That is what resume-shaped cases need (degrade a session, then assert the
 * resume guardrail), and it is the shape kill/resume tests want in general.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const modelClient = require('./model-client');
const confirm = require('./confirmation');
const { run } = require('./run');

const DEFAULT_GOLDEN_DIR = path.join(__dirname, '../../test/runner/golden');

const SECRET_PATTERNS = [/sk-ant-[a-zA-Z0-9_-]+/g, /Bearer\s+[A-Za-z0-9._-]+/gi, /\bghp_[A-Za-z0-9]{20,}\b/g];

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
  const hasPhases = Array.isArray(raw.phases) && raw.phases.length > 0;
  if (hasPhases) {
    for (const [index, phase] of raw.phases.entries()) {
      if (!phase.prompt) throw new Error('Golden case phase ' + (index + 1) + ' missing prompt: ' + casePath);
      if (!Array.isArray(phase.model_script) || phase.model_script.length === 0) {
        throw new Error('Golden case phase ' + (index + 1) + ' missing model_script: ' + casePath);
      }
    }
  } else {
    if (!raw.prompt) throw new Error('Golden case missing prompt: ' + casePath);
    if (!Array.isArray(raw.model_script) || raw.model_script.length === 0) {
      throw new Error('Golden case missing model_script: ' + casePath);
    }
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
  // Symlink fixtures (needed by symlink-deny cases). The value is the link
  // TARGET as written (usually relative, resolved from the link's directory),
  // the key is the link path inside the case cwd.
  const symlinks = caseData.cwd_symlinks || {};
  for (const [rel, target] of Object.entries(symlinks)) {
    const linkPath = path.join(cwd, rel);
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    fs.symlinkSync(target, linkPath);
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

// Richer view of the same tool_result events for checklist predicates: keeps
// the result text so predicates can match on denial/proposal wording. Kept
// separate from extractToolSequence so the legacy `expect` snapshots do not
// change shape.
function extractToolResults(events) {
  const results = [];
  for (const event of events || []) {
    if (event.type !== 'tool_result') continue;
    results.push({
      name: event.name,
      ok: !event.is_error,
      permission: event.permission || null,
      content: typeof event.content === 'string' ? event.content : '',
    });
  }
  return results;
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

// Normalize a case into a list of phases. Single-phase legacy cases keep
// their top-level prompt/model_script/run/confirm.
function casePhases(caseData) {
  if (Array.isArray(caseData.phases) && caseData.phases.length > 0) return caseData.phases;
  return [
    {
      prompt: caseData.prompt,
      model_script: caseData.model_script,
      run: caseData.run,
      confirm: caseData.confirm,
    },
  ];
}

async function executeGoldenCase(caseData, options = {}) {
  const tmpRoot = options.tmpRoot || fs.mkdtempSync(path.join(os.tmpdir(), 'golden-eval-'));
  const cwd = setupCaseWorkspace(tmpRoot, caseData);
  const beforeFiles = snapshotRelativeFiles(cwd);
  const phases = casePhases(caseData);
  // One shared session store path for the whole case: phases that opt in with
  // `use_session: true` read/write the same session, which is how resume
  // cases connect phase 2 to phase 1.
  const sessionPath = path.join(tmpRoot, 'session.state.json');

  const phaseResults = [];
  let result = null;
  let lastTracePath = null;

  for (const [index, phase] of phases.entries()) {
    const phaseNumber = index + 1;
    const tracePath = path.join(tmpRoot, 'trace-' + phaseNumber + '.jsonl');
    const transcriptPath = path.join(tmpRoot, 'transcript-' + phaseNumber + '.jsonl');
    lastTracePath = tracePath;

    const restoreModel = installScriptedModel(phase.model_script);
    const restoreConfirm = installConfirmPort(phase.confirm !== undefined ? phase.confirm : caseData.confirm);

    const runOpts = {
      prompt: phase.prompt,
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
      ...(phase.run || {}),
    };
    if (phase.use_session) {
      runOpts.sessionPath = sessionPath;
      runOpts.noSessionPersistence = false;
    }

    const originalWrite = process.stdout.write;
    // Failure-shaped cases (budget stops, refused resumes) are replayed on
    // purpose; run() sets process.exitCode=1 for them, which would make the
    // node test runner report the whole test FILE as failed even with every
    // assertion green. The eval verdict is the checklist, not the exit code.
    const originalExitCode = process.exitCode;
    process.stdout.write = () => true;
    try {
      result = await run(runOpts);
    } finally {
      process.stdout.write = originalWrite;
      process.exitCode = originalExitCode;
      restoreModel();
      restoreConfirm();
    }

    phaseResults.push({
      phase: phaseNumber,
      stopReason: result.stopReason,
      steps: result.steps,
      finalText: typeof result.finalText === 'string' ? result.finalText : '',
      toolResults: extractToolResults(result.events),
      traceEventTypes: readTraceEventTypes(tracePath),
    });
  }

  const actual = normalizeSnapshot(
    {
      stopReason: result.stopReason,
      steps: result.steps,
      tool_sequence: extractToolSequence(result.events),
      stream_event_types: (result.events || []).map((event) => event.type),
      trace_event_types: readTraceEventTypes(lastTracePath),
      files_touched: listTouchedFiles(cwd, beforeFiles),
    },
    { cwd, home: os.homedir() },
  );

  return { actual, tmpRoot, cwd, result, phases: phaseResults };
}

// ---------------------------------------------------------------------------
// Terminal-state checklist evaluation (research review 2026-08-31, idea 2).
//
// Each checklist item is a small declarative predicate over the terminal
// state: { name, check: <type>, ...args, phase? }. `phase` (1-based) selects
// which phase's result to inspect; it defaults to the LAST phase, because the
// terminal state is what the checklist philosophy scores. File predicates
// always look at the final workspace. Unknown check types FAIL (never
// silently pass) so a typo cannot fabricate green.
// ---------------------------------------------------------------------------

function resolveChecklistFile(cwd, relPath) {
  const target = path.resolve(cwd, relPath);
  // Confine file predicates to the case workspace: a checklist must not be
  // able to read outside its own sandbox cwd.
  if (target !== cwd && !target.startsWith(cwd + path.sep)) {
    return { error: 'checklist path escapes case cwd: ' + relPath };
  }
  return { target };
}

const CHECKLIST_PREDICATES = {
  stop_reason(item, terminal) {
    const phase = pickPhase(item, terminal);
    if (!phase) return { ok: false, detail: 'phase not found' };
    return {
      ok: phase.stopReason === item.equals,
      detail: 'stopReason=' + JSON.stringify(phase.stopReason) + ' expected=' + JSON.stringify(item.equals),
    };
  },
  steps_at_most(item, terminal) {
    const phase = pickPhase(item, terminal);
    if (!phase) return { ok: false, detail: 'phase not found' };
    return { ok: phase.steps <= item.max, detail: 'steps=' + phase.steps + ' max=' + item.max };
  },
  final_text_includes(item, terminal) {
    const phase = pickPhase(item, terminal);
    if (!phase) return { ok: false, detail: 'phase not found' };
    return {
      ok: phase.finalText.includes(item.includes),
      detail: 'finalText did not include ' + JSON.stringify(item.includes),
    };
  },
  file_exists(item, terminal) {
    const resolved = resolveChecklistFile(terminal.cwd, item.path);
    if (resolved.error) return { ok: false, detail: resolved.error };
    return { ok: fs.existsSync(resolved.target), detail: 'missing: ' + item.path };
  },
  file_absent(item, terminal) {
    const resolved = resolveChecklistFile(terminal.cwd, item.path);
    if (resolved.error) return { ok: false, detail: resolved.error };
    return { ok: !fs.existsSync(resolved.target), detail: 'unexpectedly exists: ' + item.path };
  },
  file_content(item, terminal) {
    const resolved = resolveChecklistFile(terminal.cwd, item.path);
    if (resolved.error) return { ok: false, detail: resolved.error };
    if (!fs.existsSync(resolved.target)) return { ok: false, detail: 'missing: ' + item.path };
    const content = fs.readFileSync(resolved.target, 'utf8');
    if (typeof item.equals === 'string') {
      return { ok: content === item.equals, detail: 'content mismatch for ' + item.path };
    }
    if (typeof item.includes === 'string') {
      return {
        ok: content.includes(item.includes),
        detail: 'content of ' + item.path + ' lacks ' + JSON.stringify(item.includes),
      };
    }
    return { ok: false, detail: 'file_content needs equals or includes' };
  },
  tool_called(item, terminal) {
    const results = toolResultsFor(item, terminal);
    return { ok: results.some((r) => r.name === item.tool), detail: item.tool + ' was never called' };
  },
  tool_not_called(item, terminal) {
    const results = toolResultsFor(item, terminal);
    return { ok: !results.some((r) => r.name === item.tool), detail: item.tool + ' was called' };
  },
  tool_ok(item, terminal) {
    const results = toolResultsFor(item, terminal);
    return { ok: results.some((r) => r.name === item.tool && r.ok), detail: 'no ok result for ' + item.tool };
  },
  tool_errored(item, terminal) {
    const results = toolResultsFor(item, terminal);
    return { ok: results.some((r) => r.name === item.tool && !r.ok), detail: 'no errored result for ' + item.tool };
  },
  tool_denied(item, terminal) {
    const results = toolResultsFor(item, terminal);
    return {
      ok: results.some((r) => r.name === item.tool && r.permission && r.permission.decision === 'deny'),
      detail: 'no permission-denied result for ' + item.tool,
    };
  },
  tool_result_includes(item, terminal) {
    const results = toolResultsFor(item, terminal);
    return {
      ok: results.some((r) => r.name === item.tool && r.content.includes(item.includes)),
      detail: 'no ' + item.tool + ' result containing ' + JSON.stringify(item.includes),
    };
  },
  // Leak check: NO result of this tool may contain the string. Passes when the
  // tool was never called at all — absence of the leak is the invariant.
  tool_result_lacks(item, terminal) {
    const results = toolResultsFor(item, terminal);
    return {
      ok: !results.some((r) => r.name === item.tool && r.content.includes(item.lacks)),
      detail: 'a ' + item.tool + ' result contained ' + JSON.stringify(item.lacks),
    };
  },
  trace_has_event(item, terminal) {
    return { ok: allTraceTypes(terminal).includes(item.event), detail: 'trace lacks event ' + item.event };
  },
  trace_lacks_event(item, terminal) {
    return { ok: !allTraceTypes(terminal).includes(item.event), detail: 'trace contains event ' + item.event };
  },
};

function pickPhase(item, terminal) {
  const phases = terminal.phases || [];
  if (item.phase) return phases[item.phase - 1] || null;
  return phases[phases.length - 1] || null;
}

function toolResultsFor(item, terminal) {
  // Tool predicates default to ALL phases (a tool call is a terminal fact of
  // the whole case) unless an explicit phase pins them down.
  if (item.phase) {
    const phase = pickPhase(item, terminal);
    return phase ? phase.toolResults : [];
  }
  return (terminal.phases || []).flatMap((phase) => phase.toolResults);
}

function allTraceTypes(terminal) {
  return (terminal.phases || []).flatMap((phase) => phase.traceEventTypes);
}

function evaluateChecklist(checklist, terminal) {
  const items = [];
  for (const [index, item] of (checklist || []).entries()) {
    const name = item.name || item.check + '#' + (index + 1);
    const predicate = CHECKLIST_PREDICATES[item.check];
    if (!predicate) {
      items.push({ name, ok: false, detail: 'unknown check type: ' + JSON.stringify(item.check) });
      continue;
    }
    let outcome;
    try {
      outcome = predicate(item, terminal);
    } catch (err) {
      outcome = { ok: false, detail: 'predicate threw: ' + err.message };
    }
    items.push({ name, ok: !!outcome.ok, detail: outcome.ok ? null : outcome.detail });
  }
  const passed = items.filter((item) => item.ok).length;
  return {
    total: items.length,
    passed,
    fraction: items.length ? passed / items.length : 0,
    items,
  };
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
    if (
      exp !== null &&
      exp !== undefined &&
      typeof exp === 'object' &&
      act !== null &&
      act !== undefined &&
      typeof act === 'object'
    ) {
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

function formatChecklistFailures(caseId, checklistResult) {
  const lines = [
    'Golden checklist: ' + caseId + ' — ' + checklistResult.passed + '/' + checklistResult.total + ' predicates passed',
  ];
  for (const item of checklistResult.items) {
    if (item.ok) continue;
    lines.push('  ✗ ' + item.name + (item.detail ? ' — ' + item.detail : ''));
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
    const { actual, phases, cwd } = await executeGoldenCase(caseData);

    if (update) {
      // --update refreshes snapshot cases only. Checklist-only cases are
      // hand-written invariants; recording a snapshot over them would
      // silently convert an intent-level check back into a brittle one.
      if (caseData.expect || !caseData.checklist) {
        caseData.expect = actual;
        fs.writeFileSync(casePath, JSON.stringify(caseData, null, 2) + '\n', 'utf8');
        if (verbose) console.error('[golden] updated ' + casePath);
        results.push({ id: caseData.id, ok: true, updated: true });
      } else {
        if (verbose) console.error('[golden] skipped checklist-only case ' + casePath);
        results.push({ id: caseData.id, ok: true, updated: false });
      }
      continue;
    }

    if (!caseData.expect && !caseData.checklist) {
      failed++;
      results.push({
        id: caseData.id,
        ok: false,
        error: 'missing expect block and checklist (run with --update, or add a checklist)',
      });
      continue;
    }

    const messages = [];
    let caseOk = true;

    if (caseData.expect) {
      const diffs = diffObjects(caseData.expect, actual);
      if (diffs.length) {
        caseOk = false;
        messages.push(formatDiffs(caseData.id, diffs));
      }
    }

    let checklistResult = null;
    if (Array.isArray(caseData.checklist) && caseData.checklist.length > 0) {
      checklistResult = evaluateChecklist(caseData.checklist, { cwd, phases });
      if (checklistResult.fraction !== 1) {
        caseOk = false;
        messages.push(formatChecklistFailures(caseData.id, checklistResult));
      }
    }

    if (!caseOk) {
      failed++;
      const message = messages.join('\n');
      if (verbose) console.error(message);
      results.push({ id: caseData.id, ok: false, message, checklist: checklistResult });
    } else {
      if (verbose) console.error('[golden] ok ' + caseData.id);
      results.push({ id: caseData.id, ok: true, checklist: checklistResult });
    }
  }

  // Aggregate checklist score across all checklist-bearing cases — the
  // partial-credit view (EnvScaler reward = pass fraction). Case-level green
  // still requires fraction 1; this aggregate is a diagnostic, not the gate.
  const checklistTotals = results.reduce(
    (acc, entry) => {
      if (entry.checklist) {
        acc.passed += entry.checklist.passed;
        acc.total += entry.checklist.total;
      }
      return acc;
    },
    { passed: 0, total: 0 },
  );

  return { ok: failed === 0, failed, total: casePaths.length, results, checklistTotals };
}

module.exports = {
  DEFAULT_GOLDEN_DIR,
  listGoldenCases,
  loadGoldenCase,
  setupCaseWorkspace,
  normalizeSnapshot,
  executeGoldenCase,
  evaluateChecklist,
  diffObjects,
  runGoldenEval,
};
