'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const childProcess = require('child_process');
const { execute, executeForce } = require('../../src/runner/tool-registry');
const bashTool = require('../../src/runner/tools/bash');
const { scanShellCommand, isBlockedPathToken } = require('../../src/runner/shell-policy');

// A backslash can be part of a Mac/Linux filename. Windows treats it as a
// folder separator, so exercise those real filenames only where they exist.
const backslashShapes =
  process.platform === 'win32' ? [] : ["cat 'id_rsa\\x'", 'cat id_rsa\\\\x', "cat 'secret\\plan.md'"];

function fixture(t, { backslashNames = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hs01-review-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const name of ['ID_RSA', 'ID_ED25519', '.netrc', 'token'])
    fs.writeFileSync(path.join(dir, name), 'DISPOSABLE_KEY_MARKER\n');
  // Keep these special files out of ordinary-glob controls: secret\plan.md
  // really does match *.md, which should then be denied rather than read.
  if (backslashNames && process.platform !== 'win32') {
    for (const name of ['id_rsa\\x', 'secret\\plan.md'])
      fs.writeFileSync(path.join(dir, name), 'DISPOSABLE_KEY_MARKER\n');
  }
  fs.mkdirSync(path.join(dir, '.SSH'));
  fs.writeFileSync(path.join(dir, '.SSH', 'config'), 'DISPOSABLE_KEY_MARKER\n');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'safe.js'), 'SAFE_SEARCH_MARKER\n');
  fs.mkdirSync(path.join(dir, 'UPPER'));
  fs.writeFileSync(path.join(dir, 'UPPER', 'ID_RSA'), 'DISPOSABLE_KEY_MARKER\n');
  fs.mkdirSync(path.join(dir, 'keys'));
  fs.writeFileSync(path.join(dir, 'keys', 'ID_RSA'), 'DISPOSABLE_KEY_MARKER\n');
  // Keep the earlier uppercase search canary as well as the lowercase root
  // .netrc needed to reproduce Bash's case-sensitive *rc expansion.
  fs.writeFileSync(path.join(dir, 'keys', '.NETRC'), 'DISPOSABLE_KEY_MARKER\n');
  fs.writeFileSync(path.join(dir, 'README.md'), 'ORDINARY_FILE_MARKER\n');
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
      for (const run of [execute, executeForce]) {
        const result = await run('bash', { command: 'cat upper/*' }, ctx);
        assert.equal(result.ok, false, 'literal directory aliases must not hide glob matches');
        assert.ok(!result.text.includes('DISPOSABLE_KEY_MARKER'));
      }
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
      'cat README.md',
      'ls *.md',
      'echo hello world',
      'git --version',
      // Ordinary nested shells and harmless negated globs must remain usable.
      "bash -c 'cat README.md'",
      'ls [!z]*.md',
    ]) {
      for (const run of [execute, executeForce]) {
        const result = await run('bash', { command }, ctx);
        assert.equal(result.ok, true, run.name + ': ' + command + ': ' + result.text);
        assert.ok(!result.text.includes('DISPOSABLE_KEY_MARKER'));
        if (command === 'cat README.md') assert.match(result.text, /ORDINARY_FILE_MARKER/);
        if (command === `node -e "console.log('secret')"`) assert.equal(result.text.trim(), 'secret');
        if (command === 'cat src/*.js') assert.match(result.text, /SAFE_SEARCH_MARKER/);
      }
    }
    // Shell code arguments are exempted, but subsequent file operands are not.
    for (const run of [execute, executeForce]) {
      const result = await run('bash', { command: `node -e "console.log('secret')" ID_RSA` }, ctx);
      assert.equal(result.ok, false);
      assert.ok(!result.text.includes('DISPOSABLE_KEY_MARKER'));
    }
  });

  it('allows Bash dollar-quoted scripts with the host shell and installed dash as outer parsers', async (t) => {
    const ctx = fixture(t);
    const controls = [
      { script: "bash -c $'cat README.md'", output: 'ORDINARY_FILE_MARKER' },
      { script: "bash -c 'printf %s \"$1\"' ignored $'hello' $'world'", output: 'hello' },
      { script: "printf '%s' $'hello' $'world'", output: 'helloworld' },
    ];
    // Single quotes understood by both Bash and dash protect the whole script
    // until the explicitly requested Bash parser receives it. An embedded
    // single quote is expressed by ending the quote, escaping it, and reopening.
    const quoteForOuterShell = (script) => "'" + script.replace(/'/g, "'\\''") + "'";
    const shells = [true]; // true means the runtime's normal host shell.
    if (fs.existsSync('/bin/dash')) shells.push('/bin/dash');
    const sourceFile = require.resolve('../../src/runner/tools/bash');
    let implementation;
    t.mock.method(bashTool, 'execute', (...args) => implementation(...args));

    for (const outerShell of shells) {
      // A private module keeps the runtime unchanged while reproducing Linux's
      // dash outer parser on any machine where dash is installed (including
      // this Mac). Both real registry execution gates still run their checks.
      const instance = new Module(sourceFile, module);
      instance.filename = sourceFile;
      instance.paths = Module._nodeModulePaths(path.dirname(sourceFile));
      const normalRequire = instance.require.bind(instance);
      let launches = 0;
      instance.require = (name) =>
        name === 'child_process'
          ? {
              ...childProcess,
              spawnSync(command, args, options) {
                assert.equal(options.shell, true, 'the production launcher still requests the host shell');
                launches++;
                return childProcess.spawnSync(command, args, { ...options, shell: outerShell });
              },
            }
          : normalRequire(name);
      instance._compile(fs.readFileSync(sourceFile, 'utf8'), sourceFile);
      implementation = instance.exports.execute;

      for (const { script, output } of controls) {
        // Keep direct coverage of the original scanner input. Wrapping the
        // execution must not accidentally stop testing Bash's quote syntax.
        assert.equal(scanShellCommand(script, ctx).allowed, true, script);
        const command = 'bash -c ' + quoteForOuterShell(script);
        for (const run of [execute, executeForce]) {
          const result = await run('bash', { command }, ctx);
          assert.equal(result.ok, true, `${outerShell}: ${run.name}: ${result.text}`);
          assert.equal(result.text.trim(), output, 'ordinary data must survive every quoting layer exactly');
          assert.ok(!result.text.includes('DISPOSABLE_KEY_MARKER'));
        }
      }
      assert.equal(
        launches,
        controls.length * 2,
        'each control must reach the real process launcher through both gates',
      );
    }
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
              assert.ok(
                !/ID_RSA|ID_ED25519|\.NETRC|\.SSH|\btoken\b/i.test(String(file)),
                'must not read protected data',
              );
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

// Keep every review example explicit: a future failure should name the exact
// shell shape and gate, rather than hiding later examples behind an early exit.
const reviewShapes = [
  'echo ok\ncat id_rsa',
  'echo "$(cat id_rsa)"',
  'echo $(cat token)',
  'echo `cat id_rsa`',
  'node -e "$(cat id_rsa)"',
  'x=$(cat token); echo "$x"',
  "sh -c 'cat id_rsa'",
  'bash -c "cat token"',
  "eval 'cat token'",
  'env cat token',
  'command cat token',
  '{ cat token; }',
  'if true; then cat token; fi',
  'printf "%s" "$(cat ID_RSA)"',
  'cat I[[:upper:]]_RSA',
  'cat I[]D]_RSA',
  'shopt -s nocaseglob; cat id_rs?',
  'shopt -s dotglob; cat *rc',
  'GLOBIGNORE=x; cat *rc',
  // Ignoring case can SHRINK a negated class: [!d] matches uppercase D in
  // ordinary Bash. These examples must not disappear from the candidate set.
  'cat I[!d]_RSA',
  'cat I[^d]_RSA',
  'cat ?[!d]_RSA',
  'cat ID_[!r]SA',
  ...backslashShapes,
  // Bash can enable glob options before running a quoted command. Quoting
  // hides its wildcard from the outer word reader, but the option still acts.
  "bash -O nocaseglob -c 'cat id_rs?'",
  "bash -O dotglob -c 'cat *rc'",
  'bash -O dotglob -c "cat *rc"',
  "bash -O 'dotglob' -c 'cat *rc'",
  "/bin/bash -O no'case'glob -c 'cat id_rs?'",
  "bash '-O' nocaseglob -c 'cat id_rs?'",
  "bash -Oc nocaseglob 'cat id_rs?'",
  "bash -O dotglob -O nocaseglob -c 'cat *rc'",
  "bash -O globstar -c 'cat **/ID?RSA'",
  "bash -O extglob -c 'cat @(ID_RSA)'",
  // Dollar-prefixed quotes are Bash syntax too, including hexadecimal escapes.
  "bash -O $'dotglob' -c 'cat *rc'",
  "bash $'-O' dotglob -c 'cat *rc'",
  'bash -O $"dotglob" -c \'cat *rc\'',
  "bash -O $'nocaseglob' -c 'cat id_rs?'",
  "bash -O $'dot\\x67lob' -c 'cat *rc'",
  "bash $'\\x2d\\x4f' $'dot\\x67lob' -c 'cat *rc'",
  "bash -O nullglob $'-O' dotglob -c 'cat *rc'",
  "bash --rcfile /dev/null $'-O' dotglob -c 'cat *rc'",
  "bash --init-file /dev/null $'-O' dotglob -c 'cat *rc'",
];

describe('HS-01 November follow-up: real execution boundaries', () => {
  for (const command of reviewShapes) {
    for (const run of [execute, executeForce]) {
      it(run.name + ' denies ' + JSON.stringify(command) + ' without returning the fake marker', async (t) => {
        const ctx = fixture(t, { backslashNames: backslashShapes.includes(command) });
        // This spy calls the real tool if reached; it never invents a denial.
        // Zero tool calls proves neither a new process nor a persistent shell
        // received the command. A program error cannot satisfy this check.
        const shellExecution = t.mock.method(bashTool, 'execute');
        const result = await run('bash', { command }, ctx);
        const markerReturned = result.text.includes('DISPOSABLE_KEY_MARKER');
        // This diagnostic makes the untouched baseline useful even when the
        // assertions fail. A child program error alone is not a policy denial.
        t.diagnostic(
          JSON.stringify({
            gate: run.name,
            command,
            ok: result.ok,
            markerReturned,
            toolCalls: shellExecution.mock.callCount(),
          }),
        );
        assert.equal(markerReturned, false, 'fake protected-file content escaped');
        assert.equal(result.ok, false, 'command must be refused before execution');
        assert.match(result.text, /blocked/i, 'must be a policy block, not a shell error');
        assert.equal(result.permission.ruleId, 'shell_hard_deny');
        assert.equal(shellExecution.mock.callCount(), 0, 'must deny before entering the shell tool');
        assert.equal(scanShellCommand(command, ctx).allowed, false);
      });
    }
  }
});

// Frozen extractPathTokens body from main at 023d056. Do not replace this
// helper with an import of the implementation: that would let both weaken
// together while the test stayed green. It needs no Git access at test time.
function legacyRawPathTokens(command) {
  const tokens = [];
  const redirectMatches = command.match(/(?:>>?|\|)\s*([^\s|;&]+)/g) || [];
  for (const m of redirectMatches) {
    tokens.push(m.replace(/^(>>?|\|)\s*/, '').trim());
  }
  const argMatches = command.match(/(?:cat|head|tail|less|more|grep|node|python3?|php|ruby)\s+([^\s|;&]+)/gi) || [];
  for (const m of argMatches) {
    const parts = m.split(/\s+/);
    if (parts[1]) tokens.push(parts[1]);
  }
  if (/\bcat\b/i.test(command)) {
    const catArgs = command.match(/\bcat\b[^\n|;&]*/i);
    if (catArgs) {
      for (const part of catArgs[0].split(/\s+/).slice(1)) {
        if (part && !part.startsWith('-')) tokens.push(part);
      }
    }
  }
  return tokens;
}

describe('HS-01 raw-scan coverage and conservative glob limits', () => {
  it('preserves every legacy raw-scan denial in a fixed corpus', (t) => {
    const ctx = fixture(t);
    const corpus = [
      ...reviewShapes.slice(0, 13),
      'cat id_rsa',
      'cat keys/id_rsa',
      'cat safe.txt token',
      'cat -n token',
      'head token',
      'tail token',
      'less token',
      'more token',
      'grep token',
      'node token',
      'python token',
      'python3 token',
      'php token',
      'ruby token',
      'printf x > token',
      'printf x >> token',
      'echo x | token',
      'cat .netrc',
      'cat .npmrc',
      'cat credentials.json',
      'cat file.pem',
      ...backslashShapes,
    ];
    // These corpus paths are all lowercase, and were blocked on main too.
    // Use the frozen extraction plus shared path rules to prevent the new
    // reader's command/data exemptions from deleting those older denials.
    const missing = corpus.filter((command) => {
      assert.ok(legacyRawPathTokens(command).some(isBlockedPathToken), 'invalid legacy corpus entry: ' + command);
      return scanShellCommand(command, ctx).allowed;
    });
    assert.deepEqual(missing, [], 'raw-scan denials must survive the word reader');
  });

  it('protects both literal POSIX basenames and Windows-style path spellings', () => {
    // Explicit expected answers keep this check independent of the corpus's
    // shared predicate: the implementation cannot weaken its own test oracle.
    for (const token of ['id_rsa\\x', 'secret\\plan.md', 'C:\\work\\ID_RSA', 'C:\\work\\.AWS\\config']) {
      assert.equal(isBlockedPathToken(token), true, token);
    }
    assert.equal(isBlockedPathToken('notes\\plan.md'), false);
  });

  it('does not join option words across command separators', (t) => {
    const ctx = fixture(t);
    assert.equal(scanShellCommand('echo -O; echo dotglob', ctx).allowed, true);
  });

  for (const command of [
    'cat I[]_RSA',
    'cat I[!]_RSA',
    'cat I[^]_RSA',
    // Single quotes keep the backslash inside the brackets for Bash to see.
    "cat 'I[D\\]_RSA'*",
    // Two shell backslashes preserve one inside an active bracket pattern.
    'cat I[Z\\\\q]_RSA',
    'cat id_rs?',
    'shopt -s dotglob; cat *rc*',
    'GLOBIGNORE=x; cat *rc*',
    'cd keys; cat *',
  ]) {
    for (const run of [execute, executeForce]) {
      it(run.name + ' fails closed for ' + JSON.stringify(command), async (t) => {
        const ctx = fixture(t);
        const result = await run('bash', { command }, ctx);
        assert.ok(!result.text.includes('DISPOSABLE_KEY_MARKER'));
        assert.equal(result.ok, false);
        assert.match(result.text, /blocked/i);
      });
    }
  }
});
