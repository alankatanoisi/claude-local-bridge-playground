# Handoff — Invariant Review of `2abc0df` (Permission-Cache Policy Narrowing Fix)

**Written:** 2026-09-07. Review only; no code changes made in this turn.
**Scope:** branch `origin/codex/starlark-r11-live-verification`, commit `2abc0df5f815acf1fc6899fe0a4cb9ef0f12b06b` evaluated against baseline `406423b4d6ea1ead837b3bedb6f09f618a2a5d8a`.
**Prior records:**
- [`HANDOFF-permission-cache-fix-2026-09-07.md`](HANDOFF-permission-cache-fix-2026-09-07.md) (Codex fix handoff)
- [`HANDOFF-starlark-analysis-fidelity-2026-09-07.md`](HANDOFF-starlark-analysis-fidelity-2026-09-07.md) (101-assertion forensic audit)
- [`HANDOFF-starlark-r11-live-verification-2026-09-07.md`](HANDOFF-starlark-r11-live-verification-2026-09-07.md) (live interruption/resume verification)

---

## 1. Executive Summary & Verdict

- **Verdict:** **PASS.** The narrow fix in `src/runner/permissions.js` correctly addresses the reproduced in-memory cache gap (F1) and preserves all core safety invariants (monotonic authority ceiling, uncached human-in-the-loop asks, least-recently-used cache eviction, root-epoch invalidation, and tool-level path containment).
- **Test Fidelity:** The 3 new regression tests in `test/runner/permission-decision-cache.test.js` failed cleanly against unpatched baseline code (`406423b`) and pass completely against `2abc0df`. The full suite passed with zero regressions (1,036 passed, 0 failed, 1 pre-existing TODO).
- **Core Boundary Preserved:** The review strictly preserves the boundary between:
  1. The **reproduced internal-context defect**: Programmatic policy narrowing on an already-cached `ctx` object within the same session.
  2. The **unproved ordinary user-triggered bypass**: Model-hallucinated claims of an external exploit, path escape, or startup `--plan` bypass.

---

## 2. Distinction: Reproduced Internal-Context Defect vs. Unproved User Bypass

| Dimension | Reproduced Internal-Context Defect (Real Bug, Fixed in `2abc0df`) | Unproved Ordinary User Bypass (Model Hallucination / Unsupported) |
| :--- | :--- | :--- |
| **Trigger Mechanism** | An existing in-memory context object (`ctx`) is reused; a write or network command is allowed and cached; subsequently, internal code sets `ctx.plan = true` or `ctx.noNetwork = true` on the **same** context. | A user executes a prompt or command-line invocation, or an adversary attempts an attack from outside the runner. |
| **Failure Mode** | `_decisionKey` omitted `plan` and `noNetwork`, generating the same cache key. `check(...)` returned the stale `allow` without re-evaluating policy. | Model synthesis claimed a "High-severity adversarial path escape" or "proven startup `--plan` bypass". |
| **Startup `--plan` Behavior** | Not affected. If the operator starts the runner with `--plan`, `ctx.authorityCeiling.plan = true` from initialization. Every write evaluates to `plan_only` -> `ask`. | Because `ask` decisions are **never cached** (`decision.decision !== 'ask'`), a startup `--plan` run could never cache an `allow` in the first place. |
| **Filesystem Safety** | At the dispatcher level, `registry.execute` previously executed the write under the stale allow. | Even if allowed by the cache, `write_file` rechecks `safety.resolveFileTarget` in `execute` (HE-01 defense-in-depth). Directory escapes are impossible. |
| **Attacker Reachability** | No user-controlled or prompt-controlled pathway exists to mutate `ctx.plan` mid-run. | Purely hypothetical/amplified risk produced during multi-agent synthesis. |

---

## 3. Independent Code & Test Audit

### Code Audit (`src/runner/permissions.js`)

```javascript
function _decisionKey(toolName, args, ctx) {
  const eff = effectiveFlags(ctx);
  const flags =
    (ctx.acceptEdits ? 'A' : '') +
    (ctx.dontAsk ? 'D' : '') +
    (eff.allowShell ? 'S' : '') +
    (eff.plan ? 'P' : '') +
    (eff.noNetwork ? 'N' : '');
  const epoch = 'E' + (ctx.rootEpoch || 0);
  let argsKey;
  try {
    argsKey = JSON.stringify(args || {});
  } catch {
    argsKey = '<unserializable>';
  }
  return toolName + '|' + flags + '|' + epoch + '|' + argsKey;
}
```

1. **Ceiling Clamping:** `eff = effectiveFlags(ctx)` ensures flags are clamped against `ctx.authorityCeiling`. If a run starts without `--allow-shell`, `eff.allowShell` is permanently `false`, preventing hostile mid-run widening.
2. **Flag Key Uniqueness:** Flag letters (`A`, `D`, `S`, `P`, `N`) appear in fixed positions; any change in permission state creates a distinct key string, guaranteeing a cache miss when policies narrow.
3. **Epoch Invalidation Intact:** `rootEpoch` remains present, ensuring worktree root hops retire cached entries in $O(1)$.
4. **No Side Effects on Uncached Behavior:** `_checkUncached` remains the authoritative policy gate.

### Test Audit (`test/runner/permission-decision-cache.test.js`)

- **Narrowing Test 1 (Plan Mode):** Warms cache with write -> mutates `ctx.plan = true` -> verifies `sentinel.txt` is NOT created, `needsConfirmation === true`, and decision recomputed to `ask`.
  - *Baseline check:* Failed (`true !== false`, sentinel file written to disk).
  - *Patched check:* Passed.
- **Narrowing Test 2 (No-Network):** Warms cache with bash command -> mutates `ctx.noNetwork = true` -> verifies decision recomputed to `deny`.
  - *Baseline check:* Failed (`'allow' !== 'deny'`).
  - *Patched check:* Passed.
- **Ceiling Test 3 (Network Ceiling):** Starts with `noNetwork: true` -> mutates `ctx.noNetwork = false` -> verifies decision remains `deny` (monotonic ceiling holds).
  - *Baseline & Patched check:* Passed.

---

## 4. Severity-Ranked Findings

### Low / Informational (Clean Implementation)
- **L1 — Clean and Minimal Scope:** The fix in `src/runner/permissions.js` is only 12 lines and addresses exactly the policy narrowing gap without adding complexity or regressions.
- **L2 — Context-Level Allowlist Scope (Residual Note):** As noted in the analysis review, `ctx.allowedTools` is not encoded in `_decisionKey`. In the current architecture, `ctx.allowedTools` is computed once at startup in `run.js` and does not dynamically narrow mid-run. If a future subagent or plugin system introduces mid-run tool allowlist narrowing on a reused context, `_decisionKey` or explicit `invalidateDecisionCache` will need to track that.

---

## 5. "Not Bugs" List (Do NOT Fix / Do NOT Implement)

These items were hallucinated, contradicted, or unjustified in the generated multi-agent analyses:

1. **DO NOT add a "missing" path resolver call:** `safety.resolveFileTarget` is already called at `permissions.js:235–254` and in tool execution.
2. **DO NOT replace the cache eviction logic:** The cache uses Map insertion order (`delete` + `set` on hit), making it an authentic Least-Recently-Used (LRU) cache, not First-In-First-Out (FIFO).
3. **DO NOT remove pending intents via TTL/expiry in `session-ledger.js`:** Dropping effect evidence without resolution corrupts crash recovery and audit honesties.
4. **DO NOT rewrite `session-ledger.js` for an async write race:** `session-ledger.append` is entirely synchronous; no mid-method suspension or race exists on a single instance.
5. **DO NOT treat missing lease release in `budget-broker.js` as an over-budget spend bug:** An unreleased lease withholds capacity (causes starvation), it does not permit overspending above caps.
6. **DO NOT alter negative/nonfinite number conversion in `budget-broker.js`:** Constructor normalization behaves as specified.
7. **DO NOT add distributed file locks to the ledger or broker:** The runner is a local developer tool, not a distributed database.
8. **DO NOT treat interrupted upstream requests as free:** The $5 billing uncertainty hold remains necessary and justified.

---

## 6. Recommended Next Steps

1. Commit `2abc0df` on branch `codex/starlark-r11-live-verification` is verified and ready to be merged into `main` whenever Alan decides.
2. Do not make further code changes to `src/runner/permissions.js` in this turn.
