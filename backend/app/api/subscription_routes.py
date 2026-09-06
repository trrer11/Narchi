"""
NARCHI V5 — Subscription Management API
=======================================
Gestion des abonnements et plans tarifaires (FinOps).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Header, Request, status
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timedelta
from pydantic import BaseModel, ConfigDict, Field

from app.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.subscription import (
    SubscriptionPlan, Subscription, PlanTier, SubscriptionStatus,
    DEFAULT_PLANS
)
from app.services.quota_service import QuotaService
from app.services.stripe_service import stripe_billing_service
from app.config import settings

router = APIRouter(prefix="/api/v5/billing", tags=["Billing & Subscriptions"])


# =============================================================================
# PYDANTIC SCHEMAS
# =============================================================================

class PlanResponse(BaseModel):
    tier: str
    name: str
    description: Optional[str]
    storage_quota_gb: int
    max_projects: int
    max_team_members: int
    max_api_calls_per_month: int
    has_advanced_analytics: bool
    has_priority_support: bool
    has_sso: bool
    has_custom_branding: bool
    price_monthly_eur: float
    price_yearly_eur: float
    is_active: bool

    model_config = ConfigDict(from_attributes=True)


class SubscriptionResponse(BaseModel):
    id: str
    plan_tier: str
    plan_name: str
    status: str
    billing_cycle_start: str
    billing_cycle_end: str
    canceled_at: Optional[str]
    cancel_at_period_end: bool
    storage_quota_gb: int
    max_projects: int
    storage_quota_override_gb: Optional[int]
    max_projects_override: Optional[int]

    model_config = ConfigDict(from_attributes=True)


class QuotaStatusResponse(BaseModel):
    tenant_id: str
    plan_name: str
    quota_limit_bytes: int
    current_usage_bytes: int
    remaining_bytes: int
    usage_percentage: float
    is_over_quota: bool
    is_near_limit: bool
    status: str


class CreateSubscriptionRequest(BaseModel):
    plan_tier: str = Field(..., pattern="^(solo|agency|enterprise)$")


class UpgradeSubscriptionRequest(BaseModel):
    plan_tier: str = Field(..., pattern="^(solo|agency|enterprise)$")


class CancelSubscriptionRequest(BaseModel):
    cancel_at_period_end: bool = True


class CheckoutRequest(BaseModel):
    plan_tier: str = Field(..., pattern="^(solo|agency|enterprise)$")
    billing_period: str = Field("month", pattern="^(month|year)$")


class CheckoutResponse(BaseModel):
    checkout_url: str


class WebhookResponse(BaseModel):
    received: bool


# =============================================================================
# STRIPE CHECKOUT & WEBHOOK
# =============================================================================

@router.post("/checkout", response_model=CheckoutResponse, status_code=status.HTTP_201_CREATED)
def create_checkout(
    req: CheckoutRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    plan = db.query(SubscriptionPlan).filter(
        SubscriptionPlan.tier == PlanTier(req.plan_tier),
        SubscriptionPlan.is_active.is_(True),
    ).first()
    if plan is None:
        raise HTTPException(status_code=404, detail="Plan indisponible")

    checkout_url = stripe_billing_service.create_checkout_session(
        tenant_id=current_user.tenant_id,
        customer_email=current_user.email,
        plan=plan,
        billing_period=req.billing_period,
    )
    return CheckoutResponse(checkout_url=checkout_url)


@router.post("/webhook", response_model=WebhookResponse)
async def stripe_webhook(
    request: Request,
    stripe_signature: str = Header(..., alias="Stripe-Signature"),
    db: Session = Depends(get_db),
):
    payload = await request.body()
    event = stripe_billing_service.construct_webhook_event(payload, stripe_signature)
    try:
        stripe_billing_service.apply_webhook(event, db)
    except Exception as error:
        db.rollback()
        raise HTTPException(status_code=500, detail="Échec de synchronisation Stripe") from error
    return WebhookResponse(received=True)


# =============================================================================
# ENDPOINTS PLANS
# =============================================================================

@router.get("/plans", response_model=List[PlanResponse])
def get_plans(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Liste tous les plans tarifaires disponibles."""
    plans = db.query(SubscriptionPlan).filter(
        SubscriptionPlan.is_active == True
    ).order_by(SubscriptionPlan.tier).all()

    return [
        PlanResponse(
            tier=p.tier.value,
            name=p.name,
            description=p.description,
            storage_quota_gb=p.storage_quota_bytes // (1024**3),
            max_projects=p.max_projects,
            max_team_members=p.max_team_members,
            max_api_calls_per_month=p.max_api_calls_per_month,
            has_advanced_analytics=p.has_advanced_analytics,
            has_priority_support=p.has_priority_support,
            has_sso=p.has_sso,
            has_custom_branding=p.has_custom_branding,
            price_monthly_eur=p.price_monthly_cents / 100,
            price_yearly_eur=p.price_yearly_cents / 100,
            is_active=p.is_active
        )
        for p in plans
    ]


@router.get("/plans/{tier}", response_model=PlanResponse)
def get_plan(
    tier: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Détail d'un plan."""
    try:
        plan_tier = PlanTier(tier.lower())
    except ValueError:
        raise HTTPException(400, f"Tier invalide: {tier}")

    plan = db.query(SubscriptionPlan).filter(
        SubscriptionPlan.tier == plan_tier,
        SubscriptionPlan.is_active == True
    ).first()

    if not plan:
        raise HTTPException(404, f"Plan {tier} non trouvé")

    return PlanResponse(
        tier=plan.tier.value,
        name=plan.name,
        description=plan.description,
        storage_quota_gb=plan.storage_quota_bytes // (1024**3),
        max_projects=plan.max_projects,
        max_team_members=plan.max_team_members,
        max_api_calls_per_month=plan.max_api_calls_per_month,
        has_advanced_analytics=plan.has_advanced_analytics,
        has_priority_support=plan.has_priority_support,
        has_sso=plan.has_sso,
        has_custom_branding=plan.has_custom_branding,
        price_monthly_eur=plan.price_monthly_cents / 100,
        price_yearly_eur=plan.price_yearly_cents / 100,
        is_active=plan.is_active
    )


# =============================================================================
# ENDPOINTS ABONNEMENT UTILISATEUR
# =============================================================================

@router.get("/subscription", response_model=SubscriptionResponse)
def get_my_subscription(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Récupère l'abonnement de l'utilisateur connecté."""
    sub = QuotaService.get_tenant_subscription(db, current_user.tenant_id)

    if not sub:
        # Retourner info plan TRIAL par défaut
        trial_plan = db.query(SubscriptionPlan).filter(
            SubscriptionPlan.tier == PlanTier.TRIAL
        ).first()
        return SubscriptionResponse(
            id="none",
            plan_tier=PlanTier.TRIAL.value,
            plan_name=trial_plan.name if trial_plan else "Essai Gratuit",
            status=SubscriptionStatus.TRIALING.value,
            billing_cycle_start="",
            billing_cycle_end="",
            canceled_at=None,
            cancel_at_period_end=False,
            storage_quota_gb=0,
            max_projects=0,
            storage_quota_override_gb=None,
            max_projects_override=None
        )

    return SubscriptionResponse(
        id=sub.id,
        plan_tier=sub.plan.tier.value,
        plan_name=sub.plan.name,
        status=sub.status.value,
        billing_cycle_start=sub.billing_cycle_start.isoformat() if sub.billing_cycle_start else "",
        billing_cycle_end=sub.billing_cycle_end.isoformat() if sub.billing_cycle_end else "",
        canceled_at=sub.canceled_at.isoformat() if sub.canceled_at else None,
        cancel_at_period_end=sub.cancel_at_period_end,
        storage_quota_gb=sub.plan.storage_quota_bytes // (1024**3),
        max_projects=sub.plan.max_projects,
        storage_quota_override_gb=sub.storage_quota_override_bytes // (1024**3) if sub.storage_quota_override_bytes else None,
        max_projects_override=sub.max_projects_override
    )


@router.get("/subscription/quota", response_model=QuotaStatusResponse)
def get_quota_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Statut détaillé du quota de stockage (pour UI barre de progression)."""
    status = QuotaService.get_quota_status(db, current_user.tenant_id)
    return status


@router.post("/subscription", response_model=SubscriptionResponse)
def create_subscription(
    req: CreateSubscriptionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Crée un nouvel abonnement (upgrade depuis TRIAL)."""
    # Vérifier qu'il n'y a pas déjà un abonnement actif
    existing = QuotaService.get_tenant_subscription(db, current_user.tenant_id)
    if existing and existing.status in [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING]:
        raise HTTPException(400, "Un abonnement existe déjà. Utilisez PUT pour modifier.")

    try:
        plan_tier = PlanTier(req.plan_tier.lower())
    except ValueError:
        raise HTTPException(400, f"Plan invalide: {req.plan_tier}")

    if settings.ENVIRONMENT.lower() == "production":
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Utilisez /api/v5/billing/checkout pour activer un plan payant.",
        )

    sub = QuotaService.create_default_subscription(db, current_user.tenant_id, plan_tier)

    return SubscriptionResponse(
        id=sub.id,
        plan_tier=sub.plan.tier.value,
        plan_name=sub.plan.name,
        status=sub.status.value,
        billing_cycle_start=sub.billing_cycle_start.isoformat(),
        billing_cycle_end=sub.billing_cycle_end.isoformat(),
        canceled_at=None,
        cancel_at_period_end=False,
        storage_quota_gb=sub.plan.storage_quota_bytes // (1024**3),
        max_projects=sub.plan.max_projects,
        storage_quota_override_gb=None,
        max_projects_override=None
    )


@router.put("/subscription", response_model=SubscriptionResponse)
def upgrade_subscription(
    req: UpgradeSubscriptionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Upgrade/downgrade l'abonnement."""
    sub = QuotaService.get_tenant_subscription(db, current_user.tenant_id)
    if not sub:
        raise HTTPException(404, "Aucun abonnement trouvé")

    try:
        plan_tier = PlanTier(req.plan_tier.lower())
    except ValueError:
        raise HTTPException(400, f"Plan invalide: {req.plan_tier}")

    # Changer le plan
    new_plan = db.query(SubscriptionPlan).filter(
        SubscriptionPlan.tier == plan_tier,
        SubscriptionPlan.is_active == True
    ).first()

    if not new_plan:
        raise HTTPException(404, f"Plan {req.plan_tier} non trouvé")

    if settings.ENVIRONMENT.lower() == "production":
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Les changements de plan sont gérés par Stripe Checkout/Portal.",
        )

    sub.plan_id = new_plan.id
    sub.status = SubscriptionStatus.ACTIVE
    sub.billing_cycle_start = datetime.utcnow()
    sub.billing_cycle_end = datetime.utcnow() + timedelta(days=30)
    sub.cancel_at_period_end = False
    sub.canceled_at = None

    db.commit()
    db.refresh(sub)

    return SubscriptionResponse(
        id=sub.id,
        plan_tier=sub.plan.tier.value,
        plan_name=sub.plan.name,
        status=sub.status.value,
        billing_cycle_start=sub.billing_cycle_start.isoformat(),
        billing_cycle_end=sub.billing_cycle_end.isoformat(),
        canceled_at=None,
        cancel_at_period_end=sub.cancel_at_period_end,
        storage_quota_gb=sub.plan.storage_quota_bytes // (1024**3),
        max_projects=sub.plan.max_projects,
        storage_quota_override_gb=sub.storage_quota_override_bytes // (1024**3) if sub.storage_quota_override_bytes else None,
        max_projects_override=sub.max_projects_override
    )


@router.post("/subscription/cancel", response_model=SubscriptionResponse)
def cancel_subscription(
    req: CancelSubscriptionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Annule l'abonnement (à la fin de la période ou immédiatement)."""
    sub = QuotaService.get_tenant_subscription(db, current_user.tenant_id)
    if not sub:
        raise HTTPException(404, "Aucun abonnement trouvé")

    if settings.ENVIRONMENT.lower() == "production":
        stripe_billing_service.cancel_subscription(sub, req.cancel_at_period_end)

    if req.cancel_at_period_end:
        sub.cancel_at_period_end = True
    else:
        sub.status = SubscriptionStatus.CANCELED
        sub.canceled_at = datetime.utcnow()

    db.commit()
    db.refresh(sub)

    return SubscriptionResponse(
        id=sub.id,
        plan_tier=sub.plan.tier.value,
        plan_name=sub.plan.name,
        status=sub.status.value,
        billing_cycle_start=sub.billing_cycle_start.isoformat() if sub.billing_cycle_start else "",
        billing_cycle_end=sub.billing_cycle_end.isoformat() if sub.billing_cycle_end else "",
        canceled_at=sub.canceled_at.isoformat() if sub.canceled_at else None,
        cancel_at_period_end=sub.cancel_at_period_end,
        storage_quota_gb=sub.plan.storage_quota_bytes // (1024**3),
        max_projects=sub.plan.max_projects,
        storage_quota_override_gb=sub.storage_quota_override_bytes // (1024**3) if sub.storage_quota_override_bytes else None,
        max_projects_override=sub.max_projects_override
    )