'use strict';

/**
 * Skills index — lazy metadata discovery from project-local skill files.
 */

const fs = require('fs');
const path = require('path');

const PER_ENTRY_CAP = 280;
const TOTAL_CAP = 2800;

function skillsDirs(cwd) {
  return [path.join(cwd, '.bridge-runner', 'skills')];
}

function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };
  const meta = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { meta, body: match[2] };
}

function buildSkillsIndex(cwd) {
  const entries = [];
  let total = 0;

  for (const dir of skillsDirs(cwd)) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.md')) continue;
      const filePath = path.join(dir, name);
      let raw;
      try {
        raw = fs.readFileSync(filePath, 'utf8');
      } catch {
        continue;
      }
      const { meta, body } = parseFrontmatter(raw);
      const id = meta.name || name.replace(/\.md$/, '');
      const desc = (meta.description || body.split('\n')[0] || id).slice(0, PER_ENTRY_CAP);
      const line = '- **' + id + '**: ' + desc;
      if (total + line.length > TOTAL_CAP) break;
      entries.push({ id, filePath, line, description: desc });
      total += line.length;
    }
  }

  const listing = entries.length
    ? '## Available skills (metadata only; request activation to load body)\n\n' + entries.map((e) => e.line).join('\n')
    : '';

  return { entries, listing: listing.slice(0, TOTAL_CAP) };
}

function loadSkillBody(entry) {
  if (!entry || !entry.filePath || !fs.existsSync(entry.filePath)) return null;
  const raw = fs.readFileSync(entry.filePath, 'utf8');
  const { body } = parseFrontmatter(raw);
  return body.trim();
}

module.exports = {
  PER_ENTRY_CAP,
  TOTAL_CAP,
  buildSkillsIndex,
  loadSkillBody,
};
