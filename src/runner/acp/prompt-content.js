'use strict';

/**
 * prompt-content.js — turn an ACP (Agent Client Protocol) prompt into what
 * run() consumes: one plain prompt string plus any image attachments as
 * Anthropic image blocks.
 *
 * ACP sends a prompt as ContentBlock[]: `{ type: 'text', text }`,
 * `{ type: 'resource_link', uri }`, and (since 2026-10-16, T3 screenshot
 * drops) `{ type: 'image', data: <base64>, mimeType }`. Which images may be
 * forwarded is decided by the shared acceptor in media-read.js — this file
 * only owns the visible text: the per-image placeholder when one is dropped,
 * and the "(See attached image.)" stub for an image-only prompt, because
 * run() requires a non-empty prompt string and the ledger/trace capture it.
 *
 * Pure functions, no I/O. Extracted from agent.js on 2026-10-17 so that file
 * is a protocol translator again (Cursor thermo-nuclear review, High #2).
 */

const { acceptImage } = require('../media-read');

/**
 * @returns {{ text: string, attachments: object[], dropped: {index:number, reason:string}[] }}
 *   `attachments` are ready-to-send Anthropic image blocks; `dropped` lists
 *   each refused image (1-based position among the images) and why.
 */
function promptContentFrom(blocks) {
  if (!Array.isArray(blocks)) return { text: '', attachments: [], dropped: [] };
  const parts = [];
  const attachments = [];
  const dropped = [];
  let imageIndex = 0;
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
    // Baseline ACP also requires resource_link support: we cannot fetch the
    // resource, but we can hand its address to the model as context.
    else if (block.type === 'resource_link' && typeof block.uri === 'string') parts.push('[resource] ' + block.uri);
    else if (block.type === 'image') {
      imageIndex += 1;
      const verdict = acceptImage(block.mimeType, block.data);
      if (!verdict.ok) {
        // Not silently lost: the model — and the user reading the transcript —
        // can see an attachment was dropped and why.
        dropped.push({ index: imageIndex, reason: verdict.reason });
        parts.push('[image attachment ' + imageIndex + ' not forwarded: ' + verdict.reason + ']');
        continue;
      }
      attachments.push(verdict.block);
    }
  }
  let text = parts.join('\n\n').trim();
  if (!text && attachments.length > 0) {
    text = attachments.length === 1 ? '(See attached image.)' : '(See the ' + attachments.length + ' attached images.)';
  }
  return { text, attachments, dropped };
}

/** Extract only the plain text of an ACP prompt (ContentBlock[]). */
function promptTextFrom(blocks) {
  return promptContentFrom(blocks).text;
}

module.exports = { promptContentFrom, promptTextFrom };
