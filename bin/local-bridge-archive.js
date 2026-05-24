#!/usr/bin/env node
'use strict';

/**
 * Query and maintain ~/.bridge-runner/archive/
 */

const { parseArgs } = require('util');
const fs = require('fs');
const path = require('path');
const {
  archiveRoot,
  runDir,
  readCatalogJsonl,
  rebuildIndex,
  getSessionSummary,
  ingestLegacyLogs,
  ingestLegacyFile,
  searchCatalog,
  rebuildSpreadsheets,
} = require('../src/runner/archive');

function showHelp() {
  console.log(`local-bridge-archive — browse runner run archives

Usage:
  node bin/local-bridge-archive.js <command> [options]

Commands:
  list [--limit N]              Recent runs from catalog (default 20)
  show <runId>                  Print meta + outcome for one run
  search <query> [--limit N]    Search catalog fields
  session <sessionId>           Session rollup summary
  ingest-legacy [--force]       Import ~/.bridge-runner/logs/*.jsonl
  rebuild-index                 Rebuild catalog.latest.json
  rebuild-spreadsheets          Regenerate CSV + XLSX exports

Options:
  --limit <n>                   Max rows (default 20)
  --force                       Re-import legacy files even if runId exists
  --log-dir <path>              Override legacy logs directory
  --help                        Show help

Archive root: ${archiveRoot()}
`);
}

function cmdList(limit) {
  const rows = readCatalogJsonl()
    .sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')))
    .slice(0, limit);
  console.log(JSON.stringify(rows, null, 2));
}

function cmdShow(runId) {
  const rdir = runDir(runId);
  if (!fs.existsSync(rdir)) {
    console.error('Run not found: ' + runId);
    process.exit(1);
  }
  const meta = JSON.parse(fs.readFileSync(path.join(rdir, 'meta.json'), 'utf8'));
  const outcome = JSON.parse(fs.readFileSync(path.join(rdir, 'outcome.json'), 'utf8'));
  const sources = fs.existsSync(path.join(rdir, 'sources.json'))
    ? JSON.parse(fs.readFileSync(path.join(rdir, 'sources.json'), 'utf8'))
    : null;
  const turnsDir = path.join(rdir, 'turns');
  const turnFiles = fs.existsSync(turnsDir) ? fs.readdirSync(turnsDir).sort() : [];
  console.log(JSON.stringify({ meta, outcome, sources, turnFiles }, null, 2));
}

function main() {
  const args = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      limit: { type: 'string' },
      force: { type: 'boolean' },
      'log-dir': { type: 'string' },
      help: { type: 'boolean' },
    },
  });

  if (args.values.help || args.positionals.length === 0) {
    showHelp();
    process.exit(args.positionals.length === 0 ? 1 : 0);
  }

  const command = args.positionals[0];
  const limit = parseInt(args.values.limit, 10) || 20;

  switch (command) {
    case 'list':
      cmdList(limit);
      break;
    case 'show': {
      const runId = args.positionals[1];
      if (!runId) {
        console.error('Usage: show <runId>');
        process.exit(1);
      }
      cmdShow(runId);
      break;
    }
    case 'search': {
      const query = args.positionals.slice(1).join(' ');
      if (!query) {
        console.error('Usage: search <query>');
        process.exit(1);
      }
      console.log(JSON.stringify(searchCatalog(query, limit), null, 2));
      break;
    }
    case 'session': {
      const sessionId = args.positionals[1];
      if (!sessionId) {
        console.error('Usage: session <sessionId>');
        process.exit(1);
      }
      console.log(JSON.stringify(getSessionSummary(sessionId), null, 2));
      break;
    }
    case 'ingest-legacy':
      console.log(
        JSON.stringify(ingestLegacyLogs({ force: !!args.values.force, logDir: args.values['log-dir'] }), null, 2),
      );
      break;
    case 'rebuild-index':
      console.log(JSON.stringify(rebuildIndex(), null, 2));
      break;
    case 'rebuild-spreadsheets':
      console.log(JSON.stringify(rebuildSpreadsheets(), null, 2));
      break;
    default:
      console.error('Unknown command: ' + command);
      showHelp();
      process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
