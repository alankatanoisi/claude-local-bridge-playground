'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ESLint } = require('eslint');

const REPO = path.resolve(__dirname, '../..');
const RULE = 'runner/no-raw-authority-flags';
// Match npm lint's explicit configuration. An older eslint.config.js also
// exists here, so relying on automatic discovery would test the wrong rules.
const eslint = new ESLint({ cwd: REPO, overrideConfigFile: path.join(REPO, 'eslint.config.cjs') });

// Ask the real repository configuration to check a pretend source file.
// Nothing is written to src/: these tests exercise the same rule as npm lint.
async function flagMessages(code, file = 'src/runner/lint-fixture.js') {
  const [result] = await eslint.lintText(code, { filePath: path.join(REPO, file) });
  assert.equal(result.fatalErrorCount, 0, 'the example must be valid JavaScript');
  return result.messages.filter((message) => message.ruleId === RULE);
}

describe('syntax-aware authority flag guard', () => {
  for (const expression of [
    'ctx.allowShell',
    'ctx?.plan',
    "ctx['noNetwork']",
    'ctx?.["allowShell"]',
    'ctx[`plan`]',
    'ctx["allow" + "Shell"]',
  ]) {
    it('rejects the raw read ' + expression, async () => {
      const messages = await flagMessages('function enabled(ctx) { return ' + expression + '; }');
      assert.equal(messages.length, 1, 'the real lint configuration must reject this raw read');
      assert.match(messages[0].message, /effectiveFlags/);
    });
  }

  for (const statement of [
    'const { allowShell } = ctx;',
    'const { plan: planning = false } = ctx;',
    'let noNetwork; ({ noNetwork } = ctx);',
    'const { ["plan"]: planning } = ctx;',
  ]) {
    it('rejects raw destructuring: ' + statement, async () => {
      const messages = await flagMessages('function enabled(ctx) { ' + statement + ' }');
      assert.equal(messages.length, 1, 'copying the property into a variable must not escape the guard');
    });
  }

  it('allows effective reads, unrelated properties, pure assignments, and text examples', async () => {
    const messages = await flagMessages(
      [
        'function enabled(ctx) {',
        '  ctx.plan = true;',
        '  const label = "ctx.allowShell";',
        '  // ctx.noNetwork is just an example in this comment.',
        '  return effectiveFlags(ctx).plan || ctx.planProposals || label;',
        '}',
      ].join('\n'),
    );
    assert.deepEqual(messages, []);
  });

  it('limits the authority implementation exemption to its two construction/clamping functions', async () => {
    const code = [
      'function createAuthorityCeiling(ctx) { return { plan: ctx.plan }; }',
      'function effectiveFlags(ctx) { return { allowShell: ctx.allowShell }; }',
      'function unrelated(ctx) { return ctx.noNetwork; }',
    ].join('\n');
    const messages = await flagMessages(code, 'src/runner/authority.js');
    assert.equal(messages.length, 1, 'a new helper must not inherit a whole-file exemption');
    assert.equal(messages[0].line, 3);
  });

  it('permits only the three direct startup trace fields, not arbitrary reads in run.js', async () => {
    const code = [
      'trace.append("run_started", { flags: {',
      '  allow_shell: ctx.allowShell, no_network: ctx.noNetwork, plan: ctx.plan',
      '} });',
      'trace.append("other_event", { flags: { plan: ctx.plan } });',
      'function behavior(ctx) { return ctx.allowShell; }',
      'trace.append("run_started", { flags: { arbitrary: ctx.plan } });',
    ].join('\n');
    const messages = await flagMessages(code, 'src/runner/run.js');
    assert.deepEqual(
      messages.map((message) => message.line),
      [4, 5, 6],
    );
  });
});
