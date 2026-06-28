'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const loader = require('../../src/runner/agents/agent-loader');

function tmp(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-loader-' + label + '-'));
}

const SAMPLE_AGENT = `---
name: sample-reviewer
description: Sample read-only reviewer
tools: Read, Grep, Glob, WebFetch, Bash
model: opus
---

You are a sample reviewer.
`;

describe('agent-loader — parseFrontmatter', () => {
  it('parses valid frontmatter and body', () => {
    const parsed = loader.parseFrontmatter(SAMPLE_AGENT);
    assert.equal(parsed.name, 'sample-reviewer');
    assert.equal(parsed.description, 'Sample read-only reviewer');
    assert.equal(parsed.tools, 'Read, Grep, Glob, WebFetch, Bash');
    assert.equal(parsed.model, 'opus');
    assert.match(parsed.body, /sample reviewer/);
  });

  it('throws on missing frontmatter', () => {
    assert.throws(() => loader.parseFrontmatter('no frontmatter'), /frontmatter/i);
  });

  it('throws on missing name', () => {
    assert.throws(
      () =>
        loader.parseFrontmatter(`---
description: only desc
---
body`),
      /name/i,
    );
  });
});

describe('agent-loader — mapTools', () => {
  it('maps Read/Grep/Glob and always includes manage_tasks', () => {
    const { allowedTools, dropped, gated } = loader.mapTools(['Read', 'Grep', 'Glob']);
    assert.deepEqual(allowedTools, ['list_files', 'read_file', 'search_text', 'glob', 'manage_tasks']);
    assert.equal(dropped.length, 0);
    assert.equal(gated.length, 0);
  });

  it('drops WebFetch/WebSearch and MCP tools', () => {
    const { dropped } = loader.mapTools(['Read', 'WebFetch', 'WebSearch', 'mcp__foo__bar']);
    assert.ok(dropped.includes('WebFetch'));
    assert.ok(dropped.includes('WebSearch'));
    assert.ok(dropped.some((d) => d.startsWith('mcp__')));
  });

  it('gates Bash without allowShell', () => {
    const { allowedTools, gated } = loader.mapTools(['Read', 'Bash'], { allowShell: false });
    assert.ok(!allowedTools.includes('bash'));
    assert.deepEqual(gated, ['Bash']);
  });

  it('includes bash when allowShell is true', () => {
    const { allowedTools } = loader.mapTools(['Read', 'Bash'], { allowShell: true });
    assert.ok(allowedTools.includes('bash'));
  });
});

describe('agent-loader — mapModel', () => {
  it('returns undefined for inherit and sonnet', () => {
    assert.equal(loader.mapModel('inherit'), undefined);
    assert.equal(loader.mapModel('sonnet'), undefined);
  });

  it('maps opus and haiku conservatively', () => {
    assert.equal(loader.mapModel('opus'), loader.MODEL_ALIASES.opus);
    assert.equal(loader.mapModel('haiku'), loader.MODEL_ALIASES.haiku);
  });
});

describe('agent-loader — resolve and compile', () => {
  it('resolves by bare name under .bridge-runner/agents/', () => {
    const cwd = tmp('resolve');
    const dir = path.join(cwd, '.bridge-runner', 'agents');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'my-agent.md'), SAMPLE_AGENT);

    const resolved = loader.resolveAgentFile(cwd, 'my-agent');
    assert.ok(resolved);
    assert.equal(resolved.name, 'my-agent');
    assert.match(resolved.source, /my-agent\.md$/);

    const profile = loader.loadAgentProfile('my-agent', { cwd, allowShell: true });
    assert.equal(profile.id, 'sample-reviewer');
    assert.ok(profile.allowedTools.includes('bash'));
    assert.equal(profile.model, loader.MODEL_ALIASES.opus);
    assert.match(profile.systemPromptAddon, /sample reviewer/);
    assert.ok(profile.droppedToolsNote);
  });

  it('resolves explicit path', () => {
    const cwd = tmp('path');
    const filePath = path.join(cwd, 'custom-agent.md');
    fs.writeFileSync(filePath, SAMPLE_AGENT);

    const profile = loader.loadAgentProfile(filePath, { cwd, allowShell: false });
    assert.equal(profile.id, 'sample-reviewer');
    assert.ok(!profile.allowedTools.includes('bash'));
    assert.ok(profile.gatedToolsNote);
  });

  it('returns null for unknown name', () => {
    const cwd = tmp('missing');
    assert.equal(loader.loadAgentProfile('nope', { cwd }), null);
  });
});

describe('agent-loader — discoverFileAgentSummaries', () => {
  it('lists project agents', () => {
    const cwd = tmp('discover');
    const dir = path.join(cwd, '.bridge-runner', 'agents');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'listed.md'),
      `---
name: listed-agent
description: Listed for discovery
tools: Read
model: inherit
---
body`,
    );

    const list = loader.discoverFileAgentSummaries(cwd);
    assert.ok(list.some((a) => a.id === 'listed-agent' && a.scope === 'project'));
  });
});
