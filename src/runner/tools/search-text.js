'use strict';

/**
 * search_text tool — read-only text search.
 *
 * Uses ripgrep (rg) if available, falls back to grep, then to Node fs walk.
 * Respects line limits.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { BLOCKED_DIRS } = require('../permissions');

const MAX_OUTPUT_LINES = 200;

function definition() {
  return {
    name: 'search_text',
    description:
      'Search for a text pattern inside the project. ' +
      'Prefers ripgrep, falls back to grep or Node walk. ' +
      'Skips .git, node_modules, dist, build, coverage.',
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

function searchWithRg(pattern, targetDir) {
  const cmd =
    'rg -i -n --max-count 50 --hidden ' +
    BLOCKED_DIRS.map((d) => '-g ' + shellEscape('!' + d)).join(' ') +
    ' -- ' +
    shellEscape(pattern);
  const result = execSync(cmd, {
    cwd: targetDir,
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 1024 * 1024,
  });
  return result;
}

function searchWithGrep(pattern, targetDir) {
  const cmd =
    'grep -r -i -n --max-count=50 --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=build --exclude-dir=coverage ' +
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

function searchWithNode(pattern, targetDir) {
  const lowerPattern = pattern.toLowerCase();
  const results = [];
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (BLOCKED_DIRS.includes(entry.name)) continue;
        walk(full);
      } else if (entry.isFile()) {
        try {
          const text = fs.readFileSync(full, 'utf8');
          const lines = text.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(lowerPattern)) {
              const rel = path.relative(targetDir, full);
              results.push(`${rel}:${i + 1}:${lines[i]}`);
              if (results.length >= MAX_OUTPUT_LINES) return;
            }
          }
        } catch {
          // skip unreadable files
        }
      }
    }
  }
  walk(targetDir);
  return results.join('\n');
}

function execute(args, ctx) {
  const cwd = ctx.cwd || process.cwd();
  const targetDir = args && args.path ? path.resolve(cwd, args.path) : cwd;
  const pattern = args.pattern;

  if (!pattern) {
    return { ok: false, text: 'Missing pattern argument.' };
  }

  let raw = '';
  let lastErr = null;

  // Try ripgrep first
  if (rgAvailable()) {
    try {
      raw = searchWithRg(pattern, targetDir);
    } catch (err) {
      // rg returns exit code 1 when no matches — that's not an error
      if (err.status !== 1) lastErr = err;
    }
  }

  // Fall back to grep
  if (!raw && grepAvailable()) {
    try {
      raw = searchWithGrep(pattern, targetDir);
    } catch (err) {
      // grep returns exit code 1 when no matches — that's not an error
      if (err.status !== 1) lastErr = err;
    }
  }

  // Final fallback to pure Node walk
  if (!raw) {
    try {
      raw = searchWithNode(pattern, targetDir);
    } catch (err) {
      lastErr = err;
    }
  }

  if (!raw) {
    if (lastErr) {
      return { ok: false, text: 'Error: ' + lastErr.message };
    }
    return { ok: true, text: 'No matches found.' };
  }

  if (raw.trim().length === 0) {
    return { ok: true, text: 'No matches found.' };
  }

  const lines = raw.split('\n');
  if (lines.length > MAX_OUTPUT_LINES) {
    return {
      ok: true,
      text: lines.slice(0, MAX_OUTPUT_LINES).join('\n') + '\n... (truncated by max output lines)',
    };
  }
  return { ok: true, text: raw };
}

module.exports = { definition, execute };
