"""NARCHI V5 — Configuration centralisée, validée fail-closed en production."""

from __future__ import annotations

import os
from pathlib import Path
from typing import List

try:
    from pydantic_settings import BaseSettings, SettingsConfigDict

    HAS_PYDANTIC_SETTINGS = True
except ImportError:
    HAS_PYDANTIC_SETTINGS = False


DEFAULT_DATABASE_URL = "postgresql://narchi@pgbouncer:5432/narchi_v3"
DEFAULT_CORS = [
    "http://localhost:3000",
    "http://localhost:8080",
    "https://narchi.de",
]


if HAS_PYDANTIC_SETTINGS:

    class Settings(BaseSettings):
        APP_NAME: str = "NARCHI V5 Unified Engine"
        APP_VERSION: str = "5.0.0-PROD"
        DEBUG: bool = False
        ENVIRONMENT: str = "development"
        LOG_LEVEL: str = "INFO"
        CORS_ORIGINS: List[str] = DEFAULT_CORS

        SECRET_KEY: str = ""
        ALGORITHM: str = "HS256"
        ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
        LEGACY_SHA256_SALT: str = ""

        DATABASE_URL: str = DEFAULT_DATABASE_URL
        READER_DATABASE_URL: str = ""
        DB_POOL_SIZE: int = 5
        DB_MAX_OVERFLOW: int = 5
        DB_USE_PGBOUNCER: bool = True

        AK_BERLIN_GUEST_EMAIL: str = "guest@ak-berlin.de"
        AK_BERLIN_GUEST_NAME: str = "Gast Mitglied (AK Berlin)"
        AK_BERLIN_GUEST_ID: str = "AKB-2026-GUEST"
        AK_BERLIN_GUEST_COMPANY: str = "Architektenkammer Berlin"

        OPENAI_API_KEY: str = ""
        # §243 — Cloud-LLM aus, außer explizit an. Lokal: Ollama.
        LLM_CLOUD_ENABLED: bool = False
        OLLAMA_BASE_URL: str = ""
        LLM_MODEL: str = "llama3.2:3b"
        STRIPE_SECRET_KEY: str = ""
        STRIPE_WEBHOOK_SECRET: str = ""
        STRIPE_AI_METER_EVENT_NAME: str = "narchi_ai_audit"
        STRIPE_SUCCESS_URL: str = "https://narchi.de/app/settings?billing=success"
        STRIPE_CANCEL_URL: str = "https://narchi.de/app/settings?billing=cancelled"
        SENTRY_DSN: str = ""
        SENTRY_TRACES_SAMPLE_RATE: float = 0.1
        WHISPER_MODEL: str = "whisper-1"

        BASE_DIR: Path = Path(__file__).resolve().parent.parent
        UPLOAD_DIR: Path = BASE_DIR / "storage" / "uploads"
        REPORT_DIR: Path = BASE_DIR / "storage" / "reports"
        MAX_UPLOAD_SIZE_BYTES: int = 157_286_400
        # §46 — Serverseitige Terminerinnerungen (rappels même NARCHI fermé)
        REMINDER_WORKER_ENABLED: bool = True
        REMINDER_POLL_SECONDS: int = 60
        # SMTP (canal e-mail) : HONNÊTE — vide = canal désactivé, l'app le dit.
        SMTP_HOST: str = ""
        SMTP_PORT: int = 587
        SMTP_USER: str = ""
        SMTP_PASSWORD: str = ""
        SMTP_FROM: str = ""
        SMTP_USE_TLS: bool = True
        # §260 — KoSIT sidecar (optional profile). Empty = not running.
        KOSIT_SIDECAR_URL: str = ""

        model_config = SettingsConfigDict(
            env_file=".env",
            env_file_encoding="utf-8",
            extra="ignore",
            case_sensitive=False,
        )

    settings = Settings()
else:

    class StandaloneSettings:
        APP_NAME = os.getenv("APP_NAME", "NARCHI V5 Unified Engine")
        APP_VERSION = os.getenv("APP_VERSION", "5.0.0-PROD")
        DEBUG = os.getenv("DEBUG", "false").lower() in {"true", "1"}
        ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
        LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
        CORS_ORIGINS = DEFAULT_CORS

        SECRET_KEY = os.getenv("SECRET_KEY", "")
        ALGORITHM = os.getenv("ALGORITHM", "HS256")
        ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "15"))
        LEGACY_SHA256_SALT = os.getenv("LEGACY_SHA256_SALT", "")

        DATABASE_URL = os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)
        READER_DATABASE_URL = os.getenv("READER_DATABASE_URL", "")
        DB_POOL_SIZE = int(os.getenv("DB_POOL_SIZE", "5"))
        DB_MAX_OVERFLOW = int(os.getenv("DB_MAX_OVERFLOW", "5"))
        DB_USE_PGBOUNCER = os.getenv("DB_USE_PGBOUNCER", "true").lower() in {"true", "1"}

        AK_BERLIN_GUEST_EMAIL = os.getenv("AK_BERLIN_GUEST_EMAIL", "guest@ak-berlin.de")
        AK_BERLIN_GUEST_NAME = os.getenv("AK_BERLIN_GUEST_NAME", "Gast Mitglied (AK Berlin)")
        AK_BERLIN_GUEST_ID = os.getenv("AK_BERLIN_GUEST_ID", "AKB-2026-GUEST")
        AK_BERLIN_GUEST_COMPANY = os.getenv("AK_BERLIN_GUEST_COMPANY", "Architektenkammer Berlin")

        OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
        LLM_CLOUD_ENABLED = os.getenv("LLM_CLOUD_ENABLED", "false").lower() in {"true", "1"}
        OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "")
        LLM_MODEL = os.getenv("LLM_MODEL", "llama3.2:3b")
        STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "")
        STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")
        STRIPE_AI_METER_EVENT_NAME = os.getenv("STRIPE_AI_METER_EVENT_NAME", "narchi_ai_audit")
        STRIPE_SUCCESS_URL = os.getenv("STRIPE_SUCCESS_URL", "https://narchi.de/app/settings?billing=success")
        STRIPE_CANCEL_URL = os.getenv("STRIPE_CANCEL_URL", "https://narchi.de/app/settings?billing=cancelled")
        SENTRY_DSN = os.getenv("SENTRY_DSN", "")
        SENTRY_TRACES_SAMPLE_RATE = float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.1"))
        WHISPER_MODEL = os.getenv("WHISPER_MODEL", "whisper-1")

        BASE_DIR = Path(__file__).resolve().parent.parent
        UPLOAD_DIR = BASE_DIR / "storage" / "uploads"
        REPORT_DIR = BASE_DIR / "storage" / "reports"
        MAX_UPLOAD_SIZE_BYTES = int(os.getenv("MAX_UPLOAD_SIZE_BYTES", "157286400"))

        # §46 — Serverseitige Terminerinnerungen
        REMINDER_WORKER_ENABLED = os.getenv("REMINDER_WORKER_ENABLED", "true").lower() in {"true", "1"}
        REMINDER_POLL_SECONDS = int(os.getenv("REMINDER_POLL_SECONDS", "60"))
        SMTP_HOST = os.getenv("SMTP_HOST", "")
        SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
        SMTP_USER = os.getenv("SMTP_USER", "")
        SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
        SMTP_FROM = os.getenv("SMTP_FROM", "")
        SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "true").lower() in {"true", "1"}
        KOSIT_SIDECAR_URL = os.getenv("KOSIT_SIDECAR_URL", "")

    settings = StandaloneSettings()


def _validate_production_configuration() -> None:
    if settings.ENVIRONMENT.lower() != "production":
        return

    if not settings.DATABASE_URL.lower().startswith(("postgresql://", "postgresql+")):
        raise RuntimeError("DATABASE_URL doit cibler PostgreSQL en production")
    if settings.DATABASE_URL == DEFAULT_DATABASE_URL:
        raise RuntimeError("DATABASE_URL de production doit être fournie explicitement")

    weak_markers = ("change", "remplace", "secret", "berlin_2026")
    secret = settings.SECRET_KEY.strip()
    if len(secret) < 64 or any(marker in secret.lower() for marker in weak_markers):
        raise RuntimeError(
            "SECRET_KEY de production absente ou faible; fournir au moins 64 caractères aléatoires"
        )

    if "*" in settings.CORS_ORIGINS:
        raise RuntimeError("CORS_ORIGINS='*' est interdit avec les cookies de session")


_validate_production_configuration()
settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
settings.REPORT_DIR.mkdir(parents=True, exist_ok=True)
