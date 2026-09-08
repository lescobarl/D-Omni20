"""Arranque de desarrollo del backend de OmniBotIA Studio.

Workaround (Windows): el event loop por defecto de asyncio en Windows
(IocpProactor) falla al aceptar conexiones bajo carga paralela con
``OSError [WinError 64] The specified network name is no longer available``
(o ``WinError 10038``), lo que mata el listener HTTP de uvicorn mientras el
proceso y el scheduler siguen vivos. Ese patrón deja el backend "vivo pero
inaccesible" y rompe las pruebas E2E (fetch pendiente / ECONNREFUSED).

La solución es forzar el event loop selector (WindowsSelectorEventLoopPolicy),
estable para este patrón de carga. El backend no usa subprocesos asíncronos, por
lo que el selector loop no pierde ninguna capacidad.

Uso (desde ``backend/``):
    python run_dev.py
    OMNI_RELOAD=1 python run_dev.py   # recarga automática en desarrollo

TLS local (opcional, recomendado para servir subdominios en desarrollo):
    OMNI_SSL_CERTFILE=certs/localhost+2.pem ^
    OMNI_SSL_KEYFILE=certs/localhost+2-key.pem ^
    python run_dev.py
    # Sirve HTTPS en el puerto configurado (OMNI_PORT, por defecto 8000).
    # Los certificados se generan con mkcert (CA local de confianza) para que el
    # navegador no fuerce HTTPS sobre un puerto HTTP (ERR_SSL_PROTOCOL_ERROR).
"""

from __future__ import annotations

import asyncio
import os
import sys

# Windows: usar el event loop selector en lugar del proactor (bug de aceptación).
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import uvicorn  # noqa: E402


def main() -> None:
    host = os.environ.get("OMNI_HOST", "127.0.0.1")
    port = int(os.environ.get("OMNI_PORT", "8000"))
    reload_enabled = os.environ.get("OMNI_RELOAD", "0") == "1"
    # TLS local (desarrollo/producción): cuando se definen OMNI_SSL_CERTFILE y
    # OMNI_SSL_KEYFILE, uvicorn sirve HTTPS con ese certificado. Esto replica el
    # esquema de producción (TLS real) y evita que el navegador fuerce HTTPS
    # (HTTPS-First / HSTS) sobre un puerto que solo habla HTTP, que es la causa
    # del ERR_SSL_PROTOCOL_ERROR en desarrollo local con subdominios.
    ssl_certfile = os.environ.get("OMNI_SSL_CERTFILE")
    ssl_keyfile = os.environ.get("OMNI_SSL_KEYFILE")
    ssl_kwargs: dict[str, str] = {}
    if ssl_certfile and ssl_keyfile:
        ssl_kwargs["ssl_certfile"] = ssl_certfile
        ssl_kwargs["ssl_keyfile"] = ssl_keyfile
    uvicorn.run(
        "app.main:app",
        host=host,
        port=port,
        reload=reload_enabled,
        log_level=os.environ.get("OMNI_LOG_LEVEL", "info"),
        **ssl_kwargs,
    )


if __name__ == "__main__":
    main()
