'use strict';

/**
 * run_skill — load and return a project skill document body (read-only execution).
 */

const path = require('path');
const { loadSkillBody, resolveSkillEntry } = require('../skills/skills-index');

const MAX_SKILL_OUTPUT_CHARS = 16_000;

function definition() {
  return {
    name: 'run_skill',
    description:
      'Load a skill document by name from .bridge-runner/skills/ or .cursor/skills/ and return its body. ' +
      'Read-only: does not execute shell or network actions embedded in the skill text.',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Skill id/name (filename without .md or frontmatter name)',
        },
      },
      required: ['name'],
    },
  };
}

function execute(args, ctx) {
  const name = String(args.name || '').trim();
  if (!name) return { ok: false, text: 'run_skill requires name.' };

  const cwd = ctx.cwdRealpath || ctx.cwd || process.cwd();
  const entry = resolveSkillEntry(cwd, name);
  if (!entry) {
    return {
      ok: false,
      text:
        'Skill not found: ' +
        name +
        '. Use --include-skills to list metadata, or add .bridge-runner/skills/' +
        name +
        '.md',
    };
  }

  const body = loadSkillBody(entry);
  if (!body) return { ok: false, text: 'Skill file empty or unreadable: ' + entry.filePath };

  const rel = path.relative(cwd, entry.filePath) || entry.filePath;
  const header = '# Skill: ' + entry.id + '\nsource: ' + rel + '\n\n';
  let text = header + body;
  if (text.length > MAX_SKILL_OUTPUT_CHARS) {
    text = text.slice(0, MAX_SKILL_OUTPUT_CHARS) + '\n... [skill output truncated]';
  }
  return { ok: true, text, bytes: text.length };
}

module.exports = {
  definition,
  execute,
  meta: { name: 'run_skill', category: 'read-only' },
};
