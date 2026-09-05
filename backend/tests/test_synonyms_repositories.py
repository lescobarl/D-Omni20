"""Tests del repositorio de sinónimos del bot (Fase 2 — normalización de vocabulario).

Cubre :class:`SqlAlchemySynonymRepository`:

- Creación y roundtrip de lectura (término recortado, variantes y tupla sync).
- ``get_by_term`` con comparación case-insensitive (clave de importación/dedup).
- Paginación y total de ``list`` y colección completa de ``list_all`` (export).
- Actualización parcial (solo los campos enviados).
- Soft-delete: excluye de ``get``/``get_by_term``/``list``/``list_all``.
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
from app.repositories.sqlalchemy_repositories import SqlAlchemySynonymRepository


@pytest.fixture()
def tenant_id() -> uuid.UUID:
    """Tenant aislado por test (SQLite de pruebas no fuerza FKs)."""
    return uuid.uuid4()


class TestSqlAlchemySynonymRepository:
    def _create(
        self,
        repo,
        tenant_id,
        *,
        term,
        synonyms=None,
        version=1,
    ):
        return repo.create(
            tenant_id=tenant_id,
            term=term,
            synonyms=synonyms or [],
            version=version,
        )

    def test_create_and_get_roundtrip(self, db_session, tenant_id) -> None:
        repo = SqlAlchemySynonymRepository(db_session)
        row = self._create(repo, tenant_id, term="  Computadora  ", synonyms=["PC", "ordenador"])
        assert row.id is not None
        assert row.term == "Computadora"  # el término se recorta al crear.
        assert row.synonyms == ["PC", "ordenador"]
        assert row.version == 1
        assert row.revision == 1

        fetched = repo.get(tenant_id=tenant_id, synonym_id=row.id)
        assert fetched is not None
        assert fetched.term == "Computadora"
        assert fetched.synonyms == ["PC", "ordenador"]

    def test_get_by_term_is_case_insensitive(self, db_session, tenant_id) -> None:
        repo = SqlAlchemySynonymRepository(db_session)
        self._create(repo, tenant_id, term="Computadora", synonyms=["PC"])

        fetched = repo.get_by_term(tenant_id=tenant_id, term="computadora")
        assert fetched is not None
        assert fetched.term == "Computadora"

    def test_get_by_term_missing_returns_none(self, db_session, tenant_id) -> None:
        repo = SqlAlchemySynonymRepository(db_session)
        assert repo.get_by_term(tenant_id=tenant_id, term="inexistente") is None

    def test_list_pagination_and_total(self, db_session, tenant_id) -> None:
        repo = SqlAlchemySynonymRepository(db_session)
        for i in range(3):
            self._create(repo, tenant_id, term=f"Termo {i}", synonyms=[f"variante{i}"])

        page1, total = repo.list(tenant_id=tenant_id, page=1, page_size=2)
        assert len(page1) == 2
        assert total == 3

        page2, total2 = repo.list(tenant_id=tenant_id, page=2, page_size=2)
        assert len(page2) == 1
        assert total2 == 3

    def test_list_all_returns_complete_ordered_collection(self, db_session, tenant_id) -> None:
        repo = SqlAlchemySynonymRepository(db_session)
        self._create(repo, tenant_id, term="Zeta", synonyms=["z"])
        self._create(repo, tenant_id, term="Alfa", synonyms=["a"])

        rows = repo.list_all(tenant_id=tenant_id)
        assert [row.term for row in rows] == ["Alfa", "Zeta"]  # ordenado por término.

    def test_update_applies_only_sent_fields(self, db_session, tenant_id) -> None:
        repo = SqlAlchemySynonymRepository(db_session)
        row = self._create(repo, tenant_id, term="Coche", synonyms=["auto", "carro"])

        updated = repo.update(tenant_id=tenant_id, synonym_id=row.id, fields={"term": "Automóvil"})
        assert updated is not None
        assert updated.term == "Automóvil"
        assert updated.synonyms == ["auto", "carro"]  # no enviado → no cambia.

        updated2 = repo.update(
            tenant_id=tenant_id, synonym_id=row.id, fields={"synonyms": ["vehículo"]}
        )
        assert updated2 is not None
        assert updated2.term == "Automóvil"
        assert updated2.synonyms == ["vehículo"]

    def test_update_missing_returns_none(self, db_session, tenant_id) -> None:
        repo = SqlAlchemySynonymRepository(db_session)
        assert repo.update(tenant_id=tenant_id, synonym_id=uuid.uuid4(), fields={"term": "x"}) is None

    def test_soft_delete_excludes_from_active_queries(self, db_session, tenant_id) -> None:
        repo = SqlAlchemySynonymRepository(db_session)
        row = self._create(repo, tenant_id, term="Temporal", synonyms=["tmp"])

        assert repo.soft_delete(tenant_id=tenant_id, synonym_id=row.id) is True
        assert repo.get(tenant_id=tenant_id, synonym_id=row.id) is None
        assert repo.get_by_term(tenant_id=tenant_id, term="temporal") is None
        items, total = repo.list(tenant_id=tenant_id, page=1, page_size=10)
        assert items == [] and total == 0
        assert repo.list_all(tenant_id=tenant_id) == []
        # Soft-delete de un id inexistente devuelve False.
        assert repo.soft_delete(tenant_id=tenant_id, synonym_id=uuid.uuid4()) is False

    def test_tenant_isolation_on_all_queries(self, db_session, tenant_id) -> None:
        repo = SqlAlchemySynonymRepository(db_session)
        row = self._create(repo, tenant_id, term="Privado", synonyms=["p"])
        other = uuid.uuid4()

        assert repo.get(tenant_id=other, synonym_id=row.id) is None
        assert repo.get_by_term(tenant_id=other, term="privado") is None
        items, total = repo.list(tenant_id=other, page=1, page_size=10)
        assert items == [] and total == 0
        assert repo.list_all(tenant_id=other) == []
        assert repo.update(tenant_id=other, synonym_id=row.id, fields={"term": "x"}) is None
        assert repo.soft_delete(tenant_id=other, synonym_id=row.id) is False
