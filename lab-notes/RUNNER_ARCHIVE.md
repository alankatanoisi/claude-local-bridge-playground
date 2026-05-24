# Runner archive (`~/.bridge-runner/archive/`)

Every normal runner exit writes a structured archive (unless disabled). This is separate from the JSONL **transcript** in `~/.bridge-runner/logs/`.

## Layout

```text
~/.bridge-runner/archive/
  index/
    catalog.jsonl          # one JSON object per line — append-only index
    catalog.latest.json    # rebuilt snapshot for quick browsing
    sessions.index.json    # sessionId → runIds
  runs/<runId>/
    meta.json
    outcome.json
    sources.json           # transcript, trace, session, ledger paths
    turns/
      001-user.json
      002-assistant.json
      003-tool-read_file-….json
  sessions/<sessionId>/    # rollups when --session-id is used
    meta.json
    rollup.jsonl
    turns.index.json
  exports/
    csv/all-runs.csv
    exports/workbook/runner-runs.xlsx
```

Legacy JSONL logs are imported with `runId: legacy-<filename-stem>`.

Related: [PERF_PARITY_HANDOFF.md](./PERF_PARITY_HANDOFF.md) (turn latency bench, prompt cache metrics).

## Disable auto-export

- Tests: `BRIDGE_RUNNER_ARCHIVE=0` (set in `test/setup.js`)
- CLI: `--no-archive`

## CLI

From the repo folder:

```bash
node bin/local-bridge-archive.js list
node bin/local-bridge-archive.js show <runId>
node bin/local-bridge-archive.js search "keyword"
node bin/local-bridge-archive.js session <sessionId>
node bin/local-bridge-archive.js ingest-legacy
node bin/local-bridge-archive.js rebuild-index
node bin/local-bridge-archive.js rebuild-spreadsheets
```

## Redaction

Turn JSON uses the same `scrubSecrets` path as other runner outputs. Treat archives as sensitive local data.
