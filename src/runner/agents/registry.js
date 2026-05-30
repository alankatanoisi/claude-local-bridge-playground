'use strict';

/**
 * Built-in runner personalities — tools, limits, context defaults, and prompt addons.
 */

const { applyPermissionMode } = require('../permission-mode');

const PROFILES = Object.freeze({
  explore: {
    id: 'explore',
    description: 'Read-only codebase exploration (minimal context)',
    allowedTools: ['list_files', 'read_file', 'search_text', 'git_status'],
    maxSteps: 8,
    trustMode: 'inherit',
    spawnMode: 'worker',
    forkAllowed: false,
    outputSchema: 'findings',
    context: { minimal: true },
    systemPromptAddon: 'Explore the codebase read-only. Summarize structure and answer the user question.',
  },
  plan: {
    id: 'plan',
    description: 'Plan mode — describe actions without executing writes',
    allowedTools: ['list_files', 'read_file', 'search_text', 'git_status'],
    maxSteps: 10,
    trustMode: 'inherit',
    spawnMode: 'kernel',
    forkAllowed: false,
    plan: true,
    permissionMode: 'plan',
    outputSchema: 'findings',
    context: { minimal: true },
    systemPromptAddon: 'Inspect first. Propose a plan; do not execute writes or shell unless the user asks.',
  },
  implement: {
    id: 'implement',
    description: 'Write-capable implementation agent',
    allowedTools: [
      'list_files',
      'read_file',
      'search_text',
      'git_status',
      'edit_file',
      'write_file',
      'undo',
      'undo_edit',
    ],
    maxSteps: 16,
    trustMode: 'inherit',
    spawnMode: 'kernel',
    forkAllowed: false,
    permissionMode: 'accept-edits',
    outputSchema: 'findings',
    context: { minimal: true },
    systemPromptAddon: 'Implement the requested change with small, verifiable edits.',
  },
  verify: {
    id: 'verify',
    description: 'Read-only verification of repo state',
    allowedTools: ['list_files', 'read_file', 'search_text', 'git_status'],
    maxSteps: 6,
    trustMode: 'inherit',
    spawnMode: 'worker',
    forkAllowed: false,
    outputSchema: 'findings',
    context: { minimal: true },
    systemPromptAddon: 'Verify claims against the repository; cite files and commands where possible.',
  },
  test: {
    id: 'test',
    description: 'Test-running specialist (shell optional)',
    allowedTools: ['list_files', 'read_file', 'search_text', 'git_status', 'bash'],
    maxSteps: 8,
    trustMode: 'inherit',
    spawnMode: 'worker',
    forkAllowed: false,
    allowShell: true,
    outputSchema: 'findings',
    context: { minimal: true },
    systemPromptAddon: 'Run tests or validation commands and report failures clearly.',
  },
  replay: {
    id: 'replay',
    description: 'Ledger debugger — read-only session analysis',
    allowedTools: ['list_files', 'read_file', 'search_text'],
    maxSteps: 4,
    trustMode: 'inherit',
    spawnMode: 'worker',
    forkAllowed: false,
    outputSchema: 'findings',
    context: { minimal: true },
  },
  extractor: {
    id: 'extractor',
    description: 'Background session learning — proposes memory entries',
    allowedTools: ['list_files', 'read_file', 'search_text'],
    maxSteps: 6,
    trustMode: 'trusted_required',
    spawnMode: 'worker',
    forkAllowed: false,
    outputSchema: 'findings',
    context: { minimal: true },
  },
  project: {
    id: 'project',
    description: 'Richer context — instruction docs, repo fingerprint, repo map (legacy-style)',
    allowedTools: null,
    maxSteps: 16,
    trustMode: 'inherit',
    spawnMode: 'kernel',
    forkAllowed: false,
    context: {
      minimal: false,
      includeInstructionDocs: true,
      includeRepoContext: true,
      includeClaudeMdInRepoContext: false,
      includeRepoMap: true,
      includeSkills: true,
    },
    systemPromptAddon: 'Use project instruction files and repository context when they help.',
  },
});

function getProfile(id) {
  return PROFILES[id] || null;
}

function listProfiles() {
  return Object.values(PROFILES);
}

function formatAgentList() {
  const lines = ['Built-in runner personalities (--agent <id>):\n'];
  for (const p of listProfiles()) {
    lines.push('  ' + p.id.padEnd(12) + p.description);
  }
  lines.push('\nDefault startup context is minimal. Use --agent project or context flags for richer injection.');
  return lines.join('\n');
}

function applyProfileToRunOptions(profileId, baseOptions = {}) {
  const profile = getProfile(profileId);
  if (!profile) throw new Error('Unknown agent profile: ' + profileId);

  let merged = {
    ...baseOptions,
    agentProfile: profile.id,
    maxSteps: profile.maxSteps ?? baseOptions.maxSteps,
    plan: profile.plan ?? baseOptions.plan,
    allowShell: profile.allowShell ?? baseOptions.allowShell,
  };

  if (profile.allowedTools) {
    merged.exposedTools = profile.allowedTools;
    merged.allowedTools = profile.allowedTools;
  }
  if (profile.model && !baseOptions.model) merged.model = profile.model;
  if (profile.effort && !baseOptions.effort) merged.effort = profile.effort;

  if (profile.permissionMode) {
    merged = applyPermissionMode(merged, profile.permissionMode);
  }

  if (profile.context) {
    merged.profileContext = { ...(baseOptions.profileContext || {}), ...profile.context };
  }

  if (profile.systemPromptAddon) {
    const prior = baseOptions.appendSystemPrompt || '';
    merged.appendSystemPrompt = prior ? prior + '\n\n' + profile.systemPromptAddon : profile.systemPromptAddon;
  }

  return merged;
}

/** Enforce single-level fork boundary. */
function assertForkAllowed(spawnDepth) {
  if (spawnDepth > 0) {
    throw new Error('Child agents cannot spawn further children (fork depth exceeded).');
  }
}

module.exports = {
  PROFILES,
  getProfile,
  listProfiles,
  formatAgentList,
  applyProfileToRunOptions,
  assertForkAllowed,
};
