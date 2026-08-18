"""Capa de servicios — puertos (ABC) e implementaciones concretas.

Los puertos (interfaces) se inyectan desde el composition root
(``app.api.deps``); las implementaciones nunca se instancian en la lógica
de negocio (regla CLAUDE: DI).
"""

from app.services.audit_service import AuditService
from app.services.compiler_service import JinjaCompilerService
from app.services.interfaces import (
    IAuditService,
    ICompilerService,
    ILandingService,
)
from app.services.landing_service import LandingService

__all__ = [
    "AuditService",
    "IAuditService",
    "ICompilerService",
    "ILandingService",
    "JinjaCompilerService",
    "LandingService",
]
