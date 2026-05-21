'use strict';

/**
 * bash tool — Run a bounded, sandboxed shell command.
 *
 * Safety bounds:
 *   - Runs inside the project cwd
 *   - Timeout (default 30s, max 120s from --shell-timeout)
 *   - Output truncated (default 10KB, enforced via maxBuffer)
 *   - Does NOT parse or restrict commands — the model is trusted
 *     to stay within bounds, and the system prompt discourages
 *     destructive commands
 *   - Only available when --allow-shell CLI flag is set
 */

const { spawnSync } = require('child_process');
const safety = require('../safety');

const DEFAULT_SHELL_TIMEOUT = 30000;
const MAX_SHELL_TIMEOUT = 120000;
const DEFAULT_MAX_BUFFER = 1024 * 1024;
const MAX_OUTPUT_CHARS = 100000;

function definition() {
  return {
    name: 'bash',
    description:
      'Run a shell command inside the project directory. ' +
      'The command is limited by timeout and output size. ' +
      'Do NOT use this for destructive commands (rm -rf, git reset --hard, etc). ' +
      'Prefer read-only commands and project tooling (npm test, npx, node, ls, etc).',
    input_schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to run inside the project directory',
        },
      },
      required: ['command'],
    },
  };
}

function execute(args, ctx) {
  const cwd = ctx.cwd || process.cwd();
  const command = args.command;

  // Use the configured timeout, clamped to a safe maximum
  const timeout = Math.min(ctx.shellTimeout || DEFAULT_SHELL_TIMEOUT, MAX_SHELL_TIMEOUT);

  // Build environment: filtered + optional network block
  const env = safety.buildSafeEnv();
  if (ctx.noNetwork) {
    env.http_proxy = '127.0.0.1:1';
    env.https_proxy = '127.0.0.1:1';
    env.HTTP_PROXY = '127.0.0.1:1';
    env.HTTPS_PROXY = '127.0.0.1:1';
    env.no_proxy = 'localhost,127.0.0.1';
    env.NO_PROXY = 'localhost,127.0.0.1';
  }

  try {
    // Use spawnSync with shell to capture stdout and stderr separately
    const result = spawnSync(command, [], {
      cwd,
      encoding: 'utf8',
      timeout,
      maxBuffer: DEFAULT_MAX_BUFFER,
      env,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (result.error) {
      // spawnSync failed to start entirely (e.g., command binary not found, ETIMEDOUT)
      if (result.error.code === 'ETIMEDOUT' || result.signal) {
        return { ok: false, text: 'Command timed out after ' + timeout / 1000 + 's', command };
      }
      return { ok: false, text: 'Command error: ' + result.error.message, command };
    }

    const stdout = (result.stdout || '').trim();
    const stderr = (result.stderr || '').trim();

    // Check signal first — a killed process may have status: null
    if (result.signal) {
      return { ok: false, text: 'Command killed by signal ' + result.signal, command };
    }

    if (result.status !== 0) {
      let errorText = 'Command exited with code ' + result.status;
      if (stdout) errorText += '\nstdout:\n' + stdout.slice(0, MAX_OUTPUT_CHARS);
      if (stderr) errorText += '\nstderr:\n' + stderr.slice(0, MAX_OUTPUT_CHARS);
      return { ok: false, text: errorText, command };
    }

    let text = stdout;
    if (stderr) {
      text += (text ? '\n' : '') + '[stderr] ' + stderr;
    }
    if (text.length === 0) {
      text = '(command completed with no output)';
    } else if (text.length > MAX_OUTPUT_CHARS) {
      text = text.slice(0, MAX_OUTPUT_CHARS) + '\n... (output truncated at ' + MAX_OUTPUT_CHARS + ' chars)';
    }

    return { ok: true, text, command };
  } catch (err) {
    return { ok: false, text: 'Command error: ' + err.message, command };
  }
}

module.exports = { definition, execute };
