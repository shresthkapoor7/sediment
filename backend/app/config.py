from pathlib import Path
from pydantic_settings import BaseSettings

_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    anthropic_api_key: str
    semantic_scholar_api_key: str = ""
    llm_model: str = "claude-haiku-4-5-20251001"

    model_config = {"env_file": str(_ENV_FILE), "extra": "ignore"}


settings = Settings()
