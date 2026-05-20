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

const { execSync } = require('child_process');

const DEFAULT_SHELL_TIMEOUT = 30000; // 30 seconds
const MAX_SHELL_TIMEOUT = 120000; // 2 minutes
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024; // 10 MB
const MAX_OUTPUT_CHARS = 10000;

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

  try {
    const stdout = execSync(command, {
      cwd,
      encoding: 'utf8',
      timeout,
      maxBuffer: DEFAULT_MAX_BUFFER,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let text = stdout.toString().trim();
    if (text.length === 0) {
      text = '(command completed with no output)';
    } else if (text.length > MAX_OUTPUT_CHARS) {
      text = text.slice(0, MAX_OUTPUT_CHARS) + '\n... (output truncated at ' + MAX_OUTPUT_CHARS + ' chars)';
    }

    return { ok: true, text, command };
  } catch (err) {
    // execSync throws on non-zero exit code OR timeout.
    // On macOS err.killed can be undefined even after SIGTERM — also check signal.
    let errorText = '';
    if (err.killed || err.signal || err.code === 'ETIMEDOUT') {
      errorText = 'Command timed out after ' + timeout / 1000 + 's';
    } else {
      errorText = 'Command exited with code ' + (err.status || 'unknown');
      if (err.stdout) {
        errorText += '\nstdout:\n' + err.stdout.toString().slice(0, MAX_OUTPUT_CHARS);
      }
      if (err.stderr) {
        errorText += '\nstderr:\n' + err.stderr.toString().slice(0, MAX_OUTPUT_CHARS);
      }
    }

    return { ok: false, text: errorText, command };
  }
}

module.exports = { definition, execute };
