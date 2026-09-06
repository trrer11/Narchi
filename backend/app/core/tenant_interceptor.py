"""
NARCHI V5 — Multi-Tenant SQLAlchemy Event Interceptors.
Intercepts all ORM operations to silently enforce tenant boundaries.
Uses 'with_loader_criteria' for queries (SELECT) and 'before_flush' for insertions (INSERT).
"""

from sqlalchemy import event
from sqlalchemy.orm import Session, with_loader_criteria
from app.models.tenant_mixin import HasTenantColumn
from app.core.logging import get_logger

logger = get_logger("tenant_interceptor")


@event.listens_for(Session, "do_orm_execute")
def _inject_tenant_filter(execute_state):
    """
    SQLAlchemy do_orm_execute event listener.
    Silently intercepts all SELECT statements on models featuring the HasTenantColumn mixin
    and dynamically binds 'WHERE tenant_id = current_tenant_id'.
    Allows explicit bypass via execution_options: session.execute(..., execution_options={"skip_tenant_filter": True})
    """
    # Possibilité de bypasser l'intercepteur de manière ponctuelle (ex: tâches système d'administration globale)
    if execute_state.execution_options.get("skip_tenant_filter", False):
        return

    tenant_id = execute_state.session.info.get("tenant_id")
    if not tenant_id:
        return

    if (
        execute_state.is_select
        and not execute_state.is_column_load
        and not execute_state.is_relationship_load
    ):
        execute_state.statement = execute_state.statement.options(
            with_loader_criteria(
                HasTenantColumn,
                lambda cls: cls.tenant_id == tenant_id,
                include_aliases=True,
                propagate_to_loaders=True
            )
        )


@event.listens_for(Session, "before_flush")
def _inject_tenant_id_before_insert(session, flush_context, instances):
    """
    SQLAlchemy before_flush event listener.
    Runs prior to executing database write transactions. Automatically copies the active
    tenant_id of the session into the 'tenant_id' column of any new model instance inheriting
    from HasTenantColumn. Prevents developers from forgetting to assign the tenant reference.
    """
    tenant_id = session.info.get("tenant_id")
    if not tenant_id:
        return

    # Parcours synchrone des nouvelles instances ajoutées à la transaction
    for obj in session.new:
        if isinstance(obj, HasTenantColumn):
            if not getattr(obj, "tenant_id", None):
                obj.tenant_id = tenant_id
                logger.debug("Auto-injected tenant_id",
                             extra={"tenant_id": tenant_id,
                                    "model": obj.__class__.__name__})
