'use strict';

/**
 * Memory review workflow — inspect and approve/reject promotion proposals.
 */

const fs = require('fs');
const path = require('path');

function promotionsDir(cwd) {
  return path.join(cwd, '.bridge-runner', 'memory-promotions');
}

function listPendingPromotions(cwd) {
  const dir = promotionsDir(cwd);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function queuePromotion(cwd, entry) {
  const dir = promotionsDir(cwd);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const id = entry.id || 'promo_' + Date.now();
  const filePath = path.join(dir, id + '.json');
  const record = {
    id,
    status: 'pending',
    type: entry.type || 'project',
    topicId: entry.topicId,
    bodyPreview: (entry.body || '').slice(0, 500),
    proposedAt: new Date().toISOString(),
    ...entry,
  };
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2) + '\n', 'utf8');
  return record;
}

function resolvePromotion(cwd, id, decision) {
  const filePath = path.join(promotionsDir(cwd), id + '.json');
  if (!fs.existsSync(filePath)) return null;
  const record = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  record.status = decision === 'approve' ? 'approved' : 'rejected';
  record.resolvedAt = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2) + '\n', 'utf8');
  return record;
}

/** CLI-friendly review summary (interactive approval is caller's job). */
function formatReviewSummary(cwd) {
  const pending = listPendingPromotions(cwd).filter((p) => p.status === 'pending');
  if (pending.length === 0) return 'No pending memory promotions.';
  return (
    'Pending memory promotions (' +
    pending.length +
    '):\n' +
    pending.map((p) => '- [' + p.type + '] ' + p.id + ': ' + (p.bodyPreview || '').slice(0, 80)).join('\n')
  );
}

module.exports = {
  promotionsDir,
  listPendingPromotions,
  queuePromotion,
  resolvePromotion,
  formatReviewSummary,
};
