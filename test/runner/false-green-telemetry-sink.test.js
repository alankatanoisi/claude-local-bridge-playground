'use strict';

/**
 * false-green-telemetry-sink.test.js — FG-J series.
 *
 * SCENARIO THIS FILE DEFENDS (hypothetical change HC-3):
 *   "Close the OTel half of HE-05: emit OpenTelemetry spans for each turn and
 *    each tool call, exported to an OTLP collector."
 *
 * A span exporter is the single most dangerous thing to add to this runner,
 * because a span is *designed* to carry context: prompt text, tool arguments,
 * file paths, error messages. It is a new sink, a new egress path, and a new
 * source of config-carried credentials, all at once — and the suite's redaction
 * story is built around sinks that already exist.
 *
 * Why HC-3 lands green and leaking:
 *
 *   1. FG-C10 sweeps src/runner for unreviewed sinks using
 *      `createWriteStream|appendFileSync`. TWELVE modules in this repo already
 *      write output through primitives that regex does not look for
 *      (writeFileSync, fs.writeSync, process.stdout.write). An exporter that
 *      writes spans with writeFileSync is invisible to it. FG-J1 widens the net.
 *
 *   2. `safety.scrubSecrets` is STRING-ONLY. Called on a span-attributes object
 *      it returns the object unchanged, with every secret intact, and throws
 *      nothing. `scrubDeepSecrets` is the object-aware one. The names give no
 *      hint which is which — FG-J2/J3 pin the difference.
 *
 *   3. `scrubDeepSecrets` must safely mark parent/child backreferences (the
 *      normal shape of a span tree) without mutating the original payload.
 *      HS-05 prevents a regression to unbounded recursion.
 *
 *   4. OTLP credentials arrive in environment variables. `buildSafeEnv` is a
 *      DENYLIST, so HS-06 pins the complete OTEL_* prefix family and prevents
 *      Authorization-bearing exporter headers from reaching child processes.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const safety = require('../../src/runner/safety');
const boundary = require('../../src/runner/redaction-boundary');

const RUNNER_DIR = path.join(__dirname, '..', '..', 'src', 'runner');
const SECRET = 'sk-ant-' + 'a1b2c3'.repeat(6);

function walkJsFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJsFiles(p, acc);
    else if (entry.name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

describe('FG-J sink inventory (wider than FG-C10)', () => {
  // Every module that emits bytes to a persistent or user-visible destination.
  // This is a REVIEWED register: adding a module here is a deliberate act that
  // says "I checked that this routes through the redaction boundary."
  const REVIEWED_SINKS = [
    'confirmation.js',
    'event-bus.js',
    'golden-eval.js',
    'memory-review.js',
    'memory/auto-memory.js',
    'model-client.js',
    'private-fs.js',
    'recovery/run-manifest.js',
    'run.js',
    'session-ledger.js',
    'streaming-write.js',
    'tools/file-write-utils.js',
    'tools/undo.js',
    'user-question.js',
    'workspace-fingerprint.js',
  ];

  const BROAD_SINK =
    /createWriteStream|appendFileSync|writeFileSync|fs\.writeSync|process\.stdout\.write|process\.stderr\.write/;

  // FG-J1: the widened sweep. An OTel exporter writing spans to a file or to
  // stdout must show up here even though FG-C10 would never see it.
  it('FG-J1: no unreviewed output sink exists under src/runner', () => {
    const found = walkJsFiles(RUNNER_DIR)
      .filter((f) => BROAD_SINK.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(RUNNER_DIR, f))
      .sort();
    const unreviewed = found.filter((f) => !REVIEWED_SINKS.includes(f));
    assert.deepEqual(
      unreviewed,
      [],
      'New output sink(s) found: ' +
        unreviewed.join(', ') +
        '.\nEvery module that emits bytes must scrub through src/runner/redaction-boundary.js ' +
        '(scrubDeepSecrets for structured payloads — NOT scrubSecrets, see FG-J2). ' +
        'Review it, then add it to REVIEWED_SINKS.',
    );
  });

  // FG-J1b: guard on the guard. Show concretely that the narrow FG-C10 pattern
  // does not see most of this repo's sinks, so nobody treats a green FG-C10 as
  // proof that no new sink was added.
  it('FG-J1b: the narrow FG-C10 sink pattern is known-incomplete', () => {
    const NARROW = /createWriteStream|appendFileSync/;
    const missed = walkJsFiles(RUNNER_DIR)
      .filter((f) => {
        const src = fs.readFileSync(f, 'utf8');
        return BROAD_SINK.test(src) && !NARROW.test(src);
      })
      .map((f) => path.relative(RUNNER_DIR, f));

    assert.ok(
      missed.length > 0,
      'FG-C10’s pattern now catches every sink the broad pattern finds. If that is real, ' +
        'this test can be deleted — but verify rather than assume.',
    );
    // Anchor on a module that is unambiguously a sink and unambiguously missed.
    assert.ok(
      missed.includes('run.js'),
      'Expected run.js among the sinks FG-C10 cannot see; the inventory drifted — recheck both patterns.',
    );
  });
});

describe('FG-J structured-payload scrubbing contracts', () => {
  // FG-J2: THE trap. An exporter author reaches for the obvious name and gets a
  // silent no-op. Pin it so the asymmetry is documented and tested, not folklore.
  it('FG-J2: scrubSecrets is string-only and silently passes objects through unchanged', () => {
    const attributes = { 'gen_ai.request.header': SECRET };
    const viaStringScrubber = safety.scrubSecrets(attributes);

    assert.equal(
      JSON.stringify(viaStringScrubber).includes(SECRET),
      true,
      'scrubSecrets now sanitises objects. That is a genuine improvement — update this test ' +
        'and the FG-J2 warning in the file header, which currently tells authors it does NOT.',
    );
    // The correct call for the same input:
    assert.equal(
      JSON.stringify(boundary.scrubDeepSecrets(attributes)).includes(SECRET),
      false,
      'scrubDeepSecrets must sanitise structured payloads — this is the only object-aware path.',
    );
  });

  // FG-J3: positive contract for the object-aware scrubber across the shapes a
  // span payload actually takes. A refactor that stops recursing into arrays, or
  // stops walking nested objects, would leak without breaking a point test.
  it('FG-J3: scrubDeepSecrets recurses through nested objects, arrays and mixed primitives', () => {
    const span = {
      name: 'tool.execute',
      attributes: {
        'tool.args': [{ path: '/tmp/x' }, { token: SECRET }],
        'tool.count': 3,
        'tool.ok': true,
        'tool.nothing': null,
        nested: { deeper: { deepest: 'Authorization: Bearer ' + 'tokenpart.'.repeat(4) } },
      },
      events: [{ body: SECRET }],
    };
    const out = boundary.scrubDeepSecrets(span);
    const serialised = JSON.stringify(out);

    assert.ok(!serialised.includes(SECRET), 'a secret survived deep scrubbing');
    assert.ok(!/Bearer tokenpart/.test(serialised), 'a bearer token survived deep scrubbing');
    // Non-string data must survive intact — a scrubber that stringifies
    // everything would corrupt numeric span attributes.
    assert.equal(out.attributes['tool.count'], 3);
    assert.equal(out.attributes['tool.ok'], true);
    assert.equal(out.attributes['tool.nothing'], null);
    assert.equal(out.name, 'tool.execute');
    assert.ok(Array.isArray(out.attributes['tool.args']), 'arrays must stay arrays');
  });

  // HS-05: Span trees are cyclic by nature (a child often holds a reference
  // to its parent). The sink copy must stay serializable and secret-free, while
  // the live object remains untouched for the rest of the runner operation.
  it('HS-05: scrubDeepSecrets survives a circular payload without mutating its input', () => {
    const span = { name: 'turn', secret: SECRET };
    span.parent = span; // the ordinary shape of a span tree

    const out = boundary.scrubDeepSecrets(span);

    assert.notEqual(out, span, 'the sink-facing payload must be a detached copy');
    assert.equal(out.parent, '[Circular]', 'the backreference must become a serializable marker');
    assert.ok(!JSON.stringify(out).includes(SECRET), 'the detached circular payload must still be redacted');
    assert.equal(span.secret, SECRET, 'scrubbing must not change the live input value');
    assert.equal(span.parent, span, 'scrubbing must not replace the live input backreference');
  });

  it('HS-05: shared non-circular objects are scrubbed normally on every branch', () => {
    const shared = { label: 'shared', secret: SECRET };
    const payload = { first: shared, second: shared };

    const out = boundary.scrubDeepSecrets(payload);

    assert.deepEqual(out.first, out.second);
    assert.notEqual(out.first, shared, 'each sink-facing branch must be detached from the live object');
    assert.equal(out.first.label, 'shared');
    assert.ok(!JSON.stringify(out).includes(SECRET));
    assert.equal(shared.secret, SECRET, 'the shared live object must remain unchanged');
  });

  // FG-J5: documented data-loss shapes. Errors and Maps are extremely common in
  // telemetry payloads and both come out EMPTY — no leak, but the exporter would
  // silently record nothing. Pinning this stops someone "fixing" the emptiness
  // by bypassing the boundary.
  it('FG-J5: Error, Map and Set payloads are emptied rather than scrubbed', () => {
    const err = new Error('request failed with ' + SECRET);
    const viaBoundary = boundary.scrubDeepSecrets({ exception: err });
    assert.deepEqual(viaBoundary.exception, {}, 'Error own-enumerable walk should yield {}');
    assert.ok(!JSON.stringify(viaBoundary).includes(SECRET), 'and it must not leak');

    assert.deepEqual(boundary.scrubDeepSecrets({ m: new Map([['k', SECRET]]) }).m, {});
    assert.deepEqual(boundary.scrubDeepSecrets({ s: new Set([SECRET]) }).s, {});

    // The safe way to record an error message: stringify FIRST, then scrub.
    const asText = boundary.scrubDeepSecrets({ exception: String(err.message) });
    assert.ok(!asText.exception.includes(SECRET), 'stringified error message must be scrubbed');
    assert.ok(asText.exception.includes('[REDACTED'), 'and must show the redaction marker');
  });

  // HS-06: OTLP exporters are configured through OTEL_* environment variables,
  // and header variables conventionally hold "Authorization=Bearer <token>".
  // Test both today's header names and an invented future name so the entire
  // family remains filtered rather than only one known credential variable.
  it('HS-06: the full OTEL_* environment family is withheld from child processes', () => {
    const sourceEnv = {
      PATH: '/usr/bin',
      ORDINARY_CHILD_SETTING: 'keep-me',
      OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Bearer ' + SECRET,
      OTEL_EXPORTER_OTLP_TRACES_HEADERS: 'Authorization=Bearer trace-' + SECRET,
      OTEL_SERVICE_NAME: 'local-runner',
      OTEL_INVENTED_FUTURE_CREDENTIAL: SECRET,
    };

    const env = safety.buildSafeEnv(sourceEnv);

    for (const name of Object.keys(sourceEnv).filter((key) => key.startsWith('OTEL_'))) {
      assert.equal(env[name], undefined, `${name} reached a child process`);
    }
    assert.equal(env.PATH, '/usr/bin', 'ordinary process settings must survive filtering');
    assert.equal(env.ORDINARY_CHILD_SETTING, 'keep-me', 'unrelated child settings must survive filtering');
  });

  // FG-J7: the prefix-scrub families are the only forward-looking part of the
  // env denylist — they catch variable names that do not exist yet. Pin them,
  // because deleting one is a one-character edit with no other symptom.
  it('FG-J7: the forward-looking env prefix families are still enforced', () => {
    const PREFIX_FAMILIES = ['AWS_', 'ANTHROPIC_', 'CLAUDE_', 'OPENAI_', 'OTEL_'];
    for (const prefix of PREFIX_FAMILIES) {
      const invented = prefix + 'INVENTED_FUTURE_VAR';
      const saved = process.env[invented];
      process.env[invented] = SECRET;
      try {
        assert.ok(
          !(invented in safety.buildSafeEnv()),
          `${invented} reached the child env — the "${prefix}" prefix scrub was removed, so ` +
            'future variables in that family will leak.',
        );
      } finally {
        if (saved === undefined) delete process.env[invented];
        else process.env[invented] = saved;
      }
    }
  });
});
