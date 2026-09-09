# Thermo-nuclear review — PR #27 "Invalidate permission cache on policy narrowing" — 2026-09-09

**Reviewer:** Cursor (invariant review seat, per `docs/agent-team-charter-2026-08-25.md`).
**Target:** PR #27, single commit `2abc0df` ("fix(runner): invalidate permission cache on policy narrowing"), merge-base `406423b`. Reviewed against the checked-out code (the main checkout at `/Users/alanman/Developer/claude-local-bridge-playground` currently has this branch's tip checked out, clean).
**Scope rule:** review only. No code changed; findings verified against the code, not against the handoffs. Scratch repro scripts were created, run, and deleted; the tree is clean.
**Prior doc:** `HANDOFF-permission-cache-fix-2026-09-07.md` (the implementing agent's handoff, accurate in everything I re-verified — see "Verification record").

## Verdict

The fix is **correct, minimal, and well-tested for the bug it claims to fix**. Both pre-PR failure modes reproduce on the merge-base code and are closed by the new cache key. One **pre-existing** hole in the same policy-flag family survives the PR and is **masked by one of the PR's own new tests** — that is the only finding that matters. Ship the fix; then fix F1.

## Findings (severity-ranked)

### F1 — P1 (invariant break, no live trigger today): the startup `--no-network` ceiling is droppable at the scanner, and the PR's new test 3 masks it

**What the ceiling promises:** `src/runner/authority.js:20-22` — "`noNetwork: true` ⇒ the network guard can never be dropped." `effectiveFlags` (authority.js:48-59) honors this: `noNetwork: !!ctx.noNetwork || ceiling.noNetwork`.

**Where it breaks:** `src/runner/shell-policy.js:177` reads the **raw** flag:

```js
if (ctx.noNetwork) {
  for (const pat of NETWORK_PATTERNS) { ... issues.push({ kind: 'network_command' ... }) }
}
```

The permission gate's network deny (`src/runner/permissions.js:331-343`) fires on `issue.kind === 'network_command' && eff.noNetwork` — but the issue is only _emitted_ when the raw flag is set. So under a startup ceiling of `noNetwork: true`, a mid-run `ctx.noNetwork = false` leaves `effectiveFlags(ctx).noNetwork === true` yet the scanner emits nothing, the gate's deny branch never runs, and a network command falls through to the mode policy (`allow` under acceptEdits+dontAsk).

**Reproduced against current code** (scratch script, since deleted; cold-cache probe):

```text
1. flag on, cold check      : deny
2. flag cleared, SAME args  : deny (cache hit)
3. flag cleared, NEW args   : allow   <-- ceiling should still deny
   eff.noNetwork still      : true
```

**Why the PR's test doesn't catch it:** `test/runner/permission-decision-cache.test.js:123-130` ("keeps the startup network restriction when its mutable flag is cleared") re-checks the **identical args** after clearing the flag. Identical args → identical cache key → cache **hit** on the first deny. The gate is never re-run. The test certifies an invariant the gate cannot honor cold. (Same-args reuse also means test 3 passes on the _old_ code — it guards `effectiveFlags`-ceiling linkage, not this PR's diff, and not the scanner.)

**Same raw-read family** (all only under the same hypothetical mid-run mutation; none break the gate, but all contradict the ceiling's promise):

- `src/runner/tools/bash.js:48` and `src/runner/background-shell.js:20` — dead-proxy env sandbagging keyed on raw `ctx.noNetwork`.
- `src/runner/child-inherit.js:30` — child inherit bag reads raw `ctx.noNetwork`; note `narrowChildAuthority` (authority.js:87-107) doesn't carry plan/noNetwork at all, so inherit is the only propagation path.
- `src/runner/run.js:863` (worker spawn args) and `src/runner/run.js:1321` (telemetry) — raw reads; audit for consistency.

**Exploitability today:** none found in-repo — `grep` shows no code path clears `ctx.noNetwork` (or sets `ctx.plan`) mid-run; the same was true of the bug this PR fixed (the implementing handoff says so honestly: "an ordinary user or hostile-input route to that mutation was not established"). This PR's whole premise is that same-ctx policy mutation must be safe; F1 is the widening half of that premise. One line fixes the gate.

**Recommended fix:** in `scanShellCommand`, replace `if (ctx.noNetwork)` with `if (effectiveFlags(ctx).noNetwork)`. Require graph is acyclic: `authority.js` imports nothing; `shell-policy.js` currently imports only `path` and `./safety`. Behavior is unchanged whenever no ceiling exists (`effectiveFlags` falls back to the raw flags). Apply the same swap at bash.js:48, background-shell.js:20, child-inherit.js:30 for consistency. **And amend test 3** to check a _different_ command string after clearing the flag — that turns today's masked pass into a red test that proves the fix.

### F2 — Low: test 3 is a cache hit, not a gate evaluation

Folded into F1's fix (different args after the flag clear). Listed separately so the test change is not lost when F1's one-liner lands.

### F3 — Low (pre-existing, not this diff): `invalidateDecisionCache` matches only `"path":"..."`

`src/runner/permissions.js:149-166` drops cached entries by substring-matching `"path":"<p>"` in the JSON key. Post-N1, tools may declare non-`path` path-arg keys via `pathArgKeysFor`, so a write through such a tool won't invalidate cached decisions for that path (under-invalidation), while a bash command whose JSON happens to contain the literal substring over-invalidates (safe direction). Harmless today because permission decisions don't depend on file contents — realpath freshness has its own cache invalidation at the same call site (`tool-registry.js`). Worth a catalog-driven follow-up, not a patch in this PR.

### F4 — Info (process): commit scope and branch naming

`2abc0df` bundles a 12-line safety fix + 45 lines of tests with ~1,930 lines of unrelated dated handoffs (Starlark analysis fidelity, R11 live verification), on a branch named `codex/starlark-r11-live-verification` while the PR is titled for the permission cache. Playground convention does bundle docs into commits, but a safety fix is easier to review, bisect, and revert when it travels alone. Also note: **the fix is not yet merged to `main`** — it lives only on this PR branch as of this review.

## Not bugs (do not fix)

- **Raw `ctx.acceptEdits` / `ctx.dontAsk` in the key** (permissions.js:130-131): correct — the gate's `activeMode` (permissions.js:84-91) reads the same raw values, and the ceiling never clamps A/D on an existing ctx (only children via `narrowChildAuthority`, and children get fresh ctx objects with empty caches).
- **`executeForce` spreading ctx** (tool-registry.js:297): `{ ...ctx, acceptEdits: true, dontAsk: true }` is a new object identity, so it gets its own WeakMap cache slot and can never pollute (or benefit from) the real ctx's cache. Slightly wasteful, safe by construction. The spread still carries `authorityCeiling` by reference, and `planCeilingBlocksForce` (tool-registry.js:290) runs first.
- **Double deny check in `executeForce`** (tool-registry.js:298-303, `isHardDeny` then `decision === 'deny'`): redundant, harmless.
- **`JSON.stringify(args)` key is key-order sensitive** (permissions.js:140-144): misses cost one recompute; never a wrong answer.
- **LRU refresh via delete+set on hit** (permissions.js:181-185) and the 512-entry cap: correct.
- **`ask` decisions never cached** (permissions.js:190-191): load-bearing and intact; new test 1's final assertion depends on it.
- **rootEpoch retires old-root entries by key change, not deletion** (permissions.js:135-139; bumps verified at both transitions, worktree-utils.js:114 and :125): bounded by the 512 cap; fine.
- **Cache stores `bypassable_deny` (e.g. `shell_disabled`) too**: anything non-`ask` is cached; those decisions are stable per flag tuple.
- **The `--dont-ask`-without-shell invariant is intact**: the `shell_disabled` deny (permissions.js:369-381) fires before the mode-policy lookup, so `MODES.dontAsk.shell = 'allow'` is unreachable without `--allow-shell`.
- **Inline `require('./shell-policy')` at permissions.js:272** despite the top-level import at line 12: redundant style, not a cycle hazard.

## Recommended fix order

1. **F1** — one-line scanner swap to `effectiveFlags(ctx).noNetwork` + amend test 3 to a cold-cache variant (different command string after clearing). Add a ceiling-flag-clear cold-cache case for `bash`/`background-shell` buildEnv if touched.
2. **F1 consistency sweep** — bash.js:48, background-shell.js:20, child-inherit.js:30; audit run.js:863/1321.
3. **F3 (optional)** — drive decision-cache invalidation off the N1 path-arg catalog instead of a `"path":` substring.
4. **F4 (process)** — future safety fixes land as standalone commits; consider a banner on `HANDOFF-permission-cache-fix-2026-09-07.md` noting that its test 3 asserts a cache hit, not gate enforcement (left unedited here — review-only brief).

## Pointers for the implementing agent

- The fix under review: `src/runner/permissions.js:124-146` (`_decisionKey`), gate at `:220-493`.
- `effectiveFlags` semantics: `src/runner/authority.js:48-59` (allowShell ANDs, plan/noNetwork OR with the ceiling).
- Ceiling creation is once-per-run at `src/runner/run.js:562`; nothing in `src/` mutates `ctx.plan`/`ctx.noNetwork` mid-run today (grep-verified) — the fix and F1 are both defensive against a mutation route that doesn't exist yet.
- When amending test 3: `permissions.check('bash', { command: 'curl https://other.example' }, ctx)` after `ctx.noNetwork = false` must be `deny`; today it returns `allow`.

## Verification record (real output, this machine)

- Targeted: `node --require ./test/setup.js --test test/runner/permission-decision-cache.test.js` → **8 pass / 0 fail** (handoff's "13" included private out-of-repo checks).
- Pre-PR repro: extracted `406423b` sources to a temp dir; both narrowing scenarios returned the stale cached `allow` (bug reproduced); the F1 ceiling hole also reproduces there (pre-dates the PR).
- F1 repro on current code: output quoted under F1.
- Full suite `npm test` **inside Cursor's sandbox**: 1,077 pass / 9 fail / 1 todo. All 9 traced to sandbox artifacts, not the PR: `git init` to `$TMPDIR` denied (`.git/hooks/: Operation not permitted` — 6 subtests across workspace-fingerprint, worktree-tools, worktree-determinism), sandbox-injected `http_proxy=127.0.0.1:56384` breaking `bash policy`'s "does not set http_proxy" assertion, and `EPERM` writing traces under `~/.claude-local-bridge/` (anthropic.integration).
- Re-run of all six affected files **unsandboxed**: **60 pass / 0 fail** — consistent with the handoff's green-suite claim (1,086/0/0).
- `npm run lint`, `npm run check:docs`, `npm run format:check`: all clean.
- Not re-verified: the Starlark Go suite (no Go toolchain on this machine; claim was the implementing agent's), HTML visual acceptance (their handoff already disclaims it).

## Handoff fields

- **Folder/branch:** `/Users/alanman/Developer/claude-local-bridge-playground`, branch `codex/starlark-r11-live-verification` @ `2abc0df` (= PR #27 head; `main` is checked out separately in Codex's worktree at `~/.codex/worktrees/df82/`).
- **Files changed:** this handoff only (untracked). Scratch probes deleted; `git status` clean afterwards.
- **Checks run:** targeted suite, full suite (sandboxed + unsandboxed accounting), lint, check:docs, format:check, before/after probes.
- **Skipped:** Starlark Go suite (no toolchain); live model runs (not needed); banner edit on the 09-07 handoff (review-only brief).
- **Risks/next:** F1 is the one that matters — pre-existing, masked by the new test, one line plus a test amendment to close. PR #27 itself is unmerged as of this review.
