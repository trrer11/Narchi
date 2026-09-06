"""§51 — Connexion du magasin vectoriel pgvector (RAG normatif).

Module volontairement SANS dépendance lourde (pas de langchain) : il est
importable tel quel par les tests et par ``app.config``.

``langchain_postgres.PGVector`` exige le driver psycopg v3, alors que le reste
du backend utilise le driver historique psycopg2 via ``DATABASE_URL``. Cette
fonction traduit proprement l'URL existante — aucune nouvelle variable
d'environnement n'est introduite (une seule source de vérité).
"""

from __future__ import annotations


def build_pgvector_connection(database_url: str) -> str:
    """Retourne une URL SQLAlchemy psycopg v3 pour langchain_postgres.

    - ``postgresql://``            → ``postgresql+psycopg://``
    - ``postgresql+psycopg2://``   → ``postgresql+psycopg://``
    - ``postgresql+psycopg://``    → inchangé
    - ``postgres://`` (héritage)   → ``postgresql+psycopg://``
    """
    url = (database_url or "").strip()
    if url.startswith("postgresql+psycopg://"):
        return url
    if url.startswith("postgresql+psycopg2://"):
        return "postgresql+psycopg://" + url[len("postgresql+psycopg2://"):]
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url[len("postgresql://"):]
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url[len("postgres://"):]
    # Tout autre dialecte (sqlite dev, etc.) est retourné tel quel : PGVector
    # n'est de toute façon pas utilisé hors PostgreSQL.
    return url
