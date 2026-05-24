'use strict';

const fs = require('fs');
const path = require('path');
const { readCatalogJsonl } = require('./indexer');
const { exportsCsvDir, exportsWorkbookPath } = require('./paths');

const CSV_COLUMNS = [
  'runId',
  'sessionId',
  'startedAt',
  'endedAt',
  'cwd',
  'model',
  'source',
  'stopReason',
  'steps',
  'duration_ms',
  'estimatedCostUsd',
  'turnCount',
  'promptPreview',
  'agentProfile',
];

function csvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function rowsToCsv(rows) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map((c) => csvEscape(row[c])).join(','));
  }
  return lines.join('\n') + '\n';
}

function rebuildCsvExports(rows) {
  const dir = exportsCsvDir();
  fs.mkdirSync(dir, { recursive: true });
  const allPath = path.join(dir, 'all-runs.csv');
  fs.writeFileSync(allPath, rowsToCsv(rows), 'utf8');

  const bySource = {};
  for (const row of rows) {
    const src = row.source || 'unknown';
    if (!bySource[src]) bySource[src] = [];
    bySource[src].push(row);
  }
  for (const [src, subset] of Object.entries(bySource)) {
    const safe = src.replace(/[^a-zA-Z0-9_-]/g, '_');
    fs.writeFileSync(path.join(dir, 'runs-' + safe + '.csv'), rowsToCsv(subset), 'utf8');
  }
  return { allPath, sourceFiles: Object.keys(bySource).length };
}

function rebuildWorkbook(rows) {
  let XLSX;
  try {
    XLSX = require('xlsx');
  } catch {
    return { skipped: true, reason: 'xlsx package not installed (npm install xlsx)' };
  }

  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(
    rows.map((r) => {
      const out = {};
      for (const c of CSV_COLUMNS) out[c] = r[c];
      return out;
    }),
  );
  XLSX.utils.book_append_sheet(wb, sheet, 'runs');

  const dir = path.dirname(exportsWorkbookPath());
  fs.mkdirSync(dir, { recursive: true });
  XLSX.writeFile(wb, exportsWorkbookPath());
  return { path: exportsWorkbookPath(), skipped: false };
}

function rebuildSpreadsheets() {
  const rows = readCatalogJsonl();
  const csv = rebuildCsvExports(rows);
  const xlsx = rebuildWorkbook(rows);
  return { rowCount: rows.length, csv, xlsx };
}

function searchCatalog(query, limit = 20) {
  const q = String(query || '')
    .toLowerCase()
    .trim();
  if (!q) return [];
  const rows = readCatalogJsonl();
  const hits = [];
  for (const row of rows) {
    const hay = [row.runId, row.sessionId, row.cwd, row.promptPreview, row.stopReason, row.model, row.source]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (hay.includes(q)) hits.push(row);
    if (hits.length >= limit) break;
  }
  return hits;
}

module.exports = {
  CSV_COLUMNS,
  rebuildSpreadsheets,
  rebuildCsvExports,
  searchCatalog,
};
