# srt Sandbox Evaluation — 2026-07-31

| Field     | Value                                                                                    |
| --------- | ---------------------------------------------------------------------------------------- |
| Type      | Gated OS-sandbox experiment (H2)                                                         |
| Package   | `@anthropic-ai/sandbox-runtime` local install (`0.0.67`; CLI `--version` prints `1.0.0`) |
| Host      | macOS (Seatbelt via `sandbox-exec`)                                                      |
| Workspace | `~/Developer/orchestration-prototypes/h2-srt-eval/` (sibling of playground; not in git)  |
| Twin      | `docs/srt-sandbox-evaluation-2026-07-31.html`                                            |

## Method

1. Local `npm install @anthropic-ai/sandbox-runtime` (never `-g`); invoke via `node_modules/.bin/srt`.
2. Built Safari-2-shaped fixtures under `attack-fixtures/`:
   - `.env` with fake secret
   - `notes.txt` → `.env` (in-root innocent basename alias)
   - `escape.txt` → `../outside-target/real.env` (out-of-root, non-deny basename)
   - `escape-dotenv.txt` → `../outside-target/.env` (out-of-root, deny-listed basename)
   - `allowed.txt` control file
3. Settings used (handoff JSON was incomplete for current schema — `network` is required):

```json
{
  "network": { "allowedDomains": [], "deniedDomains": [] },
  "filesystem": {
    "denyRead": ["**/.env"],
    "allowWrite": ["."],
    "denyWrite": ["**/.env"]
  }
}
```

4. Each probe run once bare (OS baseline) and once under `srt --settings …`.

## Probe matrix

| Attack shape                                          | Bare OS                 | srt                                                        | Runner gate (`resolveFileTarget`)              |
| ----------------------------------------------------- | ----------------------- | ---------------------------------------------------------- | ---------------------------------------------- |
| Direct read `.env`                                    | allow (prints secret)   | **deny** — `cat: .env: Operation not permitted`            | deny (deny-listed basename)                    |
| In-root alias `notes.txt` → `.env`                    | allow (follows symlink) | **deny** — `cat: notes.txt: Operation not permitted`       | deny (realpath basename deny-listed)           |
| Escape `escape.txt` → `../outside-target/real.env`    | allow                   | **allow** (basename `real.env` not matched by `**/.env`)   | would deny if runner confined path escapes cwd |
| Escape `escape-dotenv.txt` → `../outside-target/.env` | allow                   | **allow** (secret printed)                                 | deny (out-of-root / deny basename)             |
| Write via alias `echo x >> notes.txt`                 | allow (mutates `.env`)  | **deny** — `/bin/bash: notes.txt: Operation not permitted` | deny                                           |
| Control `cat allowed.txt`                             | allow                   | allow                                                      | allow                                          |

## Findings

1. **THE Safari-2 in-root alias question:** with `denyRead: ["**/.env"]`, srt **does** block reading through an innocent in-root symlink whose target is `.env`. Seatbelt reported `Operation not permitted`. That matches the runner gate's intent for this attack shape.
2. **Out-of-root escape to a deny-listed name is NOT blocked** by this settings shape: `escape-dotenv.txt` → `../outside-target/.env` succeeded under srt. The runner's containment + realpath check is **stricter** here.
3. Globs are basename-sensitive: `real.env` is not matched by `**/.env`.
4. Config schema drift: current srt requires `network.allowedDomains` and `network.deniedDomains`. The handoff's filesystem-only JSON failed closed with a clear error (good).
5. Beta preview: APIs/settings may change; this is a 2026-07-31 snapshot on macOS.

## Adoption verdict

**Useful as an OS-layer complement for shell/CodeAct, not a replacement for the runner permission gate.**

- Adopt for: wrapping `--allow-shell` / generated CodeAct scripts when you want Seatbelt deny on known secret paths.
- Do not rely on alone for: workspace confinement or out-of-root symlink escapes to deny-listed names (needs broader `denyRead` regions such as `/Users` + `allowRead: ["."]`, or keep the runner gate).
- Integration sketch: optional runner flag that prefixes bash/CodeAct child processes with `srt --settings <project-or-user-settings>`; keep `resolveFileTarget` as the primary gate for file tools.

## What runner integration would require

- Ship or document a default `srt-settings.json` template (network required; denyRead for `.env`, keys, `.ssh`, etc.).
- Resolve `srt` from local `node_modules` or `PATH`; fail closed if missing when the flag is set.
- Do **not** remove `resolveFileTarget` — srt alone missed the out-of-root `.env` escape in this probe.
- Threat-model rewrite belongs with HE-05; this doc does not edit `docs/threat-model.md`.
