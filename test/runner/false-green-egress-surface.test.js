'use strict';

/**
 * false-green-egress-surface.test.js — FG-I series.
 *
 * SCENARIO THIS FILE DEFENDS (hypothetical change HC-2):
 *   "Add a `web_fetch` tool so the agent can read documentation pages, behind a
 *    new `network` capability group."
 *
 * This is the first tool in the runner that would reach the outside world, and
 * the suite has no concept of egress. Every existing guard is about the
 * FILESYSTEM (deny matrix, path confinement, realpath) or about SHELL. A tool
 * that never touches a path and never spawns a shell walks past all of them.
 *
 * Four specific ways HC-2 lands green and wrong:
 *
 *   1. Category. Categories drive the permission table. `web_fetch` reads
 *      things, so `read-only` is the natural-looking choice — and `read-only`
 *      is AUTO-ALLOWED in the default mode. An egress tool would need no
 *      approval at all, in every mode, and FG-B4 (no effectful tool
 *      auto-allows) would not fire because the catalog says it is read-only.
 *
 *   2. Redaction. tool-registry scrubs `result.text` and `result.diff`. A
 *      fetcher naturally returns `body`/`html`/`headers`. Those fields reach
 *      the transcript, the ledger and stdout unscrubbed.
 *
 *   3. The --no-network ceiling. `noNetwork` exists in the authority ceiling and
 *      is honoured by every SHELL surface. Nothing enumerates who must honour
 *      it, so the one tool that most obviously should would simply not consult
 *      it — and no test would notice.
 *
 *   4. Half-registered capability group. `--capabilities network` is only
 *      meaningful if `network` is BOTH an accepted name and a real group. Get
 *      one of the two and the flag is silently inert.
 *
 * Several guards here are forward-looking: today no tool does egress, so the
 * offender list is empty. An empty-list assertion is itself a false-green risk
 * (it passes when the detector is broken), so each detector is paired with a
 * LIVENESS proof against a module known to match.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const permissions = require('../../src/runner/permissions');
const safety = require('../../src/runner/safety');
const {
  TOOLS,
  CATEGORIES,
  CAPABILITY_GROUPS,
  OPTIONAL_CAPABILITIES,
  pathArgKeysFor,
} = require('../../src/runner/tool-catalog');
const { normalizeCapabilityList } = require('../../src/runner/tool-visibility');
const { createAuthorityCeiling, effectiveFlags } = require('../../src/runner/authority');

const RUNNER_DIR = path.join(__dirname, '..', '..', 'src', 'runner');
const TOOLS_DIR = path.join(RUNNER_DIR, 'tools');

/**
 * Outbound-network detector.
 *
 * Deliberately IMPORT-based first. The call-shape regex used by FG-C11
 * (`https?\.request\(`) does not match this repo's own network module, because
 * model-client.js picks its transport dynamically:
 *
 *     const transport = isTls ? https : http;
 *     const req = transport.request(options, ...);
 *
 * A new module copying that idiom — the most likely thing an author would copy —
 * is invisible to a call-shape scan. Importing a network module is much harder
 * to do accidentally and much harder to disguise. FG-I9 pins that gap explicitly.
 */
const NETWORK_PRIMITIVE =
  /require\(\s*['"](?:node:)?(?:http|https|net|tls|dgram|http2|undici)['"]\s*\)|\bfetch\(|new WebSocket\(/;

function makeCtx(extra = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fg-egress-'));
  return { cwd: tmp, cwdRealpath: fs.realpathSync(tmp), ...extra };
}

/** Every tool module file on disk, as { name, file, source }. */
function toolSources() {
  return Object.entries(TOOLS)
    .map(([name, mod]) => {
      const base = (mod.meta && mod.meta.file) || name.replace(/_/g, '-') + '.js';
      const file = path.join(TOOLS_DIR, base);
      return fs.existsSync(file) ? { name, file, source: fs.readFileSync(file, 'utf8') } : null;
    })
    .filter(Boolean);
}

describe('FG-I egress capability containment', () => {
  // FG-I1: the category trap. Any tool that can reach the network must sit in a
  // category that is NOT auto-allowed in the default permission mode.
  it('FG-I1: no network-capable tool is auto-allowed in default mode', () => {
    const ctx = makeCtx();
    const offenders = [];
    for (const { name, source } of toolSources()) {
      if (!NETWORK_PRIMITIVE.test(source)) continue;
      const decision = permissions.check(name, {}, ctx);
      if (decision && decision.decision === 'allow') {
        offenders.push(`${name} (category "${CATEGORIES[name]}") auto-allows while performing network I/O`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      'Network-capable tool(s) require no approval:\n  ' +
        offenders.join('\n  ') +
        '\nEgress is an effectful operation. Give it a category the MODES table gates ' +
        '(not read-only), and make sure it consults ctx.noNetwork.',
    );
  });

  // FG-I1b: LIVENESS. FG-I1 passes today because no tool does egress. That is
  // exactly when a broken detector is invisible, so prove the regex still
  // recognises real outbound code — model-client.js is the runner's only
  // sanctioned network module.
  it('FG-I1b: the egress detector still recognises known outbound code', () => {
    const client = fs.readFileSync(path.join(RUNNER_DIR, 'model-client.js'), 'utf8');
    assert.ok(
      NETWORK_PRIMITIVE.test(client),
      'NETWORK_PRIMITIVE no longer matches model-client.js — the FG-I1 sweep is now vacuous ' +
        'and would pass even for a tool that opens sockets. Re-point the pattern at current code.',
    );
    assert.ok(!NETWORK_PRIMITIVE.test('const x = readFileSync(p);'), 'detector must not match ordinary file I/O');
  });

  // FG-I9: a guard on an existing guard. FG-C11 (redaction-parity) sweeps
  // src/runner for unreviewed outbound-network modules using the call shape
  // `https?.request(` / `fetch(`. This repo's own client does neither — it
  // aliases the transport first — so a new egress module written in the house
  // style would slip past FG-C11 entirely. Assert the discrepancy is real and
  // stays documented, so nobody trusts FG-C11 as a complete egress detector.
  it('FG-I9: the call-shape network detector is known-incomplete and must not be relied on alone', () => {
    const client = fs.readFileSync(path.join(RUNNER_DIR, 'model-client.js'), 'utf8');
    const FG_C11_SHAPE = /https?\.request\(|\bfetch\(/;

    assert.equal(
      FG_C11_SHAPE.test(client),
      false,
      'FG-C11’s call-shape regex now DOES match model-client.js. That is an improvement — ' +
        'delete this test and simplify FG-I1’s detector comment.',
    );
    assert.ok(
      NETWORK_PRIMITIVE.test(client),
      'The import-based detector must catch what the call-shape detector misses.',
    );
  });

  // FG-I2: --no-network must have named enforcement points. It is a ceiling bit
  // that can never be dropped (authority.js), but a ceiling nobody consults is
  // decoration. Pinning the consumer set means deleting a check is loud, and
  // adding an egress surface without one is a reviewed decision.
  it('FG-I2: the ctx.noNetwork guard is honoured at every registered enforcement point', () => {
    const EXPECTED_ENFORCERS = ['background-shell.js', 'hooks/hook-runner.js', 'shell-policy.js', 'tools/bash.js'];
    const actual = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.name.endsWith('.js')) {
          const src = fs.readFileSync(p, 'utf8');
          // A real guard branches on the flag; assignment/propagation does not count.
          if (/if\s*\(\s*ctx\??\.?\??noNetwork|if\s*\(\s*ctx\?\.\s*noNetwork/.test(src)) {
            actual.push(path.relative(RUNNER_DIR, p));
          }
        }
      }
    };
    walk(RUNNER_DIR);
    assert.deepEqual(
      actual.sort(),
      EXPECTED_ENFORCERS.sort(),
      'The set of modules that actually branch on ctx.noNetwork changed.\n' +
        'Removing one silently un-enforces --no-network on that surface; adding a network\n' +
        'tool without one means --no-network does not cover it. Update this register on purpose.',
    );
  });

  // FG-I3: the ceiling itself must stay one-way for noNetwork, so a tool cannot
  // clear the flag mid-run to make its own egress legal.
  it('FG-I3: noNetwork cannot be cleared mid-run once the ceiling has it', () => {
    const ctx = makeCtx({ noNetwork: true });
    ctx.authorityCeiling = createAuthorityCeiling(ctx);
    assert.equal(effectiveFlags(ctx).noNetwork, true);

    ctx.noNetwork = false; // hostile / buggy mid-run mutation
    assert.equal(
      effectiveFlags(ctx).noNetwork,
      true,
      '--no-network was dropped by mutating ctx — the ceiling must make it one-way.',
    );
  });
});

describe('FG-I result-field redaction coverage', () => {
  // FG-I4: the redaction boundary scrubs specific NAMED fields of a tool result.
  // That list is invisible unless you read tool-registry, so a new tool that
  // returns its payload under any other key silently bypasses scrubbing.
  // Pinning the list turns "I added a body field" into a review moment.
  it('FG-I4: the registry scrubs exactly the reviewed set of tool-result fields', () => {
    const src = fs.readFileSync(path.join(RUNNER_DIR, 'tool-registry.js'), 'utf8');
    const REVIEWED_SCRUBBED_FIELDS = ['text', 'diff'];

    for (const field of REVIEWED_SCRUBBED_FIELDS) {
      assert.match(
        src,
        new RegExp('result\\.' + field),
        `tool-registry no longer references result.${field} — scrubbing for it may have been dropped.`,
      );
    }

    // Any OTHER string-bearing result field a tool returns is unscrubbed today.
    // Enumerate what tools actually return so the set cannot grow unnoticed.
    const RESULT_FIELD =
      /return\s*\{\s*ok:\s*[^}]*?\b(text|diff|body|html|content|headers|url|stdout|stderr|raw|payload)\s*:/g;
    const seen = new Set();
    for (const { source } of toolSources()) {
      for (const m of source.matchAll(RESULT_FIELD)) seen.add(m[1]);
    }
    const unscrubbed = [...seen].filter((f) => !REVIEWED_SCRUBBED_FIELDS.includes(f)).sort();
    assert.deepEqual(
      unscrubbed,
      [],
      'Tool(s) return payload field(s) the redaction boundary does not scrub: ' +
        unscrubbed.join(', ') +
        '.\nOnly ' +
        REVIEWED_SCRUBBED_FIELDS.join('/') +
        ' pass through the scrubber, so these reach the transcript, ledger and stdout raw. ' +
        'Either return the payload as `text`, or extend the scrubbing in tool-registry.js and this register.',
    );
  });

  // FG-I4b: LIVENESS for the scrubber itself — proves that the field the
  // register trusts (`text`) really is scrubbed, so FG-I4's premise holds.
  it('FG-I4b: a secret in result.text is actually scrubbed by the boundary', () => {
    const secret = 'sk-ant-' + 'a1b2c3'.repeat(6);
    const scrubbed = safety.scrubSecrets('fetched: ' + secret);
    assert.ok(!scrubbed.includes(secret), 'scrubSecrets no longer removes an Anthropic key — FG-I4 rests on this');
    assert.ok(scrubbed.includes('[REDACTED'), 'redaction must leave a visible marker');
  });
});

describe('FG-I capability-group registration', () => {
  // FG-I5: a group name accepted by --capabilities but absent from
  // CAPABILITY_GROUPS (or present but empty) makes the flag silently inert:
  // the user asks for a capability, gets no error, and gets no tools.
  it('FG-I5: every optional capability name maps to a real, non-empty group', () => {
    for (const name of OPTIONAL_CAPABILITIES) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(CAPABILITY_GROUPS, name),
        `--capabilities ${name} is accepted but "${name}" is not a group in CAPABILITY_GROUPS — the flag does nothing.`,
      );
      const members = CAPABILITY_GROUPS[name];
      assert.ok(Array.isArray(members) && members.length > 0, `capability group "${name}" is empty`);
      for (const tool of members) {
        assert.ok(
          Object.prototype.hasOwnProperty.call(TOOLS, tool),
          `capability group "${name}" lists unregistered tool "${tool}"`,
        );
      }
    }
  });

  // FG-I6: the reverse direction — a group defined in CAPABILITY_GROUPS but not
  // listed in OPTIONAL_CAPABILITIES can never be switched on from the CLI. The
  // tools in it look shipped and are unreachable.
  it('FG-I6: every non-core group is reachable from --capabilities', () => {
    const ALWAYS_ON = new Set(['core']);
    const CONSENT_GATED = new Set(['shell']); // deliberately not selectable; needs --allow-shell
    const unreachable = Object.keys(CAPABILITY_GROUPS).filter(
      (g) => !ALWAYS_ON.has(g) && !CONSENT_GATED.has(g) && !OPTIONAL_CAPABILITIES.includes(g),
    );
    assert.deepEqual(
      unreachable,
      [],
      'Capability group(s) exist but cannot be enabled by any flag: ' +
        unreachable.join(', ') +
        '. Add them to OPTIONAL_CAPABILITIES, or fold them into an existing group.',
    );
  });

  // FG-I7: an unrecognised capability must fail loudly. If a typo were ignored,
  // `--capabilities netwrok` would run with fewer tools than the user asked for
  // and the run would look successful.
  it('FG-I7: an unknown capability name is rejected, not ignored', () => {
    assert.throws(
      () => normalizeCapabilityList('network'),
      /unknown capability/i,
      'a not-yet-implemented group name must be rejected until it is really registered',
    );
    assert.throws(() => normalizeCapabilityList('edits,netwrok'), /unknown capability/i);
    // And the consent-gated name stays gated.
    assert.throws(() => normalizeCapabilityList('shell'), /--allow-shell/);
  });
});

describe('FG-I non-path arguments that denote filesystem targets', () => {
  // FG-I8: N1's residual, generalised for HC-2. The permission gate inspects
  // path-shaped ARGUMENT KEYS (path, file_path, ...). A `url` argument is not
  // one of them — but `file:///etc/passwd` and `file://~/.ssh/id_rsa` are
  // filesystem reads. Any tool that grows a URL-shaped argument must declare
  // how that argument is confined.
  it('FG-I8: no tool accepts a URL-shaped argument without a declared containment review', () => {
    const URLISH = ['url', 'uri', 'endpoint', 'href', 'src', 'remote'];
    const REVIEWED = {}; // toolName -> reason; empty until an egress tool lands

    const offenders = [];
    for (const [name, mod] of Object.entries(TOOLS)) {
      let props = {};
      try {
        const def = mod.definition();
        props = (def.input_schema && def.input_schema.properties) || {};
      } catch {
        props = {};
      }
      const hits = URLISH.filter((k) => Object.prototype.hasOwnProperty.call(props, k));
      if (hits.length > 0 && !REVIEWED[name]) offenders.push(`${name} accepts ${hits.join(', ')}`);
    }
    assert.deepEqual(
      offenders,
      [],
      'Tool(s) accept a URL-shaped argument with no containment review:\n  ' +
        offenders.join('\n  ') +
        '\nThe permission gate only resolves path-shaped keys (see pathArgKeysFor), so a ' +
        'file:// or localhost URL bypasses both the deny matrix and cwd confinement. ' +
        'Reject non-http(s) schemes and loopback hosts in the tool, then record it in REVIEWED.',
    );
  });

  // FG-I8b: LIVENESS — prove the schema reader used above really can see a
  // declared argument, otherwise FG-I8 would pass by failing to read anything.
  it('FG-I8b: the schema reader observes arguments that really exist', () => {
    const def = TOOLS.read_file.definition();
    assert.ok(def.input_schema.properties.path, 'read_file must still declare a path argument');
    assert.deepEqual(pathArgKeysFor('read_file'), ['path'], 'pathArgKeysFor no longer resolves read_file’s target');
  });
});
