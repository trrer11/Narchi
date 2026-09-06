"""
NARCHI V5 — Feedback & Audio API Router.
Handles voice transcription via OpenAI Whisper and 7-question survey storage.
"""

from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional

from app.database import get_db
from app.models.user import User
from app.schemas.feedback import FeedbackSubmitRequest, VoiceTranscribeResponse, MoodSubmitRequest
from app.core.security import get_current_user
from app.core.feedback_engine import transcribe_audio_buffer, process_feedback_entry
from app.models.feedback import MoodCheckin

router = APIRouter(prefix="/api/v5/feedback", tags=["Feedback & Audio Copilot"])

@router.post("/voice/transcribe", response_model=VoiceTranscribeResponse)
async def transcribe_voice_command(
    file: UploadFile = File(...),
    language: str = Form("de")
):
    """
    Receives audio recording (webm/wav/mp3) from browser MediaRecorder
    and transcribes it via server-side Whisper API.
    """
    audio_bytes = await file.read()
    res = await transcribe_audio_buffer(audio_bytes, language)
    return res

@router.post("/submit")
async def submit_feedback(
    req: FeedbackSubmitRequest,
    current_user: Optional[User] = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Saves user answers from the guided 7-question Copilot survey.
    """
    user_id = current_user.id if current_user else None
    user_name = current_user.name if current_user else "Architecte Invité"
    
    entry = process_feedback_entry(req, user_id, user_name, db)
    return {"status": "success", "feedback_id": entry.id, "message": "Merci pour votre précieux retour !"}

@router.post("/mood")
async def submit_mood_checkin(
    req: MoodSubmitRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Saves daily office climate check-in."""
    chk = MoodCheckin(
        user_id=current_user.id,
        user_name=current_user.name,
        level=req.level,
        emoji=req.emoji,
        energy=req.energy,
        stress=req.stress,
        workload=req.workload,
        note=req.note,
        date=req.date
    )
    db.add(chk)
    db.commit()
    return {"status": "ok", "message": "Check-in climat enregistré."}
