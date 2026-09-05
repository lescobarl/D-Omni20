"""Servicio de rebranding por URL (Fase 5).

Descarga la página de una marca con ``httpx``, la analiza con BeautifulSoup y
propone una paleta, tipografías y logo compatibles con ``TenantAppearanceUpsert``
para que el frontend las aplique al tenant con un solo clic.

Contrato:
- :class:`RebrandingService` implementa el puerto :class:`IRebrandingService`.
- El cliente HTTP es inyectable para tests o se crea internamente con un timeout
  explícito desde ``Settings`` (regla CLAUDE: nunca timeout ``None``).
- Errores de red/HTTP → :class:`InputValidationError` con contexto y causa.
- Toda la heurística vive en helpers de módulo puros y testeables; la extracción
  es síncrona y acotada por tiempo (``bot_rebranding_timeout_seconds``).
"""

from __future__ import annotations

import re
from collections import Counter
from urllib.parse import urljoin

import httpx
from bs4 import BeautifulSoup

from app.config.settings import Settings
from app.core.errors import InputValidationError
from app.core.logging import ILogger
from app.schemas.tenant_config import AppearanceProposal
from app.services.interfaces import IRebrandingService

_HEX_COLOR_RE = re.compile(r"#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b")
_RGB_COLOR_RE = re.compile(
    r"rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([\d.]+))?\s*\)",
    re.IGNORECASE,
)
_STYLE_RE = re.compile(r"([a-z][a-z-]*)\s*:\s*([^;}\n]+)", re.IGNORECASE)
_SKIP_FONT_TOKENS = frozenset({"inherit", "initial", "unset", "revert"})

_MAX_STYLESHEETS = 5


def _normalize_hex(value: str) -> str:
    """Normaliza un color hex a ``#RRGGBB`` o ``#RRGGBBAA`` (mayúsculas)."""
    raw = value.lstrip("#")
    if len(raw) in (3, 4):
        raw = "".join(ch * 2 for ch in raw)
    return f"#{raw.upper()}"


def _rgb_to_hex(match: re.Match[str]) -> str | None:
    """Convierte un ``rgb()``/``rgba()`` ya capturado a hex (con canal alfa)."""
    r, g, b = int(match.group(1)), int(match.group(2)), int(match.group(3))
    if r > 255 or g > 255 or b > 255:
        return None
    if match.group(4) is not None:
        try:
            alpha = round(float(match.group(4)) * 255)
        except ValueError:
            return None
        if alpha < 0 or alpha > 255:
            return None
        return f"#{r:02X}{g:02X}{b:02X}{alpha:02X}"
    return f"#{r:02X}{g:02X}{b:02X}"


def _extract_hex(value: str) -> str | None:
    """Extrae el primer color (hex o rgb/rgba) válido de un valor CSS."""
    if match := _HEX_COLOR_RE.search(value):
        return _normalize_hex(match.group(0))
    if match := _RGB_COLOR_RE.search(value):
        return _rgb_to_hex(match)
    return None


def _rel_contains(value: str | None, token: str) -> bool:
    """Comprueba si el atributo ``rel`` de un ``<link>`` contiene ``token``."""
    if not value:
        return False
    return token in {part.strip().lower() for part in value.split()}


def _rgba(value: str) -> tuple[int, int, int, int] | None:
    """Descompone un color hex a ``(r, g, b, a)`` (alpha por defecto 255)."""
    raw = value.lstrip("#")
    r = int(raw[0:2], 16)
    g = int(raw[2:4], 16)
    b = int(raw[4:6], 16)
    a = int(raw[6:8], 16) if len(raw) >= 8 else 255
    return (r, g, b, a)


def _saturation(value: str) -> float:
    """Saturación HSB (0.0-1.0) de un color hex."""
    rgba = _rgba(value)
    if rgba is None:
        return 0.0
    r, g, b, _ = rgba
    mx, mn = max(r, g, b), min(r, g, b)
    return (mx - mn) / mx if mx else 0.0


def _luma(value: str) -> float:
    """Luminancia Rec. 709 (0-255) de un color hex."""
    rgba = _rgba(value)
    if rgba is None:
        return 0.0
    r, g, b, _ = rgba
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _is_neutral(value: str) -> bool:
    """Grises, blancos, negros y colores translúcidos: no son color de marca."""
    rgba = _rgba(value)
    if rgba is None:
        return True
    r, g, b, a = rgba
    if a < 200:
        return True
    mx, mn = max(r, g, b), min(r, g, b)
    sat = (mx - mn) / mx if mx else 0.0
    return sat < 0.12


def _is_light(value: str) -> bool:
    return _luma(value) > 200


def _is_dark(value: str) -> bool:
    return _luma(value) < 90


def _rank_non_neutral(colors: list[str]) -> list[str]:
    """Colores no neutros ordenados por frecuencia (desempate: saturación)."""
    counts = Counter(color for color in colors if color and not _is_neutral(color))
    ranked = sorted(
        counts.items(),
        key=lambda item: (-item[1], -_saturation(item[0])),
    )
    return [color for color, _ in ranked]


def _normalize_font(value: str) -> str | None:
    """Normaliza un valor ``font-family`` a la primera familia legible."""
    for part in value.split(","):
        candidate = part.strip().strip('"\'')
        if candidate and candidate.lower() not in _SKIP_FONT_TOKENS:
            return candidate
    return None


def _classify_css_declarations(css_chunks: list[str]) -> dict[str, list[str]]:
    """Clasifica los colores CSS por rol (primary/accent/surface/text/brand).

    Las variables ``--primary``/``--accent``/``--surface``/``--text`` son pistas
    explícitas; las propiedades ``background`` apuntan a superficie y
    ``color``/``border`` a colores de marca. Todo lo demás va a ``brand``.
    """
    roles: dict[str, list[str]] = {
        "primary": [],
        "accent": [],
        "surface": [],
        "text": [],
        "brand": [],
    }
    for chunk in css_chunks:
        for prop, raw_value in _STYLE_RE.findall(chunk):
            prop = prop.strip().lower()
            color = _extract_hex(raw_value)
            if color is None:
                continue
            if prop.startswith("--"):
                var_name = prop[2:].lower()
                if "primary" in var_name:
                    roles["primary"].append(color)
                elif "accent" in var_name:
                    roles["accent"].append(color)
                elif any(token in var_name for token in ("surface", "background", "bg")):
                    roles["surface"].append(color)
                elif any(token in var_name for token in ("text", "foreground", "fg")):
                    roles["text"].append(color)
                else:
                    roles["brand"].append(color)
                continue
            if "background" in prop:
                roles["surface"].append(color)
            elif "color" in prop or "border" in prop:
                roles["brand"].append(color)
            else:
                roles["brand"].append(color)
    return roles


class RebrandingService(IRebrandingService):
    """Extrae estilos de una URL de marca y propone una apariencia para el tenant."""

    def __init__(
        self,
        *,
        settings: Settings,
        logger: ILogger,
        client: httpx.Client | None = None,
    ) -> None:
        self._settings = settings
        self._logger = logger
        self._client = client
        self._owns_client = client is None

    def _get_client(self) -> httpx.Client:
        """Devuelve el cliente HTTP (creándolo con timeout explícito si hace falta)."""
        if self._client is None:
            self._client = httpx.Client(
                timeout=httpx.Timeout(self._settings.bot_rebranding_timeout_seconds),
                follow_redirects=True,
            )
        return self._client

    def close(self) -> None:
        """Cierra el cliente HTTP solo si la instancia lo posee (regla DI)."""
        if self._owns_client and self._client is not None:
            self._client.close()
            self._client = None

    def extract_url_styles(self, *, url: str) -> AppearanceProposal:
        """Descarga ``url`` y propone estilos (paleta, tipografías y logo)."""
        try:
            response = self._get_client().get(url, follow_redirects=True)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise InputValidationError(
                f"No se pudo acceder a la URL: {exc}",
                operation="tenant.appearance.extract_url",
                context={"url": url},
            ) from exc

        base_url = str(response.url)
        soup = BeautifulSoup(response.text, "html.parser")

        css_chunks = self._collect_css(soup, base_url)
        roles = _classify_css_declarations(css_chunks)

        primary = _pick_primary(roles)
        accent = _pick_accent(roles, primary)
        surface = _pick_surface(roles, primary)
        text = _pick_text(roles, primary)
        brand_badge = accent or primary

        fonts = _collect_fonts(css_chunks)
        logo_url = _extract_logo(soup, base_url)

        proposal = AppearanceProposal(
            primary_color=primary,
            accent_color=accent,
            surface_color=surface,
            text_color=text,
            brand_badge=brand_badge,
            logo_url=logo_url,
            font_family=fonts[0] if fonts else None,
            detected_fonts=fonts,
        )
        self._logger.info(
            "rebranding.extracted",
            "Estilos extraídos desde URL",
            url=url,
            primary_color=proposal.primary_color,
            fonts=len(proposal.detected_fonts),
            logo=bool(proposal.logo_url),
        )
        return proposal

    def _collect_css(self, soup: BeautifulSoup, base_url: str) -> list[str]:
        """Reúne CSS de atributos ``style``, tags ``<style>`` y hojas del mismo origen."""
        chunks: list[str] = []
        for tag in soup.find_all(style=True):
            style_value = tag.get("style")
            if style_value:
                chunks.append(style_value)
        for style_tag in soup.find_all("style"):
            if style_tag.string:
                chunks.append(style_tag.string)

        fetched = 0
        for link in soup.find_all("link", href=True):
            rel = link.get("rel")
            rel_text = " ".join(rel) if isinstance(rel, list) else str(rel or "")
            if not _rel_contains(rel_text, "stylesheet"):
                continue
            if fetched >= _MAX_STYLESHEETS:
                break
            stylesheet_url = urljoin(base_url, link.get("href") or "")
            if not self._same_origin(base_url, stylesheet_url):
                continue
            try:
                response = self._get_client().get(stylesheet_url)
                response.raise_for_status()
            except httpx.HTTPError:
                continue
            fetched += 1
            if response.text:
                chunks.append(response.text)
        return chunks

    @staticmethod
    def _same_origin(base_url: str, target_url: str) -> bool:
        """Comprueba si ``target_url`` pertenece al mismo host (o subdominio)."""
        try:
            base_host = httpx.URL(base_url).host
            target_host = httpx.URL(target_url).host
        except ValueError:
            return False
        if not base_host or not target_host:
            return False
        return target_host == base_host or target_host.endswith(f".{base_host}")


def _pick_primary(roles: dict[str, list[str]]) -> str | None:
    """Primary = color de marca más frecuente y no neutro (pistas ``--primary``)."""
    ranked = _rank_non_neutral(roles["primary"] or roles["brand"])
    return ranked[0] if ranked else None


def _pick_accent(roles: dict[str, list[str]], primary: str | None) -> str | None:
    """Accent = segundo color de marca más frecuente, distinto de primary."""
    for color in _rank_non_neutral(roles["accent"] + roles["brand"]):
        if color != primary:
            return color
    return None


def _pick_surface(roles: dict[str, list[str]], primary: str | None) -> str | None:
    """Fondo = color de fondo más frecuente (preferencia por tonos claros)."""
    counts = Counter(roles["surface"])
    ranked = sorted(counts.items(), key=lambda item: (-item[1], -_saturation(item[0])))
    for color, _ in ranked:
        if color != primary and (_is_light(color) or _is_neutral(color)):
            return color
    for color, _ in ranked:
        if color != primary:
            return color
    return None


def _pick_text(roles: dict[str, list[str]], primary: str | None) -> str | None:
    """Texto = color de texto más frecuente, priorizando tonos oscuros."""
    counts = Counter(roles["text"] or roles["brand"])
    ranked = sorted(counts.items(), key=lambda item: (-item[1], _saturation(item[0])))
    for color, _ in ranked:
        if color != primary and _is_dark(color):
            return color
    return None


def _collect_fonts(css_chunks: list[str]) -> list[str]:
    """Tipografías declaradas en la página, ordenadas por frecuencia."""
    fonts: list[str] = []
    for chunk in css_chunks:
        for prop, raw_value in _STYLE_RE.findall(chunk):
            if prop.strip().lower() == "font-family":
                normalized = _normalize_font(raw_value)
                if normalized:
                    fonts.append(normalized)
    return [font for font, _ in Counter(fonts).most_common()]


def _extract_logo(soup: BeautifulSoup, base_url: str) -> str | None:
    """Busca el logo en header/nav, imágenes con pistas ``logo`` o un favicon."""
    for img in soup.find_all("img"):
        src = img.get("src")
        if not src:
            continue
        alt = (img.get("alt") or "").lower()
        classes = " ".join(img.get("class") or []).lower()
        parents = [parent.name for parent in img.parents if parent.name]
        in_header = any(parent in {"header", "nav"} for parent in parents)
        if in_header or "logo" in alt or "logo" in classes or "brand" in classes:
            return urljoin(base_url, src)
    for link in soup.find_all("link", href=True):
        rel = link.get("rel")
        rel_text = " ".join(rel) if isinstance(rel, list) else str(rel or "")
        if "icon" in rel_text.lower() or "apple-touch" in rel_text.lower():
            return urljoin(base_url, link.get("href") or "")
    return None
