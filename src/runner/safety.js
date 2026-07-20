'use strict';

/**
 * safety.js — Single chokepoint for path confinement and secret redaction.
 *
 * All tool results pass through here before they reach messages, transcripts,
 * or stream-json events. This guarantees secrets are never logged.
 *
 * Functions:
 *   validateCwd(cwd)           — realpath-resolve, reject system dirs
 *   confinePath(ctx, inputPath) — resolve + realpath containment check
 *   scrubSecrets(text)          — regex redaction of API keys, tokens, key blocks
 *   buildSafeEnv()              — filtered process.env for execSync
 *   isPathBlockedByDenyMatrix() — glob-like pattern matching for sensitive paths
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// D2: per-session realpath cache. Keyed on the ctx object itself so the cache
// is GC'd with the session. Permission checks stay synchronous; cache lookups
// are Map.get/set, not Promises — no TOCTOU regression because the deny
// matrix still runs on every call.
// ---------------------------------------------------------------------------

const _realpathCacheByCtx = new WeakMap();

function _getRealpathCache(ctx) {
  if (!ctx) return null;
  let m = _realpathCacheByCtx.get(ctx);
  if (!m) {
    m = new Map();
    _realpathCacheByCtx.set(ctx, m);
  }
  return m;
}

function cachedRealpathSync(ctx, p) {
  const cache = _getRealpathCache(ctx);
  if (!cache) return fs.realpathSync(p);
  const hit = cache.get(p);
  if (hit !== undefined) return hit;
  const real = fs.realpathSync(p);
  cache.set(p, real);
  return real;
}

function invalidateRealpathCache(ctx, paths) {
  if (!ctx) return;
  const cache = _realpathCacheByCtx.get(ctx);
  if (!cache) return;
  if (!paths || paths.length === 0) {
    cache.clear();
    return;
  }
  for (const p of paths) {
    cache.delete(p);
    if (!path.isAbsolute(p) && ctx.cwdRealpath) {
      cache.delete(path.resolve(ctx.cwdRealpath, p));
    }
  }
}

// ---------------------------------------------------------------------------
// System directories that the runner must never operate inside
// ---------------------------------------------------------------------------

const SYSTEM_DIRS = [
  '/',
  '/etc',
  '/usr',
  '/bin',
  '/sbin',
  '/var',
  '/tmp',
  '/System',
  '/Library',
  '/Applications',
  '/private',
  '/dev',
];

// Noise directories that traversal tools (list_files, search_text) skip and
// that the permission layer treats as blocked basenames. Lives here — a shared
// leaf both the tools and permissions import — so tool modules never depend on
// permissions.js (which would otherwise create a require cycle once the tool
// catalog derives categories from the tool modules).
const BLOCKED_DIRS = ['.git', 'node_modules', 'dist', 'build', 'coverage', 'actions-runner'];

// ---------------------------------------------------------------------------
// Deny matrix — path patterns that are always denied (read or write)
// ---------------------------------------------------------------------------

const DENY_MATRIX_PATTERNS = [
  // Blocked directory segments (checked against the full resolved path)
  (p) => p.includes('/.git/') || p.endsWith('/.git'),
  (p) => p.includes('/.ssh/') || p.endsWith('/.ssh'),
  (p) => p.includes('/.aws/') || p.endsWith('/.aws'),
  (p) => p.includes('/.claude/') || p.endsWith('/.claude'),
  (p) => p.includes('/.gnupg/') || p.endsWith('/.gnupg'),
  (p) => p.includes('/node_modules/') || p.endsWith('/node_modules'),
  (p) => p.includes('/actions-runner/') || p.endsWith('/actions-runner'),
  // Block env files conservatively: .env, .env.test, .envrc, .env.example.
  (p) => /^\.env/i.test(path.basename(p)),
  (p) => path.basename(p) === '.netrc',
  (p) => path.basename(p) === '.npmrc',
  // Blocked basename patterns
  (p) => /^id_rsa/.test(path.basename(p)),
  (p) => /^id_ed25519/.test(path.basename(p)),
  (p) => path.basename(p).endsWith('.pem'),
  (p) => path.basename(p).endsWith('.key'),
  (p) => path.basename(p).endsWith('.p8'),
  (p) => path.basename(p).endsWith('.p12'),
  (p) => path.basename(p).endsWith('.pfx'),
  (p) => /^credentials.*\.json$/i.test(path.basename(p)),
  (p) => /service[-_]?account.*\.json$/i.test(path.basename(p)),
  (p) => /firebase.*adminsdk.*\.json$/i.test(path.basename(p)),
  (p) => /^token.*$/i.test(path.basename(p)),
  (p) => /_token$/i.test(path.basename(p)),
  (p) => /secret/i.test(path.basename(p)),
];

// ---------------------------------------------------------------------------
// Secret redaction patterns
// ---------------------------------------------------------------------------

// These are not "passwords", but they can still tie logs back to a person,
// device, account, organization, or long-lived session. We only redact them
// when nearby text says what the value is (for example "device_id=...").
// That keeps ordinary UUIDs useful for debugging local runs.
const STABLE_IDENTIFIER_VALUE =
  '(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[A-Za-z0-9][A-Za-z0-9._-]{15,})';

const STABLE_IDENTIFIER_KEY = '[a-z0-9_.-]*(?:device|machine|organization|org|account|session)[_-]?(?:id|uuid)';
const STABLE_IDENTIFIER_KEY_PATTERN = new RegExp('^' + STABLE_IDENTIFIER_KEY + '$', 'i');

const STABLE_IDENTIFIER_PATTERNS = [
  {
    // Matches JSON, headers, and simple assignments:
    //   "deviceId": "abc..."
    //   organization_uuid=abc...
    //   x-session-id: abc...
    pattern: new RegExp(
      '((?:["\\\']?)' + STABLE_IDENTIFIER_KEY + '(?:["\\\']?)\\s*[:=]\\s*)(["\\\']?)' + STABLE_IDENTIFIER_VALUE + '\\2',
      'gi',
    ),
    replacement: (_match, prefix, quote) => prefix + quote + '[REDACTED:stable_identifier]' + quote,
  },
];

const SECRET_PATTERNS = [
  // Private key blocks (multi-line)
  {
    pattern:
      /-----BEGIN (?:RSA|OPENSSH|EC|DSA|PGP) PRIVATE KEY-----[\s\S]*?-----END (?:RSA|OPENSSH|EC|DSA|PGP) PRIVATE KEY-----/g,
    replacement: '[REDACTED:private_key_block]',
  },
  // Anthropic API keys
  { pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/g, replacement: '[REDACTED:anthropic_key]' },
  // Generic sk-style API keys from third-party tools.
  { pattern: /sk-[a-zA-Z0-9]{20,}/g, replacement: '[REDACTED:generic_api_key]' },
  // GitHub personal access tokens
  { pattern: /ghp_[A-Za-z0-9]{36}/g, replacement: '[REDACTED:github_token]' },
  // GitHub classic tokens
  { pattern: /gho_[A-Za-z0-9]{36}/g, replacement: '[REDACTED:github_token]' },
  // AWS access keys
  { pattern: /AKIA[0-9A-Z]{16}/g, replacement: '[REDACTED:aws_access_key]' },
  // AWS secret keys (less specific but still worth catching)
  { pattern: /aws_secret_access_key\s*=\s*[^\s]+/gi, replacement: 'aws_secret_access_key=[REDACTED]' },
  // Bearer tokens in text
  { pattern: /Bearer\s+[A-Za-z0-9._-]{20,}/g, replacement: 'Bearer [REDACTED]' },
  // Generic OAuth-like tokens (ey... base64 JWT headers)
  { pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, replacement: '[REDACTED:jwt]' },
  // Lines containing explicit secret assignment
  {
    pattern: /^(\s*.*(?:SECRET|TOKEN|PASSWORD|API.?KEY)\s*=\s*)(['"]?)([^\s'";,)}]+)(\2)/gim,
    replacement: (_match, prefix, quote, _value, closeQuote) => prefix + quote + '[REDACTED]' + closeQuote,
  },
];

// ---------------------------------------------------------------------------
// Environment variables to scrub from shell commands
// ---------------------------------------------------------------------------

const SCRUBBED_ENV_VARS = [
  'SSH_AUTH_SOCK',
  'SSH_AGENT_PID',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_PROFILE',
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CONFIG_DIR',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'NPM_TOKEN',
  'OPENAI_API_KEY',
];

// ---------------------------------------------------------------------------
// validateCwd — called at run startup
// ---------------------------------------------------------------------------

/**
 * Validate and resolve the working directory.
 * Rejects system directories and non-existent paths.
 * Populates ctx.cwdRealpath with the resolved absolute path.
 *
 * @param {string} cwd — user-supplied working directory
 * @returns {{ valid: true, realpath: string } | { valid: false, reason: string }}
 */
function validateCwd(cwd) {
  const input = cwd || process.cwd();

  let real;
  try {
    real = fs.realpathSync(input);
  } catch {
    return { valid: false, reason: 'Working directory does not exist: ' + input };
  }

  // Block system directories
  for (const sysDir of SYSTEM_DIRS) {
    if (real === sysDir || real === sysDir + '/') {
      return { valid: false, reason: 'Refusing to run in system directory: ' + real };
    }
  }

  // Block home directory (exact match only — not subdirectories)
  const home = process.env.HOME || process.env.USERPROFILE;
  let realHome = null;
  try {
    realHome = home ? fs.realpathSync(home) : null;
  } catch {
    realHome = home || null;
  }
  if (realHome && real === realHome) {
    return {
      valid: false,
      reason: 'Refusing to run in home directory directly. Specify a subdirectory.',
    };
  }

  return { valid: true, realpath: real };
}

// ---------------------------------------------------------------------------
// confinePath — realpath-based containment check
// ---------------------------------------------------------------------------

/**
 * Resolve a requested relative path and verify it stays inside the working
 * directory using realpath to defeat symlink escapes.
 *
 * For non-existent paths (e.g. during write_file), the deepest existing
 * parent is realpath-checked.
 *
 * @param {object} ctx — { cwdRealpath }
 * @param {string} inputPath — relative path from the model
 * @returns {string|null} resolved absolute path, or null if containment fails
 */
function confinePath(ctx, inputPath) {
  if (path.isAbsolute(inputPath)) return null;

  const cwdInput = ctx.cwdRealpath || ctx.cwd || process.cwd();
  const cwdAbs = path.resolve(cwdInput);
  const resolved = path.resolve(cwdAbs, inputPath);

  // First do a plain path check. This catches simple "../" escapes and gives
  // tests with fake cwd values a safe fallback when the cwd does not exist.
  if (!resolved.startsWith(cwdAbs + path.sep) && resolved !== cwdAbs) {
    return null;
  }

  let realCwd;
  try {
    realCwd = cachedRealpathSync(ctx, cwdAbs);
  } catch {
    return resolved;
  }

  // Find the deepest existing component for realpath anchoring
  let anchor = resolved;
  while (anchor !== path.dirname(anchor) && !fs.existsSync(anchor)) {
    anchor = path.dirname(anchor);
  }

  try {
    const realAnchor = cachedRealpathSync(ctx, anchor);
    if (!realAnchor.startsWith(realCwd + path.sep) && realAnchor !== realCwd) {
      return null; // containment violation
    }
  } catch {
    return null;
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// scrubSecrets — regex-based redaction
// ---------------------------------------------------------------------------

/**
 * Replace stable telemetry-style identifiers when they are labeled in text.
 * This is intentionally narrower than "redact every UUID" because local run
 * ids, tool ids, and file names are useful breadcrumbs when debugging.
 *
 * @param {string} text
 * @returns {string}
 */
function scrubStableIdentifiers(text) {
  if (!text || typeof text !== 'string') return text;
  for (const { pattern, replacement } of STABLE_IDENTIFIER_PATTERNS) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

function isStableIdentifierKey(key) {
  return STABLE_IDENTIFIER_KEY_PATTERN.test(String(key || ''));
}

/**
 * Replace secrets in a text string with redaction markers.
 * Used on all tool results before they enter messages or transcripts.
 *
 * @param {string} text
 * @returns {string}
 */
function scrubSecrets(text) {
  if (!text || typeof text !== 'string') return text;
  text = scrubStableIdentifiers(text);
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

/**
 * Walk through arrays and plain objects, scrubbing any string values found
 * inside. Think of this like checking every drawer in a filing cabinet: the
 * shape of the object stays the same, but sensitive text inside gets covered.
 *
 * @param {*} value
 * @param {(text: string) => string} scrubFn
 * @param {{preserveRootStableIdentifierKeys?: string[]}} options
 * @returns {*}
 */
function scrubObject(value, scrubFn = scrubSecrets, options = {}, parentKey = null, depth = 0) {
  if (typeof value === 'string') {
    const preserveRootKeys = options.preserveRootStableIdentifierKeys || [];
    const isPreservedRootKey = depth === 1 && preserveRootKeys.includes(parentKey);
    if (isStableIdentifierKey(parentKey) && !isPreservedRootKey) {
      return '[REDACTED:stable_identifier]';
    }
    return scrubFn(value);
  }
  if (Array.isArray(value)) return value.map((item) => scrubObject(item, scrubFn, options, parentKey, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = scrubObject(item, scrubFn, options, key, depth + 1);
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// makeStreamingScrubber — line-aligned scrubber for chunked outputs (P1-11)
// ---------------------------------------------------------------------------

// Memory bounds. A single line with no newline is flushed in fixed-size slabs
// once it exceeds STREAM_MAX_LINE_HOLD; an unterminated private-key block is
// redacted fail-closed once it exceeds STREAM_MAX_PEM_HOLD.
const STREAM_MAX_LINE_HOLD = 64 * 1024;
const STREAM_MAX_PEM_HOLD = 256 * 1024;

// Fence markers for multi-line private-key blocks. Kept in sync with the
// private-key entry in SECRET_PATTERNS above.
const PEM_BEGIN_MARKER = /-----BEGIN (?:RSA|OPENSSH|EC|DSA|PGP) PRIVATE KEY-----/;
const PEM_END_MARKER = /-----END (?:RSA|OPENSSH|EC|DSA|PGP) PRIVATE KEY-----/;

/**
 * Create a streaming scrubber whose output is *split-invariant*: for a given
 * total input, the concatenated output of push()/end() is identical no matter
 * where the chunk boundaries fall (P1-11 acceptance criterion).
 *
 * How it works (replaces the old fixed 4KB trailing window, which could emit
 * half of a secret before the rest of it arrived):
 *
 *   1. Line alignment — complete lines are scrubbed and emitted as whole
 *      units; the trailing incomplete line is held until its newline (or
 *      end()) arrives. Every single-line pattern (API keys, JWTs, labeled
 *      stable identifiers, SECRET=... assignments) therefore sees the whole
 *      line at once, regardless of chunking.
 *   2. Bounded PEM parser — a `-----BEGIN ... PRIVATE KEY-----` fence with no
 *      END on the same line switches to a hold state that buffers the block
 *      (up to STREAM_MAX_PEM_HOLD) until the END fence closes it, then runs
 *      the buffered scrubber so the replacement marker matches non-streaming
 *      sinks exactly. Oversized blocks are redacted fail-closed: the marker
 *      is emitted and further block content is dropped until the END fence.
 *   3. Bounded memory — a pathological line longer than STREAM_MAX_LINE_HOLD
 *      is flushed in deterministic fixed-size slabs measured from the line
 *      start, so cut points depend on content, not chunk arrival.
 *
 * push() returns the scrubbed text safe to emit now; end() flushes the rest.
 */
function makeStreamingScrubber() {
  let partialLine = ''; // trailing bytes that have not seen a newline yet
  let inPem = false; // inside an unterminated private-key block
  let pemHold = ''; // buffered block content while inPem
  let pemOverflowed = false; // block exceeded cap: marker emitted, now dropping

  function scrubFull(text) {
    // Full scrubSecrets path (patterns + label-aware stable ids) so streaming
    // sinks match buffered sinks.
    return scrubSecrets(text);
  }

  // Consume one complete line (newline included) or a forced slab; return
  // whatever is safe to emit for it.
  function consume(piece) {
    if (inPem) {
      if (pemOverflowed) {
        // Marker already emitted; drop content until the END fence closes.
        const endMatch = piece.match(PEM_END_MARKER);
        if (endMatch) {
          inPem = false;
          pemOverflowed = false;
          return scrubFull(piece.slice(endMatch.index + endMatch[0].length));
        }
        return '';
      }
      pemHold += piece;
      if (PEM_END_MARKER.test(piece)) {
        // Whole block collected — buffered scrub replaces it with the same
        // [REDACTED:private_key_block] marker non-streaming sinks produce.
        const out = scrubFull(pemHold);
        inPem = false;
        pemHold = '';
        return out;
      }
      if (pemHold.length > STREAM_MAX_PEM_HOLD) {
        // Fail closed rather than grow without bound.
        pemHold = '';
        pemOverflowed = true;
        return '[REDACTED:private_key_block]';
      }
      return '';
    }

    const beginMatch = piece.match(PEM_BEGIN_MARKER);
    if (beginMatch && !PEM_END_MARKER.test(piece.slice(beginMatch.index))) {
      // Unterminated BEGIN fence: emit what precedes it, hold the rest.
      const before = piece.slice(0, beginMatch.index);
      inPem = true;
      pemHold = piece.slice(beginMatch.index);
      return before ? scrubFull(before) : '';
    }
    return scrubFull(piece);
  }

  return {
    push(chunk) {
      if (!chunk) return '';
      let out = '';
      partialLine += chunk;
      // Walk newlines with a cursor instead of re-slicing the buffer per
      // line, so one large push stays O(n).
      let start = 0;
      let nl;
      while ((nl = partialLine.indexOf('\n', start)) !== -1) {
        out += consume(partialLine.slice(start, nl + 1));
        start = nl + 1;
      }
      if (start > 0) partialLine = partialLine.slice(start);
      // Bound memory for a single enormous line: flush deterministic slabs
      // measured from the line start (chunk-arrival independent).
      while (partialLine.length > STREAM_MAX_LINE_HOLD) {
        const slab = partialLine.slice(0, STREAM_MAX_LINE_HOLD);
        partialLine = partialLine.slice(STREAM_MAX_LINE_HOLD);
        out += consume(slab);
      }
      return out;
    },
    end() {
      let out;
      if (inPem) {
        // Unterminated block at stream end: match buffered behavior, which
        // only redacts BEGIN..END pairs. Overflowed blocks stay dropped
        // (marker was already emitted) — fail closed.
        out = pemOverflowed ? '' : scrubFull(pemHold + partialLine);
      } else {
        out = scrubFull(partialLine);
      }
      partialLine = '';
      pemHold = '';
      inPem = false;
      pemOverflowed = false;
      return out;
    },
  };
}

// ---------------------------------------------------------------------------
// buildSafeEnv — filtered process.env for execSync
// ---------------------------------------------------------------------------

/**
 * Return a copy of process.env with sensitive variables removed.
 * Used by the bash tool to prevent credential leakage through child processes.
 *
 * @returns {Record<string, string>}
 */
function buildSafeEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (SCRUBBED_ENV_VARS.includes(k)) continue;
    // Also scrub any var starting with these prefixes
    if (k.startsWith('AWS_') || k.startsWith('ANTHROPIC_') || k.startsWith('CLAUDE_') || k.startsWith('OPENAI_')) {
      continue;
    }
    env[k] = v;
  }
  return env;
}

// ---------------------------------------------------------------------------
// isPathBlockedByDenyMatrix — glob-like pattern check
// ---------------------------------------------------------------------------

/**
 * Check if a resolved absolute path matches any deny-matrix pattern.
 * Called from permissions.js alongside the category check.
 *
 * @param {string} resolvedPath — an absolute file path
 * @returns {boolean}
 */
function isPathBlockedByDenyMatrix(resolvedPath) {
  for (const matcher of DENY_MATRIX_PATTERNS) {
    if (matcher(resolvedPath)) return true;
  }
  return false;
}

/**
 * Shared predicate for traversal tools (search_text, and similar).
 *
 * Two independent boundaries, both required:
 *   1. Location — the candidate's realpath must stay under --cwd.
 *   2. File class — deny-matrix patterns (.env, keys, .ssh, …) stay blocked
 *      even when the file lives inside the authorized root.
 *
 * Symlink aliases are resolved before the checks so a link inside the project
 * cannot silently grant access to a file outside it.
 *
 * @param {object} ctx — runner context with cwd / cwdRealpath
 * @param {string} absolutePath — absolute path to the candidate file or dir
 * @returns {boolean}
 */
function isFileCandidateAllowed(ctx, absolutePath) {
  if (!absolutePath || typeof absolutePath !== 'string') return false;

  const cwdInput = ctx && (ctx.cwdRealpath || ctx.cwd);
  if (!cwdInput) return false;
  const cwdAbs = path.resolve(cwdInput);

  let rel = path.relative(cwdAbs, absolutePath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
  if (rel === '') rel = '.';

  const confined = confinePath(ctx, rel);
  if (!confined) return false;
  if (isPathBlockedByDenyMatrix(confined)) return false;

  // Re-check the realpath target so a project-local symlink cannot point at a
  // denied file or escape the working tree.
  try {
    if (!fs.existsSync(absolutePath)) return true;
    const real = cachedRealpathSync(ctx, absolutePath);
    let realCwd;
    try {
      realCwd = cachedRealpathSync(ctx, cwdAbs);
    } catch {
      realCwd = cwdAbs;
    }
    if (!real.startsWith(realCwd + path.sep) && real !== realCwd) return false;
    if (isPathBlockedByDenyMatrix(real)) return false;
  } catch {
    return false;
  }

  return true;
}

module.exports = {
  validateCwd,
  confinePath,
  scrubSecrets,
  scrubStableIdentifiers,
  scrubObject,
  buildSafeEnv,
  isPathBlockedByDenyMatrix,
  isFileCandidateAllowed,
  cachedRealpathSync,
  invalidateRealpathCache,
  makeStreamingScrubber,
  STREAM_MAX_LINE_HOLD,
  STREAM_MAX_PEM_HOLD,
  SYSTEM_DIRS,
  BLOCKED_DIRS,
  DENY_MATRIX_PATTERNS,
  SCRUBBED_ENV_VARS,
};
