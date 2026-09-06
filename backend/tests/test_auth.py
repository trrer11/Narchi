import pytest
import os
from fastapi.testclient import TestClient
import json

os.environ["ENVIRONMENT"] = "development"
os.environ["DATABASE_URL"] = "sqlite:///./test.db"
os.environ["LEGACY_SHA256_SALT"] = "dummy_salt_for_tests"

# Pour éviter l'erreur SQLite sur JSONB
from sqlalchemy.dialects.postgresql import JSONB, ARRAY
from sqlalchemy import JSON, String
from sqlalchemy.ext.compiler import compiles

@compiles(JSONB, 'sqlite')
def compile_jsonb_sqlite(type_, compiler, **kw):
    return 'JSON'

@compiles(ARRAY, 'sqlite')
def compile_array_sqlite(type_, compiler, **kw):
    return 'JSON'

# Force tables creation for test
from sqlalchemy import create_engine
from app.database import Base
engine = create_engine("sqlite:///./test.db")
import app.models
Base.metadata.create_all(bind=engine)

from app.main import app
client = TestClient(app)

def test_health_check():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] in ("operational", "ok")

def test_login_invalid_credentials():
    response = client.post(
        "/api/v5/auth/token",
        data={"username": "invalid@example.com", "password": "wrongpassword"}
    )
    assert response.status_code in (401, 400)

