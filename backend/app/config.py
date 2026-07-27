from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Aura Grow API"
    environment: str = "production"
    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str
    google_maps_api_key: str
    allowed_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    website_cache_days: int = 30
    google_cache_days: int = 30
    website_timeout_seconds: int = 9
    audit_batch_size: int = 2
    max_api_budget_per_job: int = 60
    default_city: str = "Ciudad de Panamá"
    log_level: str = "INFO"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    @property
    def origins(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
