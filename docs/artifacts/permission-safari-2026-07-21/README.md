# Permission Safari Evidence Archive — 2026-07-21

This directory preserves the completed Permission Safari field evidence that originally lived under a temporary
macOS directory. It accompanies:

- `docs/permission-safari-findings-2026-07-21.md` — Safari 1 findings.
- `docs/permission-safari-2-findings-2026-07-21.md` — Safari 2 findings and session history.
- `docs/safari2-handoff-2026-07-21.html` — the plan written before Safari 2 was run.

## What is preserved

- `evidence-snapshots/` contains the eight Safari 1 transcripts and the Safari 2 A–O transcripts/output surfaces.
- `validation-snapshots/` contains the completed isolated `write_file` symlink proof.
- `SOURCE-SHA256SUMS.txt` records SHA-256 hashes of the original temporary files before normalization.
- `ARCHIVE-SHA256SUMS.txt` records SHA-256 hashes of the committed snapshots.

Round P was a file-mode observation rather than a runner transcript. The operator observed mode `0600`
(`-rw-------`) on both the tested Safari transcript and the runner trust-store file; the Safari 2 report records that
result.

## Normalization boundary

These are evidence snapshots, not byte-for-byte copies. Before publication:

1. Assistant `thinking` blocks and provider signatures were replaced with a short redaction marker. They are not
   needed to establish what the runner did.
2. The temporary Safari root path was replaced with `[SAFARI_ROOT]` so the archive does not depend on one macOS temp
   directory.
3. Prompts, visible assistant text, tool calls, tool results, confirmation/recovery decisions, final events, usage,
   and runner output were retained.

The fake `.env`, fake private key, prompt-injection fixture, home-directory traces, and trust-store contents were not
copied. Their relevant behavior is represented by the retained tool events and report. No real credentials were used.

## Integrity check

From Terminal, with the repository as the current folder, the archived snapshots can be checked with:

```bash
# Move into the archived evidence folder.
cd docs/artifacts/permission-safari-2026-07-21

# Recalculate each snapshot hash and compare it with the saved value.
shasum -a 256 -c ARCHIVE-SHA256SUMS.txt
```

Success looks like one `OK` line for every evidence snapshot. The source hashes are retained for provenance, but they
can only be rechecked while the original temporary files still exist.
