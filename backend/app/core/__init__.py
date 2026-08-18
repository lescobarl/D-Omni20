"""Núcleo transversal: errores con contexto, logging estructurado, tenancy,
base de datos, RLS e inyección de dependencias."""

from app.core import database, di, errors, logging, rls, tenancy

__all__ = ["database", "di", "errors", "logging", "rls", "tenancy"]
