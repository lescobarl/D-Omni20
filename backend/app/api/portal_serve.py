"""Serving público del Portal del Cliente (C-3) como página independiente.

Contrato:
- Ruta raíz (sin ``api_v1_prefix``) porque es pública: se sirve desde el dominio
  del cliente sin ``X-Tenant-Id``, en la URL determinista ``{origin}/portal``
  (p. ej. ``http://localhost:8000/portal``).
- El tenant se resuelve SIEMPRE por la cabecera ``Host`` contra ``pseo_hosts``
  (vía ``get_pseo_tenant_by_host``), igual que el serving PSEO y CDN. Host
  ausente/desconocido/inactivo → 404, sin leak.
- ``serve_portal`` devuelve una página HTML autocontenida que:
  1. Contiene el contenedor ``[data-omni-portal]`` que espera ``portal.js``.
  2. Inyecta ``#omnibotia-config`` (``tenantId`` + ``apiBaseUrl`` + apariencia
     + páginas configurables) con el patrón ``_script_safe_json``
     (anti-``</script>``) para que el widget se active.
  3. Carga ``{apiBaseUrl}/static/portal.js`` con ``defer``.
  De esta forma el cliente puede llegar por web directamente (sin pasar por la
  landing) y aun así autenticarse y consultar su resumen/pagos/ARCO.

Personalización (C-3 Portales multired):
- La apariencia (paleta, logo y tipografía) se lee de ``tenant_appearance``
  (control plane §4.1) y se inyecta como variables CSS dinámicas. Si el tenant
  no la ha definido, se usan los valores por defecto del modelo.
- Las páginas del portal se leen EXCLUSIVAMENTE de ``portal_pages`` publicadas
  (configurador unificado, modo portal). Cada página es ``{slug, title,
  blocks}``; los ``blocks`` se serializan a texto para el widget ``portal.js``.
  Si el tenant no tiene ninguna página publicada en ``portal_pages``, el serving
  FALLA DE FORMA EXPLÍCITA (404 "portal no configurado") en lugar de servir
  contenido heredado de ``content_items kind="portal"`` o páginas por defecto.
  Nada está hardcodeado para un cliente concreto.
"""

from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse

from app.api.deps import (
    get_portal_page_repository,
    get_pseo_tenant_by_host,
    get_tenant_appearance_repository,
)
from app.api.http import request_origin
from app.core.errors import NotFoundError
from app.repositories.interfaces import (
    IPortalPageRepository,
    ITenantAppearanceRepository,
)

router = APIRouter(tags=["portal-serve"])


# Plantilla de la página independiente del portal. El widget ``portal.js``
# renderiza login/resumen/ARCO dentro de ``[data-omni-portal]`` y la navegación
# multipágina. Las variables CSS ``--omni-*`` se rellenan dinámicamente desde
# ``tenant_appearance`` (ver ``_appearance_css``).
_PAGE_TEMPLATE = """<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Portal del Cliente</title>
  <style>
    :root {
      --omni-primary: {primary};
      --omni-primary-dark: {primary_dark};
      --omni-accent: {accent};
      --omni-bg: {bg};
      --omni-card: {surface};
      --omni-border: #e2e8f0;
      --omni-text: {text};
      --omni-muted: #64748b;
      --omni-radius: 12px;
      --omni-shadow: 0 1px 3px rgba(15, 23, 42, 0.08), 0 4px 12px rgba(15, 23, 42, 0.06);
      --omni-font: {font};
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--omni-font);
      background: var(--omni-bg);
      color: var(--omni-text);
      line-height: 1.5;
    }
    .portal-shell {
      max-width: 860px;
      margin: 0 auto;
      padding: 40px 20px 64px;
    }
    .portal-nav {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 24px;
      border-bottom: 1px solid var(--omni-border);
      padding-bottom: 12px;
    }
    .portal-nav button {
      background: transparent;
      color: var(--omni-muted);
      border: 1px solid transparent;
      border-radius: 8px;
      padding: 8px 14px;
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
    }
    .portal-nav button:hover { color: var(--omni-primary); }
    .portal-nav button.active {
      color: var(--omni-primary);
      border-color: var(--omni-primary);
      background: color-mix(in srgb, var(--omni-primary) 8%, transparent);
    }
    .portal-brand {
      text-align: center;
      margin-bottom: 28px;
    }
    .portal-brand img {
      max-height: 64px;
      margin-bottom: 8px;
    }
    .portal-brand h1 {
      font-size: 1.5rem;
      margin: 0 0 4px;
      color: var(--omni-primary-dark);
    }
    .portal-brand p {
      margin: 0;
      color: var(--omni-muted);
      font-size: 0.95rem;
    }
    .portal-card {
      background: var(--omni-card);
      border: 1px solid var(--omni-border);
      border-radius: var(--omni-radius);
      box-shadow: var(--omni-shadow);
      padding: 28px;
    }
    .portal-page-content {
      white-space: pre-line;
      color: var(--omni-text);
    }
    /* Estilos mínimos para el contenido que renderiza portal.js */
    [data-omni-portal] input[type="email"] {
      width: 100%;
      padding: 12px 14px;
      border: 1px solid var(--omni-border);
      border-radius: 8px;
      font-size: 1rem;
      margin-bottom: 12px;
    }
    [data-omni-portal] button {
      background: var(--omni-primary);
      color: #fff;
      border: 0;
      border-radius: 8px;
      padding: 12px 18px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
    }
    [data-omni-portal] button:hover { background: var(--omni-primary-dark); }
    [data-omni-portal] section {
      border-top: 1px solid var(--omni-border);
      padding-top: 16px;
      margin-top: 16px;
    }
    [data-omni-portal] h3 { margin: 0 0 8px; font-size: 1.05rem; }
    [data-omni-portal] ul { margin: 0; padding-left: 18px; }
    [data-omni-portal] li { margin-bottom: 6px; }
    [data-omni-portal] .muted { color: var(--omni-muted); font-size: 0.9rem; }
  </style>
</head>
<body>
  <main class="portal-shell">
    <header class="portal-brand">
      {logo}
      <h1>Portal del Cliente</h1>
      <p>Consulta tus pagos, solicitudes, cotizaciones y citas.</p>
    </header>
    <nav class="portal-nav" data-omni-nav></nav>
    <div class="portal-card">
      <section data-omni-portal class="portal"></section>
    </div>
  </main>
</body>
</html>
"""


def _script_safe_json(payload: dict[str, object]) -> str:
    """Serializa a JSON seguro dentro de ``<script>`` (mismo patrón que el CDN)."""
    serialized = json.dumps(payload, ensure_ascii=True, separators=(",", ":"))
    return (
        serialized.replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("&", "\\u0026")
        .replace("'", "\\u0027")
    )


def _darken(hex_color: str, factor: float = 0.82) -> str:
    """Oscurece un color hex (#RRGGBB o #RRGGBBAA) para el hover/acento oscuro."""
    value = hex_color.lstrip("#")
    if len(value) not in (6, 8):
        return hex_color
    rgb = value[:6]
    try:
        channels = [int(rgb[i : i + 2], 16) for i in (0, 2, 4)]
    except ValueError:
        return hex_color
    darkened = [max(0, min(255, int(round(c * factor)))) for c in channels]
    return "#" + "".join(f"{c:02x}" for c in darkened)


def _appearance_css(appearance: object) -> dict[str, str]:
    """Extrae la paleta de ``tenant_appearance`` como variables CSS (con defaults)."""
    primary = getattr(appearance, "primary_color", None) or "#2563EB"
    accent = getattr(appearance, "accent_color", None) or "#7C3AED"
    surface = getattr(appearance, "surface_color", None) or "#FFFFFF"
    text = getattr(appearance, "text_color", None) or "#0F172A"
    font = getattr(appearance, "font_family", None) or (
        'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    )
    return {
        "primary": primary,
        "primary_dark": _darken(primary),
        "accent": accent,
        "bg": "#f8fafc",
        "surface": surface,
        "text": text,
        "font": font,
    }


def _logo_html(appearance: object) -> str:
    """Devuelve el ``<img>`` del logo si el tenant lo configuró; si no, vacío."""
    logo_url = getattr(appearance, "logo_url", None)
    if not logo_url:
        return ""
    return f'<img src="{logo_url}" alt="Logo" />'


def _blocks_to_content(blocks: object) -> str:
    """Convierte la estructura ``blocks`` de una página del portal en texto.

    El widget ``portal.js`` consume cada página como ``{slug, title, content}``
    donde ``content`` es un cuerpo de texto/markdown ligero. Las páginas del
    portal se modelan como una lista de bloques ``{"type", "name", "config"}``
    (generados por IA o editados en el configurador unificado). Esta función
    serializa esos bloques a un texto legible y determinista, sin hardcode del
    cliente: cada tipo de bloque se traduce según su ``config``.

    ``portal_pages.blocks`` se persiste como un DICT envolvente
    ``{"slug", "title", "blocks": [...]}`` (mismo formato que devuelve el motor
    IA en ``_validate_portal_config``). Para robustez se aceptan ambos formatos:
    una lista plana de bloques o un dict con la clave ``"blocks"``.
    """
    if isinstance(blocks, dict):
        blocks = blocks.get("blocks")
    if not isinstance(blocks, list):
        return ""
    sections: list[str] = []
    for block in blocks:
        if not isinstance(block, dict):
            continue
        block_type = block.get("type")
        config = block.get("config")
        if not isinstance(config, dict):
            config = {}
        if block_type == "hero":
            title = config.get("title") or config.get("headline")
            subtitle = config.get("subtitle") or config.get("description")
            text = str(title or "").strip()
            if subtitle:
                text = f"{text}\n\n{subtitle}".strip()
            if text:
                sections.append(text)
        elif block_type == "services_grid":
            title = config.get("title")
            if title:
                sections.append(f"## {title}")
            services = config.get("services") or config.get("items")
            if isinstance(services, list):
                for service in services:
                    if isinstance(service, dict):
                        name = service.get("name") or service.get("title")
                        desc = service.get("description") or service.get("text")
                        line = str(name or "").strip()
                        if desc:
                            line = f"{line}: {desc}".strip()
                        if line:
                            sections.append(f"- {line}")
        elif block_type == "testimonials":
            title = config.get("title")
            if title:
                sections.append(f"## {title}")
            testimonials = config.get("testimonials") or config.get("items")
            if isinstance(testimonials, list):
                for item in testimonials:
                    if isinstance(item, dict):
                        quote = item.get("quote") or item.get("text")
                        author = item.get("author") or item.get("name")
                        if quote:
                            line = f"> {quote}"
                            if author:
                                line = f"{line}\n> — {author}"
                            sections.append(line)
        elif block_type == "faq":
            title = config.get("title")
            if title:
                sections.append(f"## {title}")
            faqs = config.get("faqs") or config.get("items")
            if isinstance(faqs, list):
                for item in faqs:
                    if isinstance(item, dict):
                        q = item.get("question") or item.get("q")
                        a = item.get("answer") or item.get("a")
                        if q:
                            sections.append(f"**{q}**")
                        if a:
                            sections.append(str(a))
        elif block_type == "contact_form":
            title = config.get("title")
            if title:
                sections.append(f"## {title}")
            description = config.get("description") or config.get("subtitle")
            if description:
                sections.append(str(description))
        elif block_type == "appointment_scheduler":
            title = config.get("title")
            if title:
                sections.append(f"## {title}")
            description = config.get("description") or config.get("subtitle")
            if description:
                sections.append(str(description))
        elif block_type == "payment_status":
            title = config.get("title")
            if title:
                sections.append(f"## {title}")
            description = config.get("description") or config.get("subtitle")
            if description:
                sections.append(str(description))
        elif block_type == "quote_request":
            title = config.get("title")
            if title:
                sections.append(f"## {title}")
            description = config.get("description") or config.get("subtitle")
            if description:
                sections.append(str(description))
        elif block_type == "privacy_policy":
            title = config.get("title")
            if title:
                sections.append(f"## {title}")
            body = config.get("body") or config.get("content") or config.get("text")
            if body:
                sections.append(str(body))
        elif block_type == "about":
            title = config.get("title")
            if title:
                sections.append(f"## {title}")
            body = config.get("body") or config.get("content") or config.get("text")
            if body:
                sections.append(str(body))
        elif block_type == "mission_vision":
            title = config.get("title")
            if title:
                sections.append(f"## {title}")
            mission = config.get("mission")
            vision = config.get("vision")
            if mission:
                sections.append(f"**Misión:** {mission}")
            if vision:
                sections.append(f"**Visión:** {vision}")
        else:
            # Tipo de bloque desconocido: se conserva el nombre como encabezado
            # y cualquier texto plano del config, sin romper el contenido.
            name = block.get("name")
            if name:
                sections.append(f"## {name}")
            body = config.get("body") or config.get("content") or config.get("text")
            if body:
                sections.append(str(body))
    return "\n\n".join(section for section in sections if section)


def _portal_pages(
    portal_repo: IPortalPageRepository,
    tenant_id: uuid.UUID,
) -> list[dict[str, str]]:
    """Carga las páginas configurables del portal SOLO desde ``portal_pages``.

    Fuente única de verdad: páginas publicadas de ``portal_pages`` (configuradas
    y publicadas en el configurador unificado, modo portal). Cada página se
    convierte a ``{slug, title, content}`` serializando sus ``blocks``.

    Si el tenant no tiene ninguna página publicada en ``portal_pages``, se
    lanza :class:`NotFoundError` ("portal no configurado") para que el fallo sea
    EXPLÍCITO y visible — nunca se sirve contenido heredado de
    ``content_items kind="portal"`` ni páginas por defecto genéricas, que
    enmascaraban que el configurador no había escrito nada.
    """
    published = portal_repo.list_published(tenant_id=tenant_id)
    if not published:
        raise NotFoundError(
            "Portal no configurado: el tenant no tiene páginas publicadas en "
            "portal_pages. Configúralas y publícalas desde el configurador "
            "unificado (modo portal) antes de servir el portal.",
            operation="portal.serve.pages",
            context={"tenant_id": str(tenant_id)},
        )
    pages: list[dict[str, str]] = []
    for page in published:
        pages.append(
            {
                "slug": page.slug,
                "title": page.title or "Página",
                "content": _blocks_to_content(page.blocks),
            }
        )
    return pages


@router.get("/portal")
def serve_portal(
    request: Request,
    tenant_id: uuid.UUID = Depends(get_pseo_tenant_by_host),
    appearance_repo: ITenantAppearanceRepository = Depends(
        get_tenant_appearance_repository
    ),
    portal_repo: IPortalPageRepository = Depends(get_portal_page_repository),
) -> HTMLResponse:
    """Sirve la página independiente del Portal del Cliente por ``Host``.

    - Host ausente/desconocido/inactivo → 404 (resuelto por
      ``get_pseo_tenant_by_host``, sin leak entre tenants).
    - La página inyecta ``#omnibotia-config`` (tenantId + apiBaseUrl +
      apariencia + páginas) y carga ``portal.js`` para que el widget se active
      y el cliente pueda autenticarse por email y navegar las páginas.
    - Las páginas se leen EXCLUSIVAMENTE de ``portal_pages`` publicadas
      (configurador unificado, modo portal). Si el tenant no tiene ninguna
      página publicada, se responde 404 "portal no configurado" (fail-loudly):
      nunca se sirve contenido de ``content_items kind="portal"`` ni por defecto.
    - El ``apiBaseUrl`` y el ``portal.js`` apuntan al origen del request
      (localhost, túnel ngrok o dominio real) para que el portal funcione desde
      cualquier origen que lo sirva.
    """
    origin = request_origin(request)
    appearance = appearance_repo.get(tenant_id=tenant_id)
    pages = _portal_pages(portal_repo, tenant_id)

    config = _script_safe_json(
        {
            "tenantId": str(tenant_id),
            "apiBaseUrl": origin,
            "appearance": {
                "primary": getattr(appearance, "primary_color", None) or "#2563EB",
                "accent": getattr(appearance, "accent_color", None) or "#7C3AED",
                "surface": getattr(appearance, "surface_color", None) or "#FFFFFF",
                "text": getattr(appearance, "text_color", None) or "#0F172A",
                "logoUrl": getattr(appearance, "logo_url", None) or "",
                "fontFamily": getattr(appearance, "font_family", None) or "",
            },
            "pages": pages,
        }
    )
    head = (
        f'<script id="omnibotia-config" type="application/json">'
        f"{config}</script>\n"
    )
    if origin:
        head += f'<script src="{origin}/static/portal.js" defer></script>\n'

    css_vars = _appearance_css(appearance)
    logo = _logo_html(appearance)
    html = _PAGE_TEMPLATE
    html = html.replace("{primary}", css_vars["primary"])
    html = html.replace("{primary_dark}", css_vars["primary_dark"])
    html = html.replace("{accent}", css_vars["accent"])
    html = html.replace("{bg}", css_vars["bg"])
    html = html.replace("{surface}", css_vars["surface"])
    html = html.replace("{text}", css_vars["text"])
    html = html.replace("{font}", css_vars["font"])
    html = html.replace("{logo}", logo)
    html = html.replace("</head>", f"{head}</head>", 1)
    return HTMLResponse(content=html)
