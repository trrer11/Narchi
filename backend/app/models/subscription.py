"""
NARCHI V5 — Subscription & Plan Models (FinOps).
Defines tenant subscription plans with storage quotas and feature flags.
Replaces heuristic quota logic with authoritative plan data.
"""

from sqlalchemy import Column, String, Integer, Boolean, DateTime, ForeignKey, Enum as SQLEnum, func, Index
from sqlalchemy.orm import relationship
from app.database import Base
from app.models.tenant_mixin import HasTenantColumn
import enum
import uuid

def generate_uuid():
    return str(uuid.uuid4())

class PlanTier(str, enum.Enum):
    """Niveaux de plan d'abonnement."""
    SOLO = "solo"           # Architecte indépendant
    AGENCY = "agency"       # Agence moyenne
    ENTERPRISE = "enterprise"  # Grands comptes / Administrations
    TRIAL = "trial"         # Essai gratuit

class SubscriptionStatus(str, enum.Enum):
    """Statut de l'abonnement."""
    ACTIVE = "active"
    PAST_DUE = "past_due"
    CANCELED = "canceled"
    TRIALING = "trialing"
    PAUSED = "paused"

class SubscriptionPlan(Base):
    """
    Définition statique d'un plan tarifaire (catalogue).
    Ne contient pas de données tenant-spécifiques.
    """
    __tablename__ = "subscription_plans"

    id = Column(String, primary_key=True, default=generate_uuid)
    tier = Column(SQLEnum(PlanTier), unique=True, nullable=False, index=True)
    name = Column(String, nullable=False)  # "Solo Architecte", "Agence Pro", etc.
    description = Column(String, nullable=True)
    
    # Quotas de stockage (octets)
    storage_quota_bytes = Column(Integer, nullable=False)
    
    # Quotas de fonctionnalités
    max_projects = Column(Integer, default=10)
    max_team_members = Column(Integer, default=3)
    max_api_calls_per_month = Column(Integer, default=10000)
    
    # Feature flags
    has_advanced_analytics = Column(Boolean, default=False)
    has_priority_support = Column(Boolean, default=False)
    has_sso = Column(Boolean, default=False)
    has_custom_branding = Column(Boolean, default=False)
    
    # Tarification (centimes d'euro/mois)
    price_monthly_cents = Column(Integer, default=0)
    price_yearly_cents = Column(Integer, default=0)
    
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class Subscription(HasTenantColumn, Base):
    """
    Abonnement actif d'un tenant (agence).
    Lie un tenant à un plan avec dates de facturation.
    """
    __tablename__ = "subscriptions"

    id = Column(String, primary_key=True, default=generate_uuid, index=True)
    # tenant_id injecté par HasTenantColumn
    
    plan_id = Column(String, ForeignKey("subscription_plans.id"), nullable=False, index=True)
    status = Column(SQLEnum(SubscriptionStatus), default=SubscriptionStatus.TRIALING, nullable=False, index=True)
    
    # Périodicité de facturation
    billing_cycle_start = Column(DateTime(timezone=True), nullable=False)
    billing_cycle_end = Column(DateTime(timezone=True), nullable=False)
    
    # Annulation
    canceled_at = Column(DateTime(timezone=True), nullable=True)
    cancel_at_period_end = Column(Boolean, default=False, nullable=False)
    
    # Métadonnées de paiement (Stripe, etc.)
    external_customer_id = Column(String, nullable=True, unique=True, index=True)
    external_subscription_id = Column(String, nullable=True, unique=True, index=True)
    external_subscription_item_id = Column(String, nullable=True, unique=True, index=True)
    payment_method_id = Column(String, nullable=True)
    
    # Quotas effectifs (peuvent être overridés par plan custom)
    storage_quota_override_bytes = Column(Integer, nullable=True)
    max_projects_override = Column(Integer, nullable=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relations
    plan = relationship("SubscriptionPlan", foreign_keys=[plan_id])

# Index composites
Index("idx_subscriptions_tenant_status", Subscription.tenant_id, Subscription.status)
Index("idx_subscriptions_plan", Subscription.plan_id)


# Plans par défaut (seed data)
DEFAULT_PLANS = [
    {
        "tier": PlanTier.TRIAL,
        "name": "Essai Gratuit 14 jours",
        "description": "Accès complet pour évaluation (14 jours, 500 Mo)",
        "storage_quota_bytes": 500 * 1024 * 1024,  # 500 Mo
        "max_projects": 3,
        "max_team_members": 1,
        "max_api_calls_per_month": 1000,
        "has_advanced_analytics": False,
        "has_priority_support": False,
        "has_sso": False,
        "has_custom_branding": False,
        "price_monthly_cents": 0,
        "price_yearly_cents": 0,
        "is_active": True,
    },
    {
        "tier": PlanTier.SOLO,
        "name": "Solo Architecte",
        "description": "Pour architectes indépendants et petites structures",
        "storage_quota_bytes": 5 * 1024 * 1024 * 1024,  # 5 Go
        "max_projects": 20,
        "max_team_members": 3,
        "max_api_calls_per_month": 50000,
        "has_advanced_analytics": True,
        "has_priority_support": False,
        "has_sso": False,
        "has_custom_branding": False,
        "price_monthly_cents": 2900,  # 29€/mois
        "price_yearly_cents": 29000,  # 290€/an (2 mois offerts)
        "is_active": True,
    },
    {
        "tier": PlanTier.AGENCY,
        "name": "Agence Pro",
        "description": "Pour agences d'architecture de taille moyenne",
        "storage_quota_bytes": 50 * 1024 * 1024 * 1024,  # 50 Go
        "max_projects": 100,
        "max_team_members": 15,
        "max_api_calls_per_month": 500000,
        "has_advanced_analytics": True,
        "has_priority_support": True,
        "has_sso": True,
        "has_custom_branding": True,
        "price_monthly_cents": 9900,  # 99€/mois
        "price_yearly_cents": 99000,  # 990€/an
        "is_active": True,
    },
    {
        "tier": PlanTier.ENTERPRISE,
        "name": "Entreprise / Administration",
        "description": "Pour grands comptes, administrations, collectivités",
        "storage_quota_bytes": 500 * 1024 * 1024 * 1024,  # 500 Go
        "max_projects": -1,  # Illimité
        "max_team_members": -1,
        "max_api_calls_per_month": -1,
        "has_advanced_analytics": True,
        "has_priority_support": True,
        "has_sso": True,
        "has_custom_branding": True,
        "price_monthly_cents": 29900,  # 299€/mois
        "price_yearly_cents": 299000,  # 2990€/an
        "is_active": True,
    },
]