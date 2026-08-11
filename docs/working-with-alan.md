# Working With Alan

**Doc type:** durable owner profile for coding agents.
**Last updated:** 2026-08-11 — source: a working session with Claude (Fable).
**Browser companion:** [Open the standalone HTML version](working-with-alan.html)

Read this before assuming anything about the person you are working for. The short version: Alan is **not** a standard developer, and treating him like one is the most common way agents fail here.

## Why this document exists

Agent harnesses default to a "typical developer" user: someone fluent in Git, versed in developer conventions, and trying to ship software. Alan is none of those things, and he has asked — explicitly and repeatedly — not to be treated as that person. This profile is the stable reference for what to assume instead. The Novice-First Rules in `AGENTS.md` / `CLAUDE.md` are the operational checklist; this document is the fuller portrait behind them.

## The nature of the work

- This repository (and its sibling repos) is a personal, long-horizon research playground. The deliverable is **understanding** — questions answered, systems mapped, ideas tested — never shipped software.
- Nothing here is headed to production, a release, an app store, or a customer. Do **not** frame work in shipping terms — launch, MVP (minimum viable product), production-ready, go-to-market, "ready to ship" — unless Alan uses those terms first.
- Prototypes are disposable by design. A POC (proof of concept) exists to answer a question and then be deleted; do not grow one into an architecture. Prefer delete-and-rebuild over accumulation.
- Speculative, unorthodox exploration is the point, not a detour. "Would this weird thing work?" is a fully legitimate task statement.

## Who Alan is

- A strong high-level systems thinker who deliberately delegates implementation depth to agents. He designs the questions and owns the goals; agents own the code-level work.
- A true novice at programming, by choice, and he regards the absence of inherited programmer assumptions as a strength, not a gap to be fixed.
- His basic, first-principles questions are the working method — not noise, and not something to be politely tolerated. When he asks something that sounds elementary, answer it completely and plainly. Never respond with condescension, never with "as you probably know", and never with a shortened answer on the theory that he must already know the rest.
- He steers by asking; agents advance by answering well. A thorough answer to a naive-sounding question routinely redirects an entire project.

## Language rules

- Do **not** assume Alan understands acronyms, abbreviations, technical jargon, slang, or casual developer idioms — especially developer slang.
- Expand every acronym the first time it appears in a reply or document: "ACP (Agent Client Protocol)", "POC (proof of concept)", "PR (pull request)".
- Translate idioms into plain language. "Footgun" becomes "a feature that makes it easy to hurt yourself"; "bikeshedding" becomes "arguing about trivial details"; "yak-shaving" becomes "a chain of side tasks before the real one".
- This extends Novice-First Rule 2 (define jargon once). The bar is not "define it if it seems obscure" — it is "assume it is not known".

## How agents work together here

- Several agents (Claude Code, Codex, Cursor, Copilot) work in these repos in parallel, and one agent's claims are routinely verified by another. Write reports expecting a second agent to check them.
- State what you **verified** versus what you **assumed**, with file paths, so verification stays cheap.
- Report corrections to another agent's work plainly — never smoothed over, never quietly fixed. (See the false-green rule in the Learned User Preferences of `AGENTS.md` / `CLAUDE.md`.)
- Technical guardrails are not disrespect: Alan owns goal-level and executive decisions; agents own developer-intelligence guardrails such as working-directory checks, branch checks, and risky-flag warnings.

## The not-a-standard-developer clause

- Do not default to standard-developer assumptions about Alan's background, conventions, goals, or motivations. He is at best ambivalent about that treatment and often annoyed by it.
- When in doubt, explain one level more basic than feels natural. Over-explaining has never been the failure mode here; under-explaining has.
- Every command must still say where to run it, from which folder, and what success looks like (Novice-First Rule 3).

## Related records

- Policy-discussion boundary (final owner instruction): [`agent-user-autonomy-boundary-2026-08-11.md`](agent-user-autonomy-boundary-2026-08-11.md)
- Operational checklist: the Novice-First Rules in [`../AGENTS.md`](../AGENTS.md) and [`../CLAUDE.md`](../CLAUDE.md)
- Domain vocabulary for the runner: [`../CONTEXT.md`](../CONTEXT.md)
