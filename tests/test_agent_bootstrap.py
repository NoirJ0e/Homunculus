from __future__ import annotations

from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from homunculus.ops.bootstrap import bootstrap_agent, bootstrap_agents


class AgentBootstrapTests(unittest.TestCase):
    def test_bootstrap_creates_required_tree_and_files(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            data_home = Path(temp_dir)
            result = bootstrap_agent(data_home, "kovach")

            self.assertEqual(result.npc_name, "kovach")
            self.assertTrue((result.agent_root / "memory" / "memory").exists())
            self.assertTrue((result.agent_root / "qmd" / "xdg-config").exists())
            self.assertTrue((result.agent_root / "qmd" / "xdg-cache").exists())
            self.assertTrue((result.agent_root / "memory" / "MEMORY.md").exists())
            self.assertTrue((result.agent_root / "character-card.json").exists())

    def test_bootstrap_is_idempotent_and_preserves_existing_files(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            data_home = Path(temp_dir)
            first = bootstrap_agent(data_home, "kovach")
            memory_path = first.agent_root / "memory" / "MEMORY.md"
            memory_path.write_text("custom memory\n", encoding="utf-8")

            second = bootstrap_agent(data_home, "kovach")

            self.assertEqual(second.created_dirs, ())
            self.assertEqual(second.created_files, ())
            self.assertEqual(memory_path.read_text(encoding="utf-8"), "custom memory\n")

    def test_bootstrap_multiple_agents(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            data_home = Path(temp_dir)
            results = bootstrap_agents(data_home, ["kovach", "eliza"])
            self.assertEqual([r.npc_name for r in results], ["kovach", "eliza"])
            self.assertTrue((data_home / "agents" / "kovach").exists())
            self.assertTrue((data_home / "agents" / "eliza").exists())

    def test_invalid_npc_name_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            data_home = Path(temp_dir)
            with self.assertRaises(ValueError):
                bootstrap_agent(data_home, "bad name")


if __name__ == "__main__":
    unittest.main()
