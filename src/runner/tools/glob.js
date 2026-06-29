'use strict';

/**
 * glob tool — read-only file discovery by name pattern.
 *
 * Finds files matching a glob pattern (e.g. star-star slash star dot js). Skips noisy dirs,
 * sorts by modification time, caps results at 100 paths.
 */

const fs = require('fs');
const path = require('path');
const safety = require('../safety');
const { BLOCKED_DIRS } = safety;

const MAX_RESULTS = 100;

function definition() {
  return {
    name: 'glob',
    description:
      'Find files by glob pattern (e.g. **/*.js, src/**/*.ts). ' +
      'Results are relative paths sorted by modification time (newest first). ' +
      'Skips .git, node_modules, dist, build, coverage, and actions-runner. Capped at 100 files.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern such as **/*.test.js or src/**/*.ts',
        },
        path: {
          type: 'string',
          description: 'Relative directory to search from (default: project root)',
        },
      },
      required: ['pattern'],
    },
  };
}

function escapeRegexChar(ch) {
  return ch.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

/** Convert a simple glob pattern to a RegExp tested against forward-slash paths. */
function globToRegExp(pattern) {
  let regex = '^';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') {
        regex += '(?:.*/)?';
        i += 3;
      } else {
        regex += '.*';
        i += 2;
      }
    } else if (ch === '*') {
      regex += '[^/]*';
      i += 1;
    } else if (ch === '?') {
      regex += '[^/]';
      i += 1;
    } else {
      regex += escapeRegexChar(ch);
      i += 1;
    }
  }
  regex += '$';
  return new RegExp(regex);
}

function toPosixRel(rootDir, absolutePath) {
  return path.relative(rootDir, absolutePath).split(path.sep).join('/');
}

function collectMatches(rootDir, searchDir, matcher, ctx, out) {
  if (out.length >= MAX_RESULTS) return;

  let entries;
  try {
    entries = fs.readdirSync(searchDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (out.length >= MAX_RESULTS) return;
    if (entry.isDirectory() && BLOCKED_DIRS.includes(entry.name)) continue;

    const absolute = path.join(searchDir, entry.name);
    const rel = toPosixRel(rootDir, absolute);

    if (entry.isDirectory()) {
      collectMatches(rootDir, absolute, matcher, ctx, out);
      continue;
    }
    if (!entry.isFile()) continue;

    if (!matcher.test(rel)) continue;

    let confined;
    try {
      confined = safety.confinePath(ctx, rel);
    } catch {
      continue;
    }
    if (!confined || safety.isPathBlockedByDenyMatrix(confined)) continue;

    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(absolute).mtimeMs;
    } catch {
      continue;
    }
    out.push({ rel, mtimeMs });
  }
}

function execute(args, ctx) {
  const cwd = ctx.cwdRealpath || ctx.cwd || process.cwd();
  const pattern = args && args.pattern;

  if (!pattern || typeof pattern !== 'string') {
    return { ok: false, text: 'Missing pattern argument.' };
  }

  let searchDir = cwd;
  if (args && args.path) {
    const confined = safety.confinePath(ctx, args.path);
    if (!confined) {
      return { ok: false, text: 'Path escapes working directory: ' + args.path };
    }
    searchDir = confined;
  }

  let matcher;
  try {
    matcher = globToRegExp(pattern.trim());
  } catch (err) {
    return { ok: false, text: 'Invalid glob pattern: ' + err.message };
  }

  const matches = [];
  collectMatches(cwd, searchDir, matcher, ctx, matches);

  if (matches.length === 0) {
    return { ok: true, text: 'No files matched.' };
  }

  matches.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const lines = matches.slice(0, MAX_RESULTS).map((m) => m.rel);
  let text = lines.join('\n');
  if (matches.length > MAX_RESULTS) {
    text += '\n... (truncated at ' + MAX_RESULTS + ' files)';
  }
  return { ok: true, text };
}

module.exports = { definition, execute, meta: { name: 'glob', category: 'read-only' } };
