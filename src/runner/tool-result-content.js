'use strict';

/**
 * tool-result-content.js — Normalize tool results for Anthropic tool_result blocks.
 *
 * Text-only tools return a string. Multimodal read_file results may attach
 * image/document blocks that must flow to the model as structured content.
 */

function summarizeBlocksForLog(blocks) {
  if (!Array.isArray(blocks)) return '';
  return blocks
    .map((block) => {
      if (block.type === 'text') return block.text || '';
      if (block.type === 'image') {
        const media = block.source?.media_type || 'image';
        const bytes = block.source?.data ? Buffer.byteLength(block.source.data, 'utf8') : 0;
        return '[image ' + media + ', ~' + bytes + ' base64 chars attached to model]';
      }
      if (block.type === 'document') {
        const bytes = block.source?.data ? Buffer.byteLength(block.source.data, 'utf8') : 0;
        return '[document pdf, ~' + bytes + ' base64 chars attached to model]';
      }
      return '[' + (block.type || 'block') + ']';
    })
    .filter(Boolean)
    .join('\n');
}

function buildToolResultContent(result) {
  if (!result) return '';
  const blocks = Array.isArray(result.contentBlocks) ? result.contentBlocks : null;
  if (!blocks || !blocks.length) return result.text || '';

  const payload = [...blocks];
  if (result.text) payload.push({ type: 'text', text: result.text });
  if (payload.length === 1 && payload[0].type === 'text') return payload[0].text || '';
  return payload;
}

function stringifyToolResultContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content || '');
  return content
    .map((block) => {
      if (block.type === 'text') return block.text || '';
      if (block.type === 'image') return '[image block]';
      if (block.type === 'document') return '[document block]';
      return JSON.stringify(block);
    })
    .join('\n');
}

module.exports = {
  buildToolResultContent,
  summarizeBlocksForLog,
  stringifyToolResultContent,
};
