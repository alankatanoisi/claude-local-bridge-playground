'use strict';
/**
 * acp-image-prompt.test.js — image attachments on ACP prompts (2026-10-16,
 * acceptor unified 2026-10-17).
 *
 * T3 drops screenshots into a prompt as ACP image blocks
 * `{ type: 'image', data: <base64>, mimeType }`. These tests pin the contract
 * of that path, piece by piece:
 *
 *   1. acceptImage — the ONE rule (media type, DECODED size, base64 shape)
 *      shared by the prompt parser, the message builder, and read_file;
 *   2. promptContentFrom — ACP blocks → text + Anthropic image blocks, with a
 *      visible placeholder for anything the model API cannot take;
 *   3. buildUserMessage — images sit in front of the prompt text in the
 *      outbound user message, and blocks the acceptor refuses never go out;
 *   4. estimateTokens — an image is charged a flat cap, not its base64 length;
 *   5. scrubDeepSecrets — the on-disk session scrub leaves base64 intact, so a
 *      resumed turn re-sends the same bytes the model saw;
 *   6. the agent — attachments reach run() separately from the text prompt,
 *      and the ACP step ceiling applies (stubbed run(), no real runner);
 *   7. bin/local-bridge-acp.js — the --max-steps flag parses and validates.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { PassThrough } = require('stream');
const { spawnSync } = require('child_process');

const { promptContentFrom } = require('../../src/runner/acp/prompt-content');
const { createAcpAgent, DEFAULT_ACP_MAX_STEPS } = require('../../src/runner/acp/agent');
const { createConnection } = require('../../src/runner/acp/connection');
const { buildUserMessage } = require('../../src/runner/context-builder');
const { estimateTokens, IMAGE_BLOCK_ESTIMATE_TOKENS } = require('../../src/runner/context-compactor');
const { scrubDeepSecrets } = require('../../src/runner/redaction-boundary');
const {
  MAX_IMAGE_BYTES,
  ACCEPTED_IMAGE_MEDIA_TYPES,
  acceptImage,
  isAcceptedImageBlock,
} = require('../../src/runner/media-read');
const { STOP_REASONS } = require('../../src/runner/kernel/contract');

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

describe('acceptImage — the one rule for which images are forwarded', () => {
  it('accepts exactly the four media types the Messages API takes, derived from the extension map', () => {
    assert.deepEqual([...ACCEPTED_IMAGE_MEDIA_TYPES].sort(), ['image/gif', 'image/jpeg', 'image/png', 'image/webp']);
    for (const mediaType of ACCEPTED_IMAGE_MEDIA_TYPES) {
      assert.deepEqual(acceptImage(mediaType, 'QUJD'), {
        ok: true,
        block: { type: 'image', source: { type: 'base64', media_type: mediaType, data: 'QUJD' } },
      });
    }
    assert.equal(acceptImage('IMAGE/PNG', 'QUJD').block.source.media_type, 'image/png');
    assert.deepEqual(acceptImage('image/svg+xml', 'QUJD'), {
      ok: false,
      reason: 'unsupported media type image/svg+xml',
    });
    assert.deepEqual(acceptImage(undefined, 'QUJD'), { ok: false, reason: 'unsupported media type (missing)' });
    assert.deepEqual(acceptImage('image/png', ''), { ok: false, reason: 'missing image data' });
    assert.deepEqual(acceptImage('image/png', 42), { ok: false, reason: 'missing image data' });
  });

  it('measures the DECODED size: exactly the limit is kept, one byte over is dropped', () => {
    // MAX_IMAGE_BYTES is 1 mod 3, so its base64 ends in "==". A 4/3 estimate
    // counted that padding as data and rejected an image at the advertised
    // limit (Cursor review 2026-10-17, Medium #4). Buffer.byteLength does not.
    const exact = Buffer.alloc(MAX_IMAGE_BYTES).toString('base64');
    const over = Buffer.alloc(MAX_IMAGE_BYTES + 1).toString('base64');
    assert.equal(acceptImage('image/png', exact).ok, true);
    assert.deepEqual(acceptImage('image/png', over), { ok: false, reason: 'exceeds ' + MAX_IMAGE_BYTES + ' bytes' });
  });

  it('isAcceptedImageBlock admits only the exact block shape acceptImage builds', () => {
    const good = acceptImage('image/png', 'QUJD').block;
    assert.equal(isAcceptedImageBlock(good), true);
    for (const bad of [
      null,
      { type: 'text', text: 'smuggled' },
      { type: 'image' },
      { type: 'image', source: { type: 'url', url: 'https://x' } },
      { type: 'image', source: { type: 'base64', media_type: 'image/tiff', data: 'QUJD' } },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: '' } },
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: Buffer.alloc(MAX_IMAGE_BYTES + 1).toString('base64') },
      },
    ]) {
      assert.equal(isAcceptedImageBlock(bad), false, JSON.stringify(bad).slice(0, 80));
    }
  });
});

describe('promptContentFrom — ACP image blocks become Anthropic image blocks', () => {
  it('forwards an accepted image and normalizes the media type case the client sends', () => {
    const out = promptContentFrom([{ type: 'image', data: 'QUJD', mimeType: 'IMAGE/PNG' }]);
    assert.deepEqual(out.attachments, [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } },
    ]);
    assert.deepEqual(out.dropped, []);
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

  it('refuses an image whose decoded size exceeds the shared media limit, keeping one at the limit', () => {
    const kept = promptContentFrom([
      { type: 'image', data: Buffer.alloc(MAX_IMAGE_BYTES).toString('base64'), mimeType: 'image/png' },
    ]);
    assert.equal(kept.attachments.length, 1);
    const out = promptContentFrom([
      { type: 'image', data: Buffer.alloc(MAX_IMAGE_BYTES + 1).toString('base64'), mimeType: 'image/png' },
    ]);
    assert.equal(out.attachments.length, 0);
    assert.equal(out.dropped[0].reason, 'exceeds ' + MAX_IMAGE_BYTES + ' bytes');
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

  it('refuses anything the shared acceptor refuses rather than sending it to the API', () => {
    const msg = buildUserMessage('q', null, null, [
      null,
      { type: 'text', text: 'smuggled' },
      { type: 'image', source: { type: 'url', url: 'https://x' } },
      { type: 'image' },
      // Well-formed shape, wrong media type: the old builder let this through.
      { type: 'image', source: { type: 'base64', media_type: 'image/tiff', data: 'QUJD' } },
      image,
    ]);
    assert.deepEqual(msg.content, [image, { type: 'text', text: 'q' }]);
  });
});

describe('estimateTokens — an image is a flat charge, not its base64 length', () => {
  it('charges IMAGE_BLOCK_ESTIMATE_TOKENS per image regardless of payload size', () => {
    assert.equal(IMAGE_BLOCK_ESTIMATE_TOKENS, 1600);
    const big = deterministicBase64(600 * 1024); // ~800k base64 chars
    const withImage = estimateTokens([
      { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: big } }] },
    ]);
    const withoutImage = estimateTokens([{ role: 'user', content: [{ type: 'text', text: '' }] }]);
    assert.equal(withImage - withoutImage, IMAGE_BLOCK_ESTIMATE_TOKENS);
    // Sanity: counting the base64 as prose would have been ~200k tokens.
    assert.ok(withImage < 2000);
    // Prose and images add, they do not blend: 400 chars → 100 tokens, plus one image.
    const mixed = estimateTokens([
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: big } },
          { type: 'text', text: 'x'.repeat(400) },
        ],
      },
    ]);
    assert.equal(mixed, IMAGE_BLOCK_ESTIMATE_TOKENS + 100);
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

/**
 * A minimal ACP client over in-memory streams with run() stubbed, the same
 * shape acp-host-selection.test.js uses. These protocol cases do not need the
 * real-runner harness in acp-agent.test.js.
 */
function stubClient(t, runDefaults = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-image-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const incoming = new PassThrough();
  const outgoing = new PassThrough();
  const calls = [];
  createAcpAgent({
    input: incoming,
    write: (line) => outgoing.write(line),
    sessionDir: directory,
    runDefaults,
    runFn: async (options) => {
      calls.push(options);
      return { stopReason: STOP_REASONS.SUCCESS, finalText: 'ok', steps: 1, duration_ms: 1, usage: {}, events: [] };
    },
  });
  const rpc = createConnection({ input: outgoing, write: (line) => incoming.write(line) });
  t.after(() => {
    incoming.end();
    outgoing.end();
    rpc.close();
  });
  return {
    calls,
    async startSession() {
      await rpc.request('initialize', { protocolVersion: 1 });
      return (await rpc.request('session/new', { cwd: directory })).sessionId;
    },
    prompt: (sessionId, prompt) => rpc.request('session/prompt', { sessionId, prompt }),
  };
}

describe('the agent — attachments and the step ceiling reach run()', () => {
  it('forwards image attachments to run() as Anthropic blocks, separate from the text prompt', async (t) => {
    const c = stubClient(t);
    const sessionId = await c.startSession();
    const png = Buffer.from('not really a png, but the agent does not decode it').toString('base64');

    await c.prompt(sessionId, [
      { type: 'text', text: 'what is in this screenshot?' },
      { type: 'image', data: png, mimeType: 'image/png' },
      { type: 'image', data: 'AAAA', mimeType: 'image/tiff' },
    ]);
    const opts = c.calls[0];
    assert.equal(typeof opts.prompt, 'string', 'prompt stays a plain string for every text-only sink');
    assert.match(opts.prompt, /^what is in this screenshot\?/);
    assert.match(opts.prompt, /image attachment 2 not forwarded: unsupported media type image\/tiff/);
    assert.deepEqual(opts.promptAttachments, [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } },
    ]);

    // A text-only turn carries no attachment key at all (not an empty array),
    // so the runner's call shape is unchanged for the common case.
    await c.prompt(sessionId, [{ type: 'text', text: 'plain text' }]);
    assert.equal('promptAttachments' in c.calls[1], false);

    // An image-only prompt is still a valid turn: run() requires text, so a
    // minimal stub stands in for it.
    await c.prompt(sessionId, [{ type: 'image', data: png, mimeType: 'image/jpeg' }]);
    assert.equal(c.calls[2].prompt, '(See attached image.)');
    assert.equal(c.calls[2].promptAttachments.length, 1);
  });

  it('applies the ACP step ceiling by default and lets the command line override it', async (t) => {
    // Passing `maxSteps: undefined` is the "nothing on the command line" case —
    // the spread must NOT clobber the default with that undefined.
    const bare = stubClient(t, { maxSteps: undefined });
    await bare.prompt(await bare.startSession(), [{ type: 'text', text: 'hi' }]);
    assert.equal(DEFAULT_ACP_MAX_STEPS, 1000);
    assert.equal(bare.calls[0].maxSteps, DEFAULT_ACP_MAX_STEPS);

    const pinned = stubClient(t, { maxSteps: 7 });
    await pinned.prompt(await pinned.startSession(), [{ type: 'text', text: 'hi' }]);
    assert.equal(pinned.calls[0].maxSteps, 7);
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
