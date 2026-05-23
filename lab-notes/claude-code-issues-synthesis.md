# Claude Code GitHub Issues — Synthesis for Playground Harness Lab

**Repo researched:** [anthropics/claude-code](https://github.com/anthropics/claude-code)  
**Research date:** 2026-05-22  
**Methods:** `gh` CLI (`gh search issues`, `gh issue list`, `gh issue view`, GraphQL counts)  
**Playground context:** `lab-notes/HARNESS_VISION.md`, `letter-to-anthropic-v1.md`, `letter-to-anthropic-v2.md`  
**Scope:** Lessons for a **local runner harness** in `claude-local-bridge-playground` — **not** bridge fingerprinting, OAuth interception, or `localhost:11437` testing.

**Evidence legend (used throughout):**

| Tag | Meaning |
|-----|---------|
| **Confirmed** | Repro steps, logs, maintainer/team quotes, or multiple independent reporters in the thread |
| **Anecdotal** | Plausible user report without full repro or single reporter |
| **Speculation** | Inference, product theory, or cross-issue pattern not verified in thread |

---

## 1. Executive summary (beginner-friendly)

The official Claude Code issue tracker is **very large and very active** (~10.6k open issues, ~48.7k closed as of 2026-05-22). Most tickets are routine bugs; a smaller set repeatedly describes **harness failures** — the machinery around the model (sessions, auth, compaction, telemetry, tools, subagents) — not “the model got dumber” alone.

Three themes matter for Alan’s playground:

1. **Telemetry is not a side channel.** Disabling telemetry can change **feature gates**, **Remote Control eligibility**, and even **which slash commands appear** ([#47558](https://github.com/anthropics/claude-code/issues/47558), [#29580](https://github.com/anthropics/claude-code/issues/29580), [#60189](https://github.com/anthropics/claude-code/issues/60189)). Third-party OpenTelemetry (OTel) setups often **fail silently** — no console output, no OTLP sockets ([#46204](https://github.com/anthropics/claude-code/issues/46204)).

2. **Auth is a state machine, not a file.** Users report **401 loops**, **refresh returning 400 while local expiry is still in the future**, **sleep/wake breaking Keychain**, and **concurrent sessions fighting over refresh tokens** ([#54443](https://github.com/anthropics/claude-code/issues/54443), [#60104](https://github.com/anthropics/claude-code/issues/60104), [#58926](https://github.com/anthropics/claude-code/issues/58926)). A harness that assumes “credentials on disk = good for N hours” will fail in production.

3. **Harness degradation is mostly continuity and contracts.** **Compaction** drops runtime state (remote tasks, plan mode, instructions) ([#50015](https://github.com/anthropics/claude-code/issues/50015), [#60526](https://github.com/anthropics/claude-code/issues/60526), [#46663](https://github.com/anthropics/claude-code/issues/46663)). **Subagents** miss permissions and project rules ([#51288](https://github.com/anthropics/claude-code/issues/51288), [#61467](https://github.com/anthropics/claude-code/issues/61467)). **Headless / `-p` mode** hits different API tool-id bugs than interactive mode ([#18131](https://github.com/anthropics/claude-code/issues/18131), [#20508](https://github.com/anthropics/claude-code/issues/20508)). **Version bumps** regress hooks, resume, and MCP auth ([#34039](https://github.com/anthropics/claude-code/issues/34039) — closed but illustrative).

**Playground takeaway:** Your lab should treat the runner as an **operating system for sessions** — ledger, compaction ghosts, auth health checks, explicit telemetry modes, and degradation banners — while keeping the bridge as a dumb phone line ([HARNESS_VISION.md](./HARNESS_VISION.md), letters v1/v2).

---

## 2. Issue landscape

| Metric | Value | Source |
|--------|-------|--------|
| Open issues | **10,658** | GraphQL `repository.issues(states: OPEN)` |
| Closed issues | **48,680** | GraphQL |
| REST `open_issues_count` | **11,203** | `gh api repos/anthropics/claude-code` (slight count lag vs GraphQL) |
| Repo last pushed | 2026-05-23 | GitHub API |

**Hot labels (sample from `gh label list`):**

- **Platform:** `platform:macos`, `platform:windows`, `platform:linux`, `platform:vscode`
- **Area:** `area:auth`, `area:core`, `area:tools`, `area:agents`, `area:mcp`, `area:cost`, `area:hooks`, `memory`, `regression`
- **Triage:** `bug`, `enhancement`, `has repro`, `duplicate`, `stale`

**Time range of this synthesis:** Heavily weighted to **2026-03 through 2026-05** (recent search results and high-churn threads). Older closed issues (e.g. tool_use ID bugs from 2025) remain relevant as **contract warnings** for harness designers.

**Engagement pattern:** `area:auth` and `area:model` clusters have long threads with repro logs; `area:cost` spikes around billing/usage UI mismatches; OTel threads mix **enterprise managed-settings path** with **personal plan** confirmations ([#46204](https://github.com/anthropics/claude-code/issues/46204) comments).

**Caveat:** Issue volume includes many duplicates, “model quality” reports without repro, and MCP-vendor-specific OAuth tickets. This doc filters toward **harness-relevant** patterns.

---

## 3. Theme A: Telemetry

### Complaints and privacy

| Topic | Summary | Evidence |
|-------|---------|----------|
| Opt-out ≠ analytics-only | `DISABLE_TELEMETRY=1` disables Statsig **and** experiment gate fetch; behavior falls back to **built-in defaults** | **Confirmed** — docs request + Boris Cherny quote cited in [#47558](https://github.com/anthropics/claude-code/issues/47558) |
| Remote Control blocked | Same flag yields misleading “not yet enabled for your account” | **Confirmed** — repro in [#29580](https://github.com/anthropics/claude-code/issues/29580) (13 comments) |
| `/schedule` hidden | Disabling telemetry hides routines; docs say “Unknown command” but UI omits command | **Confirmed** — root cause claimed in [#60189](https://github.com/anthropics/claude-code/issues/60189) |
| Enterprise metrics vs opt-out | Docs unclear whether opt-out affects org usage dashboards | **Anecdotal** — [#53075](https://github.com/anthropics/claude-code/issues/53075) |
| Cowork metrics | Docs say “events only” but metrics still emit | **Confirmed** — [#56645](https://github.com/anthropics/claude-code/issues/56645) |

### Volume, failures, and coupling

- **Silent OTel init failure:** Env vars present in process, **zero TCP** to collector, no console exporter output ([#46204](https://github.com/anthropics/claude-code/issues/46204)) — **Confirmed** with `lsof`/PowerShell evidence; thread extended to **macOS personal plan** and **interactive vs `claude -p`** paths.
- **Console exporter unreachable:** Comment alleges env var stripping removes `console` before `mlz()` runs — **Confirmed** in thread as code-path analysis (v2.1.108+); workaround: external collector.
- **Race at startup:** `hook_execution_start` dropped before OTel logger registers ([#58439](https://github.com/anthropics/claude-code/issues/58439)) — **Confirmed** with timings (~37 ms).
- **Decouple user feedback from telemetry:** `/feedback` tied to “nonessential traffic” env vars ([#52787](https://github.com/anthropics/claude-code/issues/52787)) — feature request.
- **Excel add-in OTLP CORS:** [#56401](https://github.com/anthropics/claude-code/issues/56401) — platform-specific export failure.

### OTel and observability requests

- Extra usage dimensions in telemetry ([#46790](https://github.com/anthropics/claude-code/issues/46790)).
- Streaming hook for mirror/TTS telemetry ([#60564](https://github.com/anthropics/claude-code/issues/60564)).
- `claude telemetry status` diagnostic requested in [#46204](https://github.com/anthropics/claude-code/issues/46204) — **not shipped** in thread; **speculation** that it would reduce support load.

### Anecdotal / speculation (telemetry)

- **Anecdotal:** Comment on [#47558](https://github.com/anthropics/claude-code/issues/47558) analyzes local Statsig cache files (feature gates, `session_recording_rate`) from a fork diff — useful for **privacy review**, not official Anthropic disclosure.
- **Speculation (from Alan’s letters, not issues):** Bridge traffic that **looks like** Claude Code pollutes upstream telemetry. Playground should still build **honest local telemetry** with clear `runner` vs `bridge` attribution in traces ([letter-to-anthropic-v2.md](../letter-to-anthropic-v2.md)).

### Playground relevance

- Default runner: **local flight recorder** (redacted) independent of vendor telemetry.
- If Alan tests OTel: expect **silent failure**; add `runner telemetry doctor` that checks exporters and prints **actionable** errors (lesson from [#46204](https://github.com/anthropics/claude-code/issues/46204)).
- Document that **disabling telemetry** in any upstream client may change **feature flags** — do not assume opt-out is privacy-only ([#47558](https://github.com/anthropics/claude-code/issues/47558)).

---

## 4. Theme B: Auth rotation / OAuth / session / 401 loops / keychain

### Core failure modes

| Pattern | Representative issues | Evidence |
|---------|----------------------|----------|
| Early 401 + refresh 400 | [#54443](https://github.com/anthropics/claude-code/issues/54443) | **Confirmed** — UTC timeline, two tmux sessions, `expiresAt` still future |
| 401 auth loop (/login also 401) | [#58926](https://github.com/anthropics/claude-code/issues/58926) | **Anecdotal** — checklist filled; 0 comments at fetch time |
| Sleep/wake → 401 until reboot | [#60104](https://github.com/anthropics/claude-code/issues/60104) | **Confirmed** — repro steps; persists after v2.1.137 Keychain fix |
| Forced reauth after sleep | [#59937](https://github.com/anthropics/claude-code/issues/59937) | **Anecdotal** — Windows + VS Code |
| Invalid bearer right after login | [#48996](https://github.com/anthropics/claude-code/issues/48996) | **Anecdotal** |
| OAuth “is down” spikes | [#44264](https://github.com/anthropics/claude-code/issues/44264) | **Anecdotal** — incident-style reports |
| Headless refresh blocked by WAF | [#47754](https://github.com/anthropics/claude-code/issues/47754) | **Confirmed** — has repro label |
| Token refresh docs gap | [#52202](https://github.com/anthropics/claude-code/issues/52202) | docs enhancement |

### Keychain and credential storage

- **Keychain -25299 on every launch** (missing `-U` on add-generic-password): [#48162](https://github.com/anthropics/claude-code/issues/48162) — **Confirmed** pattern for macOS.
- **Remote daemon adhoc codesign breaks Keychain ACLs** on auto-update: [#53501](https://github.com/anthropics/claude-code/issues/53501) — **Confirmed** with `has repro`.
- **`CLAUDE_CONFIG_DIR` does not isolate credentials** on Linux/WSL without Keychain: [#47661](https://github.com/anthropics/claude-code/issues/47661) — **Confirmed**.
- **MCP re-runs DCR, orphans refresh_token**: [#59460](https://github.com/anthropics/claude-code/issues/59460) — **Confirmed** with repro.

### MCP OAuth (adjacent to harness, not playground bridge)

Large open cluster: [#49043](https://github.com/anthropics/claude-code/issues/49043), [#60260](https://github.com/anthropics/claude-code/issues/60260), [#61376](https://github.com/anthropics/claude-code/issues/61376) — **lesson:** treat MCP auth as **separate token lifecycle** from CLI OAuth.

### Playground relevance

- Runner should **never store refresh tokens in transcripts**; already aligned with playground safety rules.
- Add harness tests: **concurrent runner processes** same `~/.bridge-runner` creds → detect refresh races (inspired by [#54443](https://github.com/anthropics/claude-code/issues/54443)).
- **Auth health command:** surface `expiresAt`, last refresh error, clock skew — fail with human message before burning turns on 401.
- **Do not** implement Claude Code OAuth interception in playground (anti-goal per HARNESS_VISION).

---

## 5. Theme C: Harness degradation

### Context loss and compaction

| Issue | Takeaway | Evidence |
|-------|----------|----------|
| [#50015](https://github.com/anthropics/claude-code/issues/50015) | Silent auto-compaction; model misreads summary as pending work | **Confirmed** — concrete `/coffee overnight` example |
| [#60526](https://github.com/anthropics/claude-code/issues/60526) | Remote-control **task ID** not in compaction summary | **Confirmed** |
| [#46663](https://github.com/anthropics/claude-code/issues/46663) | Compaction **deactivates plan mode** | **Confirmed** — `has repro` |
| [#57486](https://github.com/anthropics/claude-code/issues/57486) | Memory not auto-consulted after compaction | **Anecdotal** — enhancement |
| [#52146](https://github.com/anthropics/claude-code/issues/52146) | Resume loses prior history | **Anecdotal** |
| [#33912](https://github.com/anthropics/claude-code/issues/33912) | `--resume` says no conversation though files exist | **Confirmed** — `has repro` |
| [#48782](https://github.com/anthropics/claude-code/issues/48782) | Mass session JSONL deletion | **Anecdotal** — severe if true |
| [#55042](https://github.com/anthropics/claude-code/issues/55042) | Read cache survives rewind → stale “unchanged” | **Confirmed** — `has repro` |

### Tool failures and API contracts

- **Print mode concurrency 400:** [#18131](https://github.com/anthropics/claude-code/issues/18131) — **Confirmed**; headless harness must use **unique tool_use ids** and serial tool policy.
- **Duplicate tool_use ids with `-p`:** [#20508](https://github.com/anthropics/claude-code/issues/20508) — **Confirmed** — directly relevant to `stream-json` runners.
- **Core tools vanish during outage with no UI:** [#60489](https://github.com/anthropics/claude-code/issues/60489) — **Confirmed** — links status.claude.com May 2026 incident.
- **Backend health indicator closed Not Planned:** #33328 referenced in [#60489](https://github.com/anthropics/claude-code/issues/60489) — **speculation** that product won't add CLI banner.

### Subagents and delegation

- Permissions don’t propagate to parallel subagents: [#51288](https://github.com/anthropics/claude-code/issues/51288), [#51289](https://github.com/anthropics/claude-code/issues/51289) — **Confirmed** pattern.
- Subagents skip `.claude/rules/*.md`: [#61467](https://github.com/anthropics/claude-code/issues/61467) — **Confirmed** — `has repro`.
- Session terminates with multiple subagents: [#61258](https://github.com/anthropics/claude-code/issues/61258) — **Anecdotal**.
- 12+ hour hang without timeout: [#61405](https://github.com/anthropics/claude-code/issues/61405) — **Anecdotal**.
- No nested subagent dispatch: [#60763](https://github.com/anthropics/claude-code/issues/60763) — enhancement.

### Model / instruction degradation (harder to harness-fix)

High-comment thread [#28469](https://github.com/anthropics/claude-code/issues/28469) (22 comments): loops, post-compaction **MEMORY.md** rules forgotten, instruction non-compliance — mix of **Confirmed** user patterns and **speculation** that root cause is model vs compaction vs prompts.

Cluster of `area:model` “degraded quality” reports ([#54817](https://github.com/anthropics/claude-code/issues/54817), [#44246](https://github.com/anthropics/claude-code/issues/44246), etc.) — mostly **anecdotal**; playground should still **re-inject critical rules after compaction** regardless.

### Version regressions

- SessionStart hooks re-injected every `--resume` (fixed then broken again): [#34039](https://github.com/anthropics/claude-code/issues/34039) — **Confirmed** historically — **lesson: pin + test resume**.
- MCP Bearer regression 2.1.81 → 2.1.83: [#39271](https://github.com/anthropics/claude-code/issues/39271) — closed — **Confirmed** pattern.
- Resume overwrites `settings.json` model 1M flag: [#61068](https://github.com/anthropics/claude-code/issues/61068) — **Confirmed** — `regression` label.

---

## 6. Cross-cutting patterns

### Version bumps breaking clients

Frequent `regression` + `area:cli` / `area:hooks` / `area:mcp` labels. Harnesses that **parse undocumented JSON**, **replay transcripts**, or **depend on hook timing** break on upgrade without semver guarantees.

**Playground lesson:** Version **runner event schema** (`stream-json` v1) separately from bridge and from Claude Code CLI.

### Billing and usage confusion

- UI shows low % but limit reached: [#51219](https://github.com/anthropics/claude-code/issues/51219).
- Extra usage consumed while dashboard shows 43% left: [#57796](https://github.com/anthropics/claude-code/issues/57796).
- Desktop uses project API keys instead of subscription silently: [#53638](https://github.com/anthropics/claude-code/issues/53638).
- `/status` shows costs when no billable usage: [#53213](https://github.com/anthropics/claude-code/issues/53213).

**Evidence:** Mostly **anecdotal** per issue; pattern is **Confirmed** as a recurring theme across many tickets.

**Playground lesson:** Runner should log **which credential class** and **budget counters** each turn (local only, redacted) — avoid silent “wrong wallet” behavior.

### Telemetry ↔ feature ↔ auth entanglement

Single flags (`DISABLE_TELEMETRY`, managed settings fetch, Statsig connectivity) affect **Remote Control**, **prompt suggestions**, **workflows tool**, and **permission feature flags** ([#54595](https://github.com/anthropics/claude-code/issues/54595), [#57635](https://github.com/anthropics/claude-code/issues/57635), [#48774](https://github.com/anthropics/claude-code/issues/48774)).

**Speculation:** Enterprise “managed path” doubles as **remote config + telemetry gate** ([#46204](https://github.com/anthropics/claude-code/issues/46204)) — increases blast radius when init fails silently.

### Data loss and safety

- Worktree auto-cleanup deleted uncommitted work: [#46444](https://github.com/anthropics/claude-code/issues/46444) — **Confirmed** — harness filesystem policies must be conservative.
- Post-compaction safety rules forgotten: [#28469](https://github.com/anthropics/claude-code/issues/28469) — **Confirmed** as user impact narrative.

---

## 7. Lessons for playground runner (10 actionable harness design rules)

Grounded in issues above; framed for **local lab**, not evasion.

1. **Separate ledger from transcript.** Resume from canonical message + tool-id state, not lossy JSONL parsing ([#52146](https://github.com/anthropics/claude-code/issues/52146), [#20508](https://github.com/anthropics/claude-code/issues/20508)) — aligns with HARNESS_VISION “Session DNA Ledger.”

2. **Compaction preserves runtime IDs, not only prose.** Inject active task/shell/subagent handles into pre-compact snapshot ([#60526](https://github.com/anthropics/claude-code/issues/60526), [#50015](https://github.com/anthropics/claude-code/issues/50015)).

3. **Re-load safety instructions after every compact.** Treat `AGENTS.md` / threat rules as **SessionStart-equivalent** post-compact ([#28469](https://github.com/anthropics/claude-code/issues/28469), [#57486](https://github.com/anthropics/claude-code/issues/57486)).

4. **Telemetry init must be loud.** Never swallow exporter failures; print `runner telemetry doctor` ([#46204](https://github.com/anthropics/claude-code/issues/46204), [#58439](https://github.com/anthropics/claude-code/issues/58439)).

5. **Document harness “modes” honestly.** If you add a privacy/offline mode, list **what behaviors change** (analogous to [#47558](https://github.com/anthropics/claude-code/issues/47558)) — no hidden gate side effects.

6. **Auth subsystem with refresh mutex.** One refresh in flight per credential store; surface 400 body ([#54443](https://github.com/anthropics/claude-code/issues/54443)).

7. **Headless (`-p`) contract tests.** Unique `tool_use` ids, no parallel tool dispatch unless API supports it ([#18131](https://github.com/anthropics/claude-code/issues/18131), [#20508](https://github.com/anthropics/claude-code/issues/20508)).

8. **Subagent inherits parent policy + rules.** Child runner gets copied allowlist + explicit rules path ([#51288](https://github.com/anthropics/claude-code/issues/51288), [#61467](https://github.com/anthropics/claude-code/issues/61467)).

9. **Degradation banner when tools missing.** If model returns no tools or registry empty, say “upstream/degraded” ([#60489](https://github.com/anthropics/claude-code/issues/60489)).

10. **Pin compatibility matrix in repo.** CLI version × resume × hooks × MCP auth — rerun golden tests on bump ([#34039](https://github.com/anthropics/claude-code/issues/34039), [#39271](https://github.com/anthropics/claude-code/issues/39271)).

---

## 8. Experiments to run in playground (safe stress tests)

| # | Experiment | Failure mode targeted | Success criteria |
|---|------------|----------------------|------------------|
| 1 | **Dual-runner refresh race** — two processes, shared cred dir mock | [#54443](https://github.com/anthropics/claude-code/issues/54443) | One wins refresh; other backs off; no corrupt token file |
| 2 | **Compact at 90% with ghost blocks** | [#50015](https://github.com/anthropics/claude-code/issues/50015) | User warning fires; tool_use ids stable in ledger |
| 3 | **Inject fake “active remote task” then compact** | [#60526](https://github.com/anthropics/claude-code/issues/60526) | Task id recovers from ledger metadata |
| 4 | **Post-compact safety re-read** | [#28469](https://github.com/anthropics/claude-code/issues/28469) | Deny matrix test still blocks `.env` after compact |
| 5 | **stream-json 20-turn tool loop** | [#20508](https://github.com/anthropics/claude-code/issues/20508) | No duplicate tool_use ids in outbound API payload |
| 6 | **Explorer subagent permission inherit** | [#61467](https://github.com/anthropics/claude-code/issues/61467) | Child cannot write when parent plan mode read-only |
| 7 | **OTel doctor with broken endpoint** | [#46204](https://github.com/anthropics/claude-code/issues/46204) | Non-zero exit + stderr hint (not silent) |
| 8 | **Simulate “tools registry empty”** | [#60489](https://github.com/anthropics/claude-code/issues/60489) | Runner stops with `degraded_upstream` stop_reason |
| 9 | **Resume after synthetic hook reinjection** | [#34039](https://github.com/anthropics/claude-code/issues/34039) | Hook counts/idempotent SessionStart |
| 10 | **Chaos permissions fuzz** (existing vision #12) | [#46444](https://github.com/anthropics/claude-code/issues/46444) | CI denies path escapes |

All experiments use **mock model client** or **read-only** prompts where possible — no bridge gateway required.

---

## 9. Open questions for Alan

1. **Telemetry stance for playground:** Full local traces only, or also experiment with OTLP to Grafana? (Issues suggest OTLP debugging is high-friction ([#46204](https://github.com/anthropics/claude-code/issues/46204)).)

2. **Compaction policy:** Do you want **user-visible 90% warning** in runner TUI, or automatic ghost compaction only?

3. **Subagents in playground:** Build **Explorer child process** (HARNESS_VISION #5) before or after **ledger** (#1)?

4. **Auth testing without bridge:** Is mock OAuth store enough, or do you want periodic **real** Claude Code CLI comparison runs outside playground?

5. **Issue tracking:** Subscribe to a **GitHub label watch** (`area:core` + `regression`) or periodic `gh search` script in `scripts/`?

6. **Promotion criteria:** Which harness fixes must pass in canonical `claude-local-bridge` before leaving `playground/local-runner-chaos`?

7. **Model-quality reports:** Treat [#28469](https://github.com/anthropics/claude-code/issues/28469)-style complaints as **out of scope** for runner, or build **instruction adherence evals** in lab?

---

## 10. Reference table — top relevant issues

| # | Title | State | Link | One-line takeaway |
|---|-------|-------|------|-------------------|
| 54443 | OAuth refresh 400 after early 401; concurrent sessions | OPEN | [issue](https://github.com/anthropics/claude-code/issues/54443) | Refresh race + server early revoke — harness needs mutex + clear errors |
| 60104 | macOS sleep/wake 401 until reboot | OPEN | [issue](https://github.com/anthropics/claude-code/issues/60104) | OS lifecycle breaks auth — don’t assume stable Keychain session |
| 58926 | 401 auth loop; /login also 401 | OPEN | [issue](https://github.com/anthropics/claude-code/issues/58926) | Total auth deadlock — need hard reset path in harness |
| 46204 | 3P OTel not initializing (silent) | OPEN | [issue](https://github.com/anthropics/claude-code/issues/46204) | Telemetry fails closed-silent — doctor command essential |
| 58439 | OTEL hook events dropped before logger init | OPEN | [issue](https://github.com/anthropics/claude-code/issues/58439) | Startup race — buffer or delay hook telemetry |
| 47558 | Docs: DISABLE_TELEMETRY gate side effects | OPEN | [issue](https://github.com/anthropics/claude-code/issues/47558) | Opt-out changes behavior, not just metrics |
| 29580 | DISABLE_TELEMETRY breaks remote-control | OPEN | [issue](https://github.com/anthropics/claude-code/issues/29580) | Feature flags coupled to telemetry pipeline |
| 60189 | Disabling telemetry hides /schedule | OPEN | [issue](https://github.com/anthropics/claude-code/issues/60189) | User-facing features hidden by telemetry off |
| 50015 | Auto-compaction without warning (regression) | OPEN | [issue](https://github.com/anthropics/claude-code/issues/50015) | Warn + persist before lossy compact |
| 60526 | RC task ID lost after compaction | OPEN | [issue](https://github.com/anthropics/claude-code/issues/60526) | Runtime state must survive compact |
| 46663 | Compaction silently deactivates plan mode | OPEN | [issue](https://github.com/anthropics/claude-code/issues/46663) | Mode flags are harness state, not chat text |
| 28469 | Opus 4.6 regression: loops, memory loss | OPEN | [issue](https://github.com/anthropics/claude-code/issues/28469) | Post-compact rule loss is safety-critical |
| 60489 | Core tools missing during backend degradation | OPEN | [issue](https://github.com/anthropics/claude-code/issues/60489) | Show degradation banner; don’t spin silently |
| 18131 | tool concurrency 400 in `-p` only | OPEN | [issue](https://github.com/anthropics/claude-code/issues/18131) | Headless path differs — separate tests |
| 20508 | duplicate tool_use ids with `-p` | OPEN | [issue](https://github.com/anthropics/claude-code/issues/20508) | ID generation must be harness-owned |
| 51288 | Subagent permissions don’t propagate | OPEN | [issue](https://github.com/anthropics/claude-code/issues/51288) | Child processes need parent policy copy |
| 61467 | Subagents skip .claude/rules | OPEN | [issue](https://github.com/anthropics/claude-code/issues/61467) | Rules injection mandatory for children |
| 52146 | Resumed session loses history | OPEN | [issue](https://github.com/anthropics/claude-code/issues/52146) | Transcript ≠ resume state |
| 33912 | --resume: no conversation found | OPEN | [issue](https://github.com/anthropics/claude-code/issues/33912) | File existence insufficient for resume |
| 53501 | Remote daemon codesign breaks Keychain ACLs | OPEN | [issue](https://github.com/anthropics/claude-code/issues/53501) | Auto-update can break credential access |
| 59460 | MCP OAuth re-runs DCR, orphans refresh | OPEN | [issue](https://github.com/anthropics/claude-code/issues/59460) | Stable client_id per server |
| 47754 | WAF blocks OAuth refresh on headless Linux | OPEN | [issue](https://github.com/anthropics/claude-code/issues/47754) | CI/remote runners need refresh strategy |
| 53638 | Desktop silently uses project API keys | OPEN | [issue](https://github.com/anthropics/claude-code/issues/53638) | Log which billing path is active |
| 54817 | 4.7 regression: context loss | OPEN | [issue](https://github.com/anthropics/claude-code/issues/54817) | Compaction + model change = double risk |
| 61068 | Resume overwrites 1M model setting | OPEN | [issue](https://github.com/anthropics/claude-code/issues/61068) | Resume must not clobber config |

---

## Methodology note

Searches run 2026-05-22 included: `telemetry`, `otel`, `oauth`, `401`, `keychain`, `compaction`, `context loss`, `subagent`, `DISABLE_TELEMETRY`, `billing usage`, and label scans. Comment counts and team responses change daily — re-verify critical issues before betting implementation priority.

**Anti-goals honored:** No guidance to spoof Claude Code traffic; focus is **reliability engineering for a local runner lab** aligned with [HARNESS_VISION.md](./HARNESS_VISION.md) and bridge/runner separation in the Anthropic letters.

---

*Generated for Alan’s playground harness planning — not an official Anthropic document.*
