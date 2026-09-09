# Permission-cache correction and Cursor handoff — 2026-09-07

**Status:** The reproduced F1 cache gap is corrected. The original factual-quality review remains valid: fixing this code defect does not validate the other generated claims. Alan authorized this narrow correction and the recommended check/commit/push sequence.

## Location and scope

Folder: `/Users/alanman/.codex/worktrees/df82/claude-local-bridge-playground`. Branch: `codex/starlark-r11-live-verification`. Starting commit: `406423b4d6ea1ead837b3bedb6f09f618a2a5d8a`, matching freshly fetched `origin/main`. Remote: `https://github.com/alankatanoisi/claude-local-bridge-playground.git`. The owner's main checkout remains untouched; no merge is included.

Changed implementation: [src/runner/permissions.js](src/runner/permissions.js). Permanent regression tests: [test/runner/permission-decision-cache.test.js](test/runner/permission-decision-cache.test.js). This handoff has a [standalone HTML companion](HANDOFF-permission-cache-fix-2026-09-07.html). The earlier live-verification and analysis-fidelity report pairs are included with follow-up banners; their original observations, failures, and historical source references are preserved.

## What changed and why

The cache stores a previous permission decision to avoid repeating work. Previously, its key included edit acceptance, automatic confirmation behavior, and the raw shell flag, but omitted plan and network restrictions. Enabling either restriction on the same context could reuse an earlier allow.

The key now includes effective shell, plan, and no-network flags, using the same `effectiveFlags` helper as the permission gate. Effective means that mutable flags are constrained by the startup authority ceiling. Existing tool arguments, root-transition epoch, edit flags, bounded recency behavior, and the rule against caching confirmation requests remain intact.

The change is deliberately limited to the reproduced policy-flag gap. It is not a comprehensive claim that every mutable policy input or filesystem race is covered by the cache.

## Validation and preserved first failures

- Before implementation: the permanent cache test file had **6 passes and 2 failures**. Both new narrowing cases failed on unchanged runtime code.
- After implementation: the permanent tests plus the original review's unchanged private regression checks had **13 passes, 0 failures, 0 skips**.
- The dispatcher regression warms a write allow, enables plan on the same context, and verifies that no fixture file is created and confirmation is required. Fixtures are removed after the tests.
- The network regression classifies a literal command without executing it. A separate control verifies that clearing the mutable no-network flag cannot remove a startup network restriction.
- Starlark evaluator build and suite: **104 passes, 0 failures, 0 skips**.
- Full root suite: **1,086 passes, 0 failures, 0 skips, 1 existing TODO (1,087 total)**.
- Lint, documentation defaults/manifest, and formatting checks passed. No live model experiment was needed or run for this fix.
- HTML is standalone and locally linked. Visual browser acceptance was not run; the browser tool previously blocked local-file inspection. Do not infer visual acceptance from structural checks.

First-failure and successful logs remain private under `starlark-host/workflow-runs/fidelity-review-2026-09-07/` as `fix-before.log`, `fix-after.log`, `fix-full-tests.log`, and `fix-starlark-verify.log`. Ignored raw run evidence is excluded from Git. The permanent regression tests travel with the branch and can be run on the other laptop without those logs.

## Cursor review request

Review the narrow implementation and regression tests against the starting commit, then assess whether the correction preserves permission and authority invariants. A commit is a saved Git snapshot; a push copies it to the GitHub branch. Publication is to the feature branch only, and final commit/remote verification is recorded in the accompanying task response.

Check that cached allows cannot survive enabling plan/no-network, startup restrictions remain enforced, shell is still explicitly gated, and root-transition invalidation and uncached confirmation behavior remain intact. The current tests demonstrate a deliberately mutated internal context; an ordinary user or hostile-input route to that mutation was not established. Do not describe this as a proven startup `--plan` bypass.

**Not bugs to fix:** the cache already updates recency on hits; asks are not cached; the permission module already calls the path safety resolver; the broker has admission enforcement; the ledger exposes its cursor source. Consult the [101-assertion analysis review](HANDOFF-starlark-analysis-fidelity-2026-09-07.md) before turning any generated assertion into a code change.

**Deferred proposals:** improving synthesis source provenance and giving synthesis interruption-history metadata. Neither was implemented here. No changes were made to bridge authentication, proxy behavior, Starlark runtime, or live campaign accounting.
