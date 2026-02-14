from __future__ import annotations

from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from homunculus.agent.hotswap import AgentIdentity, AgentIdentityManager, HotSwapError


class _Hook:
    def __init__(self, should_fail: bool = False):
        self.should_fail = should_fail
        self.calls = []

    async def refresh_identity(self, *, display_name: str):
        self.calls.append(display_name)
        if self.should_fail:
            raise RuntimeError("hook failure")


class HotSwapTests(unittest.IsolatedAsyncioTestCase):
    async def test_hot_swap_archives_old_and_bootstraps_new(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            data_home = Path(temp_dir)
            old_root = data_home / "agents" / "kovach"
            (old_root / "memory" / "memory").mkdir(parents=True)
            (old_root / "memory" / "MEMORY.md").write_text("old memory", encoding="utf-8")
            (old_root / "memory" / "memory" / "2026-02-14.md").write_text(
                "session note",
                encoding="utf-8",
            )

            hook = _Hook()
            manager = AgentIdentityManager(
                data_home=data_home,
                initial_identity=AgentIdentity(
                    npc_name="kovach",
                    character_card_path=Path("./cards/kovach.json"),
                    qmd_index="kovach",
                ),
                identity_hook=hook,
            )

            result = await manager.hot_swap(
                AgentIdentity(
                    npc_name="eliza",
                    character_card_path=Path("./cards/eliza.json"),
                    qmd_index="eliza",
                )
            )

            self.assertEqual(manager.current_identity.npc_name, "eliza")
            self.assertIsNotNone(result.archive_dir)
            self.assertTrue(result.archive_dir.exists())
            self.assertFalse(old_root.exists())
            self.assertTrue((result.archive_dir / "memory" / "memory" / "2026-02-14.md").exists())

            new_root = data_home / "agents" / "eliza"
            self.assertTrue((new_root / "memory" / "MEMORY.md").exists())
            self.assertTrue((new_root / "memory" / "memory").exists())
            self.assertTrue((new_root / "qmd" / "xdg-config").exists())
            self.assertTrue((new_root / "qmd" / "xdg-cache").exists())
            self.assertEqual(hook.calls, ["eliza"])

    async def test_hot_swap_with_missing_old_root(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            data_home = Path(temp_dir)
            manager = AgentIdentityManager(
                data_home=data_home,
                initial_identity=AgentIdentity(
                    npc_name="kovach",
                    character_card_path=Path("./cards/kovach.json"),
                    qmd_index="kovach",
                ),
            )

            result = await manager.hot_swap(
                AgentIdentity(
                    npc_name="newone",
                    character_card_path=Path("./cards/newone.json"),
                    qmd_index="newone",
                )
            )

            self.assertIsNone(result.archive_dir)
            self.assertTrue((data_home / "agents" / "newone" / "memory" / "MEMORY.md").exists())

    async def test_hook_failure_raises_controlled_error(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            data_home = Path(temp_dir)
            hook = _Hook(should_fail=True)
            manager = AgentIdentityManager(
                data_home=data_home,
                initial_identity=AgentIdentity(
                    npc_name="kovach",
                    character_card_path=Path("./cards/kovach.json"),
                    qmd_index="kovach",
                ),
                identity_hook=hook,
            )

            with self.assertRaises(HotSwapError):
                await manager.hot_swap(
                    AgentIdentity(
                        npc_name="eliza",
                        character_card_path=Path("./cards/eliza.json"),
                        qmd_index="eliza",
                    )
                )

            self.assertEqual(manager.current_identity.npc_name, "kovach")


if __name__ == "__main__":
    unittest.main()
