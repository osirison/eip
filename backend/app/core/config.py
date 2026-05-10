from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Engineering Intelligence Platform Backend"
    environment: str = "development"
    database_url: str = "postgresql+psycopg://eip:eip@localhost:5432/eip"
    gitlab_base_url: str = "https://gitlab.com"
    gitlab_token: str | None = None
    gitlab_use_fixtures: bool = True
    gitlab_analysis_limit: int = 25
    stale_days_threshold: int = 7
    oversized_changes_threshold: int = 800

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    @property
    def normalized_gitlab_base_url(self) -> str:
        trimmed_base_url = self.gitlab_base_url.rstrip("/")
        if trimmed_base_url.endswith("/api/v4"):
            return trimmed_base_url

        return f"{trimmed_base_url}/api/v4"

    @property
    def use_fixture_source(self) -> bool:
        return self.gitlab_use_fixtures or not self.gitlab_token


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
