'use strict';

/**
 * budget-broker.js — Atomic child budget leases (P1-05).
 *
 * Parent remainder is not copied to every child. Instead the parent leases a
 * slice of the still-unleased remainder to each child, then reconciles the
 * child's actual usage (or marks the child incomplete) when the spawn returns.
 *
 * Spend accounting stays on the caller's totalUsage: release() returns the
 * child usage so the caller can addUsage() it. Active leases reserve tokens
 * that must not be handed to a second child while the first is still running.
 *
 * Acceptance:
 *   - sum(active leases) + totalUsage never exceeds the parent hard caps
 *   - parent final usage includes every child, or marks child_usage_incomplete
 *
 * Caps of null mean "no budget on this dimension" — leasing is a no-op there.
 */

const crypto = require('crypto');

function parseCap(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

function createBudgetBroker(options = {}) {
  const inputCap = parseCap(options.inputCap);
  const outputCap = parseCap(options.outputCap);
  // leaseId -> { input, output }
  const activeLeases = new Map();
  // Children whose usage could not be reconciled.
  const incomplete = [];

  function leasedTotals() {
    let input = 0;
    let output = 0;
    for (const lease of activeLeases.values()) {
      input += lease.input || 0;
      output += lease.output || 0;
    }
    return { input, output };
  }

  /**
   * Remaining tokens that are not yet in totalUsage and not reserved by an
   * active child lease. This is what a new acquire() may claim.
   */
  function unleasedRemaining(totalUsage) {
    const leased = leasedTotals();
    const usedIn = (totalUsage && totalUsage.input_tokens) || 0;
    const usedOut = (totalUsage && totalUsage.output_tokens) || 0;
    return {
      input_tokens: inputCap !== null ? Math.max(0, inputCap - usedIn - leased.input) : null,
      output_tokens: outputCap !== null ? Math.max(0, outputCap - usedOut - leased.output) : null,
    };
  }

  /**
   * Reserve a lease for a child. Returns null when a hard-capped dimension has
   * nothing left. Unconstrained (no parent caps) returns leaseId:null.
   */
  function acquire(totalUsage, request = {}) {
    if (inputCap === null && outputCap === null) {
      return { leaseId: null, input_tokens: null, output_tokens: null, unconstrained: true };
    }

    const rem = unleasedRemaining(totalUsage);
    const wantInput =
      typeof request.input_tokens === 'number' && rem.input_tokens !== null
        ? Math.min(Math.max(0, Math.floor(request.input_tokens)), rem.input_tokens)
        : rem.input_tokens;
    const wantOutput =
      typeof request.output_tokens === 'number' && rem.output_tokens !== null
        ? Math.min(Math.max(0, Math.floor(request.output_tokens)), rem.output_tokens)
        : rem.output_tokens;

    // Refuse when any capped dimension is exhausted — a child with 0 input
    // budget cannot usefully run even if output remains.
    if (inputCap !== null && (wantInput === null || wantInput <= 0)) return null;
    if (outputCap !== null && (wantOutput === null || wantOutput <= 0)) return null;

    const leaseId = 'lease_' + crypto.randomBytes(4).toString('hex');
    activeLeases.set(leaseId, {
      input: wantInput || 0,
      output: wantOutput || 0,
    });
    return {
      leaseId,
      input_tokens: wantInput,
      output_tokens: wantOutput,
      unconstrained: false,
    };
  }

  /**
   * Return a lease. Pass actualUsage so the caller can fold it into totalUsage;
   * omit it (or pass null) to mark the child incomplete.
   */
  function release(leaseId, actualUsage) {
    if (leaseId && activeLeases.has(leaseId)) {
      activeLeases.delete(leaseId);
    } else if (leaseId) {
      return { reconciled: false, incomplete: true, reason: 'unknown_lease' };
    }

    if (actualUsage && typeof actualUsage === 'object') {
      return {
        reconciled: true,
        usage: {
          input_tokens: actualUsage.input_tokens || 0,
          output_tokens: actualUsage.output_tokens || 0,
          cache_read_input_tokens: actualUsage.cache_read_input_tokens || 0,
          cache_creation_input_tokens: actualUsage.cache_creation_input_tokens || 0,
        },
      };
    }

    if (leaseId) {
      incomplete.push({ leaseId, at: new Date().toISOString() });
      return { reconciled: false, incomplete: true };
    }
    // Unconstrained spawn with no usage — nothing to mark.
    return { reconciled: false, incomplete: false, unconstrained: true };
  }

  function hasIncompleteChildren() {
    return incomplete.length > 0;
  }

  function snapshot(totalUsage) {
    const leased = leasedTotals();
    return {
      caps: { input_tokens: inputCap, output_tokens: outputCap },
      used: {
        input_tokens: (totalUsage && totalUsage.input_tokens) || 0,
        output_tokens: (totalUsage && totalUsage.output_tokens) || 0,
      },
      leased: { input_tokens: leased.input, output_tokens: leased.output },
      unleased: unleasedRemaining(totalUsage),
      active_leases: activeLeases.size,
      incomplete: incomplete.slice(),
    };
  }

  return {
    acquire,
    release,
    unleasedRemaining,
    hasIncompleteChildren,
    snapshot,
    inputCap,
    outputCap,
  };
}

module.exports = {
  createBudgetBroker,
  parseCap,
};
