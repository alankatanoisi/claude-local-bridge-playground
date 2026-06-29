'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { detectMediaKind, readImageResult } = require('../../src/runner/media-read');
const { buildToolResultContent, summarizeBlocksForLog } = require('../../src/runner/tool-result-content');

describe('media-read', () => {
  it('detects image and pdf kinds', () => {
    assert.equal(detectMediaKind('a.png'), 'image');
    assert.equal(detectMediaKind('b.PDF'), 'pdf');
    assert.equal(detectMediaKind('c.txt'), 'text');
  });

  it('builds image content blocks', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-read-'));
    const filePath = path.join(tmpDir, 'dot.png');
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
      'base64',
    );
    fs.writeFileSync(filePath, png);
    const stats = fs.statSync(filePath);
    const result = readImageResult(filePath, 'dot.png', stats);
    assert.equal(result.ok, true);
    assert.equal(result.multimodal, true);
    assert.equal(result.contentBlocks[0].type, 'image');
    assert.equal(result.contentBlocks[0].source.media_type, 'image/png');
  });
});

describe('tool-result-content', () => {
  it('returns string for text-only results', () => {
    assert.equal(buildToolResultContent({ text: 'hello' }), 'hello');
  });

  it('merges multimodal blocks with summary text', () => {
    const content = buildToolResultContent({
      text: 'summary',
      contentBlocks: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } }],
    });
    assert.ok(Array.isArray(content));
    assert.equal(content.length, 2);
    assert.ok(summarizeBlocksForLog(content).includes('[image'));
  });
});
