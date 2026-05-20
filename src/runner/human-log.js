'use strict';

const fs = require('fs');
const path = require('path');
const safety = require('./safety');

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

function toolUsesFromContent(content) {
  if (!Array.isArray(content)) return [];
  return content.filter((block) => block.type === 'tool_use');
}

class HumanLog {
  constructor(filePath) {
    this.filePath = filePath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '# Local Bridge Runner Log\n\n');
  }

  appendSection(title, body) {
    const scrubbed = safety.scrubSecrets(body || '');
    const content = scrubbed.trim() ? scrubbed.trim() : '(empty)';
    fs.appendFileSync(this.filePath, '## ' + title + '\n\n' + content + '\n\n');
  }

  writeRunStart({ cwd, model, maxSteps, outputFormat }) {
    this.appendSection(
      'Run Started',
      ['cwd: ' + cwd, 'model: ' + model, 'max steps: ' + maxSteps, 'output format: ' + outputFormat].join('\n'),
    );
  }

  writeUserPrompt(prompt, stdinText) {
    let body = prompt || '';
    if (stdinText) {
      body += '\n\n---\nPasted context:\n' + stdinText;
    }
    this.appendSection('User Prompt', body);
  }

  writeAssistant(step, response) {
    const lines = [];
    const text = textFromContent(response.content);
    if (text) lines.push(text);

    const toolUses = toolUsesFromContent(response.content);
    if (toolUses.length > 0) {
      lines.push(
        'Tool requests:\n' +
          toolUses
            .map((toolUse) => {
              return '- ' + toolUse.name + ' ' + JSON.stringify(toolUse.input || {});
            })
            .join('\n'),
      );
    }

    this.appendSection('Assistant Turn ' + step, lines.join('\n\n'));
  }

  writeToolResult(step, toolName, toolUseId, result) {
    this.appendSection(
      'Tool Result ' + step + ' - ' + toolName,
      [
        'tool_use_id: ' + toolUseId,
        'ok: ' + !!result.ok,
        result.bytes === undefined ? null : 'bytes: ' + result.bytes,
        '',
        result.text || '',
      ]
        .filter((line) => line !== null)
        .join('\n'),
    );
  }

  writeFinal(text) {
    this.appendSection('Final Answer', text || '');
  }

  writeError(message) {
    this.appendSection('Error', message || 'unknown error');
  }
}

module.exports = { HumanLog, textFromContent, toolUsesFromContent };
