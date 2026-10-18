'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validateHost } = require('../../hosting/hosts');
const { ensurePrivateDir } = require('../private-fs');
const { scrubDeepSecrets } = require('../redaction-boundary');

function settingsPath(directory, sessionId) {
  // Session identifiers are filenames, never paths supplied by the client.
  if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/.test(sessionId))
    throw new Error('Invalid ACP session identifier.');
  return path.join(path.resolve(directory), sessionId + '.acp.json');
}

function readHost(directory, sessionId, fallback) {
  const file = settingsPath(directory, sessionId);
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > 1024) throw new Error('Invalid settings');
    const value = JSON.parse(fs.readFileSync(fd, 'utf8'));
    if (value.schemaVersion !== 1 || Object.keys(value).length !== 2) throw new Error('Invalid settings');
    return validateHost(value.bridgeHost);
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw new Error(
      'Saved ACP bridge settings are invalid or unreadable. Inspect this session’s private .acp.json file; no other bridge was selected.',
    );
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function saveHost(directory, sessionId, host) {
  validateHost(host);
  const file = settingsPath(directory, sessionId);
  ensurePrivateDir(path.dirname(file));
  // Exclusive random temporary files avoid following an existing symlink.
  // Rename replaces a destination entry without writing through that entry.
  const temp = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
  let fd;
  try {
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error('Settings must not be a symlink');
    fd = fs.openSync(
      temp,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
      0o600,
    );
    // The host is an enum, but all structured persistence still passes the
    // common boundary so future additions cannot accidentally store secrets.
    fs.writeFileSync(fd, JSON.stringify(scrubDeepSecrets({ schemaVersion: 1, bridgeHost: host })) + '\n');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temp, file);
  } catch {
    throw new Error('Could not save ACP bridge selection. The previous selection remains unchanged.');
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

/**
 * Save only when the companion file is missing or holds a different host.
 * session/set_config_option already persisted the user's choice, so a prompt
 * on an unchanged chat does no disk write at all; the chat's FIRST prompt
 * still saves, because session/new keeps the default in memory only. A
 * corrupt or symlinked file is not papered over: readHost's own error
 * propagates, exactly as it would on session/load. Returns true when a write
 * happened.
 */
function saveHostIfChanged(directory, sessionId, host) {
  validateHost(host);
  if (readHost(directory, sessionId, null) === host) return false;
  saveHost(directory, sessionId, host);
  return true;
}

module.exports = { settingsPath, readHost, saveHost, saveHostIfChanged };
