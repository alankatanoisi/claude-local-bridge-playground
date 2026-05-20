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
  // Blocked basenames
  (p) => path.basename(p) === '.env',
  (p) => path.basename(p) === '.env.local',
  (p) => path.basename(p) === '.env.production',
  (p) => path.basename(p) === '.env.development',
  (p) => path.basename(p) === '.netrc',
  (p) => path.basename(p) === '.npmrc',
  // Blocked basename patterns
  (p) => /^id_rsa/.test(path.basename(p)),
  (p) => /^id_ed25519/.test(path.basename(p)),
  (p) => path.basename(p).endsWith('.pem'),
  (p) => path.basename(p).endsWith('.key'),
  (p) => /^credentials.*\.json$/i.test(path.basename(p)),
  (p) => /^token.*$/i.test(path.basename(p)),
  (p) => /_token$/i.test(path.basename(p)),
  (p) => /secret/i.test(path.basename(p)),
];

// ---------------------------------------------------------------------------
// Secret redaction patterns
// ---------------------------------------------------------------------------

const SECRET_PATTERNS = [
  // Private key blocks (multi-line)
  {
    pattern:
      /-----BEGIN (?:RSA|OPENSSH|EC|DSA|PGP) PRIVATE KEY-----[\s\S]*?-----END (?:RSA|OPENSSH|EC|DSA|PGP) PRIVATE KEY-----/g,
    replacement: '[REDACTED:private_key_block]',
  },
  // Anthropic API keys
  { pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/g, replacement: '[REDACTED:anthropic_key]' },
  // OpenAI API keys
  { pattern: /sk-[a-zA-Z0-9]{20,}/g, replacement: '[REDACTED:openai_key]' },
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
  { pattern: /^(.*(?:SECRET|TOKEN|PASSWORD|API.?KEY)\s*=\s*)[^\s]+/gim, replacement: '$1[REDACTED]' },
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
    realCwd = fs.realpathSync(cwdAbs);
  } catch {
    return resolved;
  }

  // Find the deepest existing component for realpath anchoring
  let anchor = resolved;
  while (anchor !== path.dirname(anchor) && !fs.existsSync(anchor)) {
    anchor = path.dirname(anchor);
  }

  try {
    const realAnchor = fs.realpathSync(anchor);
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
 * Replace secrets in a text string with redaction markers.
 * Used on all tool results before they enter messages or transcripts.
 *
 * @param {string} text
 * @returns {string}
 */
function scrubSecrets(text) {
  if (!text || typeof text !== 'string') return text;
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    text = text.replace(pattern, replacement);
  }
  return text;
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

module.exports = {
  validateCwd,
  confinePath,
  scrubSecrets,
  buildSafeEnv,
  isPathBlockedByDenyMatrix,
  SYSTEM_DIRS,
  DENY_MATRIX_PATTERNS,
  SCRUBBED_ENV_VARS,
};
