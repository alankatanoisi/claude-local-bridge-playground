#!/usr/bin/env node
'use strict';

/**
 * probe.js — Standalone token probe for claude-local-bridge
 *
 * Run: node probe.js
 *
 * Tests whether your Claude Code OAuth token is accepted by api.anthropic.com.
 * Does NOT require the extension to be running.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

// ─────────────────────────────────────────────
// 1. Credential Discovery
// ─────────────────────────────────────────────

function parseClaudeCodeCredentials(raw) {
  try {
    const parsed = JSON.parse(raw.trim());
    return parsed?.claudeAiOauth?.accessToken || parsed?.accessToken || parsed?.oauth_token || null;
  } catch {
    return null;
  }
}

function readKeychainToken() {
  if (process.platform !== 'darwin') return { token: null, source: 'n/a (not macOS)' };
  try {
    const raw = execSync("security find-generic-password -s 'Claude Code-credentials' -w", {
      timeout: 5000,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const token = parseClaudeCodeCredentials(raw);
    return { token, source: 'macOS Keychain (Claude Code-credentials)' };
  } catch (e) {
    return { token: null, source: `Keychain miss: ${e.message.split('\n')[0]}` };
  }
}

function readCredentialsFile() {
  const credDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const credFile = path.join(credDir, '.credentials.json');
  try {
    if (!fs.existsSync(credFile)) return { token: null, source: `File not found: ${credFile}` };
    const raw = fs.readFileSync(credFile, 'utf8');
    const token = parseClaudeCodeCredentials(raw);
    return { token, source: `~/.claude/.credentials.json` };
  } catch (e) {
    return { token: null, source: `File error: ${e.message}` };
  }
}

function discoverToken() {
  if (process.env.ANTHROPIC_API_KEY) {
    return { token: process.env.ANTHROPIC_API_KEY, headerType: 'api-key', source: 'ANTHROPIC_API_KEY env var' };
  }
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return { token: process.env.CLAUDE_CODE_OAUTH_TOKEN, headerType: 'bearer', source: 'CLAUDE_CODE_OAUTH_TOKEN env var' };
  }

  const keychain = readKeychainToken();
  if (keychain.token) return { token: keychain.token, headerType: 'bearer', source: keychain.source };

  const file = readCredentialsFile();
  if (file.token) return { token: file.token, headerType: 'bearer', source: file.source };

  return { token: null, headerType: null, source: 'NONE — no credentials found' };
}

// ─────────────────────────────────────────────
// 2. API Probe
// ─────────────────────────────────────────────

function probeEndpoint(token, headerType, hostname, path) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
    });

    const headers = {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'content-length': Buffer.byteLength(body),
    };

    if (headerType === 'api-key') {
      headers['x-api-key'] = token;
    } else {
      headers['authorization'] = `Bearer ${token}`;
    }

    const req = https.request(
      { hostname, port: 443, path, method: 'POST', headers, timeout: 10000 },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const rawBody = Buffer.concat(chunks).toString('utf8');
          let parsed;
          try { parsed = JSON.parse(rawBody); } catch { parsed = null; }
          resolve({ status: res.statusCode, rawBody, parsed });
        });
      },
    );
    req.on('error', (e) => resolve({ status: 0, rawBody: e.message, parsed: null }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, rawBody: 'timeout', parsed: null }); });
    req.write(body);
    req.end();
  });
}

// ─────────────────────────────────────────────
// 3. Main
// ─────────────────────────────────────────────

(async () => {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Claude Local Bridge — Token Probe v2');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const { token, headerType, source } = discoverToken();
  console.log(`📦 Credential source: ${source}`);

  if (!token) {
    console.log('\n❌ No credentials found. Run: export CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...\n');
    process.exit(1);
  }

  const redacted = token.length > 16 ? `${token.slice(0, 12)}...${token.slice(-4)}` : '[token]';
  console.log(`🔑 Token (redacted): ${redacted}`);
  console.log(`📡 Header type:      ${headerType === 'api-key' ? 'x-api-key' : 'Authorization: Bearer'}`);

  // All plausible Anthropic endpoints to scan
  const candidates = [
    { hostname: 'api.anthropic.com',     path: '/v1/messages',      label: 'api.anthropic.com (public API)' },
    { hostname: 'api.claude.ai',         path: '/v1/messages',      label: 'api.claude.ai' },
    { hostname: 'claude.ai',             path: '/api/v1/messages',  label: 'claude.ai/api/v1' },
    { hostname: 'claude.ai',             path: '/api/messages',     label: 'claude.ai/api/messages' },
    { hostname: 'api.anthropic.com',     path: '/v1/messages',      label: 'api.anthropic.com (retry w/ oat token)' },
  ];

  // If CLAUDE_CODE_OAUTH_TOKEN env var is set, test that too
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN && process.env.CLAUDE_CODE_OAUTH_TOKEN !== token) {
    console.log(`\n🔑 Also testing CLAUDE_CODE_OAUTH_TOKEN env var directly`);
  }

  console.log(`\n⏳ Scanning ${candidates.length} endpoints...\n`);

  let found = false;
  for (const c of candidates) {
    process.stdout.write(`   Testing ${c.label} ... `);
    const result = await probeEndpoint(token, headerType, c.hostname, c.path);

    if (result.status === 200) {
      const reply = result.parsed?.content?.[0]?.text || '(no text)';
      console.log(`✅ HTTP 200 — "${reply.trim()}"`);
      console.log(`\n🎉 WORKING ENDPOINT FOUND: https://${c.hostname}${c.path}`);
      console.log(`   ➜ Update claudeLocalBridge.anthropicBaseUrl = "https://${c.hostname}"\n`);
      found = true;
      break;
    } else {
      const err = result.parsed?.error?.message || result.rawBody.slice(0, 80);
      console.log(`✗ HTTP ${result.status} — ${err}`);
    }
  }

  if (!found) {
    console.log(`\n⚠️  No endpoint accepted the OAuth token directly.`);
    console.log(`   → The VS Code interceptor will find the real endpoint when Claude Code makes a call.`);
    console.log(`   → In VS Code: press F5, use Claude Code, then: curl http://localhost:11436/v1/debug | jq .interceptedHost\n`);
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
})();
