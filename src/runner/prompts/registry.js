'use strict';

/**
 * prompts/registry.js — the prompt-template registry (roadmap §4.6).
 *
 * Prompt templates used to be "write a Markdown file and remember it exists"
 * folklore. This registry gives them the same treatment tools and agents
 * already get: a typed shape (YAML frontmatter), discovery/listing, parameter
 * substitution, and provenance (built-in vs project vs global).
 *
 * Layers, highest precedence first:
 *   1. project   — <cwd>/.bridge-runner/prompts/<name>.md
 *   2. global    — ~/.bridge-runner/prompts/<name>.md
 *   3. built-in  — src/runner/prompts/<name>.md (shipped with the runner)
 *
 * A user/project file overrides a built-in of the same name. Files without
 * frontmatter are still valid — the whole file becomes the prompt body — so the
 * registry stays backward compatible with the old "plain Markdown" templates.
 *
 * The frontmatter parser is deliberately small (flat key: value, like the agent
 * loader) so there is no YAML dependency. List-shaped fields accept either a
 * comma list (`a, b`) or an inline array (`[a, b]`).
 */

const fs = require('fs');
const path = require('path');

const BUILTIN_DIR = __dirname; // src/runner/prompts

function userHome() {
  return process.env.HOME || process.env.USERPROFILE || '';
}

// Discovery directories for *file* prompts (project then global). The built-in
// directory is handled separately so its provenance can be labelled distinctly.
function promptFileDirs(cwd) {
  const dirs = [];
  if (cwd) dirs.push({ dir: path.join(cwd, '.bridge-runner', 'prompts'), scope: 'project' });
  const home = userHome();
  if (home) dirs.push({ dir: path.join(home, '.bridge-runner', 'prompts'), scope: 'global' });
  return dirs;
}

function readIfFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

// Split a frontmatter list value: "a, b" or "[a, b]" -> ['a','b'].
function parseList(value) {
  if (!value) return [];
  let raw = String(value).trim();
  if (raw.startsWith('[') && raw.endsWith(']')) raw = raw.slice(1, -1);
  return raw
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

// Parameters are declared as a comma list. A trailing "?" marks a parameter
// optional; everything else is required. The body references them as {{name}}.
function parseParameters(value) {
  return parseList(value).map((token) => {
    const optional = token.endsWith('?');
    const name = optional ? token.slice(0, -1).trim() : token;
    return { name, required: !optional };
  });
}

/**
 * Parse a prompt file into metadata + body. Tolerant of missing frontmatter.
 */
function parsePromptFile(text) {
  const raw = String(text || '');
  if (!raw.startsWith('---')) {
    return { fields: {}, body: raw.trim() };
  }
  const end = raw.indexOf('\n---', 3);
  if (end === -1) {
    throw new Error('frontmatter is missing its closing ---');
  }
  const header = raw.slice(3, end).trim();
  const body = raw
    .slice(end + 4)
    .replace(/^\n/, '')
    .trim();

  const fields = {};
  for (const line of header.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    let val = trimmed.slice(colon + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    fields[key] = val;
  }
  return { fields, body };
}

// Build the normalized prompt object the rest of the runner consumes.
function compilePrompt(name, text, { source, scope }) {
  const { fields, body } = parsePromptFile(text);
  return {
    name,
    title: fields.title || name,
    summary: fields.summary || '',
    parameters: parseParameters(fields.parameters),
    recommendedTools: parseList(fields['recommended-tools']),
    recommendedPermissions: parseList(fields['recommended-permissions']),
    tags: parseList(fields.tags),
    body,
    source,
    scope,
  };
}

function builtinPath(name) {
  return path.join(BUILTIN_DIR, name + '.md');
}

/** Load a built-in prompt by name, ignoring project/global overrides. */
function loadBuiltin(name) {
  const text = readIfFile(builtinPath(name));
  if (text === null) return null;
  return compilePrompt(name, text, { source: 'builtin:' + name, scope: 'builtin' });
}

function listBuiltinNames() {
  let entries;
  try {
    entries = fs.readdirSync(BUILTIN_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name.slice(0, -3))
    .sort();
}

/**
 * Load a single prompt by name, honoring the override order. Returns null if no
 * file/built-in matches. Built-in provenance is labelled `builtin:<name>` (not
 * the absolute path) so callers can recognise shipped templates regardless of
 * where the package is installed.
 */
function loadPrompt(cwd, name) {
  const key = String(name || '').trim();
  if (!key) return null;

  for (const { dir, scope } of promptFileDirs(cwd)) {
    const filePath = path.join(dir, key + '.md');
    const text = readIfFile(filePath);
    if (text !== null) return compilePrompt(key, text, { source: filePath, scope });
  }

  const builtinText = readIfFile(builtinPath(key));
  if (builtinText !== null) {
    return compilePrompt(key, builtinText, { source: 'builtin:' + key, scope: 'builtin' });
  }
  return null;
}

/**
 * Load a prompt from an explicit file path (used by --prompt-template <path>).
 */
function loadPromptFromPath(cwd, filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(cwd || process.cwd(), filePath);
  const text = readIfFile(abs);
  if (text === null) return null;
  const name = path.basename(abs, path.extname(abs));
  return compilePrompt(name, text, { source: abs, scope: 'path' });
}

/**
 * List all known prompts (project + global + built-in), deduped by name with
 * the override order applied. Sorted by name.
 */
function listPrompts(cwd) {
  const seen = new Map();

  for (const { dir, scope } of promptFileDirs(cwd)) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const name = entry.name.slice(0, -3);
      if (seen.has(name)) continue; // earlier (higher-precedence) layer wins
      const text = readIfFile(path.join(dir, entry.name));
      if (text === null) continue;
      try {
        seen.set(name, compilePrompt(name, text, { source: path.join(dir, entry.name), scope }));
      } catch {
        // Skip unparseable files in listings; `validate` reports them loudly.
      }
    }
  }

  for (const name of listBuiltinNames()) {
    if (seen.has(name)) continue;
    const text = readIfFile(builtinPath(name));
    if (text === null) continue;
    try {
      seen.set(name, compilePrompt(name, text, { source: 'builtin:' + name, scope: 'builtin' }));
    } catch {
      // ignore malformed built-in (should never happen — covered by tests)
    }
  }

  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// Control tokens / delimiters we refuse inside a substituted parameter value.
// A parameter value is attacker-influenced text spliced into the prompt, so we
// reject anything that tries to forge conversation turns, special tokens, or
// our own template-composition markers rather than silently escaping it.
const INJECTION_PATTERNS = [
  /\n\s*(human|assistant|system)\s*:/i, // forged role turns
  /<\|[^>]*\|>/, // <|im_start|> style control tokens
  /\[\/?INST\]/i, // [INST] / [/INST]
  /<\/?(system|assistant|user|tool)\b[^>]*>/i, // role-ish XML tags
  /\{\{|\}\}/, // template placeholder delimiters
  /^\s*---\s*$/m, // frontmatter / section fences
  /##\s*(Prompt template|User request)\b/i, // our own composition headers
];

const MAX_PARAM_VALUE_LENGTH = 2000;

/**
 * Validate a single parameter value. Throws on anything that looks like a
 * prompt-injection or control token. Returns the value unchanged when safe.
 */
function sanitizeParamValue(key, value) {
  const str = String(value);
  if (str.length > MAX_PARAM_VALUE_LENGTH) {
    throw new Error('Parameter "' + key + '" is too long (max ' + MAX_PARAM_VALUE_LENGTH + ' chars).');
  }
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(str)) {
      throw new Error('Parameter "' + key + '" was rejected: it looks like a prompt-injection / control token.');
    }
  }
  return str;
}

/**
 * Substitute {{name}} placeholders in a body using the provided args.
 *
 * - Every declared *required* parameter must be present in args, else throws.
 * - Provided values are sanitized (injection refusal) before substitution.
 * - Declared-optional parameters that were not provided collapse to empty.
 * - Unknown {{placeholders}} that are neither declared nor provided are left
 *   intact so a template author notices the typo.
 */
function substituteParameters(body, args = {}, parameters = []) {
  const provided = args && typeof args === 'object' ? args : {};
  const declared = Array.isArray(parameters) ? parameters : [];

  const missing = declared.filter((p) => p.required && !(p.name in provided)).map((p) => p.name);
  if (missing.length) {
    throw new Error('Missing required prompt parameter(s): ' + missing.join(', '));
  }

  // The set of names we will replace: everything provided, plus declared
  // optionals (so they collapse to empty rather than leaking {{name}}).
  const names = new Set([...Object.keys(provided), ...declared.map((p) => p.name)]);

  let out = body;
  for (const name of names) {
    const value = name in provided ? sanitizeParamValue(name, provided[name]) : '';
    const placeholder = new RegExp('\\{\\{\\s*' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\}\\}', 'g');
    out = out.replace(placeholder, value);
  }
  // Tidy up blank lines left by collapsed optional placeholders.
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Validate prompts and return a structured report. With a name, validates one;
 * otherwise validates every discoverable prompt. `errors` are hard failures
 * (parse error, empty body, bad parameters); `warnings` are advisory.
 */
function validatePrompts(cwd, name) {
  const targets = name ? [loadPromptOrError(cwd, name)] : listPromptsRaw(cwd);
  const results = [];
  let ok = true;

  for (const target of targets) {
    const result = { name: target.name, source: target.source, errors: [], warnings: [] };

    if (target.parseError) {
      result.errors.push(target.parseError);
    } else {
      if (!target.body || !target.body.trim()) result.errors.push('prompt body is empty');

      const seen = new Set();
      for (const param of target.parameters || []) {
        if (!param.name) result.errors.push('a parameter has no name');
        if (seen.has(param.name)) result.errors.push('duplicate parameter: ' + param.name);
        seen.add(param.name);
        const used = new RegExp('\\{\\{\\s*' + param.name + '\\s*\\}\\}').test(target.body || '');
        if (!used) result.warnings.push('declared parameter "' + param.name + '" is never used in the body');
      }

      // Placeholders present in the body but not declared as parameters.
      const placeholders = [...String(target.body || '').matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((m) => m[1]);
      for (const ph of new Set(placeholders)) {
        if (!seen.has(ph)) result.warnings.push('body uses {{' + ph + '}} but it is not declared in parameters');
      }
    }

    if (result.errors.length) ok = false;
    results.push(result);
  }

  return { ok, results };
}

// Helpers for validate(): load while capturing parse errors instead of throwing.
function loadPromptOrError(cwd, name) {
  for (const { dir, scope } of promptFileDirs(cwd)) {
    const filePath = path.join(dir, name + '.md');
    const text = readIfFile(filePath);
    if (text !== null) return safeCompile(name, text, filePath, scope);
  }
  const builtinText = readIfFile(builtinPath(name));
  if (builtinText !== null) return safeCompile(name, builtinText, 'builtin:' + name, 'builtin');
  return { name, source: '(not found)', parseError: 'prompt not found' };
}

function listPromptsRaw(cwd) {
  const seen = new Map();
  for (const { dir, scope } of promptFileDirs(cwd)) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const n = entry.name.slice(0, -3);
      if (seen.has(n)) continue;
      const text = readIfFile(path.join(dir, entry.name));
      if (text !== null) seen.set(n, safeCompile(n, text, path.join(dir, entry.name), scope));
    }
  }
  for (const n of listBuiltinNames()) {
    if (seen.has(n)) continue;
    const text = readIfFile(builtinPath(n));
    if (text !== null) seen.set(n, safeCompile(n, text, 'builtin:' + n, 'builtin'));
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function safeCompile(name, text, source, scope) {
  try {
    return compilePrompt(name, text, { source, scope });
  } catch (err) {
    return { name, source, parseError: err.message };
  }
}

module.exports = {
  promptFileDirs,
  parsePromptFile,
  parseParameters,
  parseList,
  compilePrompt,
  loadPrompt,
  loadPromptFromPath,
  loadBuiltin,
  listPrompts,
  listBuiltinNames,
  sanitizeParamValue,
  substituteParameters,
  validatePrompts,
};
