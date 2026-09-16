'use strict';

/**
 * documents.js — how a run's input files are read and how they are shown.
 *
 * Two shapes exist on purpose:
 *   - the FULL document (with `text`) is what workers analyze and what the
 *     run stores as `input-<id>.json` so a resume can use the exact bytes;
 *   - the PUBLIC document (metadata only, no `text`) is what the planner sees.
 *     Generated Starlark plans over ids, paths, sizes, and hashes — never over
 *     file contents.
 * Both the coordinator and worker-resume.js need these, so they live here
 * rather than inside coordinator.js (extracted for thermo-nuclear Medium #4).
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function loadDocuments(config) {
  return config.documents.map((document) => {
    const absolutePath = path.resolve(config.targetRoot, document.path);
    const relativePath = path.relative(config.targetRoot, absolutePath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      throw new Error(`document escapes target root: ${document.path}`);
    }
    const buffer = fs.readFileSync(absolutePath);
    if (buffer.length > config.maxDocumentBytes) {
      throw new Error(`document exceeds ${config.maxDocumentBytes} bytes: ${document.path}`);
    }
    return {
      id: document.id,
      relativePath,
      bytes: buffer.length,
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      text: buffer.toString('utf8'),
    };
  });
}

function publicDocument({ id, kind, relativePath, bytes, sha256, metadata }) {
  return {
    id,
    kind: kind || 'document',
    path: relativePath,
    bytes,
    sha256,
    ...(metadata ? { metadata } : {}),
  };
}

// The fingerprint of "what this run was asked to do, over which bytes". Both a
// fresh run and a resume compute it the same way; a resume refuses to continue
// if the saved plan was accepted against a different value.
function inputContentHash(contentHash, objective, documents) {
  return contentHash({
    objective,
    documents: documents.map((document) => ({ ...publicDocument(document), text: document.text })),
  });
}

module.exports = { inputContentHash, loadDocuments, publicDocument };
