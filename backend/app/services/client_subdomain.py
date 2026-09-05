"""Provisioning del subdominio dinámico de clientes (C-3 multired).

Contexto
--------
Cada tenant SIN dominio propio recibe automáticamente el subdominio
``{slug}.clientes.omni2.app`` (Wildcard DNS, CNAME/A → nuestro servidor). El
navegador envía el subdominio en la cabecera ``Host`` y ``get_pseo_tenant_by_host``
lo resuelve al tenant igual que un dominio personalizado, por lo que basta con
registrar el host en ``pseo_hosts`` en estado ``active``.

Regla CLAUDE (nada de hardcode, todo dinámico):
- El subdominio se deriva SIEMPRE del ``slug`` del tenant + el setting
  ``client_subdomain_base``; nunca se embebe un slug concreto.
- ``client_subdomain_base`` vacío = subdominios desactivados (no se crea nada).
- Verificación implícita: al ser un subdominio del propio dominio base wildcard,
  el host se crea directamente ``active`` (sin ``verify_token`` ni ``verified_at``).
- Idempotente: se apoya en ``IPseoHostRepository.upsert``, que reactiva filas
  soft-deleted y no duplica el host (UniqueConstraint global).
- No colisiona con el host del CDN: si el subdominio derivado coincide con el
  netloc del CDN configurado, no se provisiona (evita pisar el serving de landings).

Uso
---
Se invoca en el punto donde se crea/asegura el tenant (``_seed_dev_tenant`` y
``scripts/seed_dev_ops.py``); en producción, en el alta de tenant del control
plane, dentro de la misma transacción que crea el ``Tenant``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.repositories.sqlalchemy_repositories import SqlAlchemyPseoHostRepository

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from app.models.tenant import Tenant
    from app.repositories.interfaces import IPseoHostRepository


def provision_client_subdomain(
    session: Session,
    *,
    tenant: Tenant,
    client_subdomain_base: str,
    cdn_host: str | None = None,
    host_repository: IPseoHostRepository | None = None,
) -> str | None:
    """Registra ``{slug}.{client_subdomain_base}`` como host ``active`` del tenant.

    Devuelve el host provisionado o ``None`` cuando no aplica (base vacía, slug
    vacío, o el subdominio derivado coincide con el ``cdn_host``). Es idempotente:
    si el host ya existe activo se devuelve tal cual; si existía soft-deleted o
    ``pending`` se reactiva y se reasigna al tenant.

    Args:
        session: Sesión SQLAlchemy en curso (misma transacción del alta del tenant).
        tenant: Tenant recién creado/asegurado (se usa ``tenant.id`` y ``tenant.slug``).
        client_subdomain_base: Dominio base wildcard (setting); vacío = desactivado.
        cdn_host: Netloc del CDN (opcional) para evitar colisiones con el serving
            de landings versionadas.
        host_repository: Repositorio inyectado (DI); si es ``None`` se construye
            ``SqlAlchemyPseoHostRepository(session)``.
    """
    base = (client_subdomain_base or "").strip().lstrip(".")
    slug = (getattr(tenant, "slug", "") or "").strip()
    if not base or not slug:
        return None

    host = f"{slug}.{base}"
    if cdn_host and host == cdn_host:
        return None

    repository = host_repository or SqlAlchemyPseoHostRepository(session)
    repository.upsert(tenant_id=tenant.id, host=host)
    return host
