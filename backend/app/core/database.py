"""Acceso a base de datos (PostgreSQL en prod; SQLite en dev/tests).

Contrato:
- Clase :class:`Database` como única fuente de engine y session factory.
- En cada transacción se aplica el tenant del request como GUC
  (``app.current_tenant_id``) para que RLS la evalúe — vía evento
  ``after_begin`` (regla CLAUDE: RLS multi-tenant).
- ``session_scope`` es el único camino para abrir sesiones (rollback
  automático en error, nunca try/except vacío).
"""

from __future__ import annotations

import contextlib
from collections.abc import Generator
from typing import Any

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy.engine import make_url

from app.core.tenancy import RequestContext, set_app_current_tenant


def _set_sqlite_concurrency_pragmas(dbapi_connection: Any, _connection_record: Any) -> None:
    """Aplica PRAGMAs de concurrencia en cada conexión nueva de SQLite.

    - ``journal_mode=WAL``: lectores y escritor no se bloquean entre sí (en
      ``:memory:`` es un no-op que devuelve ``memory`` sin error).
    - ``busy_timeout=30000``: el escritor espera 30s la cerradura en vez de
      fallar al instante con "database is locked".
    - ``synchronous=NORMAL``: durabilidad suficiente para dev sin fsync por
      commit (PostgreSQL en prod no se ve afectado).
    - ``isolation_level=None``: desactiva el ``BEGIN`` automático de pysqlite;
      SQLAlchemy emite su propio ``BEGIN IMMEDIATE`` vía el evento de engine
      (ver :func:`_sqlite_begin_immediate`).
    """
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=30000")
        cursor.execute("PRAGMA synchronous=NORMAL")
    finally:
        cursor.close()
    dbapi_connection.isolation_level = None


def _sqlite_begin_immediate(conn: Connection) -> None:
    """Emita ``BEGIN IMMEDIATE`` en lugar del ``BEGIN`` diferido (solo SQLite).

    Bajo carga paralela (threadpool de uvicorn + auditoría + scheduler), una
    transacción que inicia en modo diferido y luego intenta escribir devuelve
    ``SQLITE_BUSY`` de inmediato: SQLite no puede esperar a la cerradura al
    actualizar una transacción de lector a escritor dentro de WAL (el
    ``busy_timeout`` no aplica en esa actualización). Con ``BEGIN IMMEDIATE``
    el escritor adquiere la cerradura al inicio y, si otro escritor la tiene,
    espera hasta ``busy_timeout`` (30s): los escritores se serializan con una
    espera acotada en vez de fallar o quedarse atascados.
    """
    conn.exec_driver_sql("BEGIN IMMEDIATE")


class Database:
    """Abstracción de la conexión a la base de datos."""

    def __init__(self, url: str, *, echo: bool = False) -> None:
        engine_url = make_url(url)
        kwargs: dict[str, Any] = {"echo": echo, "future": True}
        is_sqlite = engine_url.get_backend_name() == "sqlite"
        if is_sqlite:
            # SQLite (dev/tests): el servidor uvicorn atiende peticiones en un
            # threadpool y la auditoría + el scheduler escriben en paralelo, por
            # lo que sin WAL/busy_timeout SQLite lanza "database is locked" bajo
            # carga concurrente. ``check_same_thread=False`` permite reutilizar
            # las conexiones del pool entre hilos del servidor.
            kwargs["connect_args"] = {
                "check_same_thread": False,
                "timeout": 30,
            }
            if engine_url.database in (None, "", ":memory:"):
                # SQLite en memoria (tests/dev): pool único para compartir la DB.
                kwargs["poolclass"] = StaticPool
        self.engine: Engine = create_engine(engine_url, **kwargs)
        if is_sqlite:
            event.listen(self.engine, "connect", _set_sqlite_concurrency_pragmas)
            event.listen(self.engine, "begin", _sqlite_begin_immediate)
        self.session_factory: sessionmaker[Session] = sessionmaker(
            bind=self.engine, expire_on_commit=False, future=True
        )
        # ``after_begin`` es un evento de sesión (no de Engine) en SQLAlchemy 2.0:
        # se dispara cuando la sesión inicia su transacción, punto exacto para
        # aplicar el GUC ``app.current_tenant_id`` y que RLS la evalúe.
        event.listen(self.session_factory, "after_begin", self._apply_tenant_guc)

    def _apply_tenant_guc(
        self, session: Session, transaction: Any, conn: Connection
    ) -> None:
        """Aplica el tenant del request como GUC al iniciar cada transacción."""
        set_app_current_tenant(conn, RequestContext.tenant_id())

    @contextlib.contextmanager
    def session_scope(self) -> Generator[Session, None, None]:
        """Abre una sesión con commit/rollback automático (sin silenciar errores)."""
        session: Session = self.session_factory()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def dispose(self) -> None:
        """Cierra el pool de conexiones (shutdown limpio del contenedor DI)."""
        self.engine.dispose()
