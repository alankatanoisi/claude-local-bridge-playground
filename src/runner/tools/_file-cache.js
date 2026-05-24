'use strict';

/**
 * _file-cache.js — Process-wide content cache for files read inside the
 * runner loop.
 *
 * The runner re-reads the same files many times in a session (CLAUDE.md,
 * the file under active edit, package.json, etc). Each read previously hit
 * disk. This cache serves repeats from memory and validates with a fresh
 * stat() so it transparently invalidates as soon as the file changes on
 * disk.
 *
 * Design choices:
 *   - Key by realpath; resolve before lookup so symlinks dedupe.
 *   - Validate entries by (mtimeMs, size). Either changing invalidates.
 *   - Cache only files <= MAX_CACHEABLE_BYTES. Larger files bypass entirely
 *     so a single huge file never evicts the working set.
 *   - LRU eviction once we exceed MAX_ENTRIES or TOTAL_CACHE_BYTES.
 *   - Safe to call from any tool; never throws — returns null to mean
 *     "caller must read directly."
 *
 * Permission/secret blocking happens upstream (permissions.js,
 * shell-policy.js) before any tool reads a file. This cache trusts the
 * caller and never gets reached for blocked paths.
 */

const fs = require('fs');

const MAX_CACHEABLE_BYTES = 1_000_000; // matches read-file's hard cap
const TOTAL_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 256;

const cache = new Map(); // realpath → { content: Buffer, mtimeMs, size }
let totalBytes = 0;
let hits = 0;
let misses = 0;
let bypassed = 0;

function evict() {
  while ((totalBytes > TOTAL_CACHE_BYTES || cache.size > MAX_ENTRIES) && cache.size > 0) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    const entry = cache.get(oldestKey);
    totalBytes -= entry.content.length;
    cache.delete(oldestKey);
  }
}

function touch(key, entry) {
  // Map preserves insertion order; re-inserting moves to the end (LRU MRU).
  cache.delete(key);
  cache.set(key, entry);
}

// Returns a Buffer of the file's contents, or null when the file is too
// large to cache or any FS call fails. The caller should fall back to a
// direct read when this returns null.
function readCached(filePath) {
  let stats;
  try {
    stats = fs.statSync(filePath);
  } catch {
    return null;
  }
  if (!stats.isFile()) return null;
  if (stats.size > MAX_CACHEABLE_BYTES) {
    bypassed++;
    return null;
  }

  let realpath;
  try {
    realpath = fs.realpathSync(filePath);
  } catch {
    return null;
  }

  const existing = cache.get(realpath);
  if (existing && existing.mtimeMs === stats.mtimeMs && existing.size === stats.size) {
    hits++;
    touch(realpath, existing);
    return existing.content;
  }

  let buf;
  try {
    buf = fs.readFileSync(realpath);
  } catch {
    return null;
  }

  misses++;
  if (existing) totalBytes -= existing.content.length;
  cache.set(realpath, { content: buf, mtimeMs: stats.mtimeMs, size: stats.size });
  totalBytes += buf.length;
  evict();
  return buf;
}

function getStats() {
  return { hits, misses, bypassed, entries: cache.size, totalBytes };
}

function clear() {
  cache.clear();
  totalBytes = 0;
  hits = 0;
  misses = 0;
  bypassed = 0;
}

module.exports = { readCached, getStats, clear, MAX_CACHEABLE_BYTES };
