'use strict';

/**
 * agent.js — the ACP (Agent Client Protocol) front end for the bridge runner.
 *
 * This module is a pure TRANSLATOR. It owns no model calls, no credentials,
 * no file access, and no permission decisions of its own. Everything it does
 * is convert between two vocabularies:
 *
 *   ACP client (T3 Code)                      bridge runner (run())
 *   ────────────────────                      ─────────────────────
 *   session/new, session/load            →    a session id + checkpoint file
 *   session/prompt                       →    one run() call (resume after turn 1)
 *   session/set_config_option            →    run() options (effort, budget, …)
 *   session/set_model                    →    run()'s model option
 *   session modes (ask / plan / code)    →    default approvals / plan: true /
 *                                             acceptEdits: true
 *   session/cancel (notification)        →    deny pending approvals + report
 *                                             "cancelled" (cooperative abort is
 *                                             Slice D; see notes below)
 *   session/update (we send)             ←    onEvent stream from Slice A
 *   session/request_permission (we send) ←    the injected confirm port
 *
 * Redaction: every event we forward comes from run()'s onEvent subscriber,
 * which already passed the central redaction boundary (P0-11) before we see
 * it. This module deliberately never touches raw model output or raw tool
 * output, so it cannot leak what the boundary scrubbed.
 *
 * One process per session: run() installs global signal handlers and sets
 * process.exitCode, so two concurrent runs in one process are unsafe. T3
 * spawns one agent process per session, and this module additionally rejects
 * a second concurrent prompt rather than multiplexing.
 */

const path = require('path');
const fs = require('fs');

const { createConnection, RpcError, ERROR_CODES } = require('./connection');
const { STOP_REASONS } = require('../kernel/contract');
const { CATEGORIES, OPTIONAL_CAPABILITIES } = require('../tool-catalog');
const { DEFAULT_MODEL, EFFORT_LEVELS, EFFORT_AUTO, catalogEntryForModel } = require('../model-catalog');
const { makeSessionId, sessionPathFor } = require('../session-store');

const PROTOCOL_VERSION = 1;

// ── Config options ──────────────────────────────────────────────────────────
// ACP composer controls are select-or-boolean only (no numeric input exists in
// the protocol or in T3's composer), so the token budget is a preset list.

const MODEL_CHOICES = Object.freeze(['claude-sonnet-5', 'claude-fable-5', 'claude-opus-5', 'claude-haiku-4-5']);

const MAX_TOKENS_PRESETS = Object.freeze([2000, 4096, 8192, 16384, 32768]);

// Capability groups a client may toggle per session. `core` is always on and
// `shell` is deliberately absent: the repo invariant is that shell access is
// granted only by the singular --allow-shell flag on the agent's own command
// line (a per-instance decision in T3's settings), never by a composer toggle.
const CAPABILITY_TOGGLES = OPTIONAL_CAPABILITIES;

// Session modes map onto T3's native Chat/Plan toggle and access levels, and
// each one is backed by a REAL runner behavior, not protocol theatre:
//   ask  → the default flow: every write asks for approval
//   plan → run() plan mode: effects are recorded as proposals, never executed
//   code → run() acceptEdits: write tools run without a per-write card
// (T3 matches these ids by alias: ask → approval required, plan → plan mode,
// code → implement.)
const SESSION_MODES = Object.freeze([
  Object.freeze({ id: 'ask', name: 'Ask', description: 'Ask before any file edit' }),
  Object.freeze({ id: 'plan', name: 'Plan', description: 'Propose changes only; never touch the workspace' }),
  Object.freeze({ id: 'code', name: 'Code', description: 'Run enabled tools without asking each time' }),
]);
const SESSION_MODE_IDS = Object.freeze(SESSION_MODES.map((mode) => mode.id));

function modelLabel(modelId) {
  const entry = catalogEntryForModel(modelId);
  return (entry && entry.label) || modelId;
}

/**
 * The per-model knobs. The ids ("effort", "context") deliberately mirror the
 * ones the working mock agent used, because T3's Cursor host maps only a few
 * composer slots and silently discards descriptors it does not recognize —
 * these exact names are field-verified to survive that mapping.
 */
function describeModelKnobs(config) {
  const tokenValues = MAX_TOKENS_PRESETS.includes(config.maxTokens)
    ? MAX_TOKENS_PRESETS
    : // A non-preset default from the command line must still render as the
      // current selection, so it joins the list instead of being lied about.
      [config.maxTokens, ...MAX_TOKENS_PRESETS].sort((a, b) => a - b);

  return [
    {
      id: 'effort',
      name: 'Effort',
      category: 'thought_level',
      type: 'select',
      currentValue: config.effort,
      options: [
        { value: EFFORT_AUTO, name: 'Auto' },
        ...EFFORT_LEVELS.map((level) => ({ value: level, name: level.charAt(0).toUpperCase() + level.slice(1) })),
      ],
    },
    {
      id: 'context',
      name: 'Token Budget',
      category: 'model_config',
      type: 'select',
      currentValue: String(config.maxTokens),
      options: tokenValues.map((n) => ({ value: String(n), name: n.toLocaleString('en-US') + ' tokens' })),
    },
  ];
}

/** Build the ACP SessionConfigOption descriptors for one session's state. */
function describeConfigOptions(config) {
  return [
    {
      id: 'mode',
      name: 'Mode',
      category: 'mode',
      type: 'select',
      currentValue: config.mode,
      options: SESSION_MODES.map((mode) => ({ value: mode.id, name: mode.name, description: mode.description })),
    },
    {
      id: 'model',
      name: 'Bridge model',
      category: 'model',
      type: 'select',
      currentValue: config.model,
      options: MODEL_CHOICES.map((id) => ({ value: id, name: modelLabel(id) })),
    },
    ...describeModelKnobs(config),
    // Capability toggles ride along for generic ACP hosts; T3's Cursor host
    // drops them from the composer, so under T3 they are set per instance via
    // the agent command line (--capabilities) instead.
    ...CAPABILITY_TOGGLES.map((group) => ({
      id: 'capability_' + group,
      name: 'Enable ' + group,
      type: 'boolean',
      currentValue: !!config.capabilities[group],
    })),
  ];
}

/** ACP SessionModeState for T3's mode toggle. */
function describeModeState(config) {
  return { currentModeId: config.mode, availableModes: SESSION_MODES.map((mode) => ({ ...mode })) };
}

/** ACP SessionModelState for hosts that read models from the session. */
function describeModelState(config) {
  return {
    currentModelId: config.model,
    availableModels: MODEL_CHOICES.map((id) => ({ modelId: id, name: modelLabel(id) })),
  };
}

// ── Event translation ───────────────────────────────────────────────────────

/**
 * Map a runner tool name to an ACP ToolKind so T3 renders the right icon.
 * The runner's own categories (tool-catalog.js) do most of the work.
 */
function toolKindFor(toolName) {
  if (toolName === 'search_text' || toolName === 'glob') return 'search';
  if (toolName === 'ask_user_question') return 'other';
  const category = CATEGORIES[toolName];
  if (category === 'read-only') return 'read';
  if (category === 'write' || category === 'recovery') return 'edit';
  if (category === 'shell') return 'execute';
  return 'other';
}

/** A short human title for a tool call card, e.g. "read_file: src/run.js". */
function toolTitleFor(toolName, input) {
  const target =
    input && typeof input === 'object'
      ? input.path || input.file_path || input.filepath || input.target_path || input.command || input.pattern
      : null;
  return typeof target === 'string' && target ? toolName + ': ' + target : toolName;
}

/** Map the runner's terminal stop reason onto ACP's five prompt stop reasons. */
function acpStopReasonFor(stopReason, cancelRequested) {
  if (cancelRequested || stopReason === STOP_REASONS.CANCELLED) return 'cancelled';
  if (stopReason === STOP_REASONS.MODEL_REFUSAL) return 'refusal';
  if (stopReason === STOP_REASONS.MAX_STEPS || stopReason === STOP_REASONS.MAX_TOOL_CALLS_PER_TURN) {
    return 'max_turn_requests';
  }
  const tokenBudgetReasons = new Set([
    STOP_REASONS.MODEL_MAX_TOKENS,
    STOP_REASONS.CONTEXT_BUDGET_EXCEEDED,
    STOP_REASONS.INPUT_TOKEN_BUDGET_EXCEEDED,
    STOP_REASONS.OUTPUT_TOKEN_BUDGET_EXCEEDED,
    STOP_REASONS.PREDICTIVE_CONTEXT_BUDGET_EXCEEDED,
    STOP_REASONS.PREDICTIVE_INPUT_TOKEN_BUDGET_EXCEEDED,
    STOP_REASONS.PREDICTIVE_OUTPUT_TOKEN_BUDGET_EXCEEDED,
    STOP_REASONS.INITIAL_PROMPT_TOO_LARGE,
    STOP_REASONS.CONTEXT_CEILING_UNRECOVERABLE,
  ]);
  if (tokenBudgetReasons.has(stopReason)) return 'max_tokens';
  // Everything else that reaches here ended the turn in a reportable way
  // (success, a user denial, a wall-clock/cost guardrail with its explanation
  // already streamed as text). Hard errors never reach this function — they
  // become JSON-RPC errors in the prompt handler instead.
  return 'end_turn';
}

// Runner stop reasons that mean "the turn failed", which ACP models as a
// JSON-RPC error response to session/prompt rather than a stop reason.
const ERROR_STOP_REASONS = new Set([
  STOP_REASONS.BRIDGE_ERROR,
  STOP_REASONS.MESSAGE_CONTRACT_ERROR,
  STOP_REASONS.CWD_INVALID,
  STOP_REASONS.RESUME_FAILED,
  STOP_REASONS.WORKSPACE_NOT_TRUSTED,
]);

/** Extract the plain text of an ACP prompt (ContentBlock[]) for run(). */
function promptTextFrom(blocks) {
  if (!Array.isArray(blocks)) return '';
  const parts = [];
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
    // Baseline ACP also requires resource_link support: we cannot fetch the
    // resource, but we can hand its address to the model as context.
    else if (block.type === 'resource_link' && typeof block.uri === 'string') parts.push('[resource] ' + block.uri);
  }
  return parts.join('\n\n').trim();
}

/**
 * Interpret a cursor/ask_question response. `answers` is a loosely-typed
 * record keyed by question id; hosts have answered with option ids, option
 * labels, single strings, or arrays. Normalize everything to the label list
 * the model can read back. An empty `selected` means dismissed/unanswered;
 * `invalid` means the host's answer could not honestly be reported (more
 * picks than the question allowed), which must not pass as a selection.
 */
function parseAskQuestionAnswer(response, questionId, wireOptions, allowMultiple) {
  const answers = response && typeof response === 'object' ? response.answers : null;
  if (!answers || typeof answers !== 'object') return { selected: [], invalid: false };
  let raw = answers[questionId];
  if (raw === undefined) {
    // Some hosts key by prompt text instead of id; with a single question the
    // sole value is unambiguous either way.
    const values = Object.values(answers);
    if (values.length === 1) raw = values[0];
  }
  if (raw === undefined || raw === null || raw === '') return { selected: [], invalid: false };
  const list = Array.isArray(raw) ? raw : [raw];
  const labelById = new Map(wireOptions.map((opt) => [opt.id, opt.label]));
  const knownLabels = new Set(wireOptions.map((opt) => opt.label));
  const selected = [];
  for (const entry of list) {
    let text;
    if (typeof entry === 'string') text = entry;
    else if (entry && typeof entry === 'object' && typeof entry.label === 'string') text = entry.label;
    else if (entry && typeof entry === 'object' && typeof entry.id === 'string') text = entry.id;
    else continue;
    // Labels win over ids: our ids are synthetic ('opt-N'), so a user-authored
    // option label spelled 'opt-1' must resolve to the option carrying that
    // label, never to option 1. Strings matching neither are not selections —
    // reporting them as 'User selected:' would put words in the user's mouth.
    let label;
    if (knownLabels.has(text)) label = text;
    else if (labelById.has(text)) label = labelById.get(text);
    else continue;
    if (!selected.includes(label)) selected.push(label);
  }
  // More picks than the question allows is an invalid answer, not a choice
  // (the TTY parser rejects extra picks the same way).
  if (!allowMultiple && selected.length > 1) return { selected: [], invalid: true };
  return { selected, invalid: false };
}

// ── The agent ───────────────────────────────────────────────────────────────

/**
 * @param {object} deps
 * @param {import('stream').Readable} deps.input — protocol frames in (stdin)
 * @param {(line: string) => void} deps.write — protocol frames out (the REAL stdout)
 * @param {Function} deps.runFn — the runner entry point (src/runner/run.js run);
 *   injectable so tests can also observe or stub it
 * @param {string} [deps.sessionDir] — where session checkpoints live
 *   (default ~/.bridge-runner/sessions, same as the terminal runner)
 * @param {object} [deps.runDefaults] — options merged under every run() call;
 *   the entry point uses this for per-instance flags (--bridge-url,
 *   --allow-shell, --trust-workspace), tests for skipTrustGate/noArchive
 * @param {object} [deps.configDefaults] — initial per-session config
 *   ({ model, effort, maxTokens, capabilities })
 * @param {string} [deps.version] — reported in initialize's agentInfo
 */
function createAcpAgent(deps) {
  const { input, write, runFn, sessionDir, runDefaults = {}, configDefaults = {}, version = '0.0.0' } = deps;
  if (typeof runFn !== 'function') throw new Error('createAcpAgent: runFn is required');
  if (!input || typeof write !== 'function') throw new Error('createAcpAgent: input stream and write are required');

  const home = process.env.HOME || process.env.USERPROFILE || process.cwd();
  const resolvedSessionDir = sessionDir || path.join(home, '.bridge-runner', 'sessions');

  const sessions = new Map(); // sessionId → { cwd, config, turnCount, cancelRequested }
  let initialized = false;
  let activeTurn = false; // one run() at a time — see the module header

  const connection = createConnection({ input, write });

  function defaultConfig() {
    const capabilities = {};
    for (const group of CAPABILITY_TOGGLES) {
      capabilities[group] = !!(configDefaults.capabilities && configDefaults.capabilities[group]);
    }
    return {
      model: configDefaults.model || DEFAULT_MODEL,
      effort: configDefaults.effort || EFFORT_AUTO,
      maxTokens: configDefaults.maxTokens || 2000,
      mode: configDefaults.mode || 'ask',
      capabilities,
    };
  }

  function requireSession(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) throw new RpcError(ERROR_CODES.INVALID_PARAMS, 'Unknown sessionId: ' + String(sessionId));
    return session;
  }

  function requireInitialized() {
    if (!initialized) throw new RpcError(ERROR_CODES.INVALID_REQUEST, 'initialize must be called first');
  }

  // ── Handshake ─────────────────────────────────────────────────────────────

  connection.onMethod('initialize', () => {
    initialized = true;
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentInfo: { name: 'bridge-runner-acp', version },
      // The bridge (VS Code extension) owns credentials; the agent needs no
      // client-mediated auth, so no auth methods are advertised.
      authMethods: [],
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: false, audio: false, embeddedContext: false },
      },
    };
  });

  // Accept-and-move-on: there is nothing to authenticate against.
  connection.onMethod('authenticate', () => ({}));

  // ── Session lifecycle ─────────────────────────────────────────────────────

  connection.onMethod('session/new', (params) => {
    requireInitialized();
    const cwd = params && params.cwd;
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) {
      throw new RpcError(ERROR_CODES.INVALID_PARAMS, 'session/new requires an absolute cwd');
    }
    const sessionId = makeSessionId();
    const session = { cwd, config: defaultConfig(), turnCount: 0, cancelRequested: false, alwaysAllow: false };
    sessions.set(sessionId, session);
    return {
      sessionId,
      modes: describeModeState(session.config),
      models: describeModelState(session.config),
      configOptions: describeConfigOptions(session.config),
    };
  });

  connection.onMethod('session/load', (params) => {
    requireInitialized();
    const sessionId = params && params.sessionId;
    const cwd = params && params.cwd;
    if (typeof sessionId !== 'string' || !sessionId) {
      throw new RpcError(ERROR_CODES.INVALID_PARAMS, 'session/load requires a sessionId');
    }
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) {
      throw new RpcError(ERROR_CODES.INVALID_PARAMS, 'session/load requires an absolute cwd');
    }
    const checkpoint = sessionPathFor(resolvedSessionDir, sessionId);
    if (!fs.existsSync(checkpoint)) {
      throw new RpcError(ERROR_CODES.INVALID_PARAMS, 'No session checkpoint found for ' + sessionId);
    }
    // turnCount 1 makes the next prompt resume the checkpoint instead of
    // starting fresh. Replaying past conversation as session/update messages
    // is not implemented in this slice; the history lives in the checkpoint
    // and the model sees it — only the client-side scrollback starts empty.
    sessions.set(sessionId, { cwd, config: defaultConfig(), turnCount: 1, cancelRequested: false, alwaysAllow: false });
    const session = sessions.get(sessionId);
    return {
      modes: describeModeState(session.config),
      models: describeModelState(session.config),
      configOptions: describeConfigOptions(session.config),
    };
  });

  // Model selection has its own dedicated ACP method (T3 sends this one, not a
  // config option, when the composer's model dropdown changes).
  connection.onMethod('session/set_model', (params) => {
    requireInitialized();
    const session = requireSession(params && params.sessionId);
    const modelId = params && params.modelId;
    if (!MODEL_CHOICES.includes(modelId)) {
      throw new RpcError(ERROR_CODES.INVALID_PARAMS, 'Unknown model: ' + String(modelId));
    }
    session.config.model = modelId;
    return {};
  });

  // Cursor-host extension: T3's Cursor driver probes the agent for its model
  // catalogue with this method and builds the composer dropdowns from the
  // configOptions attached to each model. Harmless for other ACP hosts — they
  // simply never call it. Values are the instance defaults; live values flow
  // through session/set_config_option afterwards.
  connection.onMethod('cursor/list_available_models', () => {
    const config = defaultConfig();
    return {
      models: MODEL_CHOICES.map((id) => ({
        value: id,
        name: modelLabel(id),
        configOptions: describeModelKnobs(config),
      })),
    };
  });

  // Cursor-host extension: the mode toggle change arrives here.
  connection.onMethod('session/mode/set', (params) => {
    requireInitialized();
    const session = requireSession(params && params.sessionId);
    const modeId = typeof (params && params.modeId) === 'string' ? params.modeId.trim() : '';
    if (!SESSION_MODE_IDS.includes(modeId)) {
      throw new RpcError(ERROR_CODES.INVALID_PARAMS, 'Unknown mode: ' + String(params && params.modeId));
    }
    session.config.mode = modeId;
    connection.notify('session/update', {
      sessionId: params.sessionId,
      update: { sessionUpdate: 'current_mode_update', currentModeId: modeId },
    });
    return {};
  });

  connection.onMethod('session/set_config_option', (params) => {
    requireInitialized();
    const session = requireSession(params && params.sessionId);
    const configId = params && params.configId;
    const value = params && params.value;

    if (configId === 'model') {
      if (!MODEL_CHOICES.includes(value)) {
        throw new RpcError(ERROR_CODES.INVALID_PARAMS, 'Unknown model: ' + String(value));
      }
      session.config.model = value;
    } else if (configId === 'effort') {
      if (value !== EFFORT_AUTO && !EFFORT_LEVELS.includes(value)) {
        throw new RpcError(ERROR_CODES.INVALID_PARAMS, 'Unknown effort level: ' + String(value));
      }
      session.config.effort = value;
    } else if (configId === 'context') {
      const parsed = parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new RpcError(ERROR_CODES.INVALID_PARAMS, 'Invalid token budget: ' + String(value));
      }
      session.config.maxTokens = parsed;
    } else if (configId === 'mode') {
      if (!SESSION_MODE_IDS.includes(value)) {
        throw new RpcError(ERROR_CODES.INVALID_PARAMS, 'Unknown mode: ' + String(value));
      }
      session.config.mode = value;
    } else if (typeof configId === 'string' && configId.startsWith('capability_')) {
      const group = configId.slice('capability_'.length);
      if (!CAPABILITY_TOGGLES.includes(group) || typeof value !== 'boolean') {
        throw new RpcError(ERROR_CODES.INVALID_PARAMS, 'Unknown capability toggle: ' + String(configId));
      }
      session.config.capabilities[group] = value;
    } else {
      throw new RpcError(ERROR_CODES.INVALID_PARAMS, 'Unknown configId: ' + String(configId));
    }

    return { configOptions: describeConfigOptions(session.config) };
  });

  // Cancellation is a notification (no response expected). True cooperative
  // abort inside run() is Slice D work; until then this marks the session so
  // (a) any pending or future approval this turn is denied, stopping further
  // side effects, and (b) the prompt response reports "cancelled".
  connection.onMethod('session/cancel', (params) => {
    const session = sessions.get(params && params.sessionId);
    if (session) session.cancelRequested = true;
  });

  // ── The prompt turn ───────────────────────────────────────────────────────

  connection.onMethod('session/prompt', async (params) => {
    requireInitialized();
    const sessionId = params && params.sessionId;
    const session = requireSession(sessionId);
    if (activeTurn) {
      throw new RpcError(ERROR_CODES.INVALID_REQUEST, 'A turn is already running in this agent process');
    }
    const promptText = promptTextFrom(params && params.prompt);
    if (!promptText) {
      throw new RpcError(ERROR_CODES.INVALID_PARAMS, 'session/prompt contained no text');
    }

    session.cancelRequested = false;

    function sendUpdate(update) {
      connection.notify('session/update', { sessionId, update });
    }

    // The write loop in the tool pipeline is serial and emits approval_required
    // synchronously right before it awaits confirm.ask, so remembering the most
    // recent one is a sound way to recover the tool identity that ask()'s
    // plain-string signature does not carry.
    let lastApproval = null;

    // Slice D: when the runner streams text deltas to us live, the same text
    // arrives AGAIN inside the buffered `assistant` event at end of step. The
    // flag suppresses the buffered copy so the client never sees it twice —
    // and if the bridge did not stream (no deltas came), the buffered copy is
    // the fallback display path, so nothing is lost either way.
    let streamedThisTurn = false;

    function onStreamText(text) {
      streamedThisTurn = true;
      sendUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });
    }

    function onEvent(event) {
      // Every event here is already scrubbed by the redaction boundary.
      switch (event.type) {
        case 'assistant': {
          if (streamedThisTurn) break; // live deltas already delivered this text
          const content = (event.message && event.message.content) || [];
          for (const block of Array.isArray(content) ? content : []) {
            if (block && block.type === 'text' && block.text) {
              sendUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: block.text } });
            }
          }
          break;
        }
        case 'tool_use':
          sendUpdate({
            sessionUpdate: 'tool_call',
            toolCallId: event.tool_use_id,
            title: toolTitleFor(event.name, event.input),
            kind: toolKindFor(event.name),
            status: 'pending',
            rawInput: event.input,
          });
          break;
        case 'tool_result':
          sendUpdate({
            sessionUpdate: 'tool_call_update',
            toolCallId: event.tool_use_id,
            status: event.is_error ? 'failed' : 'completed',
            rawOutput: { text: event.content || '' },
          });
          break;
        case 'approval_required':
          lastApproval = event;
          break;
        default:
          // budget / compaction / system events have no ACP counterpart yet.
          break;
      }
    }

    const confirm = {
      // Slice A's injected approval port, bridged to an ACP permission card.
      ask: async (proposedAction) => {
        if (session.cancelRequested) return 'deny';
        // An earlier "always allow this session" answer stands for the rest of
        // this ACP session. The runner's hard denies (deny matrix, path
        // confinement) are enforced deeper and survive this — an ACP allow can
        // only ever collapse an *ask*.
        if (session.alwaysAllow) return 'allow';
        const approval = lastApproval || {};
        let response;
        try {
          response = await connection.request('session/request_permission', {
            sessionId,
            toolCall: {
              toolCallId: approval.tool_use_id || 'unknown-tool-call',
              title: proposedAction,
              kind: toolKindFor(approval.name),
              status: 'pending',
            },
            // T3's reply hard-codes these exact optionIds (it does not echo
            // ours back), so they must be spelled precisely like this. Its
            // full-access mode also auto-picks allow_always client-side.
            options: [
              { optionId: 'allow-once', name: 'Allow', kind: 'allow_once' },
              { optionId: 'allow-always', name: 'Allow for this session', kind: 'allow_always' },
              { optionId: 'reject-once', name: 'Deny', kind: 'reject_once' },
            ],
          });
        } catch {
          // If the client vanished mid-question, the only safe answer is no.
          return 'deny';
        }
        const outcome = response && response.outcome;
        if (outcome && outcome.outcome === 'cancelled') {
          session.cancelRequested = true;
          return 'deny';
        }
        if (outcome && outcome.outcome === 'selected') {
          if (outcome.optionId === 'allow-once') return 'allow';
          if (outcome.optionId === 'allow-always') {
            session.alwaysAllow = true;
            return 'allow';
          }
        }
        return 'deny';
      },
      // The failure-recovery prompt (stop / retry / guide) has no ACP surface
      // yet, so answer deterministically instead of falling back to the
      // terminal implementation, which would fail closed with a confusing
      // timeout under a hosted process.
      askToolFailureRecovery: async () => ({ action: 'stop', reason: 'acp_no_recovery_ui' }),
    };

    // R4 (2026-08-31): ask_user_question rides T3's native question card.
    // T3's Cursor host implements the Cursor CLI extension request
    // cursor/ask_question (agent → client):
    //   { toolCallId, title?, questions: [{ id, prompt,
    //     options: [{ id, label }], allowMultiple? }] }
    //   → { answers: { [questionId]: <selection> } }
    // A dismissed/cancelled card settles with empty answers.

    // (Thermo-nuclear 08-31, Medium #1) Failure branching: only -32601
    // ("no such method") means the client cannot show a question card — that
    // is the ONE failure where guess-and-continue is the right instruction to
    // send back. Everything else fails closed: a cancelled turn reports the
    // cancel, a dead connection ends the turn (nobody is reading updates and
    // nobody can approve writes, so the run must not keep going against the
    // bridge alone), and any other client error leaves the question
    // explicitly unanswered with no invitation to guess.
    const askQuestionFailure = (err) => {
      if (session.cancelRequested) {
        return { ok: false, text: 'Turn was cancelled before the question could be asked.' };
      }
      if (err && err.code === ERROR_CODES.METHOD_NOT_FOUND) {
        return {
          ok: false,
          text: 'ask_user_question is not supported by this ACP client; continue with your best safe assumption.',
        };
      }
      if (connection.closed || (err && err.message === 'Connection closed')) {
        session.cancelRequested = true;
        return {
          ok: false,
          text: 'The ACP client disconnected before the question could be answered; stopping this turn.',
        };
      }
      return {
        ok: false,
        text: 'The question could not be asked (client error); it remains unanswered.',
      };
    };

    const askUserQuestion = async (args, toolCtx) => {
      const payload = args || {};
      const question = String(payload.question || '').trim();
      const options = Array.isArray(payload.options)
        ? payload.options.filter((opt) => opt && (opt.label || opt.value))
        : [];
      if (!question || options.length < 2) {
        return { ok: false, text: 'ask_user_question needs a question and at least two options.' };
      }
      if (session.cancelRequested) {
        return { ok: false, text: 'Turn was cancelled before the question could be asked.' };
      }
      // T3's card renders option labels only (descriptions are dropped by its
      // extractor), so fold the description into the label the user sees.
      const wireOptions = options.map((opt, i) => ({
        id: 'opt-' + (i + 1),
        label:
          String(opt.label || opt.value || '').trim() + (opt.description ? ' — ' + String(opt.description).trim() : ''),
      }));
      const toolCallId = (toolCtx && toolCtx.toolUseId) || 'ask-user-question';
      const questionId = 'q-' + toolCallId;
      // (Thermo-nuclear 08-31, Medium #2) The card can sit unanswered for as
      // long as the user stares at it, so this await must stay cooperative
      // with session/cancel: race the JSON-RPC request against a cancel
      // poller instead of letting the pending request become the only way the
      // turn can finish.
      const requestPromise = connection.request('cursor/ask_question', {
        toolCallId,
        ...(payload.header ? { title: String(payload.header) } : {}),
        questions: [
          {
            id: questionId,
            prompt: question,
            options: wireOptions,
            ...(payload.allow_multiple ? { allowMultiple: true } : {}),
          },
        ],
      });
      // If cancel wins the race, the request may still settle or reject later
      // with no listener; swallow that late outcome so it cannot surface as an
      // unhandled rejection.
      requestPromise.catch(() => {});
      const ASK_CANCELLED = Symbol('ask-cancelled');
      let cancelPoll;
      const cancelWaiter = new Promise((resolve) => {
        // The poller intentionally holds the event loop open: while a card is
        // pending the turn is genuinely in progress. It is cleared in finally.
        cancelPoll = setInterval(() => {
          if (session.cancelRequested) resolve(ASK_CANCELLED);
        }, 100);
      });
      let response;
      try {
        response = await Promise.race([requestPromise, cancelWaiter]);
      } catch (err) {
        return askQuestionFailure(err);
      } finally {
        clearInterval(cancelPoll);
      }
      if (response === ASK_CANCELLED || session.cancelRequested) {
        // A real tool_result is still recorded for this ask (so a resumed
        // checkpoint sees a settled call); run() then finalizes the turn as
        // cancelled at its next safe boundary.
        return { ok: false, text: 'Turn was cancelled before the question could be asked.' };
      }
      const { selected, invalid } = parseAskQuestionAnswer(
        response,
        questionId,
        wireOptions,
        Boolean(payload.allow_multiple),
      );
      if (invalid) {
        return {
          ok: false,
          text: 'The client returned multiple selections to a single-choice question; the answer was discarded as invalid.',
        };
      }
      if (selected.length === 0) {
        return { ok: false, text: 'The user dismissed the question without answering.' };
      }
      return { ok: true, text: 'User selected: ' + selected.join(', '), selected };
    };

    const capabilities = CAPABILITY_TOGGLES.filter((group) => session.config.capabilities[group]);

    activeTurn = true;
    let result;
    try {
      result = await runFn({
        ...runDefaults,
        prompt: promptText,
        cwd: session.cwd,
        model: session.config.model,
        maxTokens: session.config.maxTokens,
        ...(session.config.effort !== EFFORT_AUTO ? { effort: session.config.effort } : {}),
        ...(capabilities.length > 0 ? { capabilities } : {}),
        sessionPath: sessionPathFor(resolvedSessionDir, sessionId),
        resume: session.turnCount > 0,
        quiet: true,
        // Slice D: live streaming + cooperative cancel. session/cancel flips
        // cancelRequested; the runner polls it at its safe boundaries and
        // finalizes with "cancelled" while the session (and this process)
        // stay alive for the next prompt.
        stream: true,
        onStreamText,
        shouldCancel: () => session.cancelRequested,
        // This process serves many turns; one cancelled/failed turn must not
        // leave process.exitCode=1 stuck on the whole agent (M3, 2026-08-25).
        setProcessExitCode: false,
        // Mode semantics — each is the runner's real flag, not an imitation:
        // plan records proposals instead of executing; code (acceptEdits)
        // skips the per-write approval card the user opted out of.
        ...(session.config.mode === 'plan' ? { plan: true } : {}),
        ...(session.config.mode === 'code' ? { acceptEdits: true } : {}),
        onEvent,
        confirm,
        askUserQuestion,
      });
    } finally {
      activeTurn = false;
    }

    if (!result || ERROR_STOP_REASONS.has(result.stopReason)) {
      throw new RpcError(
        ERROR_CODES.INTERNAL_ERROR,
        (result && result.finalText) || 'The runner failed without a reportable result',
        { stopReason: (result && result.stopReason) || 'unknown' },
      );
    }

    session.turnCount += 1;

    // Guardrail endings (max steps, budgets, denials) produce a runner-written
    // explanation that never appears in an assistant event — surface it so the
    // turn does not end silently in the client.
    if (result.stopReason !== STOP_REASONS.SUCCESS && result.finalText) {
      sendUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: result.finalText } });
    }

    return { stopReason: acpStopReasonFor(result.stopReason, session.cancelRequested) };
  });

  return {
    connection,
    // Exposed for tests and future slices; not part of the wire protocol.
    _sessions: sessions,
  };
}

module.exports = {
  createAcpAgent,
  describeConfigOptions,
  describeModelKnobs,
  toolKindFor,
  toolTitleFor,
  acpStopReasonFor,
  promptTextFrom,
  parseAskQuestionAnswer,
  PROTOCOL_VERSION,
  MODEL_CHOICES,
  MAX_TOKENS_PRESETS,
  SESSION_MODES,
};
