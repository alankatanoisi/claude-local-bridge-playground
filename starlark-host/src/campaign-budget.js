'use strict';

/**
 * campaign-budget.js — durable, cross-process campaign budget ledger (R1+R2).
 *
 * The in-memory CostBudget in bridge.js prevents one process from overbooking
 * itself, but separate commands used to start separate budgets, so a multi-
 * command campaign needed a human to shrink the allowance by hand after every
 * run. This module makes the campaign itself the accounting authority:
 *
 *   ~/.bridge-runner/campaigns/<campaignId>/budget.ledger.jsonl
 *
 * - Append-only JSONL with monotonic sequence numbers (same discipline as the
 *   runner's session-ledger.js). Records are never rewritten; corrections are
 *   new records.
 * - Every state-changing operation happens under an exclusive-create lock
 *   file, so two processes reserving concurrently serialize instead of both
 *   passing the same ceiling check.
 * - Reservations carry the reserving PID. During replay, a reservation whose
 *   process is no longer alive is released with an explicit `stale_pid`
 *   record, so a crashed command cannot permanently strand allowance.
 * - Metering is in DOLLARS (R2). Settlement costUsd comes from the runner's
 *   cache-aware estimateCostUsd via summarizeUsage, so cache-read and
 *   cache-creation tokens move the remaining balance like any other spend.
 *
 * The public surface mirrors CostBudget (reserve/settle/release/record plus
 * usedUsd/reservedUsd/calls), with one difference: the methods are async
 * because they take the cross-process lock. bridge.js awaits them, which
 * works transparently for the synchronous CostBudget too.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LEDGER_VERSION = 1;
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 5_000;
const LOCK_RETRY_DELAY_MS = 25;

function defaultCampaignRoot() {
  return path.join(os.homedir(), '.bridge-runner', 'campaigns');
}

function generateCampaignId() {
  return `campaign-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pidIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user — alive.
    return error.code === 'EPERM';
  }
}

function normalizeMoneyFloat(value) {
  // Binary floating point leaves sub-picodollar residue after balanced
  // reserve/release cycles; treat it as zero so replays stay clean.
  return Math.abs(value) < 1e-12 ? 0 : value;
}

class DurableCampaignBudget {
  /** Use openCampaignBudget() — constructors cannot await the lock. */
  constructor({ campaignId, dir }) {
    this.campaignId = campaignId;
    this.campaignDir = path.join(dir, campaignId);
    this.ledgerPath = path.join(this.campaignDir, 'budget.ledger.jsonl');
    this.lockPath = path.join(this.campaignDir, 'budget.lock');
    this.limitUsd = 0;
    // Cached view of the last replay, refreshed under the lock on every
    // operation. Readers (coordinator, summaries) see the values as of the
    // most recent operation this process performed.
    this._state = { usedUsd: 0, reservedUsd: 0, calls: [], openReservations: new Map(), lastSeq: 0 };
  }

  get usedUsd() {
    return this._state.usedUsd;
  }

  get reservedUsd() {
    return this._state.reservedUsd;
  }

  get calls() {
    return this._state.calls;
  }

  get remainingUsd() {
    return normalizeMoneyFloat(this.limitUsd - this._state.usedUsd - this._state.reservedUsd);
  }

  async _open(limitUsd) {
    fs.mkdirSync(this.campaignDir, { recursive: true, mode: 0o700 });
    await this._withLock(() => {
      if (!fs.existsSync(this.ledgerPath)) {
        if (!Number.isFinite(limitUsd) || limitUsd <= 0) {
          throw new Error(`new campaign '${this.campaignId}' requires a positive dollar limit`);
        }
        this.limitUsd = limitUsd;
        this._append({ type: 'campaign_open', campaignId: this.campaignId, limitUsd });
        this._replay();
        return;
      }
      this._replay();
      if (Number.isFinite(limitUsd) && limitUsd > 0 && limitUsd !== this.limitUsd) {
        throw new Error(
          `campaign '${this.campaignId}' already has a $${this.limitUsd.toFixed(2)} cap; ` +
            `refusing the requested $${limitUsd.toFixed(2)} (caps never change silently — start a new campaign instead)`,
        );
      }
    });
    return this;
  }

  async reserve(estimatedUsd, label) {
    return this._withLock(() => {
      this._replay();
      if (this._state.usedUsd + this._state.reservedUsd + estimatedUsd > this.limitUsd) {
        throw new Error(
          `cost gate blocked ${label}: estimated $${estimatedUsd.toFixed(4)} would exceed ` +
            `campaign '${this.campaignId}' cap $${this.limitUsd.toFixed(2)} ` +
            `(used $${this._state.usedUsd.toFixed(4)}, reserved $${this._state.reservedUsd.toFixed(4)})`,
        );
      }
      const reservationId = `res_${process.pid}_${crypto.randomBytes(4).toString('hex')}`;
      this._append({ type: 'reserve', reservationId, estimatedUsd, label });
      this._replay();
      return reservationId;
    });
  }

  async settle(reservationId, entry) {
    return this._withLock(() => {
      this._replay();
      if (!this._state.openReservations.has(reservationId)) {
        throw new Error(`unknown cost reservation ${reservationId}`);
      }
      this._append({
        type: 'settle',
        reservationId,
        costUsd: entry.costUsd,
        label: entry.label || null,
        model: entry.model || null,
        usage: entry.usage || null,
      });
      this._replay();
      if (this._state.usedUsd > this.limitUsd) {
        throw new Error(
          `estimated campaign cost $${this._state.usedUsd.toFixed(4)} exceeded cap ` +
            `$${this.limitUsd.toFixed(2)} after ${entry.label}`,
        );
      }
    });
  }

  async release(reservationId, reason = 'caller_release') {
    return this._withLock(() => {
      this._replay();
      // Match CostBudget.release: releasing an unknown/settled id is a no-op.
      if (!this._state.openReservations.has(reservationId)) return;
      this._append({ type: 'release', reservationId, reason });
      this._replay();
    });
  }

  /** Settlement without a prior reservation (mock calls, external charges). */
  async record(entry) {
    return this._withLock(() => {
      this._replay();
      this._append({
        type: 'record',
        costUsd: entry.costUsd || 0,
        label: entry.label || null,
        model: entry.model || null,
        usage: entry.usage || null,
      });
      this._replay();
    });
  }

  toJSON() {
    return {
      campaignId: this.campaignId,
      ledgerPath: this.ledgerPath,
      limitUsd: this.limitUsd,
      usedUsd: this._state.usedUsd,
      reservedUsd: this._state.reservedUsd,
      remainingUsd: this.remainingUsd,
      calls: this._state.calls,
    };
  }

  _append(payload) {
    const event = {
      v: LEDGER_VERSION,
      seq: this._state.lastSeq + 1,
      ts: new Date().toISOString(),
      pid: process.pid,
      ...payload,
    };
    // Open-append-fsync-close per event: cross-process appends are already
    // serialized by the lock, and fsync means a settle survives a crash that
    // happens immediately afterwards (the A1 durability lesson).
    const fd = fs.openSync(this.ledgerPath, 'a', 0o600);
    try {
      fs.writeSync(fd, JSON.stringify(event) + '\n');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    this._state.lastSeq = event.seq;
  }

  _replay() {
    const state = { usedUsd: 0, reservedUsd: 0, calls: [], openReservations: new Map(), lastSeq: 0 };
    if (!fs.existsSync(this.ledgerPath)) {
      this._state = state;
      return;
    }
    const lines = fs.readFileSync(this.ledgerPath, 'utf8').trim().split('\n').filter(Boolean);
    const staleReleases = [];
    for (const line of lines) {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue; // a torn write cannot poison the whole campaign
      }
      if (event.seq > state.lastSeq) state.lastSeq = event.seq;
      if (event.type === 'campaign_open') {
        this.limitUsd = event.limitUsd;
      } else if (event.type === 'reserve') {
        state.openReservations.set(event.reservationId, event);
      } else if (event.type === 'settle') {
        state.openReservations.delete(event.reservationId);
        state.usedUsd += event.costUsd || 0;
        state.calls.push(event);
      } else if (event.type === 'release') {
        state.openReservations.delete(event.reservationId);
      } else if (event.type === 'record') {
        state.usedUsd += event.costUsd || 0;
        state.calls.push(event);
      }
    }
    this._state = state;
    // Stale sweep: a reservation from a dead process would strand allowance
    // forever. Release it explicitly — as a ledger record, so the evidence of
    // both the crash and the correction is preserved.
    for (const [reservationId, reservation] of state.openReservations) {
      if (reservation.pid !== process.pid && !pidIsAlive(reservation.pid)) {
        staleReleases.push(reservationId);
      }
    }
    for (const reservationId of staleReleases) {
      this._append({ type: 'release', reservationId, reason: 'stale_pid' });
      state.openReservations.delete(reservationId);
    }
    let reserved = 0;
    for (const reservation of state.openReservations.values()) {
      reserved += reservation.estimatedUsd || 0;
    }
    state.reservedUsd = normalizeMoneyFloat(reserved);
    state.usedUsd = normalizeMoneyFloat(state.usedUsd);
  }

  async _withLock(fn) {
    const started = Date.now();
    let fd = null;
    for (;;) {
      try {
        fd = fs.openSync(this.lockPath, 'wx', 0o600);
        break;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (this._breakStaleLock()) continue;
        if (Date.now() - started > LOCK_WAIT_MS) {
          throw new Error(
            `could not acquire campaign budget lock ${this.lockPath} within ${LOCK_WAIT_MS}ms`,
          );
        }
        await sleep(LOCK_RETRY_DELAY_MS);
      }
    }
    try {
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, ts: new Date().toISOString() }));
      return fn();
    } finally {
      fs.closeSync(fd);
      try {
        fs.unlinkSync(this.lockPath);
      } catch {
        // already removed — nothing to do
      }
    }
  }

  _breakStaleLock() {
    let holder = null;
    try {
      holder = JSON.parse(fs.readFileSync(this.lockPath, 'utf8'));
    } catch {
      // unreadable or vanished lock: fall through to the age check below
    }
    if (holder && pidIsAlive(holder.pid)) {
      const age = Date.now() - Date.parse(holder.ts || 0);
      if (!(age > LOCK_STALE_MS)) return false;
    }
    // Holder is dead, unreadable, or has sat on the lock far longer than any
    // legitimate locked section (which does no network work). Reclaim it.
    try {
      fs.unlinkSync(this.lockPath);
      return true;
    } catch {
      return false; // someone else reclaimed it first — retry the open
    }
  }
}

async function openCampaignBudget({ campaignId, limitUsd, dir = defaultCampaignRoot() }) {
  const id = campaignId || generateCampaignId();
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
    throw new Error(`campaign id must be filesystem-safe: '${id}'`);
  }
  const budget = new DurableCampaignBudget({ campaignId: id, dir });
  return budget._open(limitUsd);
}

module.exports = {
  DurableCampaignBudget,
  defaultCampaignRoot,
  generateCampaignId,
  openCampaignBudget,
};
