# HS-01 follow-up — shell state between separate `bash` calls

> **Landed runner code, NOT yet Cursor-reviewed · 2026-11-12 · Fable (Claude Code), Alan-directed.** Treat the claims
> below as the author's own evidence until a Cursor invariant review confirms them. Everything was run on macOS with
> Bash 3.2.57; the Linux result comes from the GitHub checks on the pull request (a GitHub request to merge one branch
> into another) that carried this change, not from a local Linux run.

## 1. Outcome in one paragraph

The optional fast shell path (`BRIDGE_RUNNER_PERSISTENT_SHELL=1`, off by default) used to reuse **one** Bash process for
every `bash` tool call. State left by one permitted command therefore applied to the next one, and that got past the
shell scanner, which checks one command's text at a time. **Owner decision (Alan, 2026-11-12): every command now gets
its own pre-started Bash process, and a used process is never given a second command.** The start-up cost is paid between
commands, so the speed benefit stays.

This is a follow-up to HS-01 (the case-variant sensitive-path correction merged in pull request #33 on 2026-11-04). That
pull request's security assessment said cross-call persistent-shell experiments had not been performed. This closes that
gap. It does not reopen any corrected HS-01 finding.

## 2. What was wrong (measured, not inferred)

Each row was sent as **separate** tool calls through both registry gates (`execute` and `executeForce`). The
one-command spelling of each row was already refused by HS-01.

| Earlier permitted call                    | Later permitted call        | Before this change (fast path on)   |
| ----------------------------------------- | --------------------------- | ----------------------------------- |
| `shopt -s dotglob`                        | `cat *rc`                   | protected `.netrc` fixture returned |
| `GLOBIGNORE=x`                            | `cat *rc`                   | protected `.netrc` fixture returned |
| `cd vault` / `pushd vault`                | `cat *`                     | protected `ID_RSA` fixture returned |
| `shopt -s extglob`                        | `cat vault/ID_@(RSA)`       | protected `ID_RSA` fixture returned |
| `unset` of the four proxy variables       | any command, `--no-network` | proxy setting gone for later calls  |
| `shopt -s nocaseglob` (already protected) | `cat vault/id_rs?`          | refused — scanner checks both cases |

With the fast path off (the default) none of these returned protected content. Only disposable temp-folder fixtures and
the synthetic text `DISPOSABLE_CROSS_CALL_MARKER` were used.

## 3. What changed

- `src/runner/tools/persistent-shell.js` — a process moves _waiting → running → retired_ and never back. `run()` takes
  the waiting process, and a single `settle()` exit point retires it and schedules the next one (`prewarm()`). Exit
  handlers clear the waiting slot only if they belong to the process in it. File, class, and environment-variable names
  still say "persistent" so existing configuration keeps working.
- `src/runner/tools/bash.js` — comment only.
- `test/runner/persistent-shell-cross-call.test.js` — new, 20 tests.
- `test/runner/persistent-shell.test.js` — the test that asserted "preserves shell variables across calls (the whole
  point of being persistent)" now asserts the opposite, on purpose; one new test proves the pre-start is real and is
  the process the next command uses.
- `README.md`, `docs/threat-model.md`, `docs/project-summary/claude-local-bridge-project-summary.html` — wording.
- `AGENTS.md`, `CLAUDE.md` — new test added to the "Protected paths" row of the Enforced Rule Table (mirrored);
  `CLAUDE.md` gained the pointer to this file.

## 4. Evidence

- New cross-call file on unchanged `main` (`2697354`): **9 pass, 11 fail** — the 11 are the rows in §2.
- Same file after the change: **20 pass**. Full `npm test`: see §6.
- Mutation check: putting a used process back into the waiting slot makes **13** tests fail; the file was then restored
  byte-for-byte.
- Timing, median of 40 `true` commands: default launcher about 10.5 ms; pre-started process about 0.7 ms (first call,
  nothing waiting yet, about 8 ms).
- Each cross-call test also (a) asks real `/bin/bash`, by filename only, whether carried state would reach the
  protected file, and (b) spies on `PersistentShell.prototype.run` to prove the fast path, not the fallback, served the
  call.

## 5. Not bugs (do not "fix")

- **Variables, `cd`, and `shopt` no longer survive between calls on the fast path.** That is the decision, and it now
  matches the default launcher. Do not restore carry-over for convenience.
- **The names still say "persistent".** Deliberate, to avoid churn in configuration and docs.
- **The cross-call tests fail loudly on a machine without `/bin/bash`** instead of skipping. Deliberate: a skip reports
  `ok` and would hide that nothing was tested.
- **`finalCallMayFallBack` in the split-case tests.** `@(...)` is a syntax error when extglob is off, Bash exits, and
  the runner retries with the default launcher. That is a safe outcome.
- **A used process is stopped with SIGTERM after a normal finish and SIGKILL after a timeout/overflow.** SIGTERM lets an
  idle Bash run its own exit cleanup; SIGKILL is for a command that had to be cut off.

## 6. Checks

Run from the T3 worktree with the main checkout's pinned ESLint 9.39.4 and Prettier 3.8.3 (the worktree has no
`node_modules`):

- `npm test` — 1,401 tests, 1,401 pass, 0 fail, 0 skipped, 0 todo (default mode, macOS).
- `eslint` over `bin/ src/ test/ scripts/`, `prettier --check`, `npm run check:docs`.
- Linux: GitHub checks on the pull request.

## 7. Left open on purpose (observed, not changed)

1. **A command that makes Bash exit runs twice on the fast path.** `echo ran >> log.txt; exit 0` wrote two lines: once
   in the fast path, once in the fallback retry. Pre-existing; a correctness issue, not a path-protection one.
2. **A command can misreport its own exit status** by printing the end-of-output marker itself. Its late output no
   longer reaches the _next_ call (fixed as a side effect), but its own result can claim success.
3. **Variable and function indirection inside ONE command** (`f=vault/ID_RSA; cat $f`) returns the fixture in the
   default mode too. That is the acknowledged "the scanner is not a complete shell parser" limitation in
   `docs/threat-model.md`, not a cross-call issue, and was not touched.

4. **One existing HS-01 test assumes the fast path is off.** Running the whole suite with
   `BRIDGE_RUNNER_PERSISTENT_SHELL=1` exported fails
   `allows Bash dollar-quoted scripts with the host shell and installed dash as outer parsers` (`expected 6, actual 0`):
   it counts launches through the default launcher. It fails identically on unchanged `main` (`2697354`), so it predates
   this change. Neither `npm test` nor the GitHub checks set that variable. Everything else passes in that mode
   (1,400 of 1,401).

Each of these needs an Alan decision before anyone builds toward it.

## 8. Pointers for the next agent

- Start with `test/runner/persistent-shell-cross-call.test.js`; its header explains every validity check.
- Cursor review target: the range that introduced this file. Check in particular the identity guard in `_spawn()`'s
  exit handlers, the `closed` flag (a pre-start scheduled before `shutdown()` must not start a stray process), and that
  `settle()` really is the only way a `run()` promise resolves after a process was taken.
