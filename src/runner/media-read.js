'use strict';

/**
 * media-read.js — Image and PDF helpers for read_file multimodal results, and
 * the ONE rule for which images this runner forwards to the model (used by
 * read_file, by the ACP prompt parser, and by the outbound message builder).
 */

const fs = require('fs');
const path = require('path');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const IMAGE_MEDIA_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

// The media types the Messages API accepts for base64 image sources — derived
// from the extension map above so there is exactly one list to edit.
const ACCEPTED_IMAGE_MEDIA_TYPES = new Set(Object.values(IMAGE_MEDIA_TYPES));

// Keep under Anthropic per-image limits (10MB base64 on direct API).
const MAX_IMAGE_BYTES = 7 * 1024 * 1024;
const MAX_PDF_BYTES = 10 * 1024 * 1024;

/**
 * Decide whether one image (media type + base64 payload) may go to the model.
 * Returns `{ ok: true, block }` with the exact Anthropic image block this
 * runner forwards, or `{ ok: false, reason }` with the short reason a caller
 * can show the user. The size check measures the DECODED payload with
 * Buffer.byteLength(data, 'base64'): a 4/3 estimate miscounts the trailing
 * "=" padding as data and rejects an image that is exactly at the limit
 * (Cursor thermo-nuclear review 2026-10-17, Medium #4).
 */
function acceptImage(mediaType, data) {
  const type = typeof mediaType === 'string' ? mediaType.toLowerCase() : '';
  if (!ACCEPTED_IMAGE_MEDIA_TYPES.has(type))
    return { ok: false, reason: 'unsupported media type ' + (type || '(missing)') };
  if (typeof data !== 'string' || !data) return { ok: false, reason: 'missing image data' };
  if (Buffer.byteLength(data, 'base64') > MAX_IMAGE_BYTES)
    return { ok: false, reason: 'exceeds ' + MAX_IMAGE_BYTES + ' bytes' };
  return { ok: true, block: { type: 'image', source: { type: 'base64', media_type: type, data } } };
}

/** True only for a block shaped exactly like acceptImage() builds and passing its rule. */
function isAcceptedImageBlock(block) {
  return !!(
    block &&
    block.type === 'image' &&
    block.source &&
    block.source.type === 'base64' &&
    acceptImage(block.source.media_type, block.source.data).ok
  );
}

function detectMediaKind(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (ext === '.pdf') return 'pdf';
  return 'text';
}

function mediaTypeForPath(filePath) {
  return IMAGE_MEDIA_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function readImageResult(absPath, relPath, stats) {
  if (stats.size > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      text:
        'Image too large for multimodal read_file (' +
        stats.size +
        ' bytes; max ' +
        MAX_IMAGE_BYTES +
        '). Resize or split the asset.',
    };
  }

  const data = fs.readFileSync(absPath).toString('base64');
  const mediaType = mediaTypeForPath(absPath);
  return {
    ok: true,
    multimodal: true,
    bytes: stats.size,
    text:
      '[read_file multimodal] Loaded image ' +
      relPath +
      ' (' +
      mediaType +
      ', ' +
      stats.size +
      ' bytes). Visual content attached for the model.',
    contentBlocks: [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType,
          data,
        },
      },
    ],
  };
}

function readPdfResult(absPath, relPath, stats) {
  if (stats.size > MAX_PDF_BYTES) {
    return {
      ok: false,
      text:
        'PDF too large for multimodal read_file (' +
        stats.size +
        ' bytes; max ' +
        MAX_PDF_BYTES +
        '). Split the document or extract text manually.',
    };
  }

  const data = fs.readFileSync(absPath).toString('base64');
  return {
    ok: true,
    multimodal: true,
    bytes: stats.size,
    text:
      '[read_file multimodal] Loaded PDF ' + relPath + ' (' + stats.size + ' bytes). Document attached for the model.',
    contentBlocks: [
      {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data,
        },
      },
    ],
  };
}

module.exports = {
  IMAGE_EXTENSIONS,
  ACCEPTED_IMAGE_MEDIA_TYPES,
  MAX_IMAGE_BYTES,
  MAX_PDF_BYTES,
  acceptImage,
  isAcceptedImageBlock,
  detectMediaKind,
  mediaTypeForPath,
  readImageResult,
  readPdfResult,
};
