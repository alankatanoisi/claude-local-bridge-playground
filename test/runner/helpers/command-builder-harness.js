'use strict';

/**
 * command-builder-harness.js — tiny fake DOM for docs/command-builder.html.
 *
 * The builder is a self-contained local HTML page, so its JavaScript normally
 * runs only in a browser. Pulling a full browser framework into this small
 * project would be heavy. This fake DOM supplies only the browser pieces the
 * builder actually uses, then executes the real inline script unchanged.
 *
 * That distinction matters: tests built on this harness do not copy the
 * command-building rules into a second implementation. They click/change the
 * same controls and call the same functions that Alan's browser runs.
 *
 * Shared by command-builder-behavior.test.js and
 * command-builder-combinatorics.test.js.
 */

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const { TOOLS } = require('../../../src/runner/tool-catalog');

const BUILDER_PATH = path.join(__dirname, '..', '..', '..', 'docs', 'command-builder.html');
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

function createHarness(options = {}) {
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
  // A test may seed saved form state to prove restore-on-load behaviour.
  if (options.savedState) storage.set('command-builder-state', JSON.stringify(options.savedState));
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

module.exports = { createHarness, BUILDER_HTML, BUILDER_PATH, FakeElement };
