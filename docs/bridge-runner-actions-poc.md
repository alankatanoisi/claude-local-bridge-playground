# Bridge Runner Read-Only GitHub Actions POC

This proof of concept lets GitHub Actions manually ask the local bridge runner to do a dry, read-only pass over the playground repository on Alan's self-hosted runner.

It is personal research infrastructure. It is not Anthropic-approved infrastructure, and it should not be treated as a production CI/CD system.

## What It Does

- Runs only when Alan manually starts `Bridge Runner Read-Only POC` from GitHub Actions.
- Runs only on the self-hosted runner configured for this repository.
- Checks that the local bridge at `http://127.0.0.1:11437/` answers.
- Invokes `node bin/local-bridge-runner.js` with `--plan` and only read-only tools.
- Uploads the runner JSON, human log, and trace files as GitHub Actions artifacts.

## How To Run It

1. Open the playground repository on GitHub in a browser.
2. Click the `Actions` tab.
3. Click `Bridge Runner Read-Only POC`.
4. Click `Run workflow`.
5. Leave the default prompt and `max_steps` value for the first run.
6. Click the green `Run workflow` button.

Success means the job finishes with a green check mark and shows downloadable artifacts named:

- `bridge-runner-readonly-poc-json`
- `bridge-runner-readonly-poc-human-log`
- `bridge-runner-readonly-poc-trace`

## Common Failures

- `Could not connect to the local bridge`: open VS Code on the Mac and start Claude Local Bridge.
- `This POC is only intended for the playground repository`: the workflow is running in the wrong checkout.
- `BRIDGE_RUNNER_POC_MAX_STEPS must be a number`: rerun the workflow with a number such as `4`.
- Missing artifacts after an early failure: read the job log first; the runner may have failed before creating output files.

## Safety Boundaries

- The workflow has `workflow_dispatch` only. It does not run on push, pull request, or schedule.
- The job has `contents: read` GitHub permissions.
- The runner command does not include `--allow-shell`, `--accept-edits`, or `--dont-ask`.
- The local GitHub Actions runner install folder, `actions-runner/`, is ignored by Git and skipped by runner file traversal tools.
