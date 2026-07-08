'use strict';

/**
 * tool-profiles.js — Composable per-tool capability profiles (roadmap §6.1).
 *
 * Profiles layer over category flags (--accept-edits, --allow-shell). They cannot
 * bypass hard-deny guards (path matrix, shell scanner, chaos interlock).
 */

const fs = require('fs');
const path = require('path');

const { TOOLS, DEFAULT_HIDDEN_TOOLS } = require('./tool-catalog');

const BUILTIN_PROFILES = Object.freeze({
  'review-only': {
    id: 'review-only',
    title: 'Review only',
    rationale: 'Read and search the workspace without writes, shell, or orchestration.',
    tools: {
      list_files: 'allow',
      read_file: 'allow',
      search_text: 'allow',
      glob: 'allow',
      git_status: 'allow',
      manage_tasks: 'allow',
      edit_file: 'deny',
      write_file: 'deny',
      apply_patch: 'deny',
      undo: 'deny',
      undo_edit: 'deny',
      bash: 'deny',
      spawn_agent: 'deny',
      enter_worktree: 'deny',
      exit_worktree: 'deny',
    },
  },
  'edit-source-no-shell': {
    id: 'edit-source-no-shell',
    title: 'Edit source, no shell',
    rationale: 'Read and edit source files with recovery tools; shell and subagents disabled.',
    tools: {
      list_files: 'allow',
      read_file: 'allow',
      search_text: 'allow',
      glob: 'allow',
      git_status: 'allow',
      manage_tasks: 'allow',
      edit_file: 'allow',
      write_file: 'allow',
      undo: 'allow',
      undo_edit: 'allow',
      apply_patch: 'deny',
      bash: 'deny',
      spawn_agent: 'deny',
      enter_worktree: 'deny',
      exit_worktree: 'deny',
    },
  },
  'git-readonly-shell': {
    id: 'git-readonly-shell',
    title: 'Git read-only shell',
    rationale: 'Read tools plus bash limited to read-only git commands.',
    tools: {
      list_files: 'allow',
      read_file: 'allow',
      search_text: 'allow',
      glob: 'allow',
      git_status: 'allow',
      manage_tasks: 'allow',
      bash: 'allow',
      edit_file: 'deny',
      write_file: 'deny',
      apply_patch: 'deny',
      undo: 'deny',
      undo_edit: 'deny',
      spawn_agent: 'deny',
      enter_worktree: 'deny',
      exit_worktree: 'deny',
    },
    constraints: {
      bash: {
        command_regex: '^git\\s+(status|log|diff|show|branch|rev-parse|describe)\\b',
      },
    },
  },
});

function userHome() {
  return process.env.HOME || process.env.USERPROFILE || '';
}

function profileDirs(cwd) {
  const dirs = [];
  if (cwd) dirs.push(path.join(cwd, '.bridge-runner', 'profiles'));
  const home = userHome();
  if (home) dirs.push(path.join(home, '.bridge-runner', 'profiles'));
  return dirs;
}

function normalizeProfile(raw, sourcePath) {
  if (!raw || typeof raw !== 'object') throw new Error('Profile must be a JSON object');
  const id = String(raw.id || raw.name || (sourcePath ? path.basename(sourcePath, '.json') : '')).trim();
  if (!id) throw new Error('Profile missing id/name');
  const tools = raw.tools && typeof raw.tools === 'object' ? raw.tools : {};
  for (const [tool, rule] of Object.entries(tools)) {
    if (!TOOLS[tool]) throw new Error('Profile ' + id + ' references unknown tool: ' + tool);
    if (rule !== 'allow' && rule !== 'deny') {
      throw new Error('Profile ' + id + ': tools.' + tool + ' must be "allow" or "deny"');
    }
  }
  return {
    id,
    title: raw.title || id,
    rationale: raw.rationale || '',
    tools,
    constraints: raw.constraints && typeof raw.constraints === 'object' ? raw.constraints : {},
    source: sourcePath || 'builtin:' + id,
  };
}

function resolveProfilePath(cwd, nameOrPath) {
  const key = String(nameOrPath || '').trim();
  if (!key) return null;
  if (path.isAbsolute(key) || key.includes(path.sep) || key.endsWith('.json')) {
    const base = cwd || process.cwd();
    return path.isAbsolute(key) ? key : path.resolve(base, key);
  }
  const fileName = key.endsWith('.json') ? key : key + '.json';
  for (const dir of profileDirs(cwd)) {
    const candidate = path.join(dir, fileName);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function loadToolProfile(nameOrPath, options = {}) {
  const cwd = options.cwd || process.cwd();
  const key = String(nameOrPath || '').trim();
  if (!key) return null;

  if (BUILTIN_PROFILES[key]) {
    return { ...BUILTIN_PROFILES[key], source: 'builtin:' + key };
  }

  const filePath = resolveProfilePath(cwd, key);
  if (!filePath || !fs.existsSync(filePath)) return null;
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return normalizeProfile(raw, filePath);
}

function listToolProfiles(cwd) {
  const seen = new Map();
  for (const [id, profile] of Object.entries(BUILTIN_PROFILES)) {
    seen.set(id, { id, title: profile.title, source: 'builtin:' + id });
  }
  for (const dir of profileDirs(cwd)) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith('.json')) continue;
      const id = entry.replace(/\.json$/, '');
      if (seen.has(id)) continue;
      try {
        const profile = normalizeProfile(
          JSON.parse(fs.readFileSync(path.join(dir, entry), 'utf8')),
          path.join(dir, entry),
        );
        seen.set(id, { id: profile.id, title: profile.title, source: profile.source });
      } catch {
        seen.set(id, { id, title: id, source: path.join(dir, entry), invalid: true });
      }
    }
  }
  return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function formatProfileList(cwd) {
  const rows = listToolProfiles(cwd);
  if (!rows.length) return '(no capability profiles found)';
  return rows.map((row) => row.id + ' — ' + row.title + ' [' + row.source + ']').join('\n');
}

function isBaseEligible(name, ctx) {
  if ((name === 'bash' || name === 'manage_shell_jobs') && !(ctx && ctx.allowShell)) return false;
  if (name === 'lsp_query' && !(ctx && ctx.enableLsp)) return false;
  if (name === 'spawn_agent' && (ctx?.spawnDepth || 0) > 0) return false;
  return true;
}

function computeAllowedTools(ctx) {
  const profile = ctx?.toolProfile || null;
  const cliList = ctx?._cliToolAllowlist || null;

  if (!profile && !cliList) return null;

  const exposed = new Set();
  for (const name of Object.keys(TOOLS)) {
    if (!isBaseEligible(name, ctx)) continue;

    if (profile?.tools?.[name] === 'deny') continue;

    if (!profile) {
      if (DEFAULT_HIDDEN_TOOLS.has(name) && !(cliList && cliList.has(name))) continue;
      if (cliList && !cliList.has(name)) continue;
      exposed.add(name);
      continue;
    }

    if (profile.tools?.[name] === 'allow' || profile.tools?.[name] === undefined) {
      exposed.add(name);
    }
  }

  if (cliList) {
    return new Set([...exposed].filter((name) => cliList.has(name)));
  }
  return exposed;
}

function isToolVisible(name, ctx) {
  if (ctx?.allowedTools) return ctx.allowedTools.has(name);
  if (!isBaseEligible(name, ctx)) return false;
  if (DEFAULT_HIDDEN_TOOLS.has(name)) return false;
  return true;
}

function checkProfileConstraints(toolName, args, profile) {
  if (!profile?.constraints?.[toolName]) return null;
  const spec = profile.constraints[toolName];

  if (toolName === 'bash' && spec.command_regex) {
    const command = String(args?.command || '');
    let re;
    try {
      re = new RegExp(spec.command_regex);
    } catch (err) {
      return 'Invalid profile bash command_regex: ' + err.message;
    }
    if (!re.test(command)) {
      return 'Command blocked by profile "' + profile.id + '": must match /' + spec.command_regex + '/';
    }
  }

  if ((toolName === 'write_file' || toolName === 'edit_file') && spec.max_bytes) {
    const maxBytes = Number(spec.max_bytes);
    if (Number.isFinite(maxBytes) && maxBytes > 0) {
      const payload = toolName === 'write_file' ? args?.content : args?.new_string;
      const bytes = Buffer.byteLength(String(payload || ''), 'utf8');
      if (bytes > maxBytes) {
        return 'Write blocked by profile "' + profile.id + '": ' + bytes + ' bytes exceeds max_bytes ' + maxBytes;
      }
    }
  }

  return null;
}

function applyToolProfileToRunOptions(options = {}) {
  if (!options.toolProfileName) return options;
  const cwd = options.cwd || process.cwd();
  const profile = loadToolProfile(options.toolProfileName, { cwd });
  if (!profile) {
    throw new Error('Unknown tool capability profile: ' + options.toolProfileName);
  }
  return { ...options, toolProfile: profile };
}

module.exports = {
  BUILTIN_PROFILES,
  loadToolProfile,
  listToolProfiles,
  formatProfileList,
  computeAllowedTools,
  isToolVisible,
  checkProfileConstraints,
  applyToolProfileToRunOptions,
  profileDirs,
};
