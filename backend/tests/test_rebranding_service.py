"""Tests del servicio de rebranding por URL (Fase 5).

Cubre :class:`RebrandingService.extract_url_styles` con un cliente HTTP de
prueba (``httpx.MockTransport``) que sirve el HTML de la marca y su hoja de
estilos del mismo origen:

- Derivación de la paleta (primary/accent/surface/text), ``brand_badge``,
  tipografías y logo a partir de las pistas ``--primary``/``--accent`` y de
  las propiedades CSS (``background`` → superficie, ``color``/``border`` →
  marca).
- Errores de red (``httpx.HTTPError``) traducidos a ``InputValidationError``
  con operación y contexto para la trazabilidad.
- Ciclo de vida del cliente HTTP respetando la regla DI: solo se cierra el
  cliente que la instancia posee (no el inyectado).
"""

from __future__ import annotations

import httpx
import pytest
from app.core.errors import InputValidationError
from app.core.logging import build_logger
from app.services.rebranding_service import RebrandingService

BRAND_URL = "https://brand.example.com/"

_BRAND_HTML = """<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <title>Brand Example</title>
    <style>
      :root {
        --primary: #0055AA;
        --accent: #FF6600;
        --surface: #FFFFFF;
        --text: #111111;
      }
      body {
        font-family: "Open Sans", Arial, sans-serif;
        background: var(--surface);
        color: var(--text);
      }
    </style>
    <link rel="stylesheet" href="/styles.css">
  </head>
  <body>
    <header>
      <img src="/logo-brand.png" alt="Brand Logo">
    </header>
    <div class="hero" style="background:#F5F5F5;color:#0055AA;border-color:#0055AA;">
      Hola
    </div>
  </body>
</html>
"""

_STYLES_CSS = """.btn {
  background: #0055AA;
  color: #FFFFFF;
}
.btn-accent {
  background: #FF6600;
}
.card {
  background: #F5F5F5;
}
h1 {
  color: #111111;
  font-family: 'Roboto', sans-serif;
}
"""


def _build_service(test_settings, handler) -> RebrandingService:
    """Construye el servicio con un cliente HTTP de prueba inyectado."""
    client = httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True)
    return RebrandingService(
        settings=test_settings,
        logger=build_logger("test.rebranding.service", test_settings),
        client=client,
    )


@pytest.fixture()
def service(test_settings) -> RebrandingService:
    """Servicio con MockTransport que sirve el HTML y la hoja de estilos."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/styles.css":
            return httpx.Response(
                200, text=_STYLES_CSS, headers={"Content-Type": "text/css"}
            )
        return httpx.Response(
            200, text=_BRAND_HTML, headers={"Content-Type": "text/html"}
        )

    return _build_service(test_settings, handler)


def test_extract_styles_derives_palette_fonts_and_logo(
    service: RebrandingService,
) -> None:
    """Deriva la paleta, tipografías y logo de un HTML de marca de ejemplo."""
    proposal = service.extract_url_styles(url=BRAND_URL)

    assert proposal.primary_color == "#0055AA"
    assert proposal.accent_color == "#FF6600"
    assert proposal.surface_color == "#F5F5F5"
    assert proposal.text_color == "#111111"
    assert proposal.brand_badge == "#FF6600"
    assert proposal.logo_url == "https://brand.example.com/logo-brand.png"
    assert proposal.font_family == "Open Sans"
    assert proposal.detected_fonts == ["Open Sans", "Roboto"]


def test_extract_styles_http_error_raises_input_validation_error(test_settings) -> None:
    """Un fallo de red se traduce en ``InputValidationError`` con contexto."""

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom")

    service = _build_service(test_settings, handler)
    with pytest.raises(InputValidationError) as excinfo:
        service.extract_url_styles(url=BRAND_URL)

    error = excinfo.value
    assert error.operation == "tenant.appearance.extract_url"
    assert error.context == {"url": BRAND_URL}


def test_close_ignores_injected_client(service: RebrandingService) -> None:
    """``close()`` no cierra un cliente inyectado (no es de su propiedad)."""
    injected = service._client
    assert injected is not None
    service.close()
    assert service._client is injected


def test_close_owned_client_sets_none(test_settings) -> None:
    """``close()`` libera el cliente creado internamente (propiedad DI)."""
    service = RebrandingService(
        settings=test_settings,
        logger=build_logger("test.rebranding.service", test_settings),
    )
    assert service._client is None
    service._get_client()
    assert service._client is not None
    service.close()
    assert service._client is None
