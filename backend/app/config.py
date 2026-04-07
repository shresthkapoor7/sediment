from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    anthropic_api_key: str
    semantic_scholar_api_key: str = ""

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
