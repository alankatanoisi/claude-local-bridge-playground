'use strict';

/**
 * P0-11 — centralized redaction before fan-out.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const { scrubDeepSecrets } = require('../../src/runner/redaction-boundary');
const safety = require('../../src/runner/safety');
const { SessionStore } = require('../../src/runner/session-store');
const { SessionLedger } = require('../../src/runner/session-ledger');
const { run } = require('../../src/runner/run');
const { modeBits, FILE_MODE, DIR_MODE } = require('../../src/runner/private-fs');

const SECRET = 'sk-ant-abc123def456ghi789jkl012mno345pqr678stu';
const skipModes = process.platform === 'win32';

describe('P0-11 redaction boundary', () => {
  it('scrubDeepSecrets walks nested objects without wiping sessionId keys', () => {
    const input = {
      sessionId: 'ses_keep_me',
      messages: [{ role: 'assistant', content: [{ type: 'text', text: 'key=' + SECRET }] }],
    };
    const out = scrubDeepSecrets(input);
    assert.equal(out.sessionId, 'ses_keep_me');
    assert.match(out.messages[0].content[0].text, /\[REDACTED:anthropic_key\]/);
    assert.doesNotMatch(out.messages[0].content[0].text, /sk-ant-abc123/);
  });

  it('session store persists scrubbed messages while in-memory stays usable', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p0-11-session-'));
    const file = path.join(tmp, 'ses.state.json');
    const store = new SessionStore(file);
    store.load();
    store.setMessages([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: [{ type: 'text', text: 'leak ' + SECRET }] },
    ]);
    store.save();

    const disk = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.match(JSON.stringify(disk), /\[REDACTED:anthropic_key\]/);
    assert.doesNotMatch(JSON.stringify(disk), /sk-ant-abc123/);
    // In-memory still has the raw text for the live loop.
    assert.match(store.data().messages[1].content[0].text, /sk-ant-abc123/);

    if (!skipModes) {
      assert.equal(modeBits(path.dirname(file)), DIR_MODE);
      assert.equal(modeBits(file), FILE_MODE);
    }
  });

  it('ledger appends scrubbed payloads and private modes', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p0-11-ledger-'));
    const sessionPath = path.join(tmp, 'a.state.json');
    const ledger = new SessionLedger(sessionPath);
    // Callers should scrub before append (run.js / tool-pipeline do); assert helper + mode.
    const scrubbed = scrubDeepSecrets({ prompt: 'see ' + SECRET });
    ledger.append('user_prompt', scrubbed);
    const raw = fs.readFileSync(ledger.filePath, 'utf8');
    assert.match(raw, /\[REDACTED:anthropic_key\]/);
    assert.doesNotMatch(raw, /sk-ant-abc123/);
    if (!skipModes) {
      assert.equal(modeBits(ledger.filePath), FILE_MODE);
      assert.equal(modeBits(ledger.cursorPath), FILE_MODE);
    }
  });

  it('streaming scrubber redacts a secret split across SSE-sized chunks', () => {
    const scrubber = safety.makeStreamingScrubber();
    const mid = Math.floor(SECRET.length / 2);
    const a = scrubber.push(SECRET.slice(0, mid));
    const b = scrubber.push(SECRET.slice(mid) + ' trailing');
    const end = scrubber.end();
    const out = a + b + end;
    assert.match(out, /\[REDACTED:anthropic_key\]/);
    assert.doesNotMatch(out, /sk-ant-abc123/);
  });

  it('json and stream-json outputs scrub assistant finalText', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p0-11-run-'));
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'msg_1',
          role: 'assistant',
          content: [{ type: 'text', text: 'Here is ' + SECRET }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      );
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const bridgeUrl = 'http://127.0.0.1:' + port + '/v1/messages';

    let stdout = '';
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk, ..._rest) => {
      stdout += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      return true;
    };
    try {
      await run({
        prompt: 'say hi',
        cwd: tmp,
        bridgeUrl,
        outputFormat: 'json',
        maxSteps: 1,
        trustWorkspace: true,
        skipTrustGate: true,
        noArchive: true,
      });
    } finally {
      process.stdout.write = originalWrite;
      server.close();
    }

    assert.match(stdout, /\[REDACTED:anthropic_key\]/);
    assert.doesNotMatch(stdout, /sk-ant-abc123/);
  });

  it('write_file still writes token-like content verbatim to disk', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p0-11-write-'));
    // Use a pattern that scrubSecrets would redact in display copies.
    const body = 'const TOKEN="supersecret_token_value_xyz";\n';
    const writeFile = require('../../src/runner/tools/write-file');
    const result = writeFile.execute({ path: 'secretish.js', content: body }, { cwd: tmp, cwdRealpath: tmp });
    assert.equal(result.ok, true, result.text);
    const written = fs.readFileSync(path.join(tmp, 'secretish.js'), 'utf8');
    assert.equal(written, body);
    // Display copy is scrubbed.
    const display = scrubDeepSecrets({ content: body });
    assert.match(display.content, /\[REDACTED\]/);
    assert.doesNotMatch(display.content, /supersecret_token_value_xyz/);
  });
});
