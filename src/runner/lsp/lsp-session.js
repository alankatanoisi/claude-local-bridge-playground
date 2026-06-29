'use strict';

/**
 * lsp-session.js — Per-run language server session helpers.
 */

const fs = require('fs');
const path = require('path');
const safety = require('../safety');
const { LspClient } = require('./lsp-client');

const SERVER_CANDIDATES = [
  { id: 'typescript', command: 'typescript-language-server', languageId: 'typescript', extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] },
  { id: 'python', command: 'pyright-langserver', args: ['--stdio'], languageId: 'python', extensions: ['.py'] },
];

function pathToFileUri(absPath) {
  let resolved = path.resolve(absPath);
  if (process.platform === 'win32') {
    resolved = resolved.replace(/\\/g, '/');
    if (!resolved.startsWith('/')) resolved = '/' + resolved;
  }
  return 'file://' + resolved;
}

function pickServer(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return SERVER_CANDIDATES.find((row) => row.extensions.includes(ext)) || SERVER_CANDIDATES[0];
}

function sessionKey(cwd, serverId) {
  return cwd + '|' + serverId;
}

function getSession(ctx, serverRow) {
  if (!ctx._lspSessions) ctx._lspSessions = new Map();
  const key = sessionKey(ctx.cwdRealpath || ctx.cwd, serverRow.id);
  if (ctx._lspSessions.has(key)) return ctx._lspSessions.get(key);

  const root = ctx.cwdRealpath || ctx.cwd;
  const client = new LspClient({
    command: serverRow.command,
    args: serverRow.args || ['--stdio'],
    cwd: root,
    env: safety.buildSafeEnv(),
  });
  const session = { client, serverRow, opened: new Map(), rootUri: pathToFileUri(root), initialized: false };
  ctx._lspSessions.set(key, session);
  return session;
}

async function ensureDocument(session, relPath, ctx) {
  const absPath = path.resolve(ctx.cwdRealpath || ctx.cwd, relPath);
  const uri = pathToFileUri(absPath);
  if (session.opened.has(uri)) return { uri, absPath };

  if (!session.initialized) {
    await session.client.initialize(session.rootUri);
    session.initialized = true;
  }

  const text = fs.readFileSync(absPath, 'utf8');
  session.client.openDocument(uri, session.serverRow.languageId, text, 1);
  session.opened.set(uri, true);
  return { uri, absPath, text };
}

function formatLocation(result) {
  if (!result) return '(no result)';
  const rows = Array.isArray(result) ? result : [result];
  if (!rows.length) return '(no locations)';
  return rows
    .map((loc) => {
      const uri = loc.uri || '';
      const range = loc.range || {};
      const start = range.start || {};
      return uri.replace(/^file:\/\//, '') + ':' + ((start.line ?? 0) + 1) + ':' + (start.character ?? 0);
    })
    .join('\n');
}

function formatHover(result) {
  if (!result) return '(no hover)';
  const contents = result.contents;
  if (typeof contents === 'string') return contents;
  if (Array.isArray(contents)) {
    return contents
      .map((part) => (typeof part === 'string' ? part : part.value || ''))
      .filter(Boolean)
      .join('\n');
  }
  if (contents && typeof contents === 'object') return contents.value || JSON.stringify(contents);
  return JSON.stringify(result);
}

function formatDiagnostics(result) {
  const items = Array.isArray(result) ? result : result?.items || [];
  if (!items.length) return '(no diagnostics)';
  const severityLabel = { 1: 'error', 2: 'warning', 3: 'info', 4: 'hint' };
  return items
    .map((diag) => {
      const range = diag.range || {};
      const start = range.start || {};
      const line = (start.line ?? 0) + 1;
      const col = start.character ?? 0;
      const sev = severityLabel[diag.severity] || String(diag.severity ?? 'diag');
      return sev + ' @ ' + line + ':' + col + ' — ' + (diag.message || '');
    })
    .join('\n');
}

async function runLspQuery(args, ctx) {
  const relPath = String(args.path || '').trim();
  const action = String(args.action || 'definition').trim();
  const line = Math.max(Number(args.line) || 1, 1);
  const character = Math.max(Number(args.character) || 0, 0);

  if (!relPath) return { ok: false, text: 'Missing required path for lsp_query.' };

  const serverRow = pickServer(relPath);
  let session;
  try {
    session = getSession(ctx, serverRow);
  } catch (err) {
    return { ok: false, text: 'Failed to start language server: ' + err.message };
  }

  let doc;
  try {
    doc = await ensureDocument(session, relPath, ctx);
  } catch (err) {
    return { ok: false, text: 'Failed to open document for LSP: ' + err.message };
  }

  const position = { line: line - 1, character };
  const textDocument = { uri: doc.uri };

  try {
    if (action === 'definition') {
      const result = await session.client.request('textDocument/definition', { textDocument, position });
      return { ok: true, text: formatLocation(result) };
    }
    if (action === 'references') {
      const result = await session.client.request('textDocument/references', {
        textDocument,
        position,
        context: { includeDeclaration: true },
      });
      return { ok: true, text: formatLocation(result) };
    }
    if (action === 'hover') {
      const result = await session.client.request('textDocument/hover', { textDocument, position });
      return { ok: true, text: formatHover(result) };
    }
    if (action === 'diagnostics') {
      // Many servers publish diagnostics asynchronously; requestDocumentDiagnostics when supported.
      let result = null;
      try {
        result = await session.client.request('textDocument/diagnostic', {
          textDocument,
        });
      } catch {
        result = { items: [] };
      }
      return { ok: true, text: formatDiagnostics(result) };
    }
    return { ok: false, text: 'Unknown lsp_query action: ' + action };
  } catch (err) {
    const hint =
      err.message && err.message.includes('ENOENT')
        ? ' Install a language server (e.g. npm i -g typescript-language-server typescript) and retry.'
        : '';
    return { ok: false, text: 'LSP query failed: ' + err.message + hint };
  }
}

function disposeSessions(ctx) {
  if (!ctx || !ctx._lspSessions) return;
  for (const session of ctx._lspSessions.values()) {
    try {
      session.client.dispose();
    } catch {
      // best-effort
    }
  }
  ctx._lspSessions.clear();
}

module.exports = {
  SERVER_CANDIDATES,
  pickServer,
  pathToFileUri,
  runLspQuery,
  disposeSessions,
  getSession,
  ensureDocument,
};
