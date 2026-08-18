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


class Database:
    """Abstracción de la conexión a la base de datos."""

    def __init__(self, url: str, *, echo: bool = False) -> None:
        engine_url = make_url(url)
        kwargs: dict[str, Any] = {"echo": echo, "future": True}
        if engine_url.get_backend_name() == "sqlite" and engine_url.database in (None, "", ":memory:"):
            # SQLite en memoria (tests/dev): pool único para compartir la DB.
            kwargs["poolclass"] = StaticPool
            kwargs["connect_args"] = {"check_same_thread": False}
        self.engine: Engine = create_engine(engine_url, **kwargs)
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
