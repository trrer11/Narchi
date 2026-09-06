"""NARCHI V5 core package.

Les composants sont importés depuis leurs modules explicites
(`app.core.security`, `app.core.telemetry`, etc.). Ce fichier reste
volontairement sans import eager afin que les processus légers (Alembic,
Flower, API) ne chargent pas les dépendances BIM/PDF réservées aux workers.
"""
