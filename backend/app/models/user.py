"""
NARCHI V5 — User ORM Model.
Supports standard JWT accounts, office owners, architects, and the AK Berlin guest profile.
"""

from sqlalchemy import Column, String, Boolean, DateTime, Text, func
from app.database import Base
from app.models.tenant_mixin import HasTenantColumn
import uuid

def generate_uuid():
    return str(uuid.uuid4())

class User(HasTenantColumn, Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=generate_uuid, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    name = Column(String, nullable=False)
    role = Column(String, default="architect", nullable=False)  # §80 : 'owner', 'admin', 'architect', 'guest'
    avatar_key = Column(String(64), nullable=True)  # §80 — avatar du compte (self-service /members/me)
    # §82 — CONTENU de l'avatar JSON {kind: photo|emoji, photo?, emoji?} :
    # la clé seule ne propageait rien (l'image ne quittait pas le navigateur).
    avatar_json = Column(Text, nullable=True)
    company = Column(String, nullable=True)
    ak_member_id = Column(String, nullable=True)  # e.g., Architektenkammer Berlin registration
    # tenant_id est injecté par le mixin HasTenantColumn
    is_active = Column(Boolean, default=True, nullable=False)
    is_guest = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_login = Column(DateTime(timezone=True), nullable=True)
    password_migrated_at = Column(DateTime(timezone=True), nullable=True)
