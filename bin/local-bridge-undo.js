#!/usr/bin/env node
'use strict';

/**
 * bin/local-bridge-undo.js — recovery workflow for the runner ("undo last-run").
 *
 * The runner already saves a backup before every edit/write and records the
 * change in a per-run manifest under <cwd>/.bridge-runner/runs/<runId>/. This
 * CLI turns those manifests into a one-command rollback for a whole run.
 *
 * Where to run it: a Terminal, inside (or pointed at with --cwd) the project the
 * runner was editing.
 *
 * Usage:
 *   node bin/local-bridge-undo.js list-runs [--cwd <path>] [--limit N] [--json]
 *   node bin/local-bridge-undo.js show <runId|sessionId> [--cwd <path>] [--json]
 *   node bin/local-bridge-undo.js last-run [--cwd <path>] [--dry-run] [--yes] [--force]
 *   node bin/local-bridge-undo.js run <runId|sessionId> [--cwd <path>] [--dry-run] [--yes] [--force]
 *
 * Flags:
 *   --cwd <path>   Project folder to operate in (default: current directory)
 *   --limit <n>    Max rows for list-runs (default 20)
 *   --dry-run      Show what would be reverted, change nothing (safe preview)
 *   --yes          Skip the confirmation prompt (required in non-interactive use)
 *   --force        Also revert files changed by a later run (overwrite newer work)
 *   --json         Machine-readable output on stdout
 *
 * Safety:
 *   A revert restores files in reverse edit order. If a file changed *after* the
 *   run we are reverting (a later run, a manual edit, git), it is marked
 *   "diverged" and SKIPPED unless you pass --force. In non-interactive shells we
 *   fail closed: without --yes (or --dry-run) the command refuses rather than
 *   silently rewriting files.
 */

const { parseArgs } = require('util');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const {
  listRunManifests,
  latestRunManifest,
  resolveRunManifest,
  planRevert,
  applyRevert,
} = require('../src/runner/recovery/run-manifest');

function showHelp() {
  console.log(`local-bridge-undo — revert a whole runner run from its backups

Usage:
  node bin/local-bridge-undo.js <command> [options]

Commands:
  list-runs                    List recorded runs (newest first)
  show <runId|sessionId>       Show one run's recorded edits
  last-run                     Revert the most recent run (asks first)
  run <runId|sessionId>        Revert a specific run (asks first)

Options:
  --cwd <path>                 Project folder (default: current directory)
  --limit <n>                  Max rows for list-runs (default 20)
  --dry-run                    Preview the revert without changing files
  --yes                        Skip confirmation (required when not a terminal)
  --force                      Revert even files a later run changed (overwrite)
  --json                       Machine-readable output
  --help                       Show this help

Notes:
  A "diverged" file changed after the run you are reverting; it is skipped unless
  you pass --force. Manifests are not auto-deleted — prune old ones by removing
  the matching folder under <cwd>/.bridge-runner/runs/.
`);
}

function resolveCwd(values) {
  const cwd = path.resolve(values.cwd || process.cwd());
  if (!fs.existsSync(cwd)) {
    console.error('Error: --cwd does not exist: ' + cwd);
    process.exit(1);
  }
  return cwd;
}

function shortId(id) {
  const str = String(id || '');
  return str.length > 12 ? str.slice(0, 12) + '…' : str;
}

function summarizeManifest(m) {
  return {
    runId: m.runId,
    sessionId: m.sessionId || null,
    finishedAt: m.finishedAt || m.startedAt || null,
    model: m.model || null,
    edits: Array.isArray(m.edits) ? m.edits.length : 0,
    files: Array.isArray(m.edits) ? [...new Set(m.edits.map((e) => e.path))].length : 0,
  };
}

function cmdListRuns(cwd, values) {
  const manifests = listRunManifests(cwd).slice(0, parseInt(values.limit, 10) || 20);
  if (values.json) {
    console.log(JSON.stringify(manifests.map(summarizeManifest), null, 2));
    return;
  }
  if (manifests.length === 0) {
    console.log('No recorded runs under ' + path.join(cwd, '.bridge-runner', 'runs') + '.');
    return;
  }
  console.log('Recorded runs (newest first):\n');
  for (const m of manifests) {
    const s = summarizeManifest(m);
    const when = s.finishedAt || '(unknown time)';
    const session = s.sessionId ? '  session=' + shortId(s.sessionId) : '';
    console.log('  ' + shortId(s.runId) + '  ' + when + '  ' + s.files + ' file(s), ' + s.edits + ' edit(s)' + session);
  }
  console.log('\nRevert the latest with:  node bin/local-bridge-undo.js last-run');
}

function cmdShow(cwd, idArg, values) {
  const manifest = idArg ? resolveRunManifest(cwd, idArg) : latestRunManifest(cwd);
  if (!manifest) {
    console.error('Error: no run found for ' + (idArg || 'last-run') + '.');
    process.exit(1);
  }
  if (values.json) {
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }
  const s = summarizeManifest(manifest);
  console.log('Run ' + manifest.runId);
  if (manifest.sessionId) console.log('  session: ' + manifest.sessionId);
  console.log('  finished: ' + (s.finishedAt || '(unknown)'));
  console.log('  model: ' + (s.model || '(unknown)'));
  console.log('  edits: ' + s.edits + ' across ' + s.files + ' file(s)\n');
  for (const edit of manifest.edits || []) {
    console.log('  ' + (edit.tool || 'edit') + '  ' + edit.path + (edit.backupPath ? '' : '  (created)'));
  }
}

// Ask a yes/no question on the terminal. Resolves to true only on an explicit
// "y"/"yes". Used to gate destructive reverts behind a deliberate keystroke.
function confirm(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question(question + ' [y/N] ', (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(String(answer || '').trim()));
    });
  });
}

function printPlan(plan, cwd) {
  console.log('Revert plan for run ' + shortId(plan.runId) + ' (cwd: ' + cwd + ')\n');

  for (const action of plan.actions) {
    const tag =
      action.status === 'restore' ? 'restore' : action.status === 'delete' ? 'delete ' : action.status.toUpperCase();
    console.log('  [' + tag + '] ' + action.path);
    if (action.detail) console.log('      ' + action.detail);
    if (action.preview && action.status === 'restore') {
      const indented = action.preview
        .split('\n')
        .map((l) => '      ' + l)
        .join('\n');
      console.log(indented);
    }
  }

  const willApply = plan.actions.filter((a) => a.status === 'restore' || a.status === 'delete').length;
  const needsForce = plan.actions.filter((a) => a.status === 'diverged' || a.status === 'gone').length;
  console.log('');
  console.log(
    'Summary: ' + willApply + ' revertible, ' + needsForce + ' need --force, ' + plan.actions.length + ' total.',
  );
  if (needsForce > 0) {
    console.log('Files marked DIVERGED/GONE changed after this run; they are skipped unless you pass --force.');
  }
}

async function cmdRevert(cwd, idArg, values) {
  const manifest = idArg ? resolveRunManifest(cwd, idArg) : latestRunManifest(cwd);
  if (!manifest) {
    console.error('Error: no run found for ' + (idArg || 'last-run') + '. Try: list-runs');
    process.exit(1);
  }

  const plan = planRevert(cwd, manifest);

  if (values.json && values['dry-run']) {
    console.log(JSON.stringify({ plan }, null, 2));
    return;
  }

  printPlan(plan, cwd);

  if (values['dry-run']) {
    console.log('\nDry run — no files were changed.');
    return;
  }

  const willApply = plan.actions.filter(
    (a) =>
      a.status === 'restore' ||
      a.status === 'delete' ||
      ((a.status === 'diverged' || a.status === 'gone') && values.force),
  ).length;
  if (willApply === 0) {
    console.log('\nNothing to revert' + (values.force ? '.' : ' (try --force to override diverged/gone files).'));
    return;
  }

  // Confirmation gate. --yes skips it; a TTY prompts; a non-interactive shell
  // without --yes fails closed so automation can never silently rewrite files.
  if (!values.yes) {
    if (!process.stdin.isTTY) {
      console.error(
        '\nRefusing to revert without confirmation in a non-interactive shell. Re-run with --yes (or --dry-run).',
      );
      process.exit(2);
    }
    const ok = await confirm('Revert ' + willApply + ' file(s) for run ' + shortId(plan.runId) + '?');
    if (!ok) {
      console.log('Aborted. No files were changed.');
      return;
    }
  }

  const results = applyRevert(cwd, plan, { force: !!values.force });
  if (values.json) {
    console.log(JSON.stringify({ runId: plan.runId, results }, null, 2));
    return;
  }
  let applied = 0;
  let skipped = 0;
  for (const r of results) {
    if (r.applied) {
      applied++;
      console.log('  ' + (r.action || 'reverted') + ': ' + r.path);
    } else {
      skipped++;
      console.log('  skipped (' + r.status + '): ' + r.path + (r.detail ? ' — ' + r.detail : ''));
    }
  }
  console.log('\nDone. ' + applied + ' reverted, ' + skipped + ' skipped.');
}

async function main() {
  let args;
  try {
    args = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      options: {
        cwd: { type: 'string' },
        limit: { type: 'string' },
        'dry-run': { type: 'boolean' },
        yes: { type: 'boolean' },
        force: { type: 'boolean' },
        json: { type: 'boolean' },
        help: { type: 'boolean' },
      },
    });
  } catch (err) {
    console.error('Error parsing arguments: ' + err.message);
    process.exit(1);
  }

  if (args.values.help || args.positionals.length === 0) {
    showHelp();
    process.exit(args.positionals.length === 0 ? 1 : 0);
  }

  const command = args.positionals[0];
  const cwd = resolveCwd(args.values);

  switch (command) {
    case 'list-runs':
      cmdListRuns(cwd, args.values);
      break;
    case 'show':
      cmdShow(cwd, args.positionals[1], args.values);
      break;
    case 'last-run':
      await cmdRevert(cwd, null, args.values);
      break;
    case 'run': {
      const id = args.positionals[1];
      if (!id) {
        console.error('Usage: run <runId|sessionId>');
        process.exit(1);
      }
      await cmdRevert(cwd, id, args.values);
      break;
    }
    default:
      console.error('Unknown command: ' + command);
      showHelp();
      process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Unexpected error: ' + err.message);
    process.exitCode = 1;
  });
}

module.exports = { main };
