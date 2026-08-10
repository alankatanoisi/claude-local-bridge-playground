'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DENIED_SEGMENTS = new Set([
  '.git',
  '.ssh',
  '.aws',
  '.claude',
  '.codex',
  'node_modules',
  'coverage',
  'dist',
]);
const DENIED_NAMES = new Set(['.env', '.env.local', '.env.production']);
const DENIED_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx']);

/**
 * Build a deterministic, read-only repository manifest.
 *
 * The host performs this walk. Starlark receives the returned metadata and
 * cannot choose a new root, follow a symlink, or read an excluded secret path.
 */
function discoverRepositoryDocuments({
  root,
  includeRoots = ['src'],
  extensions = ['.js', '.json', '.md'],
  maxFiles = 8,
  maxFileBytes = 40000,
  maxTotalBytes = 200000,
}) {
  const resolvedRoot = fs.realpathSync(root);
  const allowedExtensions = new Set(extensions);
  const candidates = [];

  for (const requestedRoot of includeRoots) {
    const absolute = path.resolve(resolvedRoot, requestedRoot);
    assertInsideRoot(resolvedRoot, absolute, `include root '${requestedRoot}'`);
    walk(absolute, candidates, { resolvedRoot, allowedExtensions, maxFileBytes });
  }

  candidates.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const selected = [];
  let totalBytes = 0;
  for (const candidate of candidates) {
    if (selected.length >= maxFiles) break;
    if (totalBytes + candidate.bytes > maxTotalBytes) continue;
    totalBytes += candidate.bytes;
    selected.push(candidate);
  }
  return selected;
}

function walk(directory, output, options) {
  if (!fs.existsSync(directory)) return;
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink()) return;

  if (stat.isFile()) {
    const document = readCandidate(directory, options);
    if (document) output.push(document);
    return;
  }
  if (!stat.isDirectory()) return;

  const relative = path.relative(options.resolvedRoot, directory);
  if (relative && isDeniedPath(relative)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (DENIED_SEGMENTS.has(entry.name) || DENIED_NAMES.has(entry.name)) continue;
    walk(path.join(directory, entry.name), output, options);
  }
}

function readCandidate(file, { resolvedRoot, allowedExtensions, maxFileBytes }) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) return null;
  const relativePath = path.relative(resolvedRoot, file);
  assertInsideRoot(resolvedRoot, file, `file '${relativePath}'`);
  if (isDeniedPath(relativePath)) return null;

  const extension = path.extname(file).toLowerCase();
  if (!allowedExtensions.has(extension) || DENIED_EXTENSIONS.has(extension)) return null;
  if (stat.size > maxFileBytes) return null;

  const buffer = fs.readFileSync(file);
  const pathDigest = crypto.createHash('sha256').update(relativePath).digest('hex').slice(0, 12);
  return {
    id: `repo_${pathDigest}`,
    kind: 'repo_file',
    relativePath,
    bytes: buffer.length,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    metadata: { extension, language: languageForExtension(extension) },
    text: buffer.toString('utf8'),
  };
}

function isDeniedPath(relativePath) {
  const segments = relativePath.split(path.sep);
  return (
    segments.some((segment) => DENIED_SEGMENTS.has(segment)) ||
    DENIED_NAMES.has(path.basename(relativePath)) ||
    DENIED_EXTENSIONS.has(path.extname(relativePath).toLowerCase())
  );
}

function assertInsideRoot(root, candidate, label) {
  const relative = path.relative(root, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`${label} escapes repository root`);
}

function languageForExtension(extension) {
  return {
    '.js': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.ts': 'typescript',
    '.json': 'json',
    '.md': 'markdown',
  }[extension] || 'text';
}

module.exports = { discoverRepositoryDocuments, isDeniedPath };
