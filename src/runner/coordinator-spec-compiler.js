'use strict';

/**
 * Coordinator spec compiler — structured synthesis with inspectable notes.
 */

function isVagueDigest(digest) {
  if (!digest || digest.length < 40) return true;
  const vague = ['based on your findings', '(none)', '(research skipped'];
  const lower = digest.toLowerCase();
  return vague.some((v) => lower.includes(v)) && digest.length < 120;
}

function isPassThrough(objective, digest, spec) {
  if (!digest) return false;
  const digestSlice = digest.slice(0, 500).trim();
  return spec.includes(digestSlice) && !spec.includes('Implementation spec');
}

/**
 * Compile structured spec from objective and worker evidence.
 * @param {string} objective
 * @param {object[]} workerResults — { summary, claims?, evidencePaths?, confidence? }
 * @returns {{ spec: string, structured: object, rejected: boolean, reason?: string }}
 */
function compileSpec(objective, workerResults = []) {
  const findings = [];
  const discarded = [];
  const evidencePaths = new Set();

  for (const wr of workerResults) {
    if (wr.claims && Array.isArray(wr.claims)) {
      for (const c of wr.claims) findings.push(c);
    } else if (wr.summary && !isVagueDigest(wr.summary)) {
      findings.push(wr.summary.slice(0, 800));
    } else if (wr.summary) {
      discarded.push('vague worker digest omitted');
    }
    if (wr.evidencePaths) {
      for (const p of wr.evidencePaths) evidencePaths.add(p);
    }
  }

  const researchDigest = findings.join('\n\n') || '(no evidence-bearing findings)';

  if (workerResults.length > 0 && isVagueDigest(researchDigest)) {
    return {
      spec: null,
      structured: null,
      rejected: true,
      reason: 'empty_or_vague_research_digest',
    };
  }

  const synthesisNotes = {
    extracted: findings.slice(0, 10),
    discarded,
    inferred: [
      'Work only inside project cwd',
      'Prefer read-only inspection before writes',
      'Produce concrete final answer when done',
    ],
  };

  const structured = {
    objective,
    constraints: ['cwd confinement', 'safety defaults preserved'],
    researchFindings: findings.map((f, i) => ({ id: i, text: f, evidencePaths: [...evidencePaths] })),
    allowedFiles: [...evidencePaths],
    taskPlan: ['Inspect relevant files', 'Apply minimal changes', 'Verify outcome'],
    acceptanceChecks: ['Objective addressed', 'No safety violations'],
    risks: discarded.length ? ['Some worker output was too vague and was discarded'] : [],
    openQuestions: findings.length === 0 ? ['Need more research before implementation'] : [],
    verificationPlan: 'Re-read changed files and run tests if available',
    synthesisNotes,
  };

  const spec =
    '## Objective\n' +
    objective +
    '\n\n## Research findings\n' +
    researchDigest +
    '\n\n## Implementation spec\n' +
    structured.taskPlan.map((t) => '- ' + t).join('\n') +
    '\n\n## Synthesis notes\n' +
    '- Extracted: ' +
    synthesisNotes.extracted.length +
    ' items\n' +
    '- Discarded: ' +
    (discarded.length ? discarded.join('; ') : 'none') +
    '\n' +
    '- Inferred rules: ' +
    synthesisNotes.inferred.join('; ') +
    '\n';

  if (isPassThrough(objective, researchDigest, spec)) {
    return { spec: null, structured: null, rejected: true, reason: 'pass_through_digest' };
  }

  return { spec, structured, rejected: false, synthesisNotes };
}

module.exports = {
  compileSpec,
  isVagueDigest,
};
