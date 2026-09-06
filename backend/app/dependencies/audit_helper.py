"""
NARCHI V5 — FastAPI Audit Helper & Dependency.
Automates extraction of request metadata (Client IP, User-Agent, Tenant Context)
and hooks background execution for security-sensitive endpoints.
"""

from fastapi import Request, BackgroundTasks, Depends
from typing import Optional, Callable

from app.models.user import User
from app.core.security import get_current_user
from app.services.audit_service import AuditService

class AuditHelper:
    """
    Dépendance FastAPI d'audit réutilisable et paramétrable.
    Extrait de manière unifiée et hermétique les attributs requis pour la conformité SOC2.
    """
    def __init__(self, action: str):
        self.action = action

    def __call__(
        self,
        request: Request,
        background_tasks: BackgroundTasks,
        current_user: User = Depends(get_current_user)
    ) -> Callable[[Optional[dict]], None]:
        """
        Dépendance injectable qui retourne une fonction de traçage (logger).
        Détecte correctement l'IP client d'origine derrière les proxies inverses (reverse-proxies)
        en gérant l'en-tête 'X-Forwarded-For'.
        """
        # Résolution de l'adresse IP client réelle (Nginx/Cloudflare Ingress)
        x_forwarded_for = request.headers.get("x-forwarded-for")
        if x_forwarded_for:
            # On prend la première IP qui correspond à l'IP d'origine du client
            ip_address = x_forwarded_for.split(",")[0].strip()
        else:
            ip_address = request.client.host if request.client else "unknown"

        user_agent = request.headers.get("user-agent", "unknown")

        def logger(payload: Optional[dict] = None) -> None:
            """
            Fonction callable retournée à la route pour planifier la persistance asynchrone.
            """
            AuditService.log_action(
                background_tasks=background_tasks,
                tenant_id=current_user.tenant_id,
                user_id=current_user.id,
                action=self.action,
                ip_address=ip_address,
                user_agent=user_agent,
                payload=payload
            )

        return logger
