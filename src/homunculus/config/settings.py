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
class AgentSettings:
    npc_name: str
    character_card_path: Path
    qmd_index: str
    skill_ruleset: str = "coc7e"

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

        object.__setattr__(self, "npc_name", npc_name)
        object.__setattr__(self, "qmd_index", qmd_index)
        object.__setattr__(self, "skill_ruleset", skill_ruleset)
        object.__setattr__(self, "character_card_path", card_path)


@dataclass(frozen=True)
class DiscordSettings:
    channel_id: int
    bot_token_env: str = "DISCORD_BOT_TOKEN"
    history_size: int = 25

    def __post_init__(self) -> None:
        if self.channel_id <= 0:
            raise SettingsError("discord.channel_id must be a positive integer.")

        if self.history_size <= 0:
            raise SettingsError("discord.history_size must be a positive integer.")

        bot_token_env = self.bot_token_env.strip()
        if not bot_token_env:
            raise SettingsError("discord.bot_token_env cannot be empty.")

        object.__setattr__(self, "bot_token_env", bot_token_env)


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


def load_settings(
    config_path: Optional[Path] = None,
    environ: Optional[Mapping[str, str]] = None,
) -> AppSettings:
    """Load validated settings from JSON config and environment overrides."""

    env = dict(environ) if environ is not None else dict(os.environ)
    config = _load_config(config_path)

    agent = AgentSettings(
        npc_name=_read_value(
            config,
            env,
            section="agent",
            key="npc_name",
            env_key="HOMUNCULUS_AGENT_NPC_NAME",
            caster=_as_str,
        ),
        character_card_path=_read_value(
            config,
            env,
            section="agent",
            key="character_card_path",
            env_key="HOMUNCULUS_AGENT_CHARACTER_CARD_PATH",
            caster=_as_path,
        ),
        qmd_index=_read_value(
            config,
            env,
            section="agent",
            key="qmd_index",
            env_key="HOMUNCULUS_AGENT_QMD_INDEX",
            caster=_as_str,
        ),
        skill_ruleset=_read_value(
            config,
            env,
            section="agent",
            key="skill_ruleset",
            env_key="HOMUNCULUS_AGENT_SKILL_RULESET",
            caster=_as_str,
            default="coc7e",
        ),
    )

    discord = DiscordSettings(
        channel_id=_read_value(
            config,
            env,
            section="discord",
            key="channel_id",
            env_key="HOMUNCULUS_DISCORD_CHANNEL_ID",
            caster=_as_int,
        ),
        bot_token_env=_read_value(
            config,
            env,
            section="discord",
            key="bot_token_env",
            env_key="HOMUNCULUS_DISCORD_BOT_TOKEN_ENV",
            caster=_as_str,
            default="DISCORD_BOT_TOKEN",
        ),
        history_size=_read_value(
            config,
            env,
            section="discord",
            key="history_size",
            env_key="HOMUNCULUS_DISCORD_HISTORY_SIZE",
            caster=_as_int,
            default=25,
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
        },
        "discord": {
            "channel_id": settings.discord.channel_id,
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
