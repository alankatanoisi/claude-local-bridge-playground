'use strict';

/**
 * Behavioral regression tests for docs/command-builder.html.
 *
 * The fake DOM lives in helpers/command-builder-harness.js so the
 * combinatorial sweep (command-builder-combinatorics.test.js) can drive the
 * very same page script. Nothing here re-implements the builder's rules: every
 * assertion clicks the real controls and reads the real generated command.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { createHarness } = require('./helpers/command-builder-harness');

describe('command-builder behavior', () => {
  it('reacts to the LSP checkbox and copies exactly the visible raw command', async () => {
    const page = createHarness();
    const prompt = page.elements.get('prompt');
    const enableLsp = page.elements.get('enableLsp');

    assert.equal(page.elements.get('copyBtn').disabled, true, 'empty normal runs must be blocked');
    prompt.value = 'Find the definition of the selected symbol.';
    prompt.dispatch('input');
    enableLsp.checked = true;
    enableLsp.dispatch('change');

    const command = page.evaluate('buildRawCommand()');
    assert.match(command, /--enable-lsp/);
    assert.equal(
      page.toolChoices.find((choice) => choice.value === 'lsp_query').checked,
      true,
      'the LSP tool should become available when its gate is enabled',
    );
    assert.equal(page.elements.get('copyBtn').disabled, false);

    page.evaluate('copyCommand()');
    await Promise.resolve();
    assert.equal(page.clipboard.text, command);
  });

  it('makes Delegate a truthful agents-capability preset', () => {
    const page = createHarness();
    page.elements.get('enableLsp').checked = true;
    page.evaluate('render()');
    page.evaluate("applyPreset('delegate', PRESETS.delegate)");
    const command = page.evaluate('buildRawCommand()');

    assert.match(command, /--enable-lsp/);
    assert.match(command, /--capabilities agents/);
    assert.doesNotMatch(command, /--plan/, 'read-only visibility must not silently suppress orchestration');
    assert.doesNotMatch(command, /--tools 'none'/);
    assert.equal(page.toolChoices.find((choice) => choice.value === 'spawn_agent').checked, true);
    assert.equal(
      page.toolChoices.find((choice) => choice.value === 'lsp_query').checked,
      true,
      'a preset must not make the enabled LSP gate ineffective',
    );
  });

  it('blocks invalid resume/extract commands before copy', () => {
    const page = createHarness();
    page.elements.get('prompt').value = 'Continue the earlier review.';
    page.elements.get('resumeSession').checked = true;
    page.evaluate('render()');

    assert.equal(page.elements.get('copyBtn').disabled, true);
    assert.match(page.elements.get('validationWarnings').innerHTML, /Session id, Session path, or Fork from/);

    page.elements.get('sessionId').value = 'review-42';
    page.evaluate('render()');
    assert.equal(page.elements.get('copyBtn').disabled, false);
    assert.match(page.evaluate('buildRawCommand()'), /--session-id 'review-42' --resume-session/);

    page.elements.get('resumeSession').checked = false;
    page.elements.get('sessionExtract').checked = true;
    page.evaluate('render()');
    // Runtime rule (run.js maybeRunSessionExtract): a saved session path plus a
    // successful run. The hooks flag (--trusted-workspace) is a separate
    // consent and must not be demanded here.
    assert.equal(page.elements.get('copyBtn').disabled, false, 'extract needs only a saved session');
    assert.match(page.evaluate('buildRawCommand()'), /--session-extract/);

    page.elements.get('noSessionPersistence').checked = true;
    page.evaluate('render()');
    assert.equal(page.elements.get('copyBtn').disabled, true, 'extract cannot combine with disabled persistence');

    page.elements.get('noSessionPersistence').checked = false;
    page.elements.get('sessionId').value = '';
    page.evaluate('render()');
    assert.equal(page.elements.get('copyBtn').disabled, true, 'extract still needs a session id or path');
  });

  it('wires --worktree into live render, saved state, and restore-on-load', () => {
    const page = createHarness();
    page.elements.get('prompt').value = 'Make a small safe edit.';
    const worktreeStart = page.elements.get('worktreeStart');
    worktreeStart.checked = true;
    worktreeStart.dispatch('change');

    assert.match(page.evaluate('buildRawCommand()'), /--worktree/, 'checkbox must re-render the command by itself');
    assert.match(page.elements.get('summaryText').innerHTML, /inside a fresh git worktree/);
    assert.equal(JSON.parse(page.storage.get('command-builder-state')).worktreeStart, true);

    const reloaded = createHarness({ savedState: { prompt: 'Again.', worktreeStart: true } });
    assert.equal(reloaded.elements.get('worktreeStart').checked, true, 'saved --worktree choice must survive reload');
    assert.match(reloaded.evaluate('buildRawCommand()'), /--worktree/);

    // Runner-only flag: greyed out and not emitted while the coordinator is selected.
    reloaded.elements.get('commandMode').value = 'coordinator';
    reloaded.evaluate('render()');
    assert.doesNotMatch(reloaded.evaluate('buildRawCommand()'), /--worktree/);
    assert.equal(reloaded.elements.get('worktreeCoordinatorNote').classList.contains('show'), true);
    assert.equal(reloaded.elements.get('worktreeStart').checked, true, 'the choice is kept, not erased');
  });

  it('keeps presets whole recipes: --test-watch and --worktree never leak between them', () => {
    const page = createHarness();
    page.evaluate("applyPreset('verify', PRESETS.verify)");
    assert.match(page.evaluate('buildRawCommand()'), /--test-watch/);

    page.evaluate("applyPreset('full', PRESETS.full)");
    assert.doesNotMatch(page.evaluate('buildRawCommand()'), /--test-watch/, 'full did not ask for test-watch');

    page.evaluate("applyPreset('worktree', PRESETS.worktree)");
    const worktreeCommand = page.evaluate('buildRawCommand()');
    assert.match(worktreeCommand, /--worktree/);
    assert.match(worktreeCommand, /--capabilities edits,recovery,worktrees/);
    assert.doesNotMatch(worktreeCommand, /--accept-edits|--allow-shell/, 'worktree preset stays edit-ask');

    page.evaluate("applyPreset('minimal', PRESETS.minimal)");
    assert.doesNotMatch(page.evaluate('buildRawCommand()'), /--worktree/, 'minimal did not ask for a worktree');
  });

  it('preserves orthogonal capability groups across a manual permission-style change', () => {
    const page = createHarness();
    page.elements.get('prompt').value = 'Recall what we read earlier.';
    for (const choice of page.toolChoices) {
      if (choice.value === 'search_history' || choice.value === 'expand_history') choice.checked = true;
    }
    page.evaluate('render()');
    assert.match(page.evaluate('buildRawCommand()'), /--capabilities edits,recovery,history/);

    const style = page.elements.get('permissionStyle');
    style.value = 'look-only';
    style.dispatch('change');
    const readOnly = page.evaluate('buildRawCommand()');
    assert.match(readOnly, /--tools '[^']*search_history[^']*'/, 'history stays selected in look-only');
    assert.doesNotMatch(readOnly, /edit_file|write_file/);

    style.value = 'edit-auto';
    style.dispatch('change');
    assert.match(page.evaluate('buildRawCommand()'), /--accept-edits[\s\S]*--capabilities edits,recovery,history/);

    // Presets are whole recipes and do reset the group.
    page.evaluate("applyPreset('minimal', PRESETS.minimal)");
    assert.doesNotMatch(page.evaluate('buildRawCommand()'), /history/);
  });

  it('warns about session flags the CLI would ignore or silently discard', () => {
    const page = createHarness();
    page.elements.get('prompt').value = 'Continue.';
    page.elements.get('forkFrom').value = 'parent-1';
    page.evaluate('render()');
    assert.match(page.elements.get('validationWarnings').innerHTML, /copied conversation is replaced/);
    assert.equal(page.elements.get('copyBtn').disabled, false, 'a warning must not block copying');

    page.elements.get('resumeSession').checked = true;
    page.evaluate('render()');
    assert.doesNotMatch(page.elements.get('validationWarnings').innerHTML, /copied conversation is replaced/);

    page.elements.get('resumeSession').checked = false;
    page.elements.get('forkFrom').value = '';
    page.elements.get('continueFromLatest').checked = true;
    page.elements.get('sessionId').value = 'review-7';
    page.evaluate('render()');
    assert.match(page.elements.get('validationWarnings').innerHTML, /--continue is ignored/);
  });

  it('tells the truth about --dont-ask with shell and about task-scope step limits', () => {
    const page = createHarness();
    page.elements.get('prompt').value = 'Run the tests and fix them.';
    page.evaluate("applyPermissionStyle('edit-shell')");
    page.evaluate('render()');
    assert.match(page.elements.get('permissionCautions').innerHTML, /runs shell commands without asking/);
    assert.match(page.elements.get('summaryText').innerHTML, /run shell commands<\/strong> \(without asking\)/);
    assert.match(page.elements.get('permissionCautions').innerHTML, /ask_user_question is offered but fails closed/);

    page.evaluate("applyPermissionStyle('edit-ask')");
    page.elements.get('taskScope').checked = true;
    page.evaluate('render()');
    assert.match(page.elements.get('summaryText').innerHTML, /stop after 8 steps/);
    assert.match(page.elements.get('validationWarnings').innerHTML, /lowers the step limit to 8/);
    page.elements.get('maxSteps').value = '12';
    page.evaluate('render()');
    assert.match(page.elements.get('summaryText').innerHTML, /stop after 12 steps/);
    assert.match(page.evaluate('buildRawCommand()'), /--max-steps 12 [\s\S]*--task-scope/);
  });

  it('blocks a response-token allowance above the selected model ceiling', () => {
    const page = createHarness();
    page.elements.get('prompt').value = 'Summarize.';
    page.elements.get('model').value = 'claude-haiku-4-5';
    page.elements.get('maxTokens').value = '100000';
    page.evaluate('render()');
    assert.equal(page.elements.get('copyBtn').disabled, true);
    assert.match(page.elements.get('validationWarnings').innerHTML, /exceed the maximum of 64000/);

    page.elements.get('maxTokens').value = '64000';
    page.evaluate('render()');
    assert.equal(page.elements.get('copyBtn').disabled, false);
  });

  it('preserves dependent context choices without emitting inactive flags', () => {
    const page = createHarness();
    page.elements.get('prompt').value = 'Explain this repository.';
    page.elements.get('includeClaudeMd').checked = true;
    page.elements.get('includeRepoMap').checked = true;
    page.evaluate('render()');

    assert.doesNotMatch(page.evaluate('buildRawCommand()'), /--include-(?:claude-md|repo-map)/);
    assert.equal(page.elements.get('includeClaudeMd').checked, true, 'inactive child choice should be preserved');

    page.elements.get('includeRepoContext').checked = true;
    page.evaluate('render()');
    assert.match(page.evaluate('buildRawCommand()'), /--include-repo-context --include-claude-md --include-repo-map/);

    page.elements.get('bareContext').checked = true;
    page.evaluate('render()');
    assert.doesNotMatch(page.evaluate('buildRawCommand()'), /--include-(?:repo-context|claude-md|repo-map)/);
    assert.equal(
      page.elements.get('includeRepoMap').checked,
      true,
      'bare mode should not erase the saved child choice',
    );
  });

  it('keeps spaced template arguments intact and never stores caller tokens', () => {
    const page = createHarness();
    page.elements.get('prompt').value = 'Review error handling.';
    page.elements.get('promptTemplate').value = 'review';
    page.elements.get('promptArgs').value = 'focus=error handling\narea=src runner';
    page.elements.get('callerToken').value = 'literal-secret-token';
    page.evaluate('render()');

    const command = page.evaluate('buildRawCommand()');
    assert.match(command, /--prompt-arg 'focus=error handling'/);
    assert.match(command, /--prompt-arg 'area=src runner'/);
    assert.match(command, /--caller-token 'literal-secret-token'/);

    const saved = JSON.parse(page.storage.get('command-builder-state'));
    assert.equal(Object.prototype.hasOwnProperty.call(saved, 'callerToken'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(saved, 'replayMode'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(saved, 'repairMode'), false);
    assert.doesNotMatch(page.storage.get('command-builder-state'), /literal-secret-token/);
  });

  it('keeps every shipped preset free of retired command flags', () => {
    const page = createHarness();
    const presetNames = page.evaluate('Object.keys(PRESETS)');

    for (const name of presetNames) {
      page.evaluate(`applyPreset(${JSON.stringify(name)}, PRESETS[${JSON.stringify(name)}])`);
      const command = page.evaluate('buildRawCommand()');
      assert.doesNotMatch(command, /(?:^|\s)--resume(?:\s|$)/, name + ' emitted retired transcript resume');
      assert.doesNotMatch(command, /--permission-mode/, name + ' emitted hidden permission state');
    }
  });

  it('builds and copies a fully configured coordinator command', async () => {
    const page = createHarness();
    page.elements.get('commandMode').value = 'coordinator';
    page.elements.get('prompt').value = 'Research the runner, implement one safe improvement, and verify it.';
    page.evaluate("applyPermissionStyle('edit-shell')");

    page.elements.get('coordinatorVerify').checked = true;
    page.elements.get('coordinatorResearchPlan').value = '.bridge-runner/research-plan.json';
    page.elements.get('coordinatorModel').value = 'claude-opus-4-6';
    page.elements.get('coordinatorMaxTokens').value = '4096';
    page.elements.get('coordinatorMaxSteps').value = '24';
    page.elements.get('coordinatorOutputFormat').value = 'json';
    page.elements.get('coordinatorEffort').value = 'high';
    page.elements.get('coordinatorThinking').value = 'off';
    page.elements.get('coordinatorTemperature').value = '0.2';
    page.elements.get('coordinatorSessionId').value = 'coord-review';
    page.elements.get('coordinatorTraceLevel').value = 'redacted';
    page.elements.get('coordinatorMaxWallClockMs').value = '600000';
    page.elements.get('coordinatorMaxCostUsd').value = '2.5';
    page.elements.get('coordinatorBudgetInputTokens').value = '200000';
    page.elements.get('coordinatorBudgetOutputTokens').value = '32000';
    page.elements.get('coordinatorBridgeUrl').value = 'http://127.0.0.1:11437';
    page.elements.get('coordinatorCallerToken').value = '$BRIDGE_CALLER_TOKEN';
    page.elements.get('coordinatorNoNetwork').checked = true;
    page.elements.get('coordinatorTrustWorkspace').checked = true;
    page.elements.get('coordinatorEnableLsp').checked = true;
    page.elements.get('coordinatorAgents').checked = true;
    page.elements.get('coordinatorWorktrees').checked = true;
    page.elements.get('coordinatorSkills').checked = true;
    page.elements.get('coordinatorTestWatch').checked = true;
    page.evaluate('render()');

    const command = page.evaluate('buildRawCommand()');
    assert.match(command, /node bin\/local-bridge-coordinator\.js/);
    assert.match(command, /--phases research,synthesize,execute,verify/);
    assert.match(command, /--research-plan '\.bridge-runner\/research-plan\.json'/);
    assert.match(command, /--model 'claude-opus-4-6'/);
    assert.match(command, /--max-tokens 4096 --max-steps 24/);
    assert.match(command, /--output-format json/);
    assert.match(command, /--effort high --thinking off --temperature 0\.2/);
    assert.match(command, /--session-id 'coord-review'/);
    assert.match(command, /--max-wall-clock-ms 600000/);
    assert.match(command, /--max-cost-usd 2\.5/);
    assert.match(command, /--budget-input-tokens 200000 --budget-output-tokens 32000/);
    assert.match(command, /--no-network --trust-workspace --trace-level redacted/);
    assert.match(command, /--capabilities edits,recovery,agents,worktrees,skills/);
    assert.match(command, /--accept-edits --dont-ask --allow-shell --chaos-ok --enable-lsp --test-watch/);
    assert.doesNotMatch(command, /--prompt-template|--include-file|--resume-session/);
    assert.equal(page.elements.get('copyBtn').disabled, false);

    page.evaluate('copyCommand()');
    await Promise.resolve();
    assert.equal(page.clipboard.text, command);
    assert.doesNotMatch(page.storage.get('command-builder-state'), /BRIDGE_CALLER_TOKEN/);
  });

  it('blocks impossible coordinator phase combinations without erasing inactive choices', () => {
    const page = createHarness();
    page.elements.get('commandMode').value = 'coordinator';
    page.elements.get('prompt').value = 'Inspect this repository.';
    page.elements.get('coordinatorResearch').checked = false;
    page.elements.get('coordinatorSynthesize').checked = false;
    page.elements.get('coordinatorExecute').checked = false;
    page.elements.get('coordinatorVerify').checked = false;
    page.evaluate('render()');

    assert.equal(page.elements.get('copyBtn').disabled, true);
    assert.match(page.elements.get('validationWarnings').innerHTML, /Select at least one coordinator phase/);

    page.elements.get('coordinatorVerify').checked = true;
    page.evaluate('render()');
    assert.equal(page.elements.get('copyBtn').disabled, true);
    assert.match(page.elements.get('validationWarnings').innerHTML, /Verify needs Execute/);

    page.elements.get('coordinatorExecute').checked = true;
    page.elements.get('coordinatorResearchPlan').value = 'saved-plan.json';
    page.evaluate('render()');
    assert.equal(page.elements.get('copyBtn').disabled, false);
    assert.equal(page.elements.get('coordinatorResearchPlan').value, 'saved-plan.json');
    assert.doesNotMatch(page.evaluate('buildRawCommand()'), /--research-plan/);
    assert.match(page.elements.get('validationWarnings').innerHTML, /saved but inactive until Research/);
  });

  it('persists ordinary checkbox changes through their real event listeners', () => {
    const page = createHarness();
    const mode = page.elements.get('commandMode');
    const verify = page.elements.get('coordinatorVerify');

    mode.value = 'coordinator';
    mode.dispatch('change');
    verify.checked = true;
    verify.dispatch('change');

    const saved = JSON.parse(page.storage.get('command-builder-state'));
    assert.equal(saved.commandMode, 'coordinator');
    assert.equal(saved.coordinatorVerify, true);
  });

  it("switches command types without resetting either mode's choices", () => {
    const page = createHarness();
    page.elements.get('prompt').value = 'Inspect this repository.';
    page.elements.get('enableLsp').checked = true;
    page.elements.get('commandMode').value = 'coordinator';
    page.elements.get('coordinatorVerify').checked = true;
    page.evaluate('render()');

    page.elements.get('commandMode').value = 'runner';
    page.evaluate('render()');
    assert.equal(page.elements.get('enableLsp').checked, true);
    assert.match(page.evaluate('buildRawCommand()'), /local-bridge-runner\.js[\s\S]*--enable-lsp/);

    page.elements.get('commandMode').value = 'coordinator';
    page.evaluate('render()');
    assert.equal(page.elements.get('coordinatorVerify').checked, true);
    assert.match(page.evaluate('buildRawCommand()'), /--phases research,synthesize,execute,verify/);
  });
});
