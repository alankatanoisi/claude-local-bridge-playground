'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadInstructionMemory } = require('../../src/runner/memory/instruction-memory');

describe('instruction hierarchy', () => {
  let tmp;
  let origOrg;
  let origHome;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'instr-'));
    origOrg = process.env.BRIDGE_RUNNER_ORG_INSTRUCTIONS;
    origHome = process.env.HOME;
    process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'instr-home-'));
  });

  afterEach(() => {
    process.env.BRIDGE_RUNNER_ORG_INSTRUCTIONS = origOrg;
    process.env.HOME = origHome;
  });

  it('loads org, user, project, and local scopes in priority order', () => {
    const orgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'org-'));
    process.env.BRIDGE_RUNNER_ORG_INSTRUCTIONS = orgDir;
    fs.writeFileSync(path.join(orgDir, 'AGENTS.md'), 'org rules', 'utf8');

    const userDir = path.join(process.env.HOME, '.bridge-runner', 'instructions');
    fs.mkdirSync(userDir, { recursive: true });
    fs.writeFileSync(path.join(userDir, 'AGENTS.md'), 'user rules', 'utf8');

    fs.writeFileSync(path.join(tmp, 'AGENTS.md'), 'project rules', 'utf8');

    const localDir = path.join(tmp, '.bridge-runner', 'instructions');
    fs.mkdirSync(localDir, { recursive: true });
    fs.writeFileSync(path.join(localDir, 'local.md'), 'local rules', 'utf8');

    const mem = loadInstructionMemory(tmp, { includeProjectDocs: true });
    assert.ok(mem.sources.some((s) => s.startsWith('org:')));
    assert.ok(mem.sources.some((s) => s.startsWith('user:')));
    assert.ok(mem.sources.some((s) => s.startsWith('project:')));
    assert.ok(mem.sources.some((s) => s.startsWith('local:')));
    assert.match(mem.text, /org rules/);
    assert.match(mem.text, /local rules/);
  });
});
