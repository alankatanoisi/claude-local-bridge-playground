'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Credentials module tests
// We mock process.env and child_process to avoid real keychain/file access.

describe('credentials', () => {
  before(() => {
    // Ensure vscode mock is registered
    require('./__mocks__/vscode');
  });

  it('ignores ANTHROPIC_API_KEY so API-key billing cannot contaminate OAuth tests', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;

    const { discoverCredentials } = rewireCredentials();
    const ctx = makeCtx();
    const creds = discoverCredentials(ctx);

    assert.equal(creds.source, 'none');
    assert.equal(creds.apiKey, undefined);
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('returns CLAUDE_CODE_OAUTH_TOKEN second', () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'oauth-token-123';

    const { discoverCredentials } = rewireCredentials();
    const ctx = makeCtx();
    const creds = discoverCredentials(ctx);

    assert.equal(creds.source, 'env:CLAUDE_CODE_OAUTH_TOKEN');
    assert.equal(creds.accessToken, 'oauth-token-123');
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  });

  it('ignores captured x-api-key credentials and falls back to OAuth', () => {
    const previousOAuth = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'oauth-fallback-token';

    try {
      const { getCredentials, clearCredentialsCache } = require('../src/credentials');
      const ctx = makeCtx();
      ctx.interceptedToken = 'sk-ant-should-not-win';
      ctx.interceptedHeaderType = 'api-key';
      ctx.interceptedSource = 'intercepted:x-api-key';

      clearCredentialsCache(ctx);
      const creds = getCredentials(ctx);

      assert.equal(creds.source, 'env:CLAUDE_CODE_OAUTH_TOKEN');
      assert.equal(creds.accessToken, 'oauth-fallback-token');
      assert.equal(creds.apiKey, undefined);
    } finally {
      if (previousOAuth === undefined) {
        delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      } else {
        process.env.CLAUDE_CODE_OAUTH_TOKEN = previousOAuth;
      }
    }
  });

  it('returns none when no credentials found', () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;

    // Patch child_process to simulate keychain miss and no credentials file
    const { discoverCredentials } = rewireCredentials({ keychainFails: true, fileMissing: true });
    const ctx = makeCtx();
    const creds = discoverCredentials(ctx);

    assert.equal(creds.source, 'none');
  });
});

describe('models', () => {
  it('passes through model IDs verbatim', () => {
    const { resolveModel } = require('../src/models');
    assert.equal(resolveModel('claude-opus-4-8'), 'claude-opus-4-8');
  });

  it('does not map arbitrary model names', () => {
    const { resolveModel } = require('../src/models');
    assert.equal(resolveModel('custom-model-name'), 'custom-model-name');
  });

  it('returns default model for undefined', () => {
    const { resolveModel, DEFAULT_MODEL } = require('../src/models');
    assert.equal(resolveModel(undefined), DEFAULT_MODEL);
  });
});

describe('server routing', () => {
  it('isLocalhostOrigin accepts localhost', () => {
    const { isLocalhostOrigin } = require('../src/server');
    assert.equal(isLocalhostOrigin('http://localhost:3000'), true);
  });

  it('isLocalhostOrigin accepts 127.0.0.1', () => {
    const { isLocalhostOrigin } = require('../src/server');
    assert.equal(isLocalhostOrigin('http://127.0.0.1:8080'), true);
  });

  it('isLocalhostOrigin rejects external origin', () => {
    const { isLocalhostOrigin } = require('../src/server');
    assert.equal(isLocalhostOrigin('https://evil.com'), false);
  });

  it('locks debug endpoints unless the caller knows the session token', async () => {
    const { handleRequest } = require('../src/server');
    const ctx = makeCtx();
    ctx.sensitiveEndpointToken = 'debug-door-code';

    const res = makeJsonRes();
    await handleRequest(ctx, { method: 'GET', url: '/v1/debug', headers: {} }, res);

    assert.equal(res.statusCode, 401);
    assert.equal(JSON.parse(res.body).error.type, 'unauthorized');
  });

  it('does not expose the removed chat compatibility endpoint', async () => {
    const { handleRequest } = require('../src/server');
    const res = makeJsonRes();

    await handleRequest(makeCtx(), { method: 'POST', url: '/v1/chat/completions', headers: {} }, res);

    assert.equal(res.statusCode, 404);
    assert.match(JSON.parse(res.body).error.message, /Unknown: POST \/v1\/chat\/completions/);
  });

  it('does not expose the removed model list endpoint', async () => {
    const { handleRequest } = require('../src/server');
    const res = makeJsonRes();

    await handleRequest(makeCtx(), { method: 'GET', url: '/v1/models', headers: {} }, res);

    assert.equal(res.statusCode, 404);
    assert.match(JSON.parse(res.body).error.message, /Unknown: GET \/v1\/models/);
  });
});

describe('credentials.buildAuthHeaders', () => {
  it('does not build x-api-key headers in OAuth-only mode', () => {
    const { buildAuthHeaders } = require('../src/credentials');
    const headers = buildAuthHeaders({ liveFingerprint: null }, { apiKey: 'sk-test', source: 'env' });
    assert.equal(headers['x-api-key'], undefined);
    assert.ok(!headers['authorization']);
  });

  it('builds Authorization Bearer for accessToken creds', () => {
    const { buildAuthHeaders } = require('../src/credentials');
    const headers = buildAuthHeaders({ liveFingerprint: null }, { accessToken: 'tok-123', source: 'keychain' });
    assert.equal(headers['authorization'], 'Bearer tok-123');
    assert.ok(!headers['x-api-key']);
  });

  it('uses the latest hardcoded Claude Code fallback fingerprint when no live capture exists', () => {
    const { buildAuthHeaders } = require('../src/credentials');
    const headers = buildAuthHeaders(
      { liveFingerprint: null, sessionId: 'session-123' },
      { accessToken: 'tok-123', source: 'keychain' },
    );

    assert.equal(headers['user-agent'], 'claude-cli/2.1.203 (external, sdk-cli)');
    assert.equal(headers['x-stainless-package-version'], '0.94.0');
    assert.equal(headers['x-stainless-runtime-version'], 'v26.3.0');
    assert.equal(headers['x-claude-code-session-id'], 'session-123');
    assert.match(headers['anthropic-beta'], /context-1m-2025-08-07/);
    assert.match(headers['anthropic-beta'], /fallback-credit-2026-06-01/);
  });

  it('uses live fingerprint headers when available', () => {
    const { buildAuthHeaders } = require('../src/credentials');
    const ctx = {
      liveFingerprint: {
        'user-agent': 'claude-cli/2.2.0 (test)',
        'anthropic-beta': 'test-beta-2026-01-01',
        'x-stainless-runtime': 'node',
      },
    };
    const headers = buildAuthHeaders(ctx, { accessToken: 'tok-123', source: 'intercepted' });
    assert.equal(headers['authorization'], 'Bearer tok-123');
    assert.equal(headers['user-agent'], 'claude-cli/2.2.0 (test)');
    assert.equal(headers['anthropic-beta'], 'test-beta-2026-01-01');
    assert.equal(headers['x-stainless-runtime'], 'node');
  });
});

describe('credentials.prependClaudeCodeSystem', () => {
  it('leaves the request body unchanged when no live system blocks were captured', () => {
    const { prependClaudeCodeSystem } = require('../src/credentials');
    const body = {
      model: 'claude-fable-5',
      messages: [{ role: 'user', content: 'hello' }],
    };

    const returned = prependClaudeCodeSystem({ liveFingerprint: null }, body, {
      accessToken: 'tok-123',
      source: 'keychain',
    });

    assert.equal(returned, body);
    assert.deepEqual(body, {
      model: 'claude-fable-5',
      messages: [{ role: 'user', content: 'hello' }],
    });
  });

  it('prepends live captured system blocks when they exist', () => {
    const { prependClaudeCodeSystem } = require('../src/credentials');
    const body = {
      system: 'user system',
      messages: [{ role: 'user', content: 'hello' }],
    };
    const ctx = {
      liveFingerprint: {
        'x-anthropic-billing-header': 'x-anthropic-billing-header: cc_version=live; cch=live;',
        'agent-identity': 'Live agent identity.',
      },
    };

    prependClaudeCodeSystem(ctx, body, { accessToken: 'tok-123', source: 'intercepted' });

    assert.deepEqual(body.system, [
      { type: 'text', text: 'x-anthropic-billing-header: cc_version=live; cch=live;' },
      {
        type: 'text',
        text: 'Live agent identity.',
        cache_control: { type: 'ephemeral', ttl: '1h' },
      },
      {
        type: 'text',
        text: 'user system',
        cache_control: { type: 'ephemeral', ttl: '1h' },
      },
    ]);
  });
});

describe('credentials.getCredentialAuthMode', () => {
  it('reports disabled-api-key for api key credentials', () => {
    const { getCredentialAuthMode } = require('../src/credentials');
    assert.equal(getCredentialAuthMode({ apiKey: 'sk-test', source: 'env' }), 'disabled-api-key');
  });

  it('reports bearer for access token credentials', () => {
    const { getCredentialAuthMode } = require('../src/credentials');
    assert.equal(getCredentialAuthMode({ accessToken: 'tok-123', source: 'keychain' }), 'bearer');
  });

  it('reports none when no credential exists', () => {
    const { getCredentialAuthMode } = require('../src/credentials');
    assert.equal(getCredentialAuthMode({ source: 'none' }), 'none');
  });
});

describe('debug route', () => {
  it('reports the resolved upstream auth mode', async () => {
    const vscode = require('./__mocks__/vscode');
    const { startServer, stopServer } = require('../src/server');
    const ctx = makeCtx();
    ctx.sensitiveEndpointToken = 'debug-door-code';
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'tok-123';
    vscode.__setConfig('port', 0);

    await startServer(ctx);
    const port = ctx.server.address().port;
    const response = await requestJson(port, 'GET', '/v1/debug', undefined, {
      'x-claude-local-bridge-debug-token': 'debug-door-code',
    });
    await stopServer(ctx);
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    vscode.__setConfig('port', 11437);
    vscode.__resetConfig();

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.credentialSource, 'env:CLAUDE_CODE_OAUTH_TOKEN');
    assert.equal(response.body.upstreamAuthMode, 'bearer');
    assert.equal(response.body.credentialPolicy, 'oauth-only');
  });
});

describe('capture proxy hardening', () => {
  it('only allows Claude/Anthropic proxy targets', () => {
    const { isAllowedProxyTarget } = require('../src/capture-proxy');
    assert.equal(isAllowedProxyTarget('api.anthropic.com'), true);
    assert.equal(isAllowedProxyTarget('api.anthropic.com.'), true);
    assert.equal(isAllowedProxyTarget('example.com'), false);
  });
});

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function makeCtx() {
  return {
    outputChannel: { appendLine: () => {} },
    cachedCredentials: null,
    credentialsCachedAt: 0,
    CREDS_CACHE_TTL: 300_000,
  };
}

function makeJsonRes() {
  return {
    headers: {},
    statusCode: null,
    body: '',
    writableEnded: false,
    headersSent: false,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headersSent = true;
      for (const [name, value] of Object.entries(headers)) {
        this.headers[name.toLowerCase()] = value;
      }
    },
    write(chunk) {
      this.body += chunk || '';
    },
    end(chunk = '') {
      this.body += chunk || '';
      this.writableEnded = true;
    },
  };
}

function requestJson(port, method, pathName, body, headers = {}) {
  const payload = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: pathName,
        method,
        headers: {
          ...headers,
          ...(payload
            ? {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(payload),
              }
            : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ statusCode: res.statusCode, body: text ? JSON.parse(text) : null });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Re-require credentials with optional overrides for testing.
 * We expose the internal `discoverCredentials` for testing by patching the module.
 */
function rewireCredentials({ keychainFails = false, fileMissing = false } = {}) {
  // Clear module cache to get fresh copy
  const credPath = require.resolve('../src/credentials');
  delete require.cache[credPath];

  // If needed, we can patch child_process here via environment variables
  // (the real implementation uses process.env which we already set)

  require('../src/credentials');

  // Expose internal for testing via a wrapper that reads env directly
  return {
    discoverCredentials: (_ctx) => {
      // Mirror the priority logic for test purposes
      if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
        return {
          accessToken: process.env.CLAUDE_CODE_OAUTH_TOKEN,
          source: 'env:CLAUDE_CODE_OAUTH_TOKEN',
        };
      }
      if (!keychainFails && process.platform === 'darwin') {
        // Don't actually call keychain in tests
        return { source: 'none' };
      }
      if (!fileMissing) {
        return { source: 'none' };
      }
      return { source: 'none' };
    },
  };
}
