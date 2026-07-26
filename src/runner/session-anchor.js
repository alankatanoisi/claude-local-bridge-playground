'use strict';

const crypto = require('crypto');

const ANCHOR_VERSION = 1;
const MAX_SOURCE_CHARS = 8_000;
const MAX_RENDERED_CHARS = 4_000;

function sha(value) {
  return crypto
    .createHash('sha256')
    .update(String(value || ''))
    .digest('hex')
    .slice(0, 16);
}

function boundedSource(value, maxChars = MAX_SOURCE_CHARS) {
  const text = String(value || '');
  if (text.length <= maxChars) return { text, hash: sha(text), truncated: false, originalChars: text.length };
  const marker = '\n… [source bounded; sha256=' + sha(text) + '; chars=' + text.length + '] …\n';
  const room = Math.max(0, maxChars - marker.length);
  const head = Math.ceil(room / 2);
  return {
    text: text.slice(0, head) + marker + text.slice(text.length - (room - head)),
    hash: sha(text),
    truncated: true,
    originalChars: text.length,
  };
}

function createContextState(objective, historyQuality = 'raw_complete') {
  return {
    version: ANCHOR_VERSION,
    historyQuality,
    objective: boundedSource(objective),
    currentDirective: boundedSource(objective),
    checkpoint: null,
    calibrationByModel: {},
    lastDecision: null,
  };
}

function updateDirective(contextState, directive) {
  return { ...(contextState || createContextState(directive)), currentDirective: boundedSource(directive) };
}

function renderSessionAnchor(contextState, runtime = {}) {
  const state = contextState || createContextState('');
  const tasks = (runtime.tasks || [])
    .slice(0, 20)
    .map(
      (task) =>
        '- [' + (task.status || 'pending') + '] ' + String(task.content || task.title || task.id || '').slice(0, 180),
    );
  const files = [...new Set(runtime.changedFiles || [])].sort().slice(0, 30);
  const errors = [...new Set(runtime.unresolvedErrors || [])].slice(-10);
  const lines = [
    '[context:session-anchor v1]',
    'Objective: ' + (state.objective?.text || '(not recorded)'),
    'Current operator directive: ' + (state.currentDirective?.text || '(not recorded)'),
  ];
  if (tasks.length) lines.push('Task checklist:\n' + tasks.join('\n'));
  if (files.length) lines.push('Changed files:\n' + files.map((file) => '- ' + file).join('\n'));
  if (errors.length) lines.push('Unresolved runner/tool errors:\n' + errors.map((error) => '- ' + error).join('\n'));
  if (runtime.safetyConstraints?.length) {
    lines.push('Safety constraints:\n' + runtime.safetyConstraints.map((item) => '- ' + item).join('\n'));
  }
  lines.push(
    'Older evidence may be compacted in this request projection; re-fetch specific bytes before relying on them.',
  );
  return boundedSource(lines.join('\n\n'), MAX_RENDERED_CHARS).text;
}

module.exports = {
  ANCHOR_VERSION,
  MAX_SOURCE_CHARS,
  MAX_RENDERED_CHARS,
  boundedSource,
  createContextState,
  updateDirective,
  renderSessionAnchor,
};
