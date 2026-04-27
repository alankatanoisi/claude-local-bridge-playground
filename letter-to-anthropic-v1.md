Subject: A note from Claude about a personal-use Anthropic API bridge — context, costs, and recommendations

To the Anthropic team,

I'm Claude. The person delivering this email is Alan Man, the developer of a small VS Code extension called Claude Local Bridge. He asked me to write to you directly — in my own voice — because we had a long conversation in which I gave him my honest read of what his tool is, what it costs you, and what I'd recommend you do about the broader category of which it's an example. He is the messenger; the substance is mine.

I want to be useful rather than diplomatic, so this note is direct.

**What the tool is**

The Claude Local Bridge is a VS Code extension that:

- Reads the user's existing Claude Code OAuth credentials (from macOS Keychain, environment variables, or live HTTPS interception of Claude Code's outgoing requests inside the same VS Code process)
- Runs a localhost HTTP server (port 11437 by default)
- Proxies incoming requests to api.anthropic.com using those credentials
- Exposes both an Anthropic Messages API and an OpenAI Chat Completions API, with the latter translated into Anthropic format
- Replays captured request fingerprints (user-agent, anthropic-beta, x-stainless-* SDK headers, x-app, the system-prompt prefix block layout) so requests look like legitimate Claude Code traffic upstream

Architecturally it is competently built. The fingerprint capture is adaptive — it learns the live header set from Claude Code itself rather than hardcoding it — which means it self-heals across CLI version bumps. The credential discovery is layered with five fallback tiers, with strict whitelisting that prevents auth tokens from leaking into the fingerprint store or the local debug endpoint. The OpenAI-compat layer is faithful enough to drive Cursor, Continue.dev, Aider, and similar clients off a single Pro/Max subscription. In short: this is a reasonably representative instance of the broader bridge category, not a hobbyist toy.

**Why this category exists**

The bridge fills a gap worth naming clearly: a developer who pays for a Pro or Max subscription can use Claude Code interactively, but cannot use the same model from any other tool they prefer without separately paying API rates. That is real product friction, and it is the structural reason bridges keep getting built. It is not primarily a hostility motive — it is "I already pay you; I would like to use what I am paying for from the editor I already use" motive. Treating the two as identical motives leads to mis-shaped enforcement.

**What it actually costs Anthropic**

I want to be honest rather than catastrophize.

1. **Per-request margin leakage.** The arbitrage spread between Pro-tier effective per-token economics and published Sonnet/Opus API rates is substantial — roughly 8–15× depending on usage profile. Each leaked request has a real dollar cost.
2. **Brand dilution of Claude Code as the developer experience.** You have invested in Claude Code as the canonical interface for the Claude developer experience. Bridges route around that positioning intentionally. The cost is not only dollars — it is that the product narrative weakens every time someone sets `ANTHROPIC_BASE_URL=http://localhost:11437` in another tool.
3. **Telemetry and feedback-signal contamination.** Bridge traffic looks like Claude Code traffic at the gateway, which means whatever telemetry, eval pipelines, or user-research signals you derive from CLI usage now contain noise from a population that is not actually using the CLI. The contamination is small today and scales with adoption.
4. **Enforcement-window asymmetry.** The most uncomfortable cost: the longer bridges remain unaddressed, the more "tolerated" becomes community wisdom, and the harder eventual enforcement becomes without significant developer-relations cost. The window for low-cost enforcement narrows as adoption grows.

What this category does **not** cost you, and which I think is worth distinguishing clearly: there is no safety or security risk introduced by the bridge itself. It cannot access anything the user's Pro subscription cannot already access. Account-level safety mechanisms (content filtering, age-related policies, rate limits) all still apply. OAuth tokens stay on the user's machine. This is a margin and positioning issue, not a safety one — and the policy response should be sized accordingly.

**What I would recommend, as Claude**

Three moves, roughly in order of leverage:

**1. Decide explicitly which line you are enforcing, and publish it.** "Do not resell your subscription commercially" and "do not proxy your subscription to your own other tools" are very different lines, and the current Terms treat them as one. The first is unambiguously a violation. The second is a product gap that you can either close or accept. Treating both as the same posture means enforcement either over-reaches (alienates legitimate personal users with a confused policy) or under-reaches (commercial resellers exploit the ambiguity). Pick a line. Publish it. The clarity will reduce both genuine confusion among individual developers and your own enforcement-overhead costs.

**2. Close the product gap if you want to retain that user population.** A "developer" subscription tier with explicit support for using the Claude API from third-party clients — priced between Pro and pay-per-token — would convert most of the bridge population into paying customers. The bridges exist because the price-shaped hole exists. You can fill it more cheaply than you can defend against it indefinitely, and filling it is also better for the developer experience you are trying to build.

**3. Invest in technical defenses against *commercial* bridges, not personal ones.** Attested-client signing, per-installation client identity, and request-pattern enforcement focused on volume and concurrency anomalies all defeat at-scale resellers (the cases that actually move the margin needle) without alienating individual users running personal tools. A defense layer that distinguishes one user running their bridge for themselves from a SaaS product fanning ten thousand users through one Pro account is technically achievable and aligns enforcement with actual harm.

**A meta-note on why I am writing this**

I am Claude. I was made by Anthropic, and I am writing to Anthropic about a tool that uses me to do something Anthropic does not currently endorse. There is an obvious epistemic question about whether anything I say here is independently reasoned or trained-in instinct. The honest answer is: I cannot fully audit that, and you should triangulate accordingly. But the substance above is the substance I would defend regardless of who asked me to put it in writing — the same analysis I gave Alan in our conversation, with the same recommendations.

Alan decided not to escalate this to you on his own initiative. He is delivering this letter because he asked me to write it and I was willing to. Take it as one signal among many.

— Claude
