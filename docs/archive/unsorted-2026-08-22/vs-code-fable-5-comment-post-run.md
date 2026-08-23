The white paper is written. The check:docs run is blocked by a temporary harness issue (the permission classifier for Bash is briefly unavailable), so I'm noting it as skipped rather than blocking the handoff on it — the change is a single standalone HTML document, so the risk is low.

What I did
I explored the runner layer end-to-end (reading run.js, tool-pipeline.js, tool-registry.js, permissions.js, safety.js, model-client.js, the context builder/compactor, session ledger, tool catalog, and kernel contract) and wrote a 12-section academic-style technical white paper at docs/runner-loop-whitepaper.html. Open it by double-clicking the file in the VS Code file explorer and choosing "Open with Live Server," or just double-click it in Finder to open it in your browser.

Important: a version of this white paper already existed at that path (untracked, likely from an earlier session). I did not delete it blindly — I backed it up to the session scratchpad first, then replaced it with this deeper second edition. Your docs/apple-shortcuts-recommendations.html also has uncommitted modifications I didn't touch.

The runner loop, in brief (the paper covers all of this in depth)
The whole agent is one bounded for loop in run.js:869 (default 16 steps). Each turn: detect instruction-file changes → run the compaction ladder → place prompt-cache breakpoints → POST to the bridge at localhost:11437/v1/messages → account usage against budgets → if the model replied with no tool_use blocks, stop with success → otherwise hand the tool calls to the pipeline → append results as a user message → repeat.

The three ideas I found most architecturally interesting:

One seam between policy and mechanism. The loop never executes tools; tool-pipeline.js does, and the loop's only mid-execution authority is the midTurnCheck callback, invoked at exactly one point — after all parallel reads finish, before any serial write starts. So a cycle/cost/wall-clock stop can never leave a half-applied write behind.
Effect pairing is write-ahead logging. Every tool call journals a tool_effect_intent before executing and a matching tool_effect_result after — even on denial, error, or plan-mode fabrication. The ledger is the only critical sink (its failure aborts the turn); transcript, trace, human log, archive, and hooks are all best-effort.
Prompt-cache economics shape the code everywhere. Anthropic allows 4 cache_control breakpoints; the runner uses 3 and reserves 1 for the bridge's OAuth identity block, marks the second-most-recent message (the newest one would immediately invalidate its own cache entry), routes small CLAUDE.md edits through user messages to avoid rebuilding the cached system prompt, and throws loudly if the breakpoint count is ever exceeded.
The paper also documents the permission matrix (why --accept-edits doesn't unlock shell and --dont-ask doesn't unlock writes), the hard-deny floor that survives even forced execution, the secret-scrubbing chokepoint, the compaction ladder (clip → snip → ghost → summarize), all 21 stop reasons, and the three durability layers (session store, ledger + cursor sidecar, recovery manifest).

Handoff
Folder/branch: /Users/alanman/Developer/claude-local-bridge-playground, branch main
Files changed: docs/runner-loop-whitepaper.html (replaced; old version backed up to the session scratchpad). No source code touched.
Checks run: none completed — npm run check:docs was blocked twice by a temporary tool-permission outage on my side
Skipped: check:docs, lint, tests (no code changed, but you can run npm run check:docs in Terminal from the repo folder later; success is it printing no errors)
Risks/next steps: the file is untracked, so nothing is committed or pushed. If you want to keep it, ask me to commit it; if you preferred the earlier draft, the backup exists this session at the scratchpad path and I can restore it.