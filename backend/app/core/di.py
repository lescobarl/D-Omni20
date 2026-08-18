"""Contenedor de dependencias (composition root) — regla CLAUDE: NO ``new``.

Contrato:
- Único lugar (junto con ``app.api.deps``) donde se componen dependencias.
- :class:`Container` expone singletons de infraestructura (logger, database,
  RLS) mediante propiedades perezosas; la lógica de negocio recibe puertos
  (ABC) y nunca instancia implementaciones.
- ``build_container`` es la fábrica única de arranque (FastAPI / tests / CLI).
"""

from __future__ import annotations

from app.config.settings import Settings, get_settings
from app.core.database import Database
from app.core.logging import ILogger, build_logger
from app.core.rls import RLSManager


class Container:
    """Composition root de la aplicación (singletons de infraestructura)."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._logger: ILogger | None = None
        self._database: Database | None = None
        self._rls: RLSManager | None = None

    @property
    def logger(self) -> ILogger:
        if self._logger is None:
            self._logger = build_logger("omnibotia", self.settings)
        return self._logger

    @property
    def database(self) -> Database:
        if self._database is None:
            self._database = Database(self.settings.database_url)
        return self._database

    @property
    def rls(self) -> RLSManager:
        if self._rls is None:
            self._rls = RLSManager()
        return self._rls

    def dispose(self) -> None:
        """Cierra recursos (pool de conexiones) en el shutdown de la app."""
        if self._database is not None:
            self._database.dispose()


def build_container(settings: Settings | None = None) -> Container:
    """Fábrica única de :class:`Container` (fail-fast con settings validados)."""
    return Container(settings or get_settings())
