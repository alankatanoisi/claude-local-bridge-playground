'use strict';

/**
 * Workspace trust gate — consent before any tool runs on a cwd.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

function userConfigDir() {
  return path.join(process.env.HOME || process.env.USERPROFILE || process.cwd(), '.bridge-runner');
}

function trustStorePath() {
  return path.join(userConfigDir(), 'trust.json');
}

function loadTrustStore() {
  const p = trustStorePath();
  if (!fs.existsSync(p)) return { workspaces: [] };
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return { workspaces: [] };
  }
}

function saveTrustStore(store) {
  const dir = userConfigDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(trustStorePath(), JSON.stringify(store, null, 2) + '\n', 'utf8');
}

function fingerprintCwd(cwdRealpath) {
  return crypto.createHash('sha256').update(cwdRealpath).digest('hex').slice(0, 16);
}

function isTrusted(cwdRealpath) {
  const store = loadTrustStore();
  const fp = fingerprintCwd(cwdRealpath);
  return store.workspaces.some((w) => w.cwdRealpath === cwdRealpath && w.fingerprint === fp);
}

function recordTrust(cwdRealpath) {
  const store = loadTrustStore();
  const fp = fingerprintCwd(cwdRealpath);
  const existing = store.workspaces.findIndex((w) => w.cwdRealpath === cwdRealpath);
  const entry = { cwdRealpath, fingerprint: fp, trustedAt: new Date().toISOString() };
  if (existing >= 0) store.workspaces[existing] = entry;
  else store.workspaces.push(entry);
  saveTrustStore(store);
  return entry;
}

function findGitRoot(cwd) {
  let dir = cwd;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

function askInteractive(question) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      resolve(false);
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test((answer || '').trim()));
    });
  });
}

/**
 * Evaluate workspace trust. Fail closed unless trusted or consent given.
 * @param {object} options
 * @param {string} options.cwdRealpath
 * @param {boolean} [options.trustWorkspace] — record trust this run
 * @param {boolean} [options.trustedWorkspace] — this run uses trusted features
 * @param {boolean} [options.quiet]
 * @returns {Promise<{ trusted: boolean, recorded?: boolean, reason?: string }>}
 */
async function evaluateWorkspaceTrust(options) {
  const { cwdRealpath, trustWorkspace = false, quiet = false } = options;

  if (isTrusted(cwdRealpath)) {
    return { trusted: true, reason: 'prior_consent' };
  }

  if (trustWorkspace) {
    recordTrust(cwdRealpath);
    return { trusted: true, recorded: true, reason: 'trust_workspace_flag' };
  }

  if (!process.stdin.isTTY) {
    return {
      trusted: false,
      reason: 'non_interactive_no_trust',
    };
  }

  const gitRoot = findGitRoot(cwdRealpath);
  if (!quiet) {
    console.error('\n─── WORKSPACE TRUST ───');
    console.error('Folder: ' + cwdRealpath);
    if (gitRoot) console.error('Git root: ' + gitRoot);
    console.error('The runner will read and possibly edit files in this folder.');
    console.error('Trust this workspace for this machine? (y/n)');
    console.error('──────────────────────\n');
  }

  const approved = await askInteractive('Trust this workspace? (y/n): ');
  if (approved) {
    recordTrust(cwdRealpath);
    return { trusted: true, recorded: true, reason: 'interactive_consent' };
  }

  return { trusted: false, reason: 'user_declined' };
}

module.exports = {
  userConfigDir,
  trustStorePath,
  loadTrustStore,
  saveTrustStore,
  fingerprintCwd,
  isTrusted,
  recordTrust,
  evaluateWorkspaceTrust,
  findGitRoot,
};
