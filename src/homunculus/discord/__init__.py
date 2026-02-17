"""Discord-facing utilities."""

from homunculus.discord.client import (
    ChannelSender,
    DiscordChannelSender,
    DiscordClientService,
    DiscordHistoryProvider,
    DiscordMessage,
)
from homunculus.discord.mention_listener import MentionListener, MessageLike
from homunculus.discord.message_handler import (
    DiscordMessageHandler,
    MultiChannelMessageHandler,
)
from homunculus.discord.recent_messages import RecentMessage, RecentMessageCollector
from homunculus.discord.reply_formatter import ReplyFormatter, ReplyTemplateSettings
from homunculus.discord.slash_commands import (
    CommandResponse,
    CommandValidationError,
    NpcSlashCommandHandler,
    NpcStatus,
    format_command_error,
)

__all__ = [
    "ChannelSender",
    "DiscordChannelSender",
    "DiscordClientService",
    "DiscordHistoryProvider",
    "DiscordMessage",
    "DiscordMessageHandler",
    "MultiChannelMessageHandler",
    "MentionListener",
    "MessageLike",
    "RecentMessage",
    "RecentMessageCollector",
    "ReplyFormatter",
    "ReplyTemplateSettings",
    "CommandResponse",
    "CommandValidationError",
    "NpcSlashCommandHandler",
    "NpcStatus",
    "format_command_error",
]
