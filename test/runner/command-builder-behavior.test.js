'use strict';

/**
 * Behavioral regression tests for docs/command-builder.html.
 *
 * The builder is a self-contained local HTML page, so its JavaScript normally
 * runs only in a browser. Pulling a full browser framework into this small
 * project would be heavy. This tiny fake DOM supplies only the browser pieces
 * the builder actually uses, then executes the real inline script unchanged.
 *
 * That distinction matters: these tests do not copy the command-building
 * rules into a second implementation. They click/change the same controls and
 * call the same functions that Alan's browser runs.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const { TOOLS } = require('../../src/runner/tool-catalog');

const BUILDER_PATH = path.join(__dirname, '..', '..', 'docs', 'command-builder.html');
const BUILDER_HTML = fs.readFileSync(BUILDER_PATH, 'utf8');

class FakeClassList {
  constructor(initial = '') {
    this.names = new Set(String(initial).split(/\s+/).filter(Boolean));
  }

  add(name) {
    this.names.add(name);
  }

  remove(name) {
    this.names.delete(name);
  }

  toggle(name, force) {
    const shouldAdd = force === undefined ? !this.names.has(name) : !!force;
    if (shouldAdd) this.names.add(name);
    else this.names.delete(name);
    return shouldAdd;
  }

  contains(name) {
    return this.names.has(name);
  }
}

class FakeElement {
  constructor({ id = '', type = '', value = '', checked = false, disabled = false, className = '' } = {}) {
    this.id = id;
    this.type = type;
    this.value = value;
    this.checked = checked;
    this.disabled = disabled;
    this.textContent = '';
    this.innerHTML = '';
    this.title = '';
    this.dataset = {};
    this.style = {};
    this.classList = new FakeClassList(className);
    this.listeners = new Map();
    this.options = new Map();

    // Checkbox inputs live inside a label in the real document. The builder
    // asks for that label to grey out inactive choices, so give each fake input
    // a small parent element that can hold the CSS class.
    this.parentChoice = new FakeElementParent();
  }

  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(callback);
  }

  dispatch(type) {
    for (const callback of this.listeners.get(type) || []) {
      callback({ target: this });
    }
  }

  closest(selector) {
    if (selector === '.tool-choice' || selector === '.check-label') return this.parentChoice;
    if (selector === '.preset-btn' && this.classList.contains('preset-btn')) return this;
    return null;
  }

  querySelector(selector) {
    const match = selector.match(/^option\[value="([^"]+)"\]$/);
    return match ? this.options.get(match[1]) || null : null;
  }
}

class FakeElementParent {
  constructor() {
    this.classList = new FakeClassList();
  }
}

function attributes(source) {
  const result = {};
  for (const match of source.matchAll(/([:\w-]+)(?:="([^"]*)")?/g)) {
    result[match[1]] = match[2] === undefined ? true : match[2];
  }
  return result;
}

function createHarness() {
  const elements = new Map();

  // Inputs and buttons carry most defaults directly in their opening tag.
  for (const match of BUILDER_HTML.matchAll(/<(input|button)([^>]*)>/g)) {
    const attrs = attributes(match[2]);
    if (!attrs.id) continue;
    elements.set(
      attrs.id,
      new FakeElement({
        id: attrs.id,
        type: attrs.type || match[1],
        value: attrs.value || '',
        checked: !!attrs.checked,
        disabled: !!attrs.disabled,
        className: attrs.class || '',
      }),
    );
  }

  // A select's initial value comes from its selected option (or its first
  // option). Store option objects too because model compatibility logic greys
  // out individual choices such as xhigh effort.
  for (const match of BUILDER_HTML.matchAll(/<select([^>]*)>([\s\S]*?)<\/select>/g)) {
    const attrs = attributes(match[1]);
    if (!attrs.id) continue;
    const select = new FakeElement({ id: attrs.id, type: 'select-one', className: attrs.class || '' });
    let firstValue = '';
    let selectedValue = '';
    for (const optionMatch of match[2].matchAll(/<option([^>]*)>/g)) {
      const optionAttrs = attributes(optionMatch[1]);
      const optionValue = optionAttrs.value || '';
      if (select.options.size === 0) firstValue = optionValue;
      if (optionAttrs.selected) selectedValue = optionValue;
      select.options.set(optionValue, new FakeElement({ value: optionValue, disabled: !!optionAttrs.disabled }));
    }
    select.value = selectedValue || firstValue;
    elements.set(attrs.id, select);
  }

  for (const match of BUILDER_HTML.matchAll(/<textarea([^>]*)>([\s\S]*?)<\/textarea>/g)) {
    const attrs = attributes(match[1]);
    if (!attrs.id) continue;
    elements.set(
      attrs.id,
      new FakeElement({ id: attrs.id, type: 'textarea', value: match[2].trim(), className: attrs.class || '' }),
    );
  }

  // Add non-form elements such as warning panels and the generated command.
  for (const match of BUILDER_HTML.matchAll(/<([a-z][\w-]*)([^>]*)>/gi)) {
    const attrs = attributes(match[2]);
    if (attrs.id && !elements.has(attrs.id)) {
      elements.set(attrs.id, new FakeElement({ id: attrs.id, type: match[1], className: attrs.class || '' }));
    }
  }

  // Tool checkboxes deliberately have no ids. Their values are the runtime
  // tool names, which lets this harness select exactly the same catalog.
  const toolChoices = Object.keys(TOOLS).map((name) => {
    const tag = BUILDER_HTML.match(new RegExp('<input[^>]*value="' + name + '"[^>]*>'))?.[0] || '';
    assert.ok(tag, 'Builder is missing tool checkbox: ' + name);
    const attrs = attributes(tag);
    return new FakeElement({ type: 'checkbox', value: name, checked: !!attrs.checked });
  });

  const presetButtons = [];
  for (const match of BUILDER_HTML.matchAll(/<button([^>]*class="[^"]*preset-btn[^"]*"[^>]*)>/g)) {
    const attrs = attributes(match[1]);
    const button = new FakeElement({ type: 'button', className: attrs.class || '' });
    button.dataset.preset = attrs['data-preset'];
    presetButtons.push(button);
  }

  const document = {
    getElementById(id) {
      assert.ok(elements.has(id), 'Builder script references missing element id: ' + id);
      return elements.get(id);
    },
    querySelectorAll(selector) {
      if (selector === '#toolChoices input[type="checkbox"]') return toolChoices;
      if (selector === '.preset-btn') return presetButtons;
      return [];
    },
    querySelector(selector) {
      const match = selector.match(/^\[data-preset="([^"]+)"\]$/);
      return match ? presetButtons.find((button) => button.dataset.preset === match[1]) || null : null;
    },
  };

  const storage = new Map();
  const clipboard = { text: '' };
  const localStorage = {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem(key) {
      storage.delete(key);
    },
  };

  const context = vm.createContext({
    document,
    localStorage,
    navigator: {
      clipboard: {
        writeText(text) {
          clipboard.text = text;
          return Promise.resolve();
        },
      },
    },
    window: { location: { reload() {} } },
    console,
  });

  const scripts = [...BUILDER_HTML.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length, 'Builder has no inline JavaScript');
  vm.runInContext(scripts.at(-1)[1], context, { filename: BUILDER_PATH });

  return {
    context,
    elements,
    toolChoices,
    storage,
    clipboard,
    evaluate(source) {
      return vm.runInContext(source, context);
    },
  };
}

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
    assert.match(page.elements.get('validationWarnings').innerHTML, /Session id or Session path/);

    page.elements.get('sessionId').value = 'review-42';
    page.evaluate('render()');
    assert.equal(page.elements.get('copyBtn').disabled, false);
    assert.match(page.evaluate('buildRawCommand()'), /--session-id 'review-42' --resume-session/);

    page.elements.get('resumeSession').checked = false;
    page.elements.get('sessionExtract').checked = true;
    page.evaluate('render()');
    assert.equal(page.elements.get('copyBtn').disabled, true, 'extract also needs trusted workspace');

    page.elements.get('trustedWorkspace').checked = true;
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
});
