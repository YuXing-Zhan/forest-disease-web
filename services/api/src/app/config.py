from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    database_url: str = "sqlite+pysqlite:///./forest_disease.db"
    upload_dir: str = "data/uploads"
    max_upload_bytes: int = 12 * 1024 * 1024
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    web_dist_dir: str = ""
    kindwise_api_key: SecretStr | None = None
    openai_api_key: SecretStr | None = None
    openai_review_model: str = "gpt-5.6-sol"
    deepseek_api_key: SecretStr | None = None
    deepseek_review_model: str = "deepseek-flash"
    llm_review_providers: str = "deepseek"
    llm_review_timeout_seconds: float = 90.0
    developer_access_question: str = "开发者所在班级是？"
    developer_access_answer_hashes: str = (
        "156cc7139acdd7a8b0145620e0840f323a35c05ddb35bca1c1991106d408bcd8,"
        "2744ad59dfec5f7db9ea35015662d9e041325dac5d2ef78b24d6e83427bfba43"
    )
    developer_access_secret: SecretStr | None = None
    developer_access_token_hours: int = 168

    model_config = SettingsConfigDict(
        env_file=(".env", "../../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
