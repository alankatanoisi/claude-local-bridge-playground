'use strict';

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const mdPath = path.join(projectRoot, 'docs', 'project-summary.md');
const htmlPath = path.join(projectRoot, 'docs', 'project-summary.html');

let mdContent = fs.readFileSync(mdPath, 'utf8');

// Helper to encode image to base64
function getBase64Image(relPath) {
  const fullPath = path.join(projectRoot, 'docs', relPath);
  if (fs.existsSync(fullPath)) {
    const buf = fs.readFileSync(fullPath);
    return `data:image/png;base64,${buf.toString('base64')}`;
  }
  return relPath;
}

const images = {
  'diagrams/high-level-architecture.drawio.png': getBase64Image('diagrams/high-level-architecture.drawio.png'),
  'diagrams/processing-pipeline.drawio.png': getBase64Image('diagrams/processing-pipeline.drawio.png'),
  'diagrams/component-relationships.drawio.png': getBase64Image('diagrams/component-relationships.drawio.png'),
  'diagrams/deployment-infrastructure.drawio.png': getBase64Image('diagrams/deployment-infrastructure.drawio.png'),
};

const htmlDocument = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Claude Local Bridge Playground — Executive Project Summary</title>
  <style>
    :root {
      --primary: #4f46e5;
      --primary-dark: #4338ca;
      --primary-light: #eef2ff;
      --text-main: #0f172a;
      --text-muted: #475569;
      --bg-main: #f8fafc;
      --bg-card: #ffffff;
      --border: #e2e8f0;
      --border-dark: #cbd5e1;
      --code-bg: #0f172a;
      --code-text: #f8fafc;
      --accent-teal: #0d9488;
      --accent-amber: #d97706;
      --accent-emerald: #16a34a;
      --sidebar-width: 280px;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: var(--text-main);
      background-color: var(--bg-main);
      line-height: 1.6;
      display: flex;
      min-height: 100vh;
    }

    /* Sidebar Navigation */
    .sidebar {
      width: var(--sidebar-width);
      background: #ffffff;
      border-right: 1px solid var(--border);
      position: fixed;
      top: 0;
      bottom: 0;
      left: 0;
      overflow-y: auto;
      padding: 2rem 1.25rem;
      z-index: 10;
    }

    .sidebar-brand {
      font-size: 0.95rem;
      font-weight: 700;
      color: var(--primary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 1.5rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .sidebar-brand::before {
      content: "";
      display: inline-block;
      width: 10px;
      height: 10px;
      background-color: var(--primary);
      border-radius: 50%;
    }

    .toc-list {
      list-style: none;
    }

    .toc-item {
      margin-bottom: 0.4rem;
    }

    .toc-link {
      display: block;
      color: var(--text-muted);
      text-decoration: none;
      font-size: 0.875rem;
      padding: 0.35rem 0.6rem;
      border-radius: 6px;
      transition: all 0.15s ease;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .toc-link:hover {
      background: var(--primary-light);
      color: var(--primary-dark);
      font-weight: 500;
    }

    /* Main Content Area */
    .main-wrapper {
      margin-left: var(--sidebar-width);
      flex: 1;
      max-width: calc(100% - var(--sidebar-width));
      padding: 2.5rem 3.5rem;
    }

    .container {
      max-width: 1000px;
      margin: 0 auto;
    }

    /* Header & Meta */
    .doc-header {
      background: linear-gradient(135deg, #4f46e5 0%, #3730a3 100%);
      color: #ffffff;
      padding: 2.5rem 3rem;
      border-radius: 16px;
      margin-bottom: 2.5rem;
      box-shadow: 0 10px 25px -5px rgba(79, 70, 229, 0.25);
    }

    .doc-title {
      font-size: 2.1rem;
      font-weight: 800;
      letter-spacing: -0.025em;
      margin-bottom: 0.75rem;
      line-height: 1.25;
    }

    .doc-subtitle {
      font-size: 1.05rem;
      opacity: 0.9;
      margin-bottom: 1.5rem;
      font-weight: 400;
    }

    .doc-meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 1rem;
      padding-top: 1.25rem;
      border-top: 1px solid rgba(255, 255, 255, 0.2);
    }

    .meta-item {
      display: flex;
      flex-direction: column;
    }

    .meta-label {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      opacity: 0.75;
      font-weight: 600;
    }

    .meta-value {
      font-size: 0.95rem;
      font-weight: 600;
      margin-top: 0.15rem;
    }

    /* Content Cards / Typography */
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 2rem 2.5rem;
      margin-bottom: 2rem;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    }

    h2 {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--text-main);
      letter-spacing: -0.02em;
      margin-top: 0.5rem;
      margin-bottom: 1.25rem;
      padding-bottom: 0.6rem;
      border-bottom: 2px solid var(--primary-light);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    h3 {
      font-size: 1.15rem;
      font-weight: 600;
      color: #1e293b;
      margin-top: 1.75rem;
      margin-bottom: 0.75rem;
    }

    p {
      margin-bottom: 1.1rem;
      font-size: 0.975rem;
      color: #334155;
    }

    ul, ol {
      margin-bottom: 1.25rem;
      padding-left: 1.5rem;
      font-size: 0.975rem;
      color: #334155;
    }

    li {
      margin-bottom: 0.4rem;
    }

    /* Code & Pre */
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.875em;
      background: #f1f5f9;
      color: #0f172a;
      padding: 0.2em 0.4em;
      border-radius: 4px;
      border: 1px solid #e2e8f0;
    }

    pre {
      background: var(--code-bg);
      color: var(--code-text);
      padding: 1.25rem 1.5rem;
      border-radius: 8px;
      overflow-x: auto;
      margin-bottom: 1.5rem;
      font-size: 0.875rem;
      line-height: 1.5;
    }

    pre code {
      background: transparent;
      color: inherit;
      padding: 0;
      border: none;
    }

    /* Tables */
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 1.5rem;
      font-size: 0.9rem;
    }

    th {
      background: #f8fafc;
      color: #334155;
      font-weight: 600;
      text-align: left;
      padding: 0.75rem 1rem;
      border-bottom: 2px solid var(--border);
    }

    td {
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--border);
      color: #334155;
    }

    tr:nth-child(even) td {
      background: #fafafa;
    }

    /* Diagrams */
    .diagram-container {
      margin: 1.5rem 0 2rem 0;
      background: #ffffff;
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 1rem;
      text-align: center;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03);
    }

    .diagram-img {
      max-width: 100%;
      height: auto;
      border-radius: 6px;
      display: block;
      margin: 0 auto;
    }

    .diagram-caption {
      font-size: 0.825rem;
      color: var(--text-muted);
      margin-top: 0.75rem;
      font-style: italic;
    }

    /* Callouts & Badges */
    .badge {
      display: inline-block;
      padding: 0.2em 0.6em;
      font-size: 0.75rem;
      font-weight: 600;
      border-radius: 9999px;
      text-transform: uppercase;
    }

    .badge-primary { background: var(--primary-light); color: var(--primary-dark); }
    .badge-success { background: #dcfce7; color: #15803d; }
    .badge-warning { background: #fef3c7; color: #b45309; }

    /* Footer */
    footer {
      text-align: center;
      padding: 2rem 0;
      color: var(--text-muted);
      font-size: 0.85rem;
      border-top: 1px solid var(--border);
      margin-top: 3rem;
    }

    @media print {
      .sidebar { display: none; }
      .main-wrapper { margin-left: 0; max-width: 100%; padding: 0; }
      .card { border: none; box-shadow: none; padding: 0; margin-bottom: 2rem; }
    }
  </style>
</head>
<body>

  <!-- Sidebar Table of Contents -->
  <aside class="sidebar">
    <div class="sidebar-brand">Navigation</div>
    <ul class="toc-list">
      <li class="toc-item"><a href="#sec-1" class="toc-link">1. Executive Summary</a></li>
      <li class="toc-item"><a href="#sec-2" class="toc-link">2. Architecture Overview</a></li>
      <li class="toc-item"><a href="#sec-3" class="toc-link">3. Processing Pipeline</a></li>
      <li class="toc-item"><a href="#sec-4" class="toc-link">4. Core Components</a></li>
      <li class="toc-item"><a href="#sec-5" class="toc-link">5. API Contracts &amp; Schemas</a></li>
      <li class="toc-item"><a href="#sec-6" class="toc-link">6. Infrastructure &amp; Deployment</a></li>
      <li class="toc-item"><a href="#sec-7" class="toc-link">7. Extension Patterns</a></li>
      <li class="toc-item"><a href="#sec-8" class="toc-link">8. Rules &amp; Anti-Patterns</a></li>
      <li class="toc-item"><a href="#sec-9" class="toc-link">9. Dependencies</a></li>
      <li class="toc-item"><a href="#sec-10" class="toc-link">10. Code Structure</a></li>
      <li class="toc-item"><a href="#sec-11" class="toc-link">11. Experiment Record</a></li>
    </ul>
  </aside>

  <!-- Main Content Area -->
  <div class="main-wrapper">
    <div class="container">

      <!-- Document Header Banner -->
      <header class="doc-header">
        <h1 class="doc-title">Claude Local Bridge Playground</h1>
        <div class="doc-subtitle">Executive Project Summary &amp; Architecture Reference</div>
        <div class="doc-meta-grid">
          <div class="meta-item">
            <span class="meta-label">Date</span>
            <span class="meta-value">2026-08-05</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Version</span>
            <span class="meta-value">1.0</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Audience</span>
            <span class="meta-value">Engineering &amp; Architecture</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Runtime Dependencies</span>
            <span class="meta-value">Zero (0)</span>
          </div>
        </div>
      </header>

      <!-- Section 1 -->
      <section id="sec-1" class="card">
        <h2>1. Executive Summary</h2>
        <p><strong>Claude Local Bridge Playground</strong> is a two-layer personal research project: a <strong>VS Code extension</strong> ("Claude Local Bridge") that exposes Claude Code OAuth credentials as a local Anthropic Messages API on <code>http://localhost:11437</code>, and an experimental <strong>local coding-agent runner</strong> ("cc bridge runner") that uses that bridge as its model transport.</p>
        <p>The runner implements a complete agent loop — <code>prompt → model → tool_use → permission gate → local tool execution → tool_result → repeat</code> — with conservative safety defaults, durable session artifacts, and a command-line UX. The project ships with <strong>zero runtime dependencies</strong> (~24,500 lines of JavaScript across <code>src/</code> and <code>bin/</code>), <strong>117 test files (~480 tests)</strong>, a multi-stage Dockerfile, and a self-hosted GitHub Actions proof-of-concept workflow.</p>
        <p>It is active at <code>alankatanoisi/claude-local-bridge-playground</code> on branch <code>main</code>; the canonical <code>claude-local-bridge</code> repo is archived and reference-only.</p>
      </section>

      <!-- Section 2 -->
      <section id="sec-2" class="card">
        <h2>2. Architecture Overview</h2>
        <p>The repository contains <strong>two distinct products</strong> that must not be confused:</p>
        <table>
          <thead>
            <tr>
              <th>Layer</th>
              <th>What it is</th>
              <th>Where it lives</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Bridge</strong></td>
              <td>VS Code extension exposing Claude Code OAuth credentials as a local Anthropic Messages endpoint</td>
              <td><code>src/server.js</code>, <code>src/proxy.js</code>, <code>src/credentials.js</code>, <code>src/interceptors/**</code></td>
            </tr>
            <tr>
              <td><strong>Runner</strong></td>
              <td>Experimental local coding-agent loop on top of that endpoint (the active product surface)</td>
              <td><code>src/runner/**</code>, <code>bin/local-bridge-runner.js</code></td>
            </tr>
          </tbody>
        </table>

        <div class="diagram-container">
          <img src="${images['diagrams/high-level-architecture.drawio.png']}" alt="High-Level Architecture Diagram" class="diagram-img">
          <div class="diagram-caption">Figure 2.1 — High-Level C4 Context Architecture Diagram</div>
        </div>

        <h3>2.1 Transport Policy Guardrails</h3>
        <ul>
          <li>Keep <code>/v1/messages</code> as the <strong>native Anthropic Messages surface</strong>. No OpenAI-compatible endpoints exist or may be added.</li>
          <li>Upstream auth is <strong>only</strong> <code>Authorization: Bearer &lt;Claude Code OAuth token&gt;</code>.</li>
          <li>The bridge <strong>ignores</strong> <code>ANTHROPIC_API_KEY</code>, the old <code>claudeLocalBridge.apiKey</code> setting, and intercepted <code>x-api-key</code> credentials. Local placeholder keys like <code>ANTHROPIC_API_KEY=local</code> are for client-side checks only and are never forwarded upstream.</li>
          <li>Debug, trace, transcript, and log surfaces are <strong>redacted</strong>: OAuth tokens and fingerprints are sensitive local account state.</li>
        </ul>

        <h3>2.2 Credential Discovery Priority Order</h3>
        <table>
          <thead>
            <tr>
              <th>Priority</th>
              <th>Source</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>1</strong></td>
              <td>Live intercepted Claude Code Bearer token</td>
              <td>Captured from Claude Code traffic inside the VS Code process or capture proxy</td>
            </tr>
            <tr>
              <td><strong>2</strong></td>
              <td><code>CLAUDE_CODE_OAUTH_TOKEN</code> env var</td>
              <td>Long-lived OAuth token from <code>claude setup-token</code></td>
            </tr>
            <tr>
              <td><strong>3</strong></td>
              <td>macOS Keychain <code>Claude Code-credentials</code></td>
              <td>Automatically set by <code>claude /login</code>; default on macOS</td>
            </tr>
            <tr>
              <td><strong>4</strong></td>
              <td><code>~/.claude/.credentials.json</code></td>
              <td>Linux / Windows fallback; macOS fallback if keychain is locked</td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- Section 3 -->
      <section id="sec-3" class="card">
        <h2>3. Processing Pipeline</h2>
        <div class="diagram-container">
          <img src="${images['diagrams/processing-pipeline.drawio.png']}" alt="Processing Pipeline Diagram" class="diagram-img">
          <div class="diagram-caption">Figure 3.1 — 11-Stage Runner Execution Pipeline</div>
        </div>

        <p>The runner loop executes through 11 deterministic stages:</p>
        <ol>
          <li><strong>Input Ingestion</strong> — <code>bin/local-bridge-runner.js</code> parses flags and dispatches to <code>run(options)</code>. Retired options are rejected loudly.</li>
          <li><strong>Preflight &amp; Resume Reconciliation</strong> — <code>--cwd</code> sanity check, workspace trust gate, and session store resume where checkpoints are reconciled against <code>*.ledger.jsonl</code>.</li>
          <li><strong>Context Assembly &amp; Projection</strong> — Small default system prompt, prompt templates, repo context fingerprint, and context compaction policy.</li>
          <li><strong>Model Transport Dispatch</strong> — <code>model-client.js</code> POSTs to the bridge (buffered or SSE streaming), applying token budgets and leases.</li>
          <li><strong>Model Response Parsing</strong> — Text blocks plus <code>tool_use</code> blocks extracted; usage recorded in budget tracker.</li>
          <li><strong>Message-Contract Validation</strong> — Every <code>tool_use_id</code> matched exactly once before the next bridge request.</li>
          <li><strong>Security &amp; Permission Gate</strong> — Authority ceiling → <code>resolveFileTarget</code> (realpath confinement) → Allow / Ask / Deny decision.</li>
          <li><strong>Tool Batch Execution</strong> — Batch execution in <code>tool-pipeline.js</code>, logging <code>tool_effect_intent</code> and <code>tool_effect_result</code> pairs.</li>
          <li><strong>Terminal Stop Decision</strong> — Evaluates 25 machine-readable stop reasons. If not terminal, appends <code>tool_result</code> and repeats loop.</li>
          <li><strong>Idempotent Run Finalizer (<code>finalizeRun</code>)</strong> — Single terminal exit path for all outcomes &amp; process signals (SIGINT/SIGTERM).</li>
          <li><strong>Artifact Outputs</strong> — Output text/JSON to terminal; session state, ledger, transcripts, and traces written to <code>~/.bridge-runner</code>.</li>
        </ol>
      </section>

      <!-- Section 4 -->
      <section id="sec-4" class="card">
        <h2>4. Core Components</h2>
        <div class="diagram-container">
          <img src="${images['diagrams/component-relationships.drawio.png']}" alt="Component Relationships Diagram" class="diagram-img">
          <div class="diagram-caption">Figure 4.1 — Component Relationships &amp; Module Boundaries</div>
        </div>

        <h3>4.1 Capability Groups &amp; Tool Surface (20 Tools)</h3>
        <table>
          <thead>
            <tr>
              <th>Capability Group</th>
              <th>Tools Included</th>
              <th>How to Enable</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>core</strong> (default)</td>
              <td><code>list_files</code>, <code>read_file</code>, <code>search_text</code>, <code>glob</code>, <code>git_status</code>, <code>manage_tasks</code>, <code>ask_user_question</code></td>
              <td>Always enabled</td>
            </tr>
            <tr>
              <td><strong>edits</strong></td>
              <td><code>edit_file</code>, <code>write_file</code>, <code>apply_patch</code> (hidden)</td>
              <td><code>--capabilities edits</code></td>
            </tr>
            <tr>
              <td><strong>recovery</strong></td>
              <td><code>undo</code>, <code>undo_edit</code></td>
              <td><code>--capabilities recovery</code></td>
            </tr>
            <tr>
              <td><strong>agents</strong></td>
              <td><code>spawn_agent</code> (in-run read-only delegation)</td>
              <td><code>--capabilities agents</code></td>
            </tr>
            <tr>
              <td><strong>worktrees</strong></td>
              <td><code>enter_worktree</code>, <code>exit_worktree</code>, <code>list_worktrees</code></td>
              <td><code>--capabilities worktrees</code></td>
            </tr>
            <tr>
              <td><strong>skills</strong></td>
              <td><code>run_skill</code></td>
              <td><code>--capabilities skills</code></td>
            </tr>
            <tr>
              <td><strong>lsp</strong></td>
              <td><code>lsp_query</code></td>
              <td><code>--capabilities lsp</code> or <code>--enable-lsp</code></td>
            </tr>
            <tr>
              <td><strong>shell</strong></td>
              <td><code>bash</code>, <code>manage_shell_jobs</code></td>
              <td><code>--allow-shell</code> <strong>only</strong></td>
            </tr>
          </tbody>
        </table>

        <h3>4.2 The Durability Quartet</h3>
        <p>Measured end-to-end by the A1 crash bake-off: all 74 kill trials showed byte-perfect ledger survival and zero corrupt tails across 141 session ledgers.</p>
        <table>
          <thead>
            <tr>
              <th>Module</th>
              <th>File Pattern</th>
              <th>Role &amp; Crash Guarantee</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Session Store</strong></td>
              <td><code>*.state.json</code></td>
              <td>Debounced (75ms) atomic-write JSON checkpoint loaded during resume. Flushed synchronously on exit/SIGINT/SIGTERM.</td>
            </tr>
            <tr>
              <td><strong>Session Ledger</strong></td>
              <td><code>*.ledger.jsonl</code></td>
              <td>Append-only, sequence-numbered event log with cursor sidecar. Survived byte-perfect across all crash trials.</td>
            </tr>
            <tr>
              <td><strong>Replay Simulator</strong></td>
              <td>Read-only engine</td>
              <td>Detects sequence gaps, pending effect intents, and orphaned tool calls post-crash.</td>
            </tr>
            <tr>
              <td><strong>Ledger Repair</strong></td>
              <td><code>ledger-repair.js</code></td>
              <td><code>reconcileForResume</code> auto-applies safe repairs to close stale-checkpoint gaps before resumed execution.</td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- Section 5 -->
      <section id="sec-5" class="card">
        <h2>5. API Contracts &amp; Schemas</h2>
        <h3>5.1 Stop Reasons Taxonomy (25 Reasons)</h3>
        <p>The runner uses a stable machine-readable taxonomy across 3 main categories:</p>
        <ul>
          <li><strong>Normal Exits:</strong> <code>success</code>, <code>max_steps</code>, <code>max_tool_calls_per_turn</code>, <code>model_max_tokens</code>, <code>model_refusal</code>.</li>
          <li><strong>Context &amp; Budget Caps:</strong> <code>context_budget_exceeded</code>, <code>initial_prompt_too_large</code>, <code>context_ceiling_unrecoverable</code>, <code>predictive_context_budget_exceeded</code>, <code>predictive_input_token_budget_exceeded</code>, <code>predictive_output_token_budget_exceeded</code>, <code>wall_clock_budget_exceeded</code>, <code>cost_budget_exceeded</code>, <code>input_token_budget_exceeded</code>, <code>output_token_budget_exceeded</code>, <code>retry_budget_exceeded</code>.</li>
          <li><strong>Errors &amp; Interrupts:</strong> <code>bridge_error</code>, <code>message_contract_error</code>, <code>cwd_invalid</code>, <code>resume_failed</code>, <code>tool_failure_escalation</code>, <code>cancelled</code>, <code>workspace_not_trusted</code>, <code>semantic_cycle_detected</code>, <code>user_denied</code>.</li>
        </ul>
      </section>

      <!-- Section 6 -->
      <section id="sec-6" class="card">
        <h2>6. Infrastructure &amp; Deployment</h2>
        <div class="diagram-container">
          <img src="${images['diagrams/deployment-infrastructure.drawio.png']}" alt="Deployment and Infrastructure Diagram" class="diagram-img">
          <div class="diagram-caption">Figure 6.1 — Deployment Architecture (Local Extension, Docker, and GitHub Actions)</div>
        </div>

        <h3>6.1 Containerization (Docker)</h3>
        <p>The repository ships with a production-grade multi-stage <code>Dockerfile</code>:</p>
        <pre><code>FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM node:22-alpine AS final
RUN addgroup -S bridge &amp;&amp; adduser -S bridge -G bridge
WORKDIR /app
COPY --chown=bridge:bridge bin/ ./bin/
COPY --chown=bridge:bridge src/ ./src/
COPY --chown=bridge:bridge package.json ./
VOLUME ["/home/bridge/.bridge-runner"]
USER bridge
EXPOSE 11437
ENTRYPOINT ["node", "bin/local-bridge-runner.js"]
CMD ["--help"]</code></pre>
      </section>

      <!-- Section 7 -->
      <section id="sec-7" class="card">
        <h2>7. Extension Patterns</h2>
        <p>Adding a new tool to the runner requires 4 clean steps:</p>
        <ol>
          <li>Create <code>src/runner/tools/&lt;name&gt;.js</code> exporting <code>{ definition, execute, meta: { name, category } }</code>.</li>
          <li>Register the module in <code>TOOL_MODULES</code> inside <code>src/runner/tool-catalog.js</code>.</li>
          <li>Assign the tool to a group in <code>CAPABILITY_GROUPS</code> (e.g. <code>edits</code>, <code>recovery</code>, etc.).</li>
          <li>Add a unit test under <code>test/runner/&lt;name&gt;.test.js</code>.</li>
        </ol>
      </section>

      <!-- Section 8 -->
      <section id="sec-8" class="card">
        <h2>8. Rules &amp; Anti-Patterns</h2>
        <ul>
          <li><strong>Do:</strong> Route all process exits through <code>finalizeRun</code> for clean artifact flushes and process safety.</li>
          <li><strong>Do:</strong> Redact all OAuth tokens and fingerprints before writing to transcripts, ledgers, or terminal streams.</li>
          <li><strong>Don't:</strong> Restore retired agent profiles (<code>--agent</code>, <code>--profile</code>); use explicit capability groups instead.</li>
          <li><strong>Don't:</strong> Allow <code>--dont-ask</code> to enable shell access by itself without <code>--allow-shell</code>.</li>
        </ul>
      </section>

      <!-- Section 9 -->
      <section id="sec-9" class="card">
        <h2>9. Dependencies</h2>
        <p>The project maintains <strong>Zero (0) runtime npm dependencies</strong>. All production code uses Node.js standard library APIs.</p>
        <table>
          <thead>
            <tr>
              <th>Package</th>
              <th>Type</th>
              <th>Version</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>eslint</code></td>
              <td>devDependencies</td>
              <td>^9.0.0</td>
              <td>Code linting with flat config</td>
            </tr>
            <tr>
              <td><code>prettier</code></td>
              <td>devDependencies</td>
              <td>^3.0.0</td>
              <td>Code formatting</td>
            </tr>
            <tr>
              <td><code>jest</code></td>
              <td>devDependencies</td>
              <td>^30.4.2</td>
              <td>Coverage reporting</td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- Section 10 & 11 -->
      <section id="sec-10" class="card">
        <h2>10. Code Structure &amp; Experiment Record</h2>
        <p>The codebase is organized into clean, modular directories:</p>
        <pre><code>claude-local-bridge-playground/
├── bin/                       # CLI entry points (runner, coordinator, archive, undo)
├── src/                       # Extension &amp; runner source code (zero runtime deps)
│   ├── extension.js           # Extension activation &amp; commands
│   ├── server.js              # Loopback HTTP server (:11437)
│   ├── proxy.js               # Streaming OAuth proxy
│   └── runner/                # Local coding-agent runner (64 modules)
├── test/                      # 117 test files (~480 tests using node --test)
├── docs/                      # Technical documentation &amp; experiment reports
│   ├── project-summary.md     # Markdown project summary
│   ├── project-summary.docx   # Word document report
│   ├── project-summary.html   # Standalone HTML report
│   └── diagrams/              # draw.io diagram sources &amp; PNGs
└── Dockerfile                 # Multi-stage production container definition</code></pre>
      </section>

      <footer>
        Claude Local Bridge Playground — Project Summary Documentation &bull; Generated August 2026
      </footer>

    </div>
  </div>

</body>
</html>`;

fs.writeFileSync(htmlPath, htmlDocument, 'utf8');
console.log(`Generated HTML document: ${htmlPath}`);
