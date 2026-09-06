# backend/app/contexts/domain_base.py (Shared Kernel)
from dataclasses import dataclass, field
from uuid import UUID, uuid4
from typing import Optional

@dataclass(frozen=True)
class DomainEntity:
    """
    Base class for all domain entities.
    Ensures identity and immutability within the domain layer.
    """
    id: UUID = field(default_factory=uuid4)

    def __eq__(self, other):
        if not isinstance(other, DomainEntity):
            return False
        return self.id == other.id

    def __hash__(self):
        return hash(self.id)
