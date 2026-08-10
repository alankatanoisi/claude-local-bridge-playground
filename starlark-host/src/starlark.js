'use strict';

const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_BINARY = path.join(ROOT, 'bin', 'starlark-eval');

function extractStarlark(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('model returned no Starlark source');
  const fenced = text.match(/```(?:starlark|python)?\s*\n([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

function evaluateStarlark({ source, functionName, context, maxSteps, timeoutMs, binary = DEFAULT_BINARY }) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];

    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      const raw = Buffer.concat(stdout).toString('utf8');
      if (code !== 0) {
        reject(new Error(`Starlark evaluator exited ${code}: ${Buffer.concat(stderr).toString('utf8')}`));
        return;
      }
      try {
        const response = JSON.parse(raw);
        if (!response.ok) {
          const error = new Error(`Starlark evaluation failed: ${response.error}`);
          error.steps = response.steps;
          reject(error);
          return;
        }
        resolve(response);
      } catch (error) {
        reject(new Error(`Invalid evaluator response: ${error.message}; stdout=${raw.slice(0, 500)}`));
      }
    });

    child.stdin.end(
      JSON.stringify({
        source,
        function: functionName,
        context,
        max_steps: maxSteps,
        timeout_ms: timeoutMs,
      }),
    );
  });
}

module.exports = { DEFAULT_BINARY, evaluateStarlark, extractStarlark };
