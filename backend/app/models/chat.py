"""NARCHI V5 — Modèles de chat PostgreSQL normalisés et multi-tenant."""

from __future__ import annotations

import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Index, String, func
from sqlalchemy.orm import relationship

from app.database import Base
from app.models.tenant_mixin import HasTenantColumn


def generate_uuid() -> str:
    return str(uuid.uuid4())


class ChatChannel(HasTenantColumn, Base):
    __tablename__ = "chat_channels"

    id = Column(String, primary_key=True, default=generate_uuid, index=True)
    kind = Column(String, nullable=False, default="team")
    name = Column(String, nullable=False)
    project_id = Column(String, nullable=True, index=True)
    # §59 — archivage doux : un canal PROJET dont le projet ne fait plus
    # partie du portefeuille actif transmis par le frontend est MASQUÉ des
    # listes, jamais supprimé. L'historique des messages reste en base et le
    # canal redevient visible si le projet réapparaît (réconciliation
    # bidirectionnelle dans ensure_channels). Décision data : aucune perte.
    archived_at = Column(DateTime(timezone=True), nullable=True, index=True)
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    members = relationship(
        "ChatChannelMember",
        back_populates="channel",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    messages = relationship(
        "ChatMessage", back_populates="channel", cascade="all, delete-orphan"
    )

    @property
    def member_ids(self) -> list[str]:
        """API de compatibilité, désormais alimentée par la table de jointure."""
        return [member.user_id for member in self.members]


class ChatChannelMember(HasTenantColumn, Base):
    __tablename__ = "chat_channel_members"

    channel_id = Column(
        String,
        ForeignKey("chat_channels.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id = Column(
        String,
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    )
    joined_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    channel = relationship("ChatChannel", back_populates="members")
    user = relationship("User")


class ChatMessage(HasTenantColumn, Base):
    __tablename__ = "chat_messages"

    id = Column(String, primary_key=True, default=generate_uuid, index=True)
    channel_id = Column(
        String,
        ForeignKey("chat_channels.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    author_id = Column(
        String,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    author_name = Column(String, nullable=False)
    text = Column(String(4000), nullable=False)
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
    client_id = Column(String, nullable=True, unique=True, index=True)
    client_created_at = Column(DateTime(timezone=True), nullable=True)

    channel = relationship("ChatChannel", back_populates="messages")


Index(
    "idx_chat_messages_tenant_channel_created",
    ChatMessage.tenant_id,
    ChatMessage.channel_id,
    ChatMessage.created_at,
    ChatMessage.id,
)
Index("idx_chat_messages_author_created", ChatMessage.author_id, ChatMessage.created_at)
Index("idx_chat_channels_tenant_project", ChatChannel.tenant_id, ChatChannel.project_id)
Index(
    "idx_chat_channels_tenant_created_id",
    ChatChannel.tenant_id,
    ChatChannel.created_at,
    ChatChannel.id,
)
Index("idx_ccm_tenant_user", ChatChannelMember.tenant_id, ChatChannelMember.user_id)


class ChatChannelTombstone(HasTenantColumn, Base):
    """§110 — Pierre tombale d'un canal AUTO-GÉRÉ (équipe/projet) supprimé
    par un owner/admin (demande client : « supprimer une discussion »).

    Sans elle, la synchro ``ensure_channels`` RECRÉERAIT le canal au
    prochain passage — les ids sont déterministes (« ch-team-… »,
    « ch-project-… ») — et le « supprimer » aurait été du théâtre :
    la conversation renaîtrait à chaque ouverture de session.

    ``_ensure_base_channels`` saute toute définition tombstonée : le canal
    ne revient jamais de lui-même. Une résurrection ne peut être qu'un
    acte manuel (oubli de la pierre tombale), pas un effet de bord.
    """

    __tablename__ = "chat_channel_tombstones"

    # Clé naturelle : l'identifiant déterministe du canal supprimé.
    id = Column(String, primary_key=True)
    deleted_by = Column(String, nullable=False)
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
