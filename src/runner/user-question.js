'use strict';

/**
 * user-question.js — Interactive multi-choice prompts for ask_user_question.
 *
 * Uses /dev/tty when available (same pattern as confirmation.js). Non-interactive
 * callers fail closed instead of hanging on stdin.
 */

const fs = require('fs');

const TTY_PATH = '/dev/tty';

function openPromptStream() {
  try {
    const ttyFd = fs.openSync(TTY_PATH, 'r');
    return fs.createReadStream(null, { fd: ttyFd, encoding: 'utf8', autoClose: true });
  } catch {
    if (process.stdin.isTTY) return process.stdin;
  }
  return null;
}

function formatOptions(options) {
  return options
    .map((opt, index) => {
      const label = String(opt.label || opt.value || '').trim();
      const desc = opt.description ? ' — ' + opt.description : '';
      return '  ' + (index + 1) + ') ' + label + desc;
    })
    .join('\n');
}

function parseSelection(raw, options, allowMultiple) {
  const tokens = String(raw || '')
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (!tokens.length) return null;

  const picks = [];
  for (const token of tokens) {
    let index = null;
    if (/^\d+$/.test(token)) {
      index = parseInt(token, 10) - 1;
    } else {
      index = options.findIndex((opt) => String(opt.label || opt.value || '').toLowerCase() === token.toLowerCase());
    }
    if (index === null || index < 0 || index >= options.length) return null;
    if (!allowMultiple && picks.length > 0) return null;
    if (!picks.includes(index)) picks.push(index);
  }

  return picks.map((i) => options[i].label || options[i].value || String(i + 1));
}

function askUserQuestion(payload, ctx = {}) {
  if (ctx.plan) {
    return {
      ok: false,
      text: 'Plan mode: would ask the user — ' + String(payload.question || '').trim(),
    };
  }
  if (ctx.dontAsk) {
    return {
      ok: false,
      text: 'User questions are disabled under --dont-ask (fail closed).',
    };
  }
  if ((ctx.spawnDepth || 0) > 0) {
    return {
      ok: false,
      text: 'ask_user_question is not available in child agent workers.',
    };
  }

  const question = String(payload.question || '').trim();
  const options = Array.isArray(payload.options) ? payload.options.filter((opt) => opt && (opt.label || opt.value)) : [];
  const allowMultiple = !!payload.allow_multiple;

  if (!question) {
    return { ok: false, text: 'Missing required question string.' };
  }
  if (options.length < 2) {
    return { ok: false, text: 'Provide at least two options for ask_user_question.' };
  }

  const stream = openPromptStream();
  if (!stream) {
    return {
      ok: false,
      text: 'No interactive terminal available for ask_user_question (fail closed).',
    };
  }

  return new Promise((resolve) => {
    console.error('\n─── QUESTION ───');
    if (payload.header) console.error(String(payload.header));
    console.error(question);
    console.error(formatOptions(options));
    console.error('────────────────');
    process.stderr.write(allowMultiple ? 'Choose (numbers, comma-separated): ' : 'Choose (number or label): ');

    let input = '';
    let resolved = false;

    function finish(result) {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(result);
    }

    function onData(chunk) {
      input += chunk;
      if (!input.includes('\n')) return;
      const answer = input.trim();
      const selected = parseSelection(answer, options, allowMultiple);
      if (!selected) {
        finish({ ok: false, text: 'Invalid selection. No answer recorded.' });
        return;
      }
      finish({
        ok: true,
        text: 'User selected: ' + selected.join(', '),
        selected,
      });
    }

    function onUnavailable() {
      finish({ ok: false, text: 'Question input became unavailable (fail closed).' });
    }

    stream.setEncoding('utf8');
    stream.resume();
    stream.on('data', onData);
    stream.on('end', onUnavailable);
    stream.on('error', onUnavailable);

    function cleanup() {
      stream.removeListener('data', onData);
      stream.removeListener('end', onUnavailable);
      stream.removeListener('error', onUnavailable);
      if (stream !== process.stdin) stream.destroy();
    }
  });
}

module.exports = {
  askUserQuestion,
  formatOptions,
  parseSelection,
};
