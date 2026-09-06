"""
NARCHI V5 — Adaptateur dynamique de sécurité des cookies.
Ajuste Secure / SameSite selon le protocole de la requête.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Literal, Optional

from fastapi import Request, Response

from app.core.logging import get_logger

logger = get_logger("security.cookies")


@dataclass
class CookieSecurityProfile:
    secure: bool
    samesite: Literal["strict", "lax", "none"]
    httponly: bool
    domain: Optional[str]
    path: str
    max_age: int


class CookieSecurityAdapter:
    # §196 — host.docker.internal / narchi.localhost : Chromium E2E dans
    # Docker (pas un loopback, mais jamais une origine publique).
    LOCAL_HOSTS = frozenset(
        {"localhost", "127.0.0.1", "::1", "host.docker.internal", "narchi.localhost"}
    )

    def __init__(self):
        self._env = os.getenv("ENVIRONMENT", "development").lower()
        self._force_secure = os.getenv("FORCE_SECURE_COOKIES", "").lower() == "true"
        self._cookie_domain = os.getenv("COOKIE_DOMAIN", None)

    def _detect_https(self, request: Request) -> bool:
        forwarded_proto = (
            request.headers.get("x-forwarded-proto", "")
            or request.headers.get("x-scheme", "")
        ).lower()
        if forwarded_proto == "https":
            return True
        return request.url.scheme == "https"

    def _detect_local(self, request: Request) -> bool:
        # request.url.hostname retire correctement le port et les crochets IPv6
        # (`[::1]:8080` devient `::1`), contrairement à un simple split(":").
        host = (request.url.hostname or "").strip("[]").lower()
        return host in self.LOCAL_HOSTS

    def get_profile(self, request: Request) -> CookieSecurityProfile:
        is_https = self._detect_https(request)
        is_local = self._detect_local(request)
        is_production = self._env == "production"

        # §198 — Secure UNIQUEMENT si la requete EST en HTTPS.
        # Un cookie Secure pose sur http://host.docker.internal (E2E Docker)
        # ou http://192.168.x (telephone LAN) est jete par TOUT navigateur :
        # login "reussi" puis /auth/me 401. Ce n'est pas de la securite,
        # c'est une session morte. Le drapeau FORCE_SECURE_COOKIES ne peut
        # pas inventer du TLS.
        if not is_https:
            if is_production and not is_local:
                logger.critical(
                    "HTTP session cookie without Secure (no TLS on this hop)",
                    extra={
                        "event_code": "COOKIE_INSECURE_PRODUCTION_REQUEST",
                        "client_ip": request.client.host if request.client else "unknown",
                        "host": request.headers.get("host", "")[:255],
                    },
                )
            return CookieSecurityProfile(
                secure=False,
                samesite="lax",
                httponly=True,
                domain=None,
                path="/",
                max_age=86400 if is_local else 3600,
            )

        return CookieSecurityProfile(
            secure=True,
            samesite="lax",
            httponly=True,
            domain=self._cookie_domain,
            path="/",
            max_age=3600,
        )

    def set_session_cookie(
        self,
        response: Response,
        request: Request,
        cookie_name: str,
        cookie_value: str,
        max_age: Optional[int] = None,
    ) -> None:
        profile = self.get_profile(request)
        response.set_cookie(
            key=cookie_name,
            value=cookie_value,
            httponly=profile.httponly,
            secure=profile.secure,
            samesite=profile.samesite,
            domain=profile.domain,
            path=profile.path,
            max_age=max_age if max_age is not None else profile.max_age,
        )
        logger.info(
            "Session cookie emitted",
            extra={
                "event_code": "AUTH_COOKIE_EMITTED",
                "cookie_name_safe": cookie_name,
                "cookie_secure": profile.secure,
                "cookie_httponly": profile.httponly,
                "cookie_samesite": profile.samesite,
                "cookie_domain_configured": bool(profile.domain),
                "host": request.headers.get("host", "")[:255],
                "request_https": self._detect_https(request),
                "request_local": self._detect_local(request),
            },
        )

    def clear_session_cookie(
        self,
        response: Response,
        request: Request,
        cookie_name: str,
    ) -> None:
        profile = self.get_profile(request)
        response.delete_cookie(
            key=cookie_name,
            httponly=profile.httponly,
            secure=profile.secure,
            samesite=profile.samesite,
            domain=profile.domain,
            path=profile.path,
        )
        logger.info(
            "Session cookie cleared",
            extra={
                "event_code": "AUTH_COOKIE_CLEARED",
                "cookie_name_safe": cookie_name,
                "cookie_secure": profile.secure,
                "host": request.headers.get("host", "")[:255],
            },
        )


cookie_adapter = CookieSecurityAdapter()
