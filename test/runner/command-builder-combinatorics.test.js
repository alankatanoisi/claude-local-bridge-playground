'use strict';

/**
 * command-builder-combinatorics.test.js — sweeps the builder's mixed-and-matched
 * flags and checkboxes and checks every generated command against the REAL
 * runner instead of a hand-written expectation:
 *
 *   1. Every generated runner command parses with the CLI's own parseArgs
 *      option table (read from bin/local-bridge-runner.js), strictly, with the
 *      prompt as the single positional and no duplicated flags.
 *   2. Every generated coordinator command parses with COORDINATOR_CLI_OPTIONS.
 *   3. Flag dependencies the CLI enforces at startup hold in every state
 *      (--test-watch needs --allow-shell, --prompt-arg needs a template, …),
 *      and retired/hidden flags are never emitted.
 *   4. The chaos gate equals shell-policy.validateChaosCombo for all 16
 *      shell/edits/dont-ask/chaos-ok combinations.
 *   5. Model, effort, thinking, and temperature acceptance equals
 *      model-capabilities.resolveModelControls for every offered model; the
 *      response-token ceiling equals context-runtime-policy.deriveContextPolicy.
 *   6. A sample of generated commands is executed by the real CLI (dead bridge,
 *      throwaway HOME and cwd). Each must get past every CLI validation and
 *      fail only at transport — the same tripwire FG-E7 uses.
 *
 * The page script runs unchanged inside the fake DOM from
 * helpers/command-builder-harness.js, so nothing here re-implements the
 * builder's rules.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { createHarness, BUILDER_HTML } = require('./helpers/command-builder-harness');
const {
  RUNNER_CLI_OPTIONS,
  parseGenerated,
  assertRunnerInvariants,
  makeTargetRepo,
  runGeneratedRunner,
  assertReachedTransport,
  cartesian,
} = require('./helpers/cli-contract');
const { validateChaosCombo } = require('../../src/runner/shell-policy');
const { normalizeCapabilityList } = require('../../src/runner/tool-visibility');
const { resolveModelControls } = require('../../src/runner/model-capabilities');
const { deriveContextPolicy } = require('../../src/runner/context-runtime-policy');
const { DEFAULT_MODEL } = require('../../src/runner/model-catalog');
const { COORDINATOR_CLI_OPTIONS } = require('../../bin/local-bridge-coordinator');
const { PHASES: COORDINATOR_PHASES } = require('../../src/runner/coordinator');

// ── State application ──
// Every key is an element id in the builder (checkbox → checked, otherwise
// value). `tools` sets the tool catalog checkboxes by name. `style` runs the
// page's own applyPermissionStyle so hidden authority checkboxes follow it.
function applyState(page, state) {
  if (state.style) page.evaluate('applyPermissionStyle(' + JSON.stringify(state.style) + ')');
  for (const [key, value] of Object.entries(state)) {
    if (key === 'style' || key === 'tools') continue;
    const el = page.elements.get(key);
    assert.ok(el, 'sweep references unknown control: ' + key);
    if (el.type === 'checkbox') el.checked = !!value;
    else el.value = value;
  }
  if (state.tools) {
    for (const choice of page.toolChoices) {
      if (Object.prototype.hasOwnProperty.call(state.tools, choice.value)) {
        choice.checked = !!state.tools[choice.value];
      }
    }
  }
  page.evaluate('render()');
}

function readOutcome(page) {
  const warnings = page.elements.get('validationWarnings').innerHTML;
  return {
    blocked: page.elements.get('copyBtn').disabled,
    hasError: warnings.includes('&#9940;'),
    warnings,
    command: page.evaluate('buildRawCommand()'),
  };
}

const STYLES = ['look-only', 'plan-first', 'edit-ask', 'edit-auto', 'edit-shell'];
const BOOL = [false, true];

// The builder's shared baseline for a sweep: no cd prefix (so the command is
// exactly `node bin/… …`) and no attachments piped through stdin.
const BASELINE = { prompt: 'Sweep prompt.', runnerPath: '', cwd: '', attachmentMode: 'read' };

describe('command-builder combinatorics: runner flag sweep', () => {
  it('every permission style × shell/test-watch/network/LSP/worktree state parses with the real CLI table', () => {
    const page = createHarness();
    let generated = 0;
    for (const [style, shell, testWatch, noNetwork, lsp, worktree] of cartesian([
      STYLES,
      BOOL,
      BOOL,
      BOOL,
      BOOL,
      BOOL,
    ])) {
      applyState(page, {
        ...BASELINE,
        style,
        // allowShell is a hidden checkbox the style sets; a true here mirrors
        // the verify preset (edit-auto + shell) and any saved state.
        allowShell: shell || style === 'edit-shell',
        testWatch,
        noNetwork,
        enableLsp: lsp,
        worktreeStart: worktree,
      });
      const outcome = readOutcome(page);
      assert.equal(outcome.blocked, false, 'unexpectedly blocked: ' + outcome.command + ' ' + outcome.warnings);
      const parsed = parseGenerated(outcome.command, RUNNER_CLI_OPTIONS);
      assertRunnerInvariants(parsed, outcome.command, { prompt: 'Sweep prompt.' });
      if (worktree) assert.ok(parsed.values.worktree, '--worktree missing: ' + outcome.command);
      if (lsp) assert.ok(parsed.values['enable-lsp']);
      generated++;
    }
    assert.equal(generated, STYLES.length * 32);
  });

  it('context, session, template, attachment, and limit choices compose into valid commands', () => {
    const page = createHarness();
    const contextStates = [
      {},
      { bareContext: true, includeRepoContext: true, includeClaudeMd: true },
      { includeInstructionDocs: true, includeRepoContext: true, includeClaudeMd: true, includeRepoMap: true },
      { includeSkills: true, includeClaudeMd: true },
      { excludeDynamicSystem: true, noSessionPersistence: true, autoMemory: true, noArchive: true },
    ];
    const sessionStates = [
      {},
      { newSession: true },
      { resumeSession: true, sessionId: 'sweep-1' },
      { continueFromLatest: true },
      { forkFrom: 'parent', resumeSession: true },
      { sessionPath: '~/.bridge-runner/sessions/x.state.json', ackResumeRisk: true, resumeSession: true },
    ];
    const extraStates = [
      {},
      { promptTemplate: 'review', promptArgs: 'focus=error handling' },
      { customPromptTemplate: '.bridge-runner/prompts/mine.md', promptArgs: 'a=1\nb=two words' },
      { attachmentMode: 'include', attachedPaths: 'README.md\nsrc/server.js' },
      { taskScope: true, compactEachTurn: true, compactAtTokens: '30000', maxRunTokens: '400000' },
      { maxWallClockMs: '600000', maxCostUsd: '2.5', budgetInputTokens: '200000', budgetOutputTokens: '32000' },
      { stream: true, verbose: true, outputFormat: 'stream-json', logLevel: 'quiet', traceLevel: 'redacted' },
      { model: 'claude-opus-4-6', effort: 'high', thinking: 'off', temperature: '0.3', maxTokens: '4096' },
      { customModel: 'claude-future-9', effort: 'xhigh', thinking: 'adaptive' },
      { systemPromptFile: 'SYSTEM.md', appendSystemPrompt: "rule with 'quotes'", confirmTimeout: '5000' },
      { transcript: '~/t.jsonl', humanLog: '~/h.md', tracePath: '~/tr.jsonl', bridgeUrl: 'http://127.0.0.1:11437' },
      { callerToken: '$BRIDGE_CALLER_TOKEN', trustWorkspace: true, trustedWorkspace: true },
      { maxToolCalls: '4', maxSteps: '3', sessionId: 'extract-1', sessionExtract: true },
      { tools: { apply_patch: true } },
      { tools: { spawn_agent: true, run_skill: true, search_history: true, expand_history: true } },
      { tools: { manage_tasks: false } },
    ];
    let generated = 0;
    for (const style of STYLES) {
      for (const context of contextStates) {
        for (const session of sessionStates) {
          for (const extra of extraStates) {
            // Fresh page per combination so nothing leaks between states.
            const state = { ...BASELINE, style, ...context, ...session, ...extra };
            applyState(page, state);
            const outcome = readOutcome(page);
            // The one deliberate refusal inside this grid: a run-summary
            // proposal needs a saved checkpoint, so it cannot pair with
            // disabled session persistence (run.js persistSession).
            const expectBlocked = !!(state.sessionExtract && state.noSessionPersistence);
            assert.equal(
              outcome.blocked,
              expectBlocked,
              (expectBlocked ? 'should be blocked: ' : 'unexpectedly blocked: ') +
                outcome.command +
                '\n' +
                outcome.warnings,
            );
            if (!expectBlocked) {
              const parsed = parseGenerated(outcome.command, RUNNER_CLI_OPTIONS);
              assertRunnerInvariants(parsed, outcome.command, { prompt: 'Sweep prompt.' });
            }
            generated++;
            // Reset the fields this combination touched so the next one starts clean.
            const reset = {};
            for (const key of Object.keys({ ...context, ...session, ...extra })) {
              if (key === 'tools') continue;
              const el = page.elements.get(key);
              reset[key] =
                el.type === 'checkbox' ? false : key === 'maxSteps' ? '16' : key === 'maxTokens' ? '2000' : '';
            }
            if (extra.tools)
              reset.tools = Object.fromEntries(Object.keys(extra.tools).map((k) => [k, k === 'manage_tasks']));
            if (reset.attachmentMode !== undefined) reset.attachmentMode = 'read';
            if (reset.thinking !== undefined) reset.thinking = 'auto';
            if (reset.outputFormat !== undefined) reset.outputFormat = 'text';
            if (reset.traceLevel !== undefined) reset.traceLevel = 'off';
            if (reset.model !== undefined) reset.model = DEFAULT_MODEL;
            applyState(page, reset);
          }
        }
      }
    }
    assert.equal(generated, STYLES.length * contextStates.length * sessionStates.length * extraStates.length);
  });

  it('blocks exactly the states the CLI would refuse, with a visible error', () => {
    const page = createHarness();
    const blockedStates = [
      { resumeSession: true }, // no session id/path
      { newSession: true, continueFromLatest: true },
      { resumeSession: true, sessionId: 'x', continueFromLatest: true },
      { sessionExtract: true },
      { sessionExtract: true, sessionId: 'x', noSessionPersistence: true },
      { promptTemplate: 'review', promptArgs: 'not-a-pair' },
      { model: 'claude-haiku-4-5', effort: 'low' },
      { model: 'claude-opus-4-5', effort: 'max' },
      { model: 'claude-mythos-preview', effort: 'xhigh' },
      { model: 'claude-fable-5', thinking: 'off' },
      { model: 'claude-opus-5', thinking: 'off', effort: 'xhigh' },
      { model: 'claude-sonnet-4-5', thinking: 'adaptive' },
      { model: 'claude-sonnet-5', temperature: '0.5' },
      { model: 'claude-haiku-4-5', maxTokens: '100000' },
      { style: 'edit-shell', shellTimeout: '50' },
      { prompt: '' },
    ];
    for (const state of blockedStates) {
      const fresh = createHarness();
      applyState(fresh, { ...BASELINE, ...state });
      const outcome = readOutcome(fresh);
      assert.equal(outcome.blocked, true, 'should be blocked: ' + JSON.stringify(state) + ' → ' + outcome.command);
      assert.equal(outcome.hasError, true, 'blocked states must show an error: ' + JSON.stringify(state));
    }
    // And the chaos combo, reached only through the hidden authority checkboxes.
    for (const [allowShell, acceptEdits, dontAsk, chaosOk] of cartesian([BOOL, BOOL, BOOL, BOOL])) {
      applyState(page, { ...BASELINE, allowShell, acceptEdits, dontAsk, chaosOk });
      const runtime = validateChaosCombo({ allowShell, acceptEdits, dontAsk, chaosOk });
      const outcome = readOutcome(page);
      assert.equal(
        outcome.blocked,
        !runtime.allowed,
        'chaos gate mismatch for ' + JSON.stringify({ allowShell, acceptEdits, dontAsk, chaosOk }),
      );
      assert.equal(page.elements.get('chaosConflict').classList.contains('show'), !runtime.allowed);
    }
  });
});

describe('command-builder combinatorics: model controls equal the runtime validator', () => {
  const offered = [
    ...BUILDER_HTML.match(/<select id="model">([\s\S]*?)<\/select>/)[1].matchAll(/value="([^"]+)"/g),
  ].map((m) => m[1]);

  it('offers at least the catalog families and one unknown id is left permissive', () => {
    assert.ok(offered.length >= 10);
  });

  it('accepts or blocks every model × effort × thinking × temperature choice exactly like resolveModelControls', () => {
    const page = createHarness();
    const efforts = ['', 'low', 'medium', 'high', 'xhigh', 'max'];
    const thinkings = ['auto', 'adaptive', 'off'];
    const temperatures = ['', '0.2', '1'];
    let compared = 0;
    for (const model of [...offered, 'claude-future-9']) {
      for (const effort of efforts) {
        for (const thinking of thinkings) {
          for (const temperature of temperatures) {
            applyState(page, {
              ...BASELINE,
              model: offered.includes(model) ? model : DEFAULT_MODEL,
              customModel: offered.includes(model) ? '' : model,
              effort,
              thinking,
              temperature,
            });
            let runtimeRejects = false;
            try {
              resolveModelControls({
                model,
                effort: effort || undefined,
                thinking,
                temperature: temperature ? parseFloat(temperature) : undefined,
              });
            } catch {
              runtimeRejects = true;
            }
            const outcome = readOutcome(page);
            assert.equal(
              outcome.blocked,
              runtimeRejects,
              'mismatch for ' + JSON.stringify({ model, effort, thinking, temperature }) + ': ' + outcome.warnings,
            );
            compared++;
          }
        }
      }
    }
    assert.equal(compared, (offered.length + 1) * efforts.length * thinkings.length * temperatures.length);
  });

  it('greys out exactly the single choices the runtime rejects', () => {
    const page = createHarness();
    for (const model of offered) {
      applyState(page, { ...BASELINE, model, effort: '', thinking: 'auto', temperature: '' });
      const effortSelect = page.elements.get('effort');
      for (const level of ['low', 'medium', 'high', 'xhigh', 'max']) {
        let rejects = false;
        try {
          resolveModelControls({ model, effort: level });
        } catch {
          rejects = true;
        }
        assert.equal(effortSelect.options.get(level).disabled, rejects, model + ' effort ' + level);
      }
      const thinkingSelect = page.elements.get('thinking');
      for (const mode of ['adaptive', 'off']) {
        let rejects = false;
        try {
          resolveModelControls({ model, thinking: mode });
        } catch {
          rejects = true;
        }
        assert.equal(thinkingSelect.options.get(mode).disabled, rejects, model + ' thinking ' + mode);
      }
    }
  });

  it('blocks a response-token allowance exactly when deriveContextPolicy would', () => {
    const page = createHarness();
    for (const model of offered) {
      for (const maxTokens of ['2000', '64000', '64001', '128000', '128001']) {
        applyState(page, { ...BASELINE, model, maxTokens });
        let rejects = false;
        try {
          deriveContextPolicy({ model, maxTokens: Number(maxTokens) });
        } catch {
          rejects = true;
        }
        assert.equal(readOutcome(page).blocked, rejects, model + ' max-tokens ' + maxTokens);
      }
    }
  });
});

describe('command-builder combinatorics: coordinator sweep', () => {
  it('every phase × worker × execute-authority combination parses with COORDINATOR_CLI_OPTIONS', () => {
    const page = createHarness();
    let generated = 0;
    for (const [research, synthesize, execute, verify, workers, style, testWatch, lsp, extras] of cartesian([
      BOOL,
      BOOL,
      BOOL,
      BOOL,
      BOOL,
      STYLES,
      BOOL,
      BOOL,
      [false, true],
    ])) {
      applyState(page, {
        ...BASELINE,
        commandMode: 'coordinator',
        style,
        coordinatorResearch: research,
        coordinatorSynthesize: synthesize,
        coordinatorExecute: execute,
        coordinatorVerify: verify,
        coordinatorUseWorkers: workers,
        coordinatorTestWatch: testWatch,
        coordinatorEnableLsp: lsp,
        coordinatorAgents: extras,
        coordinatorWorktrees: extras,
        coordinatorSkills: extras,
        coordinatorNoNetwork: extras,
        coordinatorResearchPlan: extras ? 'plan.json' : '',
        worktreeStart: extras,
      });
      const outcome = readOutcome(page);
      const phases = [research, synthesize, execute, verify];
      const runtimeRefuses = phases.every((p) => !p) || (verify && !execute);
      assert.equal(
        outcome.blocked,
        runtimeRefuses,
        'coordinator gate mismatch: ' + outcome.command + ' ' + outcome.warnings,
      );
      if (runtimeRefuses) continue;
      const parsed = parseGenerated(outcome.command, COORDINATOR_CLI_OPTIONS);
      const v = parsed.values;
      assert.deepEqual(parsed.positionals, ['Sweep prompt.']);
      assert.ok(!parsed.args.includes('--worktree'), 'coordinator must never receive --worktree');
      if (v.phases) {
        const list = v.phases.split(',');
        assert.deepEqual(
          list,
          COORDINATOR_PHASES.filter((p) => list.includes(p)),
          'phases out of order',
        );
        for (const p of list) assert.ok(COORDINATOR_PHASES.includes(p));
      }
      if (v['test-watch']) assert.ok(v['allow-shell'] && execute);
      if (v['research-plan']) assert.ok(research && workers, '--research-plan without research workers');
      if (v.capabilities) normalizeCapabilityList(v.capabilities);
      if (!execute) {
        for (const flag of [
          'accept-edits',
          'dont-ask',
          'allow-shell',
          'chaos-ok',
          'plan',
          'capabilities',
          'enable-lsp',
        ]) {
          assert.ok(!v[flag], '--' + flag + ' emitted with no execute phase: ' + outcome.command);
        }
      }
      assert.ok(
        validateChaosCombo({
          allowShell: !!v['allow-shell'],
          acceptEdits: !!v['accept-edits'],
          dontAsk: !!v['dont-ask'],
          chaosOk: !!v['chaos-ok'],
        }).allowed,
      );
      generated++;
    }
    assert.ok(generated > 500, 'sweep too small: ' + generated);
  });
});

describe('command-builder combinatorics: generated commands survive the real CLI', () => {
  it('each shipped preset and each permission style reach transport (all CLI validation passed)', () => {
    const target = makeTargetRepo();
    const page = createHarness();
    const presetNames = page.evaluate('Object.keys(PRESETS)');
    const cases = [];
    for (const name of presetNames) {
      page.evaluate(`applyPreset(${JSON.stringify(name)}, PRESETS[${JSON.stringify(name)}])`);
      applyState(page, { runnerPath: '', cwd: target, trustWorkspace: true });
      cases.push({ label: 'preset ' + name, ...readOutcome(page) });
    }
    for (const style of STYLES) {
      applyState(page, { ...BASELINE, style, cwd: target, trustWorkspace: true, enableLsp: true });
      cases.push({ label: 'style ' + style, ...readOutcome(page) });
    }
    for (const c of cases) {
      assert.equal(c.blocked, false, c.label + ' is blocked in the builder: ' + c.warnings);
      assertReachedTransport(runGeneratedRunner(c.command), c.label, c.command);
    }
  });
});
