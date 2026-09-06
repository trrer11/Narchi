"""
NARCHI V5 — Feedback & Mood Schemas.
"""

from pydantic import BaseModel
from typing import Optional

class FeedbackSubmitRequest(BaseModel):
    rating: int = 5
    category: str = "Général"
    killer_feature: Optional[str] = None
    accuracy_rating: Optional[str] = None
    would_use_office: Optional[str] = None
    willingness_to_pay: Optional[str] = None
    missing_feature: Optional[str] = None
    voice_transcript: Optional[str] = None
    contact_email: Optional[str] = None

class VoiceTranscribeResponse(BaseModel):
    transcript: str
    language: str
    backend: str
    duration_sec: float

class MoodSubmitRequest(BaseModel):
    level: int
    emoji: str
    energy: int = 70
    stress: int = 30
    workload: int = 50
    note: Optional[str] = None
    date: str
