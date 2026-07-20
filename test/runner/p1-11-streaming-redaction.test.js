'use strict';

/**
 * P1-11 — streaming redaction split-invariance.
 *
 * Acceptance criterion (runtime-concordance assessment):
 *   "All split positions for each secret fixture produce identical redacted
 *    output with bounded memory."
 *
 * The old scrubber held a fixed 4096-char trailing window, so a multi-line
 * private-key block longer than the window could be emitted half-raw, and a
 * labeled stable identifier could be cut mid-value at the emit boundary.
 * The new scrubber is line-aligned with a bounded PEM parser, so output
 * depends only on total content — never on where chunks were split.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const safety = require('../../src/runner/safety');

// Feed `input` to a fresh scrubber, splitting at the given cut positions.
// Returns the concatenated push()/end() output.
function streamWithSplits(input, cuts) {
  const scrubber = safety.makeStreamingScrubber();
  let out = '';
  let pos = 0;
  for (const cut of cuts) {
    out += scrubber.push(input.slice(pos, cut));
    pos = cut;
  }
  out += scrubber.push(input.slice(pos));
  out += scrubber.end();
  return out;
}

// A private-key block much larger than the old 4096-char window, so the old
// implementation would have emitted its head unredacted.
function bigPemFixture() {
  const bodyLine = 'A'.repeat(60) + 'BODY' + '\n'; // sentinel inside every body line
  return (
    'before the key\n' +
    '-----BEGIN RSA PRIVATE KEY-----\n' +
    bodyLine.repeat(120) + // ~7.7KB of body
    '-----END RSA PRIVATE KEY-----\n' +
    'after the key\n'
  );
}

describe('P1-11 streaming redaction — split invariance', () => {
  const fixtures = {
    anthropic_key: 'log line one\ntoken: sk-ant-' + 'a'.repeat(40) + ' trailing\nlog line two\n',
    jwt: 'auth eyJ' + 'h'.repeat(20) + '.' + 'p'.repeat(20) + '.' + 's'.repeat(20) + ' done\n',
    stable_identifier: 'meta device_id=0123456789abcdef0123456789abcdef more\n',
    secret_assignment: 'export MY_API_KEY="hunter2hunter2"\nnext line\n',
  };

  for (const [name, input] of Object.entries(fixtures)) {
    it('fixture "' + name + '": every split position matches single-push output', () => {
      const reference = streamWithSplits(input, []);
      // The secret must actually be gone from the reference output.
      assert.match(reference, /\[REDACTED/);
      for (let cut = 1; cut < input.length; cut++) {
        const out = streamWithSplits(input, [cut]);
        assert.equal(out, reference, 'split at ' + cut + ' diverged');
      }
    });

    it('fixture "' + name + '": streamed output equals buffered scrubSecrets', () => {
      assert.equal(streamWithSplits(input, []), safety.scrubSecrets(input));
    });
  }

  it('redacts a private-key block larger than the old 4096-char window', () => {
    const input = bigPemFixture();
    const reference = streamWithSplits(input, []);
    assert.match(reference, /\[REDACTED:private_key_block\]/);
    assert.ok(!reference.includes('BODY'), 'no body line may leak');
    assert.ok(!reference.includes('BEGIN RSA PRIVATE KEY'), 'no fence may leak');
    assert.match(reference, /before the key/);
    assert.match(reference, /after the key/);
    // Streamed output must equal buffered output for the whole document.
    assert.equal(reference, safety.scrubSecrets(input));
  });

  it('private-key block: sampled and fence-adjacent splits all match', () => {
    const input = bigPemFixture();
    const reference = streamWithSplits(input, []);
    const beginIdx = input.indexOf('-----BEGIN');
    const endIdx = input.indexOf('-----END');
    const critical = [beginIdx, beginIdx + 5, beginIdx + 20, endIdx, endIdx + 5, endIdx + 20];
    const cuts = new Set(critical);
    for (let cut = 1; cut < input.length; cut += 97) cuts.add(cut); // stride sample
    for (const cut of cuts) {
      if (cut <= 0 || cut >= input.length) continue;
      assert.equal(streamWithSplits(input, [cut]), reference, 'split at ' + cut + ' diverged');
    }
    // Multi-cut chunkings (SSE-sized) must also match.
    const tiny = [];
    for (let cut = 7; cut < input.length; cut += 13) tiny.push(cut);
    assert.equal(streamWithSplits(input, tiny), reference);
  });

  it('unterminated private-key block at end() matches buffered behavior', () => {
    const input = 'x\n-----BEGIN RSA PRIVATE KEY-----\n' + 'A'.repeat(64) + '\n';
    const reference = streamWithSplits(input, []);
    // Buffered scrubSecrets only redacts complete BEGIN..END pairs.
    assert.equal(reference, safety.scrubSecrets(input));
    for (let cut = 1; cut < input.length; cut += 5) {
      assert.equal(streamWithSplits(input, [cut]), reference);
    }
  });

  it('oversized private-key block fails closed with bounded hold', () => {
    const bodyLine = 'B'.repeat(60) + 'HUGEBODY' + '\n';
    const lines = Math.ceil((safety.STREAM_MAX_PEM_HOLD * 1.5) / bodyLine.length);
    const input =
      '-----BEGIN RSA PRIVATE KEY-----\n' +
      bodyLine.repeat(lines) +
      '-----END RSA PRIVATE KEY-----\n' +
      'after\n';
    const a = streamWithSplits(input, []);
    assert.match(a, /\[REDACTED:private_key_block\]/);
    assert.ok(!a.includes('HUGEBODY'), 'oversized block content must never leak');
    assert.match(a, /after/);
    // Chunking must not change the fail-closed output.
    const cuts = [];
    for (let cut = 1024; cut < input.length; cut += 4096) cuts.push(cut);
    assert.equal(streamWithSplits(input, cuts), a);
  });

  it('bounds memory on a single enormous line by flushing deterministic slabs', () => {
    const scrubber = safety.makeStreamingScrubber();
    const line = 'z'.repeat(1024 * 1024); // 1MB, no newline
    let emitted = '';
    for (let i = 0; i < line.length; i += 8192) {
      emitted += scrubber.push(line.slice(i, i + 8192));
    }
    // Everything beyond the hold cap must already be flushed before end().
    assert.ok(
      emitted.length >= line.length - safety.STREAM_MAX_LINE_HOLD,
      'scrubber held more than STREAM_MAX_LINE_HOLD of an unterminated line',
    );
    emitted += scrubber.end();
    assert.equal(emitted, line, 'non-secret content must pass through unchanged');
  });

  it('emits complete lines promptly instead of trailing a 4KB window', () => {
    const scrubber = safety.makeStreamingScrubber();
    const out = scrubber.push('short line\n');
    assert.equal(out, 'short line\n');
    scrubber.end();
  });
});
