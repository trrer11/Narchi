"""Réinitialisation explicite du compte owner depuis les secrets d'environnement."""

import os

from app.core.security.passwords import get_password_hash
from app.database import SessionLocal
from app.models.user import User


def main() -> None:
    email = os.getenv("NARCHI_OWNER_EMAIL", "owner@narchi.io").strip().lower()
    password = os.getenv("NARCHI_OWNER_PASSWORD", "")
    if len(password) < 16:
        raise RuntimeError("NARCHI_OWNER_PASSWORD doit contenir au moins 16 caractères")

    db = SessionLocal()
    try:
        owner = (
            db.query(User)
            .execution_options(skip_tenant_filter=True)
            .filter(User.email == email)
            .first()
        )
        if owner is None:
            raise RuntimeError(f"Compte owner introuvable: {email}")
        owner.hashed_password = get_password_hash(password)
        owner.password_migrated_at = None
        owner.is_active = True
        db.commit()
        print(f"Mot de passe owner réinitialisé pour {email}")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
