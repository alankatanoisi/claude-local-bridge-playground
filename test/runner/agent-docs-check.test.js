'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const REPO = path.resolve(__dirname, '../..');
const CHECKER = path.join(REPO, 'scripts/check-agent-docs.js');

// Run the actual checker against a private view of the files. A pretend
// deletion or bad instruction never changes Alan's real working documents.
function checkDocs({ missing = [], edit = (_file, text) => text } = {}) {
  const hidden = missing.map((file) => path.join(REPO, file));
  const privateFs = Object.create(fs);
  privateFs.existsSync = (file) =>
    !hidden.some((target) => String(file) === target || String(file).startsWith(target + path.sep)) &&
    fs.existsSync(file);
  privateFs.readFileSync = (file, ...args) => edit(path.relative(REPO, file), fs.readFileSync(file, ...args));
  const output = [];
  const stopped = Symbol('checker exit');
  let exitCode = 0;
  const context = {
    require: (name) => (name === 'node:fs' ? privateFs : require(name)),
    process: {
      cwd: () => REPO,
      exit: (code) => {
        exitCode = code;
        throw stopped;
      },
    },
    console: {
      log: (...parts) => output.push(parts.join(' ')),
      error: (...parts) => output.push(parts.join(' ')),
    },
  };
  try {
    vm.runInNewContext(fs.readFileSync(CHECKER, 'utf8'), context, { filename: CHECKER });
  } catch (error) {
    // A checker error must be reported by its normal exit path. An unrelated
    // exception would make this test fail instead of counting as detection.
    if (error !== stopped) throw error;
  }
  return { exitCode, output: output.join('\n') };
}

function continueFirstBullet(text, section, continuation) {
  const lines = text.split('\n');
  const heading = lines.indexOf('## ' + section);
  assert.ok(heading >= 0);
  const bullet = lines.findIndex((line, index) => index > heading && line.startsWith('- '));
  assert.ok(bullet > heading);
  lines.splice(bullet + 1, 0, '  ' + continuation);
  return lines.join('\n');
}

describe('agent document checker regressions', () => {
  it('accepts the real mirrored documents', () => {
    const result = checkDocs();
    assert.equal(result.exitCode, 0, result.output);
    assert.match(result.output, /Agent docs & skills check passed/);
  });

  for (const file of [
    '.cursor/skills',
    '.agents/skills',
    '.cursor/agents/runner-command-builder.md',
    '.codex/agents/runner-command-builder.toml',
  ]) {
    it('rejects a missing required mirror: ' + file, () => {
      const result = checkDocs({ missing: [file] });
      assert.equal(result.exitCode, 1, 'a missing mirror must fail, not silently disable comparison');
      assert.ok(result.output.includes(file), 'the diagnostic must name the missing mirror');
    });
  }

  it('rejects simultaneous deletion of both skill roots', () => {
    const result = checkDocs({ missing: ['.cursor/skills', '.agents/skills'] });
    assert.equal(result.exitCode, 1);
    assert.match(result.output, /missing|required/i);
  });

  for (const section of ['Learned User Preferences', 'Learned Workspace Facts']) {
    it('rejects a continuation-only change in ' + section, () => {
      const result = checkDocs({
        edit: (file, text) =>
          file === 'CLAUDE.md'
            ? continueFirstBullet(text, section, 'Use the retired --profile flag for every edit.')
            : text,
      });
      assert.equal(result.exitCode, 1, 'continued instructions must be part of the comparison');
      assert.ok(result.output.includes(section));
    });
  }

  it('rejects different text in already continued bullets', () => {
    const result = checkDocs({
      edit: (file, text) =>
        ['AGENTS.md', 'CLAUDE.md'].includes(file)
          ? continueFirstBullet(
              text,
              'Learned User Preferences',
              file === 'AGENTS.md' ? 'Keep edits guarded.' : 'Allow every edit.',
            )
          : text,
    });
    assert.equal(result.exitCode, 1);
    assert.match(result.output, /Learned User Preferences/);
  });

  it('accepts harmless rewrapping of a complete bullet', () => {
    const result = checkDocs({
      edit: (file, text) => {
        if (file !== 'CLAUDE.md') return text;
        const heading = text.indexOf('## Learned User Preferences');
        const before = text.slice(0, heading);
        const after = text
          .slice(heading)
          .replace('as the primary day-to-day runner UX; ', 'as the primary\n  day-to-day runner UX; ');
        assert.notEqual(before + after, text, 'the positive control must actually change line wrapping');
        return before + after;
      },
    });
    assert.equal(result.exitCode, 0, result.output);
  });
});
