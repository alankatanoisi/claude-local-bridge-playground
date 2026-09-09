# Thermo-nuclear review — PR #27 "Invalidate permission cache on policy narrowing" — 2026-09-09

**Reviewer:** Cursor (thermo-nuclear charter). **Mode:** review only — no code, docs, or test files were
modified; this handoff is the sole new file and is left untracked.
**Target:** pull request #27, branch `codex/starlark-r11-live-verification`, tip `2abc0df`
(`fix(runner): invalidate permission cache on policy narrowing`), base `406423b4`.
All claims below were verified against the code at `2abc0df` and against the pre-fix source at `406423b`,
not against the PR's handoff docs.

## Tree state found (context for the next agent)

- The main checkout at `/Users/alanman/Developer/claude-local-bridge-playground` was sitting **on the PR
  branch itself** (clean tree, in sync with origin) — the code under review was already on disk.
- `main` is checked out in the Codex worktree `/Users/alanman/.codex/worktrees/df82/claude-local-bridge-playground`.
- Since the PR base, `main` has advanced 3 commits (`38f9998`, `1d1fb0f`, `8bfe4b6`) with **zero overlap**
  in the files this PR touches (`src/runner/permissions.js`, `test/runner/permission-decision-cache.test.js`)
  → a merge would be textually clean.

## Verdict

**The fix is correct, minimal, and well-tested for what it changed. Recommend merge.** The one substantive
finding (F1) is a _pre-existing, latent_ gap in an adjacent layer that this PR neither introduced nor was
obliged to fix — but the PR's third test now names an invariant it does not actually exercise, which turns
a known-limitation into a false-confidence trap for future readers.

## What the fix does (verified)

`_decisionKey` (`src/runner/permissions.js:124-146`) previously keyed the permission-decision cache on raw
`ctx.acceptEdits` / `ctx.dontAsk` / `ctx.allowShell` only. It now keys on raw acceptEdits/dontAsk plus
**effective** `allowShell` / `plan` / `noNetwork` from `effectiveFlags(ctx)` — the same helper the gate
itself uses (`permissions.js:226`, `authority.js:48-59`). Effective flags clamp the mutable ctx flags to the
frozen per-run authority ceiling, so the cache key now changes exactly when the gate's answer can change.

Runtime verification, replayed against **pre-fix** source extracted from git (`git show 406423b:...`,
compiled in-memory, no tree changes):

```
A: warm write_file allow, then ctx.plan = true        → old code: allow (stale)  → PR test 1 catches
B: warm bash curl allow, then ctx.noNetwork = true    → old code: allow (stale)  → PR test 2 catches
C: ceiling noNetwork, clear raw flag, SAME command    → old code: deny (cached)  → passes pre-fix too
```

Post-fix, the same probes return `ask` / `deny` / `deny` as intended (PR tests pass: 8/8 in
`test/runner/permission-decision-cache.test.js`).

## Findings (severity-ranked)

### F1 — Medium — Test 3 is cache-masked; the startup `--no-network` ceiling is not enforced on the uncached shell path

The PR's third new test is named _"keeps the startup network restriction when its mutable flag is cleared"_
(`test/runner/permission-decision-cache.test.js:124-130`), and the 09-07 fix handoff presents it as the
control proving exactly that. Runtime proof that the guarantee is only cache-mediated:

At `2abc0df`, ctx with `noNetwork: true` + frozen ceiling, then `ctx.noNetwork = false`:

```
1 pre-mutation curl  a.example : deny
2 post-mutation SAME curl      : deny   (ruleId: no_network)   ← the test's assertion
3 post-mutation NEW wget       : allow  (ruleId: mode_policy)  ← startup restriction gone
4 post-mutation NEW curl       : allow  (ruleId: mode_policy)
```

Root cause, two layers reading different flags:

- The gate consults the **effective** flag: `permissions.js:331` denies only when
  `issue.kind === 'network_command' && eff.noNetwork`.
- But the scanner only _emits_ that issue under the **raw** flag:
  `shell-policy.js:177` — `if (ctx.noNetwork) { for (const pat of NETWORK_PATTERNS) ... }`.

Once the raw flag is cleared, no `network_command` issue is ever produced, the gate's `eff.noNetwork`
condition has nothing to act on (it is dead code in that state — note `eff.noNetwork ⊇ raw noNetwork`, so
`&& eff.noNetwork` can never fire when the scanner stayed silent), and the command falls through to mode
policy. Because probe 2's deny was cached under the same effective-flags key, test 3 passes pre-fix,
post-fix, and would pass even if the uncached gate were fully broken — it demonstrates only "a cached deny
stays cached," not the invariant in its name.

Same raw-flag family (all pre-existing; each would also stop enforcing the startup ceiling if the raw flag
were cleared mid-run):

- `src/runner/tools/bash.js:48` and `src/runner/background-shell.js:20` — the `http_proxy` blackhole env
  (the backstop for commands the scanner's pattern list misses) reads raw `ctx.noNetwork`.
- `src/runner/hooks/hook-runner.js:15` — same blackhole for hook subprocesses.
- `src/runner/child-inherit.js:30` — children inherit the parent's **raw** `noNetwork`;
  `narrowChildAuthority` (`authority.js:86-105`) clamps child allowShell/acceptEdits/dontAsk/tools but has
  no noNetwork/plan field (plan is protected indirectly through the acceptEdits/dontAsk clamp).

**Why only Medium:** no in-repo route mutates these flags on a live same-ctx object today — verified:
ACP builds a fresh ctx per `run()` call (`src/runner/acp/agent.js:776-778` maps session mode into run
options per prompt); hooks are subprocesses that never see the ctx object; spawned children get their own
ctx; worktree transitions mutate `ctx.cwd` but bump `rootEpoch` (`worktree-utils.js:102-126`). The WP2
docstring promise ("noNetwork: true ⇒ the network guard can never be dropped", `authority.js:22`) is
therefore unenforced only on a path nothing currently reaches. The sharpest part is the false confidence:
a test named after the invariant now exists, so the next reader will believe the uncached path is covered.

**Fix direction (do not implement from this handoff — Alan decides):** have `scanShellCommand` consult
`effectiveFlags(ctx).noNetwork` (import from `authority.js`; no import cycle — authority imports nothing
internal). Keep emission _conditional on the effective flag_, not unconditional: `network_command` is a
hard issue for hook-runner/background-shell (`!allowed` blocks outright, `shell-policy.js:201-205`), so
unconditional emission would hard-block `curl` in hooks even without `--no-network`. Then strengthen test 3
to exercise the uncached path (a new command string after the mutation, or `invalidateDecisionCache(ctx)`
between checks), and align or deliberately-document the env-blackhole / child-inherit raw reads.

### F2 — Low (pre-existing, untouched by this PR) — shared `'<unserializable>'` fallback key

`_decisionKey` (`permissions.js:140-144`) maps any unserializable args object to the constant
`'<unserializable>'`, so two _different_ unserializable requests for the same tool+flags+epoch would share
one cache entry (stale-direction collision — an allow for one could serve the other). Unreachable from
model-driven tool calls, whose args arrive as parsed JSON (always serializable); only a programmatic caller
passing circular/BigInt args could hit it. Same code existed at `406423b`.

### F3 — Info — commit scope vs. commit title

The single commit `2abc0df` is titled for the permission fix, but 1,932 of its 1,989 inserted lines are
three bundled handoff doc pairs, two of which belong to the Starlark R11 thread
(`HANDOFF-starlark-analysis-fidelity-2026-09-07.{md,html}` = 1,558 lines). The bundling is deliberate per
the fix handoff ("report pairs are included with follow-up banners") and handoffs-travel-with-code is
established practice here — noted only so future `git log` archaeology isn't surprised. The branch name
(`codex/starlark-r11-live-verification`) likewise no longer describes the PR's content.

### F4 — Info (pre-existing) — args key is property-order sensitive

`JSON.stringify(args)` in the cache key means `{a:1,b:2}` and `{b:2,a:1}` miss each other. Miss-only, never
a stale hit; negligible cost. Not worth changing.

## Not bugs (do not fix)

- **LRU refresh on hit** (`cache.delete` + `cache.set`, `permissions.js:181-185`) — intentional recency.
- **`ask` decisions never cached** (`permissions.js:189-191`) — confirmations must always reach the user.
- **Cached decision returned by shared reference** — no caller mutates the returned object (verified:
  no `.decision =`/`perm.* =` writes anywhere in `src/runner`; the only two call sites are
  `tool-registry.js:245` and `:297`).
- **`executeForce` checks through a per-call shallow copy** (`tool-registry.js:297`) — each call gets a
  fresh WeakMap cache entry, so force-checks are never cached and can never pollute the shared cache; the
  spread still carries `authorityCeiling`, so the ceiling applies. Correct isolation, negligible waste.
- **Key mixes raw acceptEdits/dontAsk with effective allowShell/plan/noNetwork** — matches the gate exactly:
  `activeMode` reads raw A/D + effective plan (`permissions.js:84-91`); `_checkUncached` reads effective
  shell/network. The asymmetry is faithful, not a bug.
- **Narrowed-away old entries linger in the map** — unreachable by construction (the key contains the
  effective flags); bounded by the 512-entry cap and invalidated per-path on writes
  (`tool-registry.js:259-260`, `:316-317` — both `execute` and `executeForce` invalidate, verified).
- **Raw-flag reads in visibility/UX layers** (`tool-visibility.js:51`, `test-watcher.js:58`,
  `context-budget.js:33`) — these shape what is _offered/displayed_, not what is _permitted_; enforcement
  stays with the gate. Different layer, acceptable.
- **Worktree-dependent scan inputs** (`detectWorktreeEscape`, `shell-policy.js:81-93`) read
  `activeWorktreeSlot` / `worktreeRepoRoot` / `cwdRealpath` — every transition path
  (`activateSlot`, `deactivateToRepoRoot`) bumps `rootEpoch`, which is in the cache key. Covered (P0-10).
- **`ctx.allowedTools` / ceiling `tools` not in the cache key** — both are set once before the ceiling
  freezes (`run.js:533,558,562`) and never reassigned or mutated in place afterward (verified by grep).
  Latent-only; revisit only if a mid-run tool-set mutation feature is ever added.

## Recommended fix order (only if Alan asks)

1. `shell-policy.js:177` → effective flags (the actual WP2 wiring gap behind F1), with a regression test
   that exercises the **uncached** path after the raw flag is cleared.
2. Align the three proxy-blackhole `buildEnv` sites and `child-inherit.js:30` with effective flags — or add
   short comments stating the raw read is deliberate at each site.
3. Rename or strengthen PR test 3 so its name stops claiming an uncached-path guarantee (F1).
4. One paragraph in `authority.js`'s header comment mapping which layers are effective-flagged (gate) vs
   raw-flagged (scanner, env builders, child inherit), so this asymmetry never needs rediscovering.

## Pointers for the implementing agent

- F1 evidence probes are one-liner `node -e` scripts; rerun them exactly as quoted above before and after
  any scanner change. Create scratch dirs inside the repo and remove them (the Cursor sandbox denies
  writes outside the workspace).
- The full suite under the Cursor sandbox shows 9 spurious failures
  (`anthropic pass-through integration`, `bash policy`, `Ext-10 workspace fingerprint`,
  `WD-6/D1 --worktree startup entry (real CLI)`, `worktree tools — permissions`,
  `worktree tools — enter/exit lifecycle`): sandbox network/spawn restrictions, not code. The same 5 files
  pass 60/60 unsandboxed. Do not "fix" these.
- Keep the 09-07 fix handoff's honesty rule intact: the narrowing scenario is demonstrated by deliberate
  internal ctx mutation; no ordinary-user or hostile-input route to that mutation was established (this
  review re-verified that). Do not describe F1 or the original F1-cache bug as a proven startup-flag bypass.

## Checks run (real output, this machine, at `2abc0df`)

| Check                                                                                       | Result                                                                                                        |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `node --require ./test/setup.js --test test/runner/permission-decision-cache.test.js`       | 8 pass, 0 fail                                                                                                |
| `npm test` (sandboxed)                                                                      | 1,077 pass, 9 fail — all 9 proven sandbox artifacts →                                                         |
| …5 affected files re-run unsandboxed                                                        | 60 pass, 0 fail (⇒ full suite effectively 1,086 pass + 1 pre-existing TODO, matching the fix handoff's claim) |
| `npm run lint`                                                                              | exit 0                                                                                                        |
| `npm run check:docs`                                                                        | exit 0                                                                                                        |
| `npm run format:check`                                                                      | exit 0                                                                                                        |
| Pre-fix behavioral replay (`git show 406423b:src/runner/permissions.js`, in-memory compile) | bug reproduced: stale `allow` after plan and after noNetwork narrowing                                        |
| F1 probe (startup-ceiling noNetwork + raw-flag clear)                                       | SAME command `deny` (cache); NEW commands `allow` (gap confirmed)                                             |

Skipped: Starlark host suite (`starlark-host/` untouched by this PR — docs only there); live model calls
(not needed for a cache/gate review). Not committed, not pushed — per charter, this review stops here.
