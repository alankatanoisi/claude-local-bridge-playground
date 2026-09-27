'use strict';

const fs = require('fs');
const path = require('path');
const { contentHash } = require('./plan-hash');

// A returned planner response has already been paid for. Its receipt remains
// pending until local evaluation either accepts or rejects that same attempt.
// Cancellation is neither verdict, so it must leave the receipt reusable.
function pendingPlannerResponse({ events, ledger, phaseLabel, acceptedEvent, plannerLadder, inputHash }) {
  const received = events.filter((event) => event.type === `${phaseLabel}_response_received`).at(-1);
  if (!received) return null; // Older runs have no resumable response receipt.
  const terminal = events.some(
    (event) =>
      event.seq > received.seq &&
      (event.type === acceptedEvent ||
        (event.type === `${phaseLabel}_rejected` && event.payload.attempt === received.payload.globalAttempt)),
  );
  if (terminal) return null;
  const receipt = received.payload;
  if (
    !Number.isInteger(receipt.ladderIndex) ||
    receipt.ladderIndex < 0 ||
    plannerLadder[receipt.ladderIndex] !== receipt.model ||
    ![1, 2].includes(receipt.attempt) ||
    !Number.isInteger(receipt.attemptOffset) ||
    receipt.attemptOffset < 0 ||
    receipt.globalAttempt !== receipt.attemptOffset + receipt.attempt ||
    receipt.inputHash !== inputHash
  ) {
    throw new Error('saved planner response metadata/input hash mismatch; refusing resume');
  }
  // Receipts cannot redirect resume to a sibling file or a symlink outside
  // artifacts/. Validate the location before reading any source bytes.
  if (typeof receipt.artifact !== 'string') throw new Error('saved planner response has no artifact');
  const artifact = path.resolve(ledger.runDir, receipt.artifact);
  const root = fs.realpathSync(ledger.artifactDir) + path.sep;
  if (
    !artifact.startsWith(path.resolve(ledger.artifactDir) + path.sep) ||
    !fs.realpathSync(artifact).startsWith(root)
  ) {
    throw new Error('saved planner response artifact escapes run artifacts');
  }
  const { source } = JSON.parse(fs.readFileSync(artifact, 'utf8'));
  if (typeof source !== 'string' || contentHash(source) !== receipt.sourceHash) {
    throw new Error('saved planner response source hash mismatch; refusing resume');
  }
  return { ...receipt, source };
}

module.exports = { pendingPlannerResponse };
