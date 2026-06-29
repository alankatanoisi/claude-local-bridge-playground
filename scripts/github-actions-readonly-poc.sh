#!/usr/bin/env bash
set -euo pipefail

# This script is the small "do the real work" wrapper for the GitHub Actions POC.
# The workflow YAML stays short, and the beginner-friendly comments live here.

# GITHUB_WORKSPACE is the folder GitHub Actions checked out for this job.
# If someone runs the script by hand, fall back to the folder they are already in.
WORKSPACE="${GITHUB_WORKSPACE:-$(pwd)}"

# The prompt is plain English text sent to the bridge runner.
# The workflow passes this from the manual GitHub "Run workflow" form.
PROMPT="${BRIDGE_RUNNER_POC_PROMPT:-Summarize the repository structure, current git status, and likely next safe checks. Do not edit files.}"

# max_steps limits how many model/tool turns the runner may take.
# Small values keep a proof-of-concept run cheap and easy to audit.
MAX_STEPS="${BRIDGE_RUNNER_POC_MAX_STEPS:-4}"

# The bridge runs on Alan's Mac through the VS Code extension.
# A normal GitHub-hosted runner would not have this localhost service.
BRIDGE_ROOT="${BRIDGE_RUNNER_BRIDGE_ROOT:-http://127.0.0.1:11437/}"

# Artifacts are files GitHub Actions can save after the job finishes.
# They make the run reviewable without scrolling through terminal output.
ARTIFACT_DIR="${BRIDGE_RUNNER_POC_ARTIFACT_DIR:-$WORKSPACE/.bridge-runner/actions-poc}"
JSON_OUT="$ARTIFACT_DIR/bridge-runner-readonly-poc.json"
HUMAN_LOG="$ARTIFACT_DIR/bridge-runner-readonly-poc-human-log.md"
TRACE_OUT="$ARTIFACT_DIR/bridge-runner-readonly-poc.runner.jsonl"
STDERR_LOG="$ARTIFACT_DIR/bridge-runner-readonly-poc.stderr.log"

mkdir -p "$ARTIFACT_DIR"

echo "Bridge Runner Read-Only POC"
echo "Workspace: $WORKSPACE"
echo "Artifact directory: $ARTIFACT_DIR"

# A tiny number check catches accidental values such as "four".
if ! [[ "$MAX_STEPS" =~ ^[0-9]+$ ]]; then
  echo "BRIDGE_RUNNER_POC_MAX_STEPS must be a number. Received: $MAX_STEPS" >&2
  exit 2
fi

cd "$WORKSPACE"

# This proves the workflow is operating on the expected repository checkout.
# A repository is a project folder tracked by Git.
REPO_ROOT="$(git rev-parse --show-toplevel)"
CURRENT_BRANCH="$(git branch --show-current || true)"
ORIGIN_URL="$(git remote get-url origin || true)"

if [[ "$REPO_ROOT" != "$WORKSPACE" ]]; then
  echo "Expected the Git root to equal GITHUB_WORKSPACE." >&2
  echo "Git root: $REPO_ROOT" >&2
  echo "Workspace: $WORKSPACE" >&2
  exit 2
fi

if [[ "$ORIGIN_URL" != *"claude-local-bridge-playground"* ]]; then
  echo "This POC is only intended for the playground repository." >&2
  echo "Origin URL: $ORIGIN_URL" >&2
  exit 2
fi

echo "Git branch: ${CURRENT_BRANCH:-detached}"
echo "Git origin: $ORIGIN_URL"

# The bridge has no /health endpoint. A 404 from / still proves the server answered.
# A connection error means VS Code or the bridge server is probably not running.
node - "$BRIDGE_ROOT" <<'NODE'
const http = require('node:http');
const target = new URL(process.argv[2]);

const req = http.request(
  {
    hostname: target.hostname,
    port: target.port || 80,
    path: target.pathname || '/',
    method: 'GET',
    timeout: 5000,
  },
  (res) => {
    console.log(`Bridge answered with HTTP ${res.statusCode}. That is enough for this POC health check.`);
    res.resume();
  },
);

req.on('timeout', () => {
  req.destroy(new Error('Timed out connecting to the local bridge.'));
});

req.on('error', (err) => {
  console.error('Could not connect to the local bridge at ' + target.href);
  console.error('Make sure VS Code is open and Claude Local Bridge is running on this Mac.');
  console.error('Original error: ' + err.message);
  process.exit(1);
});

req.end();
NODE

# This is the actual proof-of-concept call.
# --plan keeps the run dry: the model can propose tool actions, but the runner fabricates dry-run results.
# --tools exposes only read-only tools, so write, shell, worktree, and orchestration tools are unavailable.
# --trust-workspace is needed because GitHub Actions is non-interactive and cannot answer the trust prompt.
node bin/local-bridge-runner.js \
  --cwd "$WORKSPACE" \
  --bridge-url "$BRIDGE_ROOT" \
  --plan \
  --tools list_files,read_file,search_text,glob,git_status \
  --output-format json \
  --trace-level summary \
  --trace-path "$TRACE_OUT" \
  --human-log "$HUMAN_LOG" \
  --trust-workspace \
  --max-steps "$MAX_STEPS" \
  "$PROMPT" >"$JSON_OUT" 2>"$STDERR_LOG"

echo "Runner JSON: $JSON_OUT"
echo "Human log: $HUMAN_LOG"
echo "Runner trace: $TRACE_OUT"
echo "Runner stderr: $STDERR_LOG"

# GITHUB_STEP_SUMMARY is a special GitHub Actions file.
# Text appended here appears in the run summary page in the browser.
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "## Bridge Runner Read-Only POC"
    echo ""
    echo "- Result: completed"
    echo "- Workspace: \`$WORKSPACE\`"
    echo "- Branch: \`${CURRENT_BRANCH:-detached}\`"
    echo "- Max steps: \`$MAX_STEPS\`"
    echo "- Artifacts: runner JSON, human log, trace"
  } >>"$GITHUB_STEP_SUMMARY"
fi
