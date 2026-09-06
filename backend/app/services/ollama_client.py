"""§244 — petit LLM local (Ollama). 8 Go: llama3.2:3b. 16 Go: llama3.1:8b."""
from __future__ import annotations

import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

DEFAULT_SMALL_MODEL = "llama3.2:3b"
DEFAULT_16G_MODEL = "llama3.1:8b"


def llm_runtime_status() -> dict:
    from app.config import settings

    cloud = bool(getattr(settings, "LLM_CLOUD_ENABLED", False)) and bool(
        getattr(settings, "OPENAI_API_KEY", "")
    )
    ollama = (getattr(settings, "OLLAMA_BASE_URL", "") or "").strip()
    model = getattr(settings, "LLM_MODEL", "") or DEFAULT_SMALL_MODEL
    if cloud:
        mode = "cloud"
    elif ollama:
        mode = "ollama"
    else:
        mode = "off"
    return {
        "mode": mode,
        "model": model if mode == "ollama" else ("openai" if mode == "cloud" else ""),
        "ollama_url": ollama if mode == "ollama" else "",
        "cloud_enabled": cloud,
    }


def ollama_chat(base_url: str, model: str, prompt: str, timeout_s: int = 60) -> str:
    url = base_url.rstrip("/") + "/api/chat"
    body = json.dumps(
        {
            "model": model or DEFAULT_SMALL_MODEL,
            "stream": False,
            "messages": [{"role": "user", "content": prompt}],
        }
    ).encode("utf-8")
    req = Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urlopen(req, timeout=timeout_s) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except HTTPError as exc:
        raise RuntimeError(f"Ollama HTTP {exc.code}") from exc
    except URLError as exc:
        raise RuntimeError("Ollama nicht erreichbar") from exc
    msg = data.get("message") or {}
    text = msg.get("content") if isinstance(msg, dict) else None
    if not isinstance(text, str) or not text.strip():
        raise RuntimeError("Ollama lieferte keinen Text")
    return text.strip()
