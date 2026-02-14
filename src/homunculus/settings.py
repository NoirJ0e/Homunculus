from __future__ import annotations

from dataclasses import dataclass
import os


@dataclass(frozen=True)
class DiscordSettings:
    token: str
    channel_id: int

    @classmethod
    def from_env(cls) -> "DiscordSettings":
        token = os.getenv("DISCORD_BOT_TOKEN")
        if not token:
            raise ValueError("DISCORD_BOT_TOKEN is required")

        raw_channel_id = os.getenv("DISCORD_CHANNEL_ID")
        if not raw_channel_id:
            raise ValueError("DISCORD_CHANNEL_ID is required")

        try:
            channel_id = int(raw_channel_id)
        except ValueError as exc:
            raise ValueError("DISCORD_CHANNEL_ID must be an integer") from exc

        if channel_id <= 0:
            raise ValueError("DISCORD_CHANNEL_ID must be a positive integer")

        return cls(token=token, channel_id=channel_id)

