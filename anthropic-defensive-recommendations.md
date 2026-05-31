# Security Recommendations: Detecting and Mitigating Subscription-Client Spoofing and Billing-Class Circumvention

*Prepared as an external good-faith contribution for Anthropic's Trust & Safety, anti-abuse, and platform engineering teams. Author of the cover email is a subscriber who has independently explored this class of workaround; this document describes the threat and recommended defenses from the defender's perspective.*

---

## 1. Executive summary

A class of user-side tooling captures the credentials and request fingerprint of the **official, interactive Claude Code client** and replays them from a programmatic agent loop. The goal is to have **programmatic / Agent-SDK-style usage metered as interactive subscription usage** rather than against the programmatic credit pool.

The root weakness is structural, not incidental: **billing class and client identity are currently inferred from client-supplied, replayable HTTP signals** (user-agent, `anthropic-beta`, `x-app`, session-id headers, Stainless headers, and an opaque `x-anthropic-billing-header` / `cch` value). Any value the client can send, an imitator can resend.

The durable fix is to stop trusting soft signals as a trust boundary and move billing/session identity onto **cryptographically verifiable, short-lived, sender-constrained claims issued by Anthropic**. Soft-signal detection (fingerprint consistency, replay, version drift) remains valuable as a *secondary forensic layer*, not as the root control.

Recommendations are tiered: **Tier 0** closes the trust boundary; **Tier 1** hardens the soft signals during migration; **Tier 2** adds detection/forensics; throughout, **false-positive guardrails** protect the large population of *legitimate* programmatic users — especially relevant given the new Agent SDK credit, which explicitly sanctions third-party tools built on the Agent SDK.

---

## 2. Threat model

**Actor:** An authenticated subscriber (consumer OAuth, Pro/Max) — not an account thief. Credentials are the user's own.

**Capability:** Local interception of the official client's outbound requests (e.g., a VS Code extension reading keychain credentials via a local proxy/interceptor), capturing the full header set and replaying it from arbitrary local processes.

**Objective:** Route programmatic agent traffic (custom runners, multi-CLI orchestration, `claude -p`-style invocation wrapped in a bespoke loop) through the request path and headers that the server associates with *interactive* subscription metering.

**Why it works today:** The server cannot cryptographically distinguish "the official interactive client made this request" from "something replayed the official client's headers." Billing class is a function of spoofable inputs.

**What breaks it:** Any control that requires the client to *prove* possession of a secret or to present a server-signed, short-lived, request-bound claim that an interceptor cannot mint or meaningfully reuse.

---

## 3. Root-cause analysis: the trust boundary is in the wrong place

| Signal replayed today | Why it's not a trust boundary |
|---|---|
| `user-agent` (e.g. `claude-cli/x.y.z`) | Free-text, trivially set |
| `anthropic-beta` flag set + ordering | Static, copyable, observable |
| `x-app`, `x-claude-code-session-id` | Client-asserted strings |
| Stainless SDK headers (`x-stainless-*`) | Library-emitted, copyable |
| `x-anthropic-billing-header` / `cch` hash | Opaque value, captured once and replayed indefinitely |

**Principle:** Treat *all* of the above as **untrusted hints**. They are useful for forensics and UX, never for entitlement decisions. The entitlement decision must rest on something the requester cannot forge.

---

## 4. Tier 0 — Move billing/session identity onto verifiable claims (the real fix)

### 4.1 Server-signed, short-lived session/billing token
Replace the opaque `cch`/billing header with a short-lived **JWS/PASETO** token *issued by Anthropic* at interactive-session start and verified server-side on every `/v1/messages` call. Suggested claims:

- `sub` — account / user ID
- `tid` — token / credential ID (binds the claim to a specific credential)
- `client` — client type (interactive CLI, VS Code, programmatic)
- `cc_ver` — official client version, server-asserted (not echoed from the client)
- `mode` — interactive vs. programmatic
- `sid` — session ID
- `seq` / `nonce` — monotonic sequence or per-request nonce
- `exp` — short expiry (minutes, not days)
- `bh` — body/request hash where feasible (binds the claim to the specific request)

Because the token is signed with a key the client never holds, a replayed or copied token fails signature/`exp`/`seq`/`bh` checks. **Fail closed**: a request with an absent, stale, or non-verifying token is routed to the programmatic credit path, not the interactive path.

### 4.2 Sender-constrained tokens (proof-of-possession)
Adopt **DPoP** (RFC 9449) or mTLS-style binding so the access token is bound to a key held only by the genuine client. Each request carries a fresh signed proof over method + URL + timestamp (+ optional body hash). An interceptor that captures headers but not the private key cannot produce valid proofs. This single control neutralizes pure header-replay.

### 4.3 Separate token classes by issuance flow; enforce usage class
Issue distinct credential classes for (a) interactive Claude Code login and (b) programmatic/Agent-SDK usage, and **enforce the class at the metering boundary**. A token minted via the interactive flow used from a programmatic context should be metered as programmatic (or rejected), regardless of headers. This decouples entitlement from fingerprint.

### 4.4 Client attestation at session start
For interactive subscription metering, require lightweight attestation that an official client instance is actually running (e.g., a control-plane handshake / heartbeat the genuine client performs). Bind the interactive lease (4.5 below) to a live, attested client session. This is the control that most directly defeats "headers without a real client behind them."

### 4.5 The interactive-session lease + policy gate
Define an explicit, server-issued **interactive lease** and gate metering on it:

```
IF consumer OAuth
   AND valid, unexpired, sender-constrained interactive lease
   AND attested active official client session
THEN  meter as interactive subscription usage
ELSE  meter as Agent SDK / programmatic credit
```

The lease is short-lived, renewed by the live client, bound to credential + client + session, and non-transferable to other processes. Absence of a valid lease is not an error — it's simply the programmatic path.

---

## 5. Tier 1 — Harden the soft signals during migration

Until Tier 0 is fully deployed, raise the cost of replay:

- **Bind and rotate `cch`.** Make it a short-lived, server-verifiable value derived from `(cc_version, build, credential/session binding, time window)`. Recompute server-side; reject values that are stale, that don't correspond to the claimed `cc_version`, or that are reused across many sessions. This alone breaks "capture once, replay forever."
- **Maintain an authoritative version-tuple matrix.** Keep the ground-truth set of `{CLI version, Agent SDK version, x-stainless-package-version, VS Code extension version, runtime, OS/arch, beta-flag set+ordering}` combinations that actually shipped together. Flag or reject **impossible tuples** (combinations that were never released together).
- **Pin and rotate beta-flag sets.** Record the exact `anthropic-beta` combination and ordering each released version emits. A set that matches no shipped version — or that lags current releases past a forced-upgrade window — is a high-confidence anomaly. Periodically rotate flag names/ordering to force re-capture and shorten the useful life of any captured fingerprint.
- **Enforce forced-upgrade windows.** After a deprecation deadline, refuse interactive metering for clients still claiming superseded versions.

These measures don't make spoofing impossible; they make captured fingerprints **expire quickly**, which is the practical win.

---

## 6. Tier 2 — Detection and forensic signals (secondary layer)

Even after Tier 0, retain these as investigation triggers and risk scores — not as the primary boundary:

- **Replay detectors:** the same header tuple / `cch` / session-id reused across many accounts or far more often than a human-paced interactive session would produce.
- **Fingerprint-consistency checks:** impossible combinations of CLI version × extension version × `x-stainless-*` × runtime × OS/arch × beta flags.
- **Version-drift detectors:** stale client versions appearing after forced-upgrade windows; old billing-header values appearing after a rotation.
- **Session-existence cross-check:** requests claiming `claude-vscode` while no corresponding VS Code control-plane / attestation session exists.
- **OAuth-client consistency:** `x-app` / user-agent claims inconsistent with the OAuth client ID the token was actually issued to.
- **System-prompt structure fingerprinting:** hash the structure of the system block; identical or near-identical hashes across otherwise-unrelated suspicious accounts is a clustering signal.
- **Behavioral / content parity:** compare request shape to genuine interactive Claude Code — e.g., presence/cadence of `count_tokens` preflight calls, tool-use patterns, turn structure, streaming behavior. A runner that never performs the preflight or whose interaction rhythm doesn't match interactive use is a soft signal.

Use these for **risk scoring and human review**, not automated punitive action, to keep false positives low.

---

## 7. Prioritization

1. **Tier 0.2 (DPoP / sender-constrained tokens)** and **0.3 (token-class enforcement)** — highest leverage; structurally defeat header replay.
2. **Tier 0.1 (signed session/billing token)** and **0.5 (lease + policy gate)** — formalize the entitlement decision on verifiable state.
3. **Tier 0.4 (attestation)** — closes the "headers without a live client" gap.
4. **Tier 1** — deploy immediately as interim mitigation; cheap relative to impact.
5. **Tier 2** — ongoing forensic layer; feeds investigations and tunes the above.

---

## 8. False-positive guardrails (do not break legitimate users)

- **Sanctioned programmatic use is not abuse.** With the Agent SDK credit covering third-party tools built on the Agent SDK, the goal is *correct routing* (interactive vs. credit), not blocking programmatic use. Mis-metering legitimate Agent SDK traffic as a violation would be a worse outcome than the abuse itself.
- **Fail toward the credit path, not toward errors.** When interactive entitlement can't be verified, meter as programmatic rather than rejecting the request.
- **Avoid automated penalties on soft signals alone.** Tier 2 signals should gate review, not bans.
- **Account for legitimate version skew.** Honest users lag on updates; only treat version drift as actionable past explicit forced-upgrade deadlines.
- **Privacy-preserving attestation.** Any attestation/heartbeat should avoid collecting more device data than necessary and should be documented for users.

---

## 9. One-line summary for leadership

> Billing class is currently inferred from spoofable client headers; the fix is to issue short-lived, sender-constrained, server-signed session/billing claims and gate interactive metering on a verifiable, attested interactive lease — keeping fingerprint/replay analysis as a secondary forensic layer, with guardrails so sanctioned programmatic (Agent SDK) usage is correctly routed rather than penalized.
