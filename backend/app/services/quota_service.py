"""
NARCHI V5 — FinOps Storage Quota Service (Subscription-based).
Computes accumulated tenant disk consumption using native SQL aggregation (func.sum)
and validates upload limits based on authoritative subscription plans.
Replaces heuristic quota logic with SubscriptionPlan table lookup.
"""

from sqlalchemy import func
from sqlalchemy.orm import Session
from app.models.project import Project
from app.models.subscription import Subscription, SubscriptionPlan, SubscriptionStatus, PlanTier
from app.core.logging import get_logger

logger = get_logger("quota_service")


class QuotaService:
    @staticmethod
    def get_tenant_subscription(db: Session, tenant_id: str) -> Subscription | None:
        """
        Récupère l'abonnement actif du tenant.
        Retourne None si aucun abonnement (fallback vers plan TRIAL).
        """
        return db.query(Subscription).filter(
            Subscription.tenant_id == tenant_id,
            Subscription.status.in_([
                SubscriptionStatus.ACTIVE,
                SubscriptionStatus.TRIALING,
                SubscriptionStatus.PAST_DUE  # Autorisé mais avec avertissement
            ])
        ).first()

    @staticmethod
    def get_effective_storage_quota(db: Session, tenant_id: str) -> int:
        """
        Détermine le quota de stockage effectif pour un tenant.
        Priorité : override abonnement > plan abonnement > plan TRIAL par défaut.
        """
        sub = QuotaService.get_tenant_subscription(db, tenant_id)

        if sub:
            # Override explicite sur l'abonnement
            if sub.storage_quota_override_bytes is not None:
                return sub.storage_quota_override_bytes
            # Sinon quota du plan
            return sub.plan.storage_quota_bytes

        # Fallback : plan TRIAL par défaut
        trial_plan = db.query(SubscriptionPlan).filter(
            SubscriptionPlan.tier == PlanTier.TRIAL,
            SubscriptionPlan.is_active == True
        ).first()

        if trial_plan:
            return trial_plan.storage_quota_bytes

        # Fallback absolu (dernier recours)
        return 500 * 1024 * 1024  # 500 Mo

    @staticmethod
    def get_effective_project_quota(db: Session, tenant_id: str) -> int:
        """Quota de nombre de projets effectif."""
        sub = QuotaService.get_tenant_subscription(db, tenant_id)
        if sub:
            if sub.max_projects_override is not None:
                return sub.max_projects_override
            return sub.plan.max_projects

        trial_plan = db.query(SubscriptionPlan).filter(
            SubscriptionPlan.tier == PlanTier.TRIAL,
            SubscriptionPlan.is_active == True
        ).first()

        return trial_plan.max_projects if trial_plan else 3

    @staticmethod
    def get_tenant_storage_usage(db: Session, tenant_id: str) -> int:
        """
        Calcule la somme de la taille de l'ensemble des fichiers d'une agence (tenant).
        Optimisé pour exécuter une requête d'agrégation native 'SUM()' en base de données.
        """
        # Synchronisation du contexte multi-tenant de session pour contraindre le filtrage ORM
        db.info["tenant_id"] = tenant_id

        # Agrégation SQL ultra-rapide et performante
        usage_sum = db.query(func.sum(Project.file_size_bytes)).filter(
            Project.tenant_id == tenant_id
        ).scalar()

        return int(usage_sum) if usage_sum else 0

    @staticmethod
    def check_quota_allowance(db: Session, tenant_id: str, incoming_file_size: int) -> bool:
        """
        Évalue si l'agence dispose de l'allocation d'espace nécessaire pour téléverser
        un nouveau fichier binaire de taille 'incoming_file_size' (octets).
        """
        if incoming_file_size < 0:
            return False

        quota_limit = QuotaService.get_effective_storage_quota(db, tenant_id)
        current_usage = QuotaService.get_tenant_storage_usage(db, tenant_id)

        # Contrôle strict d'allocation FinOps
        return (current_usage + incoming_file_size) <= quota_limit

    @staticmethod
    def get_quota_status(db: Session, tenant_id: str) -> dict:
        """
        Retourne un statut détaillé du quota pour l'UI (barre de progression, alertes).
        """
        quota_limit = QuotaService.get_effective_storage_quota(db, tenant_id)
        current_usage = QuotaService.get_tenant_storage_usage(db, tenant_id)
        remaining = max(0, quota_limit - current_usage)
        usage_pct = (current_usage / quota_limit * 100) if quota_limit > 0 else 100

        sub = QuotaService.get_tenant_subscription(db, tenant_id)
        plan_name = sub.plan.name if sub and sub.plan else "Essai Gratuit"

        status_val = "critical" if usage_pct >= 95 else ("warning" if usage_pct >= 80 else "ok")

        logger.debug("Quota status computed",
                     extra={"tenant_id": tenant_id, "plan": plan_name,
                            "usage_pct": usage_pct, "status": status_val})

        return {
            "tenant_id": tenant_id,
            "plan_name": plan_name,
            "quota_limit_bytes": quota_limit,
            "current_usage_bytes": current_usage,
            "remaining_bytes": remaining,
            "usage_percentage": round(usage_pct, 1),
            "is_over_quota": current_usage > quota_limit,
            "is_near_limit": usage_pct >= 80,
            "status": status_val,
        }

    @staticmethod
    def create_default_subscription(db: Session, tenant_id: str, plan_tier: PlanTier = PlanTier.TRIAL) -> Subscription:
        """
        Crée un abonnement par défaut pour un nouveau tenant.
        Appelé lors de l'inscription (register_user).
        """
        from datetime import datetime, timedelta

        plan = db.query(SubscriptionPlan).filter(
            SubscriptionPlan.tier == plan_tier,
            SubscriptionPlan.is_active == True
        ).first()

        if not plan:
            raise ValueError(f"Plan {plan_tier} not found or inactive")

        now = datetime.utcnow()
        # Trial = 14 jours, payant = 1 mois
        if plan_tier == PlanTier.TRIAL:
            cycle_end = now + timedelta(days=14)
            status = SubscriptionStatus.TRIALING
        else:
            cycle_end = now + timedelta(days=30)
            status = SubscriptionStatus.ACTIVE

        sub = Subscription(
            tenant_id=tenant_id,
            plan_id=plan.id,
            status=status,
            billing_cycle_start=now,
            billing_cycle_end=cycle_end,
        )
        db.add(sub)
        db.commit()
        db.refresh(sub)

        logger.info("Default subscription created",
                    extra={"tenant_id": tenant_id, "plan_tier": plan_tier.value,
                           "status": status.value})

        return sub


# Helper function for storage service
def resolve_tenant_quota_limit(tenant_id: str) -> int:
    """Helper for storage service - requires DB session from caller."""
    # This is called from storage_service which doesn't have DB session
    # The actual check happens in quota_guard middleware with DB session
    return 500 * 1024 * 1024 * 1024  # Large default, actual limit enforced at upload