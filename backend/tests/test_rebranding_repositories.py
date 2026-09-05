"""Tests del repositorio de configuraciones de rebranding (Fase 5).

Cubre :class:`SqlAlchemyRebrandingConfigRepository`:

- CRUD básico (crear/leer/por URL/listar/paginado/actualizar/soft-delete).
- Normalización (recorte de espacios) y búsqueda case-insensitive por URL.
- Orden ``created_at DESC`` (estable gracias a ``utcnow`` monotónico de los
  modelos base).
- Aislamiento multi-tenant: un ``other_tenant`` aleatorio nunca ve, lista ni
  modifica filas de otro tenant.

Notas de diseño:
- ``db_session`` (fixture de conftest) commitea al salir y ve las filas
  ``flush()`` del mismo test.
- SQLite de pruebas no fuerza claves foráneas, por lo que un ``other_tenant``
  aleatorio puede usarse sin sembrar una fila en ``tenants``.
- La tabla impone unicidad por ``(tenant_id, url)``, por lo que cada fila se
  crea con una URL única (sufijo UUID).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from app.models.tenant_config import BotRebrandingConfig
from app.repositories.sqlalchemy_repositories import SqlAlchemyRebrandingConfigRepository

_EXTRACTED: dict[str, object] = {
    "primary_color": "#0055AA",
    "accent_color": "#FF6600",
    "surface_color": "#F5F5F5",
    "text_color": "#111111",
    "brand_badge": "#FF6600",
    "logo_url": "https://brand.example.com/logo-brand.png",
    "font_family": "Open Sans",
    "detected_fonts": ["Open Sans", "Roboto"],
}


@pytest.fixture()
def tenant_id() -> uuid.UUID:
    """Tenant aislado por test (SQLite de pruebas no fuerza FKs)."""
    return uuid.uuid4()


class TestRebrandingConfigRepository:
    def _create(
        self,
        repo: SqlAlchemyRebrandingConfigRepository,
        tenant_id: uuid.UUID,
        *,
        name: str = "Mi Marca",
        url: str | None = None,
        **kwargs: object,
    ) -> BotRebrandingConfig:
        """Crea una fila con URL única por llamada (unicidad por tenant+url)."""
        if url is None:
            url = f"https://brand-{uuid.uuid4().hex[:8]}.example.com/"
        return repo.create(
            tenant_id=tenant_id,
            name=name,
            url=url,
            extracted=dict(_EXTRACTED),
            **kwargs,
        )

    def test_create_and_get(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyRebrandingConfigRepository(db_session)
        row = self._create(repo, tenant_id)

        assert row.id is not None
        assert row.version == 1
        assert row.applied_at is None
        assert row.deleted is False
        assert row.extracted == _EXTRACTED

        loaded = repo.get(tenant_id=tenant_id, config_id=row.id)
        assert loaded is not None
        assert loaded.id == row.id
        assert loaded.name == "Mi Marca"
        assert loaded.url.endswith(".example.com/")
        assert loaded.extracted["primary_color"] == "#0055AA"

    def test_create_strips_whitespace(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyRebrandingConfigRepository(db_session)
        row = self._create(
            repo,
            tenant_id,
            name="  Mi Marca  ",
            url="  https://brand.example.com/  ",
        )
        assert row.name == "Mi Marca"
        assert row.url == "https://brand.example.com/"

    def test_get_by_url_case_insensitive(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyRebrandingConfigRepository(db_session)
        row = self._create(repo, tenant_id, url="https://Brand.Example.com/Path")
        loaded = repo.get_by_url(
            tenant_id=tenant_id, url="https://brand.example.com/path"
        )
        assert loaded is not None
        assert loaded.id == row.id

    def test_list_pagination_and_total(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyRebrandingConfigRepository(db_session)
        created = [self._create(repo, tenant_id) for _ in range(3)]
        items, total = repo.list(tenant_id=tenant_id, page=1, page_size=2)
        assert total == 3
        assert len(items) == 2
        assert all(isinstance(item, BotRebrandingConfig) for item in items)
        created_ids = {row.id for row in created}
        assert all(item.id in created_ids for item in items)

    def test_list_all_orders_created_at_desc(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyRebrandingConfigRepository(db_session)
        first = self._create(repo, tenant_id)
        second = self._create(repo, tenant_id)
        rows = repo.list_all(tenant_id=tenant_id)
        assert [row.id for row in rows] == [second.id, first.id]

    def test_update_fields(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyRebrandingConfigRepository(db_session)
        row = self._create(repo, tenant_id)
        applied_at = datetime.now(UTC)
        updated = repo.update(
            tenant_id=tenant_id,
            config_id=row.id,
            fields={
                "name": "  Otra Marca  ",
                "url": "  https://other.example.com/  ",
                "applied_at": applied_at,
            },
        )
        assert updated is not None
        assert updated.name == "Otra Marca"
        assert updated.url == "https://other.example.com/"
        assert updated.applied_at is not None

        loaded = repo.get(tenant_id=tenant_id, config_id=row.id)
        assert loaded is not None
        assert loaded.name == "Otra Marca"

    def test_update_missing_returns_none(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyRebrandingConfigRepository(db_session)
        result = repo.update(
            tenant_id=tenant_id, config_id=uuid.uuid4(), fields={"name": "X"}
        )
        assert result is None

    def test_soft_delete_excludes_from_active_queries(
        self, db_session, tenant_id
    ) -> None:
        repo = SqlAlchemyRebrandingConfigRepository(db_session)
        row = self._create(repo, tenant_id)

        assert repo.soft_delete(tenant_id=tenant_id, config_id=row.id) is True
        assert repo.get(tenant_id=tenant_id, config_id=row.id) is None
        assert repo.list_all(tenant_id=tenant_id) == []
        assert repo.get_by_url(tenant_id=tenant_id, url=row.url) is None
        items, total = repo.list(tenant_id=tenant_id, page=1, page_size=10)
        assert items == [] and total == 0
        assert repo.soft_delete(tenant_id=tenant_id, config_id=row.id) is False

    def test_tenant_isolation_on_get(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyRebrandingConfigRepository(db_session)
        row = self._create(repo, tenant_id)
        other = uuid.uuid4()

        assert repo.get(tenant_id=other, config_id=row.id) is None
        assert repo.get_by_url(tenant_id=other, url=row.url) is None
        assert repo.list_all(tenant_id=other) == []
        items, total = repo.list(tenant_id=other, page=1, page_size=10)
        assert items == [] and total == 0
