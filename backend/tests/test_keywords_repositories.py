"""Tests del repositorio de keywords con prioridades del bot (Fase 3).

Cubre :class:`SqlAlchemyKeywordRepository`:

- Creación y roundtrip de lectura (término recortado, respuesta, prioridad,
  estado habilitado y tupla sync).
- ``get_by_term`` con comparación case-insensitive (clave de deduplicación).
- Paginación y total de ``list`` y colección completa de ``list_all``.
- ``list_enabled`` ordenada por prioridad (menor número = mayor prioridad) y
  excluyendo las keywords deshabilitadas (entrada del motor de conversación).
- Actualización parcial (solo los campos enviados).
- Soft-delete: excluye de ``get``/``get_by_term``/``list``/``list_all``/
  ``list_enabled``.
- Aislamiento multi-tenant (defensa en profundidad: los repositorios filtran
  SIEMPRE por ``tenant_id`` + sin soft-delete).

Notas de diseño:
- ``db_session`` (fixture de conftest) commitea al salir y ve las filas
  ``flush()`` del mismo test.
- SQLite de pruebas no fuerza claves foráneas, por lo que un ``other_tenant``
  aleatorio puede usarse sin sembrar una fila en ``tenants``.
"""

from __future__ import annotations

import uuid

import pytest
from app.repositories.sqlalchemy_repositories import SqlAlchemyKeywordRepository


@pytest.fixture()
def tenant_id() -> uuid.UUID:
    """Tenant aislado por test (SQLite de pruebas no fuerza FKs)."""
    return uuid.uuid4()


class TestSqlAlchemyKeywordRepository:
    def _create(
        self,
        repo,
        tenant_id,
        *,
        term,
        response="Respuesta fija",
        priority=100,
        enabled=True,
        version=1,
    ):
        return repo.create(
            tenant_id=tenant_id,
            term=term,
            response=response,
            priority=priority,
            enabled=enabled,
            version=version,
        )

    def test_create_and_get_roundtrip(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyKeywordRepository(db_session)
        row = self._create(repo, tenant_id, term="  Garantía  ", response="Te explico", priority=10)
        assert row.id is not None
        assert row.term == "Garantía"  # el término se recorta al crear.
        assert row.response == "Te explico"
        assert row.priority == 10
        assert row.enabled is True
        assert row.version == 1
        assert row.revision == 1

        fetched = repo.get(tenant_id=tenant_id, keyword_id=row.id)
        assert fetched is not None
        assert fetched.term == "Garantía"
        assert fetched.response == "Te explico"

    def test_get_by_term_is_case_insensitive(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyKeywordRepository(db_session)
        self._create(repo, tenant_id, term="Garantía", response="x")

        fetched = repo.get_by_term(tenant_id=tenant_id, term="garantía")
        assert fetched is not None
        assert fetched.term == "Garantía"

    def test_get_by_term_missing_returns_none(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyKeywordRepository(db_session)
        assert repo.get_by_term(tenant_id=tenant_id, term="inexistente") is None

    def test_list_pagination_and_total(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyKeywordRepository(db_session)
        for i in range(3):
            self._create(repo, tenant_id, term=f"Termo {i}", response=f"respuesta{i}")

        page1, total = repo.list(tenant_id=tenant_id, page=1, page_size=2)
        assert len(page1) == 2
        assert total == 3

        page2, total2 = repo.list(tenant_id=tenant_id, page=2, page_size=2)
        assert len(page2) == 1
        assert total2 == 3

    def test_list_all_ordered_by_priority_then_term(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyKeywordRepository(db_session)
        self._create(repo, tenant_id, term="Zeta", priority=50)
        self._create(repo, tenant_id, term="Alfa", priority=10)
        self._create(repo, tenant_id, term="Beta", priority=10)

        rows = repo.list_all(tenant_id=tenant_id)
        assert [(row.priority, row.term) for row in rows] == [
            (10, "Alfa"),
            (10, "Beta"),
            (50, "Zeta"),
        ]

    def test_list_enabled_ranks_by_priority_and_excludes_disabled(
        self, db_session, tenant_id
    ) -> None:
        repo = SqlAlchemyKeywordRepository(db_session)
        self._create(repo, tenant_id, term="Alta", priority=10)
        self._create(repo, tenant_id, term="Baja", priority=90)
        self._create(repo, tenant_id, term="Apagada", priority=5, enabled=False)

        rows = repo.list_enabled(tenant_id=tenant_id)
        assert [row.term for row in rows] == ["Alta", "Baja"]  # prioridad asc, sin deshabilitadas.

    def test_update_applies_only_sent_fields(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyKeywordRepository(db_session)
        row = self._create(repo, tenant_id, term="Coche", response="Original", priority=100)

        updated = repo.update(
            tenant_id=tenant_id, keyword_id=row.id, fields={"term": "Automóvil"}
        )
        assert updated is not None
        assert updated.term == "Automóvil"
        assert updated.response == "Original"  # no enviado → no cambia.
        assert updated.priority == 100

        updated2 = repo.update(
            tenant_id=tenant_id,
            keyword_id=row.id,
            fields={"response": "Nueva", "priority": 5, "enabled": False},
        )
        assert updated2 is not None
        assert updated2.term == "Automóvil"
        assert updated2.response == "Nueva"
        assert updated2.priority == 5
        assert updated2.enabled is False

    def test_update_missing_returns_none(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyKeywordRepository(db_session)
        assert repo.update(
            tenant_id=tenant_id, keyword_id=uuid.uuid4(), fields={"term": "x"}
        ) is None

    def test_soft_delete_excludes_from_active_queries(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyKeywordRepository(db_session)
        row = self._create(repo, tenant_id, term="Temporal", response="tmp")

        assert repo.soft_delete(tenant_id=tenant_id, keyword_id=row.id) is True
        assert repo.get(tenant_id=tenant_id, keyword_id=row.id) is None
        assert repo.get_by_term(tenant_id=tenant_id, term="temporal") is None
        items, total = repo.list(tenant_id=tenant_id, page=1, page_size=10)
        assert items == [] and total == 0
        assert repo.list_all(tenant_id=tenant_id) == []
        assert repo.list_enabled(tenant_id=tenant_id) == []
        # Soft-delete de un id inexistente devuelve False.
        assert repo.soft_delete(tenant_id=tenant_id, keyword_id=uuid.uuid4()) is False

    def test_tenant_isolation_on_all_queries(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyKeywordRepository(db_session)
        row = self._create(repo, tenant_id, term="Privado", response="p")
        other = uuid.uuid4()

        assert repo.get(tenant_id=other, keyword_id=row.id) is None
        assert repo.get_by_term(tenant_id=other, term="privado") is None
        items, total = repo.list(tenant_id=other, page=1, page_size=10)
        assert items == [] and total == 0
        assert repo.list_all(tenant_id=other) == []
        assert repo.list_enabled(tenant_id=other) == []
        assert repo.update(tenant_id=other, keyword_id=row.id, fields={"term": "x"}) is None
        assert repo.soft_delete(tenant_id=other, keyword_id=row.id) is False
