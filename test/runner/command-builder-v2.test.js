'use strict';

/**
 * command-builder-v2.test.js — docs/command-builder-v2.html.
 *
 * V2 keeps every rule in a DOM-free core (<script id="builder-core">), so
 * these tests load that script alone and drive Core.derive() directly. The
 * checks are the same "ask the real runner" checks the V1 sweep uses
 * (helpers/cli-contract.js): the CLI's own option table, chaos gate, model
 * validator, and context policy, plus dead-bridge spawns for the recipes.
 *
 * Drift tests pin the mirrored runtime facts (permission MODES, capability
 * groups, tool categories, model rules, prompt templates) to their sources.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const {
  RUNNER_CLI_OPTIONS,
  parseGenerated,
  assertRunnerInvariants,
  makeTargetRepo,
  runGeneratedRunner,
  assertReachedTransport,
  cartesian,
} = require('./helpers/cli-contract');
const { TOOLS, CATEGORIES, CAPABILITY_GROUPS, DEFAULT_HIDDEN_TOOLS } = require('../../src/runner/tool-catalog');
const { isToolVisible, normalizeCapabilityList } = require('../../src/runner/tool-visibility');
const { MODES } = require('../../src/runner/permissions');
const { validateChaosCombo } = require('../../src/runner/shell-policy');
const { resolveModelControls, EFFORT_LEVELS, THINKING_MODES } = require('../../src/runner/model-capabilities');
const { deriveContextPolicy } = require('../../src/runner/context-runtime-policy');
const { catalogEntryForModel, DEFAULT_MODEL } = require('../../src/runner/model-catalog');
const promptRegistry = require('../../src/runner/prompts/registry');
const { COORDINATOR_CLI_OPTIONS } = require('../../bin/local-bridge-coordinator');
const { PHASES: COORDINATOR_PHASES } = require('../../src/runner/coordinator');

const V2_PATH = path.join(__dirname, '..', '..', 'docs', 'command-builder-v2.html');
const V2_HTML = fs.readFileSync(V2_PATH, 'utf8');

function loadCore() {
  const match = V2_HTML.match(/<script id="builder-core">([\s\S]*?)<\/script>/);
  assert.ok(match, 'V2 must keep its rules in <script id="builder-core">');
  const context = vm.createContext({});
  vm.runInContext(match[1] + '\nglobalThis.Core = Core;', context, { filename: V2_PATH });
  return context.Core;
}
const Core = loadCore();

// A state with the given overrides applied (deep, only for plain objects).
function stateWith(overrides = {}) {
  const base = Core.defaultState();
  const deep = (t, s) => {
    for (const [k, v] of Object.entries(s)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) deep(t[k], v);
      else t[k] = v;
    }
  };
  deep(base, { prompt: 'Sweep prompt.', ...overrides });
  return base;
}

const FILES = ['look', 'propose', 'ask', 'auto'];
const SHELL = ['off', 'ask', 'unattended'];
const BOOL = [false, true];

describe('command-builder v2: mirrored runtime facts do not drift', () => {
  // Values built inside the vm context carry that realm's prototypes, which
  // strict deep-equal rejects; a JSON round-trip yields plain host objects.
  const plain = (value) => JSON.parse(JSON.stringify(value));

  it('permission MODES equal src/runner/permissions.js', () => {
    assert.deepEqual(plain(Core.MODES), plain(MODES));
  });

  it('capability groups, core tools, hidden tool, and tool categories equal the tool catalog', () => {
    const runtimeGroups = { ...CAPABILITY_GROUPS };
    for (const g of Core.GROUPS) {
      const expected = [...runtimeGroups[g.id]].filter((t) => t !== Core.PATCH_TOOL);
      assert.deepEqual(plain(g.tools).sort(), expected.sort(), 'group ' + g.id);
    }
    assert.deepEqual(
      plain(Core.GROUPS.map((g) => g.id)).sort(),
      Object.keys(runtimeGroups)
        .filter((g) => g !== 'core')
        .sort(),
    );
    assert.deepEqual(plain(Core.CORE_TOOLS).sort(), [...runtimeGroups.core].sort());
    assert.deepEqual([...DEFAULT_HIDDEN_TOOLS], [Core.PATCH_TOOL]);
    assert.deepEqual(plain(Core.TOOL_CATEGORY), plain(CATEGORIES));
    for (const t of Object.keys(TOOLS)) assert.ok(Core.TOOL_BLURB[t], 'blurb missing for ' + t);
    // The runtime no-flag surface is exactly the core.
    const runtimeDefault = Object.keys(TOOLS).filter((t) => isToolVisible(t, {}));
    assert.deepEqual([...runtimeDefault].sort(), plain(Core.CORE_TOOLS).sort());
  });

  it('MODEL_RULES equal the runtime catalog for every offered model', () => {
    const kind = (t) => ({ 'manual-only': 'manual', 'manual-or-none': 'manual' })[t] || t;
    assert.equal(
      Core.MODEL_RULES[0].id,
      DEFAULT_MODEL,
      'the first (default-selected) model must be the runtime default',
    );
    assert.equal(Core.DEFAULTS.model, DEFAULT_MODEL);
    for (const rule of Core.MODEL_RULES) {
      const entry = catalogEntryForModel(rule.id);
      assert.ok(entry, rule.id + ' unknown to the runtime catalog');
      assert.deepEqual(plain(rule.effort), entry.effortLevels ? [...entry.effortLevels] : null, rule.id + ' effort');
      assert.equal(rule.thinking, kind(entry.thinking), rule.id + ' thinking');
      assert.deepEqual(
        plain(rule.offEffort || null),
        entry.thinkingOffEffortLevels ? [...entry.thinkingOffEffortLevels] : null,
        rule.id + ' offEffort',
      );
      assert.equal(rule.sampling, entry.sampling, rule.id + ' sampling');
      assert.equal(rule.maxOutput, entry.maxOutputTokens, rule.id + ' maxOutput');
    }
    assert.deepEqual(plain(Core.EFFORT_LEVELS), [...EFFORT_LEVELS]);
    assert.deepEqual(plain(Core.THINKING_MODES), [...THINKING_MODES]);
  });

  it('TEMPLATES equal the built-in prompt registry', () => {
    assert.deepEqual(plain(Core.TEMPLATES.map((t) => t.id)).sort(), promptRegistry.listBuiltinNames().slice().sort());
  });

  it('every runner CLI flag is either emitted by the core or deliberately left out', () => {
    // Flags the V2 form does not offer, each with the reason.
    const notOffered = new Set([
      'help',
      'resume', // deprecated transcript resume, rejected by the CLI
      'max-context-tokens', // deprecated alias
      'permission-mode', // bundles are expressed by the two authority dials
      'allowed-tools', // alias of --tools
      'template', // alias of --prompt-template
      'inherit-workspace-trust', // internal parent→child trust handoff
      'update', // golden-eval maintenance switch
      'replay', // experimental ledger utility
      'repair', // experimental ledger utility
      'approve-repair', // experimental ledger utility
      'review-memory', // maintenance command (listed in the panel as a snippet)
      'verbose', // V2 emits the canonical --log-level verbose instead
    ]);
    const emitted = new Set([...V2_HTML.matchAll(/add\('--([a-z][a-z0-9-]*)'/g)].map((m) => m[1]));
    for (const flag of Object.keys(RUNNER_CLI_OPTIONS)) {
      assert.ok(
        emitted.has(flag) || notOffered.has(flag),
        'runner flag --' + flag + ' is neither emitted nor listed as not offered',
      );
    }
    for (const flag of emitted) {
      assert.ok(RUNNER_CLI_OPTIONS[flag] || COORDINATOR_CLI_OPTIONS[flag], 'V2 emits unknown flag --' + flag);
    }
    for (const flag of Object.keys(COORDINATOR_CLI_OPTIONS)) {
      if (flag === 'help') continue;
      assert.ok(emitted.has(flag), 'coordinator flag --' + flag + ' is never emitted by V2');
    }
  });
});

describe('command-builder v2: authority dials equal the runtime gates', () => {
  it('files × shell × orchestration × ack agree with validateChaosCombo and the MODES table', () => {
    for (const [files, shell, orch, ack] of cartesian([FILES, SHELL, BOOL, BOOL])) {
      const d = Core.derive(stateWith({ files, shell, orchUnattended: orch, ack }));
      const f = d.flags;
      const runtime = validateChaosCombo({
        allowShell: f.allowShell,
        acceptEdits: f.acceptEdits,
        dontAsk: f.dontAsk,
        chaosOk: f.chaosOk,
      });
      const chaosError = d.errors.some((e) => /acknowledgement/.test(e));
      assert.equal(chaosError, !runtime.allowed, JSON.stringify({ files, shell, orch, ack }));
      assert.equal(
        d.blocked,
        !runtime.allowed,
        'blocked iff runtime refuses: ' + JSON.stringify({ files, shell, orch, ack }),
      );
      // Matrix verdicts come from the runtime table for the derived mode.
      const expectedMode = f.plan
        ? 'plan'
        : f.acceptEdits && f.dontAsk
          ? 'acceptEditsAndDontAsk'
          : f.dontAsk
            ? 'dontAsk'
            : f.acceptEdits
              ? 'acceptEdits'
              : 'default';
      assert.equal(d.mode, expectedMode);
      for (const row of d.matrix) {
        if (!row.tools.length) assert.equal(row.verdict, 'hidden');
        else {
          const decision = MODES[expectedMode][row.category];
          assert.equal(
            row.verdict,
            decision === 'allow' ? 'runs' : decision === 'plan_only' ? 'proposal' : 'asks',
            row.category,
          );
        }
      }
      if (files === 'look') assert.ok(!d.surface.exposed.includes('edit_file'), 'look only hides writes');
      if (shell === 'off') assert.ok(!d.surface.exposed.includes('bash'));
      else assert.ok(d.surface.exposed.includes('bash'));
    }
  });
});

describe('command-builder v2: generated runner commands parse and satisfy CLI invariants', () => {
  it('authority × groups × worktree × test-watch × network sweep', () => {
    let n = 0;
    for (const [files, shell, agents, worktrees, history, lsp, patch, worktree, testWatch, noNetwork] of cartesian([
      FILES,
      SHELL,
      BOOL,
      BOOL,
      BOOL,
      BOOL,
      BOOL,
      BOOL,
      BOOL,
      BOOL,
    ])) {
      const d = Core.derive(
        stateWith({
          files,
          shell,
          ack: true,
          groups: { agents, worktrees, history, lsp },
          patch,
          worktree,
          testWatch,
          noNetwork,
        }),
      );
      assert.equal(d.blocked, false, d.command + '\n' + d.errors.join('\n'));
      const parsed = parseGenerated(d.command, RUNNER_CLI_OPTIONS);
      assertRunnerInvariants(parsed, d.command, { prompt: 'Sweep prompt.' });
      if (patch && files !== 'look') assert.match(d.command, /--tools '[^']*apply_patch/);
      if (worktree) assert.ok(parsed.values.worktree);
      n++;
    }
    assert.equal(n, 4 * 3 * 2 ** 8);
  });

  it('session, context, model, limits, output, and prompt-tool choices compose into valid commands', () => {
    const sessions = [
      { mode: 'fresh' },
      { mode: 'fresh', id: 'named' },
      { mode: 'continue' },
      { mode: 'resume', id: 'r1', ackRisk: true },
      { mode: 'resume', path: '~/.bridge-runner/sessions/x.state.json' },
      { mode: 'fork', forkFrom: 'parent' },
      { mode: 'fork', forkFrom: 'parent', id: 'child' },
      { mode: 'restart', id: 'again' },
      { mode: 'fresh', id: 'ex', extract: true },
      { mode: 'fresh', persist: false, archive: false },
    ];
    const contexts = [
      { mode: 'minimal' },
      { mode: 'bare', claudeMd: true },
      { mode: 'project', instructionDocs: true, repoContext: true, claudeMd: true, repoMap: true, skills: true },
      {
        mode: 'project',
        instructionDocs: false,
        repoContext: false,
        claudeMd: true,
        memory: true,
        excludeDynamic: true,
      },
    ];
    const models = [
      {},
      { id: 'claude-opus-4-6', effort: 'high', thinking: 'off', temperature: '0.3', maxTokens: 4096 },
      { id: 'claude-opus-5', effort: 'high', thinking: 'off' },
      { custom: 'claude-future-9', effort: 'xhigh', thinking: 'adaptive' },
      { id: 'claude-haiku-4-5', maxTokens: 64000 },
    ];
    const extras = [
      {},
      {
        limits: {
          maxSteps: 3,
          taskScope: true,
          compactEachTurn: true,
          compactAt: '30000',
          maxRunTokens: '400000',
          maxToolCalls: '4',
          wallClockMs: '600000',
          costUsd: '2.5',
          budgetIn: '200000',
          budgetOut: '32000',
          confirmTimeout: '5000',
        },
      },
      {
        output: {
          format: 'stream-json',
          stream: true,
          logLevel: 'quiet',
          traceLevel: 'redacted',
          tracePath: '~/tr.jsonl',
          transcript: '~/t.jsonl',
          humanLog: '~/h.md',
        },
      },
      {
        promptTools: {
          template: 'review',
          args: 'focus=error handling\narea=src runner',
          attachMode: 'include',
          attachPaths: 'README.md\nsrc/server.js',
        },
      },
      {
        promptTools: {
          customTemplate: '.bridge-runner/prompts/mine.md',
          attachMode: 'stdin',
          attachPaths: 'README.md',
        },
        runnerPath: '/tmp/runner',
      },
      {
        system: { appendText: "rule with 'quotes'", appendFile: 'A.md', replaceFile: 'S.md' },
        bridge: { url: 'http://127.0.0.1:11437', token: '$BRIDGE_CALLER_TOKEN' },
        trust: { recordConsent: true, hooks: true },
      },
    ];
    let n = 0;
    for (const files of FILES) {
      for (const session of sessions) {
        for (const context of contexts) {
          for (const model of models) {
            for (const extra of extras) {
              const d = Core.derive(stateWith({ files, session, context, model, ...extra }));
              assert.equal(d.blocked, false, d.command + '\n' + d.errors.join('\n'));
              // Strip the optional cat|(cd …) wrapper the stdin/runnerPath extras add.
              let command = d.command;
              if (command.startsWith('cat '))
                command = command.slice(command.indexOf('| ') + 2).replace(/^\((.*)\)$/s, '$1');
              if (command.startsWith('cd ')) command = command.slice(command.indexOf('&& ') + 3);
              const parsed = parseGenerated(command, RUNNER_CLI_OPTIONS);
              assertRunnerInvariants(parsed, command);
              if (session.mode === 'continue') assert.ok(parsed.values.continue && !parsed.values['session-id']);
              if (session.mode === 'fork') assert.ok(parsed.values['fork-from'] && parsed.values['resume-session']);
              if (session.mode === 'restart') assert.ok(parsed.values['new-session']);
              if (session.extract) assert.ok(parsed.values['session-extract']);
              if (context.mode === 'bare') assert.ok(parsed.values.bare && !parsed.values['include-claude-md']);
              n++;
            }
          }
        }
      }
    }
    assert.equal(n, FILES.length * sessions.length * contexts.length * models.length * extras.length);
  });

  it('blocks exactly the states the CLI would refuse', () => {
    const blocked = [
      { prompt: '' },
      { session: { mode: 'resume' } },
      { session: { mode: 'fork' } },
      { session: { mode: 'fresh', extract: true } },
      { session: { mode: 'fresh', id: 'x', extract: true, persist: false } },
      { promptTools: { template: 'review', args: 'no-equals' } },
      { model: { id: 'claude-haiku-4-5', effort: 'low' } },
      { model: { id: 'claude-opus-4-5', effort: 'max' } },
      { model: { id: 'claude-mythos-preview', effort: 'xhigh' } },
      { model: { id: 'claude-fable-5', thinking: 'off' } },
      { model: { id: 'claude-opus-5', thinking: 'off', effort: 'max' } },
      { model: { id: 'claude-sonnet-4-5', thinking: 'adaptive' } },
      { model: { id: 'claude-sonnet-5', temperature: '0.5' } },
      { model: { id: 'claude-haiku-4-5', maxTokens: 100000 } },
      { shell: 'ask', shellTimeout: 50 },
      { files: 'auto', shell: 'unattended', ack: false },
      {
        engine: 'coordinator',
        coordinator: { phases: { research: false, synthesize: false, execute: false, verify: false } },
      },
      { engine: 'coordinator', coordinator: { phases: { execute: false, verify: true } } },
    ];
    for (const overrides of blocked) {
      const d = Core.derive(stateWith(overrides));
      assert.equal(d.blocked, true, 'should be blocked: ' + JSON.stringify(overrides) + ' → ' + d.command);
    }
  });

  it('model × effort × thinking × temperature acceptance equals resolveModelControls', () => {
    const offered = Core.MODEL_RULES.map((m) => m.id);
    let n = 0;
    for (const model of [...offered, 'claude-future-9']) {
      for (const effort of ['', ...EFFORT_LEVELS]) {
        for (const thinking of THINKING_MODES) {
          for (const temperature of ['', '0.2', '1']) {
            const d = Core.derive(
              stateWith({
                model: offered.includes(model)
                  ? { id: model, effort, thinking, temperature }
                  : { custom: model, effort, thinking, temperature },
              }),
            );
            let rejects = false;
            try {
              resolveModelControls({
                model,
                effort: effort || undefined,
                thinking,
                temperature: temperature ? parseFloat(temperature) : undefined,
              });
            } catch {
              rejects = true;
            }
            assert.equal(
              d.blocked,
              rejects,
              JSON.stringify({ model, effort, thinking, temperature }) + ' ' + d.errors.join(' | '),
            );
            n++;
          }
        }
      }
    }
    assert.equal(n, (offered.length + 1) * 6 * 3 * 3);
  });

  it('response-token ceiling equals deriveContextPolicy', () => {
    for (const rule of Core.MODEL_RULES) {
      for (const maxTokens of [2000, 64000, 64001, 128000, 128001]) {
        const d = Core.derive(stateWith({ model: { id: rule.id, maxTokens } }));
        let rejects = false;
        try {
          deriveContextPolicy({ model: rule.id, maxTokens });
        } catch {
          rejects = true;
        }
        assert.equal(d.blocked, rejects, rule.id + ' ' + maxTokens);
      }
    }
  });

  it('never erases inactive choices: they stay in state and return when their parent is re-enabled', () => {
    let s = stateWith({
      files: 'look',
      groups: { edits: true, agents: true },
      context: { mode: 'minimal', claudeMd: true },
    });
    let d = Core.derive(s);
    assert.doesNotMatch(d.command, /edits|--include-claude-md/);
    assert.equal(d.state.groups.edits, true, 'edits stays checked while look-only hides it');
    assert.equal(d.ui.disabled['groups.edits'], true);
    s = d.state;
    s.files = 'ask';
    s.context.mode = 'project';
    d = Core.derive(s);
    assert.match(d.command, /--capabilities 'edits,recovery,agents'/);
    assert.match(d.command, /--include-repo-context --include-claude-md/);
  });

  it('recipes never touch the folders, bridge, or trust fields, and never leak run-shape flags', () => {
    const base = stateWith({
      cwd: '/work/here',
      runnerPath: '/runner',
      bridge: { url: 'http://x', token: 't' },
      trust: { recordConsent: true },
    });
    let s = base;
    for (const recipe of Core.RECIPES) {
      s = Core.applyRecipe(s, recipe);
      assert.equal(s.cwd, '/work/here', recipe.id + ' changed cwd');
      assert.equal(s.runnerPath, '/runner', recipe.id + ' changed runnerPath');
      assert.equal(s.bridge.url, 'http://x', recipe.id + ' changed bridge url');
      assert.equal(s.trust.recordConsent, true, recipe.id + ' changed trust');
      const d = Core.derive(s);
      if (recipe.id !== 'worktree') assert.doesNotMatch(d.command, /--worktree/, recipe.id + ' leaked --worktree');
      if (recipe.id !== 'verify') assert.doesNotMatch(d.command, /--test-watch/, recipe.id + ' leaked --test-watch');
      if (recipe.id !== 'delegate') assert.doesNotMatch(d.command, /agents/, recipe.id + ' leaked agents');
    }
    // The unattended recipe deliberately leaves the acknowledgement unticked.
    const unattended = Core.derive(
      Core.applyRecipe(
        base,
        Core.RECIPES.find((r) => r.id === 'unattended'),
      ),
    );
    assert.equal(unattended.blocked, true);
    assert.match(unattended.errors.join(' '), /acknowledgement/);
  });

  it('serialize drops the caller token and normalize refuses one from storage', () => {
    const s = stateWith({ bridge: { token: 'literal-secret' } });
    assert.equal(Core.serialize(s).bridge.token, '');
    assert.doesNotMatch(JSON.stringify(Core.serialize(s)), /literal-secret/);
    assert.equal(
      Core.normalize({ bridge: { token: 'injected' }, prompt: 'x', extra: { evil: true } }).bridge.token,
      '',
    );
    assert.equal(Object.prototype.hasOwnProperty.call(Core.normalize({ extra: 1 }), 'extra'), false);
    assert.match(Core.derive(s).command, /--caller-token '?literal-secret'?/, 'the live command still carries it');
  });
});

describe('command-builder v2: coordinator commands', () => {
  it('phase × worker × authority combinations parse with COORDINATOR_CLI_OPTIONS', () => {
    let n = 0;
    for (const [research, synthesize, execute, verify, workers, files, shell, extras] of cartesian([
      BOOL,
      BOOL,
      BOOL,
      BOOL,
      BOOL,
      FILES,
      SHELL,
      BOOL,
    ])) {
      const d = Core.derive(
        stateWith({
          engine: 'coordinator',
          files,
          shell,
          ack: true,
          testWatch: extras,
          noNetwork: extras,
          worktree: extras,
          groups: { agents: extras, worktrees: extras, skills: extras, history: extras, lsp: extras },
          session: { id: extras ? 'coord-1' : '' },
          coordinator: {
            phases: { research, synthesize, execute, verify },
            workers,
            researchPlan: extras ? 'plan.json' : '',
            maxSteps: extras ? 24 : 16,
          },
        }),
      );
      const refuses = (!research && !synthesize && !execute && !verify) || (verify && !execute);
      assert.equal(d.blocked, refuses, d.command + '\n' + d.errors.join('\n'));
      if (refuses) continue;
      const parsed = parseGenerated(d.command, COORDINATOR_CLI_OPTIONS);
      const v = parsed.values;
      assert.deepEqual(parsed.positionals, ['Sweep prompt.']);
      assert.ok(!parsed.args.includes('--worktree'));
      if (v.phases) {
        const list = v.phases.split(',');
        assert.deepEqual(
          list,
          COORDINATOR_PHASES.filter((p) => list.includes(p)),
        );
      }
      if (v['test-watch']) assert.ok(v['allow-shell'] && execute);
      if (v['research-plan']) assert.ok(research && workers);
      if (v.capabilities) normalizeCapabilityList(v.capabilities);
      if (!execute)
        for (const f of ['accept-edits', 'dont-ask', 'allow-shell', 'chaos-ok', 'plan', 'capabilities', 'enable-lsp'])
          assert.ok(!v[f], '--' + f + ' with no execute: ' + d.command);
      assert.ok(
        validateChaosCombo({
          allowShell: !!v['allow-shell'],
          acceptEdits: !!v['accept-edits'],
          dontAsk: !!v['dont-ask'],
          chaosOk: !!v['chaos-ok'],
        }).allowed,
      );
      if (extras) assert.ok(d.omissions.length > 0, 'omissions must be listed when runner-only choices are set');
      n++;
    }
    assert.ok(n > 500);
  });
});

describe('command-builder v2: generated commands survive the real CLI', () => {
  it('every recipe and every authority dial position reaches transport', () => {
    const target = makeTargetRepo();
    const cases = [];
    const base = stateWith({ cwd: target, trust: { recordConsent: true } });
    for (const recipe of Core.RECIPES) {
      const s = Core.applyRecipe(base, recipe);
      s.ack = true;
      cases.push(['recipe ' + recipe.id, Core.derive(s)]);
    }
    for (const files of FILES) {
      for (const shell of SHELL) {
        cases.push([
          'dial ' + files + '/' + shell,
          Core.derive(
            stateWith({
              cwd: target,
              trust: { recordConsent: true },
              files,
              shell,
              ack: true,
              groups: { lsp: true, history: true },
            }),
          ),
        ]);
      }
    }
    for (const [label, d] of cases) {
      assert.equal(d.blocked, false, label + ' is blocked: ' + d.errors.join(' | '));
      assertReachedTransport(runGeneratedRunner(d.command), label, d.command);
    }
  });
});
