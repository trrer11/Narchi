from fastapi.testclient import TestClient

from app.core.security import create_access_token, get_password_hash
from app.database import Base, SessionLocal, engine
from app.main import app
from app.models.audit_log import AuditLog
from app.models.chat import ChatChannel, ChatChannelMember, ChatMessage
from app.models.project import CostEstimation, CostEstimationItem
from app.models.user import User


def test_normalized_database_schema():
    assert "member_ids" not in ChatChannel.__table__.columns
    assert set(ChatChannelMember.__table__.primary_key.columns.keys()) == {
        "channel_id",
        "user_id",
    }
    assert "tenant_id" in ChatChannel.__table__.columns
    assert "tenant_id" in ChatMessage.__table__.columns

    assert "kg_breakdown" not in CostEstimation.__table__.columns
    assert {"estimation_id", "kg_code", "amount", "tenant_id"}.issubset(
        CostEstimationItem.__table__.columns.keys()
    )
    assert set(AuditLog.__table__.primary_key.columns.keys()) == {"id", "created_at"}
    assert AuditLog.__table__.dialect_options["postgresql"]["partition_by"] == "RANGE (created_at)"


def test_signed_cookie_drives_tenant_and_header_cannot_override_it():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == "tenant-test@narchi.invalid").first()
        if user is None:
            user = User(
                email="tenant-test@narchi.invalid",
                hashed_password=get_password_hash("A-long-test-password-2026!"),
                name="Tenant Test",
                role="architect",
                tenant_id="tenant-test-one",
                is_active=True,
                is_guest=False,
            )
            db.add(user)
            db.commit()
            db.refresh(user)
        session = create_access_token(
            data={"sub": user.id, "type": "access"},
            user=user,
        )
    finally:
        db.close()

    client = TestClient(app)
    client.cookies.set("narchi_session", session)
    response = client.get("/api/v5/auth/me")
    assert response.status_code == 200
    assert response.json()["tenant_id"] == "tenant-test-one"

    mismatch = client.get(
        "/api/v5/auth/me",
        headers={"X-Tenant-ID": "tenant-other"},
    )
    assert mismatch.status_code == 403
    assert mismatch.json()["error"] == "TENANT_MISMATCH"
