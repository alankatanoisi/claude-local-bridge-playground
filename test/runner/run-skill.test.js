'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const runSkill = require('../../src/runner/tools/run-skill');

describe('run_skill tool', () => {
  it('loads skill body from .bridge-runner/skills/', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-skill-'));
    const dir = path.join(tmp, '.bridge-runner', 'skills');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'demo.md'),
      '---\nname: demo\ndescription: Demo skill\n---\n\nDo the demo thing.\n',
      'utf8',
    );

    const result = runSkill.execute({ name: 'demo' }, { cwd: tmp, cwdRealpath: tmp });
    assert.equal(result.ok, true);
    assert.match(result.text, /Do the demo thing/);
    assert.match(result.text, /source:/);
  });

  it('returns not found for missing skill', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-skill-miss-'));
    const result = runSkill.execute({ name: 'missing' }, { cwd: tmp, cwdRealpath: tmp });
    assert.equal(result.ok, false);
    assert.match(result.text, /not found/i);
  });
});
