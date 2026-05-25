'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { maybeSummarize, SUMMARIZERS } = require('../../src/runner/tool-result-summarizers');

describe('E4 tool-result summarizers', () => {
  it('passes through text below the threshold unchanged', () => {
    const small = 'a'.repeat(1000);
    assert.equal(maybeSummarize('bash', small), null);
  });

  it('bash: keeps head + tail, drops the middle', () => {
    const lines = [];
    const pad = ' padding text to ensure threshold is hit'.repeat(2);
    for (let i = 0; i < 5000; i++) lines.push('line ' + i + pad);
    const text = lines.join('\n');
    const r = maybeSummarize('bash', text);
    assert.ok(r, 'bash summarizer fires above threshold');
    assert.ok(r.summary.includes('line 0'), 'kept head');
    assert.ok(r.summary.includes('line 4999'), 'kept tail');
    assert.ok(!r.summary.includes('line 2500'), 'dropped middle');
    assert.ok(r.droppedBytes > 0);
  });

  it('search_text: dedupes by file, keeps first match per file', () => {
    const lines = [];
    const pad = ' '.repeat(80);
    for (let f = 0; f < 200; f++) {
      for (let h = 0; h < 5; h++) {
        lines.push('src/file' + f + '.js:' + (h + 1) + ':match' + pad);
      }
    }
    const text = lines.join('\n');
    const r = maybeSummarize('search_text', text);
    assert.ok(r);
    const fileMatches = r.summary.match(/^src\/file\d+\.js:\d+:/gm) || [];
    assert.ok(fileMatches.length <= 50, 'capped at SEARCH_MAX_FILES');
    assert.ok(r.summary.includes('more files with matches'));
  });

  it('list_files: caps at 500 entries', () => {
    const lines = Array.from({ length: 2000 }, (_, i) => 'entry-' + i + '-' + 'x'.repeat(40));
    const text = lines.join('\n');
    const r = maybeSummarize('list_files', text);
    assert.ok(r);
    assert.ok(r.summary.includes('1500 more entries'));
  });

  it('read_file is NOT summarized', () => {
    const huge = 'x'.repeat(200_000);
    assert.equal(maybeSummarize('read_file', huge), null);
    assert.equal(SUMMARIZERS.read_file, undefined);
  });

  it('unknown tools pass through', () => {
    const huge = 'x'.repeat(200_000);
    assert.equal(maybeSummarize('frobnicate', huge), null);
  });

  it('BRIDGE_RUNNER_SUMMARIZE_THRESHOLD=0 disables summarization', () => {
    const prev = process.env.BRIDGE_RUNNER_SUMMARIZE_THRESHOLD;
    process.env.BRIDGE_RUNNER_SUMMARIZE_THRESHOLD = '0';
    try {
      const lines = Array.from({ length: 5000 }, (_, i) => 'l' + i).join('\n');
      assert.equal(maybeSummarize('bash', lines), null);
    } finally {
      if (prev === undefined) delete process.env.BRIDGE_RUNNER_SUMMARIZE_THRESHOLD;
      else process.env.BRIDGE_RUNNER_SUMMARIZE_THRESHOLD = prev;
    }
  });
});
