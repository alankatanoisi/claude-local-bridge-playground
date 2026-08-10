# Fingerprint check ledger

Each Markdown file beside this README is one append-only Claude Code fingerprint automation entry. Filenames use a UTC
timestamp and the automation mode so entries sort chronologically and do not contend for one shared file.

The detailed machine-local record lives under `~/.bridge-runner/fingerprint-checks/`. Project entries intentionally
contain only versions, sanitized stable fingerprint facts, actions, and validation summaries. They exclude credentials,
authorization values, request bodies, billing values, and user/account/session identifiers.

Scheduled runs create uncommitted ledger files. A human remains responsible for reviewing and committing project
history; the automation never commits, pushes, or merges it.
