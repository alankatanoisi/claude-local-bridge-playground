# Retired runner profiles

This folder preserves the July 2026 implementation of agent profiles, file
agents, and capability profiles for historical reference only.

These files are deliberately stored as `.txt`, outside `src/` and the active
test glob. The runner no longer loads them, the CLI no longer advertises or
accepts `--agent`, `--profile`, `--list-agents`, or `--list-profiles`, and
subagents are now generic read-only workers with explicit tool lists.

Why they were retired:

- Profile defaults could conflict with granular flags and obscure which
  setting controlled actual authority.
- Profile fields mixed personality, context, permissions, step limits, and
  worker behavior, while several fields were decorative or only partially
  enforced.
- Explicit flags and a single `--tools` allowlist are easier to inspect,
  document, test, and keep monotonic.

The archived shapes may inform a future, separately designed library of
subagent prompt templates. They must not be copied back into runtime code
without a new authority model and end-to-end tests.
