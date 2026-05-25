'use strict';

/**
 * subprocess-pool.js — Generalized pool of long-lived helper processes.
 *
 * B2 introduced persistent-shell.js — a single kept-alive bash process. This
 * generalizes that idea so other tools (node -e, npx prettier, eslint, etc.)
 * can share the same lifecycle discipline: spawn once per (binary, cwd, env)
 * tuple, idle for a bounded window, recycle on any error or env mismatch.
 *
 * Today bash is the only registered factory; the registry interface is the
 * load-bearing change. Future tools register via `registerFactory(binary,
 * factoryFn)` where factoryFn(opts) returns a pool member with `run(input)`
 * and `dispose()` methods.
 *
 * Each pool member is single-purpose: never reuse a node REPL slot for
 * arbitrary commands; each binary entry is keyed and isolated.
 */

const crypto = require('crypto');

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

const _factories = new Map(); // binary -> factoryFn
const _slots = new Map(); // poolKey -> { member, idleTimer, lastUsedAt }

function _hashEnv(env) {
  return crypto.createHash('sha1').update(JSON.stringify(env || {})).digest('hex').slice(0, 12);
}

function _poolKey(binary, cwd, env) {
  return binary + '|' + (cwd || '') + '|' + _hashEnv(env);
}

function _scheduleIdleEviction(key) {
  const slot = _slots.get(key);
  if (!slot) return;
  if (slot.idleTimer) clearTimeout(slot.idleTimer);
  slot.idleTimer = setTimeout(() => {
    const s = _slots.get(key);
    if (!s) return;
    if (Date.now() - s.lastUsedAt < IDLE_TIMEOUT_MS) return;
    try {
      s.member.dispose();
    } catch {
      // best-effort
    }
    _slots.delete(key);
  }, IDLE_TIMEOUT_MS);
  if (typeof slot.idleTimer.unref === 'function') slot.idleTimer.unref();
}

function registerFactory(binary, factoryFn) {
  if (typeof factoryFn !== 'function') throw new TypeError('factoryFn must be a function');
  _factories.set(binary, factoryFn);
}

function unregisterFactory(binary) {
  _factories.delete(binary);
}

function acquire(opts) {
  if (!opts || !opts.binary) throw new TypeError('acquire requires { binary, cwd, env }');
  const factory = _factories.get(opts.binary);
  if (!factory) return null;
  const key = _poolKey(opts.binary, opts.cwd, opts.env);
  let slot = _slots.get(key);
  if (!slot) {
    const member = factory(opts);
    slot = { member, idleTimer: null, lastUsedAt: Date.now() };
    _slots.set(key, slot);
  } else {
    slot.lastUsedAt = Date.now();
  }
  _scheduleIdleEviction(key);
  return slot.member;
}

function releaseAll() {
  for (const [key, slot] of _slots) {
    if (slot.idleTimer) clearTimeout(slot.idleTimer);
    try {
      slot.member.dispose();
    } catch {
      // best-effort
    }
    _slots.delete(key);
  }
}

function stats() {
  return {
    factories: [..._factories.keys()],
    slots: _slots.size,
    keys: [..._slots.keys()],
  };
}

module.exports = {
  registerFactory,
  unregisterFactory,
  acquire,
  releaseAll,
  stats,
  IDLE_TIMEOUT_MS,
};
