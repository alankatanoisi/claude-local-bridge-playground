'use strict';

/**
 * confirmation.js — Interactive y/n prompt for write and shell tools.
 *
 * Uses raw stdin so it works even when stdin is piped (reads from /dev/tty).
 * Falls back to process.stdin if /dev/tty is unavailable.
 *
 * Public API:
 *   await ask(proposedAction) → 'allow' | 'deny'
 */

const fs = require('fs');

const TTY_PATH = '/dev/tty';

/**
 * Prompt the user and return their decision.
 *
 * @param {string} proposedAction — human-readable description of what the tool wants to do
 * @returns {Promise<'allow' | 'deny'>}
 */
function ask(proposedAction) {
  return new Promise((resolve) => {
    console.error('\n─── CONFIRM ───');
    console.error(proposedAction);
    console.error('────────────────');
    process.stderr.write('Allow? [y/N]: ');

    let input = '';

    // Try to open /dev/tty for interactive input even when stdin is piped
    let stream;
    try {
      stream = fs.createReadStream(TTY_PATH, { encoding: 'utf8' });
    } catch {
      stream = process.stdin;
    }

    stream.setEncoding('utf8');
    stream.resume();

    // Read a single line
    function onData(chunk) {
      input += chunk;
      if (input.includes('\n')) {
        cleanup();
        const answer = input.trim().toLowerCase();
        if (answer === 'y' || answer === 'yes') {
          console.error('→ Approved');
          resolve('allow');
        } else {
          console.error('→ Denied');
          resolve('deny');
        }
      }
    }

    function cleanup() {
      stream.removeListener('data', onData);
      if (stream !== process.stdin) {
        stream.destroy();
      }
    }

    stream.on('data', onData);
  });
}

module.exports = { ask };
