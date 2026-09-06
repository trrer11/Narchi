"""
NARCHI V5 — Feedback & Mood Check-in ORM Models.
Stores voice transcripts (Whisper), structured survey answers, and office mood ratings.
"""

from sqlalchemy import Column, String, Integer, DateTime, JSON, func
from app.database import Base
import uuid

def generate_uuid():
    return str(uuid.uuid4())

class FeedbackEntry(Base):
    __tablename__ = "feedback_entries"

    id = Column(String, primary_key=True, default=generate_uuid, index=True)
    user_id = Column(String, index=True, nullable=True)
    user_name = Column(String, default="Anonym")
    rating = Column(Integer, default=5)
    category = Column(String, default="Général")
    killer_feature = Column(String, nullable=True)
    accuracy_rating = Column(String, nullable=True)
    would_use_office = Column(String, nullable=True)
    willingness_to_pay = Column(String, nullable=True)
    missing_feature = Column(String, nullable=True)
    voice_transcript = Column(String, nullable=True)
    voice_backend = Column(String, default="whisper-1")
    contact_email = Column(String, nullable=True)
    status = Column(String, default="new")  # new, reviewed, archived
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class MoodCheckin(Base):
    __tablename__ = "mood_checkins"

    id = Column(String, primary_key=True, default=generate_uuid, index=True)
    user_id = Column(String, index=True, nullable=False)
    user_name = Column(String, nullable=False)
    level = Column(Integer, nullable=False)  # 1..5
    emoji = Column(String, nullable=False)
    energy = Column(Integer, default=70)
    stress = Column(Integer, default=30)
    workload = Column(Integer, default=50)
    note = Column(String, nullable=True)
    date = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
