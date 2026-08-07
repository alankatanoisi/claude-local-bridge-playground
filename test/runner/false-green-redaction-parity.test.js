'use strict';

/**
 * false-green-redaction-parity.test.js — sink-parity + pattern-liveness (FG-C).
 *
 * The redaction promise is "every sink passes through one boundary". The
 * failure mode this file targets: a NEW pattern (or a pattern edit) lands in
 * one code path but not another, and every existing point test — which only
 * exercises one path with one fixture — stays green.
 *
 * Strategy: a single shared corpus with one fixture per protection family,
 * pushed through every scrubbing surface (buffered, deep-object, streaming at
 * many chunk sizes), asserting byte-identical results.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const safety = require('../../src/runner/safety');
const boundary = require('../../src/runner/redaction-boundary');

// One line per single-line protection family + a multi-line PEM block.
// IMPORTANT: keep each secret on ONE line. Buffered regex can match a
// `Bearer\n<token>` split across lines while the line-aligned streaming
// scrubber cannot — that divergence is a documented accepted risk (FG-C7).
const PEM_BLOCK = '-----BEGIN RSA PRIVATE KEY-----\nMIIfakefakefakefake\nfakefakefake\n-----END RSA PRIVATE KEY-----';

const CORPUS_LINES = [
  'plain text line stays as is',
  'anthropic key sk-ant-' + 'a1b2c3'.repeat(6),
  'generic key sk-' + 'z9y8x7'.repeat(5),
  'github token ghp_' + 'A'.repeat(36),
  'github classic gho_' + 'B'.repeat(36),
  'aws key AKIA' + 'C'.repeat(16),
  'aws_secret_access_key = supersecretvalue123',
  'Authorization: Bearer ' + 'tokenpart.'.repeat(4),
  'jwt eyJ' + 'h'.repeat(12) + '.' + 'p'.repeat(12) + '.' + 's'.repeat(12),
  'ENV_TOKEN="assignedsecret"',
  'account_uuid=123e4567-e89b-42d3-a456-426614174000',
  PEM_BLOCK,
  'trailing plain line',
];
const CORPUS = CORPUS_LINES.join('\n');

// Substrings that must NEVER survive any sink.
const FORBIDDEN = [
  'sk-ant-a1b2c3',
  'sk-z9y8x7',
  'ghp_' + 'A'.repeat(36),
  'gho_' + 'B'.repeat(36),
  'AKIA' + 'C'.repeat(16),
  'supersecretvalue123',
  'assignedsecret',
  'MIIfakefakefakefake',
  '123e4567-e89b-42d3-a456-426614174000',
];

// Marker → proves its pattern is alive (not edited into a never-matching regex).
const REQUIRED_MARKERS = [
  '[REDACTED:anthropic_key]',
  '[REDACTED:generic_api_key]',
  '[REDACTED:github_token]',
  '[REDACTED:aws_access_key]',
  'aws_secret_access_key=[REDACTED]',
  'Bearer [REDACTED]',
  '[REDACTED:jwt]',
  '[REDACTED:private_key_block]',
  '[REDACTED:stable_identifier]',
];

describe('FG-C scrubbing pattern liveness', () => {
  it('FG-C1: every protection family fires on the shared corpus (dead-pattern detector)', () => {
    const out = safety.scrubSecrets(CORPUS);
    for (const marker of REQUIRED_MARKERS) {
      assert.ok(out.includes(marker), 'pattern family did not fire (dead or drifted): ' + marker);
    }
    for (const secret of FORBIDDEN) {
      assert.ok(!out.includes(secret), 'secret survived buffered scrub: ' + secret.slice(0, 24));
    }
  });

  it('FG-C2: scrubbing is idempotent — a second pass changes nothing', () => {
    // If a replacement marker ever re-triggers a pattern, double-scrubbed
    // sinks (tool result then transcript) would diverge from single-scrubbed
    // ones and diffing tools would see phantom changes.
    const once = safety.scrubSecrets(CORPUS);
    const twice = safety.scrubSecrets(once);
    assert.equal(twice, once);
  });
});

describe('FG-C cross-sink parity', () => {
  it('FG-C3: deep-object scrubbing equals buffered text scrubbing for identical content', () => {
    const nested = { a: [{ note: CORPUS }], b: { c: CORPUS } };
    const out = boundary.scrubDeepSecrets(nested);
    const expected = safety.scrubSecrets(CORPUS);
    assert.equal(out.a[0].note, expected, 'nested string must scrub identically to flat text');
    assert.equal(out.b.c, expected);
  });

  it('FG-C4: streaming scrubber output is byte-identical to buffered output at many chunk sizes', () => {
    // P1-11 split-invariance, asserted against the BUFFERED path (not just
    // against other chunkings): a new single-line pattern added to
    // SECRET_PATTERNS is automatically covered because both paths share the
    // corpus.
    const expected = safety.scrubSecrets(CORPUS);
    for (const size of [1, 3, 17, 64, 4096]) {
      const scrubber = safety.makeStreamingScrubber();
      let out = '';
      for (let i = 0; i < CORPUS.length; i += size) {
        out += scrubber.push(CORPUS.slice(i, i + size));
      }
      out += scrubber.end();
      assert.equal(out, expected, 'streaming diverged from buffered at chunk size ' + size);
    }
  });

  it('FG-C5: a fresh redaction boundary wires all three surfaces to the same implementation', () => {
    const rb = boundary.createRedactionBoundary();
    const viaText = rb.scrubText(CORPUS);
    const viaDeep = rb.scrubDeepSecrets(CORPUS);
    const viaStream = rb.stream.push(CORPUS) + rb.stream.end();
    assert.equal(viaText, safety.scrubSecrets(CORPUS));
    assert.equal(viaDeep, viaText);
    assert.equal(viaStream, viaText);
  });

  it('FG-C6: scrub-then-truncate never leaks a secret past the cap', () => {
    // Order matters (A6): truncating first could slice a secret so neither
    // half matches. Put the secret straddling the cap boundary.
    const text = 'x'.repeat(110) + ' sk-ant-' + 'q1w2e3'.repeat(6) + ' tail';
    const out = safety.scrubAndTruncate(text, 120);
    assert.ok(!out.includes('sk-ant-q1w2e3'), 'secret fragment leaked through truncation');
    assert.ok(out.endsWith('(truncated)'));
  });

  it('FG-C7: multi-line pattern inventory — the PEM block is the ONLY multi-line secret pattern', () => {
    // The streaming scrubber is line-aligned: single-line patterns always see
    // a whole line, and multi-line protection exists ONLY because the PEM
    // fences are special-cased. If someone adds another multi-line pattern
    // (e.g. a certificate or a multi-line JSON credential), streaming sinks
    // would silently diverge from buffered sinks. This source-level guard
    // forces that person to extend makeStreamingScrubber at the same time.
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'runner', 'safety.js'), 'utf8');
    const multiLineMatchers = (source.match(/\[\\s\\S\]/g) || []).length;
    assert.equal(
      multiLineMatchers,
      1,
      'safety.js now contains ' +
        multiLineMatchers +
        ' multi-line ([\\s\\S]) regex constructs; the streaming scrubber only handles the PEM one. ' +
        'Extend makeStreamingScrubber for the new pattern, then update this count.',
    );
  });
});

describe('FG-C stable-identifier key handling', () => {
  it('FG-C8: scrubObject obliterates values under stable-identifier keys', () => {
    const out = safety.scrubObject({ device_id: 'not-even-a-uuid', nested: { session_uuid: 'abc' } });
    assert.equal(out.device_id, '[REDACTED:stable_identifier]');
    assert.equal(out.nested.session_uuid, '[REDACTED:stable_identifier]');
  });

  it('FG-C9: preserveRootStableIdentifierKeys keeps only the named root keys', () => {
    // Resume metadata needs its own sessionId; the option must stay narrow —
    // depth 1 only — so a nested hostile object cannot piggyback on it.
    const input = { session_id: 'root-keeps', nested: { session_id: 'nested-goes' } };
    const out = safety.scrubObject(input, safety.scrubSecrets, {
      preserveRootStableIdentifierKeys: ['session_id'],
    });
    assert.equal(out.session_id, 'root-keeps');
    assert.equal(out.nested.session_id, '[REDACTED:stable_identifier]');
  });
});

describe('FG-C sink and network module inventory', () => {
  // FG-C10/C11: architecture guards for the "new sink bypasses the boundary"
  // family (the exact shape an OTel/telemetry exporter or a new log file
  // would take). A module that opens its own write stream or its own HTTP
  // client is a NEW SINK; it must be reviewed against the redaction boundary
  // and then added here — the failure message says exactly that.
  const RUNNER_DIR = path.join(__dirname, '..', '..', 'src', 'runner');

  function walkJsFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walkJsFiles(p));
      else if (entry.name.endsWith('.js')) out.push(p);
    }
    return out;
  }

  const KNOWN_STREAM_SINKS = new Set(['private-fs.js', 'session-ledger.js', 'streaming-write.js']);
  const KNOWN_NETWORK_MODULES = new Set(['model-client.js']);

  it('FG-C10: no unreviewed file-stream sink exists under src/runner', () => {
    const offenders = [];
    for (const file of walkJsFiles(RUNNER_DIR)) {
      const source = fs.readFileSync(file, 'utf8');
      if (/createWriteStream|appendFileSync/.test(source) && !KNOWN_STREAM_SINKS.has(path.basename(file))) {
        offenders.push(path.relative(RUNNER_DIR, file));
      }
    }
    assert.deepEqual(
      offenders,
      [],
      'New stream-writing module(s) found: ' +
        offenders.join(', ') +
        '. Every persistent sink must route text through the redaction boundary ' +
        '(src/runner/redaction-boundary.js). Review the new module, then add it to KNOWN_STREAM_SINKS.',
    );
  });

  it('FG-C11: no unreviewed outbound-network module exists under src/runner', () => {
    const offenders = [];
    for (const file of walkJsFiles(RUNNER_DIR)) {
      const source = fs.readFileSync(file, 'utf8');
      if (/https?\.request\(|\bfetch\(/.test(source) && !KNOWN_NETWORK_MODULES.has(path.basename(file))) {
        offenders.push(path.relative(RUNNER_DIR, file));
      }
    }
    assert.deepEqual(
      offenders,
      [],
      'New outbound-network module(s) found: ' +
        offenders.join(', ') +
        '. Outbound requests can exfiltrate unscrubbed payloads and must go through ' +
        'model-client (or be reviewed + added to KNOWN_NETWORK_MODULES with redaction applied).',
    );
  });
});
