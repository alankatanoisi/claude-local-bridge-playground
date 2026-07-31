'use strict';

/**
 * N1 — catalog-driven path-arg contract.
 *
 * The permission gate must see every filesystem target a tool accepts, not
 * only an argument literally named `path`. This test fails closed when:
 *   - a tool schema grows a canonical path-shaped key the catalog misses, or
 *   - the gate fails to deny a deny-listed basename delivered under that key.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { TOOLS, CANONICAL_PATH_ARG_KEYS, pathArgKeysFor } = require('../../src/runner/tool-catalog');
const permissions = require('../../src/runner/permissions');

/** Property names that look like filesystem targets but are not yet canonical. */
const PATHISH_NAME = /^(.*_)?path$|file_?path|filepath|target_path|directory|dir$/i;

describe('N1 path-arg contract', () => {
  let tmp;
  let ctx;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'n1-path-arg-'));
    fs.writeFileSync(path.join(tmp, '.env'), 'FAKE_SECRET=1\n');
    fs.writeFileSync(path.join(tmp, 'ok.txt'), 'hello\n');
    ctx = { cwd: tmp, cwdRealpath: fs.realpathSync(tmp) };
  });

  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('every schema path-shaped property is covered by pathArgKeysFor', () => {
    const gaps = [];
    for (const [name, mod] of Object.entries(TOOLS)) {
      const props = (mod.definition().input_schema && mod.definition().input_schema.properties) || {};
      const covered = new Set(pathArgKeysFor(name));
      for (const key of Object.keys(props)) {
        const isCanonical = CANONICAL_PATH_ARG_KEYS.includes(key);
        const isPathish = PATHISH_NAME.test(key);
        if (isCanonical || isPathish) {
          if (!covered.has(key)) {
            gaps.push(name + '.' + key);
          }
        }
      }
      // Explicit meta.pathArgs must name real schema properties (or be empty).
      if (Array.isArray(mod.meta.pathArgs)) {
        for (const key of mod.meta.pathArgs) {
          if (!Object.prototype.hasOwnProperty.call(props, key)) {
            gaps.push(name + '.meta.pathArgs:' + key + ' (missing from schema)');
          }
        }
      }
    }
    assert.deepEqual(gaps, [], 'path-arg catalog gaps: ' + gaps.join(', '));
  });

  it('gate denies deny-listed basename under every catalogued path arg key', () => {
    const failures = [];
    for (const [name] of Object.entries(TOOLS)) {
      const keys = pathArgKeysFor(name);
      for (const key of keys) {
        const args = { [key]: '.env' };
        const decision = permissions.check(name, args, ctx);
        if (!decision || decision.decision !== 'deny') {
          failures.push(name + ' via ' + key + ' → ' + (decision && decision.decision));
        }
      }
    }
    assert.deepEqual(failures, [], 'gate misses: ' + failures.join(', '));
  });

  it('gate still allows a normal in-cwd file under path', () => {
    const keys = pathArgKeysFor('read_file');
    assert.ok(keys.includes('path'));
    const decision = permissions.check('read_file', { path: 'ok.txt' }, ctx);
    assert.equal(decision.decision, 'allow');
  });

  it('gate denies file_path alias even when path is absent (N1 shape)', () => {
    // Simulate a future/unknown tool that only sends file_path. Unknown tools
    // fall back to the historical aliases so the gate stays target-aware.
    const decision = permissions.check('not_a_real_tool_n1', { file_path: '.env' }, ctx);
    assert.equal(decision.decision, 'deny');
    assert.match(decision.reason, /file_path=/);
  });
});
