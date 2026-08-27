"""Fábrica de la aplicación FastAPI (composition root HTTP).

Contrato:
- ``create_app`` es la única manera de arrancar la app (dev/tests/prod).
- Registra: CORS (desde settings), middleware de contexto + auditoría, handlers
  de error con contexto (regla CLAUDE #8) y el router de la API v1.
- Lifespan: crea tablas (dev/tests), siembra el tenant de desarrollo (no prod)
  y cierra el contenedor DI al apagar (shutdown limpio).
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api import api_router
from app.api.pseo import router as pseo_router
from app.config.settings import Settings, get_settings
from app.core.di import Container, build_container
from app.core.errors import AppError, UnhandledError
from app.middleware import AuditRequestMiddleware, RequestContextMiddleware
from app.models import Base
from app.repositories.sqlalchemy_repositories import (
    SqlAlchemyPseoHostRepository,
    SqlAlchemyTenantRepository,
)


def _seed_dev_tenant(container: Container) -> None:
    """Siembra el tenant de desarrollo y su host PSEO (solo si no es prod)."""
    settings = container.settings
    if settings.is_production or not settings.dev_tenant_slug:
        return
    with container.database.session_scope() as session:
        repository = SqlAlchemyTenantRepository(session)
        tenant = repository.get_by_slug(settings.dev_tenant_slug)
        if tenant is None:
            tenant = repository.create(settings.dev_tenant_slug, settings.dev_tenant_name)
            container.logger.info(
                "tenant.dev_seeded",
                message="Tenant de desarrollo creado",
                slug=settings.dev_tenant_slug,
            )

        # Serving público PSEO: el host de desarrollo se mapea al tenant para
        # que ``GET /pseo/{slug_path}`` resuelva por la cabecera ``Host``.
        host = urlparse(settings.cdn_base_url).netloc
        if host:
            SqlAlchemyPseoHostRepository(session).upsert(
                tenant_id=tenant.id, host=host
            )
            container.logger.info(
                "pseo.host_seeded",
                message="Host PSEO de desarrollo sembrado",
                tenant_id=str(tenant.id),
                host=host,
            )


def create_app(settings: Settings | None = None) -> FastAPI:
    """Compone la aplicación FastAPI completa (fail-fast con settings)."""
    resolved: Settings = settings or get_settings()
    container = build_container(resolved)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> Any:
        if container.settings.auto_create_tables:
            Base.metadata.create_all(container.database.engine)
            _seed_dev_tenant(container)
        if container.settings.reminder_enabled:
            container.scheduler.start()
        yield
        container.scheduler.stop()
        container.dispose()

    app = FastAPI(
        title=resolved.app_name,
        version=resolved.app_version,
        lifespan=lifespan,
        docs_url="/docs" if not resolved.is_production else None,
        redoc_url=None,
        openapi_url="/openapi.json" if not resolved.is_production else None,
    )
    app.state.container = container

    # ── CORS ──────────────────────────────────────────────────────────────────
    # El embed (Fase C) llama a la API v1 desde el CDN (dominios de
    # ``cdn_base_url``). Con ``allow_credentials=True`` los orígenes deben ser
    # explícitos (nunca ``*``); el origen CDN se deriva de ``cdn_base_url`` y se
    # añade a los ``cors_origins`` configurados.
    cdn_origin = urlparse(resolved.cdn_base_url)
    allow_origins = list(resolved.cors_origins)
    if cdn_origin.scheme and cdn_origin.netloc:
        cdn_origin_url = f"{cdn_origin.scheme}://{cdn_origin.netloc}"
        if cdn_origin_url not in allow_origins:
            allow_origins.append(cdn_origin_url)

    # ── Middleware (el primero en registrarse es el más externo) ───────────
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allow_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(AuditRequestMiddleware)

    # ── Handlers de error con contexto (regla CLAUDE #8) ───────────────────
    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
        container.logger.error(
            "app.error",
            message=str(exc),
            operation=exc.operation,
            error_id=exc.error_id,
            status_code=exc.status_code,
            context=exc.context,
        )
        return JSONResponse(status_code=exc.status_code, content=exc.to_dict())

    @app.exception_handler(RequestValidationError)
    async def request_validation_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        payload = {
            "error": {
                "code": "validation.request_error",
                "message": "Datos de entrada inválidos",
                "status_code": 422,
                "details": jsonable_encoder(exc.errors()),
            }
        }
        return JSONResponse(status_code=422, content=payload)

    @app.exception_handler(Exception)
    async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
        wrapped = UnhandledError(
            "Error interno no controlado",
            operation="unhandled",
            context={"method": request.method, "path": request.url.path},
            cause=exc,
        )
        container.logger.critical(
            "unhandled.error",
            message=str(wrapped),
            operation=wrapped.operation,
            error_id=wrapped.error_id,
            exc_info=exc,
        )
        return JSONResponse(status_code=500, content=wrapped.to_dict())

    app.include_router(api_router, prefix=resolved.api_v1_prefix)

    # ── Serving público PSEO (rutas raíz; resuelven tenant por Host) ─────────
    app.include_router(pseo_router)

    # ── Artefactos generados (PDF de cotizaciones, ICS de citas) ────────────
    artifacts_dir = Path(resolved.workflow_artifacts_dir)
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    app.mount(
        "/artifacts",
        StaticFiles(directory=artifacts_dir),
        name="artifacts",
    )

    # ── Assets estáticos públicos: embed.js (Fase C) ─────────────────────────
    # El SDK de landings PSEO se sirve en /static/embed.js (idéntico para todos
    # los tenants; la config con ``tenant_id`` se inyecta en el HTML vía
    # ``<script id="omnibotia-config">``). El directorio debe existir al montar.
    static_dir = Path(__file__).resolve().parent.parent / "static"
    static_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/static", StaticFiles(directory=static_dir), name="static")
    return app


app = create_app()
