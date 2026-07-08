from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "ReLai API"
    app_env: str = "development"
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    database_url: str = "postgresql://user:password@localhost:5432/relai"
    secret_key: str = "change-me-in-env"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    cors_origins_raw: str = Field(default="", validation_alias="CORS_ORIGINS")
    supabase_url: str = ""
    supabase_key: str = ""
    supabase_service_role_key: str = ""
    google_api_key: str = ""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def cors_origins(self) -> list[str]:
        return [
            item.strip().rstrip("/")
            for item in self.cors_origins_raw.split(",")
            if item.strip()
        ]


settings = Settings()
