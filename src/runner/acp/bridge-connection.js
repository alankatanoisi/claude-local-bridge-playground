'use strict';

/**
 * bridge-connection.js — connect the selected bridge host for ONE ACP (Agent
 * Client Protocol) turn, and keep T3's "Bridge connection (local)" activity
 * card honest about how that went.
 *
 * The card is a tool_call update the agent paints itself; it is not a tool
 * the model asked for, and its `_meta.origin` says so. The one rule this file
 * exists to enforce (Cursor thermo-nuclear review 2026-10-17, Medium #3):
 *
 *   EVERY exit path emits exactly ONE terminal tool_call_update — `completed`,
 *   or `failed` with either the error text or the cancelled text — before the
 *   caller gets control back. A turn can be cancelled in the gap after
 *   ensure() has already resolved; before this module that path returned
 *   without finishing the card, and T3 kept showing it as running.
 *
 * Extracted from agent.js's session/prompt handler so the translator does not
 * also drive the host manager (High #2 of the same review).
 */

const { randomUUID } = require('crypto');
const { RpcError, ERROR_CODES } = require('./connection');
const { createRedactionBoundary } = require('../redaction-boundary');

const CARD_TITLE = 'Bridge connection (local)';
const CARD_KIND = 'other';
const CARD_ORIGIN = 'bridge-control';
const CONNECTED_TEXT = 'Connected—sending prompt';
const CANCELLED_TEXT = 'Bridge connection cancelled; no model request was sent.';

/**
 * @param {object} args
 * @param {string} args.sessionId — the ACP session (part of the card id)
 * @param {string} args.host — a key of HOSTS (already validated by the caller)
 * @param {{ ensure: Function }} args.hostManager — src/hosting/ensure.js
 * @param {AbortSignal} args.signal — tripped by session/cancel or stdin close
 * @param {(update: object) => void} args.sendUpdate — emits one session/update
 * @param {() => boolean} args.isCancelled — true once the turn is cancelled
 *   or the client is gone; consulted AFTER ensure() settles, because a cancel
 *   can land between its last abort check and its return
 * @returns {Promise<{ bridgeUrl: string } | { cancelled: true }>}
 * @throws {RpcError} INTERNAL_ERROR with the scrubbed failure text when the
 *   host could not be connected and the turn was not cancelled
 */
async function connectBridgeForTurn({ sessionId, host, hostManager, signal, sendUpdate, isCancelled }) {
  // A process-local counter repeats after T3 restarts. A fresh identifier
  // keeps this attempt from overwriting an older card in T3's history.
  const toolCallId = 'bridge-connection-' + sessionId + '-' + randomUUID();
  sendUpdate({
    sessionUpdate: 'tool_call',
    toolCallId,
    title: CARD_TITLE,
    kind: CARD_KIND,
    status: 'in_progress',
    _meta: { origin: CARD_ORIGIN },
  });
  // Repeat presentation fields on updates: some clients normalize a missing
  // update title to "Tool", replacing the original local label.
  const update = (status, text) =>
    sendUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId,
      title: CARD_TITLE,
      kind: CARD_KIND,
      status,
      rawOutput: text,
      _meta: { origin: CARD_ORIGIN },
    });

  // Decide the outcome first, then paint it: one terminal update, one return.
  let outcome;
  try {
    const connected = await hostManager.ensure(host, { signal, onStatus: (text) => update('in_progress', text) });
    outcome = isCancelled()
      ? { status: 'failed', text: CANCELLED_TEXT, cancelled: true }
      : { status: 'completed', text: CONNECTED_TEXT, bridgeUrl: connected.bridgeUrl };
  } catch (error) {
    outcome = isCancelled()
      ? { status: 'failed', text: CANCELLED_TEXT, cancelled: true }
      : {
          status: 'failed',
          // Host errors name ports and files, never secrets, but every text
          // that reaches a T3 card still passes the one redaction boundary.
          text: createRedactionBoundary().scrubText((error && error.message) || 'Bridge connection failed.'),
          failed: true,
        };
  }
  update(outcome.status, outcome.text);
  if (outcome.failed) throw new RpcError(ERROR_CODES.INTERNAL_ERROR, outcome.text);
  if (outcome.cancelled) return { cancelled: true };
  return { bridgeUrl: outcome.bridgeUrl };
}

module.exports = { connectBridgeForTurn, CARD_TITLE, CANCELLED_TEXT, CONNECTED_TEXT };
