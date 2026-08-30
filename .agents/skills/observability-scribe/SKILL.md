---
name: observability-scribe
description: >-
  Documents runner observability contract—stream-json event types, stopReason taxonomy,
  usage fields, autopsy/ledger shapes—from kernel contract and tests. Use when Alan
  asks for observability-contract.md, stream-json catalog, or stop reason inventory.
---

# Observability Scribe

Produces **`lab-notes/observability/observability-contract.md`**: what the harness emits for humans, transcripts, stream-json, and automation—grounded in code, not wishlists.

## When to use

- Create or update `lab-notes/observability/observability-contract.md`
- Inventory `KERNEL_EVENT_TYPES` and `STOP_REASONS`
- Document stream-json / `--output-format` shapes
- Map autopsy (`loop-autopsy.js`) and ledger fields for replay tooling

## When not to use

- Policy citations (**anthropic-official**)
- Parity adopt/skip matrix (**parity-archivist**)
- Live bench runs (**oauth-evidence**)

## Charter

Read [`lab-notes/agents/CHARTER.md`](../../lab-notes/agents/CHARTER.md).

## File ownership

| File | Scope |
| ---- | ----- |
| `lab-notes/observability/observability-contract.md` | Event catalog, shapes, examples |

## Read first

1. `src/runner/kernel/contract.js` — canonical `STOP_REASONS`, `KERNEL_EVENT_TYPES`
2. `src/runner/event-bus.js` — validation against kernel types
3. `src/runner/human-log.js`, `src/runner/transcript.js`
4. `src/runner/loop-autopsy.js`, `src/runner/session-ledger.js`
5. Tests: `test/runner/harness-architecture.test.js`, `test/runner/session-ledger.test.js`, `test/runner/loop-autopsy.test.js`
6. `docs/runner-quickstart.html` (output flags section)

## Workflow

1. Extract enums from `contract.js` verbatim (do not paraphrase stop reason strings).
2. For each `KERNEL_EVENT_TYPE`, document: emitter, payload shape, redaction rules, stream-json line example.
3. Document final `KernelResult` / run summary: `stopReason`, `usage`, `steps`, `duration_ms`.
4. Cross-check tests for golden shapes; cite test file paths as evidence.
5. Note gaps vs Claude Code OTel (label `later` in matrix pointer, do not implement).
6. Hand off per CHARTER.

## Deliverable template

```markdown
# Observability contract (playground runner)

Last updated: YYYY-MM-DD
Canonical code: src/runner/kernel/contract.js

## Stop reasons (STOP_REASONS)

| Value | When emitted | Human-visible? | Evidence |
| ----- | ------------ | -------------- | -------- |
| success | … | … | run.js:… |

## Stream / kernel event types (KERNEL_EVENT_TYPES)

| type | Purpose | Payload keys | Redaction |
| ---- | ------- | ------------ | --------- |
| system | … | … | secrets scrubbed |

## Usage block

| Field | Source | Notes |
| ----- | ------ | ----- |
| input_tokens | model response | … |
| cache_read_input_tokens | … | … |

## Artifacts

| Artifact | Path pattern | Contents |
| -------- | ------------ | -------- |
| transcript JSONL | … | … |
| human log | … | … |
| session ledger | … | … |
| loop autopsy | … | … |

## Example stream-json line (synthetic, no secrets)

\`\`\`json
{ "type": "tool_result", "…": "…" }
\`\`\`
```

## Code anchors (copy enums from here)

```11:41:src/runner/kernel/contract.js
const STOP_REASONS = Object.freeze({
  SUCCESS: 'success',
  // … full list in file
});
const KERNEL_EVENT_TYPES = Object.freeze([
  'system',
  // …
]);
```

## Handoff

- **parity-archivist** — link matrix rows that depend on observability
- **oauth-evidence** — which artifacts to collect on demo runs
- **lab-integrator** — weekly note when contract changes
