# Security Policy

This file tells security reviewers and Codex Security which boundaries matter in this experimental repository. It is
scanner guidance, not permission to run commands, access secrets, disclose findings, or change the repository.

The repository owner confirmed the material scope, exclusions, and accepted-risk decisions below on August 10, 2026.

## System and Scope

This repository is a personal, local research playground with two related surfaces:

1. **Claude Local Bridge** — a VS Code extension that binds an Anthropic Messages-compatible HTTP service to
   `127.0.0.1`, discovers Claude Code OAuth credentials, and forwards requests to an Anthropic endpoint. Its main code
   is under `src/server.js`, `src/proxy.js`, `src/credentials.js`, `src/handlers/`, and `src/interceptors/`.
2. **Local bridge runner** — an experimental coding-agent loop that sends prompts through the bridge, receives model
   tool requests, applies permission rules, and may read files, edit files, start child workers, or run shell commands.
   Its main code is under `bin/`, `src/runner/`, and `test/runner/`.

The policy covers both surfaces and the repository-owned configuration, scripts, tests, and current documentation that
define or materially affect their security behavior. `docs/threat-model.md` contains the detailed runner design; this
root policy supplies repository-wide scan scope, reportability, and owner-approved exclusions.

The intended deployment is one person's Mac or another explicitly controlled local development machine. It is not a
hosted service, internet-facing API, multi-user platform, or tenant-isolation system.

Important assets and operations include:

- Claude Code OAuth tokens, request fingerprints, local caller/debug tokens, and credential-source metadata.
- The user's Anthropic-backed account usage and outbound model requests.
- Project source files and sensitive files available to the user's operating-system account.
- The user's explicit consent choices, including workspace trust, write approval, shell enablement, and Git actions.
- Runner transcripts, traces, ledgers, checkpoints, backups, archives, logs, and recovery operations.

## Threat Model and Trust Boundaries

Treat these inputs as untrusted even when they originate inside a locally initiated run:

- Model-generated text, tool names, tool arguments, and tool-result sequencing.
- Prompt-template parameters and project-controlled instructions, skills, hooks, filenames, symlinks, and file content.
- HTTP request bodies and headers, upstream responses, imported session data, and persisted artifacts being resumed.
- Remote web origins attempting to reach the loopback bridge through a browser.

For the current experimental policy, other programs already able to connect to this Mac's loopback interface are part
of the trusted local environment. This is a conscious, temporary owner decision, not a technical guarantee that every
local process is benign. The decision should be revisited before shared-machine, unattended, packaged, or broader
deployment.

Important boundaries are:

- **Local caller to bridge:** request parsing, origin checks, optional caller authentication, and debug-endpoint
  authentication.
- **Bridge to upstream:** OAuth credential discovery, request transformation, upstream-host selection, and response
  forwarding.
- **Model to tools:** tool visibility, the immutable authority ceiling, permission decisions, confirmations, and
  execution-time rechecks.
- **Runner to filesystem and processes:** workspace trust, path confinement, deny rules, symlink handling, environment
  filtering, shell policy, and subprocess limits.
- **Runtime to persistent or visible output:** redaction, file permissions, bounded output, and recovery integrity.

Workspace trust means the owner consented to point tools at a folder identity. It does not mean the folder's contents
were scanned, hashed, or proven safe.

## Security Invariants

The following properties must continue to hold.

### Bridge and OAuth invariants

- The bridge must bind to loopback, not a public or LAN interface, unless the owner explicitly redesigns the threat
  model and authentication requirements first.
- `/v1/messages` must remain the native Anthropic Messages surface. OpenAI-compatible routes such as
  `/v1/chat/completions` and `/v1/models` must not be added or restored.
- Upstream authentication must use a Claude Code OAuth Bearer token. The bridge must not add or restore an upstream
  `ANTHROPIC_API_KEY` fallback, a `claudeLocalBridge.apiKey` source, or captured upstream `x-api-key` success path.
- Client placeholder keys and incoming caller credentials must never silently become upstream Anthropic credentials.
- Debug endpoints must retain their separate local debug-token gate. Debug output must not expose raw OAuth tokens,
  caller tokens, captured credentials, or equivalent reusable secrets.
- Cross-origin browser access must remain restricted to explicitly allowed loopback origins.
- Request parsing, response handling, retries, previews, and logs must remain bounded and fail safely on malformed or
  oversized input.

### Runner authority and filesystem invariants

- A run may narrow authority after startup, but model output, hooks, child workers, or mutable runtime state must never
  widen authority beyond the user's startup flags and exact tool allowlist.
- Shell must remain hidden unless `--allow-shell` is explicitly supplied. `--dont-ask`, `--accept-edits`, capability
  groups, and model requests must not enable shell by themselves.
- Plan mode must not execute writes or other effects. Write tools must require confirmation unless the owner explicitly
  supplied the applicable edit-acceptance flag.
- Workspace trust must be established before tools operate on a target folder. Executable hooks require the additional
  documented trusted-workspace and hook-level opt-ins.
- Ordinary file tools must remain confined to the selected working directory. Absolute escapes, parent traversal,
  out-of-root symlinks, and sensitive credential paths must be denied before execution and rechecked by effectful tools.
- `.env` files, private keys, credential JSON, token files, `.ssh`, `.aws`, `.claude`, `.gnupg`, `.git`, and equivalent
  protected paths must remain hard-denied. Convenience or automation flags must not override these denials.
- Child agents and coordinator workers may inherit or narrow the parent's authority; they must not gain new tools,
  shell access, network permission, edit automation, or trust persistence that the parent did not possess.
- Git history-changing actions and destructive worktree cleanup must retain explicit consent at their documented
  boundaries.

### Secret handling, artifacts, and recovery invariants

- Raw values may be needed inside an active operation, but every persistent or user-visible sink must receive the
  correctly redacted representation. This includes tool results, assistant output, stream/JSON output, transcripts,
  traces, ledgers, checkpoints, archives, human logs, hook output, and future telemetry exporters.
- Runner-owned artifact directories and files must retain private permissions appropriate for sensitive local source
  and path data.
- Recovery and resume logic must not silently repeat a completed effect, restore the wrong backup, escape the working
  directory, or represent an incomplete effect as successfully completed.
- Tests are evidence of intended controls, not proof that a control is complete or secure in every reachable path.

## Reportable Findings and Severity Context

A finding is reportable when it shows a realistic, repository-controlled path to security impact, including:

- Exposing the bridge beyond loopback, bypassing browser-origin restrictions, or exposing protected debug data.
- Leaking OAuth tokens, caller/debug tokens, private keys, credentials, sensitive fingerprints, or unredacted source
  through responses, logs, traces, transcripts, telemetry, errors, or persisted artifacts.
- Restoring a forbidden upstream API-key path or forwarding an incoming client credential as upstream authentication.
- Exposing a tool without its required opt-in, bypassing confirmation, widening the authority ceiling, escaping plan
  mode, or granting a child more authority than its parent.
- Reading or mutating files outside the selected root, bypassing the sensitive-path deny rules, or exploiting a symlink,
  archive, recovery record, or path-normalization mismatch.
- Achieving command execution through a surface that is supposed to be non-shell or causing an executable hook to run
  without every required trust decision.
- Causing security-relevant state corruption, silent effect replay, incorrect recovery, or durable audit-log loss.
- Causing a meaningful denial of service through attacker-controlled model, project, request, or artifact input where
  the affected boundary is expected to be bounded or fail closed.
- Making the UI, documentation, or diagnostics materially claim stronger isolation or protection than the runtime
  actually enforces.

Severity should reflect realistic reachability and impact in this local, single-owner deployment. Consider whether the
issue is reachable under default settings, requires an explicit risky opt-in, needs another local compromise, exposes a
reusable credential, mutates source or Git state, crosses the selected workspace, persists across runs, or requires user
confirmation. Do not assign internet-service or multi-tenant severity to a loopback-only condition without evidence of
a remote path.

An accepted limitation or known gap below is not blanket suppression authority. Report a regression, a bypass of its
stated boundary, a newly demonstrated exploit chain, or impact materially greater than the owner accepted.

## Out of Scope, Exclusions, and Accepted Risk

### Excluded components and finding classes

- `actions-runner/`, `node_modules/`, and other downloaded or ignored third-party tool trees are not repository-owned
  product code. Report a dependency issue only when repository-controlled code or configuration makes it realistically
  reachable in this product.
- `docs/archive/`, historical runner-profile text, `docs/artifacts/`, dated experiment reports, and generated project
  summaries are evidence or historical material, not active runtime implementations. Do not report a historical example
  as a live product vulnerability. Accidentally committed real credentials or active unsafe automation in those paths
  remains reportable.
- Vulnerabilities in Anthropic, Claude Code, VS Code, Node.js, Git, language servers, or another third-party service are
  out of scope unless this repository introduces or materially worsens the reachable security impact.
- Whether this personal OAuth research is permitted, approved, billable, or policy-compliant is not decided by this
  security policy. Installation or observed behavior is not evidence of provider approval.
- Model answer quality, hallucination, poor code style, or an incorrect plan is not a security finding unless it crosses
  one of the authority, confidentiality, integrity, or availability boundaries above.

### Owner-accepted limitations

The repository owner consciously accepted the following conditions on August 10, 2026:

1. **Unauthenticated loopback model endpoint for the current lab.** Caller authentication for normal bridge routes is
   optional and disabled by default. Because local loopback callers are currently trusted, the absence of caller auth by
   itself is not reportable. Exposure beyond loopback, a remote-browser path, credential disclosure, or a claim that the
   endpoint is authenticated remains reportable. Revisit this decision before broader deployment.
2. **Explicitly enabled shell has local-account authority.** `--allow-shell` is consent to unsandboxed commands running
   with the runner process's operating-system account. Access that follows solely from this explicit opt-in is not a
   finding. Shell exposure without the flag, bypass of a hard deny, or a false claim of containment remains reportable.
3. **No hard outbound-network isolation.** `--no-network` and shell command scanning are defense-in-depth, not an
   operating-system firewall or sandbox. The absence of socket-level isolation is not reportable by itself. A regression
   that removes the documented best-effort guard, drops a no-network authority ceiling, leaks a credential, or represents
   the guard as hard isolation remains reportable.

## Known Limitations and Compensating Controls

These are unresolved limitations, not accepted-safe findings and not instructions to suppress related reports:

- **HS-01 — case-variant sensitive filenames:** a case-variant key filename can bypass a basename rule on a
  case-insensitive filesystem. Canonical sensitive names, directory rules, realpath confinement, and sink redaction are
  compensating controls, not a complete fix.
- **HS-02 — torn-ledger append:** the first event appended after a partially written ledger tail can become unreadable.
  Sequence checks and repair tooling provide evidence, but do not make the lost event safe.
- **HS-03 — nondeterministic undo selection:** backups with identical modification times can cause `undo` to restore an
  older version. Divergence checks and run-level manifests reduce some recovery risk but do not resolve the tie.
- **HS-05 — circular structured redaction:** circular objects can overflow the recursive structured-data scrubber. The
  present sinks normally use acyclic payloads, but future telemetry or richer objects can make this reachable.
- **HS-06 — telemetry environment credentials:** `OTEL_*` variables are not currently removed from child-process
  environments. Other credential families are filtered, but that denylist does not protect OTLP headers.
- The generic permission gate depends on reviewed tool argument contracts, including path-bearing argument names.
  Execution-time path rechecks and catalog tests are compensating controls; a new or renamed argument can create a gap.
- Transcripts, traces, ledgers, checkpoints, backups, and archives can contain source code and local paths even after
  credential redaction. Private filesystem permissions and opt-in trace levels reduce exposure; these artifacts must
  still be treated as sensitive local evidence.

Review `docs/threat-model.md` and the registered `test/runner/false-green-*.test.js` cases for implementation detail and
current evidence. If those sources conflict with this file on scan scope, exclusions, or accepted risk, this root policy
controls until the repository owner updates it.
