# Worker Bakeoff — 2026-07-31

| Field     | Value                                                     |
| --------- | --------------------------------------------------------- |
| Type      | Thesis demo (W1)                                          |
| Workspace | `~/Developer/orchestration-prototypes/w1-worker-bakeoff/` |
| Fixture   | H1 fixture project (answer key grand total **10**)        |
| Twin      | `docs/worker-bakeoff-2026-07-31.html`                     |

## Thesis

A bounded deterministic program is a legitimate worker peer of a model — **if** they share one contract. This reframes the study's P3 external-SDK bake-off: the contract boundary matters, not which SDK emits the answer.

## Contract (one screen)

See `contract.md` + `schema.json`: input `{ targetDir }`; output `{ files[], table, grandTotal }`; cost ceiling; 30s timeout; authority = read-only + one write (`summary.md`).

## Dispatcher

`dispatcher.js` loads `workers/<name>.js`, calls `run(input)`, validates against the schema, enforces timeout, records wall clock and declared-vs-actual cost. **No** `if (worker === …)` branches.

## Results (3× each)

| Worker                   | Run | schema_ok | Correct (grandTotal=10) | wall_ms | declared cost | actual cost |
| ------------------------ | --: | --------- | ----------------------- | ------: | ------------: | ----------: |
| stub                     | 1–3 | yes       | yes                     |      ~0 |             0 |           0 |
| regex                    |   1 | yes       | yes                     |      10 |             0 |           0 |
| regex                    |   2 | yes       | yes                     |       9 |             0 |           0 |
| regex                    |   3 | yes       | yes                     |       9 |             0 |           0 |
| live (H1 CodeAct replay) |   1 | yes       | yes                     |    ~1–3 |          2000 |        1667 |
| live                     |   2 | yes       | yes                     |      ~1 |          2000 |        1460 |
| live                     |   3 | yes       | yes                     |      ~1 |          2000 |        1808 |

Live worker **reuses H1 leg-B captures** by default (no extra token spend). Fresh live calls remain available via `W1_LIVE_CALL=1`. All nine dispatcher invocations validated against the same schema.

## Variance note

No schema failures this run. If a live worker had returned prose instead of structured output, the dispatcher would have recorded `schema_ok: false` — that failure mode is exactly why a gateway validation-and-repair layer is motivated. Absence of failure here is luck of a well-prompted CodeAct capture, not proof the layer is unnecessary.

## Takeaway

Stub (canned), regex (deterministic program), and live (model) are interchangeable behind one contract. SDK identity is irrelevant; the boundary is the product.
