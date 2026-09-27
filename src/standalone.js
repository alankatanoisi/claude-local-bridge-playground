'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { configureStandalone } = require('./host-runtime');

// A private folder is the standalone equivalent of extension secret storage.
// It contains local door codes only. Claude OAuth credentials remain in the
// existing Keychain / Claude login location and are never copied here.
function privateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('Private state directory must not be a symlink');
  fs.chmodSync(directory, 0o700);
}

function readPrivateJson(file) {
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Private file must not be a symlink');
  if (process.platform !== 'win32' && fs.statSync(file).mode & 0o077) {
    throw new Error(`Private file permissions must be 600: ${path.basename(file)}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writePrivateJson(file, value) {
  // Rename replaces the directory entry rather than following a file symlink.
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, file);
}

function validateConfig(config) {
  const allowed = new Set(['port', 'requireCallerAuth', 'defaultModel', 'logTimeZone']);
  for (const key of Object.keys(config)) {
    if (!allowed.has(key)) throw new Error(`Unsupported standalone setting: ${key}`);
  }
  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) {
    throw new Error('port must be an integer between 1024 and 65535');
  }
  if (config.requireCallerAuth !== undefined && typeof config.requireCallerAuth !== 'boolean') {
    throw new Error('requireCallerAuth must be true or false');
  }
  for (const key of ['defaultModel', 'logTimeZone']) {
    if (config[key] !== undefined && (typeof config[key] !== 'string' || !config[key].trim())) {
      throw new Error(`${key} must be a nonempty string`);
    }
  }
  return { ...config, strictPort: true, logRequests: false, traceLevel: 'off' };
}

async function startStandalone({ configFile, stateDir }) {
  const settings = validateConfig(readPrivateJson(configFile));
  privateDirectory(stateDir);
  configureStandalone(settings);
  const { createContext } = require('./context');
  const { initializeCallerAuth } = require('./caller-auth');
  const { startServer, stopServer } = require('./server');
  const { log } = require('./utils');
  const ctx = createContext();
  ctx.outputChannel = { appendLine: (line) => process.stdout.write(line + '\n') };

  const secretsFile = path.join(stateDir, 'caller-secrets.json');
  const secrets = fs.existsSync(secretsFile) ? readPrivateJson(secretsFile) : {};
  await initializeCallerAuth(ctx, {
    secrets: {
      get: async (key) => secrets[key],
      store: async (key, value) => {
        secrets[key] = value;
        writePrivateJson(secretsFile, secrets);
      },
    },
  });
  await startServer(ctx);
  if (!ctx.server?.listening) throw new Error('Bridge failed to acquire its configured port');
  // A failed duplicate launch must not replace the running instance's door code.
  try {
    writePrivateJson(path.join(stateDir, 'debug-token.json'), { token: ctx.sensitiveEndpointToken });
  } catch (error) {
    // Binding succeeded but initialization did not. Do not leave a misleading
    // live server behind after reporting that startup failed.
    ctx.server.closeAllConnections();
    await stopServer(ctx);
    throw error;
  }
  log(ctx, `Standalone bridge ready at http://127.0.0.1:${settings.port}/v1/messages`);

  // Stop accepting new work, give active requests a short grace period, then
  // close remaining connections. The process cannot linger with stale sockets.
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => {
      ctx.server?.closeAllConnections();
      process.exit(0);
    }, 4000);
    deadline.unref();
    await stopServer(ctx);
    clearTimeout(deadline);
    process.exit(0);
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  return ctx;
}

function parseArguments(args) {
  const result = { stateDir: path.join(os.homedir(), '.bridge-runner', 'standalone') };
  for (let i = 0; i < args.length; i += 2) {
    const key = { '--config': 'configFile', '--state-dir': 'stateDir' }[args[i]];
    if (!key || !args[i + 1]) throw new Error('Usage: local-bridge-standalone --config FILE [--state-dir DIRECTORY]');
    result[key] = path.resolve(args[i + 1]);
  }
  if (!result.configFile) throw new Error('--config FILE is required');
  return result;
}

module.exports = {
  startStandalone,
  parseArguments,
  validateConfig,
  privateDirectory,
  readPrivateJson,
  writePrivateJson,
};
