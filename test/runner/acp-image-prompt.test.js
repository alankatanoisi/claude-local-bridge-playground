'use strict';
/**
 * acp-image-prompt.test.js — image attachments on ACP prompts (2026-10-16).
 *
 * T3 drops screenshots into a prompt as ACP image blocks
 * `{ type: 'image', data: <base64>, mimeType }`. These tests pin the unit-level
 * contract of that path, piece by piece:
 *
 *   1. promptContentFrom — ACP blocks → text + Anthropic image blocks, with a
 *      visible placeholder for anything the model API cannot take;
 *   2. buildUserMessage — images sit in front of the prompt text in the
 *      outbound user message, and malformed blocks are refused;
 *   3. estimateTokens — an image is charged a flat cap, not its base64 length;
 *   4. scrubDeepSecrets — the on-disk session scrub leaves base64 intact, so a
 *      resumed turn re-sends the same bytes the model saw;
 *   5. bin/local-bridge-acp.js — the new --max-steps flag parses and validates.
 *
 * The end-to-end agent behaviour (capability flag, run() call shape, default
 * step ceiling) lives in acp-agent.test.js next to the other protocol tests.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const { promptContentFrom, PROMPT_IMAGE_MEDIA_TYPES, DEFAULT_ACP_MAX_STEPS } = require('../../src/runner/acp/agent');
const { buildUserMessage } = require('../../src/runner/context-builder');
const { estimateTokens } = require('../../src/runner/context-compactor');
const { scrubDeepSecrets } = require('../../src/runner/redaction-boundary');
const { MAX_IMAGE_BYTES } = require('../../src/runner/media-read');

const ACP_BIN = path.join(__dirname, '..', '..', 'bin', 'local-bridge-acp.js');

/** Deterministic pseudo-random bytes (a hash chain), so the test is repeatable. */
function deterministicBase64(byteLength) {
  const chunks = [];
  let seed = Buffer.from('acp-image-prompt');
  let total = 0;
  while (total < byteLength) {
    seed = crypto.createHash('sha256').update(seed).digest();
    chunks.push(seed);
    total += seed.length;
  }
  return Buffer.concat(chunks).subarray(0, byteLength).toString('base64');
}

describe('promptContentFrom — ACP image blocks become Anthropic image blocks', () => {
  it('accepts the four media types the Messages API takes', () => {
    assert.deepEqual([...PROMPT_IMAGE_MEDIA_TYPES].sort(), ['image/gif', 'image/jpeg', 'image/png', 'image/webp']);
    for (const mediaType of PROMPT_IMAGE_MEDIA_TYPES) {
      const out = promptContentFrom([{ type: 'image', data: 'QUJD', mimeType: mediaType }]);
      assert.deepEqual(out.attachments, [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: 'QUJD' } },
      ]);
      assert.deepEqual(out.dropped, []);
    }
  });

  it('normalizes the media type case the client sends', () => {
    const out = promptContentFrom([{ type: 'image', data: 'QUJD', mimeType: 'IMAGE/PNG' }]);
    assert.equal(out.attachments[0].source.media_type, 'image/png');
  });

  it('drops what the model cannot take and says so in the text, numbered per image', () => {
    const out = promptContentFrom([
      { type: 'text', text: 'look' },
      { type: 'image', data: 'QUJD', mimeType: 'image/svg+xml' },
      { type: 'image', mimeType: 'image/png' },
      { type: 'image', data: 'QUJD', mimeType: 'image/png' },
    ]);
    assert.equal(out.attachments.length, 1);
    assert.deepEqual(out.dropped, [
      { index: 1, reason: 'unsupported media type image/svg+xml' },
      { index: 2, reason: 'missing image data' },
    ]);
    assert.equal(
      out.text,
      'look\n\n[image attachment 1 not forwarded: unsupported media type image/svg+xml]\n\n[image attachment 2 not forwarded: missing image data]',
    );
  });

  it('refuses an image whose decoded size exceeds the shared media limit', () => {
    // base64 inflates 4/3, so this string decodes to one byte over the limit.
    const oversized = 'A'.repeat(Math.ceil(((MAX_IMAGE_BYTES + 1) * 4) / 3));
    const out = promptContentFrom([{ type: 'image', data: oversized, mimeType: 'image/png' }]);
    assert.equal(out.attachments.length, 0);
    assert.match(out.dropped[0].reason, /^exceeds \d+ bytes$/);
    // Image-only AND dropped: the placeholder is the text, no "(See attached)" stub.
    assert.match(out.text, /^\[image attachment 1 not forwarded: exceeds/);
  });

  it('gives an image-only prompt a minimal text stub, singular and plural', () => {
    const one = promptContentFrom([{ type: 'image', data: 'QUJD', mimeType: 'image/png' }]);
    assert.equal(one.text, '(See attached image.)');
    const three = promptContentFrom([
      { type: 'image', data: 'QUJD', mimeType: 'image/png' },
      { type: 'image', data: 'QUJD', mimeType: 'image/png' },
      { type: 'image', data: 'QUJD', mimeType: 'image/png' },
    ]);
    assert.equal(three.text, '(See the 3 attached images.)');
    assert.equal(three.attachments.length, 3);
  });

  it('returns the empty shape for non-array input', () => {
    assert.deepEqual(promptContentFrom(undefined), { text: '', attachments: [], dropped: [] });
  });
});

describe('buildUserMessage — attachments join the outbound user message', () => {
  const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } };

  it('keeps the plain-string shape when there are no attachments (unchanged call sites)', () => {
    assert.deepEqual(buildUserMessage('hello', null, null, undefined), { role: 'user', content: 'hello' });
    assert.deepEqual(buildUserMessage('hello', null, null, []), { role: 'user', content: 'hello' });
  });

  it('places images before the prompt text, after any environment prefix blocks', () => {
    const msg = buildUserMessage('what is this?', null, ['[env] cwd=/tmp'], [image]);
    assert.deepEqual(msg, {
      role: 'user',
      content: [{ type: 'text', text: '[env] cwd=/tmp' }, image, { type: 'text', text: 'what is this?' }],
    });
  });

  it('still appends pasted stdin context to the text block', () => {
    const msg = buildUserMessage('q', 'pasted', null, [image]);
    assert.deepEqual(msg.content, [image, { type: 'text', text: 'q\n\n---\nPasted context:\npasted' }]);
  });

  it('refuses malformed attachment blocks rather than sending them to the API', () => {
    const msg = buildUserMessage('q', null, null, [
      null,
      { type: 'text', text: 'smuggled' },
      { type: 'image', source: { type: 'url', url: 'https://x' } },
      { type: 'image' },
      image,
    ]);
    assert.deepEqual(msg.content, [image, { type: 'text', text: 'q' }]);
  });
});

describe('estimateTokens — an image is a flat charge, not its base64 length', () => {
  it('charges roughly 1,600 tokens per image regardless of payload size', () => {
    const big = deterministicBase64(600 * 1024); // ~800k base64 chars
    const withImage = estimateTokens([
      { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: big } }] },
    ]);
    const withoutImage = estimateTokens([{ role: 'user', content: [{ type: 'text', text: '' }] }]);
    assert.equal(withImage - withoutImage, 1600);
    // Sanity: counting the base64 as prose would have been ~200k tokens.
    assert.ok(withImage < 2000);
  });
});

describe('scrubDeepSecrets — persisted image bytes survive the on-disk secret scrub', () => {
  it('leaves a large base64 payload byte-for-byte intact', () => {
    // Standard base64 has no "-", "_", ".", "=" (except trailing padding) or
    // whitespace, which every secret pattern needs; this pins that reasoning.
    const data = deterministicBase64(256 * 1024);
    const message = {
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data } },
        { type: 'text', text: 'q' },
      ],
    };
    const scrubbed = scrubDeepSecrets({ messages: [message] });
    assert.equal(scrubbed.messages[0].content[0].source.data, data);
  });
});

describe('bin/local-bridge-acp.js --max-steps', () => {
  it('documents the flag and its default in --help', () => {
    const result = spawnSync(process.execPath, [ACP_BIN, '--help'], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.match(result.stderr, new RegExp('--max-steps <n>.*default ' + DEFAULT_ACP_MAX_STEPS));
  });

  // The "=" form matters for -5: Node's parseArgs refuses a dash-leading value
  // on its own ("argument is ambiguous") before our validation ever runs.
  for (const bad of ['abc', '0', '-5']) {
    it(`rejects --max-steps=${bad} before serving any protocol frame`, () => {
      const result = spawnSync(process.execPath, [ACP_BIN, '--max-steps=' + bad], { encoding: 'utf8', input: '' });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /--max-steps must be a positive integer/);
      assert.equal(result.stdout, '', 'stdout is reserved for protocol frames');
    });
  }
});
