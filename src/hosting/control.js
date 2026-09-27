'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { privateDirectory, readPrivateJson, writePrivateJson } = require('../standalone');

const MODES = Object.freeze({ desktop: 11447, browser: 11457, standalone: 11467 });
const WEB_PORT = 18080;
const ROOT = path.join(os.homedir(), 'Library', 'Application Support', 'Claude Bridge Lab');
const LAUNCHERS = path.join(os.homedir(), 'Applications', 'Claude Bridge Lab');
const LABEL_PREFIX = 'org.alan.claude-bridge-lab.';
const domain = () => `gui/${process.getuid()}`;
const label = (mode) => LABEL_PREFIX + mode;
const manifestPath = () => path.join(ROOT, 'installation.json');

// Every subprocess receives separate arguments. Paths with spaces or shell
// punctuation stay ordinary text; we never build an executable shell string.
function run(program, args, options = {}) {
  return execFileSync(program, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
}
function job(mode) {
  try {
    const text = run('/bin/launchctl', ['print', `${domain()}/${label(mode)}`]);
    return { loaded: true, pid: Number(text.match(/\n\s*pid = (\d+)/)?.[1]) || null };
  } catch {
    return { loaded: false, pid: null };
  }
}
function assertMode(mode) {
  if (!Object.hasOwn(MODES, mode)) throw new Error('Choose desktop, browser, or standalone');
}
function installation() {
  if (!fs.existsSync(manifestPath())) throw new Error('Run install first on this Mac.');
  return readPrivateJson(manifestPath());
}
function findProgram(name, candidates) {
  for (const candidate of candidates) if (candidate && fs.existsSync(candidate)) return candidate;
  throw new Error(`${name} is not installed. See the installation guide.`);
}
function xml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c],
  );
}
function plist(mode, args, logFile, workingDirectory) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
<key>Label</key><string>${label(mode)}</string>
<key>ProgramArguments</key><array>${args.map((arg) => `<string>${xml(arg)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${xml(workingDirectory)}</string>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key>${mode === 'desktop' ? '<false/>' : '<dict><key>SuccessfulExit</key><false/></dict>'}
<key>ThrottleInterval</key><integer>10</integer>
<key>Umask</key><integer>63</integer>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(path.dirname(process.execPath))}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
<key>StandardOutPath</key><string>${xml(logFile)}</string><key>StandardErrorPath</key><string>${xml(logFile)}</string>
</dict></plist>\n`;
}
async function freePort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () =>
      reject(new Error(`Port ${port} is already occupied. No unrelated process was stopped.`)),
    );
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function probe(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost' },
      signal: AbortSignal.timeout(1500),
    });
    return response.status === 204;
  } catch {
    return false;
  }
}
function ownsListener(mode) {
  const rootPid = job(mode).pid;
  if (!rootPid) return false;
  const rows = run('/bin/ps', ['-axo', 'pid=,ppid='])
    .trim()
    .split('\n')
    .map((row) => row.trim().split(/\s+/).map(Number));
  const owned = new Set([rootPid]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const [pid, parent] of rows)
      if (owned.has(parent) && !owned.has(pid)) {
        owned.add(pid);
        changed = true;
      }
  }
  try {
    const pids = run('/usr/sbin/lsof', ['-nP', `-iTCP:${MODES[mode]}`, '-sTCP:LISTEN', '-Fp'])
      .split('\n')
      .filter((row) => /^p\d+$/.test(row))
      .map((row) => Number(row.slice(1)));
    return pids.length > 0 && pids.every((pid) => owned.has(pid));
  } catch {
    return false;
  }
}

async function stop(mode) {
  assertMode(mode);
  if (!job(mode).loaded) return;
  // launchd owns this exact user job and its process group. No pkill, guessed
  // process IDs, or stopping the user's ordinary VS Code instance.
  run('/bin/launchctl', ['bootout', `${domain()}/${label(mode)}`]);
  for (let i = 0; i < 30 && job(mode).loaded; i++) await sleep(200);
  if (job(mode).loaded) throw new Error(`Could not stop managed ${mode} job`);
  console.log(`Stopped dedicated ${mode}.`);
}
async function stopAll() {
  for (const mode of Object.keys(MODES)) await stop(mode);
}

async function start(mode, { open = true } = {}) {
  assertMode(mode);
  installation();
  for (const other of Object.keys(MODES)) if (other !== mode) await stop(other);
  if (!job(mode).pid) {
    // Switching is serialized by the CLI lock. We stop only our own jobs.
    if (job(mode).loaded) await stop(mode);
    await freePort(MODES[mode]);
    if (mode === 'browser') await freePort(WEB_PORT);
    run('/bin/launchctl', ['bootstrap', domain(), path.join(ROOT, 'jobs', mode + '.plist')]);
  }
  if (mode === 'browser') {
    let editorReady = false;
    for (let i = 0; i < 100; i++) {
      try {
        const response = await fetch(`http://127.0.0.1:${WEB_PORT}/healthz`, { signal: AbortSignal.timeout(1000) });
        if (response.status === 200 && job(mode).pid) {
          editorReady = true;
          break;
        }
      } catch {
        await sleep(200);
      }
    }
    if (!editorReady) throw new Error('Browser editor did not become ready; inspect its private log.');
    console.log(`Browser editor: http://127.0.0.1:${WEB_PORT}`);
    if (open) {
      // Copy the generated local editor password without printing it in logs.
      const password = readPrivateJson(path.join(ROOT, 'browser-password.json')).password;
      run('/usr/bin/pbcopy', [], { input: password, stdio: ['pipe', 'pipe', 'pipe'] });
      run('/usr/bin/open', [`http://127.0.0.1:${WEB_PORT}/`]);
      console.log('Local editor password copied. Paste it into the browser login if prompted.');
    }
    console.log('Keep the editor tab open to keep its bridge extension active.');
  }
  for (let i = 0; i < (mode === 'browser' ? 10 : 150); i++) {
    if ((await probe(MODES[mode])) && ownsListener(mode)) {
      console.log(`Dedicated ${mode} bridge is listening: http://127.0.0.1:${MODES[mode]}/v1/messages`);
      console.log('Listening confirms startup only. Run the Test launcher to check a real model response.');
      return;
    }
    await sleep(200);
  }
  if (mode === 'browser' && job(mode).pid) {
    console.log('Editor started; bridge is pending browser login/extension activation.');
    return;
  }
  throw new Error(`${mode} did not become ready. See private logs in ${path.join(ROOT, 'logs')}`);
}

async function status() {
  for (const [mode, port] of Object.entries(MODES)) {
    const state = job(mode);
    const listening = await probe(port);
    console.log(
      `${mode.padEnd(11)} job=${state.pid ? 'running' : state.loaded ? 'loaded, not running' : 'stopped'} bridge=${listening ? (ownsListener(mode) ? 'listening (owned)' : 'unowned listener') : 'not listening'} http://127.0.0.1:${port}/v1/messages`,
    );
  }
  console.log('A listener without its managed job may belong to another process; do not assume ownership.');
}

async function smokeTest(mode) {
  assertMode(mode);
  if (!ownsListener(mode))
    throw new Error(`Dedicated ${mode} has no owned bridge listener. Start it and open its editor if needed.`);
  const response = await fetch(`http://127.0.0.1:${MODES[mode]}/v1/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: require('../models').DEFAULT_MODEL,
      max_tokens: 32,
      messages: [{ role: 'user', content: 'Reply with exactly BRIDGE_OK' }],
    }),
    signal: AbortSignal.timeout(90000),
  });
  const data = await response.json();
  const answer = data.content
    ?.filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('');
  if (response.status !== 200 || !answer?.includes('BRIDGE_OK')) {
    // Return only the error classification, never a provider payload or token.
    throw new Error(`Live test failed: HTTP ${response.status}, type=${data.error?.type || 'unexpected_response'}`);
  }
  console.log(`PASS: ${mode} returned a real model response (BRIDGE_OK).`);
}

function shellQuote(value) {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}
async function install(sourceRoot) {
  if (process.platform !== 'darwin') throw new Error('These installers currently target macOS.');
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 or newer is required.');
  const source = fs.realpathSync(sourceRoot);
  if (JSON.parse(fs.readFileSync(path.join(source, 'package.json'))).name !== 'claude-local-bridge')
    throw new Error('Wrong source folder');
  const desktopApp = '/Applications/Visual Studio Code.app';
  const desktop = findProgram('VS Code', [path.join(desktopApp, 'Contents/MacOS/Code')]);
  const desktopCli = path.join(desktopApp, 'Contents/Resources/app/bin/code');
  const codeServer = findProgram('code-server', ['/opt/homebrew/bin/code-server', '/usr/local/bin/code-server']);
  privateDirectory(ROOT);
  await stopAll();
  const release = path.join(
    ROOT,
    'releases',
    new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex'),
  );
  privateDirectory(release);
  // Install a snapshot: editing the research checkout cannot change the running
  // bridge halfway through a request. Re-run install to adopt later changes.
  for (const entry of ['src', 'bin', 'package.json']) {
    fs.cpSync(path.join(source, entry), path.join(release, entry), {
      recursive: true,
      filter: (file) => !file.includes('/docs/artifacts/'),
    });
  }
  privateDirectory(path.join(release, 'docs'));
  for (const entry of fs.readdirSync(path.join(source, 'docs')).filter((name) => name.startsWith('bridge-hosting-'))) {
    fs.copyFileSync(path.join(source, 'docs', entry), path.join(release, 'docs', entry));
  }
  const workspace = path.join(ROOT, 'workspace');
  for (const dir of ['jobs', 'logs', 'standalone', 'workspace', 'desktop/User', 'browser/User'])
    privateDirectory(path.join(ROOT, dir));
  fs.writeFileSync(
    path.join(workspace, 'README.txt'),
    'Dedicated Claude Bridge host. No project needs to be open here. Use your normal editor separately.\n',
  );
  const passwordFile = path.join(ROOT, 'browser-password.json');
  if (!fs.existsSync(passwordFile))
    writePrivateJson(passwordFile, { password: crypto.randomBytes(24).toString('hex') });
  const password = readPrivateJson(passwordFile).password;
  const codeServerConfig = path.join(ROOT, 'browser-config.yaml');
  fs.writeFileSync(
    codeServerConfig,
    `bind-addr: 127.0.0.1:${WEB_PORT}\nauth: password\npassword: ${password}\ncert: false\n`,
    { mode: 0o600 },
  );
  fs.chmodSync(codeServerConfig, 0o600);
  writePrivateJson(path.join(ROOT, 'standalone/config.json'), { port: MODES.standalone, requireCallerAuth: false });

  const extensionDirs = {};
  // Build a minimal VSIX (the ZIP format VS Code uses for extensions). Only
  // the bridge manifest and source are included, never local state or logs.
  const stage = path.join(release, 'package');
  privateDirectory(path.join(stage, 'extension'));
  for (const entry of ['src', 'package.json'])
    fs.cpSync(path.join(release, entry), path.join(stage, 'extension', entry), { recursive: true });
  fs.writeFileSync(
    path.join(stage, '[Content_Types].xml'),
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="js" ContentType="application/javascript"/><Default Extension="vsixmanifest" ContentType="text/xml"/></Types>',
  );
  fs.writeFileSync(
    path.join(stage, 'extension.vsixmanifest'),
    '<?xml version="1.0"?><PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"><Metadata><Identity Language="en-US" Id="claude-local-bridge" Version="1.0.0" Publisher="alankatanoisi"/><DisplayName>Claude Local Bridge</DisplayName><Description xml:space="preserve">Dedicated local Claude bridge</Description><Tags/><Categories>Other</Categories><GalleryFlags>Public</GalleryFlags><Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.85.0"/></Properties></Metadata><Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/><Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/></Assets></PackageManifest>',
  );
  const vsix = path.join(release, 'claude-local-bridge.vsix');
  run('/usr/bin/zip', ['-qr', vsix, '.'], { cwd: stage });
  for (const mode of ['desktop', 'browser']) {
    const userData = path.join(ROOT, mode);
    const extensions = path.join(release, mode + '-extensions');
    extensionDirs[mode] = extensions;
    privateDirectory(extensions);
    const settings = {
      'claudeLocalBridge.port': MODES[mode],
      'claudeLocalBridge.strictPort': true,
      'claudeLocalBridge.captureProxyEnabled': false,
      'claudeLocalBridge.logRequests': false,
      'claudeLocalBridge.requireCallerAuth': false,
      'claudeLocalBridge.traceLevel': 'off',
      'telemetry.telemetryLevel': 'off',
      'update.mode': 'none',
      'extensions.autoUpdate': false,
      'extensions.autoCheckUpdates': false,
      'workbench.startupEditor': 'none',
      'window.title': `Claude Bridge — ${mode}`,
      'files.hotExit': 'off',
    };
    // These are dedicated profiles owned by this installer, not the user's editor.
    writePrivateJson(path.join(userData, 'User/settings.json'), settings);
    console.log(`Installing bridge extension for ${mode}...`);
    const args = ['--user-data-dir', userData, '--extensions-dir', extensions, '--install-extension', vsix, '--force'];
    if (mode === 'browser') args.unshift('--config', codeServerConfig);
    run(mode === 'desktop' ? desktopCli : codeServer, args, { timeout: 120000 });
  }
  const args = {
    desktop: [
      desktop,
      '--user-data-dir',
      path.join(ROOT, 'desktop'),
      '--extensions-dir',
      extensionDirs.desktop,
      '--new-window',
      '--skip-welcome',
      '--skip-release-notes',
    ],
    browser: [
      codeServer,
      '--config',
      codeServerConfig,
      '--user-data-dir',
      path.join(ROOT, 'browser'),
      '--extensions-dir',
      extensionDirs.browser,
      '--disable-telemetry',
      '--disable-update-check',
      '--disable-proxy',
      '--ignore-last-opened',
    ],
    standalone: [
      process.execPath,
      path.join(release, 'bin/local-bridge-standalone.js'),
      '--config',
      path.join(ROOT, 'standalone/config.json'),
      '--state-dir',
      path.join(ROOT, 'standalone'),
    ],
  };
  for (const mode of Object.keys(MODES)) {
    const logFile = path.join(ROOT, 'logs', mode + '.log');
    if (!fs.existsSync(logFile)) fs.writeFileSync(logFile, '', { mode: 0o600 });
    fs.chmodSync(logFile, 0o600);
    fs.writeFileSync(path.join(ROOT, 'jobs', mode + '.plist'), plist(mode, args[mode], logFile, workspace), {
      mode: 0o600,
    });
  }
  writePrivateJson(manifestPath(), {
    installedAt: new Date().toISOString(),
    source,
    release,
    workspace,
    node: process.execPath,
    extensionDirs,
  });
  privateDirectory(LAUNCHERS);
  const controller = path.join(release, 'bin/bridge-hosts.js');
  const entries = {
    '1 Start Desktop': ['start', 'desktop'],
    '2 Start Browser': ['start', 'browser'],
    '3 Start Standalone': ['start', 'standalone'],
    '4 Status': ['status'],
    '5 Stop Dedicated Bridges': ['stop', 'all'],
    '6 Test Desktop': ['test', 'desktop'],
    '7 Test Browser': ['test', 'browser'],
    '8 Test Standalone': ['test', 'standalone'],
  };
  for (const [name, command] of Object.entries(entries)) {
    const content = `#!/bin/zsh\n# Double-click in Finder. Terminal runs the installed controller for you.\n${[process.execPath, controller, ...command].map(shellQuote).join(' ')}\nresult=$?\nprintf '\\nPress Return to close this window.\\n'\nread -r reply\nexit "$result"\n`;
    fs.writeFileSync(path.join(LAUNCHERS, name + '.command'), content, { mode: 0o700 });
    fs.chmodSync(path.join(LAUNCHERS, name + '.command'), 0o700);
  }
  const guide = path.join(release, 'docs/bridge-hosting-guide.html');
  fs.writeFileSync(path.join(LAUNCHERS, '9 Open Guide.command'), `#!/bin/zsh\n/usr/bin/open ${shellQuote(guide)}\n`, {
    mode: 0o700,
  });
  console.log(`Installed all three modes. Launchers: ${LAUNCHERS}`);
  console.log('No automatic login startup was enabled. Start a mode when you want it.');
}

async function withLock(action, port = 18081) {
  // The operating system owns this short-lived loopback lock. Unlike a lock
  // file, it disappears automatically when the controller exits or crashes.
  // A second controller cannot acquire the same port, even during recovery.
  const lock = net.createServer((socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    lock.once('error', () =>
      reject(new Error(`Another bridge control operation is active, or control port ${port} is occupied.`)),
    );
    lock.listen(port, '127.0.0.1', resolve);
  });
  try {
    await action();
  } finally {
    await new Promise((resolve) => lock.close(resolve));
  }
}

module.exports = {
  MODES,
  WEB_PORT,
  ROOT,
  LAUNCHERS,
  install,
  start,
  stop,
  stopAll,
  status,
  smokeTest,
  withLock,
  freePort,
  plist,
  job,
  installation,
  ownsListener,
};
