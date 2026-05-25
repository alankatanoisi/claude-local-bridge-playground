# Structured output (design-only)

Last updated: 2026-05-24  
Status: **design spike** — not wired in production run path

## Goal

Compare Anthropic **structured outputs** / JSON schema responses with what the playground runner supports today, for parity matrix tracking without implementing yet.

## Claude Code / API (documented)

| Surface      | Mechanism                                                      |
| ------------ | -------------------------------------------------------------- |
| Messages API | `output_format` / structured outputs (schema-constrained JSON) |
| Agent SDK    | Tool schemas + structured tool inputs                          |
| `claude -p`  | CLI flags for JSON output where supported                      |

Consult [Anthropic API docs](https://docs.anthropic.com/) for current schema fields (refresh before implementation).

## Playground runner today

| Mechanism                               | Status            | Location                                 |
| --------------------------------------- | ----------------- | ---------------------------------------- |
| `--output-format json`                  | partial           | `bin/local-bridge-runner.js` → `run.js`  |
| `--output-format stream-json`           | partial           | emits subset of `KERNEL_EVENT_TYPES`     |
| Tool input JSON Schema                  | implicit per tool | `src/runner/tools/*`, `tool-envelope.js` |
| Model response JSON schema enforcement  | **missing**       | no `output_format` on bridge request     |
| Post-parse validation of assistant JSON | **missing**       | —                                        |

## Gap analysis

| Gap                                       | Decision | Blocker                                            |
| ----------------------------------------- | -------- | -------------------------------------------------- |
| Request-level `output_format` to bridge   | later    | model-client request builder + bridge pass-through |
| Schema validation failures → `stopReason` | later    | new stop reason or `BRIDGE_ERROR` subtype          |
| stream-json event for schema validation   | later    | observability contract extension                   |
| Coordinator spec JSON outputs             | later    | coordinator-spec-compiler                          |

## Proposed shape (sketch)

```javascript
// Future KernelInput extension (not implemented)
{
  structuredOutput: {
    type: 'json_schema',
    schema: { /* JSON Schema object */ },
  },
}
```

On validation failure:

- `stopReason`: consider `BRIDGE_ERROR` or new `SCHEMA_VALIDATION_FAILED`
- Human log + stream-json `error` event with redacted detail

## Decision

**later** — document for matrix; implement after observability contract stable and OAuth demo path green.

## Related

- [observability-contract.md](../observability/observability-contract.md)
- [claude-parity-matrix.md](./claude-parity-matrix.md)
