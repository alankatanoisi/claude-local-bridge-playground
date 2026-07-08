'use strict';

/**
 * search_text tool — read-only text search.
 *
 * Uses ripgrep (rg) if available, falls back to grep, then to Node fs walk.
 * Respects line limits.
 *
 * The `path` argument may point at either a directory or one specific file.
 * That matters because agents naturally ask "search this file for X"; treating
 * a file path as a shell working directory makes rg/grep fail with ENOTDIR and
 * burns an extra model turn.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const safety = require('../safety');
const { BLOCKED_DIRS } = safety;
const searchCache = require('./_search-cache');

const MAX_OUTPUT_LINES = 200;

function definition() {
  return {
    name: 'search_text',
    description:
      'Search for a text pattern inside the project. ' +
      'Prefers ripgrep, falls back to grep or Node walk. ' +
      'Skips .git, node_modules, dist, build, coverage, and actions-runner.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Text pattern to search for',
        },
        path: {
          type: 'string',
          description: 'Relative subdirectory to search in (default: whole project)',
        },
      },
      required: ['pattern'],
    },
  };
}

function rgAvailable() {
  if (rgAvailable.cached !== undefined) return rgAvailable.cached;
  try {
    execSync('rg --version', { stdio: 'ignore', timeout: 3000 });
    rgAvailable.cached = true;
  } catch {
    rgAvailable.cached = false;
  }
  return rgAvailable.cached;
}

function grepAvailable() {
  if (grepAvailable.cached !== undefined) return grepAvailable.cached;
  try {
    execSync('grep --version', { stdio: 'ignore', timeout: 3000 });
    grepAvailable.cached = true;
  } catch {
    grepAvailable.cached = false;
  }
  return grepAvailable.cached;
}

function shellEscape(str) {
  // Replace single quotes with '\'' and wrap in single quotes
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

function searchWithRg(pattern, targetDir, targetFile) {
  const cmd =
    'rg -i -n --max-count 50 --hidden ' +
    BLOCKED_DIRS.map((d) => '-g ' + shellEscape('!' + d)).join(' ') +
    ' -- ' +
    shellEscape(pattern) +
    (targetFile ? ' ' + shellEscape(targetFile) : '');
  const result = execSync(cmd, {
    cwd: targetDir,
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 1024 * 1024,
  });
  return result;
}

function searchWithGrep(pattern, targetDir, targetFile) {
  const cmd = targetFile
    ? 'grep -i -n --max-count=50 ' + shellEscape(pattern) + ' ' + shellEscape(targetFile)
    : 'grep -r -i -n --max-count=50 ' +
      BLOCKED_DIRS.map((d) => '--exclude-dir=' + shellEscape(d)).join(' ') +
      ' ' +
      shellEscape(pattern) +
      ' .';
  const result = execSync(cmd, {
    cwd: targetDir,
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 1024 * 1024,
  });
  return result;
}

function searchWithNode(pattern, targetDir, targetFile) {
  const lowerPattern = pattern.toLowerCase();
  const results = [];
  function searchFile(full) {
    try {
      const text = fs.readFileSync(full, 'utf8');
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(lowerPattern)) {
          const rel = path.relative(targetDir, full) || path.basename(full);
          results.push(`${rel}:${i + 1}:${lines[i]}`);
          if (results.length >= MAX_OUTPUT_LINES) return;
        }
      }
    } catch {
      // Skip unreadable or non-text files. Search is best-effort.
    }
  }

  if (targetFile) {
    searchFile(path.join(targetDir, targetFile));
    return results.join('\n');
  }

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (BLOCKED_DIRS.includes(entry.name)) continue;
        walk(full);
      } else if (entry.isFile()) {
        searchFile(full);
      }
    }
  }
  walk(targetDir);
  return results.join('\n');
}

function execute(args, ctx) {
  const cwd = ctx.cwd || process.cwd();
  const requestedPath = args && args.path ? path.resolve(cwd, args.path) : cwd;
  const pattern = args.pattern;

  if (!pattern) {
    return { ok: false, text: 'Missing pattern argument.' };
  }

  let targetDir = requestedPath;
  let targetFile = null;
  try {
    const stat = fs.statSync(requestedPath);
    if (stat.isFile()) {
      // Shell tools need a directory as cwd. For file-scoped search we run from
      // the parent directory and pass the filename as the explicit search target.
      targetDir = path.dirname(requestedPath);
      targetFile = path.basename(requestedPath);
    } else if (!stat.isDirectory()) {
      return { ok: false, text: 'Search path is neither a file nor a directory: ' + (args.path || '.') };
    }
  } catch (err) {
    return { ok: false, text: 'Search path not found: ' + (args.path || '.') + ' (' + err.message + ')' };
  }

  // E3: cache by (pattern, rootRealpath). Coarse invalidation on any write
  // inside or above the root via tool-registry post-write hook.
  let rootRealpath = targetFile ? path.join(targetDir, targetFile) : targetDir;
  try {
    rootRealpath = safety.cachedRealpathSync(ctx, targetFile ? path.join(targetDir, targetFile) : targetDir);
  } catch {
    // fall back to non-realpath key; correctness preserved
  }
  const cached = searchCache.get(pattern, rootRealpath);
  if (cached) {
    return { ...cached, _fromCache: true };
  }

  let raw = '';
  let lastErr = null;

  // Try ripgrep first
  if (rgAvailable()) {
    try {
      raw = searchWithRg(pattern, targetDir, targetFile);
    } catch (err) {
      // rg returns exit code 1 when no matches — that's not an error
      if (err.status !== 1) lastErr = err;
    }
  }

  // Fall back to grep
  if (!raw && grepAvailable()) {
    try {
      raw = searchWithGrep(pattern, targetDir, targetFile);
    } catch (err) {
      // grep returns exit code 1 when no matches — that's not an error
      if (err.status !== 1) lastErr = err;
    }
  }

  // Final fallback to pure Node walk
  if (!raw) {
    try {
      raw = searchWithNode(pattern, targetDir, targetFile);
    } catch (err) {
      lastErr = err;
    }
  }

  let result;
  if (!raw) {
    if (lastErr) {
      result = { ok: false, text: 'Error: ' + lastErr.message };
    } else {
      result = { ok: true, text: 'No matches found.' };
    }
  } else if (raw.trim().length === 0) {
    result = { ok: true, text: 'No matches found.' };
  } else {
    const lines = raw.split('\n');
    if (lines.length > MAX_OUTPUT_LINES) {
      result = {
        ok: true,
        text: lines.slice(0, MAX_OUTPUT_LINES).join('\n') + '\n... (truncated by max output lines)',
      };
    } else {
      result = { ok: true, text: raw };
    }
  }
  if (result.ok) searchCache.set(pattern, rootRealpath, result);
  return result;
}

module.exports = { definition, execute, meta: { name: 'search_text', category: 'read-only' } };
