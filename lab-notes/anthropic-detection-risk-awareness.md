# Anthropic third-party harness detection — risk awareness for the playground runner

**Audience:** Alan Man (beginner-friendly, technically serious)  
**Repo context:** `/Users/alanman/Developer/claude-local-bridge-playground` — experimental local runner harness; the VS Code bridge is transport/auth only.  
**Purpose:** Educational / defensive awareness — **not** a guide to evasion, bypass, fingerprint spoofing, or limit circumvention.  
**Last updated:** 2026-05-22

---

## Executive summary

- **Policy is now explicit and enforced:** Anthropic’s official docs state that Free/Pro/Max **OAuth** is for Claude Code and Claude.ai only; third-party products (including the Agent SDK when used as a separate harness) should use **API keys** from Claude Console or a supported cloud provider. Violations may be enforced without prior notice.
- **The best-documented April methodological study is dated April 9, 2026** (not 2025): independent researcher [@mrcattusdev](https://gist.github.com/mrcattusdev/53b046e56b5a0149bdb3c0f34b5f217a) used controlled A/B tests and concluded that a specific server-side block (“third-party apps now draw from your extra usage”) correlated with **system prompt shape**, not HTTP headers or TLS — but this is **community research**, not Anthropic documentation, and may be incomplete or already superseded.
- **Public incident reports cluster around Jan–Apr 2026:** OpenClaw/OpenCode/Hermes users reported OAuth failures, redirects to **extra-usage (pay-per-token) billing**, and account restrictions; several GitHub issues and news articles attribute enforcement to **OAuth client identity**, **request fingerprint mismatch**, and **missing Claude Code telemetry** — sources disagree on which signal dominates.
- **Billing surprises have two different mechanisms:** (1) **policy** — subscription OAuth used outside permitted surfaces; (2) **technical routing** — server responses that bill “third-party” traffic from **usage credits / API rates** instead of plan limits, even when authentication succeeds.
- **For the playground runner, the safe architectural stance is:** treat subscription OAuth + bridge replay as **high-risk and ToS-sensitive**; prefer **official Claude Code**, **sanctioned Agent SDK paths with the June 2026 credit pool**, or **explicit API-key billing** with cost observability — and **do not** depend on impersonating Claude Code traffic.

---

## Glossary (beginner-friendly)

| Term                     | Plain meaning                                                                                                                                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Harness**              | The software loop around the model: tools, permissions, prompts, session state, logging. Claude Code is Anthropic’s harness; OpenCode/OpenClaw/Hermes/your runner are third-party harnesses.                |
| **OAuth (subscription)** | “Log in with Claude” style tokens tied to Pro/Max billing — different from a **Console API key** (`sk-ant-api…`).                                                                                           |
| **Bridge**               | Local proxy (e.g. Claude Local Bridge) that forwards HTTP to `api.anthropic.com` using credentials found on the machine.                                                                                    |
| **Fingerprint**          | Observable request traits: headers (`User-Agent`, `anthropic-beta`, `x-stainless-*`), billing tags in the `system` array (`cc_version`, `cch=…`), prompt layout, tool schemas, session IDs, traffic timing. |
| **Client ID**            | OAuth app identifier issued at registration; Anthropic can tag tokens by which app performed the login (e.g. OpenClaw’s own client vs Claude Code’s).                                                       |
| **Extra usage**          | Pay-per-token credits / API-rate billing when plan limits don’t apply — users often discover this via error text about “third-party apps.”                                                                  |
| **Agent SDK**            | Anthropic’s library-grade agent API (`claude-agent-sdk`); officially supported, but **not** a blanket license to pipe subscription OAuth through arbitrary wrappers.                                        |
| **`-p` / headless**      | Non-interactive Claude Code mode; from **2026-06-15** it draws from a **separate monthly Agent SDK credit**, not interactive plan limits.                                                                   |

---

## What we will NOT recommend (anti-goals)

This document intentionally excludes:

- Instructions to **evade**, **bypass**, or **spoof** Anthropic detection (including swapping system prompts, forging `cch` hashes, or “perfect header” mimicry).
- Advice to **improve bridge fingerprint replay** or adaptive capture to avoid enforcement.
- **Bridge testing**, `localhost:11437` smoke tests, or live credential experiments in this write-up.
- Framing **subscription arbitrage** (Pro/Max flat rate → heavy automation) as a neutral loophole; we describe it as a **documented policy and billing risk**.
- Treating **community reverse-engineering posts** as ground truth without labeling confidence.

If your goal is “make the playground indistinguishable from Claude Code,” that goal conflicts with current Anthropic policy and enforcement trends — reframe toward **permitted auth and explicit cost caps**.

---

## What is publicly evidenced vs rumor

| Claim                                                                                             | Status                                  | Notes                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Subscription OAuth may not be used in third-party tools / Agent SDK as a separate product surface | **Official**                            | [Claude Code legal & compliance](https://code.claude.com/docs/en/legal-and-compliance) (accessed 2026-05-22)                                                                               |
| Third-party harnesses with subscriptions are prohibited; API is the supported integration path    | **Official + executive statement**      | Thariq Shihipar (@trq212) thread cited in [The Register, 2026-02-20](https://www.theregister.com/software/2026/02/20/anthropic-clarifies-ban-on-third-party-tool-access-to-claude/5014546) |
| Server returns “Third-party apps now draw from your extra usage”                                  | **Evidenced (user reports + research)** | mrcattusdev gist (2026-04-09); Hermes patch README (2026-04-04)                                                                                                                            |
| Detection is **only** system-prompt classification                                                | **Community research, disputed**        | mrcattusdev (2026-04-09); contradicted by reporting emphasizing OAuth **client_id** and header spoofing                                                                                    |
| Valid `cch` + billing header makes requests “indistinguishable”                                   | **Unverified marketing/research essay** | [AGNT.gg article](https://agnt.gg/articles/claude-code-cch-billing-header-the-undetectable-spoof) — not Anthropic documentation                                                            |
| Anthropic staff told OpenClaw that Claude CLI reuse is “allowed again”                            | **Unverified / contradictory**          | [OpenClaw OAuth docs](https://docs.openclaw.ai/concepts/oauth) vs official legal page — treat as **rumor until published by Anthropic**                                                    |
| OpenClaw permanently “banned” all users                                                           | **Overstated**                          | Enforcement reports describe **token scope / billing routing** changes, not necessarily permanent account deletion ([issue #559](https://github.com/openclaw/openclaw/issues/559))         |
| April 2025 peer-reviewed study                                                                    | **Not found**                           | Closest match: **2026-04-09** gist by mrcattusdev                                                                                                                                          |

---

## Detection surface taxonomy

Confidence: **High** = official policy or repeated primary sources; **Medium** = multiple independent reports; **Low** = single community reverse-engineering claim.

| Signal                                                                                                  | What it may reveal                                                     | Confidence                        | Representative source                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OAuth client_id / token issuance metadata**                                                           | Which app registered the OAuth flow (Claude Code vs OpenClaw vs other) | High (policy); Medium (technical) | AGNT.gg analysis of Apr 2026 OpenClaw enforcement; [OpenClaw #559](https://github.com/openclaw/openclaw/issues/559)                                        |
| **Credential scope error**                                                                              | Token not authorized outside Claude Code                               | High                              | OpenClaw #559: “only authorized for use with Claude Code”                                                                                                  |
| **System prompt static block (~30k agent instructions)**                                                | Non-Claude-Code harness “shape” vs expected Claude Code prompt         | Medium                            | [mrcattusdev gist, 2026-04-09](https://gist.github.com/mrcattusdev/53b046e56b5a0149bdb3c0f34b5f217a)                                                       |
| **Billing header in `system[0]`** (`cc_version`, `cc_entrypoint`, `cch=…`)                              | Client version, entrypoint, attestation hash                           | Medium                            | Playground `src/credentials.js` comments; community RE docs                                                                                                |
| **HTTP headers** (`User-Agent`, `anthropic-beta`, `x-app`, `x-claude-code-session-id`, `x-stainless-*`) | Client family & SDK lineage                                            | Medium                            | [marco-jardim/opencode RE doc](https://github.com/marco-jardim/opencode-anthropic-fix/blob/HEAD/docs/claude-code-reverse-engineering.md); VentureBeat 2026 |
| **Request body schema**                                                                                 | Tool definitions, message roles, streaming options unlike Claude Code  | Medium                            | Shihipar: “unusual traffic patterns without … telemetry” (Register)                                                                                        |
| **Missing / mismatched telemetry**                                                                      | Support & abuse teams cannot diagnose rate-limit issues                | Medium                            | [The Register](https://www.theregister.com/software/2026/02/20/anthropic-clarifies-ban-on-third-party-tool-access-to-claude/5014546)                       |
| **Rate / concurrency / session patterns**                                                               | Automation farms, reseller proxies, 24/7 daemons                       | Medium                            | VentureBeat; Consumer ToS § automated access                                                                                                               |
| **TLS fingerprint (JA3/JA4)**                                                                           | Runtime stack (Node vs Bun vs Python)                                  | Low for API block studied         | mrcattusdev negative result (2026-04-09)                                                                                                                   |
| **IP / ASN / datacenter egress**                                                                        | Non-consumer hosting of subscription tokens                            | Low–Medium                        | General abuse-fighting pattern; not Anthropic-published                                                                                                    |
| **Model + beta feature combos**                                                                         | e.g. OAuth + unsupported beta flags → 400                              | Medium                            | [OpenClaw #60279](https://github.com/openclaw/openclaw/issues/60279)                                                                                       |

**Important:** Anthropic does not publish a complete detection spec. The table mixes **confirmed policy boundaries** with **inferred technical signals**. Any single signal may be necessary but not sufficient; enforcement likely combines several.

---

## The April study (verified date: 2026-04-09)

### What it is

- **Author:** [@mrcattusdev](https://github.com/mrcattusdev) (public gist, not Anthropic-affiliated).
- **Date:** Experiments run **2026-04-09** (gist created 2026-04-09, updated 2026-04-17).
- **Link:** [How Anthropic detects third-party clients: system prompt analysis, not headers or TLS](https://gist.github.com/mrcattusdev/53b046e56b5a0149bdb3c0f34b5f217a)
- **Secondary summary:** [Agent Wars news brief, 2026-04-10](https://agent-wars.com/news/2025-04-10-anthropic-system-prompt-detection) (note URL slug says 2025; body references April 2026 work).

There is **no** widely cited **April 2025** academic paper on this topic in public search results. If you meant 2025, the closest public material is **January 2026** enforcement discussion (Shihipar thread) and later **April 2026** technical write-ups.

### Method (high level)

Controlled isolation tests on an OpenCode + Anthropic Max setup:

1. **Headers hypothesis:** Send Claude Code request body with OpenCode headers → reportedly **200 OK**.
2. **TLS hypothesis:** Proxy TLS via Node to mimic Claude Code stack → still blocked when body unchanged.
3. **System prompt hypothesis:** Swap only the **static** portion of the large agent system block to match Claude Code’s static instructions, keep runtime sections (`<env>`, directories, skills) → reportedly **200 OK**. Custom static agent prompt → **400** with third-party billing message.

### Key findings (as claimed by the author)

- Detection for the tested error path behaved like **per-request content classification**, not account-wide ban.
- **Runtime** system sections (project context, AGENTS.md, env) appeared tolerated; **static** harness instructions did not.
- Author speculates **embedding/classifier** over prompt “shape,” not a single keyword.
- Author notes architectural fragility: same OAuth **client_id** as Claude Code for some plugins → prompt inspection may be a fallback when client IDs don’t separate harnesses.

### Critical caveats (for Alan)

- This is **one researcher’s setup** (OpenCode 1.3.15 + specific plugins, Windows, Max 20x).
- The gist includes bypass code samples; **this report does not reproduce them** and does not recommend acting on them.
- Findings may be **stale** (Anthropic can change classifiers weekly).
- Conflicting public narrative: other sources emphasize **OAuth client registration** and **billing header attestation** as primary levers — not mutually exclusive with prompt checks.

---

## Reported third-party harness incidents (careful attribution)

### OpenClaw

| Report                                                                                        | Source                                                                                            | Verified?                             |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------- |
| OAuth tokens rejected for external API use; error that credential is **only for Claude Code** | [GitHub openclaw/openclaw #559](https://github.com/openclaw/openclaw/issues/559)                  | Primary issue tracker                 |
| Bearer vs `x-api-key` header regression on 2026.3.28+                                         | [OpenClaw #60279](https://github.com/openclaw/openclaw/issues/60279)                              | Primary issue tracker                 |
| Apr 2026 enforcement allegedly keyed to **OpenClaw’s OAuth client_id** → extra-usage billing  | [AGNT.gg article](https://agnt.gg/articles/claude-code-cch-billing-header-the-undetectable-spoof) | Secondary analysis — **not** official |
| Docs claim Anthropic staff allowed CLI reuse again                                            | [OpenClaw OAuth docs](https://docs.openclaw.ai/concepts/oauth)                                    | **Unverified** vs official legal text |

### OpenCode

| Report                                                              | Source                                                                                                                                                                                                                                                  | Verified?                              |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Jan 2026 OAuth policy change broke Claude.ai login in OpenCode      | [DEV Community summary](https://dev.to/guayoyo_tech/opencode-vs-claude-code-real-threat-or-just-another-niche-alternative-a31); [Sulat.com timeline](https://ai.sulat.com/claude-code-cripples-third-party-coding-agents-from-using-oauth-6548e9b49df3) | Secondary; cites Jan 9 thread          |
| Ban report after OAuth + Max upgrade                                | OpenCode issue **#6930** (cited in Sulat.com)                                                                                                                                                                                                           | **User report** — not adjudicated here |
| Removed Claude Pro/Max subscription key support after legal request | [The Register, 2026-02-20](https://www.theregister.com/software/2026/02/20/anthropic-clarifies-ban-on-third-party-tool-access-to-claude/5014546)                                                                                                        | Journalism citing project commit       |
| Header spoofing to mimic Claude Code CLI                            | VentureBeat, Register                                                                                                                                                                                                                                   | Secondary                              |

### Hermes (NousResearch)

| Report                                                                                                   | Source                                                                                | Verified?                                                 |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `hermes-claude-auth` patch adds billing header + prompt structure after **2026-04-04** server validation | [kristianvast/hermes-claude-auth](https://github.com/kristianvast/hermes-claude-auth) | Author’s README — describes bypass; **we do not endorse** |
| HTTP 400 third-party → extra usage                                                                       | Same README                                                                           | User-facing error text                                    |
| OAuth refresh endpoints return Cloudflare 403                                                            | [hermes-agent #6347](https://github.com/NousResearch/hermes-agent/issues/6347)        | Primary issue tracker                                     |

### Anthropic / press statements

- **VentureBeat (2026):** “Tightened safeguards against spoofing the Claude Code harness” — [article](https://venturebeat.com/technology/anthropic-cracks-down-on-unauthorized-claude-usage-by-third-party-harnesses).
- **The Register (2026-02-20):** Legal clarification + Shihipar quotes on telemetry and support burden — [article](https://www.theregister.com/software/2026/02/20/anthropic-clarifies-ban-on-third-party-tool-access-to-claude/5014546).

**Takeaway for incidents:** Public evidence supports **disruption and billing redirection**, not a single uniform “ban hammer.” Outcomes vary by auth path, client registration, prompt shape, and time window.

---

## Billing / overcharge mechanisms: policy vs technical

### Policy layer (documented)

1. **Wrong credential type for product surface**  
   Using subscription OAuth in third-party tools or unsanctioned Agent SDK integrations violates [Consumer Terms](https://www.anthropic.com/legal/consumer-terms) as described in [legal & compliance](https://code.claude.com/docs/en/legal-and-compliance).

2. **Automated / non-human access rules**  
   Consumer ToS restricts automated access except via API key or explicit permission (Register cites §3.7 language unchanged since 2024).

3. **Plan limit semantics**  
   Pro/Max advertised limits assume “ordinary, individual” Claude Code + Agent SDK usage — not third-party resale or opaque proxy farms.

### Technical / product layer (observed in the wild)

1. **“Third-party apps” routing to extra usage**  
   Error copy tells users that traffic will draw from **usage credits** (API-like pricing) instead of subscription buckets — reported widely April 2026.

2. **OAuth client-based tagging**  
   Secondary analysis claims OpenClaw-specific tokens are labeled at issuance → billing pipeline can switch pools without detecting transport mimicry.

3. **June 2026 Agent SDK credit split (official)**  
   Starting **2026-06-15**, programmatic surfaces (Agent SDK, `claude -p`, GitHub Action, **third-party apps authenticating via Agent SDK**) draw from a **separate monthly dollar credit** ($20 Pro / $100 Max 5x / $200 Max 20x), not interactive limits.
   - Official: [Claude Help Center — Use the Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) (updated week of 2026-05-22).
   - Also noted on [code.claude.com legal page](https://code.claude.com/docs/en/legal-and-compliance).

4. **Client-side metering bugs (separate from detection)**  
   The [oksbk/claude-code-hidden-problem-analysis](https://github.com/oksbk/claude-code-hidden-problem-analysis) dataset documents **quota/cache accounting anomalies** in Claude Code itself — can feel like “overbilling” even without third-party harnesses. Worth distinguishing from Anthropic policy enforcement.

### Why users feel “double billed”

- Subscription **interactive** limits may look fine while **programmatic** traffic silently consumes **usage credits** or API-priced pools.
- Bridges make Cursor/Continue/etc. look like Claude Code upstream → user believes spend is “included” in Pro/Max.
- After June 2026, **`claude -p` and Agent SDK** may exhaust a **small fixed monthly credit** quickly under automation, then charge standard API rates if usage credits are enabled.

---

## How this maps to Alan’s stack (high level only)

Your playground separates:

```text
Editor / runner CLI  →  local bridge (auth + header capture)  →  api.anthropic.com
```

### Bridge layer (transport) — describe only

From `src/fingerprint.js` and `src/credentials.js`:

- **Live fingerprint capture** whitelists Claude Code headers (`user-agent`, `anthropic-beta`, `x-stainless-*`, `x-app`, session id, etc.) from intercepted VS Code traffic.
- For OAuth calls, the bridge can **prepend** Claude Code-style `system` blocks: billing tag (`cc_version…; cch=…`) + Agent SDK identity string, then user/system content.
- Comments already note `cch` may be **server-validated** and **rot**.

This is exactly the pattern public reporting calls “spoofing the Claude Code harness” — legally and technically sensitive, regardless of personal vs commercial intent.

### Runner layer (harness)

`bin/local-bridge-runner.js` + `src/runner/**` implement a **different** tool loop (permissions, local tools, transcripts). Even if the bridge reproduces headers faithfully, the **runner’s system prompt, tool schemas, and traffic shape** are not Claude Code — aligning with mrcattusdev’s finding that **harness content** may trigger third-party routing.

### Risk matrix for the playground

| Approach                                                                       | Detection / policy risk           | Cost predictability               |
| ------------------------------------------------------------------------------ | --------------------------------- | --------------------------------- |
| Official Claude Code (interactive)                                             | Lowest                            | Subscription limits               |
| `claude -p` / Agent SDK with **sanctioned** plan auth (post-2026-06-15 credit) | Medium — must be eligible surface | Credit cap + optional API overage |
| Console **API key** in runner (no OAuth replay)                                | Lowest technically                | Pay-per-token; clear invoices     |
| Subscription OAuth via bridge for third-party editor/runner                    | **High**                          | Poor — extra usage / enforcement  |

---

## Implications for the playground runner (harness-only guidance)

These recommendations stay on the **runner / workflow** side and deliberately avoid bridge hardening for mimicry.

1. **Prefer official surfaces for subscription value**  
   Use Claude Code (terminal/IDE) for Max/Pro “included” developer experience. Use the runner against **API keys** when you want a custom harness.

2. **If you need programmatic subscription access, plan for Agent SDK credits**  
   After 2026-06-15, budget the monthly Agent SDK pool separately; treat `claude -p` as metered, not “free with Max.”

3. **Instrument cost and classification early**  
   Log per-run: auth type (OAuth vs API key), HTTP status, error text (“third-party”, “extra usage”), model, and token usage. Your runner transcripts already support observability — extend human-readable logs with **billing class** when the API exposes it.

4. **Do not depend on impersonation**  
   Assume any path that relies on replayed Claude Code headers/prompt prefixes may stop working without warning.

5. **Separate experiments from production learning**  
   The playground branch exists for chaos/experiments; document outcomes as **lab notes** (like this file), not as production guidance for bridge users.

6. **Correspondence context**  
   `letter-to-anthropic-v1.md` / `v2.md` frame bridges as margin/positioning issues, not safety issues — useful for **policy thinking**, not as authorization to bypass technical controls.

---

## Questions for Alan to clarify

1. **Primary intent:** Personal learning only, or future sharing of the bridge/runner with others (which shifts toward commercial ToS risk)?
2. **Auth target:** Are you willing to standardize on **API keys** for runner development and reserve OAuth for official Claude Code only?
3. **Billing tolerance:** Is pay-per-token acceptable for harness experiments, or must spend stay within flat subscription?
4. **Agent SDK timeline:** Do you plan to use `claude -p` / Agent SDK after June 2026, and at what automation duty cycle?
5. **Observability:** Do you want runner logs to flag probable **third-party routing** errors automatically for teaching moments?
6. **Anthropic outreach:** Will you send the draft letters in-repo, or keep this internal until policy clarifies personal bridge use?

---

## References (with URLs and dates)

| ID  | Title                                                | URL                                                                                                                  | Date                                                     |
| --- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| R1  | Anthropic — Claude Code legal & compliance           | https://code.claude.com/docs/en/legal-and-compliance                                                                 | Accessed 2026-05-22; cites 2026-06-15 SDK billing change |
| R2  | Claude Help Center — Agent SDK with your Claude plan | https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan                       | Updated “this week” per page (May 2026)                  |
| R3  | mrcattusdev — Detection research gist                | https://gist.github.com/mrcattusdev/53b046e56b5a0149bdb3c0f34b5f217a                                                 | Created 2026-04-09                                       |
| R4  | Agent Wars — System prompt detection summary         | https://agent-wars.com/news/2025-04-10-anthropic-system-prompt-detection                                             | ~2026-04-10                                              |
| R5  | The Register — Anthropic clarifies third-party ban   | https://www.theregister.com/software/2026/02/20/anthropic-clarifies-ban-on-third-party-tool-access-to-claude/5014546 | 2026-02-20                                               |
| R6  | VentureBeat — Crackdown on harness spoofing          | https://venturebeat.com/technology/anthropic-cracks-down-on-unauthorized-claude-usage-by-third-party-harnesses       | 2026 (site date)                                         |
| R7  | OpenClaw — OAuth blocked external API (#559)         | https://github.com/openclaw/openclaw/issues/559                                                                      | Issue timeline 2026                                      |
| R8  | OpenClaw — Bearer header regression (#60279)         | https://github.com/openclaw/openclaw/issues/60279                                                                    | 2026-04-03                                               |
| R9  | Hermes — OAuth refresh Cloudflare 403 (#6347)        | https://github.com/NousResearch/hermes-agent/issues/6347                                                             | 2026                                                     |
| R10 | hermes-claude-auth README (third-party validation)   | https://github.com/kristianvast/hermes-claude-auth                                                                   | References 2026-04-04 change                             |
| R11 | AGNT.gg — CCH / billing header essay                 | https://agnt.gg/articles/claude-code-cch-billing-header-the-undetectable-spoof                                       | 2026 (secondary)                                         |
| R12 | oksbk — Claude Code hidden problem analysis          | https://github.com/oksbk/claude-code-hidden-problem-analysis                                                         | Dataset through 2026-04-16                               |
| R13 | Sulat.com — Jan 2026 OAuth timeline                  | https://ai.sulat.com/claude-code-cripples-third-party-coding-agents-from-using-oauth-6548e9b49df3                    | 2026                                                     |
| R14 | OpenClaw OAuth docs (conflicting allowance claim)    | https://docs.openclaw.ai/concepts/oauth                                                                              | Accessed 2026-05-22                                      |
| R15 | Playground — letter-to-anthropic-v1.md               | `letter-to-anthropic-v1.md` (repo)                                                                                   | Local draft                                              |
| R16 | Playground — letter-to-anthropic-v2.md               | `letter-to-anthropic-v2.md` (repo)                                                                                   | Local draft                                              |

---

## Document control

- **Branch/folder:** `claude-local-bridge-playground` / `main` (expected per AGENTS.md).
- **Checks:** None required (markdown lab note only).
- **Skipped:** Live API/bridge tests per user constraint.
