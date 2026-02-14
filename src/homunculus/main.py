from __future__ import annotations

from homunculus.discord import create_discord_client, run_discord_client
from homunculus.settings import DiscordSettings


async def _mention_handler_placeholder(_message: object) -> None:
    # BE-03 only wires listener/filtering; response pipeline is implemented later.
    return None


def main() -> None:
    settings = DiscordSettings.from_env()
    client = create_discord_client(
        channel_id=settings.channel_id,
        mention_handler=_mention_handler_placeholder,
    )
    run_discord_client(client=client, token=settings.token)


if __name__ == "__main__":
    main()

