'use strict';

/**
 * Built-in agent profiles — preset toolsets, limits, and output schemas.
 */

const PROFILES = Object.freeze({
  explore: {
    id: 'explore',
    description: 'Read-only codebase exploration',
    allowedTools: ['list_files', 'read_file', 'search_text', 'git_status'],
    maxSteps: 8,
    trustMode: 'inherit',
    spawnMode: 'worker',
    forkAllowed: false,
    outputSchema: 'findings',
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
    outputSchema: 'findings',
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
      'apply_patch',
      'undo',
      'undo_edit',
    ],
    maxSteps: 16,
    trustMode: 'inherit',
    spawnMode: 'kernel',
    forkAllowed: false,
    outputSchema: 'findings',
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
  },
});

function getProfile(id) {
  return PROFILES[id] || null;
}

function listProfiles() {
  return Object.values(PROFILES);
}

function applyProfileToRunOptions(profileId, baseOptions = {}) {
  const profile = getProfile(profileId);
  if (!profile) throw new Error('Unknown agent profile: ' + profileId);
  return {
    ...baseOptions,
    allowedTools: profile.allowedTools,
    maxSteps: profile.maxSteps ?? baseOptions.maxSteps,
    plan: profile.plan ?? baseOptions.plan,
    allowShell: profile.allowShell ?? baseOptions.allowShell,
    agentProfile: profile.id,
  };
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
  applyProfileToRunOptions,
  assertForkAllowed,
};
