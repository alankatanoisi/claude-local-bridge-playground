---
name: bridge-maintenance
description: Refreshes verified Claude Code fallback fingerprints, synchronizes model catalogs and T3 ACP model pickers, updates all three managed bridge installations, and tests their real runtime behavior. Use when explicitly asked to refresh bridge fingerprints or perform this maintenance workflow.
disable-model-invocation: true
---

# Bridge maintenance

Apply only when explicitly invoked. Work in the Claude playground, never the
canonical repository or the sibling Codex playground. Read `AGENTS.md` first.

## Establish the target and authorization

1. Verify and report the current directory, Git root, branch, remote, status,
   and worktrees. Start new edits only on clean, pulled playground `main`.
   Preserve unrelated changes; cleanliness alone does not establish ownership.
2. Read `scripts/claude-code-fingerprint.js`, the fallback JSON, model catalog,
   ACP agent, T3 shim, hosting controller, and existing maintenance reports.
   Recheck their current behavior instead of trusting a previous version number.
3. Record which managed mode is running. Explain that installation and mode
   switching interrupt managed requests. Preserve ordinary editors and unowned
   listeners. Use the supported controller instead of killing guessed processes.
4. Infer the requested maintenance scope from the user. Commit/push only when
   authorized; a request to check drift alone does not authorize publication.

## Capture and update the fingerprint

1. Run `npm run fingerprint:prepare` from the verified repository. This uses
   dummy credentials and a localhost mock, creates a dated branch when needed,
   updates verified stable fields, and leaves the patch uncommitted.
2. Inspect its sanitized report. If the local client differs from npm latest,
   update through its supported installation method before recapturing. Never
   substitute a version string for an actual capture.
3. Never copy billing values, credentials, session identifiers, or request bodies
   from logs. Billing presence is evidence only; preserve the workflow's
   non-persistence rule. Never guess stable headers or system blocks if capture
   fails. Report a concrete blocker and continue independent authorized work.
4. Update the explicit fingerprint version test after a verified version change.
   Preserve initial validation failures; report them before fixing and rerunning.
5. Create a standalone HTML companion for every generated Markdown report,
   including the automation ledger. Keep private JSON and raw runtime evidence
   outside Git. UTC filenames can fall on the next day; use Pacific dates in
   user-facing prose.

## Refresh model and T3 ACP catalogs

1. Fetch official Anthropic model pages, effort rules, thinking rules, and prices.
   Record URLs and access date. Do not infer current capabilities from names.
2. Update `src/runner/model-catalog.js`: bump its version, add provenance, place
   point releases before broad family matchers, and record exact pricing rules.
   Keep unknown model identifiers pass-through and estimates explicitly labeled.
   Include cache tokens when deciding prompt-size pricing tiers. Avoid changing
   the default model unless requested.
3. Update `src/runner/acp/agent.js` model choices. Verify both
   `cursor/list_available_models` and `session/new` advertised models, plus
   `session/set_model` forwarding. Label limited availability honestly.
4. Bump the dated `cliVersion` in `bin/t3-cursor-shim.sh` so T3 invalidates its
   model cache. Inspect the actual provider launch path in T3 when available.
   Do not reset user conversations or unrelated provider settings.
5. Synchronize both command-builder HTML model lists and their control rules.
   Preserve unrelated toggles and defaults. A default-first picker must still
   choose the most specific point-release rule.
6. Add focused checks for new identifiers, real selection/forwarding, incompatible
   controls, matcher reachability, pricing boundaries, and UI/runtime agreement.

## Validate, install, and exercise all modes

1. Run focused fingerprint, model, ACP/shim, pricing, and command-builder tests.
   Run the normal gates in `package.json`, including full tests and the Starlark
   verification suite. Preserve failed results; distinguish setup errors from
   product failures. Never hide tests or rewrite historical reports to pass.
2. Run `node bin/bridge-hosts.js install` from the verified updated checkout.
   A source edit does not update installed snapshots. This command installs
   standalone source plus dedicated desktop and browser extensions.
3. Compare the installed runtime files and fingerprint against the checkout.
   Inspect current `installation.json`; do not hardcode a past release path.
4. Start each mode through the controller. Use
   `node scripts/hosting/verify-live.js MODE` for buffered, streaming, and a real
   `list_files` runner loop against synthetic data. A listener alone is not a
   model test. Exercise new model identifiers with short, bounded live requests
   when authorized. Report which identifiers actually worked.
5. Browser mode needs its editor tab open and activated. Use the available
   browser tools for its normal login/UI flow; never print its local password.
   Desktop mode needs its dedicated extension host activated.
6. Exercise the actual T3 shim handshake and model listing. A protocol check
   proves advertisement; separately state whether the visible T3 picker was
   inspected. Reconnect the provider/new ACP session if a running session is
   holding the old process. Avoid restarting active user work without necessity.
   Inspect T3's actual provider executable: newer setups use
   `bin/t3-bridge-runner.sh`, not the historical Cursor shim. Include the catalog
   revision in the generic ACP agent version. If refreshing status alone keeps
   an old list, reconnect only the idle Bridge Runner provider and verify its
   enabled state and new models in both settings and the composer picker.
   If a managed mode cannot find a login despite Claude Code being signed in,
   check for duplicate Keychain service entries using metadata only. The lookup
   must select the current macOS account; never scan or copy other accounts'
   tokens, and never fall back to an upstream API key.
7. Restore the originally running mode and verify it again. Run a final
   fingerprint check. Report discrepancies rather than calling partial success
   complete.
8. When the user explicitly includes `VS Code — existing/debug`, inspect the
   ordinary VS Code extension installation and port 11437 separately from the
   managed copies. If missing or stale, install the verified current local VSIX
   into the ordinary profile, activate it, and compare its source files. Keep
   the runtime host selector connect-only. Run
   `node scripts/hosting/verify-live.js vscode`, then select that host in a fresh
   T3 Bridge Runner chat and verify a bounded synthetic response. Ordinary
   VS Code must stay open; never reset a failed old chat to manufacture success.

## Handoff and synchronization

- Save dated Markdown plus self-contained HTML: verified delta, sources,
  installed paths, mode/model test results, first failures and reruns, checks,
  skipped checks, limitations, and next action. Never quote session ledger
  payloads; use aggregate counts only.
- Mirror any project skill changes between `.agents/skills` and
  `.cursor/skills`; run `npm run check:docs` to verify cross-surface parity.
- When commit/push/sync is authorized, review the intended diff, exclude private
  state/logs/credentials, commit it, fast-forward playground `main`, and push.
  Verify equality of local HEAD, origin/main, and remote refs/heads/main. Check
  installed source content too. Never force-push or modify other worktrees as
  routine synchronization.
- Final reply: outcome first, folder/branch, changed files, checks and skipped
  checks, real commit link and synchronization evidence, final running mode,
  and practical limits. Explain any required user steps in beginner-friendly
  language with the exact app, folder, success signal, and failure recovery.

Example invocation: "Use bridge-maintenance to check fingerprint drift, refresh
models for T3 ACP, test all three modes, then commit, push, and sync."
