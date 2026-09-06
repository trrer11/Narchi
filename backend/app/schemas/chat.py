"""NARCHI V5 — Chat API schemas."""

from datetime import datetime
from typing import List, Optional, Literal
from pydantic import BaseModel, Field


ChatKind = Literal["team", "project", "direct"]


class ChatChannelResponse(BaseModel):
    id: str
    kind: ChatKind
    name: str
    memberIds: List[str]
    projectId: Optional[str] = None
    createdAt: datetime


class ChatMessageResponse(BaseModel):
    id: str
    channelId: str
    authorId: str
    authorName: str
    text: str
    createdAt: datetime
    # Axe 3 : identite + chronologie client (tri lexicographique stable cote UI).
    clientId: Optional[str] = None
    clientCreatedAt: Optional[datetime] = None


class EnsureChannelsRequest(BaseModel):
    users: List[str] = Field(default_factory=list)
    projects: List[dict] = Field(default_factory=list)


class DirectChannelRequest(BaseModel):
    otherUserId: str
    otherUserName: str


class SendMessageRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    # Axe 3 : fournis par l'outbox frontend (chatWebSocket.ts). Optionnels
    # pour compatibilite avec les clients V3 sans file hors-ligne.
    clientId: Optional[str] = Field(default=None, max_length=64)
    clientCreatedAt: Optional[datetime] = None


class RenameChannelRequest(BaseModel):
    """§108 — renommage d'un canal (owner/admin uniquement). Le strip et la
    longueur sont vérifiés côté route : ici la longueur brute maximale."""
    name: str = Field(min_length=1, max_length=80)


class ReadMarkerRequest(BaseModel):
    channelId: str
    readAt: Optional[datetime] = None


class TeamUserResponse(BaseModel):
    """Membre du tenant avec compte réel — seuls ces utilisateurs peuvent
    recevoir une Direktnachricht (POST /direct exige un compte backend)."""

    id: str
    name: str
    email: str
    role: str
    avatar_key: Optional[str] = None     # §82 — propagation avatars
    avatar_json: Optional[str] = None    # §82 — contenu serveur (photo/emoji)
