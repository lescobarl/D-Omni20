"""Tests del repositorio de documentos ingeridos (Fase 1 — RAG).

Cubre :class:`SqlAlchemyDocumentRepository`:

- Creación con/sin chunks y roundtrip de lectura (incluido ``metadata_json``).
- Paginación y total de ``list``.
- Búsqueda: coincidencia directa en contenido (score 2.0) vs. coincidencia
  solo en chunk (score 1.0), precedencia del documento y respeto del límite.
- ``_snippet``: colapsa espacios y recorta con elipsis alrededor de la query.
- Soft-delete: excluye de ``get``/``list``/``search`` (nunca borrado físico).
- Aislamiento multi-tenant (defensa en profundidad: los repositorios filtran
  SIEMPRE por ``tenant_id`` + sin soft-delete).

Notas de diseño:
- ``db_session`` (fixture de conftest) commitea al salir y ve las filas
  ``flush()`` del mismo test.
- SQLite de pruebas no fuerza claves foráneas (no se emite
  ``PRAGMA foreign_keys=ON``), por lo que un ``other_tenant`` aleatorio puede
  usarse sin sembrar una fila en ``tenants``.
"""

from __future__ import annotations

import uuid

import pytest
from app.models.bot_documents import BotDocumentChunk
from app.repositories.sqlalchemy_repositories import SqlAlchemyDocumentRepository
from sqlalchemy import select


@pytest.fixture()
def tenant_id() -> uuid.UUID:
    """Tenant aislado por test (SQLite de pruebas no fuerza FKs).

    El tenant de desarrollo del conftest es de scope sesión y su base se comparte
    y acumula filas entre tests (``db_session`` commitea al salir), por lo que las
    pruebas de este módulo usan un UUID fresco por test para ser deterministas e
    independientes del orden de ejecución.
    """
    return uuid.uuid4()


class TestSqlAlchemyDocumentRepository:
    def _create(
        self,
        repo,
        tenant_id,
        *,
        title,
        source_type="txt",
        source_ref=None,
        content="",
        size_bytes=None,
        metadata=None,
        version=1,
        chunks=None,
    ):
        return repo.create(
            tenant_id=tenant_id,
            title=title,
            source_type=source_type,
            source_ref=source_ref,
            content=content,
            size_bytes=size_bytes if size_bytes is not None else len(content.encode("utf-8")),
            metadata=metadata or {},
            version=version,
            chunks=chunks,
        )

    def test_create_and_get_roundtrip(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyDocumentRepository(db_session)
        doc = self._create(
            repo,
            tenant_id,
            title="Manual del producto",
            source_type="txt",
            source_ref="manual.txt",
            content="Instrucciones de uso del producto.",
            size_bytes=35,
            metadata={"filename": "manual.txt"},
            version=2,
        )
        assert doc.id is not None
        assert doc.metadata_json == {"filename": "manual.txt"}
        assert doc.version == 2
        assert doc.revision == 1

        fetched = repo.get(tenant_id=tenant_id, document_id=doc.id)
        assert fetched is not None
        assert fetched.title == "Manual del producto"
        assert fetched.source_type == "txt"
        assert fetched.source_ref == "manual.txt"
        assert fetched.content == "Instrucciones de uso del producto."
        assert fetched.size_bytes == 35
        assert fetched.metadata_json == {"filename": "manual.txt"}
        assert fetched.version == 2

    def test_create_with_chunks_persists_them(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyDocumentRepository(db_session)
        doc = self._create(
            repo,
            tenant_id,
            title="Documento largo",
            content="contenido que no repite el chunk",
            chunks=[(0, "primer fragmento"), (1, "segundo fragmento")],
        )

        stored = db_session.scalars(
            select(BotDocumentChunk)
            .where(BotDocumentChunk.document_id == doc.id)
            .order_by(BotDocumentChunk.ordinal.asc())
        ).all()
        assert [c.content for c in stored] == ["primer fragmento", "segundo fragmento"]
        assert [c.ordinal for c in stored] == [0, 1]

    def test_list_pagination_and_total(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyDocumentRepository(db_session)
        for i in range(3):
            self._create(repo, tenant_id, title=f"Doc {i}", content=f"contenido {i}")

        page1, total = repo.list(tenant_id=tenant_id, page=1, page_size=2)
        assert len(page1) == 2
        assert total == 3

        page2, total2 = repo.list(tenant_id=tenant_id, page=2, page_size=2)
        assert len(page2) == 1
        assert total2 == 3

    def test_search_doc_content_match_scores_higher(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyDocumentRepository(db_session)
        self._create(repo, tenant_id, title="Catálogo", content="manzanas rojas jugosas")

        results = repo.search(tenant_id=tenant_id, query="manzanas", limit=10)
        assert len(results) == 1
        document, snippet, score = results[0]
        assert document.title == "Catálogo"
        assert score == 2.0
        assert "manzanas" in snippet

    def test_search_chunk_only_match_scores_lower(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyDocumentRepository(db_session)
        # El término NO aparece en el contenido del documento, solo en el chunk.
        self._create(
            repo,
            tenant_id,
            title="Notas internas",
            content="catalogo de productos generales",
            chunks=[(0, "platanos amarillos maduros")],
        )

        results = repo.search(tenant_id=tenant_id, query="platanos", limit=10)
        assert len(results) == 1
        document, snippet, score = results[0]
        assert document.title == "Notas internas"
        assert score == 1.0
        assert "platanos" in snippet

    def test_search_doc_match_takes_precedence_over_chunk(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyDocumentRepository(db_session)
        direct = self._create(
            repo, tenant_id, title="Directo", content="manzanas verdes en la caja"
        )
        chunked = self._create(
            repo,
            tenant_id,
            title="Solo chunk",
            content="otra descripcion sin el termino",
            chunks=[(0, "manzanas rojas")],
        )

        results = repo.search(tenant_id=tenant_id, query="manzanas", limit=10)
        # El documento con coincidencia directa va primero y no se duplica.
        assert [r[0].id for r in results] == [direct.id, chunked.id]
        assert [r[2] for r in results] == [2.0, 1.0]

    def test_search_respects_limit(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyDocumentRepository(db_session)
        self._create(repo, tenant_id, title="A", content="manzanas uno")
        self._create(repo, tenant_id, title="B", content="manzanas dos")

        results = repo.search(tenant_id=tenant_id, query="manzanas", limit=1)
        assert len(results) == 1
        assert results[0][2] == 2.0

    def test_search_is_case_insensitive(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyDocumentRepository(db_session)
        self._create(repo, tenant_id, title="Mayúsculas", content="MANZANAS ROJAS")

        results = repo.search(tenant_id=tenant_id, query="manzanas", limit=10)
        assert len(results) == 1

    def test_snippet_collapses_whitespace_and_wraps_long_text(self) -> None:
        repo_cls = SqlAlchemyDocumentRepository
        assert repo_cls._snippet("  hola   mundo  ", "mundo") == "hola mundo"

        long_text = " ".join(f"palabra{i}" for i in range(200))
        snippet = repo_cls._snippet(long_text, "palabra150")
        assert "palabra150" in snippet
        assert snippet.startswith("…")  # la coincidencia está en el medio del texto.

    def test_soft_delete_excludes_from_active_queries(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyDocumentRepository(db_session)
        doc = self._create(repo, tenant_id, title="Temporal", content="termino buscable")

        assert repo.soft_delete(tenant_id=tenant_id, document_id=doc.id) is True
        assert repo.get(tenant_id=tenant_id, document_id=doc.id) is None
        items, total = repo.list(tenant_id=tenant_id, page=1, page_size=10)
        assert items == [] and total == 0
        assert repo.search(tenant_id=tenant_id, query="termino", limit=10) == []
        # Soft-delete de un id inexistente devuelve False.
        assert repo.soft_delete(tenant_id=tenant_id, document_id=uuid.uuid4()) is False

    def test_tenant_isolation_on_all_queries(self, db_session, tenant_id) -> None:
        repo = SqlAlchemyDocumentRepository(db_session)
        doc = self._create(repo, tenant_id, title="Privado", content="termino aislado")
        other = uuid.uuid4()

        assert repo.get(tenant_id=other, document_id=doc.id) is None
        items, total = repo.list(tenant_id=other, page=1, page_size=10)
        assert items == [] and total == 0
        assert repo.search(tenant_id=other, query="termino", limit=10) == []
        assert repo.soft_delete(tenant_id=other, document_id=doc.id) is False
