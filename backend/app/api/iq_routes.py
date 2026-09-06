# §245 — IQ : statut LLM + reformulation locale (chiffres déjà calculés).
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.core.security import get_current_user
from app.models.user import User
from app.services.ollama_client import llm_runtime_status, ollama_chat

router = APIRouter(prefix="/api/v5/iq", tags=["NARCHI IQ §245"])


@router.get("/status")
def iq_status(_user: User = Depends(get_current_user)) -> dict:
    return llm_runtime_status()


class IqLocalBody(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    facts: str = Field(default="", max_length=8000)


@router.post("/local")
def iq_local(body: IqLocalBody, _user: User = Depends(get_current_user)) -> dict:
    st = llm_runtime_status()
    if st["mode"] != "ollama":
        return {
            "ok": False,
            "answer": "Kein lokales Modell. Cloud bleibt aus. Ollama optional (llama3.2:3b, 8 GB).",
            "mode": st["mode"],
        }
    prompt = (
        "Du erklärst NUR die gelieferten Fakten auf Deutsch. "
        "Keine neuen Zahlen, keine Maße erfinden. Wenn etwas fehlt, sage es.\n"
        f"Frage: {body.question}\nFakten:\n{body.facts or '(keine)'}"
    )
    try:
        text = ollama_chat(st["ollama_url"], st["model"] or "llama3.2:3b", prompt)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "answer": f"Ollama fehlgeschlagen: {exc}", "mode": "ollama"}
    return {"ok": True, "answer": text, "mode": "ollama", "model": st["model"]}
