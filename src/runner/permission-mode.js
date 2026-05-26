'use strict';

/**
 * permission-mode.js — Map Claude Code-style permission modes to runner flags.
 */

const MODES = Object.freeze({
  default: { acceptEdits: false, dontAsk: false, plan: false, allowShell: false },
  plan: { acceptEdits: false, dontAsk: false, plan: true, allowShell: false },
  'accept-edits': { acceptEdits: true, dontAsk: false, plan: false, allowShell: false },
  acceptEdits: { acceptEdits: true, dontAsk: false, plan: false, allowShell: false },
  'dont-ask': { acceptEdits: false, dontAsk: true, plan: false, allowShell: false },
  dontAsk: { acceptEdits: false, dontAsk: true, plan: false, allowShell: false },
  'accept-edits-dont-ask': {
    acceptEdits: true,
    dontAsk: true,
    plan: false,
    allowShell: false,
  },
  auto: { acceptEdits: false, dontAsk: true, plan: false, allowShell: false },
});

function normalizePermissionMode(raw) {
  if (!raw) return null;
  const key = String(raw).trim();
  if (!key) return null;
  if (!MODES[key]) {
    throw new Error(
      '--permission-mode must be one of: default, plan, accept-edits, dont-ask, accept-edits-dont-ask, auto',
    );
  }
  return key;
}

function applyPermissionMode(base, modeName) {
  const mode = MODES[modeName];
  if (!mode) return base;
  return {
    ...base,
    acceptEdits: mode.acceptEdits,
    dontAsk: mode.dontAsk,
    plan: mode.plan,
    allowShell: mode.allowShell,
  };
}

module.exports = {
  MODES,
  normalizePermissionMode,
  applyPermissionMode,
};
