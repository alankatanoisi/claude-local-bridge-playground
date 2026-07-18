"""Harbor installed-agent adapter for the cc bridge runner.

This file is intentionally small: Harbor owns the task container lifecycle,
and the runner owns the coding-agent loop once it is installed in that
container.
"""

import json
import os
import shlex
from pathlib import PurePosixPath
from typing import Any

from harbor.agents.installed.base import BaseInstalledAgent, with_prompt_template
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext
from harbor.models.trial.paths import EnvironmentPaths


class CcBridgeRunnerAgent(BaseInstalledAgent):
    """Install and run the playground cc bridge runner inside a Harbor task."""

    DEFAULT_RUNNER_GIT_URL = "https://github.com/alankatanoisi/claude-local-bridge-playground.git"
    DEFAULT_RUNNER_GIT_REF = "main"
    DEFAULT_BRIDGE_URL = "http://host.docker.internal:11437"

    _REPO_DIR = PurePosixPath("/installed-agent/cc-bridge-runner")
    _STDOUT_FILENAME = "runner-output.json"
    _STDERR_FILENAME = "runner-stderr.txt"
    _EXIT_CODE_FILENAME = "exit-code.txt"

    def __init__(
        self,
        *args: Any,
        runner_git_url: str | None = None,
        runner_git_ref: str | None = None,
        bridge_url: str | None = None,
        max_steps: int | str = 40,
        shell_timeout_ms: int | str = 900000,
        max_wall_clock_ms: int | str = 1500000,
        trace_level: str = "summary",
        **kwargs: Any,
    ) -> None:
        super().__init__(*args, **kwargs)
        self.runner_git_url = runner_git_url or os.environ.get("CC_BRIDGE_RUNNER_GIT_URL") or self.DEFAULT_RUNNER_GIT_URL
        self.runner_git_ref = runner_git_ref or os.environ.get("CC_BRIDGE_RUNNER_GIT_REF") or self.DEFAULT_RUNNER_GIT_REF
        self.bridge_url = bridge_url or os.environ.get("BRIDGE_RUNNER_BRIDGE_URL") or self.DEFAULT_BRIDGE_URL
        self.max_steps = int(max_steps)
        self.shell_timeout_ms = int(shell_timeout_ms)
        self.max_wall_clock_ms = int(max_wall_clock_ms)
        self.trace_level = trace_level

    @staticmethod
    def name() -> str:
        return "cc-bridge-runner"

    def get_version_command(self) -> str | None:
        return f"cd {self._REPO_DIR} && git rev-parse --short HEAD && node bin/local-bridge-runner.js --help >/dev/null"

    async def install(self, environment: BaseEnvironment) -> None:
        await self.exec_as_root(
            environment,
            command=(
                "if command -v apk >/dev/null 2>&1; then "
                "apk add --no-cache bash ca-certificates curl git nodejs npm ripgrep; "
                "elif command -v apt-get >/dev/null 2>&1; then "
                "apt-get update && apt-get install -y ca-certificates curl git nodejs npm ripgrep; "
                "elif command -v yum >/dev/null 2>&1; then "
                "yum install -y ca-certificates curl git nodejs npm ripgrep; "
                "else echo 'No supported package manager found' >&2; exit 1; fi"
            ),
            env={"DEBIAN_FRONTEND": "noninteractive"},
        )
        await self.exec_as_agent(environment, command=self.build_install_command())

    def build_install_command(self) -> str:
        repo_url = shlex.quote(self.runner_git_url)
        git_ref = shlex.quote(self.runner_git_ref)
        repo_dir = shlex.quote(str(self._REPO_DIR))
        return (
            "set -euo pipefail; "
            f"rm -rf {repo_dir}; "
            f"git clone {repo_url} {repo_dir}; "
            f"cd {repo_dir}; "
            f"if git rev-parse --verify --quiet {git_ref}^{{commit}} >/dev/null; then "
            f"git checkout --detach {git_ref}; "
            "else "
            f"git fetch --depth 1 origin {git_ref} && git checkout --detach FETCH_HEAD; "
            "fi; "
            "npm ci --omit=dev; "
            "node bin/local-bridge-runner.js --help >/dev/null"
        )

    @with_prompt_template
    async def run(self, instruction: str, environment: BaseEnvironment, context: AgentContext) -> None:
        await self.exec_as_agent(
            environment,
            command=self.build_run_command(instruction),
            env={"BRIDGE_RUNNER_BRIDGE_URL": self.bridge_url},
            timeout_sec=max(1, int(self.max_wall_clock_ms / 1000) + 60),
        )

    def build_run_command(self, instruction: str) -> str:
        model = (self.model_name or "claude-sonnet-4-6").split("/")[-1]
        agent_dir = str(EnvironmentPaths.agent_dir)
        stdout_path = shlex.quote(f"{agent_dir}/{self._STDOUT_FILENAME}")
        stderr_path = shlex.quote(f"{agent_dir}/{self._STDERR_FILENAME}")
        exit_code_path = shlex.quote(f"{agent_dir}/{self._EXIT_CODE_FILENAME}")

        runner_parts = [
            "node",
            "bin/local-bridge-runner.js",
            "--bridge-url",
            shlex.quote(self.bridge_url),
            "--cwd",
            '"$TASK_WORKDIR"',
            "--model",
            shlex.quote(model),
            "--trust-workspace",
            "--allow-shell",
            "--accept-edits",
            "--dont-ask",
            "--chaos-ok",
            "--shell-timeout",
            str(self.shell_timeout_ms),
            "--max-steps",
            str(self.max_steps),
            "--max-wall-clock-ms",
            str(self.max_wall_clock_ms),
            "--output-format",
            "json",
            "--log-level",
            "quiet",
            "--trace-level",
            shlex.quote(self.trace_level),
            "--transcript",
            shlex.quote(f"{agent_dir}/transcript.jsonl"),
            "--human-log",
            shlex.quote(f"{agent_dir}/human-log.md"),
            "--trace-path",
            shlex.quote(f"{agent_dir}/trace.runner.jsonl"),
            shlex.quote(instruction),
        ]

        return (
            "set +e; "
            'TASK_WORKDIR="$(pwd -P)"; '
            f"cd {shlex.quote(str(self._REPO_DIR))}; "
            f"{' '.join(runner_parts)} > {stdout_path} 2> {stderr_path}; "
            "CODE=$?; "
            f'printf "%s" "$CODE" > {exit_code_path}; '
            f"cat {stdout_path}; "
            "exit 0"
        )

    def populate_context_post_run(self, context: AgentContext) -> None:
        result = self._read_runner_result()
        exit_code = self._read_exit_code()

        usage = result.get("usage") if isinstance(result, dict) else {}
        if isinstance(usage, dict):
            context.n_input_tokens = usage.get("input_tokens")
            context.n_cache_tokens = usage.get("cache_read_input_tokens")
            context.n_output_tokens = usage.get("output_tokens")

        estimated_cost = result.get("estimatedCostUsd") if isinstance(result, dict) else None
        if isinstance(estimated_cost, (int, float)):
            context.cost_usd = float(estimated_cost)

        final_text = result.get("finalText") if isinstance(result, dict) else ""
        context.metadata = {
            "runner_exit_code": exit_code,
            "stop_reason": result.get("stopReason") if isinstance(result, dict) else None,
            "transcript_path": str(self.logs_dir / "transcript.jsonl"),
            "trace_path": str(self.logs_dir / "trace.runner.jsonl"),
            "stderr_path": str(self.logs_dir / self._STDERR_FILENAME),
            "final_text_preview": (final_text or "")[:1000],
        }

    def _read_runner_result(self) -> dict[str, Any]:
        output_path = self.logs_dir / self._STDOUT_FILENAME
        if not output_path.exists():
            return {}

        text = output_path.read_text(encoding="utf-8").strip()
        if not text:
            return {}

        # The runner writes one JSON object in json mode. If a future version
        # writes extra lines, prefer the last valid JSON object.
        for line in reversed(text.splitlines()):
            try:
                parsed = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, dict):
                return parsed
        return {}

    def _read_exit_code(self) -> int | None:
        exit_path = self.logs_dir / self._EXIT_CODE_FILENAME
        if not exit_path.exists():
            return None
        try:
            return int(exit_path.read_text(encoding="utf-8").strip())
        except ValueError:
            return None
