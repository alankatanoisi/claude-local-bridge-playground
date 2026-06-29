'use strict';

/**
 * media-read.js — Image and PDF helpers for read_file multimodal results.
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

// Keep under Anthropic per-image limits (10MB base64 on direct API).
const MAX_IMAGE_BYTES = 7 * 1024 * 1024;
const MAX_PDF_BYTES = 10 * 1024 * 1024;

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
      '[read_file multimodal] Loaded PDF ' +
      relPath +
      ' (' +
      stats.size +
      ' bytes). Document attached for the model.',
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
  MAX_IMAGE_BYTES,
  MAX_PDF_BYTES,
  detectMediaKind,
  mediaTypeForPath,
  readImageResult,
  readPdfResult,
};
