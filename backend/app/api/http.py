"""Helpers HTTP compartidos por los routers de serving público.

Centraliza utilidades de bajo nivel sobre :class:`fastapi.Request` que antes
estaban duplicadas en varios routers (p. ej. ``_request_origin`` en
``cdn_serve.py`` y ``portal_serve.py``). Una única fuente de verdad evita que
una corrección de origen se aplique en un router y no en otro (divergencia
silenciosa).
"""

from __future__ import annotations

from fastapi import Request


def request_origin(request: Request) -> str:
    """Origen público del request (esquema + host) para inyectar en el HTML.

    Se prefieren las cabeceras ``X-Forwarded-Proto``/``X-Forwarded-Host`` que
    establecen los proxies/túneles (p. ej. ngrok) con la URL pública real.
    ``request.url.netloc`` refleja la cabecera ``Host``, que en un túnel se
    sobrescribe para resolver el tenant (p. ej. ``acme.clientes.omni2.app``)
    y NO es el origen con el que el navegador accedió. Si no hay cabeceras
    reenviadas (acceso directo a localhost), se usa ``request.url``.
    """
    forwarded_host = request.headers.get("x-forwarded-host")
    forwarded_proto = request.headers.get("x-forwarded-proto")
    if forwarded_host and forwarded_proto:
        return f"{forwarded_proto}://{forwarded_host}"
    return f"{request.url.scheme}://{request.url.netloc}"
