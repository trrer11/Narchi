"""
NARCHI V5 — Seed Subscription Plans
===================================
Peuple la table subscription_plans avec les 4 tiers par défaut.
À exécuter APRÈS la migration.

Usage:
    python -m app.scripts.seed_subscriptions
"""

from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models.subscription import SubscriptionPlan, PlanTier


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


def seed_subscriptions():
    db: Session = SessionLocal()
    try:
        for plan_data in DEFAULT_PLANS:
            existing = db.query(SubscriptionPlan).filter(
                SubscriptionPlan.tier == plan_data["tier"]
            ).first()

            if existing:
                print(f"  ⏭️  Plan {plan_data['tier'].value} existe déjà, mise à jour...")
                for key, value in plan_data.items():
                    setattr(existing, key, value)
            else:
                plan = SubscriptionPlan(**plan_data)
                db.add(plan)
                print(f"  ✅ Plan {plan_data['tier'].value} créé")

        db.commit()
        print("\n🎉 Plans d'abonnement seedés avec succès !")

        # Afficher résumé
        plans = db.query(SubscriptionPlan).order_by(SubscriptionPlan.tier).all()
        print("\n📋 Résumé :")
        for p in plans:
            print(f"   {p.tier.value}: {p.name} — {p.storage_quota_bytes // (1024**3)} Go — {p.max_projects} projets — {p.price_monthly_cents/100:.0f}€/mois")

    except Exception as e:
        db.rollback()
        print(f"❌ Erreur: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_subscriptions()