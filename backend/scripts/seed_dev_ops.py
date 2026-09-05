"""Seed de datos operativos para el tenant de desarrollo (Dashboard B.1 + Estadísticas B.2).

Genera KPIs deterministas —canales, conversaciones, mensajes e intervenciones—
para que el E2E de KPIs valide el contrato del bloque B sobre datos reales con RLS.

La lógica de siembra vive en ``app.core.dev_seed`` (única fuente de verdad,
compartida con ``app/main.py:_seed_dev_operations`` que se ejecuta al arrancar).
Este script es la vía CLI manual para sembrar sin arrancar la app.

Idempotente: usa el marcador ``e2e-kpi-`` en ``external_contact_id`` y se omite
si ya existen conversaciones sembradas para el tenant de desarrollo, evitando
duplicar KPIs en ejecuciones repetidas.

Uso (desde ``backend/``)::

    python -m scripts.seed_dev_ops
"""

from __future__ import annotations

from urllib.parse import urlparse

from app.config.settings import get_settings
from app.core.dev_seed import has_seeded_operations, seed_dev_operations
from app.core.di import build_container
from app.models.base import Base
from app.repositories.sqlalchemy_repositories import SqlAlchemyTenantRepository
from app.services.client_subdomain import provision_client_subdomain


def main() -> None:
    """Crea las tablas que falten y siembra los KPIs de operación del tenant dev."""
    settings = get_settings()
    container = build_container(settings)
    try:
        # Crea únicamente las tablas que falten (idempotente por naturaleza).
        Base.metadata.create_all(container.database.engine)
        with container.database.session_scope() as session:
            tenant = SqlAlchemyTenantRepository(session).get_by_slug(settings.dev_tenant_slug)
            if tenant is None:
                print(f"[seed] Tenant '{settings.dev_tenant_slug}' no existe; nada que sembrar.")
                return

            # C-3 multired: asegura el subdominio dinámico del cliente dev
            # (``{slug}.{client_subdomain_base}``) en ``pseo_hosts`` como host
            # ``active``. Idempotente y self-healing en DBs ya existentes; se
            # commitea aquí para que aplique aunque los KPIs ya estén sembrados.
            cdn_host = urlparse(settings.cdn_base_url).netloc or None
            subdomain = provision_client_subdomain(
                session,
                tenant=tenant,
                client_subdomain_base=settings.client_subdomain_base,
                cdn_host=cdn_host,
            )
            if subdomain:
                print(f"[seed] Subdominio de cliente provisionado: {subdomain}")
            session.commit()

            # Idempotencia: si ya sembramos KPIs con el marcador, omitimos.
            if has_seeded_operations(session, tenant.id):
                print("[seed] KPIs de operación ya sembrados; omitiendo (idempotente).")
                return

            seed_dev_operations(tenant.id, session)
            session.commit()
            print(
                f"[seed] KPIs de operación sembrados para tenant "
                f"'{settings.dev_tenant_slug}' ({tenant.name})."
            )
    finally:
        container.dispose()


if __name__ == "__main__":
    main()
