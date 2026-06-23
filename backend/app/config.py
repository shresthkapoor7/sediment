from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings

_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    anthropic_api_key: str
    openalex_api_key: str = ""
    openalex_mailto: str = ""
    unpaywall_email: str = ""
    voyage_api_key: SecretStr = SecretStr("")
    embedding_model: str = "voyage-4"
    embedding_dimensions: int = 1024
    rerank_model: str = "rerank-2.5-lite"
    retrieval_candidate_count: int = 20
    retrieval_context_count: int = 6
    max_paper_pdf_pages: int = 200
    llm_model: str = "claude-haiku-4-5-20251001"
    app_version: str = "0.1.0"
    supabase_url: str = ""
    supabase_service_role_key: SecretStr = SecretStr("")
    app_url: str = ""
    max_request_bytes: int = 1_000_000
    daily_usage_limit_usd: float = 0.20
    burst_limit_requests: int = 8
    burst_limit_window_seconds: int = 60
    actor_key_secret: SecretStr = Field(...)
    trust_railway_proxy_headers: bool = False
    trusted_proxies: str = ""
    trusted_proxy_cidrs: str = "100.0.0.0/8"

    model_config = {"env_file": str(_ENV_FILE), "extra": "ignore"}


settings = Settings()
