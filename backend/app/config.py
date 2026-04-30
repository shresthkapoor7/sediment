from pathlib import Path

from pydantic import SecretStr
from pydantic_settings import BaseSettings

_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    anthropic_api_key: str
    openalex_api_key: str = ""
    openalex_mailto: str = ""
    llm_model: str = "claude-haiku-4-5-20251001"
    app_version: str = "0.1.0"
    supabase_url: str = ""
    supabase_service_role_key: SecretStr = SecretStr("")
    app_url: str = ""
    max_request_bytes: int = 1_000_000
    daily_usage_limit_usd: float = 0.10
    burst_limit_requests: int = 8
    burst_limit_window_seconds: int = 60
    actor_key_secret: SecretStr = SecretStr("")

    model_config = {"env_file": str(_ENV_FILE), "extra": "ignore"}


settings = Settings()
