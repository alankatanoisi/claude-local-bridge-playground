'use strict';

/**
 * run-manifest.js — per-run recovery manifests for `undo last-run`.
 *
 * Background (why this exists):
 *   The write tools (edit_file / write_file / apply_patch) already drop a
 *   timestamped backup under .bridge-runner/backups/ before they touch a file,
 *   and they push an entry onto ctx.undoLog. That gives us per-file recovery,
 *   but after a botched --accept-edits run that touched a dozen files there was
 *   no single "undo the whole run" handle — the user had to hand-pick backups.
 *
 *   A run manifest is that handle. At the end of a run we copy the in-memory
 *   undoLog to disk as .bridge-runner/runs/<runId>/manifest.json. The
 *   `local-bridge-undo` CLI then reads these manifests to list past runs and
 *   revert one in reverse edit order.
 *
 * Directory naming decision:
 *   The roadmap (§4.5) sketches the path as .bridge-runner/runs/<session-id>/.
 *   We key the directory by the *run id* instead, because:
 *     - a run id is always present and globally unique, while a session id is
 *       only set when the user passes --session-id / --new-session / --fork-from;
 *     - a single session can span several runs (resume), so a session-keyed
 *       directory would overwrite earlier runs and break "undo the last run".
 *   The session id (when present) is still stored *inside* the manifest, so
 *   `undo run <session-id>` can resolve to the most recent run of that session.
 *
 * Overlap decision (a later run touched the same file):
 *   Revert is conservative. For each recorded edit we compare the file's current
 *   SHA-256 against the SHA-256 this run wrote (newSha256). If they differ, the
 *   file changed after this run (a later run, a manual edit, git, …) and we mark
 *   it "diverged" and SKIP it by default. Passing { force: true } overwrites the
 *   current content anyway. This prevents clobbering newer work by surprise.
 *
 * Garbage collection decision (v1):
 *   None automatic. Manifests are tiny JSON pointers (they reference backups,
 *   they do not copy file bodies). Old runs accumulate under .bridge-runner/runs/
 *   and can be pruned manually (e.g. `rm -rf .bridge-runner/runs/<runId>`). A GC
 *   policy can be layered on later without changing the on-disk shape.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const safety = require('../safety');

const MANIFEST_VERSION = 1;

function runsRoot(cwd) {
  return path.join(cwd, '.bridge-runner', 'runs');
}

function manifestDir(cwd, runId) {
  return path.join(runsRoot(cwd), runId);
}

function manifestPath(cwd, runId) {
  return path.join(manifestDir(cwd, runId), 'manifest.json');
}

function sha256OfFile(absPath) {
  // Returns null when the file does not exist (deleted or never created).
  try {
    const buf = fs.readFileSync(absPath);
    return crypto.createHash('sha256').update(buf).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Turn a single ctx.undoLog entry into a portable manifest record.
 *
 * Portability: backup paths are stored relative to cwd so a manifest still
 * resolves if the project folder is moved or cloned to a new machine.
 */
function normalizeEdit(cwd, entry) {
  if (!entry || !entry.path) return null;
  let backupRel = null;
  if (entry.backup_path) {
    backupRel = path.isAbsolute(entry.backup_path) ? path.relative(cwd, entry.backup_path) : entry.backup_path;
  }
  return {
    path: entry.path,
    tool: entry.tool || null,
    toolUseId: entry.tool_use_id || null,
    timestamp: entry.timestamp || null,
    backupPath: backupRel,
    originalSha256: entry.original_sha256 || null,
    newSha256: entry.new_sha256 || null,
  };
}

/**
 * Write (or overwrite) the manifest for a run from its undo log.
 *
 * Returns the manifest path on success, or null when there was nothing worth
 * recording (a read-only run leaves no manifest behind).
 */
function writeRunManifest(cwd, meta = {}) {
  if (!cwd) return null;
  const runId = meta.runId;
  if (!runId) return null;

  const undoLog = Array.isArray(meta.undoLog) ? meta.undoLog : [];
  const edits = undoLog.map((entry) => normalizeEdit(cwd, entry)).filter(Boolean);
  if (edits.length === 0) return null;

  const manifest = {
    manifestVersion: MANIFEST_VERSION,
    runId,
    sessionId: meta.sessionId || null,
    model: meta.model || null,
    startedAt: meta.startedAt || null,
    finishedAt: new Date().toISOString(),
    cwd,
    edits,
  };

  const dir = manifestDir(cwd, runId);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = manifestPath(cwd, runId) + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, manifestPath(cwd, runId));
  return manifestPath(cwd, runId);
}

function loadManifest(cwd, runId) {
  const file = manifestPath(cwd, runId);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    parsed.runId = parsed.runId || runId; // trust the directory name as the id
    parsed._source = file;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * List every run manifest under cwd, newest first.
 *
 * Run ids are random UUIDs (not time-sortable), so we order by the timestamps
 * stored inside each manifest and fall back to directory mtime.
 */
function listRunManifests(cwd) {
  const root = runsRoot(cwd);
  let dirents;
  try {
    dirents = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const manifests = [];
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;
    const manifest = loadManifest(cwd, dirent.name);
    if (!manifest) continue;
    let mtime = 0;
    try {
      mtime = fs.statSync(manifestPath(cwd, dirent.name)).mtimeMs;
    } catch {
      // best-effort ordering hint only
    }
    manifest._mtimeMs = mtime;
    manifests.push(manifest);
  }

  manifests.sort((a, b) => {
    const at = Date.parse(a.finishedAt || a.startedAt || '') || a._mtimeMs || 0;
    const bt = Date.parse(b.finishedAt || b.startedAt || '') || b._mtimeMs || 0;
    return bt - at;
  });
  return manifests;
}

function latestRunManifest(cwd) {
  return listRunManifests(cwd)[0] || null;
}

/**
 * Resolve a manifest from a user-supplied id, which may be either a run id
 * (the directory name) or a session id. Session ids resolve to the most recent
 * run of that session. A short run-id prefix is also accepted for convenience.
 */
function resolveRunManifest(cwd, idOrSessionId) {
  const id = String(idOrSessionId || '').trim();
  if (!id) return null;

  const direct = loadManifest(cwd, id);
  if (direct) return direct;

  const all = listRunManifests(cwd); // already newest-first
  const bySession = all.find((m) => m.sessionId === id);
  if (bySession) return bySession;

  const byPrefix = all.filter((m) => String(m.runId).startsWith(id));
  if (byPrefix.length === 1) return byPrefix[0];

  return null;
}

/**
 * Build a small unified-diff-style preview between the file's current content
 * and what a revert would restore. We anchor on the common prefix/suffix and
 * show the changed middle. This is intentionally simple (not a full LCS diff):
 * it is a "look before you confirm" aid, not a patch format.
 */
function previewDiff(currentText, targetText, maxLines = 40) {
  if (currentText === targetText) return '(no content change)';
  const cur = currentText.split('\n');
  const tgt = targetText.split('\n');

  let pre = 0;
  while (pre < cur.length && pre < tgt.length && cur[pre] === tgt[pre]) pre++;

  let suf = 0;
  while (suf < cur.length - pre && suf < tgt.length - pre && cur[cur.length - 1 - suf] === tgt[tgt.length - 1 - suf]) {
    suf++;
  }

  const removed = cur.slice(pre, cur.length - suf);
  const added = tgt.slice(pre, tgt.length - suf);

  const lines = [];
  lines.push('@@ around line ' + (pre + 1) + ' @@');
  for (const line of removed.slice(0, maxLines)) lines.push('-' + line);
  if (removed.length > maxLines) lines.push('… (' + (removed.length - maxLines) + ' more removed lines)');
  for (const line of added.slice(0, maxLines)) lines.push('+' + line);
  if (added.length > maxLines) lines.push('… (' + (added.length - maxLines) + ' more added lines)');
  return lines.join('\n');
}

/**
 * Plan a revert without touching the filesystem.
 *
 * We work per file, not per edit. When a run edits the same file several times,
 * the pre-run state is the FIRST edit's backup (the original content), and the
 * run's final on-disk state is the LAST edit's newSha256. Grouping this way is
 * both simpler and more robust than replaying every intermediate backup, and it
 * makes divergence detection exact: "did anything change this file after the
 * run finished?" is just `current !== lastEdit.newSha256`.
 *
 * Each action carries a status:
 *   - 'restore'       : a backup exists; restoring returns the pre-run content
 *   - 'delete'        : the run created this file (no backup); revert removes it
 *   - 'diverged'      : the file changed after this run wrote it — skipped unless forced
 *   - 'gone'          : the file no longer exists — skipped unless forced
 *   - 'missing-backup': the recorded backup is missing on disk — cannot restore
 *   - 'denied'        : the manifest path escapes the project — never touched
 */
function planRevert(cwd, manifest) {
  const cwdCheck = safety.validateCwd(cwd);
  const ctx = { cwd, cwdRealpath: cwdCheck.valid ? cwdCheck.realpath : cwd };
  const edits = Array.isArray(manifest.edits) ? manifest.edits : [];

  // Collapse to one entry per file: keep the first edit (original backup) and
  // the last edit (final hash + tool name), plus where it sits in run order.
  const groups = new Map();
  edits.forEach((edit, index) => {
    if (!edit || !edit.path) return;
    const existing = groups.get(edit.path);
    if (!existing) groups.set(edit.path, { first: edit, last: edit, lastIndex: index });
    else {
      existing.last = edit;
      existing.lastIndex = index;
    }
  });

  // Most-recently-touched file first — reverting feels like peeling the run back.
  const ordered = [...groups.values()].sort((a, b) => b.lastIndex - a.lastIndex);

  const actions = [];
  for (const group of ordered) {
    const first = group.first;
    const last = group.last;
    const action = { path: first.path, tool: last.tool, expectedSha256: last.newSha256 || null };

    // Guard against a tampered manifest pointing outside the project.
    const target = safety.confinePath(ctx, first.path);
    if (!target) {
      action.status = 'denied';
      action.detail = 'path escapes working directory';
      actions.push(action);
      continue;
    }
    action.absolutePath = target;

    const currentSha = sha256OfFile(target);
    const fileExists = currentSha !== null;
    action.currentSha256 = currentSha;
    action.diverged = fileExists && last.newSha256 && currentSha !== last.newSha256;

    const hasBackup = !!first.backupPath;
    action.backupPath = first.backupPath || null;
    const backupAbs = hasBackup ? path.resolve(cwd, first.backupPath) : null;

    if (hasBackup && (!backupAbs || !fs.existsSync(backupAbs))) {
      action.status = 'missing-backup';
      action.detail = 'backup file is missing: ' + first.backupPath;
      actions.push(action);
      continue;
    }

    // The intended revert, independent of the divergence/existence gates below.
    action.revertAction = hasBackup ? 'restore' : 'delete';

    if (!fileExists) {
      action.status = 'gone';
      action.detail = 'file no longer exists';
    } else if (action.diverged) {
      action.status = 'diverged';
      action.detail = 'changed after this run';
    } else {
      action.status = action.revertAction;
    }

    if (action.revertAction === 'restore' && fileExists) {
      const backupText = fs.readFileSync(backupAbs, 'utf8');
      const currentText = fs.readFileSync(target, 'utf8');
      action.preview = previewDiff(currentText, backupText);
    } else if (action.revertAction === 'delete') {
      action.preview = action.diverged
        ? '(file changed since creation; would be deleted with --force)'
        : '(delete file created by this run)';
    }
    actions.push(action);
  }

  return { runId: manifest.runId, sessionId: manifest.sessionId || null, actions };
}

/**
 * Apply a revert plan. Returns a results array describing what happened to each
 * file. `force` opts into overwriting diverged files and recreating gone ones.
 */
function applyRevert(cwd, plan, { force = false } = {}) {
  const results = [];
  for (const action of plan.actions) {
    const result = { path: action.path, status: action.status, applied: false };

    if (action.status === 'denied' || action.status === 'missing-backup') {
      result.detail = action.detail;
      results.push(result);
      continue;
    }

    const skipUnlessForced = action.status === 'diverged' || action.status === 'gone';
    if (skipUnlessForced && !force) {
      result.skipped = true;
      result.detail = action.detail || 'changed since the run; pass --force to override';
      results.push(result);
      continue;
    }

    const target = action.absolutePath || path.resolve(cwd, action.path);
    try {
      if (action.revertAction === 'restore') {
        const backupAbs = path.resolve(cwd, action.backupPath);
        if (!fs.existsSync(backupAbs)) {
          result.detail = 'backup file is missing: ' + action.backupPath;
          results.push(result);
          continue;
        }
        fs.writeFileSync(target, fs.readFileSync(backupAbs));
        result.applied = true;
        result.action = 'restored';
      } else {
        // Created-by-run file: reverting means removing it.
        if (fs.existsSync(target)) fs.unlinkSync(target);
        result.applied = true;
        result.action = 'deleted';
      }
    } catch (err) {
      result.detail = 'revert error: ' + err.message;
    }
    results.push(result);
  }
  return results;
}

module.exports = {
  MANIFEST_VERSION,
  runsRoot,
  manifestDir,
  manifestPath,
  writeRunManifest,
  loadManifest,
  listRunManifests,
  latestRunManifest,
  resolveRunManifest,
  planRevert,
  applyRevert,
  previewDiff,
};
