'use strict';

/**
 * context-policy.js — Resolve what startup context is injected into the model.
 *
 * Default is minimal: no project markdown docs, no repo-context block, no skills.
 * Richer context is opt-in via explicit CLI flags.
 */

const DEFAULT_POLICY = Object.freeze({
  minimal: true,
  includeInstructionDocs: false,
  includeRepoContext: false,
  includeClaudeMdInRepoContext: false,
  includeRepoMap: false,
  includeSkills: false,
  excludeDynamicFromSystem: false,
});

function envTruthy(name) {
  const v = process.env[name];
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * @param {object} [input]
 * @returns {typeof DEFAULT_POLICY & Record<string, boolean>}
 */
function resolveContextPolicy(input = {}) {
  const bare = !!input.bare || envTruthy('BRIDGE_RUNNER_BARE');
  if (bare) {
    return {
      minimal: true,
      includeInstructionDocs: false,
      includeRepoContext: false,
      includeClaudeMdInRepoContext: false,
      includeRepoMap: false,
      includeSkills: false,
      excludeDynamicFromSystem: !!input.excludeDynamicFromSystem,
    };
  }

  const minimalDefault = input.minimalDefault !== false;

  const policy = {
    minimal: minimalDefault,
    includeInstructionDocs: !!input.includeInstructionDocs || envTruthy('BRIDGE_RUNNER_INCLUDE_INSTRUCTION_DOCS'),
    includeRepoContext: !!input.includeRepoContext || envTruthy('BRIDGE_RUNNER_INCLUDE_REPO_CONTEXT'),
    includeClaudeMdInRepoContext: !!input.includeClaudeMdInRepoContext || envTruthy('BRIDGE_RUNNER_INCLUDE_CLAUDE_MD'),
    includeRepoMap: !!input.includeRepoMap || envTruthy('BRIDGE_RUNNER_INCLUDE_REPO_MAP'),
    includeSkills: !!input.includeSkills || envTruthy('BRIDGE_RUNNER_INCLUDE_SKILLS'),
    excludeDynamicFromSystem: !!input.excludeDynamicFromSystem || envTruthy('BRIDGE_RUNNER_EXCLUDE_DYNAMIC_SYSTEM'),
  };

  if (
    policy.includeInstructionDocs ||
    policy.includeRepoContext ||
    policy.includeClaudeMdInRepoContext ||
    policy.includeRepoMap ||
    policy.includeSkills
  ) {
    policy.minimal = false;
  }

  return policy;
}

module.exports = {
  DEFAULT_POLICY,
  resolveContextPolicy,
};
