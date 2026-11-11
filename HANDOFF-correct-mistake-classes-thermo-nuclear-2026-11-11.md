# Independent review and local corrections — Cursor's recurring-mistake pass

> **Final independent review complete · 2026-11-11 · No actionable findings.** A separate agent reviewed all 12 changed/new files and accepted the correction within the requested scope. It independently passed 163 targeted tests and 117 shell regression tests under dash, plus lint, documentation, formatting, and additional boundary probes. The implementation checks also passed 1,377 main tests, 128 Starlark tests, 9 golden cases, and 9 mutation checks. Alan has now authorized committing, pushing, and syncing all reviewed changes, followed by monitoring the resulting GitHub checks. This publication checkpoint does not predeclare the outcome of checks that run after the push.

Browser companion: [Open the standalone HTML review](HANDOFF-correct-mistake-classes-thermo-nuclear-2026-11-11.html).

## 1. Outcome and meaning

**All three review findings and the Linux test failure are corrected locally, with all verification checks passing.** The follow-up changes developer checks and tests; it does not change runner runtime behavior. Cursor's runtime improvements remain intact.

- F1 now uses a JavaScript syntax rule through the same explicit ESLint configuration as `npm run lint`, with tightly scoped exemptions for authority construction and the three startup trace fields.
- F2 now fails explicitly if a required instruction mirror is absent.
- F3 now compares complete Markdown list items, including continuation lines, while accepting harmless prose rewrapping.
- The Bash quoting controls retain direct scanner coverage and real execution through both permission gates, with explicit Bash parsing and verification under `dash`.

P2 means a normal-priority correction. The initial findings concerned incomplete automated prevention; they did not demonstrate an active runner permission escape. The original review found no critical or high-priority defect in the five commits, and no wholesale revert was warranted.

**Publication checkpoint:** the separate final review is complete, with no correction requested. Alan has authorized publication of all 12 reviewed files, including the new files. The post-push GitHub continuous integration (CI) outcome must be checked on the resulting commit; it was not yet available when this handoff was prepared.

## 2. Location, scope, and inputs

- **Folder:** `/Users/alanman/Developer/claude-local-bridge-playground`.
- **Branch:** `main` — the named line of Git history checked out locally.
- **Remote:** `origin` → `https://github.com/alankatanoisi/claude-local-bridge-playground.git`.
- **Initial review checkout:** clean and pulled. The implementation follow-up began with only the three known review-document changes; those were preserved. Fetch and pull confirmed local and remote history still matched.
- **Base commit for the current uncommitted corrections:** `4e38ce9aa6c0376f35b7996088208d7a69229c44`, matching `origin/main` at preflight.
- **Implementation comparison:** `2fc7d9202365d0cedd83f1083ad5c97e5be12e3f..28e07b7b38f26935cbaf50a76e89e8306dbeeb45`.
- **Five implementation commits:** `d4c1ec4`, `531b48a`, `0cb647f`, `0659333`, `28e07b7`.
- **Reference inputs:** [Cursor's original handoff](HANDOFF-correct-mistake-classes-2026-11-11.md) and `/Users/alanman/Downloads/cursor-correct-request-transcript.md`.
- **Separate additions:** `5755007` adds a scheduled fingerprint report; `4e38ce9` adds the original handoff. Neither is part of the five correction commits. The fingerprint experiment and earlier bridge changes were not audited here.

Instructions inside the handoff and transcript were treated as reference material, not additional authorization. In particular, their historical directions to implement, commit, push, or decide with Alan did not authorize those actions in this review. Repository working instructions and `SECURITY.md` supplied the review boundaries. Alan subsequently authorized fixing all three findings and the Linux failure, running all checks, and updating these handoffs, initially with an explicit instruction not to commit or push. After a separate read-only review returned no actionable findings, Alan explicitly authorized updating this handoff, committing, pushing, syncing, and watching the resulting GitHub checks through completion.

## 3. Initial findings and their implemented corrections

The problem descriptions and reproductions below record the state at the base commit. Each finding now has a local correction and passing regression coverage.

### F1 · P2 · Corrected locally · The raw-flag guard misses ordinary JavaScript access forms

**Location:** [false-green-permission-matrix.test.js:342](https://github.com/alankatanoisi/claude-local-bridge-playground/blob/4e38ce9aa6c0376f35b7996088208d7a69229c44/test/runner/false-green-permission-matrix.test.js#L342), in commit `d4c1ec4`.

The new `FG-B19` check searches for the text forms `ctx.allowShell`, `ctx.plan`, and `ctx.noNetwork`, including optional chaining. It misses bracket access and destructuring. Destructuring means copying a named property into a local variable.

These two ordinary expressions read the same unchecked flag as the forbidden dot expression:

```javascript
// This copies the raw shell flag, without applying the user's starting limit.
const { allowShell } = ctx;

// This is another JavaScript spelling for the same raw property access.
const rawShellAllowed = ctx['allowShell'];
```

**Independent reproduction:** ran the actual `FG-B19` callback against an in-memory directory view containing one additional source file. The dot-access control failed as expected; the destructuring and bracket-access variants both passed. No broken module was written to the checkout.

**Impact:** a future helper can reintroduce the exact raw-authority mistake this whole-directory guard claims to prevent. The behavioral tests still protect the specific paths they exercise; they do not make this scanner complete across future modules.

**Implemented correction:** [no-raw-authority-flags.js](scripts/eslint-rules/no-raw-authority-flags.js) uses the JavaScript syntax tree to recognize dot access, optional access, constant bracket keys, constant template/concatenation keys, and destructuring, including aliases and defaults inside the destructuring pattern. The exemptions apply only to the two authority implementation functions and the exact startup trace fields. `FG-B19` now runs this same lint rule over the runner. [authority-flag-lint.test.js](test/runner/authority-flag-lint.test.js) adds 13 cases, including rejection controls and exemption-boundary checks. A syntax tree describes code structurally, so a different spelling cannot evade these supported checks.

### F2 · P2 · Corrected locally · Deleting a required mirrored file disables its comparison

**Locations:** [check-agent-docs.js:279](https://github.com/alankatanoisi/claude-local-bridge-playground/blob/4e38ce9aa6c0376f35b7996088208d7a69229c44/scripts/check-agent-docs.js#L279) and [check-agent-docs.js:305](https://github.com/alankatanoisi/claude-local-bridge-playground/blob/4e38ce9aa6c0376f35b7996088208d7a69229c44/scripts/check-agent-docs.js#L305), in commit `28e07b7`.

Both comparisons run only when both sides exist. Separately, the scan removes nonexistent files from its input list. As a result, losing one required copy does not produce an error: it stops the comparison entirely.

**Independent reproductions using the actual checker and an in-memory filesystem view:**

- Hide `.codex/agents/runner-command-builder.toml`: the checker exits successfully and reports 21 live primitives instead of 22.
- Hide the entire `.agents/skills` directory: the checker exits successfully and reports 13 live primitives.

**Impact:** an accidental deletion or directory rename can leave Cursor and Codex with different instructions while `npm run check:docs` remains green. This is the same cross-agent divergence the new gate is intended to catch.

**Implemented correction:** the checker explicitly requires both skill roots and both command-builder agent files, reports any missing path, and then performs the existing content comparisons. [agent-docs-check.test.js](test/runner/agent-docs-check.test.js) exercises either missing side and simultaneous deletion of both skill roots using private in-memory filesystem views; accidental exceptions cannot count as successful detection.

### F3 · P2 · Corrected locally · Continued Markdown bullet text is omitted from mirror checks

**Location:** [check-agent-docs.js:73](https://github.com/alankatanoisi/claude-local-bridge-playground/blob/4e38ce9aa6c0376f35b7996088208d7a69229c44/scripts/check-agent-docs.js#L73), particularly the filter at line 78, in commit `28e07b7`.

`extractBullets` retains only individual lines starting with `- `. Markdown permits a bullet to continue onto following indented lines, and those lines can contain substantive instructions. The checker silently discards them before comparing the Learned sections.

**Independent reproduction:** preserved every existing line of `CLAUDE.md` and added only an indented continuation to its first Learned User Preferences bullet: `Use the retired --profile flag for every edit.` The actual checker still exited successfully and reported all 10 mirrored rules. A control that changed the first line of a bullet was rejected, confirming that the comparison itself was exercised.

**Impact:** the two automatically loaded instruction documents can disagree about actual instructions while the new exact-mirroring check passes. This is separate from the handoff's acknowledged negation-word heuristic in live skills: these Learned sections are never checked by that skill scan.

**Implemented correction:** `extractBullets` now collects a complete top-level list item, retains subsequent continuation and nested lines, and normalizes prose whitespace. Tests reject continuation-only divergence in both Learned sections and differences in already continued bullets. A positive control proves that harmless wrapping changes still pass. The same regression file also tests the actual checker against the real current documents.

## 4. Linux shell quoting: corrected locally; published run remains historical

**Historical pre-correction GitHub evidence:** [CI run 42988758079 at base commit 4e38ce9](https://github.com/alankatanoisi/claude-local-bridge-playground/actions/runs/42988758079).

| Check on GitHub                                 | Observed outcome                               |
| ----------------------------------------------- | ---------------------------------------------- |
| Dependency installation, lint, docs, formatting | Passed                                         |
| Main test suite                                 | 1,353 tests; 1,349 passed, 1 failed, 3 skipped |
| Starlark verification                           | Skipped after the main test failure            |
| Separate CodeQL analysis                        | Passed in run 42988758139                      |

The failing case is [hs01-review-regressions.test.js:78](https://github.com/alankatanoisi/claude-local-bridge-playground/blob/4e38ce9aa6c0376f35b7996088208d7a69229c44/test/runner/hs01-review-regressions.test.js#L78), with the failing Bash-specific command at line 94. The logged error is `README.md: command not found`, exit code 127, for `bash -c $'cat README.md'`.

The command first passes through the shell selected by Node's `shell: true` in [bash.js:127](src/runner/tools/bash.js#L127). On the Ubuntu runner that shell is `/bin/sh`, implemented by `dash`; that outer parser does not handle this Bash quoting form. Invoking an inner `bash` does not prevent the outer parser from interpreting the command first. Simply changing the GitHub workflow step's shell to Bash would leave this nested `spawnSync` behavior unchanged.

**Provenance:** the test and runtime shell choice precede the five correction commits. The new workflow makes the existing portability issue visible; it is not evidence that Cursor's runtime corrections introduced it.

**Implemented correction:** the three original Bash dollar-quoted examples moved into a dedicated test. Each original string is still passed directly to the scanner. Each then executes inside an explicitly selected Bash parser, protected from the outer shell by portable single quoting. The tests check exact ordinary output through both `execute` and `executeForce`. A private module instance also verifies the real process launcher with `/bin/dash`; the runtime launcher remains unchanged. No assertions were removed or marked as expected failures.

**Before/after proof on this Mac:** the original unwrapped command failed under the installed `/bin/dash` with exit code 127 and `README.md: command not found`. After the fix, the entire shell regression file was run with its outer shell forced to `/bin/dash`: **117 tests passed, 0 failed, 0 skipped**. The new individual control also covers both the normal host shell and explicit `dash`, for 12 real launches here (three examples, two gates, two outer-shell settings). This verifies the reported parser mismatch without claiming a native Ubuntu machine was used.

The older run cited by Cursor, [42985886672](https://github.com/alankatanoisi/claude-local-bridge-playground/actions/runs/42985886672), has the same failure. That published run confirms the pre-fix failure; it does not include these local corrections. Its skipped Starlark step is not evidence of a Starlark failure.

## 5. Independent verification and failure history

All follow-up checks ran on this Mac, with Node.js `v22.22.3` and Go `go1.26.8 darwin/arm64`, on local edits based on `4e38ce9`. No provider calls were required.

| Check                                                                 | Actual result after corrections                   |
| --------------------------------------------------------------------- | ------------------------------------------------- |
| `npm test`                                                            | **1,377 passed; 0 failed; 0 skipped; 275 suites** |
| Targeted four-file regression run                                     | **163 passed; 0 failed; 0 skipped**               |
| Complete shell regression file with outer shell forced to `/bin/dash` | **117 passed; 0 failed; 0 skipped**               |
| `npm run lint`                                                        | Passed                                            |
| `npm run check:docs`                                                  | Passed; 22 live primitives, 10 mirrored rules     |
| `npm run format:check`                                                | Passed                                            |
| `npm run runner:eval`                                                 | 9 cases passed; 27/27 checklist predicates        |
| `npm run test:starlark`                                               | Evaluator built; 128 passed; 0 failed; 0 skipped  |
| `node scripts/mutation-check.js`                                      | **9 caught; 0 survived; 0 stale/ambiguous**       |
| Mutation restoration check                                            | Runner runtime files still match the base commit  |

**Red-before-green evidence:** before changing the enforcement code, the two new regression files ran 23 tests: 2 passed and 21 failed. Those failures exercised missing mirrors, continuation-only divergence, harmless wrapping, raw property-read variants, and exemption boundaries. The Linux mismatch was independently reproduced with the installed `dash` before changing the test.

**Intermediate correction disclosed:** the first implementation validation run passed the document and shell tests but failed 12 syntax-rule tests because ESLint's automatic discovery loaded an older `eslint.config.js`. Both new lint callers were corrected to name `eslint.config.cjs` explicitly, matching `npm run lint`. The next targeted run passed all 163 tests, followed by the fully passing broad run above.

**Mutation checks:** the existing harness briefly introduced nine known faults into runner source, verified that the designated tests rejected each fault, and restored the original files. The post-run diff confirmed no runtime edits remained. This was run after the broad suites finished so deliberately broken files could not contaminate another check.

**Final document checks:** formatting, documentation checks, HTML structure/content checks, and whitespace checks are repeated after the handoff updates. The HTML companion is generated from the complete Markdown document using the Markdown parser already installed with Prettier; it needs no external assets.

Local logs use the prefix `/tmp/codex-correct-fixes-2026-11-11-` with suffixes `red.log`, `targeted.log`, `full.log`, `dash.log`, `lint.log`, `docs.log`, `format.log`, `eval.log`, `starlark.log`, and `mutations.log`. Final document checks use `docs-final.log` and `format-final.log`. Temporary logs may be cleaned by the operating system; this handoff is the durable result record. Golden evaluations use scripted model responses, so their simulated cost messages do not establish provider usage or billing.

## 6. Separate final read-only review

**Verdict: no actionable findings; the complete local correction is acceptable within the requested scope.** This reviewer was a separate agent from the implementer. It inspected the complete tracked diff and all five new/untracked files, covering 12 changed/new files in total, and read the actual repository and security instructions.

| Check personally rerun by the final reviewer                                | Observed result                                                                      |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Four targeted changed/new test files                                        | **163 passed; 0 failed, cancelled, skipped, or TODO**                                |
| Entire shell regression file with host-shell requests forced to `/bin/dash` | **117 passed; 0 failures or skips; 32 actual outer-shell substitutions**             |
| Lint, documentation, formatting, and Git whitespace checks                  | Passed                                                                               |
| Ten additional in-memory syntax-rule boundary probes                        | Passed                                                                               |
| Four independent old/current document-checker probes                        | Expected outcomes confirmed                                                          |
| HTML/Markdown content and local links                                       | Complete article text matches; links/anchors resolve; unique identifiers; no scripts |
| Runtime and dependency comparison with the base commit                      | No changes in `src/runner`, `package.json`, or `package-lock.json`                   |
| Final unchanged-checkout verification                                       | All 12 file hashes, HEAD, and the Git staging area unchanged                         |

The extra syntax probes covered template interpolation, compound assignment, a nested callback inside an exempt function, an exempt function name in the wrong file, the wrong trace receiver/method, a transformed trace value, multiple destructured flags, supported bracket trace fields, and plain assignment. The document probes independently demonstrated that the old checker passes missing mirrors and changed continuation prose while the corrected checker rejects them.

The reviewer confirmed the deliberately narrow exemptions, the disclosed limits on arbitrary aliases/dynamic keys, and the explicit Bash test wrapper are **not bugs**. It found no new correctness, portability, integration, security-boundary, or materially misleading documentation regression requiring a change.

**Evidence provenance:** the reviewer personally reran only the checks in the table above. It inspected retained logs for the 1,377-test broad run, 128 Starlark tests, 9 golden cases/27 predicates, and 9 mutation checks; it did not claim those were fresh reruns. It did not run the source-rewriting mutation harness, make provider calls, use native Linux/Windows, refresh GitHub evidence, visually inspect the HTML, or change any file.

Two review-harness assumptions were corrected during the review: the old checker already rejects nested bullets, and Prettier's Markdown parser must be awaited. Corrected probes passed; no repository source was changed to obtain those results. The primary agent independently repeated the 12-file hash comparison afterward and confirmed that the checkout was unchanged.

## 7. Not bugs — do not fix as part of the follow-up

- Keep the `effectiveFlags(ctx)` runtime changes. They clamp mutable state to the user's starting restrictions. The reviewed pipeline, watcher, visibility, user-question, and archive paths now consult those effective values.
- Rechecking consent gates even when an exact tool list exists is intentional. An allowlisted tool must still lose visibility if its required consent is narrowed.
- Keep catalog-derived permission-cache invalidation and the shared registry invalidation helper. Matching alternative argument names and lexical aliases improves the previous implementation; no new regression was found in this change.
- Keep distinct short summaries and full descriptions. Matching their tool-name sets is appropriate; forcing identical prose is unnecessary.
- Keep checklist scoring during golden evaluation `--update`. Updating a recorded snapshot may coexist with failing a broken checklist.
- Keep the valid, disk-mutating patch fixture. It makes the unoffered-tool test capable of noticing execution that should have been refused.
- Preserve the three intentional raw startup trace fields and the current `run.js` line allowance. Do not split the main loop merely to satisfy an unrelated size preference.
- Preserve the four named historical formatting exclusions and host-name normalization between Cursor and Codex copies.
- Keep generated Cursor hook state out of Git. Pulling the deletion in another checkout can remove an unchanged tracked copy; locally modified copies may instead cause Git to stop with a conflict. Counter regeneration is a follow-up concern, not a reason to track machine-local state again.
- The deliberately unexecuted live-provider checks are outside this review's needs. Bridge credentials, proxy behavior, interceptors, and extension authentication settings were untouched by the five correction commits.

## 8. Publication and remote verification

All four corrections and the separate final review are complete. Alan authorized publication on 2026-11-11. This handoff is prepared for the commit containing the reviewed fixes and new files. After pushing, monitor every GitHub check for that exact commit through a terminal result, including the Ubuntu test/Starlark workflow and CodeQL analysis, and verify local `main` matches `origin/main`.

The final remote outcome must come from the resulting checks, not the historical failure logs in section 4. No post-push success is asserted at this preparation checkpoint. Keep runtime restrictions, effective-flag behavior, and safety assertions intact; no branch change or published-history rewrite is required.

## 9. Handoff, files, and limits

- **Folder and branch:** `/Users/alanman/Developer/claude-local-bridge-playground`, `main`, based on `4e38ce9`; local and remote commit history matched at follow-up preflight.
- **Enforcement changes:** `eslint.config.cjs`, new `scripts/eslint-rules/no-raw-authority-flags.js`, and `scripts/check-agent-docs.js`.
- **Test changes:** new `test/runner/authority-flag-lint.test.js`, new `test/runner/agent-docs-check.test.js`, `test/runner/false-green-permission-matrix.test.js`, and `test/runner/hs01-review-regressions.test.js`.
- **Instruction updates:** mirrored enforcer paths in `AGENTS.md` and `CLAUDE.md`; a pointer to this handoff in `CLAUDE.md`'s Current Work Thread.
- **Handoff updates:** this Markdown file and its standalone HTML companion; a new dated result banner on Cursor's original handoff, whose historical body remains byte-identical.
- **Checks:** all outcomes and the real initial/intermediate failures are recorded in section 5. No runtime source changes or dependency additions were needed.
- **Checks outside the local review:** live Anthropic calls and native Linux/Windows execution were not performed on this Mac. Local `dash` execution covers the reported parser mismatch. The requested post-push GitHub monitoring supplies the separate Ubuntu workflow result.
- **Practical limits:** the syntax rule checks direct `ctx` access forms with statically recognizable keys and destructuring from `ctx`; it is not general data-flow analysis for arbitrary aliases or dynamically constructed property names. Existing runtime authority controls remain the actual execution boundary. The review did not audit earlier bridge changes, the fingerprint report's conclusions, or provider billing.
- **Publication authorization:** Alan explicitly requested committing, pushing, and syncing all reviewed changes after this final-review update. The 12-file review was preserved; only handoff documentation changed afterward to record its results. Post-push completion must be reported using the resulting commit and GitHub run URLs.
