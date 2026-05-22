'use strict';

/**
 * confirmation.js — Interactive y/n prompt for write and shell tools.
 *
 * Uses /dev/tty when available so pasted stdin content is not treated as an
 * approval answer. Non-interactive callers are denied instead of hanging.
 *
 * Public API:
 *   await ask(proposedAction) → 'allow' | 'deny'
 */

const fs = require('fs');

const TTY_PATH = '/dev/tty';

/**
 * Prompt the user and return their decision.
 *
 * If timeoutMs is set and the user does not respond within that time,
 * the prompt auto-denies.
 *
 * @param {string} proposedAction — human-readable description of what the tool wants to do
 * @param {number} [timeoutMs]    — optional auto-deny timeout in milliseconds
 * @returns {Promise<'allow' | 'deny'>}
 */
function ask(proposedAction, timeoutMs) {
  return new Promise((resolve) => {
    console.error('\n─── CONFIRM ───');
    console.error(proposedAction);
    console.error('────────────────');
    process.stderr.write('Allow? [y/N]: ');

    let input = '';
    let resolved = false;

    // Prefer the terminal device even when the runner prompt came from stdin.
    let stream = null;
    try {
      const ttyFd = fs.openSync(TTY_PATH, 'r');
      stream = fs.createReadStream(null, { fd: ttyFd, encoding: 'utf8', autoClose: true });
    } catch {
      if (process.stdin.isTTY) stream = process.stdin;
    }

    if (!stream) {
      console.error('[runner] no interactive terminal is available for approval.');
      console.error('→ Denied');
      resolve('deny');
      return;
    }

    stream.setEncoding('utf8');
    stream.resume();

    function decide(choice) {
      if (resolved) return;
      resolved = true;
      cleanup();
      if (choice === 'allow') {
        console.error('→ Approved');
        resolve('allow');
      } else {
        console.error('→ Denied');
        resolve('deny');
      }
    }

    // Read a single line
    function onData(chunk) {
      input += chunk;
      if (input.includes('\n')) {
        const answer = input.trim().toLowerCase();
        decide(answer === 'y' || answer === 'yes' ? 'allow' : 'deny');
      }
    }

    function onUnavailable() {
      console.error('\n[runner] confirmation input became unavailable.');
      decide('deny');
    }

    // Auto-deny timer
    let timer;
    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        console.error('\n[runner] confirmation timed out after ' + timeoutMs / 1000 + 's');
        console.error('→ Denied (timeout)');
        stream.pause();
        decide('deny');
      }, timeoutMs);
    }

    function cleanup() {
      if (timer) clearTimeout(timer);
      stream.removeListener('data', onData);
      stream.removeListener('end', onUnavailable);
      stream.removeListener('error', onUnavailable);
      if (stream !== process.stdin) {
        stream.destroy();
      }
    }

    stream.on('data', onData);
    stream.on('end', onUnavailable);
    stream.on('error', onUnavailable);
  });
}

module.exports = { ask };
