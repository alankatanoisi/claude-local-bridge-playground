'use strict';

const path = require('node:path');

const REPO = path.resolve(__dirname, '../..');
const FLAGS = new Set(['allowShell', 'plan', 'noNetwork']);
const TRACE_FIELDS = { allow_shell: 'allowShell', no_network: 'noNetwork', plan: 'plan' };

// Read simple constant keys from the syntax tree. This recognizes equivalent
// spellings such as .plan, ['plan'], [`plan`], and ['pl' + 'an'] without
// evaluating any project code or mistaking comments for instructions.
function constantString(node) {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const left = constantString(node.left);
    const right = constantString(node.right);
    if (left !== null && right !== null) return left + right;
  }
  return null;
}

function propertyName(node) {
  if (!node.computed && node.key?.type === 'Identifier') return node.key.name;
  return constantString(node.key);
}

function isContext(node) {
  return node?.type === 'Identifier' && node.name === 'ctx';
}

// Raw reads belong inside the two functions that construct and apply the
// ceiling. An unrelated helper in authority.js must still obey the rule.
function isAuthorityImplementation(node, filename) {
  if (filename !== 'src/runner/authority.js') return false;
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (/Function/.test(parent.type)) {
      return (
        parent.type === 'FunctionDeclaration' && ['createAuthorityCeiling', 'effectiveFlags'].includes(parent.id?.name)
      );
    }
  }
  return false;
}

function isStartupTraceField(node, flag, filename) {
  if (filename !== 'src/runner/run.js') return false;
  const field = node.parent;
  if (field?.type !== 'Property' || field.value !== node || TRACE_FIELDS[propertyName(field)] !== flag) return false;
  const flagsObject = field.parent;
  const flagsProperty = flagsObject?.parent;
  if (
    flagsProperty?.type !== 'Property' ||
    flagsProperty.value !== flagsObject ||
    propertyName(flagsProperty) !== 'flags'
  )
    return false;
  const eventObject = flagsProperty.parent;
  const call = eventObject?.parent;
  // Match this one trace shape, rather than granting run.js three arbitrary
  // unchecked reads. Moving a raw read into behavior can no longer spend an
  // unused allowance from the old count-based scanner.
  return (
    call?.type === 'CallExpression' &&
    call.arguments[1] === eventObject &&
    constantString(call.arguments[0]) === 'run_started' &&
    call.callee.type === 'MemberExpression' &&
    call.callee.object.name === 'trace' &&
    propertyName({ key: call.callee.property, computed: call.callee.computed }) === 'append'
  );
}

module.exports = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      rawFlag: 'Read {{flag}} via effectiveFlags(ctx).{{flag}} so mutable state cannot exceed the startup ceiling.',
    },
  },
  create(context) {
    const filename = path.relative(REPO, context.filename).split(path.sep).join('/');
    function report(node, flag) {
      if (!FLAGS.has(flag) || isAuthorityImplementation(node, filename) || isStartupTraceField(node, flag, filename))
        return;
      context.report({ node, messageId: 'rawFlag', data: { flag } });
    }
    return {
      MemberExpression(node) {
        if (!isContext(node.object)) return;
        // Setting a restriction is allowed. A compound assignment also reads
        // the old value, so only a plain '=' is exempted here.
        if (node.parent.type === 'AssignmentExpression' && node.parent.left === node && node.parent.operator === '=')
          return;
        const flag = propertyName({ key: node.property, computed: node.computed });
        report(node, flag);
      },
      ObjectPattern(node) {
        const parent = node.parent;
        const source =
          parent.type === 'VariableDeclarator'
            ? parent.init
            : parent.type === 'AssignmentExpression'
              ? parent.right
              : null;
        if (!isContext(source)) return;
        // Destructuring is a read too, even when the local variable has a
        // different name or a default value: { plan: planning = false }.
        for (const property of node.properties) {
          if (property.type === 'Property') report(property, propertyName(property));
        }
      },
    };
  },
};
