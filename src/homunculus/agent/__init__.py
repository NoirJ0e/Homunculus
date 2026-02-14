"""Agent identity and lifecycle utilities."""

from homunculus.agent.hotswap import (
    AgentIdentity,
    AgentIdentityManager,
    HotSwapError,
    HotSwapResult,
    IdentityRefreshHook,
)

__all__ = [
    "AgentIdentity",
    "AgentIdentityManager",
    "HotSwapError",
    "HotSwapResult",
    "IdentityRefreshHook",
]
