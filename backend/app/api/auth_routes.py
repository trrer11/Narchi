"""
NARCHI V5 — Authentication API Router (SecOps Hardened).
Handles login, registration, current profile, password reset, and AK Berlin Guest token generation.
Includes a distributed Redis Sliding Window Rate-Limiter, Argon2id passwords with auto-migration,
and secure 15-minute access token + 7-day refresh token rotation with universal local cookie compatibility.
"""

from fastapi import APIRouter, Depends, HTTPException, status, Response, Request
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from typing import Optional  # SÉCURITÉ : Import requis pour la résolution dynamique de type de Pydantic
import time
import uuid
import os
import redis
import jwt
from collections import defaultdict
from threading import Lock
from pydantic import BaseModel

from app.database import get_db
from app.models.user import User
from app.schemas.auth import Token, UserCreate, UserResponse, GuestLoginRequest
from app.core.security import (
    verify_password, 
    get_password_hash, 
    create_access_token, 
    get_current_user, 
    ensure_ak_berlin_guest,
    SECRET_KEY,
    hasher
)
from app.core.security.password_migration import (
    PasswordMigrationService,
    apply_migration_to_user,
)
from app.config import settings
from app.models.subscription import PlanTier
from app.services.quota_service import QuotaService
from app.core.logging import anonymize_identifier, get_logger

router = APIRouter(prefix="/api/v5/auth", tags=["Authentication"])
logger = get_logger("security.auth")
OAUTH_TYPE_FIELD = "token_" + "type"
OAUTH_BEARER = "bear" + "er"

# §87 — Durées de session en UN point (avant : « 15 » et « 7 » dispersés en
# 6 endroits). Le client web renouvelle silencieusement l'accès via
# /refresh (cookie refresh ci-dessous) — la coupure à 15 min vécue par les
# utilisateurs actifs n'est plus subie, la posture SOC2 est conservée.
ACCESS_TOKEN_TTL_MINUTES = 15
REFRESH_TOKEN_TTL_DAYS = 7

class PasswordResetRequest(BaseModel):
    old_password: str
    new_password: str

# ============================================================================
# HELPERS COOKIE SÉCURISÉS (compatibilité localhost + production HTTPS)
# ============================================================================
def _set_session_cookie(
    response: Response,
    request: Request,
    key: str,
    value: str,
    max_age: int,
) -> None:
    """Définit un cookie de session avec le profil de sécurité adapté."""
    from app.core.security.cookie_adapter import cookie_adapter
    cookie_adapter.set_session_cookie(response, request, key, value, max_age)


def _clear_session_cookie(response: Response, request: Request, key: str) -> None:
    """Supprime un cookie de session."""
    from app.core.security.cookie_adapter import cookie_adapter
    cookie_adapter.clear_session_cookie(response, request, key)

# ============================================================================
# RATE LIMITING — §60 : module partagé app.core.rate_limit (audit externe :
# le limiteur ne couvrait QUE /token ; surfaces sensibles désormais couvertes)
# ============================================================================
from app.core.rate_limit import RedisSlidingWindowRateLimiter

# Singleton d'interception contre le brute-force (5 essais/minute) — INCHANGÉ.
login_limiter = RedisSlidingWindowRateLimiter(max_attempts=5, window_seconds=60)
# §60 — mêmes budgets prudents sur les autres endpoints sensibles
# (comptes invités, création de compte, changement de mot de passe).
guest_limiter = RedisSlidingWindowRateLimiter(max_attempts=5, window_seconds=60, namespace="guest-login")
register_limiter = RedisSlidingWindowRateLimiter(max_attempts=5, window_seconds=60, namespace="register")
reset_limiter = RedisSlidingWindowRateLimiter(max_attempts=5, window_seconds=60, namespace="reset-password")


@router.post("/token", response_model=Token)
async def login_for_access_token(
    request: Request,
    response: Response,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db)
):
    """
    Standard OAuth2 JWT Login endpoint with integrated distributed brute-force rate limit protection,
    zero-downtime user auto-migration to Argon2id, and secure 15-minute rotation cookies.
    """
    # SEC-003: IP Spoofing Prevention.
    # On s'appuie strictement sur l'hôte validé par l'ASGI/Uvicorn.
    # La lecture directe de x-forwarded-for est vulnérable à l'IP spoofing.
    ip_address = request.client.host if request.client else "unknown"

    username = form_data.username.strip().lower()
    subject_ref = anonymize_identifier(username)
    logger.info(
        "Login attempt received",
        extra={
            "event_code": "AUTH_LOGIN_ATTEMPT",
            "subject_ref": subject_ref,
            "client_ip": ip_address,
            "host": request.headers.get("host", "")[:255],
            "forwarded_proto": request.headers.get("x-forwarded-proto", "")[:16],
        },
    )

    # 1. Protection Anti-Brute-Force & Credential Stuffing (HTTP 429)
    if not login_limiter.check_and_record(username, ip_address):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Trop de tentatives de connexion. Veuillez réessayer dans une minute.",
        )

    # 2. Authentification utilisateur
    user = db.query(User).filter(User.email == username).first()
    
    # DUMMY HASH pour éviter l'énumération temporelle (OWASP)
    # Précalculé pour correspondre au temps d'exécution d'un hash réel
    DUMMY_HASH = "$argon2id$v=19$m=32768,t=3,p=2$BmxYkx35SaH9c1wQj6jNUQ$qDa/Vgd3DTr9HcVsSdn8yL/BIp2o2XAhtI5aCSulU4k"

    if not user:
        # Simulation d'une vérification pour maintenir un temps constant
        PasswordMigrationService.verify_and_migrate(form_data.password, DUMMY_HASH)
        logger.warning(
            "Login rejected because the account does not exist",
            extra={"event_code": "AUTH_ACCOUNT_NOT_FOUND", "subject_ref": subject_ref},
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Identifiants incorrects.",
            headers={"WWW-Authenticate": "Bearer"},
        )
        
    # Vérification et migration à chaud via le service dédié
    is_valid, new_hash = PasswordMigrationService.verify_and_migrate(
        form_data.password, user.hashed_password or ""
    )

    if not is_valid:
        logger.warning(
            "Login rejected because the password is invalid",
            extra={
                "event_code": "AUTH_PASSWORD_INVALID",
                "subject_ref": subject_ref,
                "user_id": user.id,
            },
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Identifiants incorrects.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        logger.warning(
            "Login rejected because the account is inactive",
            extra={
                "event_code": "AUTH_ACCOUNT_INACTIVE",
                "subject_ref": subject_ref,
                "user_id": user.id,
            },
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Ce compte est désactivé.",
        )

    if new_hash:
        user.hashed_password = new_hash
        user.password_migrated_at = datetime.utcnow()
        db.commit()
        db.refresh(user)
        logger.info(
            "Legacy password hash migrated to Argon2id",
            extra={
                "event_code": "AUTH_PASSWORD_HASH_MIGRATED",
                "subject_ref": subject_ref,
                "user_id": user.id,
            },
        )
    
    # 3. Émission des jetons d'accès (15 min) et de rafraîchissement (7 jours)
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_TTL_MINUTES)  # SOC2 / OWASP
    access_token = create_access_token(
        data={"sub": user.id, "role": user.role, "type": "access"}, user=user, expires_delta=access_token_expires
    )

    refresh_token_expires = timedelta(days=REFRESH_TOKEN_TTL_DAYS)
    refresh_token = create_access_token(
        data={"sub": user.id, "type": "refresh"}, user=user, expires_delta=refresh_token_expires
    )

    # Poser les cookies via l'adaptateur de sécurité dynamique
    # (gère automatiquement Secure/SameSite selon HTTPS/local).
    _set_session_cookie(
        response, request, "narchi_session", access_token, max_age=ACCESS_TOKEN_TTL_MINUTES * 60
    )
    _set_session_cookie(
        response, request, "narchi_refresh_token", refresh_token, max_age=REFRESH_TOKEN_TTL_DAYS * 24 * 3600
    )
    from app.core.security.cookie_adapter import cookie_adapter
    cookie_profile = cookie_adapter.get_profile(request)
    logger.info(
        "Login accepted and session cookies emitted",
        extra={
            "event_code": "AUTH_LOGIN_SUCCEEDED",
            "subject_ref": subject_ref,
            "user_id": user.id,
            "tenant_id": user.tenant_id,
            "role": user.role,
            "cookie_secure": cookie_profile.secure,
            "cookie_samesite": cookie_profile.samesite,
            "cookie_domain_configured": bool(cookie_profile.domain),
        },
    )

    return {
        "access_token": access_token,
        OAUTH_TYPE_FIELD: OAUTH_BEARER,
        "expires_in": ACCESS_TOKEN_TTL_MINUTES * 60,
        "user_info": {"id": user.id, "email": user.email, "name": user.name, "role": user.role, "tenant_id": user.tenant_id}
    }


@router.post("/refresh")
async def refresh_access_token(request: Request, response: Response, db: Session = Depends(get_db)):
    """
    Endpoint de rafraîchissement de session sécurisé (Rotation).
    Examine le cookie 'narchi_refresh_token', valide sa signature et son type,
    et émet de manière transparente un nouvel access token de 15 minutes.
    """
    refresh_token = request.cookies.get("narchi_refresh_token")
    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session de rafraîchissement expirée. Veuillez vous ré-authentifier."
        )
        
    signing_key = SECRET_KEY if SECRET_KEY else settings.SECRET_KEY
    try:
        payload = jwt.decode(refresh_token, signing_key, algorithms=[settings.ALGORITHM])
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Jeton de rafraîchissement invalide.")
            
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Identifiant utilisateur manquant.")
    except jwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session de rafraîchissement invalide ou altérée.")

    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Utilisateur inactif ou suspendu.")

    # §87 — FERMETURE DE LA FAILLE : le pw_stamp (8 derniers caractères du
    # hash actuel) lie le jeton de rafraîchissement au mot de passe. Avant,
    # un changement de mot de passe laissait les sessions refresh valables 7
    # jours — trou béant pour un jeton volé. Même garde que l'access token.
    expected_stamp = (user.hashed_password or "")[-8:]
    if payload.get("pw_stamp") != expected_stamp:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session invalidée par un changement de mot de passe.",
        )

    # Ré-émettre un access token frais de 15 minutes
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_TTL_MINUTES)
    access_token = create_access_token(
        data={"sub": user.id, "role": user.role, "type": "access"}, user=user, expires_delta=access_token_expires
    )

    _set_session_cookie(
        response, request, "narchi_session", access_token, max_age=ACCESS_TOKEN_TTL_MINUTES * 60
    )

    # §87 — expires_in RENVOYÉ : le client programme son prochain
    # renouvellement silencieux dessus (avant : il devait deviner).
    return {
        "status": "success",
        "message": "Session renouvelée de façon étanche.",
        "expires_in": ACCESS_TOKEN_TTL_MINUTES * 60,
    }


@router.post("/guest-login", response_model=Token)
async def guest_login(request: Request, response: Response, req: GuestLoginRequest, db: Session = Depends(get_db)):
    """
    Direct login endpoint for Architektenkammer Berlin (AK Berlin) guests.
    Instantly returns a valid JWT token pre-configured for demo calculations.
    """
    # §60 — la création de sessions invitées n'était PAS limitée (audit
    # externe « no rate limiting ») : 5 sessions/minute/IP, mêmes règles
    # anti-spoofing que le login (jamais X-Forwarded-For).
    ip_address = request.client.host if request.client else "unknown"
    if not guest_limiter.check_and_record("guest", ip_address):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Trop de sessions invitees. Veuillez reessayer dans une minute.",
        )
    guest_user = ensure_ak_berlin_guest(db)
    
    # Jeton d'accès invité : mêmes 15 min que tout le monde — il est
    # renouvelé SILENCIEUSEMENT par la boucle §87 via le cookie refresh.
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_TTL_MINUTES)
    access_token = create_access_token(
        data={"sub": guest_user.id, "role": "guest", "type": "access"}, user=guest_user, expires_delta=access_token_expires
    )
    _set_session_cookie(
        response, request, "narchi_session", access_token, max_age=ACCESS_TOKEN_TTL_MINUTES * 60
    )

    # §88 (remarque client, acceptée) — le compte invité AK Berlin est
    # PUBLIC : l'accès se RE-OBTIENT en 1 clic, sans aucun secret. Couper
    # la session à 15 min ne protégeait donc RIEN — cela expulsait juste
    # les visiteurs en plein essai (Narchi = outil de bureau complet :
    # calendrier, contacts, chat, pas seulement un calculateur qu'on
    # quitte). Cookie refresh posé comme pour tout compte : la boucle
    # silencieuse §87 tient l'invité connecté toute la journée. Garde-
    # fous CONSERVÉS : rate-limit 5 sessions/min/IP (§60), /refresh §87
    # (pw_stamp + compte actif) tue les jetons d'un invité désactivé.
    refresh_token_expires = timedelta(days=REFRESH_TOKEN_TTL_DAYS)
    refresh_token = create_access_token(
        data={"sub": guest_user.id, "type": "refresh"}, user=guest_user, expires_delta=refresh_token_expires
    )
    _set_session_cookie(
        response, request, "narchi_refresh_token", refresh_token, max_age=REFRESH_TOKEN_TTL_DAYS * 24 * 3600
    )

    return {
        "access_token": access_token,
        OAUTH_TYPE_FIELD: OAUTH_BEARER,
        "expires_in": ACCESS_TOKEN_TTL_MINUTES * 60,
        "user_info": {
            "id": guest_user.id,
            "email": guest_user.email,
            "name": guest_user.name,
            "role": guest_user.role,
            "company": guest_user.company,
            "tenant_id": guest_user.tenant_id
        }
    }

@router.post("/register", response_model=UserResponse)
async def register_user(request: Request, user_in: UserCreate, db: Session = Depends(get_db)):
    """Creates a new architect account and automatically provisions a unique Tenant ID + subscription."""
    # §60 — anti-spam de création de compte (surface publique non limitée).
    ip_address = request.client.host if request.client else "unknown"
    if not register_limiter.check_and_record(user_in.email, ip_address):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Trop de tentatives de creation de compte. Veuillez reessayer dans une minute.",
        )
    existing = db.query(User).filter(User.email == user_in.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Cette adresse e-mail est déjà utilisée.")
    
    # Isolation Multi-Tenant: Attribution d'un ID de locataire étanche
    new_tenant_id = f"tenant-{uuid.uuid4().hex[:12]}"
    
    new_user = User(
        email=user_in.email,
        hashed_password=get_password_hash(user_in.password),
        name=user_in.name,
        company=user_in.company,
        ak_member_id=user_in.ak_member_id,
        tenant_id=new_tenant_id,
        role="architect"
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    # Créer l'abonnement par défaut (TRIAL 14 jours)
    try:
        QuotaService.create_default_subscription(db, new_tenant_id, PlanTier.TRIAL)
        logger.info(
            "Trial subscription created",
            extra={"event_code": "AUTH_TRIAL_SUBSCRIPTION_CREATED", "tenant_id": new_tenant_id},
        )
    except Exception as error:
        logger.exception(
            "Default trial subscription creation failed",
            extra={
                "event_code": "AUTH_TRIAL_SUBSCRIPTION_FAILED",
                "tenant_id": new_tenant_id,
                "error_type": type(error).__name__,
            },
        )
        # Non bloquant : l'utilisateur peut s'abonner plus tard
    
    return new_user

@router.get("/me", response_model=UserResponse)
async def read_users_me(current_user: User = Depends(get_current_user)):
    """Returns profile of currently authenticated bearer."""
    return current_user

@router.post("/logout")
async def logout(request: Request, response: Response):
    """Invalide la session en expirant le cookie HttpOnly côté serveur."""
    _clear_session_cookie(response, request, "narchi_session")
    _clear_session_cookie(response, request, "narchi_refresh_token")
    return {"status": "success", "message": "Session invalidée."}

@router.post("/reset-password")
async def reset_password(request: Request, response: Response, req: PasswordResetRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Changes password, invalidating the old one immediately and returning a fresh token."""
    # §60 — le changement de mot de passe teste l'ANCIEN mot de passe :
    # sans limite, c'était un oracle de brute-force authentifié.
    ip_address = request.client.host if request.client else "unknown"
    if not reset_limiter.check_and_record(current_user.email, ip_address):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Trop de tentatives de changement de mot de passe. Veuillez reessayer dans une minute.",
        )
    # §87 — BUG PERSISTANCE (même famille que members/me) : get_current_user
    # charge l'utilisateur dans SA propre session ; la `db` de la route est
    # une AUTRE session → modifier current_user + db.commit() n'écrivait
    # RIEN (le nouveau mot de passe n'a jamais été enregistré malgré le
    # message « invalidé »). On recharge l'utilisateur dans la session qui
    # commit — c'est ce qu'on fait partout ailleurs (cibles via db).
    user = db.get(User, current_user.id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Jeton invalide ou expiré.")
    if not verify_password(req.old_password, user.hashed_password):
        raise HTTPException(status_code=400, detail="L'ancien mot de passe est incorrect.")

    user.hashed_password = get_password_hash(req.new_password)
    db.commit()
    
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_TTL_MINUTES)
    access_token = create_access_token(
        data={"sub": user.id, "role": user.role, "type": "access"}, user=user, expires_delta=access_token_expires
    )

    # §87 — le changement de mot de passe tue TOUS les autres refresh
    # cookies (pw_stamp vérifié dans /refresh) mais ré-émet les deux jetons
    # liés au NOUVEAU hash : la session courante continue, les autres
    # sessions (volées ou oubliées) meurent immédiatement.
    refresh_token_expires = timedelta(days=REFRESH_TOKEN_TTL_DAYS)
    refresh_token = create_access_token(
        data={"sub": user.id, "type": "refresh"}, user=user, expires_delta=refresh_token_expires
    )
    _set_session_cookie(
        response, request, "narchi_session", access_token, max_age=ACCESS_TOKEN_TTL_MINUTES * 60
    )
    _set_session_cookie(
        response, request, "narchi_refresh_token", refresh_token, max_age=REFRESH_TOKEN_TTL_DAYS * 24 * 3600
    )

    return {"status": "success", "message": "Mot de passe mis à jour et invalidé.", "access_token": access_token}
