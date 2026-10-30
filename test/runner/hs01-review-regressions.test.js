'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const childProcess = require('child_process');
const { execute, executeForce } = require('../../src/runner/tool-registry');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hs01-review-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const name of ['ID_RSA', 'ID_ED25519', '.NETRC'])
    fs.writeFileSync(path.join(dir, name), 'DISPOSABLE_KEY_MARKER\n');
  fs.mkdirSync(path.join(dir, '.SSH'));
  fs.writeFileSync(path.join(dir, '.SSH', 'config'), 'DISPOSABLE_KEY_MARKER\n');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'safe.js'), 'SAFE_SEARCH_MARKER\n');
  fs.mkdirSync(path.join(dir, 'UPPER'));
  fs.writeFileSync(path.join(dir, 'UPPER', 'ID_RSA'), 'DISPOSABLE_KEY_MARKER\n');
  return { cwd: dir, cwdRealpath: fs.realpathSync(dir), allowShell: true, dontAsk: true };
}

describe('HS-01 review corrections', () => {
  it('denies dequoted and wildcard credential paths through both execution gates', async (t) => {
    const ctx = fixture(t);
    for (const command of [
      'cat I"D"_RSA',
      "cat ID_''RSA",
      'cat ID_\\RSA',
      'cat I[D]_RSA',
      'cat ID?RSA',
      'cat ID*RSA',
      'cat .S[S]H/config',
      'cat < I"D"_RSA',
      'printf x > I"D"_RSA',
      'head -n 1 I"D"_ED25519',
      'cd src; cat *',
    ]) {
      for (const run of [execute, executeForce]) {
        const result = await run('bash', { command }, ctx);
        assert.equal(result.ok, false, command);
        assert.match(result.text, /blocked/i, command);
        assert.ok(!result.text.includes('DISPOSABLE_KEY_MARKER'));
      }
    }
    assert.equal(fs.readFileSync(path.join(ctx.cwd, 'ID_RSA'), 'utf8'), 'DISPOSABLE_KEY_MARKER\n');
    if (fs.existsSync(path.join(ctx.cwd, 'upper'))) {
      const result = await execute('bash', { command: 'cat upper/*' }, ctx);
      assert.equal(result.ok, false, 'literal directory aliases must not hide glob matches');
    }
  });

  it('allows inline code, ordinary data and ordinary project globs', async (t) => {
    const ctx = fixture(t);
    for (const command of [
      `node -e "console.log('secret')"`,
      `node --eval "console.log('token.with.dots')"`,
      `node -p "'secret.value'"`,
      "printf '%s\\n' secret.value",
      'cat src/*.js',
      'cat src/safe.?s',
      "printf '%s\\n' token",
    ]) {
      const result = await execute('bash', { command }, ctx);
      assert.equal(result.ok, true, command + ': ' + result.text);
    }
    // Shell code arguments are exempted, but subsequent file operands are not.
    const result = await execute('bash', { command: `node -e "console.log('secret')" ID_RSA` }, ctx);
    assert.equal(result.ok, false);
  });

  for (const backend of ['rg', 'grep', 'node']) {
    it('checks search inputs before the ' + backend + ' backend reads them', (t) => {
      const ctx = fixture(t);
      if (backend !== 'node') {
        try {
          childProcess.execSync(backend + ' --version', { stdio: 'ignore', timeout: 3000 });
        } catch {
          t.skip(backend + ' is unavailable; other installed backends are tested independently');
          return;
        }
      }
      const sourceFile = require.resolve('../../src/runner/tools/search-text');
      const originalExec = childProcess.execSync;
      const rawOutputs = [];
      let searches = 0;
      // Load a private module instance so selecting a backend cannot alter any
      // other test's cached module or the machine's installed search tools.
      const instance = new Module(sourceFile, module);
      instance.filename = sourceFile;
      instance.paths = Module._nodeModulePaths(path.dirname(sourceFile));
      const normalRequire = instance.require.bind(instance);
      instance.require = (name) => {
        if (name === 'child_process')
          return {
            execSync(command, options) {
              if (/ --version$/.test(command)) {
                if (!command.startsWith(backend + ' ')) throw new Error('backend disabled for test');
                return '';
              }
              searches++;
              // Exercise the real installed backend, inspecting its output before
              // the production result filter can discard a protected hit.
              const output = originalExec(command, options);
              rawOutputs.push(output);
              return output;
            },
          };
        if (name === 'fs')
          return {
            ...fs,
            readdirSync(dir, options) {
              assert.ok(!String(dir).includes('.SSH'), 'must not descend into protected directory');
              return fs.readdirSync(dir, options);
            },
            readFileSync(file, options) {
              assert.ok(!/ID_RSA|ID_ED25519|\.NETRC|\.SSH/.test(String(file)), 'must not read protected data');
              return fs.readFileSync(file, options);
            },
          };
        return normalRequire(name);
      };
      instance._compile(fs.readFileSync(sourceFile, 'utf8'), sourceFile);
      const result = instance.exports.execute({ pattern: 'MARKER' }, ctx);
      assert.equal(result.ok, true, result.text);
      assert.match(result.text, /SAFE_SEARCH_MARKER/);
      assert.ok(!result.text.includes('DISPOSABLE_KEY_MARKER'));
      // A post-filter cannot make this assertion green: it inspects raw backend
      // bytes before filterSearchHits has a chance to discard protected hits.
      assert.ok(!rawOutputs.join('').includes('DISPOSABLE_KEY_MARKER'));
      assert.equal(searches > 0, backend !== 'node');
    });
  }
});
