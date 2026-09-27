#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { job, MODES } = require('../../src/hosting/control');
const mode = process.argv[2];
if (!Object.hasOwn(MODES, mode)) throw new Error('Specify a managed mode');
const rootPid = job(mode).pid;
if (!rootPid) throw new Error('Managed job is not running');
const rows = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,rss='], { encoding: 'utf8' })
  .trim()
  .split('\n')
  .map((row) => row.trim().split(/\s+/).map(Number));
const included = new Set([rootPid]);
let changed = true;
while (changed) {
  changed = false;
  for (const [pid, parent] of rows)
    if (included.has(parent) && !included.has(pid)) {
      included.add(pid);
      changed = true;
    }
}
const owned = rows.filter(([pid]) => included.has(pid));
const result = {
  mode,
  sampledAt: new Date().toISOString(),
  processes: owned.length,
  residentMiB: Math.round(owned.reduce((sum, row) => sum + row[2], 0) / 1024),
  caveat:
    'Point-in-time resident pages only; excludes compressed/swapped memory, shared-page accounting and separate browser client. Not Activity Monitor memory footprint.',
};
const directory = path.join(os.homedir(), '.bridge-runner/hosting-verification');
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(directory, mode + '-memory.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
console.log(JSON.stringify(result));
