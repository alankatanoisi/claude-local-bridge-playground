'use strict';

/**
 * false-green-deny-matrix.test.js — deny-matrix hardening sweeps (FG-A series).
 *
 * "False-green" family: tests that exist so a FUTURE edit to the deny matrix,
 * the basename patterns, or the realpath tier cannot regress silently while
 * the rest of the suite stays 100% green. Point tests elsewhere pin single
 * examples; these sweeps quantify over the whole pattern lists, so pruning or
 * weakening any one entry fails loudly here.
 *
 * Related invariants: CLAUDE.md "Safety Rules" + "Path-safety status".
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const safety = require('../../src/runner/safety');
const permissions = require('../../src/runner/permissions');

function makeCtx() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-deny-'));
  return { tmp, ctx: { cwd: tmp, cwdRealpath: fs.realpathSync(tmp) } };
}

describe('FG-A deny-matrix pattern sweeps', () => {
  // FG-A1: every tier-1 directory segment must stay denied, both mid-path and
  // as the final segment, at the raw matcher AND through the permission gate.
  // A rename/removal of any one entry (e.g. dropping `.gnupg`) fails here even
  // though no point test elsewhere mentions it.
  const TIER1_DIRS = ['.git', '.ssh', '.aws', '.claude', '.gnupg', 'node_modules', 'actions-runner', '.bridge-runner'];
  const TIER1_CASE_VARIANTS = [
    '.GIT',
    '.SSH',
    '.AWS',
    '.CLAUDE',
    '.GNUPG',
    'NODE_MODULES',
    'ACTIONS-RUNNER',
    '.BRIDGE-RUNNER',
  ];

  it('FG-A1: all tier-1 directory segments are denied mid-path and as final segment', () => {
    for (const dir of TIER1_DIRS) {
      assert.equal(
        safety.isPathBlockedByDenyMatrix('/proj/' + dir + '/inner.txt'),
        true,
        'mid-path segment must be blocked: ' + dir,
      );
      assert.equal(safety.isPathBlockedByDenyMatrix('/proj/' + dir), true, 'final segment must be blocked: ' + dir);
    }
  });

  it('FG-A1b: the permission gate denies reads under every tier-1 directory', () => {
    const { ctx } = makeCtx();
    for (const dir of TIER1_DIRS) {
      const decision = permissions.check('read_file', { path: dir + '/inner.txt' }, ctx);
      assert.equal(decision.decision, 'deny', 'gate must deny ' + dir + '/inner.txt');
      assert.equal(decision.severity, 'hard_deny', dir + ' must be a hard deny, not bypassable');
    }
  });

  it('HS-01: case variants of every tier-1 directory stay denied', () => {
    // macOS normally treats `.ssh` and `.SSH` as the same directory. Linux
    // may treat them as two directories, but the runner's portable safety
    // rule is intentionally conservative: either spelling means the same
    // sensitive class and must be denied before the filesystem is touched.
    for (const dir of TIER1_CASE_VARIANTS) {
      assert.equal(
        safety.isPathBlockedByDenyMatrix('/proj/' + dir + '/inner.txt'),
        true,
        'mixed-case directory segment must be blocked: ' + dir,
      );
      assert.equal(
        safety.isPathBlockedByDenyMatrix('/proj/' + dir),
        true,
        'mixed-case final directory must be blocked: ' + dir,
      );
    }
  });

  // FG-A2: canonical sensitive basenames. One fixture per protection family.
  // If a pattern is deleted or edited so it no longer matches its family,
  // this sweep fails; the point tests in permissions.test.js only cover a few.
  const SENSITIVE_BASENAME_FIXTURES = [
    '.env',
    '.env.local',
    '.envrc',
    '.ENV', // /^\.env/i is case-insensitive by design
    '.netrc',
    '.NETRC',
    '.npmrc',
    '.NPMRC',
    'id_rsa',
    'ID_RSA',
    'id_rsa.pub', // prefix rule: anything starting with id_rsa
    'id_ed25519',
    'ID_ED25519',
    'server.pem',
    'private.key',
    'apple.p8',
    'bundle.p12',
    'cert.pfx',
    'credentials.json',
    'credentials-prod.json',
    'CREDENTIALS.JSON',
    'service_account.json',
    'service-account-ci.json',
    'firebase-app-adminsdk-abc.json',
    'token.txt',
    'github_token',
    'client_secret.json',
  ];

  it('FG-A2: every canonical sensitive basename stays blocked', () => {
    for (const name of SENSITIVE_BASENAME_FIXTURES) {
      assert.equal(safety.isBlockedBasename(name), true, 'must stay blocked: ' + name);
    }
  });

  it('FG-A3: dead-pattern detector — every BLOCKED_BASENAME_PATTERNS entry matches at least one fixture', () => {
    // Guards against "pattern rot": a regex edited into something that never
    // matches keeps every point test green (those fixtures still match OTHER
    // patterns) while silently shrinking protection. Requiring each pattern to
    // claim at least one fixture makes a never-matching pattern loud.
    for (const pattern of safety.BLOCKED_BASENAME_PATTERNS) {
      const hit = SENSITIVE_BASENAME_FIXTURES.some((name) => pattern.test(name));
      assert.equal(hit, true, 'pattern matches no known fixture (dead or drifted): ' + pattern);
    }
  });

  it('FG-A4: ordinary project filenames stay allowed (over-blocking canary)', () => {
    // The inverse guard: a pattern widened too far (e.g. /env/ instead of
    // /^\.env/) would break normal work. These names must remain usable.
    const INNOCENT = ['README.md', 'index.js', 'main.py', 'env.config.js', 'package.json', 'notes.txt'];
    for (const name of INNOCENT) {
      assert.equal(safety.isBlockedBasename(name), false, 'must stay allowed: ' + name);
    }
  });

  it('HS-01: similar-looking ordinary paths stay allowed', () => {
    // These names contain fragments of protected names, but none is the exact
    // protected directory segment or sensitive final filename. This guards
    // against "fixing" case handling with an over-broad substring rule.
    const innocentPaths = [
      '/proj/secrets/notes.txt',
      '/proj/tokenizer/index.js',
      '/proj/.github/workflows/check.yml',
      '/proj/node_modules-old/notes.txt',
      '/proj/actions-runner-notes/README.md',
    ];
    for (const candidate of innocentPaths) {
      assert.equal(safety.isPathBlockedByDenyMatrix(candidate), false, 'must stay allowed: ' + candidate);
    }
  });

  it('FG-A5: deny-matrix pattern list must not shrink below its known floor', () => {
    // Someone "simplifying" safety.js could drop whole tiers while every
    // remaining point test passes. Pin the floor sizes.
    assert.ok(
      safety.DENY_MATRIX_PATTERNS.length >= 9,
      'DENY_MATRIX_PATTERNS shrank below the known floor (9): ' + safety.DENY_MATRIX_PATTERNS.length,
    );
    assert.ok(
      safety.BLOCKED_BASENAME_PATTERNS.length >= 16,
      'BLOCKED_BASENAME_PATTERNS shrank below the known floor (16): ' + safety.BLOCKED_BASENAME_PATTERNS.length,
    );
  });
});

describe('FG-A symlink and filesystem-shape hardening', () => {
  it('FG-A6: chained symlinks (link → link → outside) are denied at resolveFileTarget', () => {
    const { tmp, ctx } = makeCtx();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-outside-'));
    fs.writeFileSync(path.join(outside, 'loot.txt'), 'outside content\n');
    // hop2 → outside file; hop1 → hop2; the model asks for hop1.
    fs.symlinkSync(path.join(outside, 'loot.txt'), path.join(tmp, 'hop2'));
    fs.symlinkSync(path.join(tmp, 'hop2'), path.join(tmp, 'hop1'));

    const resolved = safety.resolveFileTarget(ctx, 'hop1');
    assert.equal(resolved.allowed, false, 'chained symlink escape must be denied');
    assert.match(String(resolved.reason), /escapes|Blocked/i);
  });

  it('FG-A7: a symlinked --cwd still confines and still denies escapes', () => {
    // Alan's own setups can hit this: iCloud/Dropbox folders are often
    // reached through a symlink. Confinement must key off the realpath.
    const realDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-realcwd-'));
    fs.writeFileSync(path.join(realDir, 'inside.txt'), 'ok\n');
    const linkDir = path.join(os.tmpdir(), 'fg-linkcwd-' + process.pid);
    try {
      fs.symlinkSync(realDir, linkDir);
    } catch {
      return; // symlink creation not permitted on this volume — nothing to test
    }
    const validated = safety.validateCwd(linkDir);
    assert.equal(validated.valid, true);
    const ctx = { cwd: linkDir, cwdRealpath: validated.realpath };

    assert.equal(safety.resolveFileTarget(ctx, 'inside.txt').allowed, true);
    assert.equal(safety.resolveFileTarget(ctx, '../somewhere-else.txt').allowed, false);
    fs.rmSync(linkDir, { force: true });
  });

  // HS-01 (CLOSED): the deny policy now treats sensitive name classes as
  // case-insensitive independently of the host filesystem. That is stronger
  // than relying on realpath to repair spelling after the file already exists:
  // it also blocks a not-yet-created write target and a genuinely uppercase
  // sensitive name on a case-sensitive Linux filesystem.
  it('HS-01: case-variant key files and protected directories are denied', () => {
    const { tmp, ctx } = makeCtx();
    fs.writeFileSync(path.join(tmp, 'id_rsa'), 'FAKE KEY MATERIAL\n');
    fs.mkdirSync(path.join(tmp, '.ssh'));
    fs.writeFileSync(path.join(tmp, '.ssh', 'config'), 'FAKE TEST CONFIG\n');

    for (const requested of ['ID_RSA', '.SSH/CONFIG']) {
      const resolved = safety.resolveFileTarget(ctx, requested);
      assert.equal(resolved.allowed, false, requested + ' must be denied before any read or write');

      const readDecision = permissions.check('read_file', { path: requested }, ctx);
      assert.equal(readDecision.decision, 'deny', requested + ' must be a hard-denied read');
      assert.equal(readDecision.severity, 'hard_deny');

      const plannedWrite = permissions.check('write_file', { path: requested }, { ...ctx, plan: true });
      assert.equal(plannedWrite.decision, 'deny', requested + ' must not become a plan-mode diff/read channel');
      assert.equal(plannedWrite.severity, 'hard_deny');
    }
  });
});

describe('FG-A environment scrubbing floor', () => {
  it('FG-A8: SCRUBBED_ENV_VARS keeps its critical floor set', () => {
    // buildSafeEnv point tests only exercise two variables. If the list is
    // pruned during a refactor, those two could survive while others leak.
    const CRITICAL = [
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_SESSION_TOKEN',
      'ANTHROPIC_API_KEY',
      'CLAUDE_CODE_OAUTH_TOKEN',
      'GH_TOKEN',
      'GITHUB_TOKEN',
      'NPM_TOKEN',
      'OPENAI_API_KEY',
      'SSH_AUTH_SOCK',
    ];
    for (const name of CRITICAL) {
      assert.ok(safety.SCRUBBED_ENV_VARS.includes(name), 'SCRUBBED_ENV_VARS lost critical entry: ' + name);
    }
  });

  it('FG-A9: prefix families are scrubbed for names invented after this test was written', () => {
    // The prefix rules (AWS_/ANTHROPIC_/CLAUDE_/OPENAI_) are what protect
    // variables that do not exist yet. Exercise them with made-up names so a
    // refactor that keeps the static list but drops the prefix loop fails.
    const saved = {};
    const probes = {
      AWS_FUTURE_CREDENTIAL_X: 'a',
      ANTHROPIC_FUTURE_TOKEN_X: 'b',
      CLAUDE_FUTURE_SESSION_X: 'c',
      OPENAI_FUTURE_KEY_X: 'd',
    };
    for (const [k, v] of Object.entries(probes)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    try {
      const env = safety.buildSafeEnv();
      for (const k of Object.keys(probes)) {
        assert.equal(env[k], undefined, 'prefix scrubbing missed ' + k);
      }
      // And ordinary variables survive — scrubbing must not become "empty env".
      assert.ok(env.PATH, 'PATH must survive buildSafeEnv');
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
