"""
NARCHI V5 — Configuration CORS centralisée.
Définit explicitement toutes les origines, méthodes et en-têtes custom
pour éviter les échecs de preflight OPTIONS.
"""

from __future__ import annotations

from typing import List

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware


def configure_cors(app: FastAPI, allowed_origins: List[str]) -> None:
    """
    Configure le middleware CORS pour NARCHI.

    CRITIQUE : allow_headers doit contenir EXPLICITEMENT tous les en-têtes
    custom envoyés par le client, sinon la requête preflight OPTIONS
    retourne 400 et le client voit une "CORS Error" trompeuse.
    """
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
        allow_headers=[
            # Standard
            "Content-Type",
            "Authorization",
            "Accept",
            "Origin",
            "X-Requested-With",
            # En-têtes NARCHI custom
            "X-Tenant-ID",
            "X-Request-ID",
            "X-Client-Version",
            "X-Session-ID",
            # Sécurité
            "X-CSRF-Token",
            "X-Idempotency-Key",
            # Uploads
            "X-Upload-Content-Type",
            "X-Upload-Content-Length",
            "X-File-Name",
        ],
        expose_headers=[
            "X-Request-ID",
            "X-Rate-Limit-Remaining",
            "X-Rate-Limit-Reset",
            "X-Total-Count",
            "X-Cursor",
        ],
        allow_credentials=True,
        max_age=3600,
    )
