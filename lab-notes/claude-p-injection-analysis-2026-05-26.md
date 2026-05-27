# Claude Code `claude -p` injection analysis (2026-05-26)

Evidence from VS Code **Claude Local Bridge** output log: `Claude Local Bridge.log`  
Capture: incoming `POST /v1/messages` at `localhost:11437` before bridge forward to `api.anthropic.com`.

Terminal command (from Cursor terminal): `claude -p why hello there`  
**Actual user text in body:** `why` only (see [Prompt parsing](#prompt-parsing)).

---

## Request size (why the log line is huge)

| Layer | Approx. size | Notes |
|-------|-------------|--------|
| `messages` (user role) | ~17.5 KB | 4 text blocks |
| `system` array | ~27.2 KB | 2 text blocks |
| `tools` | ~73 KB (est.) | 26 tool definitions in JSON |
| **HTTP body** | **~118 KB** | Matches `content-length: 118526` in log |

The bridge log stores one long `BODY:` JSON line; artifacts below split it for reading.

---

## Who injects what

```text
claude-cli  ──builds──►  messages[] + system[] + tools[]
       │
       ▼
localhost:11437  (x-api-key: "local" placeholder)
       │
       ▼
bridge  ──prependClaudeCodeSystem()──►  billing + identity blocks on system[] (OAuth only)
       │
       ▼
api.anthropic.com  (Bearer from Keychain / intercept)
```

- **Claude Code CLI** supplies skills reminders, plan-mode reminder, repo `CLAUDE.md` / rules, and your prompt.
- **Bridge** (`src/credentials.js` → `prependClaudeCodeSystem`) prepends OAuth billing header + SDK identity to the **`system`** array before upstream. This capture shows a short identity line plus the large Claude Code system prompt.

---

## `messages` array (4 blocks)

| Block | Chars | Role |
|-------|-------|------|
| 1 | 6,067 | **Skills catalog** — `<system-reminder>` listing ~66 Skill-tool entries |
| 2 | 4,919 | **Plan mode** — active plan workflow; references `~/.claude/plans/why-iterative-wind.md` |
| 3 | 6,491 | **Repo instructions** — `CLAUDE.md` from home + playground `CLAUDE.md` (AGENTS, OAuth-only, safety) |
| 4 | 3 | **User prompt** — `why` |

### Block 1 — skills

Starts with: `The following skills are available for use with the Skill tool:`  
Includes many user-installed skills (bioinformatics, Cursor skills, etc.).  
Artifact: `lab-notes/claude-p-skills-index-redacted.txt`

### Block 2 — plan mode (important)

Claude Code injected **Plan mode is active** even though the terminal command did not include an obvious `--plan` flag. It forbids edits (except a plan file under `~/.claude/plans/`) and describes Explore/Plan agent workflow.

Artifact: `lab-notes/claude-p-message-block-2-redacted.txt`

### Block 3 — repo context

Injects full text of:

- `/Users/alanman/CLAUDE.md` (home-level project list)
- `/Users/alanman/Developer/claude-local-bridge-playground/CLAUDE.md` (playground rules, OAuth-only, runner boundaries)

Ends with `# currentDate` → `2026-05-26` and the standard “may or may not be relevant” disclaimer.

Artifact: `lab-notes/claude-p-message-block-3-redacted.txt`

### Block 4 — user prompt

Literal text: `why`

---

## `system` array (2 blocks)

| Block | Chars | Role |
|-------|-------|------|
| 1 | 62 | **SDK identity** — “You are a Claude agent, built on Anthropic's Claude Agent SDK.” (bridge prepend target) |
| 2 | 27,126 | **Claude Code core system** — tool policy, security, tasks, markdown, hooks, compression, etc. |

Artifact: `lab-notes/claude-p-system-array-redacted.txt` (both blocks)

Bridge code reference: `prependClaudeCodeSystem` in `src/credentials.js` inserts **billing header + identity** before existing `system` blocks when using OAuth.

---

## Tools exposed (26)

From `lab-notes/claude-p-request-meta.json`:

`Agent`, `AskUserQuestion`, `Bash`, `CronCreate`, `CronDelete`, `CronList`, `Edit`, `EnterPlanMode`, `EnterWorktree`, `ExitPlanMode`, `ExitWorktree`, `Glob`, `Grep`, `NotebookEdit`, `Read`, `ScheduleWakeup`, `Skill`, `TaskCreate`, `TaskGet`, `TaskList`, `TaskOutput`, `TaskStop`, `TaskUpdate`, `WebFetch`, `WebSearch`, `Write`

---

## Other request fields

| Field | Value |
|-------|--------|
| `model` | `claude-opus-4-7` |
| `max_tokens` | 64000 |
| `stream` | true |
| `thinking` | `{ "type": "adaptive" }` |
| `output_config.effort` | `medium` |
| Headers | `anthropic-beta` includes claude-code, interleaved-thinking, effort |

---

## Prompt parsing

Shell/CLI likely parsed:

```bash
claude -p why hello there
#          ^^^  only this became the prompt
```

Use quotes for multi-word prompts:

```bash
claude -p "why hello there"
```

---

## Redacted artifacts

| File | Contents |
|------|----------|
| `claude-p-injection-run-2026-05-26-redacted.txt` | Full messages + system (for diffing runs) |
| `claude-p-messages-redacted.txt` | All user message blocks |
| `claude-p-system-array-redacted.txt` | Full system array |
| `claude-p-message-block-{1-4}-redacted.txt` | Per message block |
| `claude-p-system-block-{1-2}-redacted.txt` | Per system block |
| `claude-p-system-reminder-{1-3}-redacted.txt` | Each `<system-reminder>` |
| `claude-p-skills-index-redacted.txt` | Skills list only |
| `claude-p-request-meta.json` | Sizes, tool names, model (no secrets) |

**Not committed by default** — keep under `lab-notes/` for local evidence; add to git only if you intend to share redacted captures.

---

## Compare a second run

1. Run another `claude -p "..."` with different cwd, flags, or env.
2. Re-export from bridge log (or re-run extraction script).
3. Save as e.g. `lab-notes/claude-p-injection-run-B-redacted.txt`
4. Diff:

```bash
cd "/Users/alanman/Developer/claude-local-bridge-playground"
python3 scripts/diff-claude-p-injection.py \
  lab-notes/claude-p-injection-run-2026-05-26-redacted.txt \
  lab-notes/claude-p-injection-run-B-redacted.txt
```

---

## Model reply vs injection

The assistant answered as if the prompt were only “why” with no referent — consistent with block 4 and the huge unrelated context above it.
