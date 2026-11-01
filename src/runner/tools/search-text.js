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
 *
 * Safety: every candidate file is checked with safety.isFileCandidateAllowed
 * (realpath confinement + deny matrix) before any backend reads its contents.
 * External backends receive explicit checked files, never recursive directories.
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
      'Search file CONTENTS for a case-insensitive text pattern; to find files by NAME pattern use glob instead. ' +
      'Prefer plain literal text: regex syntax works only when ripgrep or grep is installed, ' +
      'not in the Node fallback, so metacharacters may match differently across machines. ' +
      'Skips .git, node_modules, dist, build, coverage, and actions-runner. ' +
      'Never returns matches from deny-matrix files (.env, keys, credentials).',
    input_schema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Text pattern to search for (case-insensitive; prefer plain literal text over regex)',
        },
        path: {
          type: 'string',
          description: 'Relative subdirectory or file to search in (default: whole project)',
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

// Build the input list before starting rg/grep. Output filtering alone is too
// late: a recursive backend may already have read a protected file. Never hand
// a directory or symlink to an external backend for recursive discovery.
function collectSearchFiles(targetDir, targetFile, ctx) {
  if (targetFile) return [targetFile];
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (!safety.isFileCandidateAllowed(ctx, full)) continue;
      if (entry.isDirectory()) {
        if (!BLOCKED_DIRS.some((name) => name.toLowerCase() === entry.name.toLowerCase())) walk(full);
      } else if (entry.isFile()) {
        files.push('./' + path.relative(targetDir, full));
      }
    }
  }
  walk(targetDir);
  return files;
}

function searchWithBackend(backend, pattern, targetDir, files, ctx) {
  const results = [];
  // Batches keep the command below operating-system argument-size limits.
  for (let start = 0; start < files.length; start += 100) {
    const batch = files
      .slice(start, start + 100)
      .filter((file) => safety.isFileCandidateAllowed(ctx, path.join(targetDir, file)));
    if (!batch.length) continue;
    const command =
      backend + ' -i -n -H --max-count=50 -- ' + shellEscape(pattern) + ' ' + batch.map(shellEscape).join(' ');
    try {
      results.push(
        execSync(command, {
          cwd: targetDir,
          encoding: 'utf8',
          timeout: 10000,
          maxBuffer: 1024 * 1024,
        }),
      );
    } catch (err) {
      if (err.status !== 1) throw err;
    }
    if (results.join('\n').split('\n').length > MAX_OUTPUT_LINES) break;
  }
  return results.join('\n');
}

function searchWithNode(pattern, targetDir, targetFile, ctx) {
  const lowerPattern = pattern.toLowerCase();
  const results = [];
  function searchFile(full) {
    if (!safety.isFileCandidateAllowed(ctx, full)) return;
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
        // Skip sensitive trees (.ssh, .aws, …) before descending.
        if (safety.isPathBlockedByDenyMatrix(full)) continue;
        if (!safety.isFileCandidateAllowed(ctx, full)) continue;
        walk(full);
      } else if (entry.isFile()) {
        searchFile(full);
      }
    }
  }
  walk(targetDir);
  return results.join('\n');
}

/**
 * Parse "relpath:lineno:text" hits and drop any whose resolved file fails the
 * shared candidate predicate. This is a second output check; backend inputs
 * have already passed the same guard before any content search starts.
 *
 * When targetFile is set, rg/grep emit "lineno:text" without a path prefix —
 * the candidate was already checked before the search, so pass lines through.
 */
function filterSearchHits(raw, targetDir, ctx, targetFile) {
  if (!raw || !raw.trim()) return '';
  if (targetFile) {
    const full = path.join(targetDir, targetFile);
    if (!safety.isFileCandidateAllowed(ctx, full)) return '';
    return raw.split('\n').filter(Boolean).slice(0, MAX_OUTPUT_LINES).join('\n');
  }
  const kept = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    // ripgrep/grep: path:line:content — take the path before the first :digits:
    const match = line.match(/^(.+?):(\d+):(.*)$/);
    if (!match) continue;
    const hitPath = path.resolve(targetDir, match[1]);
    if (!safety.isFileCandidateAllowed(ctx, hitPath)) continue;
    kept.push(line);
    if (kept.length >= MAX_OUTPUT_LINES) break;
  }
  return kept.join('\n');
}

function execute(args, ctx) {
  const pattern = args && args.pattern;

  if (!pattern) {
    return { ok: false, text: 'Missing pattern argument.' };
  }

  // Confine the search root before any backend I/O. Default is the project root.
  const requestedRel = args && args.path ? args.path : '.';
  const confinedRoot = safety.confinePath(ctx, requestedRel);
  if (!confinedRoot) {
    return { ok: false, text: 'Search path escapes working directory: ' + (args.path || '.') };
  }

  let targetDir = confinedRoot;
  let targetFile = null;
  try {
    const stat = fs.statSync(confinedRoot);
    if (stat.isFile()) {
      if (!safety.isFileCandidateAllowed(ctx, confinedRoot)) {
        return {
          ok: false,
          text: 'Blocked file type (potential secret): ' + path.basename(confinedRoot),
        };
      }
      // Shell tools need a directory as cwd. For file-scoped search we run from
      // the parent directory and pass the filename as the explicit search target.
      targetDir = path.dirname(confinedRoot);
      targetFile = path.basename(confinedRoot);
    } else if (!stat.isDirectory()) {
      return { ok: false, text: 'Search path is neither a file nor a directory: ' + (args.path || '.') };
    } else if (!safety.isFileCandidateAllowed(ctx, confinedRoot)) {
      return { ok: false, text: 'Search path is blocked: ' + (args.path || '.') };
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
  let files;
  try {
    files = collectSearchFiles(targetDir, targetFile, ctx);
  } catch (err) {
    return { ok: false, text: 'Search enumeration failed: ' + err.message };
  }

  // Try ripgrep first
  if (rgAvailable()) {
    try {
      raw = filterSearchHits(searchWithBackend('rg', pattern, targetDir, files, ctx), targetDir, ctx, targetFile);
    } catch (err) {
      // rg returns exit code 1 when no matches — that's not an error
      if (err.status !== 1) lastErr = err;
    }
  }

  // Fall back to grep
  if (!raw && grepAvailable()) {
    try {
      raw = filterSearchHits(searchWithBackend('grep', pattern, targetDir, files, ctx), targetDir, ctx, targetFile);
    } catch (err) {
      // grep returns exit code 1 when no matches — that's not an error
      if (err.status !== 1) lastErr = err;
    }
  }

  // Final fallback to pure Node walk (predicate enforced per file)
  if (!raw) {
    try {
      raw = searchWithNode(pattern, targetDir, targetFile, ctx);
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
