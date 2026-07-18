'use strict';

/**
 * Anthropic Messages tool-pair contract.
 *
 * One assistant message may request several tools. The following user message
 * must return exactly one tool_result for every requested ID. Local execution
 * may finish out of order, so membership is compared as a set rather than as a
 * FIFO list. This module deliberately validates IDs and adjacency without
 * assuming serial tool execution.
 */

class MessageContractError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'MessageContractError';
    this.code = 'invalid_anthropic_message_history';
    this.details = details;
  }
}

function fail(message, details) {
  throw new MessageContractError(message, details);
}

function contentBlocks(message) {
  if (typeof message?.content === 'string') return [];
  if (!Array.isArray(message?.content)) {
    fail('Message content must be a string or an array of content blocks.', { message });
  }
  return message.content;
}

function toolUseIds(message) {
  if (!message || message.role !== 'assistant' || !Array.isArray(message.content)) return [];
  return message.content.filter((block) => block?.type === 'tool_use').map((block) => block.id);
}

function toolResultIds(message) {
  if (!message || message.role !== 'user' || !Array.isArray(message.content)) return [];
  return message.content.filter((block) => block?.type === 'tool_result').map((block) => block.tool_use_id);
}

function sameIdSet(left, right) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return rightSet.size === right.length && left.every((id) => rightSet.has(id));
}

/**
 * Throw before network I/O when a history cannot satisfy Anthropic's pairing
 * rules. The returned value is true only to make focused assertions readable.
 */
function assertValidAnthropicMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    fail('Messages must be a non-empty array.', { messagesType: typeof messages });
  }
  if (messages[0]?.role !== 'user') {
    fail('The first Anthropic message must have role "user".', { index: 0, role: messages[0]?.role });
  }

  const seenToolUses = new Set();
  const seenToolResults = new Set();

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (!message || (message.role !== 'user' && message.role !== 'assistant')) {
      fail('Every message must have role "user" or "assistant".', { index, role: message?.role });
    }

    const blocks = contentBlocks(message);
    if (message.role === 'assistant') {
      const uses = [];
      for (const block of blocks) {
        if (block?.type === 'tool_result') {
          fail('tool_result blocks may only appear in user messages.', { index });
        }
        if (block?.type !== 'tool_use') continue;
        if (!block.id || !block.name) {
          fail('Every tool_use block must include id and name.', { index, block });
        }
        if (seenToolUses.has(block.id)) {
          fail('Duplicate tool_use id: ' + block.id, { index, toolUseId: block.id });
        }
        seenToolUses.add(block.id);
        uses.push(block.id);
      }

      if (uses.length === 0) continue;

      const resultMessage = messages[index + 1];
      if (!resultMessage || resultMessage.role !== 'user' || !Array.isArray(resultMessage.content)) {
        fail('Assistant tool_use batch is not immediately followed by a user tool_result batch.', {
          index,
          expectedToolUseIds: uses,
        });
      }
      const results = toolResultIds(resultMessage);
      if (!sameIdSet(uses, results)) {
        fail('tool_result IDs do not exactly match the immediately preceding tool_use batch.', {
          index: index + 1,
          expectedToolUseIds: uses,
          actualToolResultIds: results,
        });
      }
      continue;
    }

    let nonResultBlockSeen = false;
    const results = [];
    for (const block of blocks) {
      if (block?.type === 'tool_use') {
        fail('tool_use blocks may only appear in assistant messages.', { index });
      }
      if (block?.type !== 'tool_result') {
        nonResultBlockSeen = true;
        continue;
      }
      if (nonResultBlockSeen) {
        fail('tool_result blocks must come before text or other blocks in a user message.', { index });
      }
      if (!block.tool_use_id) {
        fail('Every tool_result block must include tool_use_id.', { index, block });
      }
      if (seenToolResults.has(block.tool_use_id)) {
        fail('Duplicate tool_result id: ' + block.tool_use_id, { index, toolUseId: block.tool_use_id });
      }
      seenToolResults.add(block.tool_use_id);
      results.push(block.tool_use_id);
    }

    if (results.length === 0) continue;
    const priorUses = toolUseIds(messages[index - 1]);
    if (!sameIdSet(priorUses, results)) {
      fail('User tool_result batch is orphaned or mismatched.', {
        index,
        expectedToolUseIds: priorUses,
        actualToolResultIds: results,
      });
    }
  }

  return true;
}

/**
 * Divide history at semantic exchange boundaries. A group contains leading
 * user instructions, the assistant response, and—when tools were requested—
 * the immediately following result batch. Compaction may remove or retain a
 * whole group, but it must never cut inside one.
 */
function groupSemanticExchanges(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const groups = [];
  let index = 0;

  while (index < messages.length) {
    const start = index;

    // Consecutive ordinary user messages (for example, an instruction delta)
    // belong to the assistant response that follows them. A tool_result user
    // message is never absorbed here; it belongs to the prior assistant batch.
    while (index < messages.length && messages[index]?.role === 'user' && toolResultIds(messages[index]).length === 0) {
      index++;
    }

    if (index < messages.length && messages[index]?.role === 'assistant') {
      const hasTools = toolUseIds(messages[index]).length > 0;
      index++;
      if (hasTools && index < messages.length && toolResultIds(messages[index]).length > 0) {
        index++;
      }
    } else if (index === start) {
      // Preserve malformed/orphaned input as its own group. The final validator
      // rejects it explicitly instead of compaction silently repairing it.
      index++;
    }

    groups.push({ start, end: index, messages: messages.slice(start, index) });
  }

  return groups;
}

module.exports = {
  MessageContractError,
  assertValidAnthropicMessages,
  groupSemanticExchanges,
  toolUseIds,
  toolResultIds,
};
