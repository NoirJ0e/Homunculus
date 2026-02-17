"""Typed settings loader for Homunculus."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping, Optional, Tuple
import json
import os


_MISSING = object()
_VALID_LOG_LEVELS = {"CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG"}


class SettingsError(ValueError):
    """Raised when settings cannot be loaded or validated."""


@dataclass(frozen=True)
class ChannelSettings:
    channel_id: int
    character_card_path: Path
    memory_namespace: str
    channel_name: str = ""
    skill_ruleset: str = "coc7e"

    def __post_init__(self) -> None:
        if self.channel_id <= 0:
            raise SettingsError("discord.channels[].channel_id must be a positive integer.")

        channel_name = self.channel_name.strip()
        memory_namespace = self.memory_namespace.strip()
        skill_ruleset = self.skill_ruleset.strip()
        card_path = self.character_card_path.expanduser()

        if not memory_namespace:
            raise SettingsError("discord.channels[].memory_namespace cannot be empty.")
        if not skill_ruleset:
            raise SettingsError("discord.channels[].skill_ruleset cannot be empty.")
        if not str(card_path):
            raise SettingsError("discord.channels[].character_card_path cannot be empty.")

        object.__setattr__(self, "channel_name", channel_name)
        object.__setattr__(self, "memory_namespace", memory_namespace)
        object.__setattr__(self, "skill_ruleset", skill_ruleset)
        object.__setattr__(self, "character_card_path", card_path)


@dataclass(frozen=True)
class AgentSettings:
    npc_name: str
    character_card_path: Path
    qmd_index: str
    skill_ruleset: str = "coc7e"
    bot_name: str = ""

    def __post_init__(self) -> None:
        npc_name = self.npc_name.strip()
        if not npc_name:
            raise SettingsError("agent.npc_name cannot be empty.")

        qmd_index = self.qmd_index.strip()
        if not qmd_index:
            raise SettingsError("agent.qmd_index cannot be empty.")

        skill_ruleset = self.skill_ruleset.strip()
        if not skill_ruleset:
            raise SettingsError("agent.skill_ruleset cannot be empty.")

        card_path = self.character_card_path.expanduser()
        if not str(card_path):
            raise SettingsError("agent.character_card_path cannot be empty.")

        bot_name = self.bot_name.strip()
        if not bot_name:
            raise SettingsError("agent.bot_name cannot be empty.")

        object.__setattr__(self, "npc_name", npc_name)
        object.__setattr__(self, "qmd_index", qmd_index)
        object.__setattr__(self, "skill_ruleset", skill_ruleset)
        object.__setattr__(self, "character_card_path", card_path)
        object.__setattr__(self, "bot_name", bot_name)


@dataclass(frozen=True)
class DiscordSettings:
    channels: Tuple[ChannelSettings, ...]
    bot_token_env: str = "DISCORD_BOT_TOKEN"
    history_size: int = 25

    def __post_init__(self) -> None:
        if not self.channels:
            raise SettingsError("discord.channels must contain at least one channel.")

        if self.history_size <= 0:
            raise SettingsError("discord.history_size must be a positive integer.")

        bot_token_env = self.bot_token_env.strip()
        if not bot_token_env:
            raise SettingsError("discord.bot_token_env cannot be empty.")

        seen_ids = set()
        for channel in self.channels:
            if channel.channel_id in seen_ids:
                raise SettingsError(
                    f"Duplicate discord channel_id configured: {channel.channel_id}"
                )
            seen_ids.add(channel.channel_id)

        object.__setattr__(self, "bot_token_env", bot_token_env)

    @property
    def channel_id(self) -> int:
        """Backward-compatible primary channel access."""
        return self.channels[0].channel_id

    @property
    def channel_ids(self) -> Tuple[int, ...]:
        return tuple(channel.channel_id for channel in self.channels)


@dataclass(frozen=True)
class ModelSettings:
    provider: str
    name: str
    api_key_env: str = "ANTHROPIC_API_KEY"
    max_tokens: int = 500
    temperature: float = 0.7
    timeout_seconds: float = 30.0
    base_url: Optional[str] = None
    agent_id: Optional[str] = None

    def __post_init__(self) -> None:
        provider = self.provider.strip().lower()
        if provider not in ("anthropic", "openai", "openclaw"):
            raise SettingsError("model.provider must be 'anthropic', 'openai', or 'openclaw'.")

        name = self.name.strip()
        if not name:
            raise SettingsError("model.name cannot be empty.")

        api_key_env = self.api_key_env.strip()
        if not api_key_env:
            raise SettingsError("model.api_key_env cannot be empty.")

        if self.max_tokens <= 0:
            raise SettingsError("model.max_tokens must be > 0.")

        if not 0.0 <= self.temperature <= 1.0:
            raise SettingsError("model.temperature must be between 0.0 and 1.0.")

        if self.timeout_seconds <= 0:
            raise SettingsError("model.timeout_seconds must be > 0.")

        base_url = self.base_url.strip() if self.base_url else None
        if base_url == "":
            base_url = None

        agent_id = self.agent_id.strip() if self.agent_id else None
        if agent_id == "":
            agent_id = None

        object.__setattr__(self, "provider", provider)
        object.__setattr__(self, "name", name)
        object.__setattr__(self, "api_key_env", api_key_env)
        object.__setattr__(self, "base_url", base_url)
        object.__setattr__(self, "agent_id", agent_id)


@dataclass(frozen=True)
class MemorySettings:
    qmd_binary: str = "qmd"
    top_k: int = 10
    query_timeout_seconds: float = 4.0
    fallback_timeout_seconds: float = 2.0
    update_interval_seconds: float = 300.0
    update_timeout_seconds: float = 60.0

    def __post_init__(self) -> None:
        qmd_binary = self.qmd_binary.strip()
        if not qmd_binary:
            raise SettingsError("memory.qmd_binary cannot be empty.")

        if self.top_k <= 0:
            raise SettingsError("memory.top_k must be > 0.")

        if self.query_timeout_seconds <= 0:
            raise SettingsError("memory.query_timeout_seconds must be > 0.")

        if self.fallback_timeout_seconds <= 0:
            raise SettingsError("memory.fallback_timeout_seconds must be > 0.")

        if self.update_interval_seconds <= 0:
            raise SettingsError("memory.update_interval_seconds must be > 0.")

        if self.update_timeout_seconds <= 0:
            raise SettingsError("memory.update_timeout_seconds must be > 0.")

        object.__setattr__(self, "qmd_binary", qmd_binary)


@dataclass(frozen=True)
class RuntimeSettings:
    log_level: str = "INFO"
    data_home: Path = Path("~/.homunculus")
    dry_run: bool = False

    def __post_init__(self) -> None:
        log_level = self.log_level.strip().upper()
        if log_level not in _VALID_LOG_LEVELS:
            raise SettingsError(
                "runtime.log_level must be one of: " + ", ".join(sorted(_VALID_LOG_LEVELS))
            )

        object.__setattr__(self, "log_level", log_level)
        object.__setattr__(self, "data_home", self.data_home.expanduser())


@dataclass(frozen=True)
class AppSettings:
    agent: AgentSettings
    discord: DiscordSettings
    model: ModelSettings
    memory: MemorySettings
    runtime: RuntimeSettings

    @property
    def primary_channel(self) -> ChannelSettings:
        return self.discord.channels[0]

    def namespace_root(self, namespace: str) -> Path:
        normalized = namespace.strip()
        if not normalized:
            raise SettingsError("memory namespace cannot be empty.")

        base_root = self.runtime.data_home / "agents" / self.agent.bot_name
        if normalized == self.agent.bot_name:
            return base_root
        return base_root / normalized


def load_settings(
    config_path: Optional[Path] = None,
    environ: Optional[Mapping[str, str]] = None,
) -> AppSettings:
    """Load validated settings from JSON config and environment overrides."""

    env = dict(environ) if environ is not None else dict(os.environ)
    config = migrate_legacy_config(_load_config(config_path))
    discord = _load_discord_settings(config=config, environ=env)
    primary_channel = discord.channels[0]

    qmd_index = _read_value(
        config,
        env,
        section="agent",
        key="qmd_index",
        env_key="HOMUNCULUS_AGENT_QMD_INDEX",
        caster=_as_str,
        default=primary_channel.memory_namespace,
    )
    npc_name = _read_value(
        config,
        env,
        section="agent",
        key="npc_name",
        env_key="HOMUNCULUS_AGENT_NPC_NAME",
        caster=_as_str,
        default=qmd_index,
    )

    agent = AgentSettings(
        npc_name=npc_name,
        character_card_path=_read_value(
            config,
            env,
            section="agent",
            key="character_card_path",
            env_key="HOMUNCULUS_AGENT_CHARACTER_CARD_PATH",
            caster=_as_path,
            default=primary_channel.character_card_path,
        ),
        qmd_index=qmd_index,
        skill_ruleset=_read_value(
            config,
            env,
            section="agent",
            key="skill_ruleset",
            env_key="HOMUNCULUS_AGENT_SKILL_RULESET",
            caster=_as_str,
            default=primary_channel.skill_ruleset,
        ),
        bot_name=_read_value(
            config,
            env,
            section="agent",
            key="bot_name",
            env_key="HOMUNCULUS_AGENT_BOT_NAME",
            caster=_as_str,
            default=npc_name,
        ),
    )

    model = ModelSettings(
        provider=_read_value(
            config,
            env,
            section="model",
            key="provider",
            env_key="HOMUNCULUS_MODEL_PROVIDER",
            caster=_as_str,
            default="anthropic",
        ),
        name=_read_value(
            config,
            env,
            section="model",
            key="name",
            env_key="HOMUNCULUS_MODEL_NAME",
            caster=_as_str,
        ),
        api_key_env=_read_value(
            config,
            env,
            section="model",
            key="api_key_env",
            env_key="HOMUNCULUS_MODEL_API_KEY_ENV",
            caster=_as_str,
            default="ANTHROPIC_API_KEY",
        ),
        max_tokens=_read_value(
            config,
            env,
            section="model",
            key="max_tokens",
            env_key="HOMUNCULUS_MODEL_MAX_TOKENS",
            caster=_as_int,
            default=500,
        ),
        temperature=_read_value(
            config,
            env,
            section="model",
            key="temperature",
            env_key="HOMUNCULUS_MODEL_TEMPERATURE",
            caster=_as_float,
            default=0.7,
        ),
        timeout_seconds=_read_value(
            config,
            env,
            section="model",
            key="timeout_seconds",
            env_key="HOMUNCULUS_MODEL_TIMEOUT_SECONDS",
            caster=_as_float,
            default=30.0,
        ),
        base_url=_read_value(
            config,
            env,
            section="model",
            key="base_url",
            env_key="HOMUNCULUS_MODEL_BASE_URL",
            caster=_as_optional_str,
            default=None,
        ),
        agent_id=_read_value(
            config,
            env,
            section="model",
            key="agent_id",
            env_key="HOMUNCULUS_MODEL_AGENT_ID",
            caster=_as_optional_str,
            default=None,
        ),
    )

    memory = MemorySettings(
        qmd_binary=_read_value(
            config,
            env,
            section="memory",
            key="qmd_binary",
            env_key="HOMUNCULUS_MEMORY_QMD_BINARY",
            caster=_as_str,
            default="qmd",
        ),
        top_k=_read_value(
            config,
            env,
            section="memory",
            key="top_k",
            env_key="HOMUNCULUS_MEMORY_TOP_K",
            caster=_as_int,
            default=10,
        ),
        query_timeout_seconds=_read_value(
            config,
            env,
            section="memory",
            key="query_timeout_seconds",
            env_key="HOMUNCULUS_MEMORY_QUERY_TIMEOUT_SECONDS",
            caster=_as_float,
            default=4.0,
        ),
        fallback_timeout_seconds=_read_value(
            config,
            env,
            section="memory",
            key="fallback_timeout_seconds",
            env_key="HOMUNCULUS_MEMORY_FALLBACK_TIMEOUT_SECONDS",
            caster=_as_float,
            default=2.0,
        ),
        update_interval_seconds=_read_value(
            config,
            env,
            section="memory",
            key="update_interval_seconds",
            env_key="HOMUNCULUS_MEMORY_UPDATE_INTERVAL_SECONDS",
            caster=_as_float,
            default=300.0,
        ),
        update_timeout_seconds=_read_value(
            config,
            env,
            section="memory",
            key="update_timeout_seconds",
            env_key="HOMUNCULUS_MEMORY_UPDATE_TIMEOUT_SECONDS",
            caster=_as_float,
            default=60.0,
        ),
    )

    runtime = RuntimeSettings(
        log_level=_read_value(
            config,
            env,
            section="runtime",
            key="log_level",
            env_key="HOMUNCULUS_RUNTIME_LOG_LEVEL",
            caster=_as_str,
            default="INFO",
        ),
        data_home=_read_value(
            config,
            env,
            section="runtime",
            key="data_home",
            env_key="HOMUNCULUS_RUNTIME_DATA_HOME",
            caster=_as_path,
            default=Path("~/.homunculus"),
        ),
        dry_run=_read_value(
            config,
            env,
            section="runtime",
            key="dry_run",
            env_key="HOMUNCULUS_RUNTIME_DRY_RUN",
            caster=_as_bool,
            default=False,
        ),
    )

    return AppSettings(
        agent=agent,
        discord=discord,
        model=model,
        memory=memory,
        runtime=runtime,
    )


def migrate_legacy_config(config: Mapping[str, Any]) -> dict[str, Any]:
    """Convert v0.1 single-channel config into v0.2 channel list shape."""

    migrated = dict(config)

    discord_section = config.get("discord")
    if discord_section is None:
        return migrated
    if not isinstance(discord_section, Mapping):
        raise SettingsError("Config section 'discord' must be an object.")
    if "channels" in discord_section or "channel_id" not in discord_section:
        return migrated

    agent_section = config.get("agent")
    if agent_section is not None and not isinstance(agent_section, Mapping):
        raise SettingsError("Config section 'agent' must be an object.")

    channel_payload: dict[str, Any] = {
        "channel_id": discord_section["channel_id"],
    }
    if isinstance(agent_section, Mapping):
        if "character_card_path" in agent_section:
            channel_payload["character_card_path"] = agent_section["character_card_path"]
        if "npc_name" in agent_section:
            channel_payload["memory_namespace"] = agent_section["npc_name"]
        elif "qmd_index" in agent_section:
            channel_payload["memory_namespace"] = agent_section["qmd_index"]
        if "skill_ruleset" in agent_section:
            channel_payload["skill_ruleset"] = agent_section["skill_ruleset"]

    migrated_discord = dict(discord_section)
    del migrated_discord["channel_id"]
    migrated_discord["channels"] = [channel_payload]
    migrated["discord"] = migrated_discord
    return migrated


def resolve_env_secret(env_name: str, environ: Optional[Mapping[str, str]] = None) -> str:
    """Resolve a secret value from environment by indirection key."""

    env = environ if environ is not None else os.environ
    value = env.get(env_name)
    if value is None:
        raise SettingsError(f"Required secret environment variable '{env_name}' is not set.")

    if not value.strip():
        raise SettingsError(f"Secret environment variable '{env_name}' cannot be empty.")

    return value


def settings_summary(settings: AppSettings) -> dict:
    """Render redacted settings for diagnostics."""

    return {
        "agent": {
            "npc_name": settings.agent.npc_name,
            "character_card_path": str(settings.agent.character_card_path),
            "qmd_index": settings.agent.qmd_index,
            "skill_ruleset": settings.agent.skill_ruleset,
            "bot_name": settings.agent.bot_name,
        },
        "discord": {
            "channel_id": settings.discord.channel_id,
            "channels": [
                {
                    "channel_id": channel.channel_id,
                    "channel_name": channel.channel_name,
                    "character_card_path": str(channel.character_card_path),
                    "memory_namespace": channel.memory_namespace,
                    "skill_ruleset": channel.skill_ruleset,
                }
                for channel in settings.discord.channels
            ],
            "bot_token_env": settings.discord.bot_token_env,
            "history_size": settings.discord.history_size,
        },
        "model": {
            "provider": settings.model.provider,
            "name": settings.model.name,
            "api_key_env": settings.model.api_key_env,
            "max_tokens": settings.model.max_tokens,
            "temperature": settings.model.temperature,
            "timeout_seconds": settings.model.timeout_seconds,
            "base_url": settings.model.base_url,
            "agent_id": settings.model.agent_id,
        },
        "memory": {
            "qmd_binary": settings.memory.qmd_binary,
            "top_k": settings.memory.top_k,
            "query_timeout_seconds": settings.memory.query_timeout_seconds,
            "fallback_timeout_seconds": settings.memory.fallback_timeout_seconds,
            "update_interval_seconds": settings.memory.update_interval_seconds,
            "update_timeout_seconds": settings.memory.update_timeout_seconds,
        },
        "runtime": {
            "log_level": settings.runtime.log_level,
            "data_home": str(settings.runtime.data_home),
            "dry_run": settings.runtime.dry_run,
        },
    }


def _load_config(config_path: Optional[Path]) -> Mapping[str, Any]:
    if config_path is None:
        return {}

    resolved = config_path.expanduser()
    if not resolved.exists():
        raise SettingsError(f"Config file does not exist: {resolved}")

    try:
        with resolved.open("r", encoding="utf-8") as handle:
            loaded = json.load(handle)
    except json.JSONDecodeError as exc:
        raise SettingsError(f"Config file is not valid JSON: {resolved}") from exc

    if not isinstance(loaded, dict):
        raise SettingsError("Config root must be an object.")

    return loaded


def _load_discord_settings(
    *,
    config: Mapping[str, Any],
    environ: Mapping[str, str],
) -> DiscordSettings:
    channels = _load_channel_settings(config=config, environ=environ)
    return DiscordSettings(
        channels=channels,
        bot_token_env=_read_value(
            config,
            environ,
            section="discord",
            key="bot_token_env",
            env_key="HOMUNCULUS_DISCORD_BOT_TOKEN_ENV",
            caster=_as_str,
            default="DISCORD_BOT_TOKEN",
        ),
        history_size=_read_value(
            config,
            environ,
            section="discord",
            key="history_size",
            env_key="HOMUNCULUS_DISCORD_HISTORY_SIZE",
            caster=_as_int,
            default=25,
        ),
    )


def _load_channel_settings(
    *,
    config: Mapping[str, Any],
    environ: Mapping[str, str],
) -> Tuple[ChannelSettings, ...]:
    configured = _parse_configured_channels(config)
    env_channel_id = environ.get("HOMUNCULUS_DISCORD_CHANNEL_ID")

    if env_channel_id not in (None, ""):
        channel_id = _read_value(
            config,
            environ,
            section="discord",
            key="channel_id",
            env_key="HOMUNCULUS_DISCORD_CHANNEL_ID",
            caster=_as_int,
        )
        if configured:
            first = configured[0]
            overridden = ChannelSettings(
                channel_id=channel_id,
                channel_name=first.channel_name,
                character_card_path=first.character_card_path,
                memory_namespace=first.memory_namespace,
                skill_ruleset=first.skill_ruleset,
            )
            return (overridden,) + configured[1:]

        return (_build_legacy_channel(config=config, environ=environ, channel_id=channel_id),)

    if configured:
        return configured

    return (_build_legacy_channel(config=config, environ=environ, channel_id=None),)


def _parse_configured_channels(config: Mapping[str, Any]) -> Tuple[ChannelSettings, ...]:
    discord_section = config.get("discord")
    if discord_section is None:
        return ()
    if not isinstance(discord_section, Mapping):
        raise SettingsError("Config section 'discord' must be an object.")

    channels_raw = discord_section.get("channels")
    if channels_raw is None:
        return ()
    if not isinstance(channels_raw, list):
        raise SettingsError("discord.channels must be an array.")
    if not channels_raw:
        raise SettingsError("discord.channels cannot be empty.")

    channels: list[ChannelSettings] = []
    for index, raw_entry in enumerate(channels_raw):
        if not isinstance(raw_entry, Mapping):
            raise SettingsError(f"discord.channels[{index}] must be an object.")
        channels.append(_parse_channel_entry(raw_entry, index=index))
    return tuple(channels)


def _parse_channel_entry(entry: Mapping[str, Any], *, index: int) -> ChannelSettings:
    return ChannelSettings(
        channel_id=_cast_channel_value(entry, index=index, key="channel_id", caster=_as_int),
        channel_name=_cast_channel_value(
            entry,
            index=index,
            key="channel_name",
            caster=_as_optional_str,
            default="",
        )
        or "",
        character_card_path=_cast_channel_value(
            entry,
            index=index,
            key="character_card_path",
            caster=_as_path,
        ),
        memory_namespace=_cast_channel_value(
            entry,
            index=index,
            key="memory_namespace",
            caster=_as_str,
        ),
        skill_ruleset=_cast_channel_value(
            entry,
            index=index,
            key="skill_ruleset",
            caster=_as_str,
            default="coc7e",
        ),
    )


def _cast_channel_value(
    entry: Mapping[str, Any],
    *,
    index: int,
    key: str,
    caster: Callable[[Any], Any],
    default: Any = _MISSING,
) -> Any:
    if key in entry:
        raw = entry[key]
    elif default is not _MISSING:
        raw = default
    else:
        raise SettingsError(f"Missing required setting 'discord.channels[{index}].{key}'.")

    try:
        return caster(raw)
    except SettingsError:
        raise
    except Exception as exc:
        raise SettingsError(
            f"Invalid value for discord.channels[{index}].{key}: {raw!r}"
        ) from exc


def _build_legacy_channel(
    *,
    config: Mapping[str, Any],
    environ: Mapping[str, str],
    channel_id: Optional[int],
) -> ChannelSettings:
    effective_channel_id = channel_id
    if effective_channel_id is None:
        effective_channel_id = _read_value(
            config,
            environ,
            section="discord",
            key="channel_id",
            env_key="HOMUNCULUS_DISCORD_CHANNEL_ID",
            caster=_as_int,
        )

    qmd_index = _read_value(
        config,
        environ,
        section="agent",
        key="qmd_index",
        env_key="HOMUNCULUS_AGENT_QMD_INDEX",
        caster=_as_str,
    )
    npc_name = _read_value(
        config,
        environ,
        section="agent",
        key="npc_name",
        env_key="HOMUNCULUS_AGENT_NPC_NAME",
        caster=_as_str,
        default=qmd_index,
    )
    return ChannelSettings(
        channel_id=effective_channel_id,
        character_card_path=_read_value(
            config,
            environ,
            section="agent",
            key="character_card_path",
            env_key="HOMUNCULUS_AGENT_CHARACTER_CARD_PATH",
            caster=_as_path,
        ),
        memory_namespace=npc_name,
        skill_ruleset=_read_value(
            config,
            environ,
            section="agent",
            key="skill_ruleset",
            env_key="HOMUNCULUS_AGENT_SKILL_RULESET",
            caster=_as_str,
            default="coc7e",
        ),
    )


def _read_value(
    config: Mapping[str, Any],
    environ: Mapping[str, str],
    *,
    section: str,
    key: str,
    env_key: str,
    caster: Callable[[Any], Any],
    default: Any = _MISSING,
) -> Any:
    raw_value, source = _resolve_raw_value(
        config=config,
        environ=environ,
        section=section,
        key=key,
        env_key=env_key,
        default=default,
    )

    try:
        return caster(raw_value)
    except SettingsError:
        raise
    except Exception as exc:  # pragma: no cover - defensive
        raise SettingsError(
            f"Invalid value for {section}.{key} from {source}: {raw_value!r}"
        ) from exc


def _resolve_raw_value(
    *,
    config: Mapping[str, Any],
    environ: Mapping[str, str],
    section: str,
    key: str,
    env_key: str,
    default: Any,
) -> Tuple[Any, str]:
    env_value = environ.get(env_key)
    if env_value not in (None, ""):
        return env_value, "environment"

    section_map = config.get(section)
    if section_map is not None and not isinstance(section_map, Mapping):
        raise SettingsError(f"Config section '{section}' must be an object.")

    if isinstance(section_map, Mapping) and key in section_map:
        return section_map[key], "config"

    if default is not _MISSING:
        return default, "default"

    raise SettingsError(
        f"Missing required setting '{section}.{key}'. "
        f"Provide it in config or via '{env_key}'."
    )


def _as_str(value: Any) -> str:
    if isinstance(value, str):
        text = value.strip()
        if not text:
            raise SettingsError("Value cannot be empty.")
        return text

    raise SettingsError("Expected string value.")


def _as_optional_str(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, str):
        text = value.strip()
        return text if text else None
    raise SettingsError("Expected string value.")


def _as_int(value: Any) -> int:
    if isinstance(value, bool):
        raise SettingsError("Boolean is not a valid integer value.")

    if isinstance(value, int):
        return value

    if isinstance(value, str):
        return int(value.strip())

    raise SettingsError("Expected integer value.")


def _as_float(value: Any) -> float:
    if isinstance(value, bool):
        raise SettingsError("Boolean is not a valid float value.")

    if isinstance(value, (int, float)):
        return float(value)

    if isinstance(value, str):
        return float(value.strip())

    raise SettingsError("Expected float value.")


def _as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value

    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off"}:
            return False

    raise SettingsError("Expected boolean value.")


def _as_path(value: Any) -> Path:
    if isinstance(value, Path):
        return value

    if isinstance(value, str):
        text = value.strip()
        if not text:
            raise SettingsError("Path value cannot be empty.")
        return Path(text)

    raise SettingsError("Expected path string value.")
