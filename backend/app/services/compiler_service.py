"""Compilador de configuración → HTML (motor minimal funcional con Jinja2).

Contrato:
- Recibe la ``config`` JSON de una landing (alineada con ``ILandingConfig``
  del frontend: ``title``, ``blocks[{type, config, ...}]``) y produce HTML.
- Soporta los tipos de bloque del catálogo: ``hero``, ``services_grid``,
  ``calculator``, ``testimonials``, ``faq``, ``lead_form``,
  ``conversion_floating``.
- Autoescape activado para texto (XSS); CSS propio se emite con ``safe``.
- Errores de plantilla se convierten en :class:`InputValidationError` con
  contexto (regla CLAUDE: errores con contexto, sin try/except vacío).
"""

from __future__ import annotations

import re
from typing import Any

from jinja2 import Environment, Template, TemplateError

from app.core.errors import InputValidationError
from app.services.interfaces import ICompilerService

_DEFAULT_TEMPLATE = """<!doctype html>
<html lang="{{ config.get('lang', 'es') | e }}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{ config.get('title', 'Landing') | e }}</title>
<style>
body { margin: 0; font-family: system-ui, -apple-system, sans-serif; line-height: 1.5; color: #111; background: #fff; }
section { padding: 3rem 1.5rem; }
.container { max-width: 64rem; margin: 0 auto; }
.hero { text-align: center; background: #f6f7f9; }
.hero h1 { font-size: 2.5rem; margin: 0 0 .5rem; }
.cta { display: inline-block; margin-top: 1rem; padding: .75rem 1.5rem; background: #0d6efd; color: #fff; border-radius: .5rem; text-decoration: none; }
.grid { display: grid; gap: 1.5rem; }
.grid--3 { grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); }
.card, .testimonial, .faq-item { border: 1px solid #e2e5e9; border-radius: .75rem; padding: 1.25rem; margin-bottom: 1rem; }
.floating { position: fixed; bottom: 1.5rem; right: 1.5rem; z-index: 10; }
form input, form textarea { display: block; width: 100%; margin: .5rem 0; padding: .5rem; border: 1px solid #ccc; border-radius: .375rem; }
</style>
{% if config.get('custom_css') %}{{ config['custom_css'] | safe }}{% endif %}
</head>
<body>
<main>
{% for block in config.get('blocks', []) %}
  {% set b = block.config %}
  {% if block.type == 'hero' %}
    <section class="hero">
      <div class="container">
        <h1>{{ b.get('title', '') | e }}</h1>
        <p>{{ b.get('subtitle', '') | e }}</p>
        {% if b.get('cta_text') %}<a class="cta" href="{{ b.get('cta_url', '#') | e }}">{{ b.get('cta_text') | e }}</a>{% endif %}
      </div>
    </section>
  {% elif block.type == 'services_grid' %}
    <section>
      <div class="container">
        <div class="grid grid--3">
        {% for item in b.get('services', []) %}
          <div class="card"><h3>{{ item.get('title', '') | e }}</h3><p>{{ item.get('description', '') | e }}</p></div>
        {% else %}
          <p>Configura los servicios en el editor.</p>
        {% endfor %}
        </div>
      </div>
    </section>
  {% elif block.type == 'calculator' %}
    <section>
      <div class="container">
        <h2>{{ b.get('title', 'Calculadora') | e }}</h2>
        <p>Calculadora de conversión ({{ b.get('currency', 'MXN') | e }}) — JS embebido en el editor.</p>
      </div>
    </section>
  {% elif block.type == 'testimonials' %}
    <section>
      <div class="container">
        {% for item in b.get('items', []) %}
          <div class="testimonial"><blockquote>{{ item.get('quote', '') | e }}</blockquote><cite>{{ item.get('author', '') | e }}</cite></div>
        {% else %}
          <p>Sin testimonios aún.</p>
        {% endfor %}
      </div>
    </section>
  {% elif block.type == 'faq' %}
    <section>
      <div class="container">
        {% for item in b.get('items', []) %}
          <details class="faq-item"><summary>{{ item.get('question', '') | e }}</summary><p>{{ item.get('answer', '') | e }}</p></details>
        {% else %}
          <p>Sin preguntas frecuentes aún.</p>
        {% endfor %}
      </div>
    </section>
  {% elif block.type == 'lead_form' %}
    <section>
      <div class="container">
        <form>
          {% for field in b.get('fields', []) %}
            <label>{{ field.get('label', '') | e }}
              <input type="{{ field.get('input_type', 'text') | e }}" name="{{ field.get('name', '') | e }}">
            </label>
          {% endfor %}
          {% if b.get('submit_text') %}<button type="submit">{{ b.get('submit_text') | e }}</button>{% endif %}
        </form>
      </div>
    </section>
  {% elif block.type == 'conversion_floating' %}
    <div class="floating"><a class="cta" href="{{ b.get('cta_url', '#') | e }}">{{ b.get('text', '') | e }}</a></div>
  {% else %}
    <section class="generic">
      <div class="container"><h2>{{ b.get('title', '') | e }}</h2><p>{{ b.get('subtitle', '') | e }}</p></div>
    </section>
  {% endif %}
{% endfor %}
</main>
</body>
</html>
"""

# Plantilla PSEO (Fase B): el config resuelto por ``DataMatrixService`` llega
# PRE-ESCAPADO (``html.escape`` en el punto de sustitución), por lo que todo el
# texto se renderiza con ``| safe`` para NO duplicar entidades. El resolver es la
# única frontera de seguridad (anti-XSS); esta plantilla nunca recibe datos sin
# escapar. ``custom_css`` sigue siendo ``safe`` (CSS propio, igual que default).
# JSON-LD (Fase E): LocalBusiness / Service / FAQPage en el ``<head>`` serializados
# con ``| tojson`` — escapa ``< > & '`` como escapes unicode (no rompe el
# ``</script>``) y cumple el criterio de aceptación "JSON-LD válido".
_PSEO_TEMPLATE = """<!doctype html>
<html lang="{{ config.get('lang', 'es') | safe }}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{ config.get('title', 'Landing') | safe }}</title>
<style>
body { margin: 0; font-family: system-ui, -apple-system, sans-serif; line-height: 1.5; color: #111; background: #fff; }
section { padding: 3rem 1.5rem; }
.container { max-width: 64rem; margin: 0 auto; }
.hero { text-align: center; background: #f6f7f9; }
.hero h1 { font-size: 2.5rem; margin: 0 0 .5rem; }
.cta { display: inline-block; margin-top: 1rem; padding: .75rem 1.5rem; background: #0d6efd; color: #fff; border-radius: .5rem; text-decoration: none; }
.grid { display: grid; gap: 1.5rem; }
.grid--3 { grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); }
.card, .testimonial, .faq-item { border: 1px solid #e2e5e9; border-radius: .75rem; padding: 1.25rem; margin-bottom: 1rem; }
.floating { position: fixed; bottom: 1.5rem; right: 1.5rem; z-index: 10; }
form input, form textarea { display: block; width: 100%; margin: .5rem 0; padding: .5rem; border: 1px solid #ccc; border-radius: .375rem; }
</style>
{% if config.get('custom_css') %}{{ config['custom_css'] | safe }}{% endif %}
{% set geo = config.get('geo_optimization', {}) %}
{% set lb = geo.get('local_business') %}
{% set seo = config.get('seo_programmatic', {}) %}
{% set faq_entities = [] %}
{% for block in config.get('blocks', []) %}
  {% if block.type == 'faq' %}
    {% for item in block.get('config', {}).get('items', []) %}
      {% set _ = faq_entities.append({
        "@type": "Question",
        "name": item.get('question', ''),
        "acceptedAnswer": {"@type": "Answer", "text": item.get('answer', '')}
      }) %}
    {% endfor %}
  {% endif %}
{% endfor %}
{% if lb %}
<script type="application/ld+json">
{{ {
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "name": lb.get('name', ''),
  "address": {
    "@type": "PostalAddress",
    "streetAddress": lb.get('address', ''),
    "addressLocality": lb.get('city', ''),
    "addressRegion": lb.get('state', ''),
    "addressCountry": lb.get('country', ''),
    "postalCode": lb.get('postal_code', '')
  },
  "telephone": lb.get('phone', ''),
  "geo": {
    "@type": "GeoCoordinates",
    "latitude": lb.get('geo', {}).get('latitude'),
    "longitude": lb.get('geo', {}).get('longitude')
  }
} | tojson }}
</script>
{% endif %}
{% if seo %}
<script type="application/ld+json">
{{ {
  "@context": "https://schema.org",
  "@type": "Service",
  "name": seo.get('service_name', ''),
  "areaServed": seo.get('city', ''),
  "provider": {"@type": "LocalBusiness", "name": lb.get('name', '')} if lb else "",
  "offers": {
    "@type": "Offer",
    "price": seo.get('offer_price', ''),
    "priceCurrency": "MXN"
  }
} | tojson }}
</script>
{% endif %}
{% if faq_entities %}
<script type="application/ld+json">
{{ {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": faq_entities
} | tojson }}
</script>
{% endif %}
</head>
<body>
<main>
{% for block in config.get('blocks', []) %}
  {% set b = block.config %}
  {% if block.type == 'hero' %}
    <section class="hero">
      <div class="container">
        <h1>{{ b.get('title', '') | safe }}</h1>
        <p>{{ b.get('subtitle', '') | safe }}</p>
        {% if b.get('cta_text') %}<a class="cta" href="{{ b.get('cta_url', '#') | safe }}">{{ b.get('cta_text') | safe }}</a>{% endif %}
      </div>
    </section>
  {% elif block.type == 'services_grid' %}
    <section>
      <div class="container">
        <div class="grid grid--3">
        {% for item in b.get('services', []) %}
          <div class="card"><h3>{{ item.get('title', '') | safe }}</h3><p>{{ item.get('description', '') | safe }}</p></div>
        {% else %}
          <p>Configura los servicios en el editor.</p>
        {% endfor %}
        </div>
      </div>
    </section>
  {% elif block.type == 'calculator' %}
    <section>
      <div class="container">
        <h2>{{ b.get('title', 'Calculadora') | safe }}</h2>
        <p>Calculadora de conversión ({{ b.get('currency', 'MXN') | safe }}) — JS embebido en el editor.</p>
      </div>
    </section>
  {% elif block.type == 'testimonials' %}
    <section>
      <div class="container">
        {% for item in b.get('items', []) %}
          <div class="testimonial"><blockquote>{{ item.get('quote', '') | safe }}</blockquote><cite>{{ item.get('author', '') | safe }}</cite></div>
        {% else %}
          <p>Sin testimonios aún.</p>
        {% endfor %}
      </div>
    </section>
  {% elif block.type == 'faq' %}
    <section>
      <div class="container">
        {% for item in b.get('items', []) %}
          <details class="faq-item"><summary>{{ item.get('question', '') | safe }}</summary><p>{{ item.get('answer', '') | safe }}</p></details>
        {% else %}
          <p>Sin preguntas frecuentes aún.</p>
        {% endfor %}
      </div>
    </section>
  {% elif block.type == 'lead_form' %}
    <section>
      <div class="container">
        <form>
          {% for field in b.get('fields', []) %}
            <label>{{ field.get('label', '') | safe }}
              <input type="{{ field.get('input_type', 'text') | safe }}" name="{{ field.get('name', '') | safe }}">
            </label>
          {% endfor %}
          {% if b.get('submit_text') %}<button type="submit">{{ b.get('submit_text') | safe }}</button>{% endif %}
        </form>
      </div>
    </section>
  {% elif block.type == 'conversion_floating' %}
    <div class="floating"><a class="cta" href="{{ b.get('cta_url', '#') | safe }}">{{ b.get('text', '') | safe }}</a></div>
  {% else %}
    <section class="generic">
      <div class="container"><h2>{{ b.get('title', '') | safe }}</h2><p>{{ b.get('subtitle', '') | safe }}</p></div>
    </section>
  {% endif %}
{% endfor %}
</main>
</body>
</html>
"""

_TEMPLATES: dict[str, str] = {
    "default": _DEFAULT_TEMPLATE,
    "pseo": _PSEO_TEMPLATE,
}


def minify_html(html: str) -> str:
    """Minifica HTML: elimina comentarios, espacios entre etiquetas y líneas en blanco.

    Optimización de activos (Fase 5.4): reduce el peso del HTML antes de
    persistirlo o descargarlo sin alterar el significado del documento.
    """
    minified = re.sub(r"<!--.*?-->", "", html, flags=re.DOTALL)
    minified = re.sub(r">\s+<", "><", minified)
    minified = re.sub(r"[ \t]+", " ", minified)
    minified = re.sub(r"\n\s*\n+", "\n", minified)
    return minified.strip()


class JinjaCompilerService(ICompilerService):
    """Compilador con Jinja2 (motor minimal funcional, con caché de plantillas).

    Las plantillas compiladas se cachean por nombre resuelto para evitar
    re-parsear el Jinja2 ``Environment`` en cada compilación (objetivo de
    rendimiento < 0.1 s por compilación).
    """

    def __init__(self) -> None:
        self._env = Environment(autoescape=True, trim_blocks=True, lstrip_blocks=True)
        self._compiled_templates: dict[str, Template] = {}

    def compile(self, *, config: dict[str, Any], template_name: str = "default") -> str:
        if not isinstance(config, dict):
            raise InputValidationError(
                "config debe ser un objeto JSON",
                operation="landing.compile",
                context={"template_name": template_name},
            )
        # Plantillas desconocidas caen a "default"; el nombre resuelto cachea el parseo.
        resolved_name = template_name if template_name in _TEMPLATES else "default"
        template = self._compiled_templates.get(resolved_name)
        if template is None:
            template = self._env.from_string(_TEMPLATES[resolved_name])
            self._compiled_templates[resolved_name] = template
        try:
            return template.render(config=config)
        except TemplateError as exc:
            raise InputValidationError(
                f"Error al compilar la landing: {exc}",
                operation="landing.compile",
                context={"template_name": template_name},
            ) from exc
