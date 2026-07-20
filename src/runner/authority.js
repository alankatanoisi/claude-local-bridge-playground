'use strict';

/**
 * authority.js — Immutable per-run authority ceiling (WP2 core).
 *
 * The ceiling is frozen once from the explicit CLI-derived flags at run start.
 * Everything downstream (permission checks, force execution, child spawns) may
 * only NARROW authority relative to the ceiling — never widen it. This makes
 * authority monotonic: no profile, hook, tool, or mid-run ctx mutation can add
 * shell access, expose extra tools, escape plan mode, or drop --no-network.
 *
 * The one deliberate non-ceiling channel is per-action user confirmation:
 * executeForce (running a write the user just approved) escalates
 * acceptEdits/dontAsk for that single permission check. That is a human
 * consent path, not an authority widening, so the ceiling does not block it —
 * but the ceiling's plan bit DOES block force-execution of effectful tools,
 * because plan mode has no approval flow that could have consented.
 *
 * Ceiling fields:
 *   allowShell : false ⇒ shell tools stay denied even if ctx.allowShell flips
 *   plan       : true  ⇒ the run can never leave plan mode
 *   noNetwork  : true  ⇒ the network guard can never be dropped
 *   tools      : Set|null ⇒ hard upper bound on tool exposure (--tools list);
 *                null means "the default visible set", not "everything"
 */

const EFFECTFUL_CATEGORIES = new Set(['write', 'shell', 'recovery', 'orchestration', 'worktree']);

/**
 * Build and freeze the ceiling from the run's initial ctx (CLI-derived flags).
 * Call exactly once per run, before the first model request.
 */
function createAuthorityCeiling(ctx) {
  const ceiling = Object.freeze({
    allowShell: !!ctx.allowShell,
    plan: !!ctx.plan,
    noNetwork: !!ctx.noNetwork,
    tools: ctx._cliToolAllowlist ? Object.freeze(new Set(ctx._cliToolAllowlist)) : null,
  });
  return ceiling;
}

/**
 * Effective flags = ctx flags clamped to the ceiling. Used by the permission
 * gate so a mid-run mutation of ctx (bug, hook, or hostile input) cannot
 * exceed what the operator chose on the command line.
 */
function effectiveFlags(ctx) {
  const ceiling = ctx && ctx.authorityCeiling;
  if (!ceiling) {
    return { allowShell: !!ctx.allowShell, plan: !!ctx.plan, noNetwork: !!ctx.noNetwork };
  }
  return {
    // Shell can be narrowed mid-run (ctx false) but never widened above the ceiling.
    allowShell: !!ctx.allowShell && ceiling.allowShell,
    // Plan and noNetwork are one-way restrictions: once on, always on.
    plan: !!ctx.plan || ceiling.plan,
    noNetwork: !!ctx.noNetwork || ceiling.noNetwork,
  };
}

/**
 * True when the ceiling's tools allowlist excludes this tool. A null tools
 * ceiling means the operator did not pass --tools; the ordinary visibility
 * gates apply and the ceiling has no tool opinion.
 */
function toolAboveCeiling(toolName, ctx) {
  const ceiling = ctx && ctx.authorityCeiling;
  if (!ceiling || !ceiling.tools) return false;
  return !ceiling.tools.has(toolName);
}

/**
 * Plan ceiling gate for force execution: plan mode has no user-approval flow,
 * so nothing can legitimately force-execute an effectful tool under it.
 */
function planCeilingBlocksForce(toolName, category, ctx) {
  const ceiling = ctx && ctx.authorityCeiling;
  if (!ceiling || !ceiling.plan) return false;
  return EFFECTFUL_CATEGORIES.has(category);
}

/**
 * Intersect a child spawn request with the parent ceiling. Children may only
 * narrow: requested flags AND parent ceiling; requested tools ∩ ceiling tools.
 */
function narrowChildAuthority(parentCeiling, requested = {}) {
  if (!parentCeiling) {
    return {
      allowShell: !!requested.allowShell,
      acceptEdits: !!requested.acceptEdits,
      dontAsk: !!requested.dontAsk,
      tools: Array.isArray(requested.tools) ? [...requested.tools] : null,
    };
  }
  let tools = Array.isArray(requested.tools) ? [...requested.tools] : null;
  if (tools && parentCeiling.tools) {
    tools = tools.filter((name) => parentCeiling.tools.has(name));
  }
  return {
    allowShell: !!requested.allowShell && parentCeiling.allowShell,
    // Plan-ceiling parents must not hand children write/automation authority.
    acceptEdits: !!requested.acceptEdits && !parentCeiling.plan,
    dontAsk: !!requested.dontAsk && !parentCeiling.plan,
    tools,
  };
}

module.exports = {
  createAuthorityCeiling,
  effectiveFlags,
  toolAboveCeiling,
  planCeilingBlocksForce,
  narrowChildAuthority,
  EFFECTFUL_CATEGORIES,
};
