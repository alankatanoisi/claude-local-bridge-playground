'use strict';

/**
 * confirmation.js — Interactive y/n prompt for write and shell tools.
 *
 * Uses /dev/tty when available so pasted stdin content is not treated as an
 * approval answer. Non-interactive callers are denied instead of hanging.
 *
 * Public API:
 *   await ask(proposedAction) → 'allow' | 'deny'
 *   await askToolFailureRecovery(details) → recovery decision
 */

const fs = require('fs');

const TTY_PATH = '/dev/tty';

function parseToolFailureRecoveryChoice(answer) {
  const normalized = String(answer || '')
    .trim()
    .toLowerCase();
  if (normalized === '' || normalized === '1' || normalized === 'c' || normalized === 'continue') {
    return 'continue';
  }
  if (normalized === '2' || normalized === 'g' || normalized === 'guide' || normalized === 'guidance') {
    return 'guide';
  }
  if (normalized === '3' || normalized === 's' || normalized === 'stop') return 'stop';
  return null;
}

function openTerminalInput() {
  try {
    const ttyFd = fs.openSync(TTY_PATH, 'r');
    return fs.createReadStream(null, { fd: ttyFd, encoding: 'utf8', autoClose: true });
  } catch {
    return process.stdin.isTTY ? process.stdin : null;
  }
}

function readLine(stream, timeoutMs) {
  return new Promise((resolve) => {
    let input = '';
    let resolved = false;
    let timer;

    function finish(value) {
      if (resolved) return;
      resolved = true;
      if (timer) clearTimeout(timer);
      stream.removeListener('data', onData);
      stream.removeListener('end', onUnavailable);
      stream.removeListener('error', onUnavailable);
      resolve(value);
    }

    function onData(chunk) {
      input += chunk;
      if (input.includes('\n')) finish(input.slice(0, input.indexOf('\n')).trim());
    }

    function onUnavailable() {
      finish(null);
    }

    if (timeoutMs && timeoutMs > 0) timer = setTimeout(() => finish(null), timeoutMs);
    stream.setEncoding('utf8');
    stream.resume();
    stream.on('data', onData);
    stream.on('end', onUnavailable);
    stream.on('error', onUnavailable);
  });
}

/**
 * Ask a foreground user how the runner should recover after repeated fully
 * failed tool batches. No terminal means stop safely; it never guesses on a
 * background or piped run.
 */
async function askToolFailureRecovery(details = {}, timeoutMs) {
  const stream = openTerminalInput();
  const failures = Number(details.failures) || 0;
  const summary = Array.isArray(details.failureSummary) ? details.failureSummary : [];

  console.error('\n─── TOOL RECOVERY ───');
  console.error(failures + ' consecutive tool batches failed without any successful tool result.');
  for (const item of summary.slice(0, 5)) {
    console.error('• ' + item.tool + ': ' + item.message);
  }
  console.error('1. Continue with guarded recovery (recommended)');
  console.error('2. Add your guidance, then continue');
  console.error('3. Stop safely');
  console.error('───────────────────────');

  if (!stream) {
    console.error('[runner] no interactive terminal is available; stopping safely.');
    return { action: 'stop', reason: 'non_interactive' };
  }

  let action = null;
  while (!action) {
    process.stderr.write('Choose [1/2/3, default 1]: ');
    const answer = await readLine(stream, timeoutMs);
    if (answer === null) {
      if (stream !== process.stdin) stream.destroy();
      console.error('\n[runner] recovery prompt timed out or became unavailable; stopping safely.');
      return { action: 'stop', reason: 'unavailable' };
    }
    action = parseToolFailureRecoveryChoice(answer);
    if (!action) console.error('Please type 1, 2, or 3.');
  }

  if (action !== 'guide') {
    if (stream !== process.stdin) stream.destroy();
    return { action };
  }

  process.stderr.write('What should the agent try differently? ');
  const guidance = await readLine(stream, timeoutMs);
  if (stream !== process.stdin) stream.destroy();
  if (!guidance) {
    console.error('[runner] no guidance was entered; stopping safely.');
    return { action: 'stop', reason: 'empty_guidance' };
  }
  return { action: 'guide', guidance };
}

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

module.exports = { ask, askToolFailureRecovery, parseToolFailureRecoveryChoice };
