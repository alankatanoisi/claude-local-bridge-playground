FINAL — I explored the codebase and wrote the white paper to **`docs/runner-loop-whitepaper.html`** (a new standalone document; no existing files were edited).

## What I found (architecture summary)

**Three strata:**
1. **Bridge** — transport-only VS Code extension exposing Claude Code credentials at a local `/v1/messages` endpoint.
2. **Agent loop** — `src/runner/run.js` (~1,370 lines), the bounded `for (step = 1..maxSteps)` orchestrator.
3. **Tool pipeline** — `src/runner/tool-pipeline.js`, a deep module with a two-method interface (`toolDefinitions()`, `executeTurn()`) that owns permissions, confirmation, plan-mode fabrication, execution, journaling, and sink fan-out.

**The runner loop, per step (documented in detail in the paper):**
1. `pre_model_request` hook dispatch
2. Instruction-delta detection (small diff → inject user message; large rewrite → rebuild system prompt)
3. Compaction ladder (`applyCompactionLadder`) with persisted generation counter
4. `cache_control` breakpoint budgeting + advisory token estimate
5. Request build (streaming only for text output; effort/temperature optional)
6. POST to bridge — transport errors share the tool failure streak and consume a step as retry budget
7. Usage accounting → budget boundary (token/inherited-child budgets); 2× context backstop
8. Assistant message append + session checkpoint
9. Extraction: per-turn tool cap guard; zero tool uses → SUCCESS (autopsy, health, archive)
10. `pipeline.executeTurn` with the **midTurnCheck seam** — reads run as a parallel batch, then the loop gets one checkpoint (semantic cycles, wall-clock, cost, budgets) *before any write executes*
11. Tool results appended as one user message; persist; continue

**Key invariants formalized in the paper:** effect pairing (ledger intent/result around every side effect), plan-mode write safety, observation linearity (sinks always see model-emitted order even under parallel disjoint-path writes with `--accept-edits`), catalog/execution coherence, the mid-turn write barrier, and budget inheritance for child agents.

The HTML is fully self-contained (inline CSS, academic layout with abstract, TOC, figures, invariant boxes, stop-reason table, and references) — open it directly in a browser.

-----------------------------------

CLI Flags:

--trusted-workspace --trust-workspace —chaos-ok --model claude-fable-5 --max-tokens 128000 —effort medium —bare —accept-edits --max-steps 250 new-session --task-scope —agent ‘project’ --prompt-template cleanup —trace-level full  --log-level verbose --tools 'list_files,read_file,search_text,glob,git_status,manage_tasks,ask_user_question,spawn_agent,enter_worktree,exit_worktree,list_worktrees,run_skill,edit_file,write_file,undo,undo_edit' --stream --verbose ‘explore this codebase architecture. Explain the runner loop in great engineering technical detail. Do not edit files. write an academic type of technical white paper in HTML.'

--------------------------------------

Metadata:

{
  "stopReason": "success",
  "finalText": "FINAL — I explored the codebase and wrote the white paper to **`docs/runner-loop-whitepaper.html`** (a new standalone document; no existing files were edited).\n\n## What I found (architecture summary)\n\n**Three strata:**\n1. **Bridge** — transport-only VS Code extension exposing Claude Code credentials at a local `/v1/messages` endpoint.\n2. **Agent loop** — `src/runner/run.js` (~1,370 lines), the bounded `for (step = 1..maxSteps)` orchestrator.\n3. **Tool pipeline** — `src/runner/tool-pipeline.js`, a deep module with a two-method interface (`toolDefinitions()`, `executeTurn()`) that owns permissions, confirmation, plan-mode fabrication, execution, journaling, and sink fan-out.\n\n**The runner loop, per step (documented in detail in the paper):**\n1. `pre_model_request` hook dispatch\n2. Instruction-delta detection (small diff → inject user message; large rewrite → rebuild system prompt)\n3. Compaction ladder (`applyCompactionLadder`) with persisted generation counter\n4. `cache_control` breakpoint budgeting + advisory token estimate\n5. Request build (streaming only for text output; effort/temperature optional)\n6. POST to bridge — transport errors share the tool failure streak and consume a step as retry budget\n7. Usage accounting → budget boundary (token/inherited-child budgets); 2× context backstop\n8. Assistant message append + session checkpoint\n9. Extraction: per-turn tool cap guard; zero tool uses → SUCCESS (autopsy, health, archive)\n10. `pipeline.executeTurn` with the **midTurnCheck seam** — reads run as a parallel batch, then the loop gets one checkpoint (semantic cycles, wall-clock, cost, budgets) *before any write executes*\n11. Tool results appended as one user message; persist; continue\n\n**Key invariants formalized in the paper:** effect pairing (ledger intent/result around every side effect), plan-mode write safety, observation linearity (sinks always see model-emitted order even under parallel disjoint-path writes with `--accept-edits`), catalog/execution coherence, the mid-turn write barrier, and budget inheritance for child agents.\n\nThe HTML is fully self-contained (inline CSS, academic layout with abstract, TOC, figures, invariant boxes, stop-reason table, and references) — open it directly in a browser.",
  "steps": 14,
  "duration_ms": 302243,
  "usage": {
    "input_tokens": 37049,
    "output_tokens": 19079,
    "cache_read_input_tokens": 71660,
    "cache_creation_input_tokens": 159504
  },
  "estimatedCostUsd": 1.3758540000000001
}