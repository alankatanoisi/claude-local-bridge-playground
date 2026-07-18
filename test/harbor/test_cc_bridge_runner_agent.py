import json
import tempfile
import unittest
from pathlib import Path

from harbor.models.agent.context import AgentContext

from evals.harbor.cc_bridge_runner_agent import CcBridgeRunnerAgent


class CcBridgeRunnerAgentTest(unittest.TestCase):
    def make_agent(self, tmp: Path, **kwargs) -> CcBridgeRunnerAgent:
        return CcBridgeRunnerAgent(
            logs_dir=tmp,
            model_name="anthropic/claude-sonnet-4-6",
            bridge_url="http://bridge.example:11437",
            runner_git_ref="abc123",
            **kwargs,
        )

    def test_build_install_command_pins_requested_ref(self):
        with tempfile.TemporaryDirectory() as tmp:
            agent = self.make_agent(Path(tmp))
            command = agent.build_install_command()

        self.assertIn("claude-local-bridge-playground.git", command)
        self.assertIn("abc123", command)
        self.assertIn("npm ci --omit=dev", command)

    def test_build_run_command_quotes_instruction_and_writes_artifacts(self):
        with tempfile.TemporaryDirectory() as tmp:
            agent = self.make_agent(Path(tmp))
            command = agent.build_run_command("Fix greeting's output && run tests")

        self.assertIn("--bridge-url http://bridge.example:11437", command)
        self.assertIn('--cwd "$TASK_WORKDIR"', command)
        self.assertNotIn("--agent", command)
        self.assertIn("--allow-shell", command)
        self.assertIn("--accept-edits", command)
        self.assertIn("/logs/agent/runner-output.json", command)
        self.assertIn("Fix greeting'\"'\"'s output && run tests", command)

    def test_populate_context_post_run_reads_runner_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            logs_dir = Path(tmp)
            (logs_dir / "runner-output.json").write_text(
                json.dumps(
                    {
                        "finalText": "done",
                        "stopReason": "success",
                        "estimatedCostUsd": 0.0123,
                        "usage": {
                            "input_tokens": 10,
                            "cache_read_input_tokens": 4,
                            "output_tokens": 3,
                        },
                    }
                )
                + "\n",
                encoding="utf-8",
            )
            (logs_dir / "exit-code.txt").write_text("0", encoding="utf-8")

            context = AgentContext()
            agent = self.make_agent(logs_dir)
            agent.populate_context_post_run(context)

        self.assertEqual(context.n_input_tokens, 10)
        self.assertEqual(context.n_cache_tokens, 4)
        self.assertEqual(context.n_output_tokens, 3)
        self.assertEqual(context.cost_usd, 0.0123)
        self.assertEqual(context.metadata["runner_exit_code"], 0)
        self.assertEqual(context.metadata["stop_reason"], "success")
        self.assertEqual(context.metadata["final_text_preview"], "done")


if __name__ == "__main__":
    unittest.main()
