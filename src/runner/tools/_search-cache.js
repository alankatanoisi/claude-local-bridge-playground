'use strict';

/**
 * _search-cache.js — Per-process LRU for search_text results.
 *
 * Keyed on (pattern, rootRealpath). Repeat searches from the model hit the
 * cache. Invalidation is coarse: any successful write whose path is at or
 * under a cached root drops every entry rooted there.
 *
 * Bounded by entry count and total bytes; LRU eviction.
 */

const path = require('path');

const MAX_ENTRIES = 200;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;

const _entries = new Map();
let _totalBytes = 0;
let _hits = 0;
let _misses = 0;

function _key(pattern, rootRealpath) {
  return rootRealpath + '\0' + pattern;
}

function _splitKey(k) {
  const i = k.indexOf('\0');
  if (i < 0) return { root: '', pattern: '' };
  return { root: k.slice(0, i), pattern: k.slice(i + 1) };
}

function get(pattern, rootRealpath) {
  const k = _key(pattern, rootRealpath);
  const entry = _entries.get(k);
  if (!entry) {
    _misses++;
    return null;
  }
  _entries.delete(k);
  _entries.set(k, entry);
  _hits++;
  return entry.result;
}

function set(pattern, rootRealpath, result) {
  const k = _key(pattern, rootRealpath);
  const bytes = result && typeof result.text === 'string' ? Buffer.byteLength(result.text, 'utf8') : 0;
  if (_entries.has(k)) {
    _totalBytes -= _entries.get(k).bytes || 0;
    _entries.delete(k);
  }
  _entries.set(k, { result, bytes });
  _totalBytes += bytes;
  while ((_entries.size > MAX_ENTRIES || _totalBytes > MAX_TOTAL_BYTES) && _entries.size > 0) {
    const oldest = _entries.keys().next().value;
    if (oldest === undefined) break;
    _totalBytes -= _entries.get(oldest).bytes || 0;
    _entries.delete(oldest);
  }
}

function invalidateForPath(absolutePath) {
  if (!absolutePath) return 0;
  let dropped = 0;
  for (const [k, entry] of _entries) {
    const { root } = _splitKey(k);
    if (!root) continue;
    if (
      absolutePath === root ||
      absolutePath.startsWith(root + path.sep) ||
      root.startsWith(absolutePath + path.sep)
    ) {
      _totalBytes -= entry.bytes || 0;
      _entries.delete(k);
      dropped++;
    }
  }
  return dropped;
}

function clear() {
  _entries.clear();
  _totalBytes = 0;
  _hits = 0;
  _misses = 0;
}

function stats() {
  return { hits: _hits, misses: _misses, entries: _entries.size, totalBytes: _totalBytes };
}

module.exports = { get, set, invalidateForPath, clear, stats };
