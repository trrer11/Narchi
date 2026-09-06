"""
NARCHI V5 — Multi-Tenant SQLAlchemy Model Mixin.
Provides the standard HasTenantColumn mixin to dynamically inject tenant_id properties
into selected database entities.
"""

from sqlalchemy import Column, String
from sqlalchemy.orm import declared_attr

class HasTenantColumn:
    """
    Mixin SQLAlchemy pour injecter la colonne 'tenant_id' et garantir
    l'isolation logique multi-tenant de toutes les entités de l'application.
    """
    @declared_attr
    def tenant_id(cls):
        return Column(String, nullable=False, index=True)
