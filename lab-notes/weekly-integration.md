# Weekly integration

Rolling log of cross-lane lab-notes work. Newest entry first.

---

## 2026-05-24 (megathread gap improvements)

**Theme:** Session health, task-scope presets, effort passthrough, Ext-11 + fork CLI, megathread docs

| Lane               | Outputs                                                                                                                                 | Notes                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| runner             | `session-health.js`, `--new-session`, `--resume-session`, `--task-scope`, `--effort`, `--fork-from`, instruction-delta wired in `run.js` | bridge effort passthrough test added       |
| lab-notes          | [reddit-workaround-coverage.md](./reddit-workaround-coverage.md), [runner-megathread-playbook.md](./runner-megathread-playbook.md), [claude-code-sidecar-settings.md](./claude-code-sidecar-settings.md) | parity matrix rows updated                 |
| parity-archivist   | [parity/claude-parity-matrix.md](./parity/claude-parity-matrix.md) — Ext-11, fork, health, effort rows → wired                          | —                                          |

**Tests:** `session-health.test.js`, `effort-passthrough.test.js`, anthropic effort integration test.

**Next:** optional live smoke with `--effort high`; wire Ext-6 prefetch.

---

## 2026-05-24

**Theme:** Perf reconciliation + parity lab-notes v1 + TTL fix for live OAuth

| Lane                        | Outputs                                                                                                                                                                                      | Blocked                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| perf (reconciliation)       | [PERF_ROADMAP_RECONCILIATION.md](./PERF_ROADMAP_RECONCILIATION.md)                                                                                                                           | magical-edison superseded by main — no merge |
| anthropic-official          | [parity/anthropic-official-posture.md](./parity/anthropic-official-posture.md)                                                                                                               | —                                            |
| oauth-evidence              | [parity/oauth-headless-demo-runbook.md](./parity/oauth-headless-demo-runbook.md), [parity/bench-parity-evidence.md](./parity/bench-parity-evidence.md)                                       | live smoke passed 2026-05-24                 |
| parity-archivist            | [parity/claude-parity-matrix.md](./parity/claude-parity-matrix.md), [parity/permission-modes.md](./parity/permission-modes.md), [parity/structured-output.md](./parity/structured-output.md) | —                                            |
| observability-scribe        | [observability/observability-contract.md](./observability/observability-contract.md)                                                                                                         | —                                            |
| runner (TTL + cache budget) | `src/runner/run.js` — `RUNNER_CACHE_CONTROL`, `BRIDGE_OAUTH_CACHE_RESERVE`                                                                                                                   | bridge files untouched; live OAuth OK        |
| lab-integrator              | this file                                                                                                                                                                                    | —                                            |

**Stub bench baseline:** `req_overhead_ms.p95` = 2 ms, `cache_control.mean_breakpoints_per_request` = 3.5 — full JSON in bench-parity-evidence.

**Next:** wire Ext-6/11/13 infra modules; finish D1 coordinator parallel default path; optional live `--live` bench row.

**Links added:**

- `lab-notes/parity/*` (6 files)
- `lab-notes/observability/observability-contract.md`
- `lab-notes/PERF_ROADMAP_RECONCILIATION.md`

**Skills index:** [agents/README.md](./agents/README.md) · [agents/CHARTER.md](./agents/CHARTER.md)
