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
import re
from collections.abc import Generator
from time import perf_counter
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
      SQLAlchemy emite su propio ``BEGIN`` diferido vía el evento de engine
      (ver :func:`_sqlite_begin_deferred`) y lo actualiza a ``BEGIN IMMEDIATE``
      solo en la primera escritura de cada transacción (ver
      :func:`_sqlite_upgrade_to_immediate_on_write`).
    """
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=30000")
        cursor.execute("PRAGMA synchronous=NORMAL")
    finally:
        cursor.close()
    dbapi_connection.isolation_level = None


_WRITE_STATEMENT_RE = re.compile(
    r"^\s*(INSERT|UPDATE|DELETE|REPLACE|UPSERT|CREATE|ALTER|DROP|REINDEX|ANALYZE)\b",
    re.IGNORECASE,
)


def _sqlite_begin_deferred(conn: Connection) -> None:
    """Emita ``BEGIN`` diferido en lugar de ``BEGIN IMMEDIATE`` (solo SQLite).

    Una transacción diferida solo toma la cerradura ``SHARED`` (lectura) y no
    adquiere la ``RESERVED`` (escritura) hasta que una sentencia escribe. Con
    esto las peticiones de solo lectura (stats, cuota, conversaciones, cola…)
    conviven en WAL sin bloquearse entre sí, ni consigo mismas: la sesión del
    request y una segunda sesión de un servicio de gobierno pueden leer a la vez.

    El paso a modo escritura se hace en la primera escritura, vía
    :func:`_sqlite_upgrade_to_immediate_on_write`, donde ``busy_timeout`` sí
    aplica y los escritores se serializan con espera acotada.
    """
    # Reinicia la bandera por transacción: cada nueva transacción vuelve a
    # comenzar en modo diferido hasta su primera escritura.
    conn.info["_sqlite_immediate"] = False
    conn.exec_driver_sql("BEGIN")


def _sqlite_upgrade_to_immediate_on_write(
    conn: Connection,
    _cursor: Any,
    statement: str,
    _parameters: Any,
    _context: Any,
    _executemany: bool,
) -> None:
    """Actualiza a ``BEGIN IMMEDIATE`` en la primera escritura (solo SQLite).

    SQLite no puede actualizar una transacción de lector (``SHARED``) a escritor
    (``RESERVED``) dentro de WAL esperando el ``busy_timeout``: ese upgrade
    devuelve ``SQLITE_BUSY`` de inmediato. La solución limpia es hacer ``COMMIT``
    de la transacción diferida (libera ``SHARED``) y reiniciarla con
    ``BEGIN IMMEDIATE``, sentencia que sí respeta ``busy_timeout`` (30s): los
    escritores se serializan con espera acotada y las lecturas nunca retienen
    la cerradura ``RESERVED`` durante toda la petición.
    """
    if conn.info.get("_sqlite_immediate"):
        return
    if not _WRITE_STATEMENT_RE.match(statement):
        return
    if not conn.in_transaction():
        return
    conn.info["_sqlite_immediate"] = True
    conn.exec_driver_sql("COMMIT")
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
            event.listen(self.engine, "begin", _sqlite_begin_deferred)
            event.listen(
                self.engine,
                "before_cursor_execute",
                _sqlite_upgrade_to_immediate_on_write,
            )
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

    def optimize(self) -> dict[str, int]:
        """Optimización física (VACUUM + REINDEX) con conexión cruda autocommit.

        ``VACUUM`` no puede ejecutarse dentro de una transacción en SQLite, por
        lo que se usa una conexión cruda del pool en modo autocommit (sin BEGIN;
        ``isolation_level=None``). En PostgreSQL no aplica (autovacuum) y es un
        no-op informado. Devuelve la duración en ms y un flag de ejecución.
        """
        started = perf_counter()
        if self.engine.url.get_backend_name() != "sqlite":
            # PostgreSQL: el autovacuum gestiona la compactación; no-op informado.
            return {"duration_ms": 0, "executed": 0}
        raw = self.engine.raw_connection()
        try:
            cursor = raw.cursor()
            try:
                cursor.execute("VACUUM")
                cursor.execute("REINDEX")
            finally:
                cursor.close()
            raw.commit()
        finally:
            raw.close()
        return {"duration_ms": int((perf_counter() - started) * 1000), "executed": 1}

    def dispose(self) -> None:
        """Cierra el pool de conexiones (shutdown limpio del contenedor DI)."""
        self.engine.dispose()
