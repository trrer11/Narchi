"""Création proactive des partitions mensuelles du journal SOC2."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Engine, inspect, text

from app.core.logging import get_logger

logger = get_logger("audit_partitions")


def _shift_month(value: datetime, offset: int) -> datetime:
    index = value.year * 12 + value.month - 1 + offset
    return datetime(index // 12, index % 12 + 1, 1, tzinfo=timezone.utc)


def ensure_audit_partitions(engine: Engine, months_ahead: int = 12) -> None:
    """Crée les partitions du mois courant jusqu'à l'horizon demandé.

    Alembic crée déjà un horizon de 24 mois. Cette garde au démarrage permet
    aux déploiements longue durée de ne jamais tomber dans la partition DEFAULT.
    """
    if engine.dialect.name != "postgresql":
        return

    with engine.begin() as connection:
        if not inspect(connection).has_table("audit_logs"):
            return

        now = datetime.now(timezone.utc)
        start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
        for offset in range(months_ahead + 1):
            lower = _shift_month(start, offset)
            upper = _shift_month(lower, 1)
            table_name = f"audit_logs_{lower.year:04d}_{lower.month:02d}"
            try:
                with connection.begin_nested():
                    connection.execute(
                        text(
                            f"CREATE TABLE IF NOT EXISTS {table_name} "
                            "PARTITION OF audit_logs FOR VALUES FROM (:lower) TO (:upper)"
                        ),
                        {"lower": lower, "upper": upper},
                    )
            except Exception as error:
                # Peut arriver si la partition DEFAULT contient déjà des lignes
                # de cette période. L'insertion reste sûre; une migration dédiée
                # pourra déplacer ces anciennes lignes sans perte.
                logger.warning(
                    "Audit partition could not be attached",
                    extra={"partition": table_name, "error": str(error)},
                )

        logger.info(
            "Audit partitions verified",
            extra={"months_ahead": months_ahead},
        )
