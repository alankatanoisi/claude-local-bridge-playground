#!/usr/bin/env node
'use strict';

/**
 * check-agent-docs.js — cross-surface agent instruction & skill drift gate.
 *
 * Wired into `npm run check:docs` (and `.github/workflows/ci.yml`).
 *
 * Enforces:
 *   1. Exact mirroring between `AGENTS.md` and `CLAUDE.md` for:
 *        - `## Learned User Preferences`
 *        - `## Learned Workspace Facts`
 *        - `## Enforced Rule Table` (and every repo path cited in its
 *          enforcement column must exist on disk)
 *   2. Shared non-negotiable safety and boundary invariants in both `AGENTS.md`
 *      and `CLAUDE.md` (retired profile flags, OAuth-only `/v1/messages`,
 *      full bridge protection fence including VS Code extension auth settings,
 *      and owner autonomy boundary).
 *   3. Live agent/skill primitives under `.cursor/{agents,rules,skills}`,
 *      `.agents/skills`, `.codex/agents`, and `.github/copilot-instructions.md`
 *      (historical `.cursor/plans/**` records are intentionally exempt):
 *        - never instruct passing retired `--agent` / `--profile` /
 *          `--list-agents` / `--list-profiles` flags;
 *        - `runner-command-builder` primitives cite only real CLI flags from
 *          `bin/local-bridge-runner.js`, the live `DEFAULT_MODEL` from
 *          `src/runner/model-catalog.js`, and existing repo docs;
 *        - mirrored `.cursor/skills/**` and `.agents/skills/**` files (plus the
 *          Cursor/Codex `runner-command-builder` agent instructions) stay in sync.
 */

const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const { DEFAULT_MODEL } = require(path.join(root, 'src/runner/model-catalog.js'));

const agentsMdPath = path.join(root, 'AGENTS.md');
const claudeMdPath = path.join(root, 'CLAUDE.md');
const agentsMd = fs.readFileSync(agentsMdPath, 'utf8');
const claudeMd = fs.readFileSync(claudeMdPath, 'utf8');
const runnerBinSource = fs.readFileSync(path.join(root, 'bin/local-bridge-runner.js'), 'utf8');

const errors = [];

function extractCliFlags(source) {
  const optionsMatch = source.match(/options:\s*\{([\s\S]*?)\n\s{6}\},/);
  if (!optionsMatch) return new Set();
  const flags = new Set();
  const lineRe = /^\s*'?([a-z][a-z0-9-]*)'?:\s*\{\s*type:/gm;
  let m;
  while ((m = lineRe.exec(optionsMatch[1])) !== null) flags.add(m[1]);
  return flags;
}

const validRunnerFlags = extractCliFlags(runnerBinSource);
if (validRunnerFlags.size === 0) {
  errors.push('Could not extract CLI flags from bin/local-bridge-runner.js');
}

function extractHeadingSection(markdown, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('^## ' + escaped + '\\s*$([\\s\\S]*?)(?=^## |\\Z)', 'm');
  // JavaScript RegExp lacks \Z; match to next `^## ` or end of string manually.
  const startRe = new RegExp('^## ' + escaped + '[ \\t]*$', 'm');
  const startMatch = startRe.exec(markdown);
  if (!startMatch) return null;
  const afterHeading = markdown.slice(startMatch.index + startMatch[0].length);
  const nextHeading = /^## /m.exec(afterHeading);
  void re;
  return nextHeading ? afterHeading.slice(0, nextHeading.index) : afterHeading;
}

function extractBullets(sectionText) {
  if (!sectionText) return null;
  return sectionText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '));
}

function extractTableRows(sectionText) {
  if (!sectionText) return null;
  return sectionText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && !/^\|[\s-:|]+\|$/.test(line));
}

// ── 1. Mirrored sections between AGENTS.md and CLAUDE.md ──

for (const sectionName of ['Learned User Preferences', 'Learned Workspace Facts']) {
  const aBullets = extractBullets(extractHeadingSection(agentsMd, sectionName));
  const cBullets = extractBullets(extractHeadingSection(claudeMd, sectionName));
  if (!aBullets || aBullets.length === 0) {
    errors.push(`AGENTS.md is missing "## ${sectionName}" bullets`);
    continue;
  }
  if (!cBullets || cBullets.length === 0) {
    errors.push(`CLAUDE.md is missing "## ${sectionName}" bullets`);
    continue;
  }
  if (JSON.stringify(aBullets) !== JSON.stringify(cBullets)) {
    const onlyA = aBullets.filter((b) => !cBullets.includes(b));
    const onlyC = cBullets.filter((b) => !aBullets.includes(b));
    errors.push(
      `"## ${sectionName}" diverged between AGENTS.md (${aBullets.length} bullets) and CLAUDE.md (${cBullets.length} bullets).` +
        (onlyA.length ? `\n  Only in AGENTS.md: ${onlyA[0].slice(0, 120)}` : '') +
        (onlyC.length ? `\n  Only in CLAUDE.md: ${onlyC[0].slice(0, 120)}` : '') +
        '\n  Keep both sections bullet-identical.',
    );
  }
}

const aRuleRows = extractTableRows(extractHeadingSection(agentsMd, 'Enforced Rule Table'));
const cRuleRows = extractTableRows(extractHeadingSection(claudeMd, 'Enforced Rule Table'));
if (!aRuleRows || aRuleRows.length < 2) {
  errors.push('AGENTS.md is missing "## Enforced Rule Table" (pair each recurring rule with what enforces it)');
} else if (!cRuleRows || cRuleRows.length < 2) {
  errors.push('CLAUDE.md is missing "## Enforced Rule Table" (must mirror AGENTS.md)');
} else {
  if (JSON.stringify(aRuleRows) !== JSON.stringify(cRuleRows)) {
    errors.push(
      `"## Enforced Rule Table" diverged between AGENTS.md (${aRuleRows.length} rows) and CLAUDE.md (${cRuleRows.length} rows); keep them identical.`,
    );
  }
  // Every repo path cited in the Enforcement column (backticked path starting
  // with a known repo prefix) must exist on disk so renamed checks fail loudly.
  const PATH_PREFIX =
    /^(?:bin\/|src\/|test\/|scripts\/|\.github\/|package\.json$|eslint\.config\.cjs$|\.prettierignore$)/;
  for (const row of aRuleRows.slice(1)) {
    const cells = row
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);
    const enforcementCell = cells[1] || '';
    const codeTokens = [...enforcementCell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    let foundPath = false;
    for (const tok of codeTokens) {
      const candidate = tok.split(/\s+/)[0].replace(/:.*$/, '');
      if (PATH_PREFIX.test(candidate)) {
        foundPath = true;
        if (!fs.existsSync(path.join(root, candidate))) {
          errors.push(`Enforced Rule Table cites missing file "${candidate}" in row: ${row}`);
        }
      }
    }
    if (!foundPath) {
      errors.push(
        `Enforced Rule Table row does not cite an enforceable repo file (` +
          `src/, test/, scripts/, .github/, package.json): ${row}`,
      );
    }
  }
}

// ── 2. Core invariants present in both AGENTS.md and CLAUDE.md ──

const REQUIRED_SHARED_SNIPPETS = [
  ['--agent', 'retired --agent flag warning'],
  ['--profile', 'retired --profile flag warning'],
  ['--list-agents', 'retired --list-agents flag warning'],
  ['--list-profiles', 'retired --list-profiles flag warning'],
  ['/v1/messages', 'native Anthropic /v1/messages invariant'],
  ['/v1/chat/completions', 'forbidden OpenAI-compatible route invariant'],
  ['ANTHROPIC_API_KEY', 'no upstream ANTHROPIC_API_KEY fallback invariant'],
  ['claudeLocalBridge.apiKey', 'no claudeLocalBridge.apiKey credential source invariant'],
  ['src/credentials.js', 'protected bridge file src/credentials.js'],
  ['src/proxy.js', 'protected bridge file src/proxy.js'],
  ['src/server.js', 'protected bridge file src/server.js'],
  ['src/interceptors/**', 'protected bridge interceptors glob'],
  ['VS Code extension auth settings', 'protected VS Code extension auth settings boundary'],
  ['docs/agent-user-autonomy-boundary-2026-08-11.md', 'owner autonomy boundary reference'],
];

for (const [docName, text] of [
  ['AGENTS.md', agentsMd],
  ['CLAUDE.md', claudeMd],
]) {
  for (const [needle, label] of REQUIRED_SHARED_SNIPPETS) {
    if (!text.includes(needle)) {
      errors.push(`${docName} is missing ${label} ("${needle}") — keep core invariants in both auto-loaded files`);
    }
  }
}

for (const surfaceRel of ['.cursor/rules/anthropic-primary-sources.mdc', '.github/copilot-instructions.md']) {
  const abs = path.join(root, surfaceRel);
  if (fs.existsSync(abs)) {
    const content = fs.readFileSync(abs, 'utf8');
    if (!content.includes('docs/agent-user-autonomy-boundary-2026-08-11.md')) {
      errors.push(`${surfaceRel} is missing reference to docs/agent-user-autonomy-boundary-2026-08-11.md`);
    }
  }
}

// ── 3. Scan live agent/skill primitives for retired flags & command-builder drift ──

function walkFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.DS_Store')) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(p, acc);
    else if (entry.isFile()) acc.push(p);
  }
  return acc;
}

const livePrimitiveFiles = [
  ...walkFiles(path.join(root, '.cursor/agents')),
  ...walkFiles(path.join(root, '.cursor/rules')),
  ...walkFiles(path.join(root, '.cursor/skills')),
  ...walkFiles(path.join(root, '.agents/skills')),
  ...walkFiles(path.join(root, '.codex/agents')),
  path.join(root, '.github/copilot-instructions.md'),
].filter((p) => fs.existsSync(p));

const RETIRED_FLAG_RE = /(?:^|[\s`"'=])(--(?:agent|profile|list-agents|list-profiles))\b/g;
const NEGATION_LINE_RE = /\b(?:do not|don't|never|retired|removed|forbidden|rejects?|unknown option)\b/i;

for (const abs of livePrimitiveFiles) {
  const rel = path.relative(root, abs).split(path.sep).join('/');
  const lines = fs.readFileSync(abs, 'utf8').split('\n');

  lines.forEach((line, idx) => {
    const lineNo = idx + 1;
    RETIRED_FLAG_RE.lastIndex = 0;
    let m;
    while ((m = RETIRED_FLAG_RE.exec(line)) !== null) {
      if (!NEGATION_LINE_RE.test(line)) {
        errors.push(
          `${rel}:${lineNo} instructs using retired flag "${m[1]}" — profiles/agents are retired ` +
            '(use explicit `--plan`, `--capabilities <group>`, or `--tools <list>`; see test/runner/profiles-retired.test.js)',
        );
      }
    }
  });

  if (path.basename(abs).startsWith('runner-command-builder') || rel.includes('/runner-command-builder/')) {
    lines.forEach((line, idx) => {
      const lineNo = idx + 1;
      // Default model check against src/runner/model-catalog.js DEFAULT_MODEL.
      const defaultModelMatch = line.match(/Default model:\s*`([^`]+)`/i);
      if (defaultModelMatch && defaultModelMatch[1] !== DEFAULT_MODEL) {
        errors.push(
          `${rel}:${lineNo} advertises stale Default model "${defaultModelMatch[1]}" != runtime DEFAULT_MODEL "${DEFAULT_MODEL}" (src/runner/model-catalog.js)`,
        );
      }
      // Every CLI `--flag` cited in a command-builder primitive must exist on
      // bin/local-bridge-runner.js (unless the line explicitly negates a retired flag).
      if (!NEGATION_LINE_RE.test(line)) {
        for (const fm of line.matchAll(/(?:^|[\s`"'(])--([a-z][a-z0-9-]*)\b/g)) {
          const flag = fm[1];
          if (!validRunnerFlags.has(flag)) {
            errors.push(
              `${rel}:${lineNo} cites unknown runner CLI flag "--${flag}" — check options in bin/local-bridge-runner.js`,
            );
          }
        }
      }
      if (/\bQUICKSTART\.md\b|\bHEADLESS_AGENT_RUNNER_BEGINNER_GUIDE\.md\b|\blab-notes\//.test(line)) {
        errors.push(
          `${rel}:${lineNo} points to removed documentation (QUICKSTART.md / HEADLESS_AGENT_RUNNER_BEGINNER_GUIDE.md / lab-notes/) — use README.md, docs/runner-quickstart.html, or docs/threat-model.md`,
        );
      }
      if (/Do not point Alan to `docs\/command-builder\.html` as primary workflow/i.test(line)) {
        errors.push(
          `${rel}:${lineNo} contradicts Learned User Preference #1 ("Treat docs/command-builder.html as the primary day-to-day runner UX")`,
        );
      }
    });
  }
}

// ── 4. Cross-surface parity: .cursor/skills <-> .agents/skills and command-builder agent ──

const cursorSkillsRoot = path.join(root, '.cursor/skills');
const agentsSkillsRoot = path.join(root, '.agents/skills');
if (fs.existsSync(cursorSkillsRoot) && fs.existsSync(agentsSkillsRoot)) {
  const cursorRels = walkFiles(cursorSkillsRoot)
    .map((p) => path.relative(cursorSkillsRoot, p).split(path.sep).join('/'))
    .sort();
  const agentsRels = walkFiles(agentsSkillsRoot)
    .map((p) => path.relative(agentsSkillsRoot, p).split(path.sep).join('/'))
    .sort();

  if (JSON.stringify(cursorRels) !== JSON.stringify(agentsRels)) {
    errors.push(
      `.cursor/skills file set (${cursorRels.length}) drifted from .agents/skills (${agentsRels.length}) — keep skill trees mirrored across Cursor and Codex`,
    );
  } else {
    for (const rel of cursorRels) {
      const cText = fs.readFileSync(path.join(cursorSkillsRoot, rel), 'utf8');
      const aText = fs.readFileSync(path.join(agentsSkillsRoot, rel), 'utf8');
      const normalizeHost = (s) => s.replace(/\b(?:Cursor|Codex)\b/g, '<HOST>');
      if (normalizeHost(cText) !== normalizeHost(aText)) {
        errors.push(`.cursor/skills/${rel} and .agents/skills/${rel} drifted apart — update both copies together`);
      }
    }
  }
}

const cursorBuilderAgent = path.join(root, '.cursor/agents/runner-command-builder.md');
const codexBuilderAgent = path.join(root, '.codex/agents/runner-command-builder.toml');
if (fs.existsSync(cursorBuilderAgent) && fs.existsSync(codexBuilderAgent)) {
  const mdRaw = fs.readFileSync(cursorBuilderAgent, 'utf8');
  const mdBody = mdRaw.replace(/^---[\s\S]*?---\n+/, '').trim();
  const tomlRaw = fs.readFileSync(codexBuilderAgent, 'utf8');
  const tomlBodyMatch = tomlRaw.match(/developer_instructions\s*=\s*"""\n?([\s\S]*?)"""/);
  if (!tomlBodyMatch) {
    errors.push('.codex/agents/runner-command-builder.toml is missing developer_instructions = """..."""');
  } else {
    const norm = (s) => s.trim().replace(/\b(?:Cursor|Codex)\b/g, '<HOST>');
    if (norm(mdBody) !== norm(tomlBodyMatch[1])) {
      errors.push(
        '.cursor/agents/runner-command-builder.md body and .codex/agents/runner-command-builder.toml developer_instructions drifted apart',
      );
    }
  }
}

if (errors.length > 0) {
  console.error(`Agent docs & skills check failed (${errors.length} issue(s)):`);
  for (const err of errors) {
    console.error('- ' + err);
  }
  process.exit(1);
}

console.log('Agent docs & skills check passed.');
console.log(`- live primitives checked: ${livePrimitiveFiles.length}`);
console.log(`- mirrored rules in Enforced Rule Table: ${aRuleRows ? aRuleRows.length - 1 : 0}`);
