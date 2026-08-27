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
    uvicorn.run(
        "app.main:app",
        host=host,
        port=port,
        reload=reload_enabled,
        log_level=os.environ.get("OMNI_LOG_LEVEL", "info"),
    )


if __name__ == "__main__":
    main()
