'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { applyPromptTemplates, resolvePromptTemplate } = require('../../src/runner/prompt-templates');

describe('prompt templates', () => {
  it('loads the built-in read-only exploration template', () => {
    const priorHome = process.env.HOME;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-runner-empty-home-'));
    process.env.HOME = tmp;
    try {
      const template = resolvePromptTemplate(process.cwd(), 'explore');
      assert.equal(template.source, 'builtin:explore');
      assert.match(template.text, /Explore read-only/);
    } finally {
      if (priorHome === undefined) delete process.env.HOME;
      else process.env.HOME = priorHome;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('lets project templates override built-ins', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-runner-prompts-'));
    fs.mkdirSync(path.join(tmp, '.bridge-runner', 'prompts'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.bridge-runner', 'prompts', 'explore.md'), 'Project-specific explore.');
    try {
      const template = resolvePromptTemplate(tmp, 'explore');
      assert.equal(template.text, 'Project-specific explore.');
      assert.match(template.source, /\.bridge-runner/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('prepends templates to the user request', () => {
    const prompt = applyPromptTemplates('Find the entrypoint.', [
      { name: 'explore', text: 'Explore read-only.' },
      { name: 'cleanup', text: 'Prefer simple code.' },
    ]);
    assert.match(prompt, /## Prompt template: explore/);
    assert.match(prompt, /## Prompt template: cleanup/);
    assert.match(prompt, /## User request/);
    assert.match(prompt, /Find the entrypoint/);
  });
});
