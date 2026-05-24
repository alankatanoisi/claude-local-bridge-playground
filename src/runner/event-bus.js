'use strict';

/**
 * Typed event bus — stable automation surface for coordinator + kernel.
 */

const { KERNEL_EVENT_TYPES } = require('./kernel/contract');

function createEventBus(options = {}) {
  const listeners = new Map();
  const history = [];
  const maxHistory = options.maxHistory ?? 500;
  const emitStdout = options.emitStdout ?? false;

  function emit(type, fields = {}) {
    if (
      !KERNEL_EVENT_TYPES.includes(type) &&
      type !== 'worker_started' &&
      type !== 'worker_finished' &&
      type !== 'phase'
    ) {
      // Allow coordinator extensions without breaking strict kernel set
    }
    const event = { type, ts: new Date().toISOString(), ...fields };
    history.push(event);
    if (history.length > maxHistory) history.shift();

    if (emitStdout) {
      process.stdout.write(JSON.stringify(event) + '\n');
    }

    const subs = listeners.get(type) || [];
    for (const fn of subs) fn(event);

    const allSubs = listeners.get('*') || [];
    for (const fn of allSubs) fn(event);

    return event;
  }

  function on(type, handler) {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(handler);
    return () => off(type, handler);
  }

  function off(type, handler) {
    const subs = listeners.get(type) || [];
    const idx = subs.indexOf(handler);
    if (idx >= 0) subs.splice(idx, 1);
  }

  function getHistory() {
    return [...history];
  }

  return { emit, on, off, getHistory };
}

module.exports = { createEventBus };
