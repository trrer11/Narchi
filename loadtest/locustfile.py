# §140 — Locust (MIT) : preuve de charge de la « formule waw » et de
# l'en-tête d'authentification, contre la stack RÉELLE.
#
# CE FICHIER EST PRÉPARÉ, PAS ENCORE EXÉCUTÉ (règle de la maison : on ne
# prétend pas avoir mesuré ce qu'on n'a pas lancé). Il exige une stack
# démarrée (chez le client : 1_DEMARRER_NARCHI.bat) — le sandbox n'en a pas.
# Usage documenté dans scripts/charge-locust.sh et docs/OUTILS_OPEN_SOURCE_ELEVATION.md.
#
# Ce que ça mesure, honnêtement :
#   1. register + login — le goulot de création de compte (avec le
#      rate-limit 5/min §60 : on le PROVOQUE pour vérifier qu'il coupe
#      proprement en 429, jamais en 500) ;
#   2. GET /api/v5/projects — la latence de base (lecture tenant isolée) ;
#   3. POST /api/v5/estimation/quick — le cœur métier (CPU + BDD), la partie
#      serveur de la « formule waw » (le parsing IFC, lui, est côté navigateur
#      — pas du serveur).
#
# Le POST /api/v5/projects est EXCLU volontairement : il exige un objet déjà
# présent dans le stockage (S3 HEAD « zero trust ») — un test de charge qui
# le contournerait mentirait.
from locust import HttpUser, between, task


class NarchiUser(HttpUser):
    """Simule un utilisateur d'un bureau : s'inscrit, se connecte, travaille."""

    wait_time = between(1, 3)  # rythme humain (pas un bourrinage artificiel)

    def on_start(self):
        import uuid

        self.email = f"charge-{uuid.uuid4().hex[:10]}@narchi-test.de"
        self.password = "charge-test-pass-123456"
        # 1) Inscription réelle (tenant Trial auto-provisionné).
        with self.client.post(
            "/api/v5/auth/register",
            json={
                "email": self.email,
                "password": self.password,
                "name": "Charge Test",
                "company": "Charge Büro",
            },
            catch_response=True,
        ) as r:
            if r.status_code == 429:
                # Rate-limit d'inscription (§60) : on le DIT, ce n'est pas un
                # échec du service (le service se protège correctement).
                r.success()
        # 2) Connexion OAuth2 (pose le cookie HttpOnly narchi_session).
        self.client.post(
            "/api/v5/auth/token",
            data={"username": self.email, "password": self.password},
        )

    @task(3)
    def liste_projets(self):
        self.client.get("/api/v5/projects")

    @task(1)
    def estimation_rapide(self):
        """La partie serveur de la « formule waw » : un métré de quelques
        éléments IFC → estimation DIN 276."""
        self.client.post(
            "/api/v5/estimation/quick",
            json={
                "region": "NIEDERSACHSEN",
                "bgf_m2": 1200,
                "elements": [
                    {
                        "ifc_type": "IfcWall",
                        "name": "AW 01",
                        "level": "EG",
                        "material_hint": "KS-Mauerwerk",
                        "area_m2": 45.5,
                        "volume_m3": 16.4,
                        "count": 1,
                        "confidence": 0.85,
                    },
                    {
                        "ifc_type": "IfcSlab",
                        "name": "Decke EG",
                        "level": "EG",
                        "material_hint": "Stahlbeton",
                        "area_m2": 120.0,
                        "volume_m3": 24.0,
                        "count": 1,
                        "confidence": 0.9,
                    },
                ],
            },
        )
