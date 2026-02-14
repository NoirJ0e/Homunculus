"""Prompt builder with centralized token budgeting."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Iterable, Sequence, Tuple
import re

from homunculus.character_card import CharacterCard
from homunculus.discord.recent_messages import RecentMessage
from homunculus.memory.qmd_adapter import MemoryRecord


_TOKEN_PATTERN = re.compile(r"\S+")


def estimate_tokens(text: str) -> int:
    """Heuristic tokenizer to keep prompt budget deterministic."""

    if not text:
        return 0
    return len(_TOKEN_PATTERN.findall(text))


@dataclass(frozen=True)
class PromptBuildResult:
    system_prompt: str
    user_prompt: str
    estimated_input_tokens: int
    included_memory_count: int
    included_history_count: int
    was_truncated: bool


class PromptBuilder:
    """Builds system/user prompts under a strict token budget."""

    def __init__(
        self,
        *,
        token_budget: int = 2000,
        token_counter: Callable[[str], int] = estimate_tokens,
    ) -> None:
        if token_budget <= 0:
            raise ValueError("token_budget must be a positive integer.")
        self._token_budget = token_budget
        self._count_tokens = token_counter

    @property
    def token_budget(self) -> int:
        return self._token_budget

    def build(
        self,
        *,
        character_card: CharacterCard,
        skill_rules_excerpt: str,
        memories: Sequence[MemoryRecord],
        recent_messages: Sequence[RecentMessage],
    ) -> PromptBuildResult:
        system_fixed = self._build_system_fixed(character_card)
        user_suffix = (
            "\n\nSomeone is speaking to you now. Reply naturally in-character and keep it concise."
        )
        user_prefix = "Recent conversation:\n"

        used_tokens = self._count_tokens(system_fixed) + self._count_tokens(user_prefix) + self._count_tokens(user_suffix)
        budget_remaining = max(self._token_budget - used_tokens, 0)
        was_truncated = used_tokens > self._token_budget

        skill_section = ""
        if skill_rules_excerpt.strip() and budget_remaining > 0:
            label = "Game rules reference:\n"
            label_tokens = self._count_tokens(label)
            excerpt_budget = max(budget_remaining - label_tokens, 0)
            excerpt = _truncate_to_token_budget(
                skill_rules_excerpt.strip(),
                excerpt_budget,
                self._count_tokens,
            )
            if excerpt:
                skill_section = f"\n\n{label}{excerpt}"
                consumed = self._count_tokens(skill_section)
                budget_remaining = max(budget_remaining - consumed, 0)
                if excerpt != skill_rules_excerpt.strip():
                    was_truncated = True
            elif skill_rules_excerpt.strip():
                was_truncated = True

        memory_lines = [
            f"- {item.text} (source={item.source}, score={item.score:.3f}, mode={item.mode})"
            for item in memories
        ]
        selected_memory_lines, memory_truncated = _select_lines_with_budget(
            memory_lines,
            budget_remaining,
            self._count_tokens,
        )
        if selected_memory_lines:
            memory_block = "Memory highlights:\n" + "\n".join(selected_memory_lines)
            consumed = self._count_tokens(memory_block) + self._count_tokens("\n\n")
            budget_remaining = max(budget_remaining - consumed, 0)
        else:
            memory_block = "Memory highlights:\n- (none)"
        was_truncated = was_truncated or memory_truncated

        history_lines = [
            f"[{item.role}][{item.author_name}] {item.content}" for item in recent_messages
        ]
        selected_history_lines, history_truncated = _select_lines_from_tail_with_budget(
            history_lines,
            budget_remaining,
            self._count_tokens,
        )
        if selected_history_lines:
            history_block = "\n".join(selected_history_lines)
        else:
            history_block = "(no recent messages)"
        was_truncated = was_truncated or history_truncated

        system_prompt = f"{system_fixed}{skill_section}\n\n{memory_block}"
        user_prompt = f"{user_prefix}{history_block}{user_suffix}"
        total_tokens = self._count_tokens(system_prompt) + self._count_tokens(user_prompt)
        if total_tokens > self._token_budget:
            was_truncated = True
            allowed_system_tokens = max(self._token_budget - self._count_tokens(user_prompt), 0)
            system_prompt = _truncate_to_token_budget(
                system_prompt,
                allowed_system_tokens,
                self._count_tokens,
            )
            total_tokens = self._count_tokens(system_prompt) + self._count_tokens(user_prompt)

            if total_tokens > self._token_budget:
                allowed_user_tokens = max(self._token_budget - self._count_tokens(system_prompt), 0)
                user_prompt = _truncate_to_token_budget(
                    user_prompt,
                    allowed_user_tokens,
                    self._count_tokens,
                )
                total_tokens = self._count_tokens(system_prompt) + self._count_tokens(user_prompt)

        return PromptBuildResult(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            estimated_input_tokens=total_tokens,
            included_memory_count=len(selected_memory_lines),
            included_history_count=len(selected_history_lines),
            was_truncated=was_truncated or total_tokens > self._token_budget,
        )

    @staticmethod
    def _build_system_fixed(card: CharacterCard) -> str:
        stats_summary = ", ".join(f"{key}={value}" for key, value in card.stats.items())
        inventory_summary = ", ".join(card.inventory) if card.inventory else "(none)"
        return (
            f"You are {card.name}, a TTRPG character.\n"
            f"Description: {card.description}\n"
            f"Personality: {card.personality}\n"
            f"Background: {card.background}\n\n"
            f"Stats: {stats_summary}\n"
            f"Inventory: {inventory_summary}"
        )


def _select_lines_with_budget(
    lines: Sequence[str],
    budget: int,
    token_counter: Callable[[str], int],
) -> Tuple[Tuple[str, ...], bool]:
    selected = []
    remaining = budget
    truncated = False

    for line in lines:
        cost = token_counter(line)
        if cost <= remaining:
            selected.append(line)
            remaining -= cost
        else:
            truncated = True
            break

    if len(selected) < len(lines):
        truncated = True
    return tuple(selected), truncated


def _select_lines_from_tail_with_budget(
    lines: Sequence[str],
    budget: int,
    token_counter: Callable[[str], int],
) -> Tuple[Tuple[str, ...], bool]:
    remaining = budget
    selected_reversed = []
    for line in reversed(lines):
        cost = token_counter(line)
        if cost <= remaining:
            selected_reversed.append(line)
            remaining -= cost
        else:
            break

    selected = tuple(reversed(selected_reversed))
    truncated = len(selected) < len(lines)
    return selected, truncated


def _truncate_to_token_budget(
    text: str,
    budget: int,
    token_counter: Callable[[str], int],
) -> str:
    if budget <= 0:
        return ""
    if token_counter(text) <= budget:
        return text

    words = text.split()
    selected = []
    for word in words:
        candidate = " ".join(selected + [word])
        if token_counter(candidate) > budget:
            break
        selected.append(word)
    return " ".join(selected)
