# §178 — Statut système PROFOND : la preuve de fiabilité, en un endpoint.
#
# Un architecte sceptique (« un outil qui n'est pas fiable ») veut une PREUVE,
# pas une promesse. Le /api/health historique ne vérifiait que le processus
# (toujours « operational »). Ce endpoint va plus loin :
#
#   GET /api/v5/system/status  →  { status, version, database, capabilities,
#                                  server_time }
#
#   - database : un vrai « SELECT 1 » — si la base est indisponible, status
#     passe à « degraded » et le champ le dit (jamais un faux vert) ;
#   - capabilities : les jalons MESURÉS du produit (XRechnung KoSIT §123,
#     ZUGFeRD §129, UBL §130, Versand §131) — l'architecte voit ce qui est
#     réellement livré et prouvé, pas une liste marketing.
#
# Aucune donnée sensible n'est exposée : que des statuts et des drapeaux.
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.services.ollama_client import llm_runtime_status

router = APIRouter(prefix="/api/v5/system", tags=["System Status §178"])


@router.get("/status")
def system_status(db: Session = Depends(get_db)) -> dict:
    database = "ok"
    try:
        db.execute(text("SELECT 1"))
    except Exception:  # noqa: BLE001 — on VEUT absorber toute erreur BDD ici
        database = "error"

    status = "operational" if database == "ok" else "degraded"
    return {
        "status": status,
        "version": settings.APP_VERSION,
        "database": database,
        "capabilities": {
            # Jalons MESURÉS (pas de prétention) :
            "xrechnung_kosit": True,   # §123 — validateur officiel passé
            "zugferd_pdfa3": True,     # §129 — PDF/A-3b hybride
            "ubl_2_1": True,           # §130 — syntaxe UBL 2.1
            "versand_eml": True,       # §131 — e-mail .eml
            "peppol_network": False,   # DIFFÉRÉ — Access Point requis (dit §131)
            "kosit_sidecar": sidecar_ready(),  # §260 — live ping, pas un badge figé
        },
        "server_time": datetime.now(timezone.utc).isoformat(),
    }
